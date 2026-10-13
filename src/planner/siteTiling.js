// siteTiling — place multiple copies of the SAME real, measured building
// across a site, instead of the old single-instance placement. The building
// is never resized past its true measured size (MAX_FIT_SCALE = 1.0, see
// siteFit.js) — on a site bigger than one building, the honest way to use
// the spare area is to repeat the real building, not invent a bigger one.
//
// Frame note: `localSitePoly` (from siteToLocalPolygon) sits near the local
// origin; box coordinates carry `centre` already added on (see
// floorsFromBubbleLayout's return in MassingStage.jsx). computeTileTransforms
// works ENTIRELY in the local frame — callers pass a bbox already shifted
// into that frame (subtract `centre` first). Because the two frames differ
// only by a constant additive translation (never a scale/rotation), the
// resulting (dx,dz,angle) transforms are valid in EITHER frame — apply them
// directly to the absolute-frame `floors` boxes with no further conversion.
//
// Angled tiling: many real site polygons are irregular "wing" shapes where
// the single real building sits in the widest part and the remaining site
// area tapers away at an angle that doesn't line up with the building's own
// axes (confirmed live on site 888/Padcroft Works — every straight (dx,dz)
// candidate overshoot the boundary within one step). Extra copies are tried
// rotated to follow the nearest site-boundary edge's own angle, not just
// translated — same real building, same real footprint, just turned to fit
// the wing it's going into.

import { pointInPolygon } from './siteFit';

// Real inter-building clear gap. Not a measured/regulatory value — an
// assumed fire-lane/access spacing, same convention as the 0.18m column
// radius (glbProgramme.js) and the embodied-carbon factors (carbonTracker.js)
// being labelled explicitly as assumptions rather than presented as fact.
// 4x BOUNDARY_SETBACK_M (1.5m, siteGrid.js — the edge clearance), since
// inter-building separation for access/services is conventionally larger
// than a boundary setback.
export const TILE_GAP_M = 6;

// Performance/legibility safeguard, not a design truth — a real site could
// fit more, but beyond this the massing stops reading as "a few repeated
// blocks" and starts costing real render/interaction performance for no
// added clarity. Easily raised if a site genuinely warrants more.
export const MAX_TILE_INSTANCES = 12;

function boxesOverlap(a, b, gap) {
  return !(a.x1 + gap <= b.x0 || a.x0 - gap >= b.x1 || a.z1 + gap <= b.z0 || a.z0 - gap >= b.z1);
}

function bboxOf(boxes) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x0); x1 = Math.max(x1, b.x1);
    z0 = Math.min(z0, b.z0); z1 = Math.max(z1, b.z1);
  }
  return { x0, x1, z0, z1 };
}

function rotatePoint(x, z, cx, cz, angle) {
  if (!angle) return { x, z };
  const dx = x - cx, dz = z - cz;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return { x: cx + dx * cos - dz * sin, z: cz + dx * sin + dz * cos };
}

// 4 corners of a box's real footprint — its own `outline` ring if it
// already has one (merged L/T/U polygonal boxes, see mergeFootprints.js),
// else the 4 corners of its axis-aligned x0/x1/z0/z1.
function boxCorners(b) {
  if (b.outline?.length) return b.outline;
  return [
    { x: b.x0, z: b.z0 }, { x: b.x1, z: b.z0 },
    { x: b.x1, z: b.z1 }, { x: b.x0, z: b.z1 },
  ];
}

// Angle of the site-boundary edge nearest to (x,z) — same nearest-segment
// approach entryBiasFromRoads (MassingStage.jsx) uses for road edges, but a
// self-contained copy here so that feature is never touched by this one.
function nearestEdgeAngle(x, z, poly) {
  let best = Infinity, angle = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const abx = b.x - a.x, abz = b.z - a.z;
    const len2 = abx * abx + abz * abz;
    if (!(len2 > 0)) continue;
    let t = ((x - a.x) * abx + (z - a.z) * abz) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = a.x + abx * t, pz = a.z + abz * t;
    const dist = Math.hypot(x - px, z - pz);
    if (dist < best) { best = dist; angle = Math.atan2(abz, abx); }
  }
  return angle;
}

// Strict per-box, per-corner containment: every corner of every real box of
// this candidate instance must land inside the site polygon. (Not the
// lenient "≥3 of 4" test siteFit.js's footprintInsidePolygon uses for the
// single-instance clip — that leniency was tuned for one already-fitted
// building; tile candidates are optional extras, so we require them fully
// clean rather than letting one sliver poke outside the boundary.)
function candidateFits(boxes, cx, cz, dx, dz, angle, poly) {
  for (const b of boxes) {
    for (const c of boxCorners(b)) {
      const r = rotatePoint(c.x, c.z, cx, cz, angle);
      if (!pointInPolygon(r.x + dx, r.z + dz, poly)) return false;
    }
  }
  return true;
}

function transformedBBox(boxes, cx, cz, dx, dz, angle) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const b of boxes) {
    for (const c of boxCorners(b)) {
      const r = rotatePoint(c.x, c.z, cx, cz, angle);
      const px = r.x + dx, pz = r.z + dz;
      x0 = Math.min(x0, px); x1 = Math.max(x1, px);
      z0 = Math.min(z0, pz); z1 = Math.max(z1, pz);
    }
  }
  return { x0, x1, z0, z1 };
}

// singleInstanceBoxes: the real ground-floor boxes of the untiled single
// instance (whatever shape they are — an irregular footprint with wings and
// notches, NOT necessarily filling its own bounding rectangle), in the SAME
// frame as localSitePoly (near-local-origin — caller subtracts centre).
//
// Returns an array of {dx, dz, angle} transforms, always including
// {dx:0, dz:0, angle:0} first (today's already-proven position,
// unconditionally — it doesn't need to pass this test, it already passed
// the real pipeline's own clip).
//
// For each candidate grid position (nearest-to-instance-0 first), tries
// angle 0 first (cheapest, matches every site that already fits this way —
// today's 5 curated sites all resolve here or fail everywhere, so their
// output is unchanged by the angle logic below). Only if angle 0 fails does
// it try rotating the candidate to the nearest site-boundary edge's own
// angle (both directions along that edge) — this is what lets an extra
// copy follow a tapering wing that isn't aligned with the building's axes.
export function computeTileTransforms(singleInstanceBoxes, localSitePoly, gapM = TILE_GAP_M, maxInstances = MAX_TILE_INSTANCES) {
  if (!localSitePoly?.length || !singleInstanceBoxes?.length) return [{ dx: 0, dz: 0, angle: 0 }];
  const bbox = bboxOf(singleInstanceBoxes);
  const w = bbox.x1 - bbox.x0, d = bbox.z1 - bbox.z0;
  if (!(w > 0) || !(d > 0)) return [{ dx: 0, dz: 0, angle: 0 }];
  const bcx = (bbox.x0 + bbox.x1) / 2, bcz = (bbox.z0 + bbox.z1) / 2;

  const siteXs = localSitePoly.map(p => p.x), siteZs = localSitePoly.map(p => p.z);
  const sx0 = Math.min(...siteXs), sx1 = Math.max(...siteXs);
  const sz0 = Math.min(...siteZs), sz1 = Math.max(...siteZs);

  const transforms = [{ dx: 0, dz: 0, angle: 0, bcx, bcz }];
  const placedBBoxes = [bbox];

  // Grid anchored on instance 0's OWN position (bcx,bcz), not the site's
  // bbox corner — instance 0 is wherever the real zoning/bias solve put it
  // (often not near a corner at all), so a corner-anchored grid mostly
  // produced candidates that either overlapped instance 0 or overshot clean
  // off the site in one step. Stepping in whole (dx,dz) = (i*stepX, j*stepZ)
  // multiples from instance 0 keeps every candidate a clean, predictable
  // building-width-plus-gap away from its neighbours.
  const stepX = w + gapM, stepZ = d + gapM;
  const maxI = Math.max(1, Math.ceil(Math.max(bcx - sx0, sx1 - bcx) / stepX) + 1);
  const maxJ = Math.max(1, Math.ceil(Math.max(bcz - sz0, sz1 - bcz) / stepZ) + 1);

  const candidates = [];
  for (let i = -maxI; i <= maxI; i++) {
    for (let j = -maxJ; j <= maxJ; j++) {
      if (i === 0 && j === 0) continue;
      candidates.push({ i, j, dist: i * i + j * j });
    }
  }
  // Nearest to instance 0 first, so with a capped instance count the
  // accepted set reads as "grown outward from the real building", not an
  // arbitrary scan-order artifact.
  candidates.sort((a, b) => a.dist - b.dist);

  for (const { i, j } of candidates) {
    if (transforms.length >= maxInstances) break;
    const dx = i * stepX, dz = j * stepZ;

    const edgeAngle = nearestEdgeAngle(bcx + dx, bcz + dz, localSitePoly);
    const angleTrials = [0, edgeAngle, edgeAngle + Math.PI];

    for (const angle of angleTrials) {
      const nbbox = transformedBBox(singleInstanceBoxes, bcx, bcz, dx, dz, angle);
      if (placedBBoxes.some(p => boxesOverlap(nbbox, p, gapM))) continue;
      if (!candidateFits(singleInstanceBoxes, bcx, bcz, dx, dz, angle, localSitePoly)) continue;
      transforms.push({ dx, dz, angle, bcx, bcz });
      placedBBoxes.push(nbbox);
      break;
    }
  }
  return transforms;
}

// Back-compat thin wrapper for any caller still expecting {dx,dz} only.
export function computeTileOffsets(singleInstanceBoxes, localSitePoly, gapM, maxInstances) {
  return computeTileTransforms(singleInstanceBoxes, localSitePoly, gapM, maxInstances)
    .map(({ dx, dz }) => ({ dx, dz }));
}

// Translates N copies of a FINALISED single-instance `floors` (after
// dwellings + merge + stamp — see generateMassingIterations) by the given
// transforms, and concatenates them floor-by-floor into one combined array.
// Deliberately does NOT re-run mergeFootprints across instances: TILE_GAP_M
// keeps every pair of instances clearly separated, and clipBoxToGrid (the
// only pass that still touches boxes after this) can only shrink a box
// within its own original bounds, never fuse two — so re-merging would add
// risk for no benefit.
//
// angle === 0 (today's only case on all 5 curated sites): behaves exactly
// as before — plain x0/x1/z0/z1 (+ translated outline, if present).
// angle !== 0: rotation turns an axis-aligned box into a rotated rectangle,
// which x0/x1/z0/z1 alone can't represent, so the box switches to carrying
// an `outline` ring instead (the same mechanism merged L/T/U polygonal
// footprints already use — buildMassing already renders outline boxes
// correctly, no renderer change needed). `mergedAreaM2` is set explicitly
// to the box's TRUE pre-rotation area: rotating a box doesn't change its
// area, but the recomputed x0/x1/z0/z1 (the new bbox around the rotated
// shape) is larger than the true footprint, so realBoxArea's mergedAreaM2
// fallback would silently overstate GIA/structural-volume stats without this.
export function replicateFloorsAcrossSite(floors, transforms) {
  if (!Array.isArray(floors) || transforms.length <= 1) return floors;
  return floors.map(floor => ({
    ...floor,
    boxes: transforms.flatMap(({ dx, dz, angle, bcx: tcx, bcz: tcz }) => floor.boxes.map(b => {
      const trueArea = b.mergedAreaM2 ?? ((b.x1 - b.x0) * (b.z1 - b.z0));
      if (!angle) {
        return {
          ...b,
          x0: b.x0 + dx, x1: b.x1 + dx,
          z0: b.z0 + dz, z1: b.z1 + dz,
          ...(b.outline ? { outline: b.outline.map(p => ({ x: p.x + dx, z: p.z + dz })) } : {}),
        };
      }
      const pivotX = tcx ?? (b.x0 + b.x1) / 2, pivotZ = tcz ?? (b.z0 + b.z1) / 2;
      const corners = boxCorners(b).map(c => {
        const r = rotatePoint(c.x, c.z, pivotX, pivotZ, angle);
        return { x: r.x + dx, z: r.z + dz };
      });
      const bb = bboxOf([{ x0: Math.min(...corners.map(c => c.x)), x1: Math.max(...corners.map(c => c.x)),
                           z0: Math.min(...corners.map(c => c.z)), z1: Math.max(...corners.map(c => c.z)) }]);
      return { ...b, ...bb, outline: corners, mergedAreaM2: trueArea };
    })),
  }));
}

// Same transforms, applied to the real measured column positions (already
// filtered to the single instance's own footprint — see
// filterColumnsToFootprint in MassingStage.jsx). Kept separate from
// replicateFloorsAcrossSite since columns are {x,z} points, not boxes.
export function replicateColumnsAcrossSite(columns, transforms) {
  if (!Array.isArray(columns) || transforms.length <= 1) return columns;
  return transforms.flatMap(({ dx, dz, angle, bcx: tcx, bcz: tcz }) => columns.map(c => {
    if (!angle) return { ...c, x: c.x + dx, z: c.z + dz };
    const r = rotatePoint(c.x, c.z, tcx ?? 0, tcz ?? 0, angle);
    return { ...c, x: r.x + dx, z: r.z + dz };
  }));
}
