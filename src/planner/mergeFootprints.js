// mergeFootprints — merge adjacent same-type rectangles into single polygonal
// footprints (L / T / U shapes), so a zone reads as one room with a real plan
// shape instead of a pile of abutting boxes.
//
// Why this is additive rather than a rewrite: EVERY downstream consumer reads
// only {x0,x1,z0,z1} — rhinoExport writes literal cuboids from those six
// numbers, filterColumnsToFootprint builds a bounding envelope from them, and
// ColumnStage/MassingBoxPreview draw box faces. So a merged group keeps a
// valid bounding rectangle in those fields and carries the real outline in an
// OPTIONAL `outline` field. Anything that understands `outline` draws the true
// shape; anything that doesn't still sees a sane box and keeps working.
//
// The merge is deliberately conservative — only rectangles that genuinely
// share an edge are merged, so this never invents area or bridges a gap the
// layout intended (a courtyard between two wings must stay a courtyard).

// Two rects share an edge if they touch on one axis and overlap on the other.
// EPS absorbs the half-cell rounding cellsToBoxes/clipBoxToGrid introduce.
const EPS = 0.26; // just over half a 0.5m grid cell

function sharesEdge(a, b) {
  const xTouch = Math.abs(a.x1 - b.x0) <= EPS || Math.abs(b.x1 - a.x0) <= EPS;
  const zTouch = Math.abs(a.z1 - b.z0) <= EPS || Math.abs(b.z1 - a.z0) <= EPS;
  const xOverlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const zOverlap = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
  // Touching along X needs real overlap in Z (and vice versa). Require more
  // than a hairline so two rects meeting only at a corner are NOT merged —
  // corner-touching shapes are not one room.
  if (xTouch && zOverlap > EPS) return true;
  if (zTouch && xOverlap > EPS) return true;
  // Also merge genuinely overlapping rects (clipBoxToGrid can emit these).
  return xOverlap > EPS && zOverlap > EPS;
}

// Trace the outline of a union of axis-aligned rectangles.
//
// Uses the standard "boundary edges are those belonging to exactly one cell"
// approach on the rectilinear arrangement induced by the rects' own
// coordinates, then walks those edges into a closed ring. That handles L, T,
// U, and step shapes exactly, which a convex hull would not (a hull across an
// L would swallow the notch and claim area the zone does not have).
//
// Returns null when the union is a plain rectangle (nothing to describe) or
// when the trace fails — callers then just use the bounding box.
export function traceOutline(rects) {
  if (!rects.length) return null;

  // Build the coordinate lattice from the rects' own edges.
  const xsSet = new Set(), zsSet = new Set();
  for (const r of rects) { xsSet.add(r.x0); xsSet.add(r.x1); zsSet.add(r.z0); zsSet.add(r.z1); }
  const xs = [...xsSet].sort((a, b) => a - b);
  const zs = [...zsSet].sort((a, b) => a - b);
  if (xs.length < 2 || zs.length < 2) return null;
  // Keep the lattice small — this runs per zone per floor per variation.
  if ((xs.length - 1) * (zs.length - 1) > 4096) return null;

  const nx = xs.length - 1, nz = zs.length - 1;
  const filled = new Uint8Array(nx * nz);
  for (let ci = 0; ci < nx; ci++) {
    const mx = (xs[ci] + xs[ci + 1]) / 2;
    for (let ri = 0; ri < nz; ri++) {
      const mz = (zs[ri] + zs[ri + 1]) / 2;
      for (const r of rects) {
        if (mx > r.x0 && mx < r.x1 && mz > r.z0 && mz < r.z1) { filled[ri * nx + ci] = 1; break; }
      }
    }
  }

  // Boundary edges: a cell edge with filled on exactly one side. Directed so
  // the interior stays on a consistent side, which makes the walk unambiguous.
  const at = (ci, ri) => (ci < 0 || ri < 0 || ci >= nx || ri >= nz) ? 0 : filled[ri * nx + ci];
  const key = (x, z) => `${x.toFixed(4)},${z.toFixed(4)}`;
  const outAdj = new Map();
  const addEdge = (x1, z1, x2, z2) => {
    const k = key(x1, z1);
    if (!outAdj.has(k)) outAdj.set(k, []);
    outAdj.get(k).push([x2, z2]);
  };
  let edgeCount = 0;
  for (let ri = 0; ri < nz; ri++) {
    for (let ci = 0; ci < nx; ci++) {
      if (!filled[ri * nx + ci]) continue;
      const x0 = xs[ci], x1 = xs[ci + 1], z0 = zs[ri], z1 = zs[ri + 1];
      // CCW in (x, z) with z downward: top edge goes +x, right +z, bottom -x, left -z.
      if (!at(ci, ri - 1)) { addEdge(x0, z0, x1, z0); edgeCount++; }
      if (!at(ci + 1, ri)) { addEdge(x1, z0, x1, z1); edgeCount++; }
      if (!at(ci, ri + 1)) { addEdge(x1, z1, x0, z1); edgeCount++; }
      if (!at(ci - 1, ri)) { addEdge(x0, z1, x0, z0); edgeCount++; }
    }
  }
  if (!edgeCount) return null;

  // Walk one closed ring from an extreme vertex (guaranteed on the outer ring,
  // so holes — if any — are never returned as the outline).
  //
  // Identity is by KEY STRING throughout, never by re-parsing a key back into
  // a number. Parsing `key()` (which is toFixed(4)) returns a ROUNDED
  // coordinate, and comparing that against the full-precision vertex the walk
  // actually reaches differs by ~1e-6 — far more than any sane epsilon — so the
  // "have we returned to the start?" test never fired and every real outline
  // fell through to null. Hand-rounded test fixtures hid this because their
  // values round-tripped exactly.
  let startKey = null, startPt = null;
  for (const [k, edges] of outAdj) {
    if (!edges.length) continue;
    const [x, z] = k.split(',').map(Number);
    if (!startPt || z < startPt.z - 1e-9 || (Math.abs(z - startPt.z) < 1e-9 && x < startPt.x)) {
      startPt = { x, z };
      startKey = k;
    }
  }
  if (!startKey) return null;

  const ring = [{ x: startPt.x, z: startPt.z }];
  let curKey = startKey;
  const guard = edgeCount + 8;
  for (let step = 0; step < guard; step++) {
    const opts = outAdj.get(curKey);
    if (!opts || !opts.length) return null;
    const next = opts.shift(); // consume — each directed edge is walked once
    if (!opts.length) outAdj.delete(curKey);
    const nextKey = key(next[0], next[1]);
    if (nextKey === startKey) return simplify(ring); // closed
    ring.push({ x: next[0], z: next[1] });
    curKey = nextKey;
  }
  return null; // did not close — fall back to the bounding box
}

// Drop collinear vertices; an L needs 6 points, not 40.
function simplify(ring) {
  if (ring.length < 4) return null;
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[(i - 1 + ring.length) % ring.length];
    const c = ring[i];
    const n = ring[(i + 1) % ring.length];
    const cross = (c.x - p.x) * (n.z - c.z) - (c.z - p.z) * (n.x - c.x);
    if (Math.abs(cross) > 1e-9) out.push(c);
  }
  // A plain rectangle carries no information the bounding box lacks.
  return out.length > 4 ? out : null;
}

// Merge same-type adjacent boxes on one floor.
//
// Boxes carrying distinct dwelling identity are NEVER merged: two different
// apartments that happen to abut are two homes, not one L-shaped one, and
// merging them would destroy the unit mix. Only untyped floorplate and
// non-residential programme (community/services/entry) merges.
export function mergeFloorFootprints(boxes) {
  if (!Array.isArray(boxes) || boxes.length < 2) return boxes;

  const mergeable = [];
  const keepAsIs = [];
  boxes.forEach((b, i) => {
    // A box that IS a specific dwelling keeps its own identity.
    if (b.typologyId) keepAsIs.push(b);
    else mergeable.push({ ...b, _i: i });
  });
  if (mergeable.length < 2) return boxes;

  // Union-find over same-type edge-sharing boxes.
  const parent = mergeable.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (i, j) => { const a = find(i), b = find(j); if (a !== b) parent[a] = b; };
  for (let i = 0; i < mergeable.length; i++) {
    for (let j = i + 1; j < mergeable.length; j++) {
      if (mergeable[i].type !== mergeable[j].type) continue;
      if (mergeable[i].heightFloors !== mergeable[j].heightFloors) continue; // different volumes
      if (sharesEdge(mergeable[i], mergeable[j])) union(i, j);
    }
  }

  const groups = new Map();
  mergeable.forEach((b, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(b);
  });

  const merged = [];
  for (const group of groups.values()) {
    if (group.length === 1) { const { _i, ...b } = group[0]; merged.push(b); continue; }
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const g of group) {
      x0 = Math.min(x0, g.x0); x1 = Math.max(x1, g.x1);
      z0 = Math.min(z0, g.z0); z1 = Math.max(z1, g.z1);
    }
    const outline = traceOutline(group);
    const { _i, ...proto } = group[0];
    merged.push({
      ...proto,
      x0, x1, z0, z1,
      // Only carried when the union is genuinely non-rectangular. Consumers
      // that don't know about it still see the bounding box above.
      ...(outline ? { outline } : {}),
      // Real merged area, so metrics don't read the bounding box (which would
      // overstate an L-shape by the size of its notch).
      mergedAreaM2: group.reduce((s, g) => s + (g.x1 - g.x0) * (g.z1 - g.z0), 0),
    });
  }
  return [...keepAsIs, ...merged];
}

export function mergeFootprints(floors) {
  if (!Array.isArray(floors)) return floors;
  return floors.map(fl => ({ ...fl, boxes: mergeFloorFootprints(fl.boxes) }));
}
