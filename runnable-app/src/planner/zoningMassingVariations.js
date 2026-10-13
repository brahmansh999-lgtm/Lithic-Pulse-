// Generates real combinatorial massing candidates from the actual DXF
// zoning data (src/planner/data/massingZones.json — extracted from
// DXF/READ.dxf by scripts/extractMassingZones.mjs), instead of generic
// generateMasterplan() site-plan iterations that never look at the zoning
// at all. Each candidate is a different valid ARRANGEMENT of the same real
// zone categories (units / amenity / green / connector / parking) per
// floor-group — the "possibilities in the zoning" the architect is meant
// to compare, not cosmetic seed noise.
//
// A "possibility" here means: for each of the DXF's 4 floor-groups
// (ground, f1to3, f4to5, f6), which SIDE the units volume sits on, and in
// what ORDER the remaining communal categories tile the other side. The
// DXF only records one fixed arrangement per floor; this sweeps the space
// of other arrangements that keep the same category footprint RATIOS
// (so square-metre programme is preserved) but vary the layout — exactly
// what "iterations within the zoning" should mean for a massing study.

import massingZones from './data/massingZones.json';
import { CELL } from './masterplanGenerator';
import precedents from './data/precedentZoning.json';
import { scoreAgainstGLBShape } from './zoningTargets';

export { precedents };

const FLOOR_GROUPS = ['ground', 'f1to3', 'f4to5', 'f6'];
const CATEGORY_ORDER = ['amenity', 'green', 'connector', 'parking']; // units handled separately, always present

// A reference plot size to lay the normalised (0..1) DXF blocks out on —
// the DXF itself has no real-world plot dimension (room polygons were
// approximate to begin with, see extractMassingZones.mjs), so a fixed,
// plausible footprint is used as the FALLBACK for unlocked sites.
// Variations differ in ARRANGEMENT, not in this base scale.
const PLOT_W_M = 42;
const PLOT_D_M = 30;

// PHASE C — per-class massing plate. For a hard-locked site, the plate is sized
// to the locked class GLB's real BUILDING FOOTPRINT (footprintAreaM2), laid out
// at the GLB's own aspect ratio (from siteSpanM). So Small is massed on Small's
// real ~896 m² plate and XL on its ~5724 m² plate — not the generic 42×30.
//
// Why footprint, not siteSpanM directly: siteSpanM is the GLB's full bounding
// box (e.g. 27×45 = 1215 m² for small), but the building only COVERS
// footprintAreaM2 (~896 m², ~74% of the box) — the rest is setback/overhang.
// The massing engine lays units across the WHOLE plate, so using the raw span
// overshot the real footprint by ~1.8× and dropped convergence. Scaling the
// span down to match footprintAreaM2 (keeping aspect) lands the plan footprint
// on the real building's footprint, which is exactly what scoreAgainstGLBShape
// rewards. Unlocked sites keep the fallback plate.
function plotDimsFor(lockedClass) {
  const span = lockedClass?.siteSpanM;
  const foot = lockedClass?.footprintAreaM2;
  if (span?.w && span?.h && foot) {
    const spanArea = span.w * span.h;
    const k = Math.sqrt(foot / spanArea); // uniform shrink to footprint, aspect kept
    return { w: span.w * k, d: span.h * k };
  }
  return { w: PLOT_W_M, d: PLOT_D_M };
}

function floorBlocks(floorKey) {
  const blocks = {};
  for (const b of Object.values(massingZones.zoneBlocks)) {
    if (b.floorLabel === floorKey) blocks[b.category] = b;
  }
  return blocks;
}

// Deterministic seeded PRNG (mulberry32) — same family used elsewhere in
// the generator, kept local so this module has no cross-dependency beyond
// the zoning data itself.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// MASSING PROFILES — each defines, per floor-group INDEX (0=ground..3=top),
// a units-footprint scale factor (0..1, multiplies the DXF's own
// width/depth fraction) and an edge anchor the shrunk footprint pulls
// towards. This is what actually changes the building's SILHOUETTE between
// candidates: the outer envelope itself steps/cascades/towers differently,
// not just which corner gets which paint colour. Mirrors the real
// step/cascade language masterplanGenerator.js uses for its own buildings
// (PROFILES), reimplemented here against the DXF's 4 floor-groups.
const MASSING_PROFILES = {
  flat:        { scale: [1.00, 1.00, 1.00, 1.00] },              // DXF's own constant footprint
  stepIn:      { scale: [1.00, 0.86, 0.72, 0.58] },               // tapers inward as it rises
  stepOut:     { scale: [0.58, 0.72, 0.86, 1.00] },               // flares outward as it rises (cantilevered upper floors)
  cascade:     { scale: [1.00, 0.80, 1.00, 0.80] },               // alternating setback, terraced look
  hourglass:   { scale: [1.00, 0.65, 0.65, 1.00] },               // pinches at the middle floors
  twinPodium:  { scale: [1.00, 1.00, 0.55, 0.55] },               // full base, slender tower above
};
const PROFILE_NAMES = Object.keys(MASSING_PROFILES);

// Lays out one floor-group's blocks for ONE arrangement choice. The units
// footprint is scaled by the candidate's massing PROFILE at this floor
// index (shrinking it pulls the whole envelope in from one edge — the
// shape that actually reads as different massing) and anchored to
// unitsSide. Communal categories attach as a band along the units block's
// long edge, sized to their DXF share of the FULL plate but never
// exceeding the remaining footprint — they no longer force-fill the
// entire 1x1 square, so floors with a shrunk units volume show real
// negative space (the "exploded" gap), not a same-size box every time.
function layoutFloor(floorKey, unitsSide, unitsMode, scale, order) {
  const blocks = floorBlocks(floorKey);
  const unitsBlock = blocks.units;
  if (!unitsBlock) return null;

  const baseFrac = Math.max(0.15, Math.min(0.85, unitsBlock.w));
  const unitsFrac = Math.max(0.12, baseFrac * scale);
  const present = order.filter(cat => blocks[cat]);
  const horizontal = unitsSide === 'left' || unitsSide === 'right';

  const shares = present.map(cat => Math.max(0.04, blocks[cat].w * blocks[cat].d));
  const shareSum = shares.reduce((s, v) => s + v, 0) || 1;
  const out = [];

  if (unitsMode === 'split') {
    const half = unitsFrac / 2;
    const restFrac = Math.max(0.1, 1 - unitsFrac);
    if (horizontal) {
      out.push({ category: 'units', x: 0, z: 0, w: half, d: 1 });
      out.push({ category: 'units', x: 1 - half, z: 0, w: half, d: 1 });
    } else {
      out.push({ category: 'units', x: 0, z: 0, w: 1, d: half });
      out.push({ category: 'units', x: 0, z: 1 - half, w: 1, d: half });
    }
    let cursor = half;
    present.forEach((cat, i) => {
      const frac = (shares[i] / shareSum) * restFrac;
      if (horizontal) out.push({ category: cat, x: cursor, z: 0, w: frac, d: 1, rooms: blocks[cat].rooms });
      else out.push({ category: cat, x: 0, z: cursor, w: 1, d: frac, rooms: blocks[cat].rooms });
      cursor += frac;
    });
    return out;
  }

  // Single units block, anchored to unitsSide, scaled by the profile.
  // Anchoring (rather than always starting at 0) means a shrunk block on
  // 'right'/'back' still hugs its edge instead of drifting to the corner.
  if (unitsSide === 'left')  out.push({ category: 'units', x: 0, z: 0, w: unitsFrac, d: 1 });
  if (unitsSide === 'right') out.push({ category: 'units', x: 1 - unitsFrac, z: 0, w: unitsFrac, d: 1 });
  if (unitsSide === 'front') out.push({ category: 'units', x: 0, z: 0, w: 1, d: unitsFrac });
  if (unitsSide === 'back')  out.push({ category: 'units', x: 0, z: 1 - unitsFrac, w: 1, d: unitsFrac });

  const restFrac = Math.max(0.1, 1 - unitsFrac);
  let cursor = 0;
  present.forEach((cat, i) => {
    const frac = (shares[i] / shareSum) * restFrac;
    if (horizontal) {
      const x = unitsSide === 'left' ? unitsFrac + cursor : cursor;
      out.push({ category: cat, x, z: 0, w: frac, d: 1, rooms: blocks[cat].rooms });
    } else {
      const z = unitsSide === 'front' ? unitsFrac + cursor : cursor;
      out.push({ category: cat, x: 0, z, w: 1, d: frac, rooms: blocks[cat].rooms });
    }
    cursor += frac;
  });

  return out;
}

const UNIT_SIDES = ['left', 'right', 'front', 'back'];
const UNIT_MODES = ['single', 'single', 'split']; // split is rarer — a deliberate alternative, not the default

// A real building's units stack vertically on a consistent CORE alignment
// (anchored to the same edge) — they don't teleport from one side of the
// plate to another between floors, and a tower doesn't switch from
// single-loaded to double-loaded partway up. But the footprint SIZE at
// each floor-group legitimately changes (setbacks, cascades, podiums are
// real massing moves), which is what MASSING_PROFILES drives. Per
// candidate: ONE unitsSide + unitsMode + massing profile for the whole
// stack (the structural constraint), with communal category order still
// free to vary floor-to-floor (different amenity mix at different
// heights is normal). 4 sides x 2 modes x 6 profiles = 48 structurally
// distinct silhouettes before communal ordering even varies — this is
// what makes massing changes actually look different from each other.
// The zoning diagram fixes WHERE the Units zone is and roughly how big its
// region is — it does not fix how many actual units, or what size, go
// inside that region. That choice belongs to the generator (us), and it's
// the real source of "infinite variation" within one fixed zoning: the
// same Units region can be subdivided into few large units or many small
// ones. densityFactor scales the baseline units-per-m2 estimate across a
// realistic range spanning the real bldg_gl precedents' own measured
// densities (45-348 units over 896-5867 m2, i.e. ~0.02-0.06 units/m2), so
// every candidate is a plausible real building, not an arbitrary number.
const MIN_DENSITY = 0.018;
const MAX_DENSITY = 0.062;

function buildCandidate(seed) {
  const rng = mulberry32(seed);
  const unitsSide = UNIT_SIDES[Math.floor(rng() * UNIT_SIDES.length)];
  const unitsMode = UNIT_MODES[Math.floor(rng() * UNIT_MODES.length)];
  const profileName = PROFILE_NAMES[Math.floor(rng() * PROFILE_NAMES.length)];
  const profile = MASSING_PROFILES[profileName];
  const densityFactor = MIN_DENSITY + rng() * (MAX_DENSITY - MIN_DENSITY);
  const floors = FLOOR_GROUPS.map((key, idx) => {
    const order = shuffle(CATEGORY_ORDER, rng);
    const scale = profile.scale[idx];
    const blocks = layoutFloor(key, unitsSide, unitsMode, scale, order);
    return { key, unitsSide, unitsMode, scale, blocks };
  }).filter(f => f.blocks);

  return { seed, unitsSide, unitsMode, profileName, densityFactor, floors };
}

// Minimum sane footprint fraction for any block — anything thinner than
// this reads as an unbuildable sliver, not a real room/zone. "parking" is
// exempt: in the DXF it's a single basement-entry marker (~1.5% of the
// floor plate, see massingZones.json "CAR PARK BASEMENT ENTRY"), not a
// room volume, so it never passes a room-scale sliver test and shouldn't
// be expected to.
const MIN_BLOCK_FRAC = 0.08;
const SLIVER_EXEMPT_CATEGORIES = new Set(['parking']);

// "connector" is the corridor — the room that actually serves the units,
// so a polished layout keeps it touching every units volume on the floor
// (no other category wedged between them, which would mean units are
// reached through someone else's room). Checked along whichever axis the
// floor plate is split on; 'split' mode has two units volumes, both must
// touch the connector for the floor to count as adjacent.
function connectorTouchesUnits(blocks, horizontal) {
  const unitsBlocks = blocks.filter(b => b.category === 'units');
  const connector = blocks.find(b => b.category === 'connector');
  if (!unitsBlocks.length || !connector) return true; // nothing to check this floor
  const EPS = 0.01;
  const touches = (units) => horizontal
    ? Math.abs(connector.x - (units.x + units.w)) < EPS || Math.abs((connector.x + connector.w) - units.x) < EPS
    : Math.abs(connector.z - (units.z + units.d)) < EPS || Math.abs((connector.z + connector.d) - units.z) < EPS;
  return unitsBlocks.every(touches);
}

// Real-quality gate + score (0-100). Hard-fails (returns null) candidates
// that wouldn't read as polished, buildable massing:
//   - every floor-group must have resolved (no dropped data)
//   - the units volume must stack on the SAME footprint plan-to-plan
//     (col/row/w/d consistent in cell terms after rounding) — a real
//     structural stack, not floors that don't line up
//   - no block (including units) thinner than MIN_BLOCK_FRAC in either
//     dimension — no sliver rooms
// Score combines two things that actually vary between candidates:
//   - footprint fidelity: how close each block's area stays to the DXF
//     source's own measured share (every candidate is close by
//     construction, so this mostly rewards rounding stability)
//   - circulation adjacency: how many floor-groups keep the connector
//     (corridor) directly touching the units it serves, rather than
//     separated by another room — the one thing in the original DXF
//     layout that any real, usable rearrangement should preserve.
function unitsFootprintsOf(blocks, wCells, dCells) {
  return blocks
    .filter(b => b.category === 'units')
    .map(b => ({
      col: Math.round(b.x * wCells), row: Math.round(b.z * dCells),
      w: Math.max(1, Math.round(b.w * wCells)), d: Math.max(1, Math.round(b.d * dCells)),
    }))
    .sort((a, b) => a.col - b.col || a.row - b.row);
}

// A real stepped/cascading tower keeps its units volume anchored to the
// SAME edge of the plate on every floor — only the size shrinks/grows
// (setbacks), the anchored edge coordinate never moves. unitsSide picks
// which coordinate is the anchor: 'left'/'right' anchor col (the x edge),
// 'front'/'back' anchor row (the z edge). This is the real structural
// constraint a step/cascade profile must satisfy to still read as one
// coherent building rather than floors that don't line up at all.
function anchoredAlignment(footprints, unitsSide) {
  const anchorOf = (f) => {
    if (unitsSide === 'left')  return f.col;
    if (unitsSide === 'right') return f.col + f.w;
    if (unitsSide === 'front') return f.row;
    return f.row + f.d; // 'back'
  };
  return footprints.map(anchorOf);
}
const sameValues = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= 1);

function evaluateCandidate(candidate, wCells, dCells) {
  if (candidate.floors.length !== FLOOR_GROUPS.length) return null;

  const horizontal = candidate.unitsSide === 'left' || candidate.unitsSide === 'right';
  let firstAlignment = null;
  let shareError = 0;
  let shareCount = 0;
  let adjacentFloors = 0;

  for (const f of candidate.floors) {
    for (const b of f.blocks) {
      if (!SLIVER_EXEMPT_CATEGORIES.has(b.category) && (b.w < MIN_BLOCK_FRAC || b.d < MIN_BLOCK_FRAC)) return null;

      const dxfBlock = floorBlocks(f.key)[b.category];
      if (dxfBlock) {
        const dxfShare = Math.max(0.01, dxfBlock.w * dxfBlock.d);
        const thisShare = b.w * b.d;
        shareError += Math.abs(thisShare - dxfShare) / dxfShare;
        shareCount += 1;
      }
    }

    if (connectorTouchesUnits(f.blocks, horizontal)) adjacentFloors += 1;

    const footprints = unitsFootprintsOf(f.blocks, wCells, dCells);
    const alignment = anchoredAlignment(footprints, candidate.unitsSide);
    if (firstAlignment == null) {
      firstAlignment = alignment;
    } else if (!sameValues(alignment, firstAlignment)) {
      return null; // units volume drifted off its anchor edge between floor-groups — not a real stack
    }
  }

  const avgShareError = shareCount ? shareError / shareCount : 0;
  const fidelityScore = Math.max(0, 100 - Math.min(100, avgShareError * 100));
  const adjacencyScore = (adjacentFloors / candidate.floors.length) * 100;
  // Reward genuine massing variety: profiles that actually change footprint
  // size between floor-groups (real setbacks) score slightly higher than
  // 'flat' once the structural/adjacency gates are already satisfied — the
  // point of this whole feature is candidates that look different, so a
  // tie should favour the one with more visible massing variation.
  const scales = candidate.floors.map(f => f.scale);
  const variety = Math.max(...scales) - Math.min(...scales);
  const varietyBonus = Math.round(variety * 15);
  return Math.round(fidelityScore * 0.35 + adjacencyScore * 0.5) + varietyBonus;
}

// Converts one candidate's floor arrangements into a generateMasterplan-
// shaped plan { buildings:[{col,row,w,d,floors,units}], totalUnits,
// floors:{max}, greenPercent } so it stays compatible with ColumnStage's
// attachColumnGrids (which only looks at building footprints) without
// requiring a second incompatible data shape downstream. Only the UNITS
// block per floor-group becomes a real "building" (the structural volume
// columns get fitted to); communal/green/parking blocks are massing
// context only, not column-bearing structure.
const TOTAL_FLOOR_COUNT = massingZones.floorCount || 7;
const FLOOR_SPANS = { ground: 1, f1to3: 3, f4to5: 2, f6: 1 };

function toPlan(candidate, plotDims = { w: PLOT_W_M, d: PLOT_D_M }, floorCountOverride = null) {
  const wCells = Math.round(plotDims.w / CELL);
  const dCells = Math.round(plotDims.d / CELL);

  const buildings = candidate.floors.flatMap((f) => {
    const unitsBlocks = f.blocks.filter(b => b.category === 'units');
    const floorSpan = FLOOR_SPANS[f.key] || 1;
    return unitsBlocks.map((unitsBlock, bi) => {
      const col = Math.round(unitsBlock.x * wCells);
      const row = Math.round(unitsBlock.z * dCells);
      const w = Math.max(1, Math.round(unitsBlock.w * wCells));
      const d = Math.max(1, Math.round(unitsBlock.d * dCells));
      const areaM2 = (w * CELL) * (d * CELL) * floorSpan;
      const unitCount = Math.max(1, Math.round(areaM2 * candidate.densityFactor));
      return {
        col, row, w, d,
        floors: floorSpan,
        units: Array.from({ length: unitCount }, (_, i) => ({ id: `${f.key}-${bi}-${i}` })),
        floorGroupKey: f.key,
      };
    });
  });

  const totalUnits = buildings.reduce((s, b) => s + b.units.length, 0);
  const communalFrac = candidate.floors.flatMap(f => f.blocks)
    .filter(b => b.category === 'green')
    .reduce((s, b) => s + b.w * b.d, 0) / candidate.floors.length;

  // Real building footprint = the ground-level PLATE (all categories fill it at
  // ground), which is the plot area itself — directly comparable to the GLB's
  // own footprintAreaM2 (whole-building ground coverage). The per-floor-group
  // `buildings` above are UNITS-only sub-volumes for column placement; they are
  // NOT the footprint (summing them counts the stack many times — see the note
  // in scoreAgainstGLBShape). Computed once here from the actual plate so the
  // convergence score compares like-for-like.
  const footprintM2 = Math.round((wCells * CELL) * (dCells * CELL));

  return {
    buildings,
    totalUnits,
    footprintM2,
    floors: { max: floorCountOverride || TOTAL_FLOOR_COUNT },
    greenPercent: Math.round(Math.min(100, communalFrac * 100)),
    zoningFloors: candidate.floors, // raw per-floor-group zone blocks, for the isometric preview
  };
}

// Not every real bldg_gl precedent physically fits the current site — a
// precedent's siteSpanM is the real building's own measured footprint
// envelope, and a candidate massing can only converge toward one that
// actually fits within the site bounds (with a little slack for setbacks/
// access, not an exact match). Keeps the 4 closest-fitting precedents
// (by how much smaller their span is than the site, i.e. how much of the
// site they'd actually use) — this is the realistic candidate pool, not
// all 11 regardless of whether they'd ever be buildable here.
const SITE_FIT_COUNT = 4;
const SITE_FIT_MARGIN = 1.08; // 8% slack — setbacks/access aren't modelled here

function fitsSite(precedent, siteBounds) {
  if (!siteBounds?.widthM || !siteBounds?.depthM || !precedent.siteSpanM) return true;
  const { w, h } = precedent.siteSpanM;
  const fitsAsIs = w <= siteBounds.widthM * SITE_FIT_MARGIN && h <= siteBounds.depthM * SITE_FIT_MARGIN;
  const fitsRotated = h <= siteBounds.widthM * SITE_FIT_MARGIN && w <= siteBounds.depthM * SITE_FIT_MARGIN;
  return fitsAsIs || fitsRotated;
}

function siteFitPrecedents(siteBounds) {
  if (!siteBounds?.widthM || !siteBounds?.depthM) return precedents.slice(0, SITE_FIT_COUNT);
  const siteArea = siteBounds.widthM * siteBounds.depthM;
  const fitting = precedents.filter(p => fitsSite(p, siteBounds));
  const pool = fitting.length ? fitting : precedents; // nothing fits cleanly — fall back to the full set rather than showing zero options
  return [...pool]
    .sort((a, b) => Math.abs((a.footprintAreaM2 ?? 0) - siteArea) - Math.abs((b.footprintAreaM2 ?? 0) - siteArea))
    .slice(0, SITE_FIT_COUNT);
}

// Scores a plan against the site-fitting bldg_gl precedents and returns
// the best-matching one + its score — this is the "does this candidate
// converge toward a real building we've already got that could actually
// stand here" signal. Whichever candidate's bestGlbScore is highest
// overall is the one that gets called out as "this is how the real
// building was reached" (see MassingStage).
function bestGLBMatch(plan, candidatePrecedents) {
  let best = null;
  for (const precedent of candidatePrecedents) {
    const glbScore = scoreAgainstGLBShape(plan, precedent);
    if (!best || glbScore > best.glbScore) best = { precedent, glbScore };
  }
  return best;
}

// designRulesScore(candidate, designRules) → 0-30 bonus added to a
// candidate's base score when it structurally matches the architect's
// approved zoning rules for this site/typology.
//
// fixedCoreCount=1 (small/medium): rewards 'single' unitsMode — one
//   compact units block that needs only one core. Penalises 'split' mode
//   (two separate blocks = two separate cores, contradicts the brief).
// fixedCoreCount=2 (large): rewards 'split' unitsMode OR wide unitsFrac
//   (a large enough single block that genuinely needs two cores). Penalises
//   overly compact single blocks.
// noiseClusterCorner: rewards unitsSide that pushes the units AWAY from
//   the noise corner (units on the quiet side = noise corner left free for
//   vehicular/communal). 'sw' corner = units should be on 'right'/'back'
//   (east/north faces). 'se' → 'left'/'back'. 'nw' → 'right'/'front'.
//   'ne' → 'left'/'front'.
// communalCorner: rewards arrangements where the communal/green block
//   (the non-units portion) lands on the corner's side — 'sw' → green
//   should be on 'left'/'front' sides.
// Compass↔side convention (shared across all rule checks):
//   left = West · right = East · front = South · back = North
const SIDE_FOR_COMPASS = { west: 'left', east: 'right', south: 'front', north: 'back' };
// The side opposite a given units side — i.e. where the communal/non-units
// volume lands when units anchor to `unitsSide`.
const OPPOSITE_SIDE = { right: 'left', left: 'right', back: 'front', front: 'back' };

function designRulesScore(candidate, designRules) {
  if (!designRules) return 0;
  let bonus = 0;

  const {
    fixedCoreCount, noiseClusterCorner, communalCorner,
    communityZoneSide, vehicularCorner, viewAzimuth, voidSolidVariance,
  } = designRules;

  if (fixedCoreCount === 1) {
    bonus += candidate.unitsMode === 'single' ? 20 : -10;
  } else if (fixedCoreCount === 2) {
    bonus += candidate.unitsMode === 'split' ? 20
      : (candidate.floors[0]?.blocks.find(b => b.category === 'units')?.w ?? 0) > 0.6 ? 10
      : -5;
  }

  // noiseClusterCorner → units face AWAY from that corner
  const QUIET_SIDES = { sw: ['right', 'back'], se: ['left', 'back'], nw: ['right', 'front'], ne: ['left', 'front'] };
  if (noiseClusterCorner && QUIET_SIDES[noiseClusterCorner]) {
    bonus += QUIET_SIDES[noiseClusterCorner].includes(candidate.unitsSide) ? 10 : 0;
  }

  // communalCorner → communal/green block should be on that corner's sides
  const COMMUNAL_SIDES = { sw: ['left', 'front'], se: ['right', 'front'], nw: ['left', 'back'], ne: ['right', 'back'] };
  const communalIsOn = OPPOSITE_SIDE[candidate.unitsSide]; // communal = non-units side
  if (communalCorner && COMMUNAL_SIDES[communalCorner]) {
    bonus += COMMUNAL_SIDES[communalCorner].includes(communalIsOn) ? 10 : 0;
  }

  // ── Phase D rules ──────────────────────────────────────────────────────

  // communityZoneSide → the community/amenity (non-units) volume should land
  // on that compass face. Medium sketch: community in the East. Reuses the
  // same "communal is the side opposite units" logic as communalCorner.
  //
  // DELIBERATELY WEAKER than noise/vehicular (decision 2026-07-01): the medium
  // sketch asks for BOTH "community in the East" AND "vehicular+noise to the SW
  // corner", which both contend for the single non-units edge. Architect call:
  // noise/vehicular WINS — quiet dwellings off the SW corner dominate; community
  // -East is only a soft preference that breaks ties when the quiet-side rule is
  // already satisfied (so it won't drag units onto the noise corner just to put
  // amenity east). Hence reward 6, vs noise 10 + vehicular 8.
  if (communityZoneSide && SIDE_FOR_COMPASS[communityZoneSide]) {
    bonus += communalIsOn === SIDE_FOR_COMPASS[communityZoneSide] ? 6 : 0;
  }

  // vehicularCorner → units face AWAY from the vehicular corner (same geometry
  // as noiseClusterCorner: keep the vehicular corner free of dwellings). Kept
  // separate so the rule reads explicitly even when it coincides with noise.
  if (vehicularCorner && QUIET_SIDES[vehicularCorner]) {
    bonus += QUIET_SIDES[vehicularCorner].includes(candidate.unitsSide) ? 8 : 0;
  }

  // viewAzimuth → units (and their balconies) should open toward the view
  // face, so the protected outlook (river/east) is the one the homes look at.
  if (viewAzimuth != null) {
    const viewCompass = ['north', 'east', 'south', 'west'][Math.round(((viewAzimuth % 360) + 360) % 360 / 90) % 4];
    bonus += candidate.unitsSide === SIDE_FOR_COMPASS[viewCompass] ? 10 : 0;
  }

  // voidSolidVariance → "voids + solids to break monotony": reward candidates
  // whose massing PROFILE genuinely steps/cascades (real footprint variation
  // between floor-groups) over a flat extrusion. Variance = how much the
  // per-floor scale actually moves.
  if (voidSolidVariance) {
    const scales = candidate.floors.map(f => f.scale);
    const variance = Math.max(...scales) - Math.min(...scales);
    bonus += Math.round(variance * 20); // 0 for flat, up to ~8-9 for strong steps
  }

  return bonus;
}

// generateZoningMassingVariations({ keep, siteBounds, designRules, lockedClass }) →
// real arrangement variations of the DXF zoning data, now biased by the
// architect's approved design rules (fixedCoreCount, noiseClusterCorner,
// communalCorner from the Zoning stage). Candidates that structurally
// match the rules rank higher; the rest remain as alternatives.
//
// HARD LOCK (Phase B): when lockedClass is supplied (a record from
// classPrecedents.json, via classGeometry(site's class)), every candidate is
// scored against THAT ONE GLB only — never the stat-closest of the 11 generic
// precedents. This is invariant I2: on the Small site every massing variation
// converges toward glbsmall, never another class. Without a lock (unlocked
// sites) it falls back to the legacy site-fit pool.
export function generateZoningMassingVariations({ keep = 20, siteBounds = null, designRules = null, lockedClass = null } = {}) {
  // PHASE C: plate dimensions come from the locked class's own GLB footprint
  // (siteSpanM), so the massing is laid out at the real building's proportions.
  const plotDims = plotDimsFor(lockedClass);
  const wCells = Math.round(plotDims.w / CELL);
  const dCells = Math.round(plotDims.d / CELL);
  // Locked → the only precedent is this site's class GLB. Unlocked → legacy pool.
  const candidatePrecedents = lockedClass ? [lockedClass] : siteFitPrecedents(siteBounds);
  const candidates = [];
  const seen = new Set();
  let seed = 1;
  while (candidates.length < keep && seed < keep * 40) {
    const candidate = buildCandidate(seed);
    seed += 1;
    if (!candidate.floors.length) continue;
    const key = `${candidate.unitsMode}|${Math.round(candidate.densityFactor * 1000)}|` +
      candidate.floors.map(f => `${f.key}:${f.unitsSide}:${f.blocks.map(b => b.category).join(',')}`).join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    const score = evaluateCandidate(candidate, wCells, dCells);
    if (score == null) continue;
    const plan = toPlan(candidate, plotDims, lockedClass?.floorCount ?? null);
    const { precedent: matchedGLB, glbScore } = bestGLBMatch(plan, candidatePrecedents);
    // Design-rules bonus (0..~50): how well this candidate satisfies the
    // architect's approved rules. Folded into BOTH the zoning score (legacy)
    // and a blended rank score below.
    const ruleBonus = designRulesScore(candidate, designRules);
    // PHASE D: rank by a BLEND of GLB convergence and rule-fit, not glbScore
    // alone. Previously glbScore strictly dominated and ruleBonus only broke
    // exact glbScore ties — so toggling a rule almost never changed which
    // iterations surfaced, defeating the point of the rules. RULE_RANK_WEIGHT
    // lets rule-consistency reorder candidates WITHIN a convergence band
    // (~±8 GLB-points) without ever floating a poorly-converging candidate to
    // the top: a candidate 10%+ better-fitting still wins regardless of rules.
    const RULE_RANK_WEIGHT = 0.28; // ruleBonus ~50 → up to ~14 rank points
    const rankScore = glbScore + ruleBonus * RULE_RANK_WEIGHT;
    candidates.push({ seed: candidate.seed, plan, score: score + ruleBonus, rankScore, candidate, matchedGLB, glbScore });
  }

  // Rank by the blended convergence+rules score (Phase D), zoning score as final tiebreaker.
  candidates.sort((a, b) => b.rankScore - a.rankScore || b.score - a.score);
  const variations = candidates.slice(0, keep).map((c, i) => ({
    ...c,
    variationLabel: `Variation ${String.fromCharCode(65 + i)}`,
  }));

  const bestMatch = variations[0] || null;

  return { variations, bestMatch, candidatePrecedents };
}
