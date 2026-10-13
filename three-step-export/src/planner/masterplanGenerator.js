// Pure algorithmic masterplan generator — no React, no Three.js
// generateMasterplan(siteBounds, seed, sitePolygon?) → MasterplanData
//
// DESIGN PHILOSOPHY (BIG / Bjarke Ingels style):
//   Massing is derived FROM the site shape.
//   Buildings cluster into mountain-like groups that terrace and step,
//   with a public valley / courtyard carved through the centre.
//   Perimeter follows site edges; towers anchor corners; terraces cascade inward.

const CELL    = 2.0;   // metres per grid cell
const SETBACK = 2;     // cells = 4 m min from grid boundary (relaxed — inset poly is the real guard)

// ─── Seeded RNG — Mulberry32 ──────────────────────────────────────
function seededRng(seed) {
  let s = (seed >>> 0) + 0x6D2B79F5;
  return () => {
    s = Math.imul(s ^ (s >>> 15), s | 1);
    s ^= s + Math.imul(s ^ (s >>> 7), s | 61);
    return ((s ^ (s >>> 14)) >>> 0) / 4294967296;
  };
}

// Check if a grid cell (in grid coords) is inside a polygon defined in grid coords
function cellInsideGridPoly(c, r, gpoly) {
  if (!gpoly || gpoly.length < 3) return true;
  // check centre only — faster, still safe when used with inset
  return pointInPolyGrid((c + 0.5), (r + 0.5), gpoly);
}

function pointInPolyGrid(px, pz, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, zi = poly[i].z;
    const xj = poly[j].x, zj = poly[j].z;
    const intersect = ((zi > pz) !== (zj > pz)) &&
      (px < (xj - xi) * (pz - zi) / (zj - zi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function footprintInsideGridPoly(c, r, w, d, gpoly) {
  if (!gpoly) return true;
  // Centre must be inside; at least 3 of 4 corners must be inside.
  // Lenient check prevents over-clipping on narrow/irregular sites.
  const cx = c + w / 2, cz = r + d / 2;
  if (!pointInPolyGrid(cx, cz, gpoly)) return false;
  const corners = [
    [c,     r    ], [c + w, r    ],
    [c,     r + d], [c + w, r + d],
  ];
  const inside = corners.filter(([px, pz]) => pointInPolyGrid(px, pz, gpoly)).length;
  return inside >= 3;
}

// ─── Typologies ───────────────────────────────────────────────────
export const TYPOLOGIES = [
  { id: '1b1p', label: '1B · 1P', beds: 1, gridX: 3, gridZ: 2, areaM2: 28,  glb: '/ROOM1.glb' },
  { id: '1b2p', label: '1B · 2P', beds: 1, gridX: 4, gridZ: 2, areaM2: 38,  glb: '/ROOM2.glb' },
  { id: '2b3p', label: '2B · 3P', beds: 2, gridX: 4, gridZ: 3, areaM2: 56,  glb: '/ROOM3.glb' },
  { id: '2b4p', label: '2B · 4P', beds: 2, gridX: 5, gridZ: 3, areaM2: 64,  glb: '/ROOM4.glb' },
  { id: '3b4p', label: '3B · 4P', beds: 3, gridX: 5, gridZ: 4, areaM2: 80,  glb: '/ROOM5.glb' },
  { id: '3b5p', label: '3B · 5P', beds: 3, gridX: 6, gridZ: 4, areaM2: 88,  glb: '/ROOM6.glb' },
  { id: '4b5p', label: '4B · 5P', beds: 4, gridX: 6, gridZ: 5, areaM2: 108, glb: '/ROOM7.glb' },
  { id: '4b8p', label: '4B · 8P', beds: 4, gridX: 8, gridZ: 5, areaM2: 140, glb: '/ROOM8.glb' },
];
export const TYPOLOGY_MAP = Object.fromEntries(TYPOLOGIES.map(t => [t.id, t]));
export const BED_COLORS = { 1: '#5b8fd4', 2: '#5bbf7a', 3: '#e8a94a', 4: '#d46b6b' };

// ─── Per-concept unit-mix character ────────────────────────────────
// Without this, buildBuilding() picked a typology uniformly at random for
// every unit regardless of concept — every one of the 9 massing styles
// produced statistically the same unit mix, so "Pixel Towers" (MVRDV
// discrete towers) looked architecturally distinct but read identically to
// "Courtyard Block" (family perimeter housing) in unit composition. These
// weights (index-aligned with TYPOLOGIES, relative not normalised) bias the
// random pick toward each concept's real identity. guaranteeAllTypologies()
// still runs afterward and enforces a floor/cap per typology, so this never
// produces a monoculture — it shifts the centre of the distribution, which
// is what "unique iterations per concept" actually requires.
const CONCEPT_TYPOLOGY_WEIGHTS = {
  // Perimeter urban block, family housing — skew toward 2B–4B family units.
  courtyard_block:   [1, 1.5, 2.5, 2.5, 2, 2, 1.5, 1],
  // Linear slabs flanking a green datum — balanced, mild mid-size skew.
  green_spine:        [1.2, 1.5, 2, 2, 1.5, 1.2, 1, 0.8],
  // OMA shifting-programme superblocks — full spread, no strong skew.
  superblock_grid:    [1, 1, 1, 1, 1, 1, 1, 1],
  // Civic/diverse — balanced.
  radial_park:        [1, 1.2, 1.5, 1.5, 1.5, 1.2, 1, 1],
  // BIG stepped mountain — varied, slight skew to larger family units on
  // the lower, wider tiers.
  mountain_cascade:   [0.8, 1, 1.5, 1.5, 2, 1.5, 1.5, 1.2],
  // MVRDV discrete pixel towers — compact units only; towers don't carry
  // big family floorplates.
  pixel_towers:       [2.5, 2.5, 2, 1.2, 0.8, 0.5, 0.3, 0.2],
  // Zaha continuous bar — mid-size units that work in a narrow elongated
  // slab (1–2 bed, some 2B4P), few large sprawling 4-bed units.
  linear_datum:       [1.5, 2, 2.5, 1.5, 1, 0.6, 0.4, 0.3],
  // Steven Holl dense interstitial fabric — small-to-mid units, dense packing.
  void_interstitial:  [2, 2, 1.5, 1.2, 1, 0.6, 0.4, 0.3],
  // Lifted pavilions are individually tiny (~12-20m modules) — only small
  // units fit; reinforces what's already naturally true of the footprint.
  treehouse_cluster:  [2.5, 2.5, 1.5, 1, 0.6, 0.4, 0.2, 0.2],
};

function pickWeightedTypology(rng, concept, candidates = TYPOLOGIES) {
  const weights = concept && CONCEPT_TYPOLOGY_WEIGHTS[concept];
  if (!weights) return candidates[Math.floor(rng() * candidates.length)];
  const weighted = candidates.map(t => ({ t, w: weights[TYPOLOGIES.indexOf(t)] ?? 1 }));
  const total = weighted.reduce((s, x) => s + x.w, 0);
  let r = rng() * total;
  for (const { t, w } of weighted) {
    r -= w;
    if (r <= 0) return t;
  }
  return weighted[weighted.length - 1].t;
}

// ─── Tile a floor's real footprint with real, unscaled rooms ──────
// Previously each floor of a slab was recorded as ONE "unit" the size of
// the entire slab, tagged with a random typology label purely for stats —
// the GLB viewer then scaled that typology's actual room model to fill
// whatever footprint it landed on, visibly stretching/squashing rooms that
// have a fixed real-world size. This tiles the real sw×sd footprint with
// rooms placed at their NATIVE gridX×gridZ size (in whichever orientation
// fits), shelf-packed row by row. Leftover space too small for any
// typology stays empty (circulation/core), which is the honest result —
// not another stretched unit forced to cover it.
function tileFloorWithUnits(sw, sd, rng, concept) {
  const placed = [];
  const sorted = TYPOLOGIES.slice().sort((a, b) => (b.gridX * b.gridZ) - (a.gridX * a.gridZ));

  let rowOff = 0;
  while (rowOff < sd) {
    const remD = sd - rowOff;
    // Typologies (either orientation) that fit the remaining row depth.
    const rowFits = sorted.filter(t =>
      (t.gridZ <= remD && t.gridX <= sw) || (t.gridX <= remD && t.gridZ <= sw));
    if (!rowFits.length) break; // strip too shallow for even the smallest typology

    // Row height = the tallest candidate's footprint that still fits, so
    // each shelf is sized to what's actually being placed in it rather
    // than an arbitrary slice.
    const rowHeights = rowFits.map(t => Math.min(remD, Math.max(
      t.gridZ <= remD ? t.gridZ : 0, t.gridX <= remD ? t.gridX : 0)));
    const rowD = Math.max(...rowHeights);

    let colOff = 0;
    while (colOff < sw) {
      const remW = sw - colOff;
      const fits = rowFits.filter(t =>
        (t.gridX <= remW && t.gridZ <= rowD) || (t.gridZ <= remW && t.gridX <= rowD));
      if (!fits.length) break; // remaining strip width too narrow — leave as gap

      const typo = pickWeightedTypology(rng, concept, fits);
      const fitsNormal = typo.gridX <= remW && typo.gridZ <= rowD;
      const uw = fitsNormal ? typo.gridX : typo.gridZ;
      const ud = fitsNormal ? typo.gridZ : typo.gridX;
      placed.push({ typo, xOff: colOff, zOff: rowOff, w: uw, d: ud });
      colOff += uw;
    }
    rowOff += rowD;
  }
  return placed;
}

// ─── Build inset polygon in GRID coordinates ──────────────────────
// Uses centroid-shrink: each vertex moves toward the centroid by insetCells.
// This is O(n), always produces a valid polygon, and handles concave/irregular
// shapes correctly — unlike normal-offset which produces spikes at concave corners.
function buildInsetGridPoly(normPoly, cols, rows, insetCells) {
  if (!normPoly || normPoly.length < 3) return null;

  const gp = normPoly.map(p => ({ x: p.x * cols, z: p.z * rows }));

  let cx = 0, cz = 0;
  gp.forEach(p => { cx += p.x; cz += p.z; });
  cx /= gp.length; cz /= gp.length;

  return gp.map(p => {
    const dx = p.x - cx, dz = p.z - cz;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-9) return { x: cx, z: cz };
    const t = Math.max(0, (dist - insetCells) / dist);
    return { x: cx + dx * t, z: cz + dz * t };
  });
}

// ─── Site shape analysis ──────────────────────────────────────────
function analyseSite(normPoly, cols, rows) {
  if (!normPoly || normPoly.length < 3) {
    return { elongation: 1, axisAngle: 0, cos: 1, sin: 0,
             centroidX: cols * 0.5, centroidZ: rows * 0.5,
             shapeType: 'rectangle', concept: 'mountain_valley', cornerNodes: [],
             spanAlong: cols, spanPerp: rows, minAlong: 0, maxAlong: cols, minPerp: 0, maxPerp: rows };
  }

  // Convert to grid coords
  const poly = normPoly.map(p => ({ x: p.x * cols, z: p.z * rows }));

  let cx = 0, cz = 0;
  poly.forEach(p => { cx += p.x; cz += p.z; });
  cx /= poly.length; cz /= poly.length;

  // Principal axis via covariance
  let xx = 0, xz = 0, zz = 0;
  poly.forEach(p => {
    const dx = p.x - cx, dz = p.z - cz;
    xx += dx * dx; xz += dx * dz; zz += dz * dz;
  });
  const axisAngle = 0.5 * Math.atan2(2 * xz, xx - zz);

  // Elongation
  let maxAlong = -Infinity, minAlong = Infinity, maxPerp = -Infinity, minPerp = Infinity;
  const cos = Math.cos(axisAngle), sin = Math.sin(axisAngle);
  poly.forEach(p => {
    const dx = p.x - cx, dz = p.z - cz;
    const along = dx * cos + dz * sin;
    const perp  = -dx * sin + dz * cos;
    if (along > maxAlong) maxAlong = along; if (along < minAlong) minAlong = along;
    if (perp  > maxPerp)  maxPerp  = perp;  if (perp  < minPerp)  minPerp  = perp;
  });
  const spanAlong = maxAlong - minAlong;
  const spanPerp  = maxPerp  - minPerp;
  const elongation = spanAlong / Math.max(spanPerp, 0.01);

  // Corner nodes
  const cornerNodes = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[(i - 1 + n) % n], b = poly[i], c2 = poly[(i + 1) % n];
    const v1x = a.x - b.x, v1z = a.z - b.z;
    const v2x = c2.x - b.x, v2z = c2.z - b.z;
    const len1 = Math.hypot(v1x, v1z), len2 = Math.hypot(v2x, v2z);
    if (len1 < 0.01 || len2 < 0.01) continue;
    const dot = (v1x * v2x + v1z * v2z) / (len1 * len2);
    const angleDeg = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;
    if (angleDeg < 135) cornerNodes.push({ x: b.x, z: b.z, angle: angleDeg });
  }

  return {
    elongation, axisAngle, cos, sin,
    centroidX: cx, centroidZ: cz,
    shapeType: elongation > 1.7 ? 'elongated' : (poly.length <= 5 ? 'compact' : 'irregular'),
    concept: 'mountain_valley',
    cornerNodes,
    spanAlong, spanPerp,
    minAlong, maxAlong, minPerp, maxPerp,
  };
}

// ─── Concept strategies — each informed by a legendary architect ──
// 0 courtyard_block  → H&dM / Aldo Rossi: urban perimeter block, void at centre
// 1 green_spine      → Renzo Piano: thin linear slabs flanking a green datum
// 2 superblock_grid  → OMA/Koolhaas: programmatic superblocks, shifting heights
// 3 radial_park      → Oscar Niemeyer: radiating arms from a civic heart
// 4 mountain_cascade → BIG/Ingels: V8 House stepped section, roofscape as landscape
// 5 pixel_towers     → MVRDV: discrete tower pixels, varied height, dense courtyard
// 6 linear_datum     → Zaha Hadid: continuous flowing bar, fractured at intervals
// 7 void_interstitial → Steven Holl: positive/negative, buildings defined by the gaps
// 8 treehouse_cluster → lifted pavilions on tapered tree-columns, running-bond offset,
//                        arched balcony bands, flared canopy roofs (reference: glbforaggregation/)
export const CONCEPTS = [
  'courtyard_block',
  'green_spine',
  'superblock_grid',
  'radial_park',
  'mountain_cascade',
  'pixel_towers',
  'linear_datum',
  'void_interstitial',
  'treehouse_cluster',
];

export const CONCEPT_LABELS = {
  courtyard_block:    'Courtyard Block',
  green_spine:        'Green Spine',
  superblock_grid:    'Superblock Grid',
  radial_park:        'Radial Park',
  mountain_cascade:   'Mountain Cascade',
  pixel_towers:       'Pixel Towers',
  linear_datum:       'Linear Datum',
  void_interstitial:  'Void Interstitial',
  treehouse_cluster:  'Treehouse Cluster',
};

// Seed-deterministic concept pick — same seed always yields the same concept
// unless options.concept overrides it in generateMasterplan.
function conceptIndex(seed) {
  const rng = seededRng(seed * 997 + 13);
  rng(); rng();
  return Math.floor(rng() * CONCEPTS.length);
}

// NOTE: signature is (seed) only — sitePolygon/siteBounds args were unused
// by the previous implementation and no call site passed them meaningfully,
// so this matches the original 8-concept system's signature.
export function conceptLabel(seed) {
  return CONCEPT_LABELS[CONCEPTS[conceptIndex(seed)]];
}

// ─── Solar orientation helpers ────────────────────────────────────
// solarAzimuth: degrees clockwise from north (0=N, 90=E, 180=S, 270=W)
// Returns a rotation that spins buildings so their long axis is perpendicular
// to the sun direction (glazed south face catches the most sun).
export function solarAngleToGridAngle(solarAzimuth) {
  // Convert to radians measured from +Z axis (north) clockwise
  return (solarAzimuth * Math.PI) / 180;
}

// Score how "solar-good" a building rectangle is:
//   a long building with its narrow end facing the sun = better
//   (south face = max glazing perpendicular to sun rays)
// Returns 0–1 (1 = ideal south-facing)
function solarScore(col, row, w, d, centroidX, centroidZ, solarAngle) {
  // Sun comes FROM solarAngle direction, so south face should face TOWARD sun
  const sunDirX = Math.sin(solarAngle);
  const sunDirZ = Math.cos(solarAngle);
  // Building elongation axis (longest side)
  const elongX = w >= d ? 1 : 0;
  const elongZ = w >= d ? 0 : 1;
  // We want the short axis to face the sun — dot product with sun direction
  const shortX = 1 - elongX, shortZ = 1 - elongZ;
  const dot = Math.abs(shortX * sunDirX + shortZ * sunDirZ);
  return dot; // 1 = perfectly solar-oriented
}

// Compute per-cell solar exposure heatmap (0–1, higher = more sun)
// Simple proxy: cells on south side of buildings (or open sky) get more sun
function buildSolarHeatmap(cols, rows, buildings, solarAngle, buildable, ck) {
  const heat = new Float32Array(cols * rows).fill(0);
  const occ  = new Uint8Array(cols * rows);

  buildings.forEach(b => {
    for (let dc = 0; dc < b.w; dc++)
      for (let dr = 0; dr < b.d; dr++)
        occ[ck(b.col + dc, b.row + dr)] = 1;
  });

  const sunDX = Math.sin(solarAngle);
  const sunDZ = Math.cos(solarAngle);

  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      if (!buildable[ck(c, r)]) continue;
      if (occ[ck(c, r)]) {
        // Building cell: score by floor level proxy (higher floors = more sun)
        const bld = buildings.find(b =>
          c >= b.col && c < b.col + b.w && r >= b.row && r < b.row + b.d);
        heat[ck(c, r)] = bld ? Math.min(1, bld.floors / 12) : 0.5;
      } else {
        // Open cell: trace ray toward sun; if unobstructed, full sun
        let blocked = false;
        for (let step = 1; step <= 8 && !blocked; step++) {
          const sc = Math.round(c - sunDX * step);
          const sr = Math.round(r - sunDZ * step);
          if (sc < 0 || sc >= cols || sr < 0 || sr >= rows) break;
          if (occ[ck(sc, sr)]) blocked = true;
        }
        heat[ck(c, r)] = blocked ? 0.15 : 0.85;
      }
    }
  }
  return heat;
}

// ─── Road network ─────────────────────────────────────────────────
// Builds a minimal road graph connecting all buildings to site entry points.
// Entry points = midpoints of each site boundary edge.
// Roads run along grid axes; intersections are T- or +-junctions.
function buildRoadNetwork(buildings, cols, rows, buildable, ck, insetGridPoly, accessEdges = ['south','east']) {
  const roads = [];   // { col, row, type: 'road'|'parking'|'entry' }
  const roadSet = new Set();

  const mark = (c, r, type = 'road') => {
    if (c < 0 || c >= cols || r < 0 || r >= rows) return;
    const key = ck(c, r);
    if (roadSet.has(key)) return;
    roadSet.add(key);
    roads.push({ col: c, row: r, type });
  };

  // Entry points driven by site access edges from environmental analysis
  const edgeMap = {
    north: { c: Math.floor(cols / 2), r: 0 },
    south: { c: Math.floor(cols / 2), r: rows - 1 },
    west:  { c: 0,                    r: Math.floor(rows / 2) },
    east:  { c: cols - 1,             r: Math.floor(rows / 2) },
  };
  const entries = (accessEdges && accessEdges.length > 0)
    ? accessEdges.map(e => edgeMap[e]).filter(Boolean)
    : Object.values(edgeMap);

  // For each building, trace L-shaped path to nearest entry
  const buildingCentres = buildings.map(b => ({
    c: b.col + Math.floor(b.w / 2),
    r: b.row + Math.floor(b.d / 2),
    bld: b,
  }));

  // Mark entry cells
  entries.forEach(e => {
    // Walk inward from entry until we hit a buildable cell
    const dc = e.c === 0 ? 1 : e.c === cols - 1 ? -1 : 0;
    const dr = e.r === 0 ? 1 : e.r === rows - 1 ? -1 : 0;
    let cc = e.c, rr = e.r;
    for (let step = 0; step < 8; step++) {
      mark(cc, rr, 'entry');
      cc += dc; rr += dr;
      if (buildable[ck(Math.max(0, Math.min(cols-1, cc)), Math.max(0, Math.min(rows-1, rr)))]) break;
    }
    e.c = cc; e.r = rr; // update to inner end
  });

  // For each building, connect to the nearest entry via an L-shaped road
  // Road runs 1 cell outside the building footprint
  for (const { c: bc, r: br, bld } of buildingCentres) {
    // Pick nearest entry
    let best = entries[0], bestD = Infinity;
    for (const e of entries) {
      const d = Math.abs(e.c - bc) + Math.abs(e.r - br);
      if (d < bestD) { bestD = d; best = e; }
    }

    // Road starts just outside the building south face (lobby side)
    const startC = bc;
    const startR = bld.row + bld.d; // one row south of building

    // L-shaped: first go row-wise to entry row, then col-wise to entry col
    const midR = best.r;
    const step = (a, b2) => a < b2 ? 1 : -1;

    // Vertical leg
    for (let r = startR; r !== midR; r += step(r, midR)) mark(startC, r);
    // Horizontal leg
    for (let c = startC; c !== best.c; c += step(c, best.c)) mark(c, midR);

    // Parking bay: 2 cells wide, 1 deep, beside building entry
    const pC = bld.col + bld.w + 1;
    const pR = bld.row + bld.d - 1;
    if (pC < cols - 1 && pR >= 0) {
      mark(pC,     pR, 'parking');
      mark(pC + 1, pR, 'parking');
    }
  }

  // Also connect entries to each other through the site centroid
  const midC = Math.floor(cols / 2);
  const midR2 = Math.floor(rows / 2);
  for (const e of entries) {
    for (let c = Math.min(e.c, midC); c <= Math.max(e.c, midC); c++) mark(c, e.r);
    for (let r = Math.min(e.r, midR2); r <= Math.max(e.r, midR2); r++) mark(midC, r);
  }

  // Remove any road cells that land inside a building footprint
  const bldSet = new Set();
  buildings.forEach(b => {
    for (let dc = 0; dc < b.w; dc++)
      for (let dr = 0; dr < b.d; dr++)
        bldSet.add(ck(b.col + dc, b.row + dr));
  });

  return roads.filter(r => !bldSet.has(ck(r.col, r.row)));
}

// ─── Main export ──────────────────────────────────────────────────
// options.mixTargets: { [typologyId]: fraction } — null = default balance
// options.solarAzimuth: degrees (0=N, 90=E, 180=S, 270=W) — preferred south face direction
// options.siteContext: { surface, contamination, floodZone, maxFloors, railBuffer } from SEED_SITES
export function generateMasterplan(siteBounds, seed, sitePolygon = null, options = {}) {
  const { mixTargets = null, solarAzimuth = 180, windAzimuth = 225, accessEdges = ['south','east'], siteContext = null } = options;

  // ── Concept resolution ────────────────────────────────────────────
  // options.concept lets a caller force one of the 8 named massing styles;
  // otherwise pick deterministically from the seed (same seed → same concept).
  // The resolved value (not the seed-derived one) drives both placement bias
  // below AND the returned conceptLabel, so an override never desyncs label vs behaviour.
  const concept = (options.concept && CONCEPTS.includes(options.concept))
    ? options.concept
    : CONCEPTS[conceptIndex(seed)];
  const resolvedConceptLabel = CONCEPT_LABELS[concept];

  // ── Site context constraints ──────────────────────────────────────
  // These derive from real brownfield conditions and shape massing strategy.
  const ctx = siteContext || {};
  // Flood zone: add 3-cell riverside buffer (buildings pushed back from water edge)
  const floodInset   = ctx.floodZone   ? 3   : 0;
  // Rail buffer: extra setback cells on the rail-facing edge
  const railInset    = ctx.railBuffer  || 0;
  // Airpark / low-rise zone: cap floor count
  const ctxMaxFloors = ctx.maxFloors   || null;
  // Waterside: taller towers allowed on the water-facing side (view premium)
  const watersideTall = ctx.surface === 'waterside';
  // Cutting / elevated: compact footprints, no wide slabs
  const compactFootprint = (ctx.surface === 'cutting' || ctx.surface === 'elevated');
  const solarAngle = solarAngleToGridAngle(solarAzimuth);
  // Wind vector in grid space (buildings should be offset perpendicular to wind)
  const windAngleRad = (windAzimuth * Math.PI) / 180;
  const windDX = Math.sin(windAngleRad), windDZ = Math.cos(windAngleRad);

  const { widthM, depthM } = siteBounds;
  // Adaptive cell size: keep CELL=2 m for small/medium sites, but grow it on
  // very large districts so the grid never exceeds MAX_DIM cells on a side.
  // This bounds the per-cell work (classification + BFS) → no lag on 650 ha
  // sites, while metres still scale and footprints stay proportional because
  // building sizes are specified in cells and normalised against grid size.
  const MAX_DIM = 360; // cells per side cap → ≤ ~130k cells, fast
  const cellSize = Math.max(CELL, Math.max(widthM, depthM) / MAX_DIM);
  const cols = Math.max(8, Math.floor(widthM / cellSize));
  const rows = Math.max(8, Math.floor(depthM / cellSize));
  const rng  = seededRng(seed * 1000003 + 7);

  // Build inset polygon only for valley / greenspace clipping (kept at small inset)
  const INSET = 1.0 + floodInset + Math.min(railInset, 3);
  const insetGridPoly = sitePolygon ? buildInsetGridPoly(sitePolygon, cols, rows, INSET) : null;

  // Outer polygon in grid coords (for cell classification and safety clip)
  const normPolyToGrid = sitePolygon ? sitePolygon.map(p => ({ x: p.x * cols, z: p.z * rows })) : null;

  const metrics = analyseSite(sitePolygon, cols, rows);
  const { centroidX, centroidZ, axisAngle } = metrics;

  // Key lookup
  const ck = (c, r) => c * rows + r;

  // ── CELL CLASSIFICATION ───────────────────────────────────────────
  // buildable = inside the outer site polygon (boundary kept 1 cell from edge)
  const buildable = new Uint8Array(cols * rows);
  for (let c = 0; c < cols; c++)
    for (let r = 0; r < rows; r++)
      if (cellInsideGridPoly(c, r, normPolyToGrid)) {
        buildable[ck(c, r)] = 1;
      }

  // BFS: distance from non-buildable cells (= distance from boundary)
  // canPlace uses edgeDist >= 2 requirement to enforce the real setback
  const edgeDist = computeEdgeDist(cols, rows, buildable, ck);

  // Is this a small/narrow grid where oversized footprints and valleys would leave no room?
  const smallSite = Math.min(cols, rows) < 20;

  // ── SITE GEOMETRY ─────────────────────────────────────────────────
  // Principal axis defines the "mountain ridge" direction.
  // Public valley cuts diagonally across, creating two massing mountains.
  // BIG-style: buildings cluster like stepped hillsides on each side of valley.

  const occupied = new Set();

  // Mark non-buildable cells as occupied
  for (let c = 0; c < cols; c++)
    for (let r = 0; r < rows; r++)
      if (!buildable[ck(c, r)]) occupied.add(ck(c, r));

  // ── PUBLIC VALLEY / GREEN VOID — concept-dispatched ───────────────
  // Each concept carves a differently-shaped public void through the site.
  // All variants feed the same valleyCells/occupied sets so downstream code
  // (greenCells classification as 'path', building placement) is unchanged.
  const valleyCells = new Set();
  const valleyAngle = axisAngle + Math.PI / 2; // perpendicular to principal axis
  const vc = Math.cos(valleyAngle), vs = Math.sin(valleyAngle);
  const innerSpan = Math.min(cols, rows);

  // Only carve a void on sites large enough to afford it (skip on narrow grids)
  const valleyWidth = smallSite ? 0 : 2.5;

  if (valleyWidth > 0) {
    if (concept === 'mountain_cascade') {
      // BIG: diagonal valley band perpendicular to the principal axis,
      // splitting the site into two stepped "mountain" hillsides.
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          if (!buildable[ck(c, r)]) continue;
          const dx = c + 0.5 - centroidX, dz = r + 0.5 - centroidZ;
          const perpDist = Math.abs(dx * vc + dz * vs);
          if (perpDist < valleyWidth) { valleyCells.add(ck(c, r)); occupied.add(ck(c, r)); }
        }
      }
    } else if (concept === 'linear_datum') {
      // Zaha Hadid: a single continuous datum line running ALONG the
      // principal axis (not perpendicular, like mountain_cascade's valley) —
      // a flowing bar, fractured by periodic cross-gaps at intervals so it
      // reads as broken/continuous rather than one solid cut.
      const datumAngle = axisAngle;
      const dc2 = Math.cos(datumAngle), ds2 = Math.sin(datumAngle);
      const fractureSpacing = Math.max(6, innerSpan * 0.22);
      const fractureWidth = valleyWidth * 1.4;
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          if (!buildable[ck(c, r)]) continue;
          const dx = c + 0.5 - centroidX, dz = r + 0.5 - centroidZ;
          const along = dx * dc2 + dz * ds2;
          const perp  = -dx * ds2 + dz * dc2;
          const onDatum = Math.abs(perp) < valleyWidth * 0.7;
          const atFracture = Math.abs(((along % fractureSpacing) + fractureSpacing) % fractureSpacing) < fractureWidth;
          if (onDatum && !atFracture) { valleyCells.add(ck(c, r)); occupied.add(ck(c, r)); }
        }
      }
    } else if (concept === 'courtyard_block') {
      // H&dM/Rossi: central rectangular courtyard void, ~28%-72% of inner span.
      const cx0 = Math.floor(cols * 0.28), cx1 = Math.floor(cols * 0.72);
      const cz0 = Math.floor(rows * 0.28), cz1 = Math.floor(rows * 0.72);
      for (let c = cx0; c <= cx1; c++)
        for (let r = cz0; r <= cz1; r++) {
          if (!buildable[ck(c, r)]) continue;
          valleyCells.add(ck(c, r)); occupied.add(ck(c, r));
        }
    } else if (concept === 'radial_park') {
      // Niemeyer: circular park at the site centroid.
      const rad = innerSpan * 0.20;
      for (let c = 0; c < cols; c++)
        for (let r = 0; r < rows; r++) {
          if (!buildable[ck(c, r)]) continue;
          const dx = c + 0.5 - centroidX, dz = r + 0.5 - centroidZ;
          if (Math.hypot(dx, dz) < rad) { valleyCells.add(ck(c, r)); occupied.add(ck(c, r)); }
        }
    } else if (concept === 'superblock_grid') {
      // OMA: two orthogonal cross-streets splitting the site into 4 superblocks.
      const streetC = Math.floor(centroidX), streetR = Math.floor(centroidZ);
      const halfW = Math.max(1, Math.round(valleyWidth));
      for (let c = 0; c < cols; c++)
        for (let dr = -halfW; dr <= halfW; dr++) {
          const r = streetR + dr;
          if (r < 0 || r >= rows || !buildable[ck(c, r)]) continue;
          valleyCells.add(ck(c, r)); occupied.add(ck(c, r));
        }
      for (let r = 0; r < rows; r++)
        for (let dc = -halfW; dc <= halfW; dc++) {
          const c = streetC + dc;
          if (c < 0 || c >= cols || !buildable[ck(c, r)]) continue;
          valleyCells.add(ck(c, r)); occupied.add(ck(c, r));
        }
    } else if (concept === 'pixel_towers' || concept === 'void_interstitial') {
      // MVRDV/Holl: grid of small void courts puncturing the fabric.
      const courtSize = Math.max(2, Math.round(innerSpan * 0.06));
      const gapW = Math.max(courtSize * 2, Math.floor(cols / 6));
      const gapH = Math.max(courtSize * 2, Math.floor(rows / 5));
      for (let c = gapW; c < cols - gapW; c += gapW)
        for (let r = gapH; r < rows - gapH; r += gapH) {
          for (let dc = 0; dc < courtSize; dc++)
            for (let dr = 0; dr < courtSize; dr++) {
              const cc = c + dc, rr = r + dr;
              if (cc >= cols || rr >= rows || !buildable[ck(cc, rr)]) continue;
              valleyCells.add(ck(cc, rr)); occupied.add(ck(cc, rr));
            }
        }
    } else if (concept === 'green_spine') {
      // Renzo Piano: parallel green fingers perpendicular to the spine path,
      // running along the principal axis.
      const fingerAngle = axisAngle; // along principal axis
      const fc = Math.cos(fingerAngle), fs = Math.sin(fingerAngle);
      const nFingers = 4;
      for (let fi = 0; fi < nFingers; fi++) {
        const off = (fi + 0.5) / nFingers - 0.5; // -0.375..0.375 across perp axis
        const fingerOffset = off * innerSpan * 0.9;
        for (let c = 0; c < cols; c++)
          for (let r = 0; r < rows; r++) {
            if (!buildable[ck(c, r)]) continue;
            const dx = c + 0.5 - centroidX, dz = r + 0.5 - centroidZ;
            const along = dx * fc + dz * fs;
            const perp  = -dx * vs + dz * vc; // perpendicular component (reuse vc/vs basis)
            if (Math.abs(perp - fingerOffset) < valleyWidth * 0.6 && Math.abs(along) < innerSpan * 0.45) {
              valleyCells.add(ck(c, r)); occupied.add(ck(c, r));
            }
          }
      }
    } else {
      // Fallback: original diagonal band (keeps behaviour safe for any
      // future/unrecognised concept string).
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          if (!buildable[ck(c, r)]) continue;
          const dx = c + 0.5 - centroidX, dz = r + 0.5 - centroidZ;
          const perpDist = Math.abs(dx * vc + dz * vs);
          if (perpDist < valleyWidth) { valleyCells.add(ck(c, r)); occupied.add(ck(c, r)); }
        }
      }
    }
  }

  // ── MASSING PLACEMENT — BIG "MOUNTAIN" APPROACH ───────────────────
  // Each side of the valley gets a mountain of buildings:
  //   - Outermost ring: 3–5F base (follows site edge)
  //   - Second ring: 5–7F
  //   - Third ring / peak: 8–12F towers at corner nodes
  // Buildings are wide slabs parallel to the site edges, stepping up toward centre.
  const buildings = [];
  const rng2 = seededRng(seed * 7919 + 31);

  const canPlace = (c, r, w, d) => {
    if (c < 1 || r < 1 || c + w > cols - 1 || r + d > rows - 1) return false;
    for (let dc = 0; dc < w; dc++)
      for (let dr = 0; dr < d; dr++) {
        const k = ck(c + dc, r + dr);
        if (!buildable[k] || occupied.has(k)) return false;
      }
    // Match the stricter corner-based check used by the later safety clip —
    // cellInsideGridPoly above only tests cell centres, which can pass near a
    // diagonal/irregular boundary even when the footprint's actual corners
    // fall outside. Without this, buildings get placed and counted toward
    // the open-space cap, then thrown away entirely by the clip.
    // Skip the expensive polygon test when every footprint cell is already
    // far from the boundary — corner-clipping is geometrically impossible
    // there, so this keeps the common (interior) case cheap.
    if (normPolyToGrid) {
      const nearEdge = edgeDist(c, r) < 3 || edgeDist(c + w, r) < 3 ||
        edgeDist(c, r + d) < 3 || edgeDist(c + w, r + d) < 3;
      if (nearEdge && !footprintInsideGridPoly(c, r, w, d, normPolyToGrid)) return false;
    }
    return true;
  };

  const markOccupied = (c, r, w, d, gap = 1) => {
    for (let dc = -gap; dc < w + gap; dc++)
      for (let dr = -gap; dr < d + gap; dr++)
        occupied.add(ck(c + dc, r + dr));
  };

  // ── ORGANIC 7–8 BUILDING CLUSTER ─────────────────────────────────
  // Instead of a grid, we scatter candidate anchor points across the buildable
  // area using a dart-throw (Poisson-disk-ish) approach, then snap each one to
  // the nearest clear buildable cell and try to place a building.
  //
  // Buildings are intentionally VARIED in both footprint aspect ratio and
  // orientation — some tall-and-narrow, some wide-and-shallow — so the cluster
  // reads as a village rather than a housing grid.
  //
  // Floor programme (G+1 → G+8, BIG/OMA community housing scale):
  //   2 anchors:  7–8F  — tallest, anchors the skyline at opposite ends
  //   3 mid slabs: 4–6F — mid-height bar buildings, varied orientation
  //   2 pavilions: 2–3F — low infill, fills courtyard edges
  //
  // Minimum gap between buildings = 2 cells (4 m passage / fire lane)

  // Collect all buildable cells for random sampling
  // For small/narrow sites, relax edge distance so more cells are eligible
  // Cells already carved out as the concept's public void/valley are
  // PERMANENTLY unbuildable — excluding them from this list (and therefore
  // from the 50%-built denominator below) keeps the green-space target
  // honest. Counting them as "buildable" would inflate the denominator,
  // making the 50% floor unreachable and the reported green% drift above
  // 50% even when the placement loop is working correctly.
  const minEdge = smallSite ? 1 : 2;
  const buildableCells = [];
  for (let c = 1; c < cols - 1; c++)
    for (let r = 1; r < rows - 1; r++)
      if (buildable[ck(c, r)] && edgeDist(c, r) >= minEdge && !valleyCells.has(ck(c, r))) buildableCells.push([c, r]);

  // Programme: [floors, minW, maxW, minD, maxD, aspectSwap%]
  // aspectSwap — chance this building is rotated 90° (so narrow slabs vary orientation)
  // Waterside sites get taller towers (view premium); cutting/elevated get compact slabs.
  const capF = (f) => ctxMaxFloors ? Math.min(f, ctxMaxFloors) : f;
  const mxW  = compactFootprint ? 8 : 12;
  const mxW2 = compactFootprint ? 7 : 11;
  const mW = smallSite ? Math.min(mxW,  Math.floor(Math.min(cols, rows) * 0.5)) : mxW;
  const mW2= smallSite ? Math.min(mxW2, Math.floor(Math.min(cols, rows) * 0.45)) : mxW2;
  const PROGRAMME = [
    { floors: capF(watersideTall ? 10 : 8), minW: smallSite?2:6, maxW: mW,  minD: smallSite?2:4, maxD: smallSite?4:7,  swap: 0.35 },
    { floors: capF(watersideTall ?  9 : 7), minW: smallSite?2:5, maxW: mW,  minD: smallSite?2:4, maxD: smallSite?4:6,  swap: 0.50 },
    { floors: capF(6),                      minW: smallSite?2:6, maxW: mW2, minD: smallSite?2:3, maxD: smallSite?4:6,  swap: 0.40 },
    { floors: capF(5),                      minW: smallSite?2:5, maxW: mW,  minD: smallSite?2:3, maxD: smallSite?3:5,  swap: 0.55 },
    { floors: capF(4),                      minW: smallSite?2:4, maxW: mW,  minD: smallSite?2:3, maxD: smallSite?3:5,  swap: 0.45 },
    { floors: capF(3),                      minW: smallSite?2:4, maxW: smallSite?5:8, minD: smallSite?2:3, maxD: smallSite?3:5, swap: 0.30 },
    { floors: capF(2),                      minW: 2,             maxW: smallSite?4:6, minD: 2,             maxD: smallSite?3:4, swap: 0.50 },
    { floors: capF(5),                      minW: smallSite?2:5, maxW: mW,  minD: smallSite?2:3, maxD: smallSite?3:5,  swap: 0.60 },
  ];

  // Treehouse cluster (glbforaggregation reference): compact lifted pavilions
  // only — 2–4 floors, near-square footprints (the GLBs read as ~12–20m
  // modules), never the wide slabs/towers of the other concepts.
  const TREEHOUSE_PROGRAMME = [
    { floors: capF(4), minW: smallSite?2:5, maxW: smallSite?4:7, minD: smallSite?2:5, maxD: smallSite?4:7, swap: 0.5 },
    { floors: capF(3), minW: smallSite?2:4, maxW: smallSite?4:6, minD: smallSite?2:4, maxD: smallSite?4:6, swap: 0.5 },
    { floors: capF(2), minW: smallSite?2:4, maxW: smallSite?3:5, minD: smallSite?2:4, maxD: smallSite?3:5, swap: 0.5 },
  ];

  // Fixed footprint sizes — do NOT scale by site area.
  // Larger sites get more buildings, not bigger ones.
  const scaleRange = (v) => Math.max(2, Math.round(v));

  // Poisson-disk style placement: try a random buildable origin for each programme slot
  // Minimum separation enforced via markOccupied gap.
  // Small/narrow sites can't afford a full fire-lane gap between every building
  // and still leave room for the open-space target — pack tighter there.
  const MIN_GAP = smallSite ? 0 : 1; // cells between buildings (2m gap — fire lane)

  // ── DENSITY: repeat the programme to fill the site ─────────────────
  // The 50% open-space cap below is the real stopping condition — this just
  // needs to generate enough candidate buildings that the cap is reachable
  // (each pass averages ~8 buildings; sized generously so passes never run
  // out before the cap does).
  const buildablePerPass = 12;
  const passes = Math.max(1, Math.min(200, Math.round(buildableCells.length / buildablePerPass)));
  const activeProgramme = concept === 'treehouse_cluster' ? TREEHOUSE_PROGRAMME : PROGRAMME;
  const fullProgramme = [];
  for (let p = 0; p < passes; p++) fullProgramme.push(...activeProgramme);

  // Track a live free-cell list, pruning occupied cells in bulk when needed
  let freeCells = buildableCells.slice();
  let freeStale = 0;  // how many iterations since last prune

  // ── OPEN SPACE TARGET: cap building footprint so open space lands in the
  // 35–50% range. canPlace now uses the same corner-based boundary check as
  // the later safety clip, so placed footprint ≈ surviving footprint and
  // this cap maps directly to the final reported open-space percentage.
  const MAX_BUILT_FRACTION = 0.6;
  const maxBuiltCells = buildableCells.length * MAX_BUILT_FRACTION;
  let builtCellCount = 0;

  for (const prog of fullProgramme) {
    if (builtCellCount >= maxBuiltCells) break;

    // Prune occupied cells every iteration once space is getting tight, so
    // we keep finding genuinely free gaps right up to the 50% cap instead of
    // bailing out early because the cached freeCells list looks exhausted.
    freeStale++;
    const tight = freeCells.length < buildableCells.length * 0.15;
    if (freeStale >= (tight ? 1 : 8) || freeCells.length === 0) {
      freeCells = buildableCells.filter(([c, r]) => !occupied.has(ck(c, r)));
      freeStale = 0;
    }
    if (freeCells.length < 4) break;

    // Sample several random candidates and pick the one with best edge distance
    const CANDIDATES = 24;
    let best = null, bestScore = -1;

    for (let attempt = 0; attempt < CANDIDATES; attempt++) {
      const idx = Math.floor(rng2() * freeCells.length);
      const [cc, rr] = freeCells[idx];

      let bw = scaleRange(prog.minW + rng2() * (prog.maxW - prog.minW));
      let bd = scaleRange(prog.minD + rng2() * (prog.maxD - prog.minD));
      // Randomly swap orientation for variety
      if (rng2() < prog.swap) { const t = bw; bw = bd; bd = t; }

      // Jitter the anchor so it doesn't always corner at [cc, rr]
      const jC = cc - Math.floor(bw * (0.2 + rng2() * 0.6));
      const jR = rr - Math.floor(bd * (0.2 + rng2() * 0.6));

      if (!canPlace(jC, jR, bw, bd)) continue;

      // Score = edge distance + solar orientation + wind shelter bonus
      const ed = edgeDist(jC + Math.floor(bw/2), jR + Math.floor(bd/2));
      const sol = solarScore(jC, jR, bw, bd, centroidX, centroidZ, solarAngle);
      // Wind: prefer buildings whose long axis is perpendicular to wind (creates shelter)
      const bLongX = bw >= bd ? 1 : 0, bLongZ = bw >= bd ? 0 : 1;
      const windPerp = 1 - Math.abs(bLongX * windDX + bLongZ * windDZ);

      // ── Concept bias — additive multiplier nudging WHERE/WHAT-SIZE buildings
      // land, without touching the base scoring formula's structure.
      const bCx = jC + bw / 2, bCz = jR + bd / 2;
      const centroidDist = Math.hypot(bCx - centroidX, bCz - centroidZ) / Math.max(1, innerSpan);
      let conceptBias = 0;
      if (concept === 'courtyard_block') {
        // Perimeter-block massing: favour footprints CLOSE to the site edge
        // (low edgeDist) — invert the normal edge preference.
        conceptBias = -Math.min(1, ed / 6) * 0.5;
      } else if (concept === 'radial_park') {
        // Ring preference: favour a mid-distance band from the centroid
        // (civic heart stays open, far edge stays lower-density).
        conceptBias = (1 - Math.abs(centroidDist - 0.45) * 2) * 0.4;
      } else if (concept === 'superblock_grid') {
        // Quadrant-by-quadrant height bias: NE quadrant (relative to centroid)
        // reads taller, reinforcing OMA's shifting-programme superblocks.
        const isNE = (bCx >= centroidX) && (bCz < centroidZ);
        conceptBias = (isNE ? (prog.floors / 10) : 0) * 0.5;
      } else if (concept === 'pixel_towers') {
        // Prefer smaller, more evenly spaced footprints (pixel grid identity) —
        // penalise large footprints so the candidate pool skews toward compact slots.
        conceptBias = -Math.min(1, (bw * bd) / 60) * 0.4;
      } else if (concept === 'green_spine') {
        // Favour slabs parallel to the principal axis, away from the green fingers.
        conceptBias = windPerp * 0; // fingers already removed from buildable cells; no extra bias needed
      } else if (concept === 'mountain_cascade') {
        // Reinforce the existing diagonal-valley edge preference (already
        // baked into ed) — small additional skyline-gradient nudge by floor count.
        conceptBias = (prog.floors / 10) * 0.15;
      } else if (concept === 'linear_datum') {
        // Zaha Hadid: favour LONG, NARROW slabs aligned with the principal
        // axis (the "continuous flowing bar" identity) — penalise squat/
        // square footprints so the candidate pool skews toward elongated
        // bars running parallel to the datum line carved above.
        const elongation = Math.max(bw, bd) / Math.max(1, Math.min(bw, bd));
        conceptBias = Math.min(1, (elongation - 1) / 3) * 0.45;
      } else if (concept === 'void_interstitial') {
        // Dense fabric with interstitial voids: mild bonus for tighter packing
        // (small gap usage already enforced elsewhere) — slight bias to mid-size footprints.
        conceptBias = (1 - Math.abs((bw * bd) / 40 - 1)) * 0.2;
      } else if (concept === 'treehouse_cluster') {
        // Lifted pavilion cluster (glbforaggregation reference): compact
        // footprints only, staggered in a running-bond offset row pattern —
        // alternate "courses" (bands of rows) are nudged half a footprint
        // sideways, so neighbouring pavilions never align edge-to-edge like
        // a grid — they interlock like brickwork, with gaps for shared
        // ground-level light wells between courses.
        const courseRows = Math.max(4, prog.floors + 3);
        const course = Math.floor(jR / courseRows);
        const staggered = course % 2 === 0
          ? Math.abs((jC % courseRows) - courseRows / 2) < courseRows * 0.3
          : Math.abs((jC % courseRows) - 0) < courseRows * 0.3;
        conceptBias = (staggered ? 0.35 : 0) - Math.min(1, (bw * bd) / 50) * 0.3;
      }

      const score = ed * (1 + sol * 0.4 + windPerp * 0.2 + rng2() * 0.3 + conceptBias);
      if (score > bestScore) { bestScore = score; best = { c: jC, r: jR, w: bw, d: bd }; }
    }

    if (!best) continue;
    const type = prog.floors >= 7 ? 'tower' : prog.floors >= 4 ? 'mid' : 'perimeter';
    const built = buildBuilding(best.c, best.r, best.w, best.d, prog.floors, type, rng2, concept);
    buildings.push(built);
    markOccupied(best.c, best.r, best.w, best.d, MIN_GAP);
    // Only count footprint that actually produced units — buildBuilding()
    // returns units:[] for tiny (w<3||d<2) footprints, and crediting those
    // toward builtCellCount would let the 50%-built floor below think more
    // was built than the final greenPercent stat can ever reflect.
    if (built.units.length > 0) builtCellCount += best.w * best.d;
  }

  // Note: no small-footprint infill pass — tiny filler buildings just to hit
  // a number read as clutter and don't represent real massing. Sites that
  // can't reach the open-space target through the main programme (very
  // small/narrow sites) simply end up with more open space, which is the
  // honest result rather than padding the model with junk boxes.

  // ── MIN BUILT FRACTION ENFORCEMENT ─────────────────────────────────
  // Green space should be ≤50% of buildable area (built ≥50%). The main
  // programme loop above is capped at MAX_BUILT_FRACTION (60%) but has no
  // floor — small/sparse passes can finish well under 50% built. Run
  // additional relaxed passes (smaller minimum footprints, zero gap) until
  // either the 50% floor is reached or no more free cells exist.
  // On pathologically small/narrow sites, 50% may be geometrically
  // unreachable (not enough contiguous free cells for even a 2x2 footprint)
  // — that's acceptable degradation, not a crash; the loop below simply
  // exits once `best` stays null for a full pass.
  const MIN_BUILT_FRACTION = 0.5;
  const minBuiltCells = buildableCells.length * MIN_BUILT_FRACTION;
  let reliefGuard = 0;
  while (builtCellCount < minBuiltCells && reliefGuard < 4000) {
    reliefGuard++;
    freeCells = freeCells.filter(([c, r]) => !occupied.has(ck(c, r)));
    if (freeCells.length < 4) break;

    // Try every remaining free cell as an anchor (not just a random sample)
    // before giving up — a random 16-cell sample can miss the few slots
    // that still fit a 3×2 footprint even when plenty of free cells remain,
    // making the loop bail out well short of the 50% floor unnecessarily.
    let best = null, bestScore = -1;
    for (const [fc, fr] of freeCells) {
      // buildBuilding() returns zero units (an empty, invisible footprint)
      // for w<3 || d<2 — a relaxed footprint that small would burn buildable
      // cells without ever counting toward builtCount, silently widening the
      // gap between this loop's stopping condition and the real green% stat.
      // Anchor the footprint at every corner touching this free cell (not
      // just top-left) — a 3×2 slot can exist around a free cell even when
      // that cell isn't its top-left corner, which the single-anchor search
      // above was missing on fragmented, narrow leftover gaps.
      let placed = false;
      for (const bw of [4, 3]) {
        for (const bd of [4, 3, 2]) {
          for (const [dxc, dxr] of [[0,0], [-(bw-1),0], [0,-(bd-1)], [-(bw-1),-(bd-1)]]) {
            const cc = fc + dxc, rr = fr + dxr;
            if (!canPlace(cc, rr, bw, bd)) continue;
            const ed = edgeDist(cc + Math.floor(bw/2), rr + Math.floor(bd/2));
            const score = ed + rng2() * 0.5;
            if (score > bestScore) { bestScore = score; best = { c: cc, r: rr, w: bw, d: bd }; }
            placed = true;
            break;
          }
          if (placed) break;
        }
        if (placed) break;
      }
    }
    if (!best) break; // no 3×2-or-larger footprint fits anywhere — geometric limit reached

    const built = buildBuilding(best.c, best.r, best.w, best.d, 3, 'perimeter', rng2, concept);
    buildings.push(built);
    markOccupied(best.c, best.r, best.w, best.d, 0); // zero gap — packing tightly to hit the floor
    if (built.units.length > 0) builtCellCount += best.w * best.d;
  }

  // ── DECORATE: stair cores, lobbies ────────────────────────────────
  buildings.forEach(b => decorateBuilding(b));

  // ── SAFETY CLIP: remove any unit that crossed the boundary ────────
  // Always clip against the OUTER polygon (normPolyToGrid), never the inset,
  // to prevent over-clipping on narrow/elongated sites where centroid-shrink
  // can collapse the inset polygon to near-zero.
  const clipPoly = normPolyToGrid;
  buildings.forEach(b => {
    b.units = b.units.filter(u => {
      if (u.col < 1 || u.col + u.w > cols - 1) return false;
      if (u.row < 1 || u.row + u.d > rows - 1) return false;
      if (clipPoly) {
        return footprintInsideGridPoly(u.col, u.row, u.w, u.d, clipPoly);
      }
      return true;
    });
  });

  // Remove buildings with no units
  const validBuildings = buildings.filter(b => b.units.length > 0);

  // ── TYPOLOGY BALANCE ───────────────────────────────────────────────
  guaranteeAllTypologies(validBuildings, rng, mixTargets);

  // ── CONNECTIVE TISSUE ──────────────────────────────────────────────
  const inSite = (c, r) => buildable[ck(c, r)] === 1;
  const wb = { c0: 1, r0: 1, cE: cols - 1, rE: rows - 1 };
  const connective = buildConnectiveLayer(validBuildings, cols, rows, SETBACK, ck, inSite, wb);

  // ── GREENERY ───────────────────────────────────────────────────────
  const buildingCells = new Set(validBuildings.flatMap(b => {
    const cs = [];
    for (let dc = 0; dc < b.w; dc++)
      for (let dr = 0; dr < b.d; dr++)
        cs.push(ck(b.col + dc, b.row + dr));
    return cs;
  }));
  const podiumSet = new Set(connective.podiumCells.map(p => ck(p.col, p.row)));
  const greenCells = [];

  for (let c = 1; c < cols - 1; c++) {
    for (let r = 1; r < rows - 1; r++) {
      if (!buildable[ck(c, r)]) continue;
      const key = ck(c, r);
      if (buildingCells.has(key) || podiumSet.has(key)) continue;
      // No trees — only lawn/path
      const inValley = valleyCells.has(key);
      const type = inValley ? 'path' : 'lawn';
      greenCells.push({ col: c, row: r, type });
    }
  }

  // ── ROAD NETWORK ───────────────────────────────────────────────────
  const roads = buildRoadNetwork(validBuildings, cols, rows, buildable, ck, insetGridPoly, accessEdges);

  // ── SOLAR ORIENTATION SCORE per building ───────────────────────────
  validBuildings.forEach(b => {
    b.solarScore = solarScore(b.col, b.row, b.w, b.d, centroidX, centroidZ, solarAngle);
  });

  // ── SOLAR HEATMAP ──────────────────────────────────────────────────
  const solarHeatmap = buildSolarHeatmap(cols, rows, validBuildings, solarAngle, buildable, ck);

  // ── STATS ──────────────────────────────────────────────────────────
  const streetCellList = [];
  valleyCells.forEach(k => {
    const c = Math.floor(k / rows), r = k % rows;
    if (!buildingCells.has(k)) streetCellList.push({ col: c, row: r, type: 'path' });
  });

  const filteredGreen  = greenCells.filter(c => !podiumSet.has(ck(c.col, c.row)));
  const filteredStreet = streetCellList.filter(c => !podiumSet.has(ck(c.col, c.row)));
  const totalUnits     = validBuildings.reduce((s, b) => s + b.units.length, 0);
  const floorCounts    = validBuildings.map(b => b.floors).filter(Boolean);
  // Open space = buildable site area minus building footprints — uses the
  // SAME denominator (buildableCells, post edge-setback) as the placement
  // cap above, so the reported stat can never drift from what was enforced.
  const totalCells = buildableCells.length || (cols * rows);
  const builtCount = validBuildings.reduce((s, b) => s + b.w * b.d, 0);
  const greenCount = Math.max(0, totalCells - builtCount);
  const groundFloorAreaM2 = validBuildings.reduce((s, b) => s + (b.groundFloorAreaM2 || 0), 0);

  return {
    // Reflects the ACTUALLY USED concept (options.concept override or the
    // seed-derived pick), so label always matches behaviour even when overridden.
    concept,
    conceptLabel: resolvedConceptLabel,
    seed,
    cols,
    rows,
    cellSize,
    // Site polygon in grid-cell units (0..cols, 0..rows) — lets the viewer
    // draw the ground plane as the real site shape instead of a rectangle.
    // On large/irregular sites, a rectangular ground plane left buildings
    // (correctly confined to the real polygon) looking like a sparse
    // cluster lost inside a much bigger black rectangle of dead space.
    sitePolyGrid: normPolyToGrid,
    buildings: validBuildings,
    greenZones: [...filteredGreen, ...filteredStreet],
    podiumCells: connective.podiumCells,
    bridges: connective.bridges,
    exteriorStairs: connective.exteriorStairs,
    pavilions: connective.pavilions,
    deckGardens: connective.deckGardens,
    promenade: connective.promenade,
    roads,
    solarHeatmap,
    solarAzimuth,
    totalUnits,
    groundFloorAreaM2: Math.round(groundFloorAreaM2),
    greenPercent: Math.round((greenCount / totalCells) * 100),
    floors: {
      min: floorCounts.length ? Math.min(...floorCounts) : 1,
      max: floorCounts.length ? Math.max(...floorCounts) : 1,
    },
    siteBounds,
    siteContext,
  };
}

// ─── Edge distance via BFS ────────────────────────────────────────
function computeEdgeDist(cols, rows, buildable, ck) {
  const dist = new Float32Array(cols * rows).fill(999);
  const queue = [];
  for (let c = 0; c < cols; c++)
    for (let r = 0; r < rows; r++)
      if (!buildable[ck(c, r)]) { dist[ck(c, r)] = 0; queue.push([c, r]); }
  let head = 0;
  while (head < queue.length) {
    const [c, r] = queue[head++];
    const d = dist[ck(c, r)];
    for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
      const nk = ck(nc, nr);
      if (dist[nk] > d + 1) { dist[nk] = d + 1; queue.push([nc, nr]); }
    }
  }
  return (c, r) => dist[ck(c, r)];
}

// ─── Build a single building — explicit stepped-slab approach ────
// Each building is 2–5 stacked rectangular slabs that visibly shrink and
// step as they go up. This is what makes BIG / stepped-mountain massing
// look dramatic in 3D — no per-cell unit complexity needed.
function buildBuilding(col, row, w, d, floors, type, rng, concept = null) {
  if (w < 3 || d < 2) {
    return { id: `bld_${col}_${row}`, col, row, w, d, floors, type,
      profile: 'flat', slabs: [], units: [], groundFloorAreaM2: 0,
      stairCores: [], lobbies: [], terraces: [] };
  }

  const isTower   = type === 'tower' || floors >= 9;
  const isMid     = type === 'mid'   || (floors >= 5 && !isTower);
  const PROFILES  = concept === 'treehouse_cluster'
    ? ['tree_pavilion']
    : concept === 'linear_datum'
      // Zaha Hadid: continuous flowing bar — always a one-directional
      // stepped cascade (never the radially-symmetric ziggurat/pyramid/
      // pinnacle profiles other towers use), reinforcing the elongated-bar
      // placement bias above instead of contradicting it with round massing.
      ? ['cascade_south', 'terrace_one']
    : isTower
      ? ['pyramid', 'pinnacle', 'crown_step']
      : isMid
        ? ['cascade_south', 'ziggurat', 'cascade_south']
        : ['terrace_one',   'flat',     'terrace_one'];
  const profile = PROFILES[Math.floor(rng() * PROFILES.length)];

  // Generate stepped slabs. Each slab = { xOff, zOff, sw, sd, floorStart, floorEnd }
  // All offsets in GRID CELLS relative to (col, row).
  // The viewer renders each slab as one tall box spanning its floor range.
  const slabs = [];

  if (profile === 'flat') {
    slabs.push({ xOff: 0, zOff: 0, sw: w, sd: d, floorStart: 0, floorEnd: floors - 1 });

  } else if (profile === 'terrace_one') {
    // Base full width, upper portion steps back from south face
    const split = Math.max(1, Math.floor(floors * 0.55));
    slabs.push({ xOff: 0, zOff: 0,              sw: w,            sd: d,            floorStart: 0,     floorEnd: split - 1 });
    const stepBack = Math.max(1, Math.round(d * 0.30));
    slabs.push({ xOff: 0, zOff: 0,              sw: w,            sd: d - stepBack,  floorStart: split, floorEnd: floors - 1 });

  } else if (profile === 'cascade_south') {
    // 3 tiers stepping back progressively from the south face. Step-backs
    // are clamped so the final tier never shrinks to <2 cells deep — on a
    // 2-cell-deep footprint, sb2 (rounded from 50% of d) could equal d
    // itself, producing a zero/negative-depth slab (every other tiered
    // profile below already clamps the same way; this one didn't).
    const t1 = Math.max(1, Math.floor(floors * 0.40));
    const t2 = Math.max(t1 + 1, Math.floor(floors * 0.70));
    const sb1 = Math.min(d - 2, Math.max(1, Math.round(d * 0.25)));
    const sb2 = Math.min(d - 2, Math.max(sb1 + 1, Math.round(d * 0.50)));
    slabs.push({ xOff: 0, zOff: 0, sw: w, sd: d,        floorStart: 0,  floorEnd: t1 - 1    });
    slabs.push({ xOff: 0, zOff: 0, sw: w, sd: d - sb1,  floorStart: t1, floorEnd: t2 - 1    });
    slabs.push({ xOff: 0, zOff: 0, sw: w, sd: d - sb2,  floorStart: t2, floorEnd: floors - 1 });

  } else if (profile === 'ziggurat') {
    // Steps in on ALL 4 sides — true stepped pyramid
    const steps = Math.min(4, Math.floor(floors / 2));
    const floorsPerStep = Math.ceil(floors / steps);
    for (let s = 0; s < steps; s++) {
      const shrink = s;
      const xOff = shrink, zOff = shrink;
      const sw = Math.max(2, w - shrink * 2);
      const sd = Math.max(2, d - shrink * 2);
      const fStart = s * floorsPerStep;
      const fEnd   = Math.min(floors - 1, (s + 1) * floorsPerStep - 1);
      slabs.push({ xOff, zOff, sw, sd, floorStart: fStart, floorEnd: fEnd });
    }

  } else if (profile === 'pyramid') {
    // Smooth 4-sided taper — 4 tiers shrinking inward
    const steps = Math.min(5, Math.max(3, Math.floor(floors / 3)));
    const floorsPerStep = Math.ceil(floors / steps);
    for (let s = 0; s < steps; s++) {
      const shrink = Math.round(s * Math.min(w, d) * 0.14);
      const xOff = shrink, zOff = shrink;
      const sw = Math.max(3, w - shrink * 2);
      const sd = Math.max(3, d - shrink * 2);
      const fStart = s * floorsPerStep;
      const fEnd   = Math.min(floors - 1, (s + 1) * floorsPerStep - 1);
      slabs.push({ xOff, zOff, sw, sd, floorStart: fStart, floorEnd: fEnd });
    }

  } else if (profile === 'pinnacle') {
    // Wide base tapering to a narrow spire
    const steps = Math.min(5, Math.max(3, Math.floor(floors / 2)));
    const floorsPerStep = Math.ceil(floors / steps);
    for (let s = 0; s < steps; s++) {
      const frac = s / (steps - 1);
      const shrinkX = Math.round(frac * (w / 2 - 1));
      const shrinkZ = Math.round(frac * (d / 2 - 1));
      const xOff = shrinkX, zOff = shrinkZ;
      const sw = Math.max(2, w - shrinkX * 2);
      const sd = Math.max(2, d - shrinkZ * 2);
      const fStart = s * floorsPerStep;
      const fEnd   = Math.min(floors - 1, (s + 1) * floorsPerStep - 1);
      slabs.push({ xOff, zOff, sw, sd, floorStart: fStart, floorEnd: fEnd });
    }

  } else if (profile === 'crown_step') {
    // Solid base, then narrow tower shoots up from centre
    const baseFloors = Math.max(2, Math.floor(floors * 0.45));
    slabs.push({ xOff: 0, zOff: 0, sw: w, sd: d, floorStart: 0, floorEnd: baseFloors - 1 });
    const tw = Math.max(3, Math.round(w * 0.45));
    const td = Math.max(3, Math.round(d * 0.45));
    const txOff = Math.floor((w - tw) / 2), tzOff = Math.floor((d - td) / 2);
    slabs.push({ xOff: txOff, zOff: tzOff, sw: tw, sd: td, floorStart: baseFloors, floorEnd: floors - 1 });

  } else if (profile === 'tree_pavilion') {
    // Treehouse cluster — measured from glbforaggregation (4 reference GLBs,
    // mesh-level geometry, not eyeballed). Real structural facts found:
    //   - Floor-to-floor height is constant (~3.5 m) — confirmed by clustering
    //     slab Y-levels across all 4 files (deltas land on 3.4–3.6 m).
    //   - Footprint does NOT step/taper with height — per-floor footprint
    //     bounding box is flat across every floor band in every file (no
    //     ziggurat/pyramid behaviour despite the organic columns).
    //   - The ground floor is a separate, taller structural bay — measured
    //     ~6.4 m vs ~3.5 m for a typical floor (≈ double height) — and its
    //     plinth is the part that's WIDER, not the roof. Footprint shrinks
    //     ~8 m between the ground band and floor 1 in Option 4 BR — the
    //     building oversails outward at the BASE, the opposite of the
    //     canopy-cantilever-at-top guess this replaces.
    //   - Columns are tapered "trumpet" pedestals: 0.7×0.7 m stem → 1.5×1.5 m
    //     collar → ~3.7×1.85 m flat capital (measured bbox). The capital is
    //     the structural ceiling on how far a plinth edge can oversail past
    //     its column line — real cantilever, not a free aesthetic parameter.
    //     Capital half-width minus stem half-width ≈ (3.7-0.7)/2 ≈ 1.5 m max,
    //     but the capital is a point support, not a continuous edge beam, so
    //     the safe continuous-edge oversail is well under that — ~0.4–0.5 m.
    //     That's sub-grid-cell at CELL=2m, so it's stored as a real-metre
    //     value (oversailM) rather than forced into a whole extra grid cell,
    //     which would overstate it 4-5x and corrupt the footprint other
    //     systems (clipping, roads) rely on staying accurate in cells.
    const bodyEnd = floors - 1;
    const oversailM = 0.45; // measured capital-to-stem oversail limit, metres
    slabs.push({
      xOff: 0, zOff: 0, sw: w, sd: d, oversailM,
      floorStart: 0, floorEnd: 0, plinth: true, doubleHeight: true,
    });
    // Body: constant footprint all the way up — no taper, matching the
    // measured flat per-floor bounding box.
    slabs.push({ xOff: 0, zOff: 0, sw: w, sd: d, floorStart: 1, floorEnd: bodyEnd, arched: true });
    // Column count for this pavilion, derived from footprint area at the
    // measured real-world grid density of one trumpet column per ~16–20 m²
    // of module (matches the 4.0–6.0 m column-to-column spacing measured
    // within a single pavilion in OPTION 2). Stored on the slab so the
    // viewer can place real column instances instead of a generic grid.
    const areaM2 = w * d * CELL * CELL;
    slabs[slabs.length - 1].columnCount = Math.max(1, Math.round(areaM2 / 18));
  }

  // Generate units from slabs (for typology counting / stats).
  // Floor 0 is held back from residential — it's the open colonnade/civic
  // base (see OpenColonnade in the viewer), repurposed as ground-floor
  // commercial/retail/community space instead of housing.
  const units = [];
  let groundFloorAreaM2 = 0;
  for (const slab of slabs) {
    // Tile each floor ONCE per slab (not per floor) — every floor within a
    // slab shares the same footprint by construction, so the same tiling
    // layout is reused across its floor range instead of repeating the
    // (deterministic-per-call but still wasted) packing work per floor.
    const tiling = tileFloorWithUnits(slab.sw, slab.sd, rng, concept);
    for (let fl = slab.floorStart; fl <= slab.floorEnd; fl++) {
      if (fl === 0) {
        groundFloorAreaM2 += slab.sw * slab.sd * CELL * CELL;
        continue;
      }
      for (const placement of tiling) {
        const { typo } = placement;
        units.push({
          typologyId: typo.id, beds: typo.beds, areaM2: typo.areaM2,
          floor: fl,
          col: col + slab.xOff + placement.xOff,
          row: row + slab.zOff + placement.zOff,
          w: placement.w, d: placement.d,
        });
      }
    }
  }

  // Terrace surfaces = top of each slab where the next slab above is smaller
  const terraces = [];
  for (let si = 0; si < slabs.length - 1; si++) {
    const lo = slabs[si], hi = slabs[si + 1];
    if (lo.sw > hi.sw || lo.sd > hi.sd) {
      terraces.push({ col: col + lo.xOff, row: row + lo.zOff,
                      w: lo.sw, d: lo.sd, floor: lo.floorEnd + 1 });
    }
  }
  // Roof top
  const top = slabs[slabs.length - 1];
  if (top) terraces.push({ col: col + top.xOff, row: row + top.zOff,
                            w: top.sw, d: top.sd, floor: top.floorEnd + 1, kind: 'roof' });

  return {
    id: `bld_${col}_${row}`,
    col, row, w, d, floors, type, profile,
    footprint: buildFootprint(col, row, w, d),
    slabs,
    units,
    groundFloorAreaM2,
    terraces,
    stairCores: [],
    lobbies: [],
  };
}

function buildFootprint(col, row, w, d) {
  const fp = [];
  for (let dc = 0; dc < w; dc++) for (let dr = 0; dr < d; dr++) fp.push({ col: col+dc, row: row+dr });
  return fp;
}

function decorateBuilding(building) {
  const { col, row, w, d } = building;
  const coreCount = w >= 6 ? 2 : 1;
  for (let i = 0; i < coreCount; i++) {
    const frac = coreCount === 1 ? 0.5 : (i === 0 ? 0.28 : 0.72);
    building.stairCores.push({ col: col + Math.floor(w * frac), row: row + Math.floor(d * 0.5) });
  }
  building.lobbies.push({
    col: col + Math.floor(w / 2), row: row + d - 1, facing: 'south',
    w: Math.max(2, Math.floor(w * 0.55)),
  });
}

// ─── Typology balance ─────────────────────────────────────────────
const MIN_PER_TYPO   = 5;
const DOMINANCE_FRAC = 0.32;

// mixTargets: { [typologyId]: fraction 0–1 } — must sum to ≤1; null = use default balance
function guaranteeAllTypologies(buildings, rng, mixTargets = null) {
  function getCounts() {
    const c = {};
    TYPOLOGIES.forEach(t => { c[t.id] = 0; });
    buildings.forEach(b => b.units.forEach(u => { c[u.typologyId] = (c[u.typologyId] || 0) + 1; }));
    return c;
  }
  function buildAllUnits() {
    const list = [];
    buildings.forEach(b => b.units.forEach((u, i) => list.push({ b, i, u })));
    return list;
  }
  function setTypo(entry, typo) {
    entry.b.units[entry.i] = { ...entry.u, typologyId: typo.id, beds: typo.beds, areaM2: typo.areaM2 };
    entry.u = entry.b.units[entry.i];
  }
  // Units are tiled at their native typology footprint (see
  // tileFloorWithUnits) — rebalancing the typology MIX must never relabel a
  // unit to a typology whose real-world size doesn't match the room it's
  // already placed in, or the label would lie about the unit's actual size
  // (the original bug this whole pipeline now exists to avoid). Only
  // typologies that fit the unit's existing w×d (in either rotation) are
  // valid reassignment targets.
  function fitsUnit(typo, u) {
    return (typo.gridX === u.w && typo.gridZ === u.d) || (typo.gridZ === u.w && typo.gridX === u.d);
  }

  const total = buildings.reduce((s, b) => s + b.units.length, 0);
  if (total === 0) return;

  // ── Mix-target enforcement (user-specified percentages) ───────────
  if (mixTargets) {
    // Build target counts per typology
    const targets = {};
    TYPOLOGIES.forEach(t => {
      const frac = mixTargets[t.id] ?? 0;
      targets[t.id] = Math.round(total * frac);
    });
    // Distribute any rounding remainder to the largest-target typology
    const rem = total - Object.values(targets).reduce((s, v) => s + v, 0);
    if (rem !== 0) {
      const biggest = TYPOLOGIES.slice().sort((a, b2) => (targets[b2.id] ?? 0) - (targets[a.id] ?? 0))[0];
      targets[biggest.id] = Math.max(0, (targets[biggest.id] ?? 0) + rem);
    }

    // Shuffle units so reassignment is random
    const allUnits = buildAllUnits();
    for (let i = allUnits.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [allUnits[i], allUnits[j]] = [allUnits[j], allUnits[i]];
    }

    const c = getCounts();
    // First pass: reduce over-represented typologies
    for (const entry of allUnits) {
      const tid = entry.u.typologyId;
      if ((c[tid] ?? 0) <= (targets[tid] ?? 0)) continue;
      // Find most under-represented typology that actually fits this unit's
      // placed footprint — never reassign to a size that doesn't fit.
      const neediest = TYPOLOGIES
        .filter(t => (c[t.id] ?? 0) < (targets[t.id] ?? 0) && fitsUnit(t, entry.u))
        .sort((a, b2) => ((targets[a.id] ?? 0) - (c[a.id] ?? 0)) - ((targets[b2.id] ?? 0) - (c[b2.id] ?? 0)))[0];
      if (!neediest) continue;
      setTypo(entry, neediest);
      c[tid]--; c[neediest.id] = (c[neediest.id] ?? 0) + 1;
    }
    return;
  }

  // ── Default balance: ensure at least MIN_PER_TYPO of every type ──
  const maxPerTypo = Math.max(MIN_PER_TYPO + 2, Math.ceil(total * DOMINANCE_FRAC));

  for (let pass = 0; pass < 6; pass++) {
    const c = getCounts();
    const under = TYPOLOGIES.filter(t => c[t.id] < MIN_PER_TYPO);
    if (!under.length) break;
    const allUnits = buildAllUnits();
    for (const typo of under) {
      let needed = MIN_PER_TYPO - c[typo.id];
      // Only units whose placed footprint already matches typo's native
      // size are valid donors — relabeling a unit to a typology that
      // doesn't fit its actual room geometry would lie about its size.
      const donors = allUnits
        .filter(({ u }) => u.typologyId !== typo.id && c[u.typologyId] > MIN_PER_TYPO && fitsUnit(typo, u))
        .sort((a, b2) => c[b2.u.typologyId] - c[a.u.typologyId]);
      for (const entry of donors) {
        if (needed <= 0) break;
        if (c[entry.u.typologyId] <= MIN_PER_TYPO) continue;
        const old = entry.u.typologyId;
        setTypo(entry, typo);
        c[typo.id]++; c[old]--; needed--;
      }
    }
  }

  for (let pass = 0; pass < 6; pass++) {
    const c = getCounts();
    const over = TYPOLOGIES.filter(t => c[t.id] > maxPerTypo);
    if (!over.length) break;
    const allUnits = buildAllUnits();
    for (const donorT of over) {
      let excess = c[donorT.id] - maxPerTypo;
      const entries = allUnits.filter(({ u }) => u.typologyId === donorT.id);
      for (const entry of entries) {
        if (excess <= 0) break;
        // Only consider typologies whose native size matches this unit's
        // already-placed footprint — see fitsUnit() above.
        const target = TYPOLOGIES
          .filter(t => t.id !== donorT.id && fitsUnit(t, entry.u))
          .sort((a, b2) => c[a.id] - c[b2.id])[0];
        if (!target || c[target.id] >= maxPerTypo) continue;
        setTypo(entry, target);
        c[donorT.id]--; c[target.id]++; excess--;
      }
    }
  }
}

// ─── Connective tissue ────────────────────────────────────────────
function buildConnectiveLayer(buildings, cols, rows, sb, ck, inSite, wb) {
  const live = buildings.filter(b => b.units.length > 0);
  const rngC = seededRng(1337 + live.length * 7);

  const occ = new Set();
  live.forEach(b => {
    for (let dc = 0; dc < b.w; dc++)
      for (let dr = 0; dr < b.d; dr++)
        occ.add(ck(b.col + dc, b.row + dr));
  });

  const c0 = wb.c0, r0 = wb.r0, cE = wb.cE, rE = wb.rE;

  // Podium deck — 2-cell apron where buildings cluster
  const reach = 2;
  const podiumCells = [];
  for (let c = c0; c < cE; c++) {
    for (let r = r0; r < rE; r++) {
      const key = ck(c, r);
      if (occ.has(key)) continue;
      if (!inSite(c, r) || !inSite(c+1, r) || !inSite(c, r+1) || !inSite(c+1, r+1)) continue;
      let near = false;
      for (let dc = -reach; dc <= reach && !near; dc++)
        for (let dr = -reach; dr <= reach && !near; dr++)
          if (occ.has(ck(c + dc, r + dr))) near = true;
      if (near) podiumCells.push({ col: c, row: r });
    }
  }

  function gapLink(a, b) {
    const ax1 = a.col, ax2 = a.col+a.w, az1 = a.row, az2 = a.row+a.d;
    const bx1 = b.col, bx2 = b.col+b.w, bz1 = b.row, bz2 = b.row+b.d;
    const zOv = Math.min(az2,bz2) - Math.max(az1,bz1);
    const xOv = Math.min(ax2,bx2) - Math.max(ax1,bx1);
    if (zOv >= 2) {
      const zc = (Math.max(az1,bz1) + Math.min(az2,bz2)) / 2;
      const gapR = bx1 - ax2, gapL = ax1 - bx2;
      if (gapR >= 2 && gapR <= 7) return { ax: ax2, az: zc, bx: bx1, bz: zc };
      if (gapL >= 2 && gapL <= 7) return { ax: bx2, az: zc, bx: ax1, bz: zc };
    } else if (xOv >= 2) {
      const xc = (Math.max(ax1,bx1) + Math.min(ax2,bx2)) / 2;
      const gapD = bz1 - az2, gapU = az1 - bz2;
      if (gapD >= 2 && gapD <= 7) return { ax: xc, az: az2, bx: xc, bz: bz1 };
      if (gapU >= 2 && gapU <= 7) return { ax: xc, az: bz2, bx: xc, bz: az1 };
    }
    return null;
  }

  function collectLinks(minFloors) {
    const cands = [];
    for (let i = 0; i < live.length; i++)
      for (let j = i+1; j < live.length; j++) {
        const a = live[i], b = live[j];
        if (a.floors < minFloors || b.floors < minFloors) continue;
        const br = gapLink(a, b);
        if (br) cands.push({ i, j, br, score: a.floors + b.floors });
      }
    return cands.sort((x, y) => y.score - x.score);
  }

  function pickLinks(cands, maxPer, cap, kind, floorFn) {
    const use = new Map();
    const out = [];
    for (const c of cands) {
      if (out.length >= cap) break;
      if ((use.get(c.i)||0) >= maxPer || (use.get(c.j)||0) >= maxPer) continue;
      c.br.floor = floorFn(live[c.i], live[c.j]);
      c.br.kind = kind;
      out.push(c.br);
      use.set(c.i, (use.get(c.i)||0)+1);
      use.set(c.j, (use.get(c.j)||0)+1);
    }
    return out;
  }

  const skyCap = Math.max(2, Math.min(8, Math.round(live.length * 0.25)));
  const finalBridges = pickLinks(collectLinks(6), 1, skyCap, 'sky',
    (a, b) => { const lo = Math.min(a.floors, b.floors);
      return Math.max(2, Math.min(lo-1, 2 + Math.floor(rngC() * Math.max(1, lo-3)))); });

  const skyUsed = new Set();
  finalBridges.forEach(b => skyUsed.add(`${b.ax},${b.az},${b.bx},${b.bz}`));
  const roofCap = Math.max(1, Math.min(5, Math.round(live.length * 0.18)));
  const finalRoofBridges = pickLinks(
    collectLinks(5).filter(c => !skyUsed.has(`${c.br.ax},${c.br.az},${c.br.bx},${c.br.bz}`)),
    1, roofCap, 'roof', (a, b) => Math.min(a.floors, b.floors));

  const podSet = new Set(podiumCells.map(p => ck(p.col, p.row)));
  const exteriorStairs = [];
  live.forEach(b => {
    if (b.floors < 4) return;
    const candidates = [
      { side: 'S', col: b.col + Math.floor(b.w/2), row: b.row + b.d },
      { side: 'N', col: b.col + Math.floor(b.w/2), row: b.row - 1 },
      { side: 'E', col: b.col + b.w,               row: b.row + Math.floor(b.d/2) },
      { side: 'W', col: b.col - 1,                 row: b.row + Math.floor(b.d/2) },
    ];
    for (const cand of candidates) {
      if (podSet.has(ck(cand.col, cand.row))) {
        exteriorStairs.push({ col: cand.col, row: cand.row, side: cand.side, floors: b.floors });
        break;
      }
    }
  });

  const pavilions = [], deckGardens = [];
  const isDeck = (c, r) => podSet.has(ck(c, r));
  const interior = podiumCells.filter(p => {
    let n = 0;
    for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]])
      if (isDeck(p.col+dc, p.row+dr)) n++;
    return n >= 7;
  });
  const taken = new Set();
  interior.forEach(p => {
    const key = ck(p.col, p.row);
    if (taken.has(key)) return;
    const roll = rngC();
    if (roll < 0.06) {
      let ok = true;
      for (const [dc, dr] of [[0,0],[1,0],[0,1],[1,1]])
        if (!isDeck(p.col+dc, p.row+dr) || taken.has(ck(p.col+dc, p.row+dr))) ok = false;
      if (ok) {
        for (const [dc, dr] of [[0,0],[1,0],[0,1],[1,1]]) taken.add(ck(p.col+dc, p.row+dr));
        pavilions.push({ col: p.col, row: p.row, w: 2, d: 2 });
      }
    } else if (roll < 0.34) {
      taken.add(key);
      deckGardens.push({ col: p.col, row: p.row });
    }
  });

  const promenade = [];
  const tallest = live.slice().sort((a, b) => b.floors - a.floors)[0];
  if (tallest && tallest.floors >= 5) {
    const b = tallest;
    const flanks = [{ runC: b.col + b.w, side: 'E' }, { runC: b.col - 1, side: 'W' }];
    for (const flank of flanks) {
      if (flank.runC <= c0 || flank.runC >= cE) continue;
      const steps = Math.min(b.floors, b.d);
      const cand = [];
      let ok = true;
      for (let s = 0; s < steps; s++) {
        const rr = b.row + Math.floor((s / Math.max(1, steps-1)) * (b.d-1));
        if (occ.has(ck(flank.runC, rr)) || !isDeck(flank.runC, rr)) { ok = false; break; }
        cand.push({ col: flank.runC, row: rr, floor: s, side: flank.side });
      }
      if (ok && cand.length >= 3) { promenade.push(...cand); break; }
    }
  }

  return { podiumCells, exteriorStairs, bridges: [...finalBridges, ...finalRoofBridges],
           pavilions, deckGardens, promenade };
}
