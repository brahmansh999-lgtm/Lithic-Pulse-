// glbProgramme — the real per-class programme (footprint, floor count, green/
// community position, service-core position), sourced directly from the
// actual GLB geometry for each building class (classPrecedents.json +
// massingBlocks.json, both produced by scripts/extractZoning.mjs and
// scripts/extractProgramme3.mjs against the real .glb files in BLDGS/).
//
// This is what "iteration 1" for both Zoning and Massing is built from —
// the real massing the GLB actually provides for that site's class, not a
// hand-guessed template. Everything downstream (the other 9/99 iterations)
// perturbs away from this real baseline.
import classPrecedents from './data/classPrecedents.json';
import massingBlocks from './data/massingBlocks.json';
import programmeSmall from './data/programmeSmall.json';
import programmeMedium from './data/programmeMedium.json';
import programmeLarge from './data/programmeLarge.json';
import programmeXl from './data/programmeXl.json';
import programmeIteration1 from './data/programmeIteration1.json';
import programmeIteration2 from './data/programmeIteration2.json';
import programmeIteration3 from './data/programmeIteration3.json';
import programmeIteration4 from './data/programmeIteration4.json';
import programmeIteration5 from './data/programmeIteration5.json';
import programmeIteration8 from './data/programmeIteration8.json';
import programmeIteration11 from './data/programmeIteration11.json';

// medium was historically the odd one out — MassingStage.jsx carried its own
// inline RAW_FLOORS literal instead of a data/programme*.json file, so
// ZoningPlan.jsx's realZoningBoxesForClass('medium') fell through to the
// coarser glbProgrammeForClass() derivation while MassingStage.jsx rendered
// the finer-grained RAW_FLOORS — two different derivations of "the same"
// building. programmeMedium.json is that same RAW_FLOORS data, extracted
// into the shared data file so all 4 classes go through one path.
const REAL_FLOORS_BY_CLASS = {
  small: programmeSmall, medium: programmeMedium, large: programmeLarge, xl: programmeXl,
  // Recovered originals (bldg_gl/iteration N.glb, restored from the Recycle
  // Bin — see MEMORY: seed-building expansion). Same extraction script/
  // fidelity as the 4 classes above, no synthesized approximation.
  iteration1: programmeIteration1, iteration2: programmeIteration2, iteration3: programmeIteration3,
  iteration4: programmeIteration4, iteration5: programmeIteration5, iteration8: programmeIteration8,
  iteration11: programmeIteration11,
};

// The real per-unit-cell floor breakdown for small/large/xl — every box here
// is a real, individually-clustered mesh bounding box from that class's
// actual GLB (scripts/extractProgramme4.mjs: internal_walls + floor-plate
// meshes clustered into unit cells per real floor level, same method
// scripts/extractProgramme3.mjs used to produce medium's RAW_FLOORS), not a
// single whole-building envelope box. Floor count/heights come from the
// real detected floor-slab levels in the GLB, not an assumed uniform value.
// The extraction script (extractProgramme3/4.mjs) occasionally re-clusters
// the same physical room twice, emitting two boxes at the exact same
// x0/x1/z0/z1 on the same floor — a real, measured bug, not a legitimate
// second room. Left in, two identical boxes get subdivided/merged
// independently downstream (dwellings.js, realRoomVariations.js) and render
// as two fully overlapping volumes at the same footprint (e.g. a real,
// measured case: a double-height merge picks one copy while its exact twin
// still gets sliced into ordinary dwellings, so a solid double-height block
// and a stack of small dwelling boxes occupy the identical footprint and
// visibly cut through each other). Deduping per floor here — the single
// choke point every consumer of real floor data passes through — fixes it
// everywhere at once instead of requiring every downstream consumer to
// defend against it separately.
function dedupeFloorBoxes(floors) {
  return floors.map((fl) => {
    const seen = new Set();
    const boxes = fl.boxes.filter((b) => {
      const key = `${b.type}|${b.x0.toFixed(2)}|${b.x1.toFixed(2)}|${b.z0.toFixed(2)}|${b.z1.toFixed(2)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { ...fl, boxes };
  });
}

export function realFloorsForClass(sizeClass) {
  const prog = REAL_FLOORS_BY_CLASS[sizeClass];
  const mb = massingBlocks[sizeClass];
  if (!prog?.floors?.length || !mb) return null;
  const bounds = mb.bounds;
  const centre = { x: (bounds.x0 + bounds.x1) / 2, z: (bounds.z0 + bounds.z1) / 2 };
  return { floors: dedupeFloorBoxes(prog.floors), centre };
}

// The real ground-floor unit/service/community cell boxes for small/large/
// xl, normalized to nx/nz/nw/nd fractions the same way ZoningPlan's
// PROG_BOXES/glbProgrammeForClass boxes are — so the 2D zoning diagram shows
// the actual real per-unit cells extracted from the GLB (see
// realFloorsForClass above) instead of one whole-building envelope blob.
export function realZoningBoxesForClass(sizeClass) {
  const real = realFloorsForClass(sizeClass);
  const mb = massingBlocks[sizeClass];
  if (!real || !mb) return null;
  const ground = real.floors[0];
  if (!ground?.boxes?.length) return null;
  const bounds = mb.bounds;
  const w = bounds.x1 - bounds.x0, d = bounds.z1 - bounds.z0;
  const bcx = (bounds.x0 + bounds.x1) / 2, bcz = (bounds.z0 + bounds.z1) / 2;
  // The 2D zoning diagram only knows 4 zone types (units/green/semiopen/
  // services) — 'circulation' is a massing-level connective surface, not a
  // programme zone, so it's dropped here; 'balcony' maps onto 'semiopen'
  // (the closest existing concept: private/semi-private outdoor space).
  return ground.boxes
    .filter(b => b.type !== 'circulation')
    .map(b => ({
    type: b.type === 'community' ? 'green' : b.type === 'balcony' ? 'semiopen' : b.type,
    nx: ((b.x0 + b.x1) / 2 - bcx) / w,
    nz: ((b.z0 + b.z1) / 2 - bcz) / d,
    // Real community/podium footprints can span most of the ground floor
    // (a real, large XL-class podium is genuinely ~70% of the footprint) —
    // cap the drawn blob at 0.6 of the footprint per axis, same ceiling
    // glbProgrammeForClass already uses, so the 2D diagram stays legible
    // rather than one zone visually swallowing the whole plan.
    nw: b.type === 'community' ? Math.min((b.x1 - b.x0) / w, 0.6) : (b.x1 - b.x0) / w,
    nd: b.type === 'community' ? Math.min((b.z1 - b.z0) / d, 0.6) : (b.z1 - b.z0) / d,
  }));
}

function findBlock(blocks, names) {
  return blocks.find(b => names.includes(b.name));
}

// Normalize a real metres bbox to a -0.5..0.5 fraction of the class's own
// footprint bounds — same nx/nz/nw/nd convention PROG_BOXES already uses.
function normalizeBlock(block, bounds) {
  if (!block) return null;
  const w = bounds.x1 - bounds.x0, d = bounds.z1 - bounds.z0;
  const bcx = (bounds.x0 + bounds.x1) / 2, bcz = (bounds.z0 + bounds.z1) / 2;
  return {
    nx: ((block.x0 + block.x1) / 2 - bcx) / w,
    nz: ((block.z0 + block.z1) / 2 - bcz) / d,
    nw: (block.x1 - block.x0) / w,
    nd: (block.z1 - block.z0) / d,
  };
}

function mergeBoxes(a, b) {
  if (!a) return b;
  if (!b) return a;
  return {
    x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1),
    z0: Math.min(a.z0, b.z0), z1: Math.max(a.z1, b.z1),
  };
}

// The real 'staircase' mesh extracted per class — used by MassingStage.jsx's
// per-wing stair core (see zoningGraph.js's CORE_ZONE_TYPES) INSTEAD OF a
// rule-based estimate, wherever it's trustworthy. Checked across all 11
// extracted classes: small/medium/iteration11 give a believable single-
// flight-plus-landing footprint (12.15/13.23/13.23 m² — consistent with each
// other, and with a real UK residential stair), but large/xl/iteration4/5/8
// come back at 340-727 m², a large fraction of the whole floor plate — the
// mesh clustering merged the stair with something else, not a real stair
// footprint. STAIR_SANE_MAX_M2 rejects those; callers fall back to the
// rule-based estimate on rejection or when no 'staircase' block exists at
// all (7 of 11 classes). The 'lift' mesh has no equivalent — it is an
// unreliable lobby/reach-volume artifact in EVERY class that has one (26 to
// 2264 m² for a single lift), never a real shaft footprint, so there is no
// realLiftAreaForClass: the lift core is always the rule-based estimate.
const STAIR_SANE_MAX_M2 = 20;
export function realStairAreaForClass(sizeClass) {
  const mb = massingBlocks[sizeClass];
  const stair = mb && findBlock(mb.blocks, ['staircase']);
  if (!stair) return null;
  const area = (stair.x1 - stair.x0) * (stair.z1 - stair.z0);
  return area > 0 && area <= STAIR_SANE_MAX_M2 ? area : null;
}

// Real circulation width per class, measured from that class's own real
// 'circulation' boxes (realFloorsForClass — the actual leftover slab area
// between real rooms, see scripts/extractProgramme4.mjs). Checked directly
// against the extracted data: real circulation reads 3-16m across (open
// lobby/landing space), not a narrow single-loaded corridor — MassingStage's
// carveWingCorridor used to hardcode 1.2m for every class regardless, which
// is why the generated corridor looked like a thin disconnected sliver next
// to the real architecture around it. Averages each real circulation box's
// OWN narrower side (so a long corridor doesn't get counted as wide just
// because it's long), across every floor that has any. LHDG's 1.2m minimum
// walkable width is still the floor if a class's real average somehow came
// back under it; 3.5m (the small/medium ballpark) is the fallback for a
// class with no real circulation boxes at all (medium has none extracted).
const CORRIDOR_WIDTH_FALLBACK_M = 3.5;
const CORRIDOR_WIDTH_MIN_M = 1.2;
export function realCorridorWidthForClass(sizeClass) {
  const real = realFloorsForClass(sizeClass);
  if (!real?.floors?.length) return CORRIDOR_WIDTH_FALLBACK_M;
  const widths = [];
  for (const fl of real.floors) {
    for (const b of fl.boxes ?? []) {
      if (b.type !== 'circulation') continue;
      widths.push(Math.min(b.x1 - b.x0, b.z1 - b.z0));
    }
  }
  if (!widths.length) return CORRIDOR_WIDTH_FALLBACK_M;
  const avg = widths.reduce((s, w) => s + w, 0) / widths.length;
  return Math.max(CORRIDOR_WIDTH_MIN_M, avg);
}

const CACHE = {};

// glbProgrammeForClass('medium') → real footprint dims, floor count, and
// normalized green/services zone positions for that class, plus derived
// units/semiopen boxes filling the remaining footprint around them (the
// GLB doesn't tag a separate "units" node distinct from the whole floor
// plate, so those two are placed complementary to the real green/core
// positions rather than independently guessed).
export function glbProgrammeForClass(sizeClass) {
  if (CACHE[sizeClass]) return CACHE[sizeClass];
  const prec = classPrecedents.find(r => r.sizeClass === sizeClass);
  const mb = massingBlocks[sizeClass];
  if (!prec || !mb) return null;

  const bounds = mb.bounds;
  const widthM = bounds.x1 - bounds.x0;
  const depthM = bounds.z1 - bounds.z0;
  const footprintArea = widthM * depthM;

  // Some extracted nodes (e.g. "lift" on the large/xl GLBs) come back with
  // an anomalously huge bbox — likely a lift-lobby/shaft-reach volume, not
  // the lift itself — that swallows most of the floor plate and collapses
  // the service core onto the green zone. Discard any candidate box whose
  // footprint area is implausibly large for what it's meant to represent.
  const blockArea = (b) => b ? (b.x1 - b.x0) * (b.z1 - b.z0) : 0;
  const sane = (b, maxFrac) => (b && blockArea(b) / footprintArea <= maxFrac) ? b : null;

  const community = sane(findBlock(mb.blocks, ['community_space', 'PLINTH']), 0.55);
  const stair = sane(findBlock(mb.blocks, ['staircase']), 0.20);
  const lift = sane(findBlock(mb.blocks, ['lift']), 0.12);
  const core = mergeBoxes(stair, lift);
  const walls = findBlock(mb.blocks, ['EXTERNAL_WALLS', 'external_wall']);

  const green = normalizeBlock(community, bounds) ?? { nx: 0, nz: 0.3, nw: 0.3, nd: 0.35 };
  const rawServices = normalizeBlock(core, bounds) ?? { nx: 0, nz: 0, nw: 0.08, nd: 0.1 };
  // Cap final sizes too, independent of the raw sanity filter above, so the
  // rendered zones always stay legible relative to the whole footprint.
  const services = { ...rawServices, nw: Math.min(rawServices.nw, 0.22), nd: Math.min(rawServices.nd, 0.22) };
  green.nw = Math.min(green.nw, 0.6);
  green.nd = Math.min(green.nd, 0.6);

  // Units = the real EXTERNAL_WALLS envelope, i.e. the actual boundary box
  // the GLB's exterior wall meshes occupy — not a guessed pair of lobes.
  // This is the literal boundary-box-from-the-GLB the massing/zoning should
  // be built from; green/services sit inside it at their real positions.
  const envelope = normalizeBlock(walls, bounds) ?? { nx: 0, nz: 0, nw: 0.94, nd: 0.94 };
  const boxes = [
    { type: 'units', ...envelope },
    { type: 'green', ...green },
    { type: 'semiopen', nx: green.nx, nz: green.nz + (services.nz >= green.nz ? -1 : 1) * (green.nd / 2 + 0.10), nw: Math.max(0.16, green.nw * 0.55), nd: 0.14 },
    { type: 'services', ...services },
  ];

  const result = {
    sizeClass,
    widthM, depthM,
    floorCount: prec.floorCount,
    footprintAreaM2: prec.footprintAreaM2,
    greenAreaM2: community ? (community.x1 - community.x0) * (community.z1 - community.z0) : 0,
    boxes,
  };
  CACHE[sizeClass] = result;
  return result;
}

// The real, measured column positions from that class's actual GLB —
// scripts/extractZoning.mjs walked every column mesh and recorded its XZ
// centre, normalized 0..1 against the SAME bounding box used everywhere
// else in this module. Converted here to the same "centred at 0, local
// metres" frame the massing footprint boxes use (nx-0.5)*widthM, so a
// caller can drop these directly into the identical worldGroup transform
// as the massing and have them land in exactly the right place — not an
// approximation, the real measured structural grid for that real building.
export function realColumnPositionsForClass(sizeClass) {
  const prec = classPrecedents.find(r => r.sizeClass === sizeClass);
  const mb = massingBlocks[sizeClass];
  if (!prec?.columnPositions?.length || !mb) return null;
  const widthM = mb.bounds.x1 - mb.bounds.x0;
  const depthM = mb.bounds.z1 - mb.bounds.z0;
  return prec.columnPositions.map(p => ({
    x: (p.x - 0.5) * widthM,
    z: (p.z - 0.5) * depthM,
  }));
}

// The REAL measured vertical extent + radius of this class's columns, straight
// from the GLB's "columns" block in massingBlocks.json — so the Columns stage
// can draw each column at its true height/base/thickness ("as is") instead of
// an arbitrary thin rod spanning the whole building. The block's y0/y1 is the
// real column run (base → top); the per-column radius isn't stored per mesh,
// so we derive a proportionate real-world radius from the actual grid spacing
// (nearest-neighbour distance) — a real structural ratio, not an invented one.
// The REAL building envelope for this class — the full GLB bounding box from
// massingBlocks.json, in the same absolute-metre frame as the massing floor
// boxes and the columns. This is the TRUE outline of the building: the
// detailed per-unit-cell massing (RAW_FLOORS / programme*.json) is only the
// INNER cell cluster, ~several metres smaller than the real walls, which is
// why real perimeter columns landed OUTSIDE it. Rendering this envelope as the
// massing's outer footprint makes the massing match the real building, so
// every real structural column sits inside it. Returns the box in absolute
// metres plus the centre used everywhere else, so callers can drop it straight
// into the same worldGroup transform as the massing and columns.
export function realEnvelopeForClass(sizeClass) {
  const mb = massingBlocks[sizeClass];
  if (!mb?.bounds) return null;
  const b = mb.bounds;
  return {
    x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1,
    y0: b.y0, y1: b.y1,
    centre: { x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2 },
  };
}

export function realColumnDimsForClass(sizeClass) {
  const mb = massingBlocks[sizeClass];
  if (!mb) return null;
  const colBlock = (mb.blocks || []).find(b => /^columns?$/i.test(b.name));
  // The column block's real vertical run. Some GLBs (e.g. medium) have a
  // basement/plinth so y0 is negative — clamp the base to the ground plane
  // (y=0), where the massing itself sits in the worldGroup, so columns stand
  // ON the site rather than poking below it. Height is preserved from there.
  const rawBaseY = colBlock ? colBlock.y0 : (mb.bounds.y0 ?? 0);
  const topY     = colBlock ? colBlock.y1 : (mb.bounds.y1 ?? 0);
  const baseY    = Math.max(0, rawBaseY);
  const height   = Math.max(0.1, topY - baseY);
  // Real per-column radius isn't stored per mesh in the extracted data, so use
  // a slender residential-column radius (0.18m ≈ a 360mm structural column) —
  // a real-world value, not the old arbitrary 0.22m marker rod.
  const radius = 0.18;
  return { baseY, height, radius };
}
