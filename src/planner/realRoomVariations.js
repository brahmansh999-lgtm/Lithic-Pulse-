// realRoomVariations — 9 "deconstructed stacking" variations of the real
// per-floor room data (programme{Small,Medium,Large,Xl}.json, via
// glbProgramme.js's realFloorsForClass) for the "Real rooms" toggle.
//
// Every dwelling keeps its real measured size (subdivided from the real
// 'units' boxes by dwellings.js, same as plain real-rooms mode) — nothing
// about a room's own area/shape is invented. What changes per variation is
// purely a RENDERING-SPACE rigid transform applied per floor: each floor's
// whole real room layout is rotated and/or drifted relative to the floor
// below, around the real building's own ground-floor centre. Floor 0 (the
// anchor) never moves; higher floors twist/lean further, the way a real
// deconstructivist tower reads — the drama comes from real room geometry
// stacked unrealistically, not from invented massing.
import { dwellingsFromBox, mulberry32 } from './dwellings';

// One balanced typology weighting for every variation — the axis that
// varies here is the deconstruction, not the unit mix.
//                          1b1p 1b2p 2b3p 2b4p 3b4p 3b5p 4b5p 4b8p
const BALANCED_WEIGHTS = [1.0, 1.5, 2.0, 2.0, 1.5, 1.2, 1.0, 0.8];

// mode:
//   'none'       — no rotation, no drift: the real building exactly as
//                  extracted, floors stacked straight on top of each other.
//                  This is the baseline every other variation deconstructs
//                  AWAY from — "Variation 0", not a deconstruction at all.
//   'twist'      — rotation and drift both grow linearly with floor index.
//   'cantilever' — no rotation, floors lean out further in one direction.
//   'spiral'     — rotation alternates direction floor-to-floor (zigzag).
//   'chaos'      — seeded random angle/drift per floor, capped by the given
//                  magnitudes.
export const REAL_ROOM_VARIATIONS = [
  { id: 0, mode: 'none',       rotDegPerFloor: 0,  driftM: 0,   driftAngleDeg: 0 },
  { id: 1, mode: 'twist',      rotDegPerFloor: 3,  driftM: 0.6, driftAngleDeg: 0 },
  { id: 2, mode: 'twist',      rotDegPerFloor: -3, driftM: 0.6, driftAngleDeg: 0 },
  { id: 3, mode: 'twist',      rotDegPerFloor: 8,  driftM: 1.2, driftAngleDeg: 30 },
  { id: 4, mode: 'twist',      rotDegPerFloor: -8, driftM: 1.2, driftAngleDeg: -30 },
  { id: 5, mode: 'cantilever', rotDegPerFloor: 0,  driftM: 2.0, driftAngleDeg: 0 },
  { id: 6, mode: 'cantilever', rotDegPerFloor: 0,  driftM: 2.0, driftAngleDeg: 180 },
  { id: 7, mode: 'spiral',     rotDegPerFloor: 6,  driftM: 1.0, driftAngleDeg: 90 },
  { id: 8, mode: 'twist',      rotDegPerFloor: 10, driftM: 1.8, driftAngleDeg: 45 },
  { id: 9, mode: 'chaos',      rotDegPerFloor: 5,  driftM: 1.4, driftAngleDeg: 0 },
];

function boundsCentre(boxes) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const b of boxes) {
    if (b.x0 < minX) minX = b.x0; if (b.x1 > maxX) maxX = b.x1;
    if (b.z0 < minZ) minZ = b.z0; if (b.z1 > maxZ) maxZ = b.z1;
  }
  return { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
}

// Bounding box across every box on every floor (outline corners if present,
// else the raw x0/x1/z0/z1) — used to keep a deconstructed variation from
// drifting/rotating clean off the real site.
function floorsBBox(floors) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const fl of floors) {
    for (const b of fl.boxes) {
      const pts = b.outline?.length ? b.outline : [{ x: b.x0, z: b.z0 }, { x: b.x1, z: b.z1 }];
      for (const p of pts) {
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
      }
    }
  }
  return { minX, maxX, minZ, maxZ };
}

// Per-floor RANDOM factors for 'chaos' mode, drawn from `rand` exactly ONCE
// per floor (not once per strength trial) — buildRealRoomVariation below
// re-evaluates the transform at several different strengths while
// searching for one that keeps the footprint on-site, and re-calling
// rand() on every trial would make each trial land on different random
// angles/directions instead of the same deconstruction at a different
// intensity.
function precomputeChaosFactors(floorCount, rand) {
  const factors = [];
  for (let fi = 0; fi < floorCount; fi++) {
    factors.push({ rotSign: rand() * 2 - 1, driftDirDeg: rand() * 360, driftFactor: 0.5 + rand() });
  }
  return factors;
}

// This floor's rigid rotation (radians) + drift (metres, xz) relative to the
// anchor (floor 0), for the given deconstruction definition at the given
// strength (0..1, uniformly scales rotDegPerFloor and driftM — see the
// footprint-fit search in buildRealRoomVariation). `chaosFactors[fi]` supplies
// chaos mode's per-floor randomness, precomputed once (see above).
function floorTransform(fi, def, strength, chaosFactors) {
  const rotDegPerFloor = def.rotDegPerFloor * strength;
  const driftM = def.driftM * strength;
  let angleDeg = 0, driftDirDeg = def.driftAngleDeg, driftLocal = 0;
  switch (def.mode) {
    case 'twist':
      angleDeg = rotDegPerFloor * fi;
      driftLocal = driftM * fi;
      break;
    case 'cantilever':
      driftLocal = driftM * fi;
      break;
    case 'spiral':
      angleDeg = rotDegPerFloor * fi * (fi % 2 === 0 ? 1 : -1);
      driftLocal = driftM * fi;
      break;
    case 'chaos': {
      const cf = chaosFactors[fi];
      angleDeg = cf.rotSign * rotDegPerFloor * fi;
      driftDirDeg = cf.driftDirDeg;
      driftLocal = driftM * fi * cf.driftFactor;
      break;
    }
    default:
      break;
  }
  const rad = (angleDeg * Math.PI) / 180;
  const dirRad = (driftDirDeg * Math.PI) / 180;
  return { rad, dx: Math.cos(dirRad) * driftLocal, dz: Math.sin(dirRad) * driftLocal };
}

// Rotate a box's real 4 corners about `pivot` by `rad`, then drift by
// (dx, dz) — returns an outline polygon in the same absolute x/z frame the
// unrotated box used, so buildMassing's addPolyPrism (MassingStage.jsx)
// renders it directly with no further coordinate handling.
function transformBoxToOutline(b, pivot, rad, dx, dz) {
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const corners = [[b.x0, b.z0], [b.x1, b.z0], [b.x1, b.z1], [b.x0, b.z1]];
  return corners.map(([x, z]) => {
    const rx = pivot.x + (x - pivot.x) * cos - (z - pivot.z) * sin;
    const rz = pivot.z + (x - pivot.x) * sin + (z - pivot.z) * cos;
    return { x: rx + dx, z: rz + dz };
  });
}

// Real per-floor rooms are clustered independently by the extraction
// script, so two rooms that are genuinely flush in the real building can
// come out a few centimetres apart purely from clustering jitter. Snapping
// edges within this tolerance to a shared value (before any subdivision or
// transform) makes touching real walls actually render as touching.
const EDGE_SNAP_EPS_M = 0.15;

function snapEdgeValues(values, eps) {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  const map = new Map();
  let clusterStart = 0;
  for (let i = 1; i <= sorted.length; i++) {
    if (i === sorted.length || sorted[i] - sorted[i - 1] > eps) {
      const cluster = sorted.slice(clusterStart, i);
      const avg = cluster.reduce((s, v) => s + v, 0) / cluster.length;
      for (const v of cluster) map.set(v, avg);
      clusterStart = i;
    }
  }
  return map;
}

function snapFloorEdges(floors) {
  return floors.map((fl) => {
    const xs = [], zs = [];
    for (const b of fl.boxes) { xs.push(b.x0, b.x1); zs.push(b.z0, b.z1); }
    const xMap = snapEdgeValues(xs, EDGE_SNAP_EPS_M);
    const zMap = snapEdgeValues(zs, EDGE_SNAP_EPS_M);
    return {
      ...fl,
      boxes: fl.boxes.map((b) => ({
        ...b,
        x0: xMap.get(b.x0), x1: xMap.get(b.x1),
        z0: zMap.get(b.z0), z1: zMap.get(b.z1),
      })),
    };
  });
}

// Build one of the 9 deconstructed-stacking variations from the already-
// capped real floors array MassingStage.jsx renders for the "Real rooms"
// toggle (getMassingData(cls).floors). Returns a NEW floors array in the
// same shape (every box carries an `outline` instead of relying on its
// x0/x1/z0/z1 for rendering), safe to hand straight to buildMassing.
export function buildRealRoomVariation(floors, variationId) {
  const def = REAL_ROOM_VARIATIONS.find(v => v.id === variationId) ?? REAL_ROOM_VARIATIONS[0];
  if (!Array.isArray(floors) || !floors.length) return floors;

  let work = floors.map(fl => ({ ...fl, boxes: fl.boxes.map(b => ({ ...b })) }));
  work = snapFloorEdges(work);

  // Subdivide real 'units' boxes into real dwellings BEFORE deconstructing:
  // sliceBox/dwellingsFromBox (dwellings.js) need real axis-aligned
  // geometry to measure bands/aspect ratios against. The twist/drift below
  // is a pure rendering-space transform applied after, so every dwelling
  // still has its real measured area — only its on-screen position/angle
  // changes.
  const rand = mulberry32(0x7B3C1 + variationId * 7919);
  for (const fl of work) {
    fl.boxes = fl.boxes.flatMap(b => (b.type === 'units' ? dwellingsFromBox(b, BALANCED_WEIGHTS, rand, {}) : [b]));
  }

  // Anchor: floor 0 never moves. Every other floor's real rooms rotate
  // about the ground floor's own real centre and/or drift, per this
  // variation's deconstruction definition.
  const pivot = boundsCentre(work[0]?.boxes ?? []);

  // User-directed: full-strength drift/rotation was pushing floors clean
  // outside the real site boundary — this mode renders the real building's
  // own raw footprint (no site-fit scale/position applied, unlike the
  // procedural variations), so nothing upstream was containing it. The real,
  // UNDEFORMED building (variation 0) is the one thing on screen that's
  // guaranteed to belong on this site — it's the actual measured building
  // this site was matched to. So: binary-search a single uniform strength
  // factor (0..1, applied to both rotDegPerFloor and driftM) for the
  // LARGEST deconstruction that still keeps every floor's bounding box
  // within the real footprint's own bounding box plus a small margin —
  // still visibly "deconstructed", just not floating off the plot.
  const FOOTPRINT_MARGIN_M = 2.0;
  const original = floorsBBox(work);
  const chaosFactors = precomputeChaosFactors(work.length, rand);
  const buildTransformed = (strength) => work.map((fl, fi) => {
    const { rad, dx, dz } = floorTransform(fi, def, strength, chaosFactors);
    return {
      ...fl,
      boxes: fl.boxes.map(b => ({ ...b, outline: transformBoxToOutline(b, pivot, rad, dx, dz) })),
    };
  });
  const fitsFootprint = (floors) => {
    const b = floorsBBox(floors);
    return b.minX >= original.minX - FOOTPRINT_MARGIN_M && b.maxX <= original.maxX + FOOTPRINT_MARGIN_M
      && b.minZ >= original.minZ - FOOTPRINT_MARGIN_M && b.maxZ <= original.maxZ + FOOTPRINT_MARGIN_M;
  };
  let strength = 1;
  if (!fitsFootprint(buildTransformed(1))) {
    let lo = 0, hi = 1;
    for (let i = 0; i < 16; i++) {
      const mid = (lo + hi) / 2;
      if (fitsFootprint(buildTransformed(mid))) lo = mid; else hi = mid;
    }
    strength = lo;
  }
  work = buildTransformed(strength);

  return work;
}
