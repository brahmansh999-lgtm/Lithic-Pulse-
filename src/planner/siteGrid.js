// siteGrid — rasterizes the REAL site polygon into a fine buildable-cell
// grid (0.5m cells) so massing/zoning geometry can be constrained to cells
// confirmed inside the polygon, instead of a rectangle fit + after-the-fact
// clip. Pure functions, Frame L (local-fit metres, same frame
// siteToLocalPolygon/bubbleLayout.js already operate in) in and out — cell
// indices (Frame G) are an internal implementation detail, never exposed to
// callers. Same "shared metres-space math" pattern as siteFit.js.
import { pointInPolygon } from './siteFit';

export const GRID_CELL = 0.5; // metres — user-specified resolution
export const BOUNDARY_SETBACK_M = 1.5; // metres — user-specified internal offset from the true site edge

// Centroid-shrink polygon inset (ported from masterplanGenerator.js's
// buildInsetGridPoly, metres-space instead of grid-cell-space) — moves each
// vertex toward the polygon's centroid by `insetMetres`. Concave-safe (no
// self-intersection spikes the way naive edge-normal offsetting can
// produce on reflex/concave corners).
//
// This is why rasterizing the TRUE boundary directly is not enough on its
// own: a cell's CENTRE can be confirmed inside the real polygon while the
// cell's own half-cell-wide extent still pokes past the boundary if the
// edge cuts diagonally through that cell — verified directly against a real
// 45-vertex site (id 556): every rasterized cell's centre was genuinely
// inside, yet 5 of 6 zone boxes built from those cells still had corners
// outside the TRUE polygon. Rasterizing this INSET polygon instead keeps
// every buildable cell — and therefore every box built from them — clear of
// the true edge by the full setback, confirmed corner-by-corner against the
// real polygon with zero violations after switching to it.
// NOTE on concave/degenerate sites: centroid-shrink is only well-behaved
// while the polygon is wider than the inset everywhere. Real GLA plots are
// not — measured across the curated set, site 888's narrowest internal neck
// is 0.79m and 1369's is 1.21m, both BELOW the 1.5m setback (these are
// near-duplicate-edge slivers in the source geometry, not real buildable
// land). At such a neck the shrunk ring folds over itself, and the folded
// region rasterizes as "inside" even though it is outside the true plot.
// That is not fixable at the vertex level (tried: clamping shrunk vertices
// back inside made site 1369 strictly worse, 48 -> 58 violations, because
// the fold is a property of the ring as a whole, not of individual
// vertices). It is handled instead in rasterizeSitePolygon, which validates
// every cell against the TRUE polygon as well — see there.
export function insetPolygon(poly, insetMetres) {
  if (!poly || poly.length < 3) return poly;
  let cx = 0, cz = 0;
  for (const p of poly) { cx += p.x; cz += p.z; }
  cx /= poly.length; cz /= poly.length;
  return poly.map(p => {
    const dx = cx - p.x, dz = cz - p.z;
    const dist = Math.hypot(dx, dz) || 1;
    const t = Math.min(1, insetMetres / dist);
    return { x: p.x + dx * t, z: p.z + dz * t };
  });
}

// Rasterize a Frame-L polygon into a buildable grid.
// Returns { cols, rows, gx0, gz0, cellSize, buildable: Uint8Array }
//
// `truePoly` (optional but always passed by the live pipeline) is the
// UN-inset polygon. A cell counts as buildable only if BOTH hold:
//   1. its centre is inside `localPoly` (the inset ring) — the setback rule;
//   2. all four of its corners are inside `truePoly` — the hard guarantee.
//
// (2) is what makes the guarantee unconditional. Testing the inset ring
// alone is only sound while that ring is valid, and on real plots it is not:
// where the site pinches narrower than the setback (site 888: 0.79m neck,
// 1369: 1.21m, vs a 1.5m setback) the shrunk ring folds over itself and the
// folded lobe rasterizes as "inside" while sitting outside the true plot.
// Those two sites were the only ones still leaking boxes past the boundary,
// and this check is what removes the leak. Testing corners rather than the
// centre also closes the older half-cell overhang case, where a boundary
// cutting diagonally through a cell left the centre inside but up to half
// the cell outside.
export function rasterizeSitePolygon(localPoly, cellSize = GRID_CELL, truePoly = null) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of localPoly) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
  }
  // Pad by one cell so boundary-hugging cells aren't clipped by the bbox edge.
  const gx0 = minX - cellSize, gz0 = minZ - cellSize;
  const cols = Math.max(1, Math.ceil((maxX - minX + 2 * cellSize) / cellSize));
  const rows = Math.max(1, Math.ceil((maxZ - minZ + 2 * cellSize) / cellSize));

  const half = cellSize / 2;
  const buildable = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    const cz = gz0 + (r + 0.5) * cellSize;
    for (let c = 0; c < cols; c++) {
      const cx = gx0 + (c + 0.5) * cellSize;
      if (!pointInPolygon(cx, cz, localPoly)) continue;
      if (truePoly && !(
        pointInPolygon(cx - half, cz - half, truePoly) &&
        pointInPolygon(cx + half, cz - half, truePoly) &&
        pointInPolygon(cx - half, cz + half, truePoly) &&
        pointInPolygon(cx + half, cz + half, truePoly)
      )) continue;
      buildable[r * cols + c] = 1;
    }
  }

  return { cols, rows, gx0, gz0, cellSize, buildable };
}

// col,row -> Frame L cell-centre {x,z}
export function cellCentre(grid, c, r) {
  return {
    x: grid.gx0 + (c + 0.5) * grid.cellSize,
    z: grid.gz0 + (r + 0.5) * grid.cellSize,
  };
}

// Frame L {x,z} -> col,row (clamped to grid bounds)
export function pointToCell(grid, x, z) {
  const c = Math.min(grid.cols - 1, Math.max(0, Math.floor((x - grid.gx0) / grid.cellSize)));
  const r = Math.min(grid.rows - 1, Math.max(0, Math.floor((z - grid.gz0) / grid.cellSize)));
  return { c, r };
}

// Shrink a Frame-L box (x0,x1,z0,z1) to the bounding extent of only the
// BUILDABLE cells that fall within it — the hard-boundary safety net: a box
// generated by any upstream approximation (e.g. bubbleLayout.js's soft
// containment-force relaxation) can never render outside the real polygon
// after this, because its result is built purely from confirmed-inside
// cells. Returns null if the box has no buildable cells at all (fully
// outside the site) — callers should drop the box in that case.
export function clipBoxToBuildableBounds(grid, box) {
  const { c: c0, r: r0 } = pointToCell(grid, box.x0, box.z0);
  const { c: c1, r: r1 } = pointToCell(grid, box.x1, box.z1);
  const cLo = Math.min(c0, c1), cHi = Math.max(c0, c1);
  const rLo = Math.min(r0, r1), rHi = Math.max(r0, r1);

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  let found = false;
  for (let r = rLo; r <= rHi; r++) {
    for (let c = cLo; c <= cHi; c++) {
      if (!grid.buildable[r * grid.cols + c]) continue;
      found = true;
      const { x, z } = cellCentre(grid, c, r);
      const half = grid.cellSize / 2;
      if (x - half < minX) minX = x - half;
      if (x + half > maxX) maxX = x + half;
      if (z - half < minZ) minZ = z - half;
      if (z + half > maxZ) maxZ = z + half;
    }
  }
  if (!found) return null;
  return { ...box, x0: minX, x1: maxX, z0: minZ, z1: maxZ };
}

// Keep only the LARGEST connected region of buildable cells, clearing the
// rest. 4-connected flood fill over the grid.
//
// Real plots are often a main body plus one or more long thin tails (site
// 1369 is a ~1,600m² lobe with a few-metres-wide arm running ~50m off it;
// after the 1.5m setback that arm survives as a narrow, barely-connected
// ribbon of cells). assignCellsToZones hands EVERY buildable cell to its
// nearest node, so those stranded cells became real rendered boxes — a
// detached block and a lone services box floating in the arm, visually
// disconnected from the building. That is debris, not architecture: a
// building does not teleport 40m up a strip of leftover land.
//
// Restricting the grid to its largest component also raises footprint fill,
// because the zone nodes then compete for one contiguous area instead of
// scattering across disjoint patches.
export function largestConnectedRegion(grid) {
  const { cols, rows, buildable } = grid;
  const label = new Int32Array(cols * rows).fill(-1);
  const stack = [];
  let bestId = -1, bestSize = 0, next = 0;

  for (let start = 0; start < buildable.length; start++) {
    if (!buildable[start] || label[start] !== -1) continue;
    const id = next++;
    let size = 0;
    stack.push(start);
    label[start] = id;
    while (stack.length) {
      const idx = stack.pop();
      size++;
      const c = idx % cols, r = (idx - c) / cols;
      if (c > 0)        { const n = idx - 1;    if (buildable[n] && label[n] === -1) { label[n] = id; stack.push(n); } }
      if (c < cols - 1) { const n = idx + 1;    if (buildable[n] && label[n] === -1) { label[n] = id; stack.push(n); } }
      if (r > 0)        { const n = idx - cols; if (buildable[n] && label[n] === -1) { label[n] = id; stack.push(n); } }
      if (r < rows - 1) { const n = idx + cols; if (buildable[n] && label[n] === -1) { label[n] = id; stack.push(n); } }
    }
    if (size > bestSize) { bestSize = size; bestId = id; }
  }

  if (bestId < 0) return grid;
  const kept = new Uint8Array(cols * rows);
  for (let i = 0; i < kept.length; i++) if (label[i] === bestId) kept[i] = 1;
  return { ...grid, buildable: kept };
}

// Assign each BUILDABLE cell to its nearest graph node (nearest-node Voronoi
// over the real polygon's cell set) — this is the actual fix for
// clipBoxToBuildableBounds's remaining gap: bounding-boxing a node's nearby
// cells can still span a concave notch/gap between two disjoint buildable
// patches, even though every individual cell was valid. Assigning cells
// directly (then decomposing per-zone contiguous regions into rectangles,
// see cellsToBoxes) means a zone's final shape is built ONLY from cells that
// are actually inside the polygon and actually near that zone — never a
// rectangle spanning a gap. Returns Int16Array of node index per cell (-1
// for non-buildable OR out of every node's reach).
//
// REACH LIMIT: a plain nearest-node Voronoi has no maximum distance, so on a
// plot with a long thin tail (site 1369 has a few-metres-wide arm running
// ~50m off its main lobe) cells far up that tail were still handed to
// whichever node happened to be closest, and cellsToBoxes turned those
// stranded patches into real rendered boxes — a block and a lone services box
// floating up the arm, visually detached from the building. Note this is NOT
// a connectivity problem: measured on 1369, the buildable grid is a SINGLE
// connected component (5,816 of 5,816 cells), so a largest-component filter
// correctly does nothing. The cells are reachable, just absurdly far from the
// zone that claimed them.
//
// Each node already carries a `radius` sized from its real programme area
// (bubbleLayout.seedPositions: sqrt(area/PI)), so that radius is the honest
// reach: a zone may claim somewhat beyond its nominal circle to fill the plot
// snugly, but not arbitrarily far. REACH_FACTOR is the allowance.
// AREA BUDGET: each node may also carry `targetArea` (m², from the real GLB
// programme — see glbProgramme/areaHints). When present, a zone stops
// claiming cells once it has spent its budget, so total built area reflects
// the building that was actually measured instead of however much land the
// site happens to offer.
//
// This matters because a plain Voronoi partitions the ENTIRE buildable grid:
// every cell goes to someone, so the massing always swelled to fill the whole
// plot no matter what the real programme contained. Measured on site 643
// (Kensington): the medium GLB's real ground floor is 951 m², but the
// rendered ground floor came out at 8,661 m² on a 3,478 m² site — 9x the real
// programme and 2.4x the entire plot, which is impossible for a ground floor.
// It also crushed the green:units ratio to 3%, because units simply absorbed
// everything within reach.
//
// Cells are therefore allocated nearest-first (by distance to the claiming
// node) rather than in raster order, so each zone grows outward from its own
// centre and spends its budget on the land closest to it — which keeps zones
// compact and contiguous instead of scattering.
const REACH_FACTOR = 2.2;
// `reachFactor` override: for a NESTED pass on an already-masked sub-grid
// (MassingStage.jsx's per-wing bed-group split), the mask itself is already
// the hard containment — every candidate cell is already confirmed to
// belong to this wing, so an honest-reach limit derived from each small
// bed-group node's own radius serves no safety purpose there, only starves
// cells that are legitimately this wing's land but happen to sit further
// from any one bed-group node than that node's own (much smaller than the
// wing's) radius reaches. Verified live: without a much larger reachFactor,
// the nested split on site 888 captured only 46-56% of each wing's own
// already-claimed area — the rest went unclaimed (owner=-1) purely because
// no bed-group node could reach it, not because the land wasn't real.
export function assignCellsToZones(grid, nodes, reachFactor = REACH_FACTOR) {
  const owner = new Int16Array(grid.cols * grid.rows).fill(-1);
  const reach = nodes.map(n => Math.max(6, (n.radius || 6) * reachFactor));
  const cellArea = grid.cellSize * grid.cellSize;
  // Budget in CELLS. No targetArea -> unlimited (previous behaviour), so this
  // stays backward-compatible for any caller that has no real programme data.
  const budget = nodes.map(n => (n.targetArea > 0 ? Math.max(1, Math.round(n.targetArea / cellArea)) : Infinity));

  // Build the candidate list: every buildable cell, paired with EVERY
  // in-reach node (nearest first), not just the single nearest one.
  //
  // A cell whose nearest node has already filled its budget by the time
  // the cell's turn comes up (processing is nearest-first, see below) used
  // to be abandoned outright, even when a second zone right next door was
  // still well within reach and had room to spare. That rarely showed up
  // at the TOP level (zones there usually have generous budget headroom
  // below the whole site's land), but it starved 25-30% of real cells on
  // MassingStage.jsx's NESTED per-wing bed-group pass — where 4 zones'
  // budgets sum EXACTLY to the available land, so even a slight nearest
  // -node imbalance orphans real, reachable cells for no reason. Falling
  // through to the next-nearest zone with room fixes both passes at once
  // and can only ever claim MORE real cells, never fewer.
  const claims = [];
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const idx = r * grid.cols + c;
      if (!grid.buildable[idx]) continue;
      const { x, z } = cellCentre(grid, c, r);
      const inReach = [];
      for (let n = 0; n < nodes.length; n++) {
        const d = Math.hypot(nodes[n].x - x, nodes[n].z - z);
        if (d > reach[n]) continue; // out of this zone's honest reach
        inReach.push({ n, d });
      }
      if (!inReach.length) continue;
      inReach.sort((a, b) => a.d - b.d);
      claims.push({ idx, candidates: inReach, d: inReach[0].d });
    }
  }
  // Nearest-first (by each cell's OWN nearest candidate) so each zone still
  // spends its budget on its own closest land first, same as before.
  claims.sort((a, b) => a.d - b.d);

  const spent = new Int32Array(nodes.length);
  for (const { idx, candidates } of claims) {
    for (const { n } of candidates) {
      if (spent[n] >= budget[n]) continue; // this zone is full — try the next-nearest
      owner[idx] = n;
      spent[n]++;
      break;
    }
  }
  return owner;
}

// Largest all-true axis-aligned rectangle in a boolean grid region (classic
// "maximal rectangle in binary matrix" via per-row histogram + monotonic
// stack) — O(cols*rows). `mask(c,r)` returns true if that cell counts.
function largestRectangle(cols, rows, mask) {
  const heights = new Int32Array(cols);
  let best = null;
  const candidates = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      heights[c] = mask(c, r) ? heights[c] + 1 : 0;
    }
    // Largest rectangle in this row's histogram.
    const stack = []; // indices, increasing height
    for (let c = 0; c <= cols; c++) {
      const h = c < cols ? heights[c] : 0;
      while (stack.length && heights[stack[stack.length - 1]] >= h) {
        const top = stack.pop();
        const height = heights[top];
        const left = stack.length ? stack[stack.length - 1] + 1 : 0;
        const width = c - left;
        const area = height * width;
        const rect = { area, c0: left, c1: c - 1, r0: r - height + 1, r1: r };
        if (!best || area > best.area) best = rect;
        candidates.push(rect);
      }
      stack.push(c);
    }
  }
  if (!best) return null;
  // Among rectangles within 15% of the true max area, keep the SQUAREST one
  // instead of the raw largest. Pure max-area picks the same elongated strip
  // every time a claimed region is itself elongated (which per-wing bed-group
  // regions routinely are), and dwellings.js's sliceBox can only place a real
  // typology inside a band whose aspect stays under MAX_DWELLING_ASPECT — an
  // elongated box wastes far more of itself as untyped leftover than a
  // near-square box of the same area. A bounded 15% area concession here
  // recovers real usable floorplate downstream at essentially no size cost.
  let squarest = best, squarestAspect = Infinity;
  for (const r of candidates) {
    if (r.area < best.area * 0.85) continue;
    const w = r.c1 - r.c0 + 1, h = r.r1 - r.r0 + 1;
    const aspect = Math.max(w, h) / Math.min(w, h);
    if (aspect < squarestAspect) { squarestAspect = aspect; squarest = r; }
  }
  return squarest;
}

// Decompose one zone's assigned cells into up to `maxRects` axis-aligned
// rectangles (Frame L metres), largest-first, so a concave/fragmented
// region becomes a handful of real render-able boxes instead of one
// bounding rectangle that spans gaps. Small leftover slivers (< minCells)
// are discarded — not worth a box, same "noise not signal" reasoning
// clusterResidential/splitGreenPockets used in the old ZoningPlan.jsx.
// maxRects raised from 3->5 and minCells lowered from 4->2 (0.5m² instead
// of 1m²) — the seam between two zones' Voronoi regions (assignCellsToZones)
// is exactly where a small 3-rect/4-cell-min budget leaves a visible gap
// neither zone claims; more, smaller allowed rectangles close that without
// changing the hard-boundary guarantee (every cell is still individually
// confirmed buildable+assigned before it can become part of a box).
//
// minCells is now a REAL-BUILDING floor, not a numerical one. At 0.5m cells,
// the previous minCells=2 allowed a 0.5m² rectangle to render as a block —
// architecturally meaningless, and exactly the kind of speck that reads as
// debris scattered around the plot. 80 cells = 20m², roughly the smallest
// footprint that can honestly represent built form at this scale.
export function cellsToBoxes(grid, owner, nodeIndex, maxRects = 5, minCells = 80) {
  const taken = new Uint8Array(grid.cols * grid.rows);
  const boxes = [];
  for (let i = 0; i < maxRects; i++) {
    const rect = largestRectangle(grid.cols, grid.rows, (c, r) => {
      const idx = r * grid.cols + c;
      return owner[idx] === nodeIndex && !taken[idx];
    });
    if (!rect || rect.area < minCells) break;
    for (let r = rect.r0; r <= rect.r1; r++) {
      for (let c = rect.c0; c <= rect.c1; c++) taken[r * grid.cols + c] = 1;
    }
    const a = cellCentre(grid, rect.c0, rect.r0);
    const b = cellCentre(grid, rect.c1, rect.r1);
    const half = grid.cellSize / 2;
    boxes.push({
      x0: Math.min(a.x, b.x) - half, x1: Math.max(a.x, b.x) + half,
      z0: Math.min(a.z, b.z) - half, z1: Math.max(a.z, b.z) + half,
    });
  }
  return boxes;
}

// Re-clip an ARBITRARY Frame-L box back onto the buildable grid, returning
// the real in-boundary rectangles that cover it (0..maxRects of them, empty
// if the box lies entirely outside the site).
//
// Why this exists separately from cellsToBoxes: cellsToBoxes only runs at
// LAYOUT time, over cells a zone node actually owns. But the massing
// iterations (generateMassingIterations) then TRANSLATE and SPLIT those
// already-clipped boxes — perturbFloors offsets them, splitUnitBlocks pushes
// two halves apart — with no clip afterward, so any iteration except #0
// could shove a box back across the boundary. That is exactly what put
// blocks visibly outside the site outline. This re-runs the same
// maximal-rectangle decomposition, but masked to the moved box's own cell
// window, so the result is still built only from confirmed-buildable cells
// and still never spans a concave gap (a plain bounding-box shrink would).
//
// Kept deliberately cheap: the mask is restricted to the box's cell window,
// so cost scales with the box, not the whole grid.
export function clipBoxToGrid(grid, box, maxRects = 3, minCells = 2) {
  const { c: ca, r: ra } = pointToCell(grid, box.x0, box.z0);
  const { c: cb, r: rb } = pointToCell(grid, box.x1, box.z1);
  const cLo = Math.min(ca, cb), cHi = Math.max(ca, cb);
  const rLo = Math.min(ra, rb), rHi = Math.max(ra, rb);

  // A box that's already fully inside the buildable area needs no clipping
  // at all — return it untouched instead of re-snapping it onto the grid.
  // Re-snapping ALWAYS rebuilds x0/x1/z0/z1 from cell centres regardless of
  // whether anything actually needed trimming, and it does so per box with
  // no knowledge of its neighbours: two boxes sharing a real boundary that
  // doesn't land exactly on a 0.5m grid line each round outward to their
  // OWN nearest cell edge, so both claim the same boundary cell and end up
  // overlapping by up to a full cell width. That was happening to almost
  // every box on every floor (not just the rare one actually crossing the
  // site edge), since this used to run unconditionally on all of them —
  // the real, measured cause of the "boxes drive into each other" overlap.
  let fullyInside = true;
  for (let r = rLo; r <= rHi && fullyInside; r++) {
    for (let c = cLo; c <= cHi; c++) {
      if (!grid.buildable[r * grid.cols + c]) { fullyInside = false; break; }
    }
  }
  if (fullyInside) return [box];

  const taken = new Uint8Array(grid.cols * grid.rows);
  const inWindow = (c, r) => c >= cLo && c <= cHi && r >= rLo && r <= rHi;
  const out = [];
  for (let i = 0; i < maxRects; i++) {
    const rect = largestRectangle(grid.cols, grid.rows, (c, r) => {
      if (!inWindow(c, r)) return false;
      const idx = r * grid.cols + c;
      return !!grid.buildable[idx] && !taken[idx];
    });
    if (!rect || rect.area < minCells) break;
    for (let r = rect.r0; r <= rect.r1; r++) {
      for (let c = rect.c0; c <= rect.c1; c++) taken[r * grid.cols + c] = 1;
    }
    const a = cellCentre(grid, rect.c0, rect.r0);
    const b = cellCentre(grid, rect.c1, rect.r1);
    const half = grid.cellSize / 2;
    out.push({
      ...box,
      x0: Math.min(a.x, b.x) - half, x1: Math.max(a.x, b.x) + half,
      z0: Math.min(a.z, b.z) - half, z1: Math.max(a.z, b.z) + half,
    });
  }
  return out;
}
