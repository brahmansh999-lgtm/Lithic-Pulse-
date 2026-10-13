// siteFit — shared "fit a rectangular footprint to a real site polygon" math,
// used identically by MassingStage (3D) and ZoningPlan (2D) so the zoning
// diagram and the massing box are always geometrically the same fit: same
// rotation, same scale, same centre. Don't let these two drift apart again.

// Convert lat/lng → metres XZ relative to a centre point (+x = east, +z = south)
export function latLngToXZ(lat, lng, cLat, cLng) {
  const R = 6371000;
  const cosLat = Math.cos(cLat * Math.PI / 180);
  const x =  (lng - cLng) * (Math.PI / 180) * R * cosLat;
  const z = -(lat - cLat) * (Math.PI / 180) * R;
  return { x, z };
}

// Convex hull (monotone chain)
export function convexHull(points) {
  const pts = [...points].sort((a, b) => a.x - b.x || a.z - b.z);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

// Minimum-area oriented bounding rectangle (rotating calipers).
// Returns { angle, width, height, cx, cz } — width runs along the rotated
// +X axis, height along the rotated +Z axis, once rotated by `angle`.
export function minAreaRect(points) {
  const hull = convexHull(points);
  if (hull.length < 3) {
    const xs = points.map(p => p.x), zs = points.map(p => p.z);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minZ = Math.min(...zs), maxZ = Math.max(...zs);
    return { angle: 0, width: maxX - minX, height: maxZ - minZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 };
  }
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const edgeAngle = Math.atan2(b.z - a.z, b.x - a.x);
    const cos = Math.cos(-edgeAngle), sin = Math.sin(-edgeAngle);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of hull) {
      const rx = p.x * cos - p.z * sin;
      const rz = p.x * sin + p.z * cos;
      if (rx < minX) minX = rx;
      if (rx > maxX) maxX = rx;
      if (rz < minZ) minZ = rz;
      if (rz > maxZ) maxZ = rz;
    }
    const w = maxX - minX, h = maxZ - minZ, area = w * h;
    if (!best || area < best.area) {
      const ccx = (minX + maxX) / 2, ccz = (minZ + maxZ) / 2;
      const cosB = Math.cos(edgeAngle), sinB = Math.sin(edgeAngle);
      best = {
        area, angle: edgeAngle, width: w, height: h,
        cx: ccx * cosB - ccz * sinB,
        cz: ccx * sinB + ccz * cosB,
      };
    }
  }
  return best;
}

// Compute how to rotate + scale + translate a footprint (footprintW × footprintD,
// in its own local metres frame) so it nests snugly inside the real site
// polygon's true minimum-area oriented bounding rectangle. `coords` is the
// site's [lat,lng] boundary; cLat/cLng is its centroid (same one used to
// build the outline, so both come out in the same metres frame).
export function fitFootprintToSite(coords, cLat, cLng, footprintW, footprintD, margin = 0.92) {
  if (!coords || coords.length < 3) return { angle: 0, scale: 1, cx: 0, cz: 0, siteSpan: Math.max(footprintW, footprintD) };
  const pts = coords.map(([lat, lng]) => latLngToXZ(lat, lng, cLat, cLng));
  const rect = minAreaRect(pts);

  const scaleDirect  = Math.min(rect.width / footprintW,  rect.height / footprintD);
  const scaleSwapped = Math.min(rect.height / footprintW, rect.width  / footprintD);
  const useSwapped = scaleSwapped > scaleDirect;

  return {
    angle: useSwapped ? rect.angle + Math.PI / 2 : rect.angle,
    scale: (useSwapped ? scaleSwapped : scaleDirect) * margin,
    cx: rect.cx,
    cz: rect.cz,
    siteSpan: Math.max(rect.width, rect.height),
  };
}

// Single source of truth for the site-fit scale clamp, shared by
// MassingStage (layout AND render — if those two ever disagree, geometry laid
// out as "inside" renders outside with no error anywhere), ZoningPlan, and
// GLBSiteView. Each of those previously carried its own copy of the same
// clamp, so a change to one silently desynced the stages.
//
// The building NEVER scales UP (upper bound 1.0). The massing is real,
// measured GLB geometry with a true physical size — enlarging it is not
// "fitting the site", it is inventing a bigger building than the one that was
// measured. The old 1.6 ceiling did exactly that, and it is what made massing
// spill past the site outline on the curated sites: fitFootprintToSite sizes
// the building to the site's minimum-area rectangle, but that rectangle is
// fitted to the polygon's CONVEX HULL, so on a concave plot it covers land
// outside the real boundary — and scaling up to fill it drives the building
// into that phantom area. Area grows with the square of scale, so the effect
// is large. Measured: site 643 (Kensington) fitted at 1.05 and site 556 at
// 1.60, and 643's ground floor came out at 8,399 m2 GIA on a 3,478 m2 plot —
// 2.4x the entire site, which is impossible for a ground floor.
//
// At scale 1.0 the real envelopes already occupy 42-102% of their sites
// across the curated 10 (measured), a sensible density — so 1.0 is both the
// honest cap and the architecturally right one. A small building on a huge
// plot simply keeps visible margin, which is the truthful result.
//
// There is deliberately NO lower bound. The clamp previously had a 0.65
// minimum, which INFLATED the building on any plot too small for it — and
// 163 of the 1,723 real sites (9.5%) fit below 0.65, some far below (site
// 299's true fit is 0.047 on a 3x1m plot). On those the worldGroup transform
// scaled the already-clipped geometry back out past the boundary, so the
// mass visibly overran the site outline no matter how exact the clipping
// was. Clipping cannot fix that: the clip runs in the pre-scale frame, the
// inflation happens after it. Honouring the true scale is the fix — a
// building that does not fit its site renders smaller, it does not burst the
// boundary.
export const MAX_FIT_SCALE = 1.0;
export function clampFitScale(scale) {
  return Math.min(MAX_FIT_SCALE, scale);
}

// Apply a fit (angle/scale/cx/cz) to a local-space point (x,z) — same
// scale-then-rotate-then-translate order as the Three.js worldGroup TRS.
export function applyFit(fit, x, z) {
  const sx = x * fit.scale, sz = z * fit.scale;
  const cos = Math.cos(fit.angle), sin = Math.sin(fit.angle);
  return {
    x: sx * cos + sz * sin + fit.cx,
    z: -sx * sin + sz * cos + fit.cz,
  };
}

// ── Real polygon clipping ──────────────────────────────────────────────────
// Ported from masterplanGenerator.js's pointInPolyGrid/footprintInsideGridPoly
// (the dormant generator's real setback/clip logic — see
// [[honest-pipeline-rhino-handoff]] for why the generator itself wasn't
// adopted, only this proven geometry). That reference operates in one fixed
// grid-cell frame throughout; here the algorithm is the same, just generic
// over any {x,z} point list instead of grid cells.

// Standard ray-casting point-in-polygon test.
export function pointInPolygon(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, zi = poly[i].z;
    const xj = poly[j].x, zj = poly[j].z;
    const intersect = ((zi > z) !== (zj > z)) &&
      (x < (xj - xi) * (z - zi) / (zj - zi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// A box passes if its centre AND at least 3 of its 4 corners are inside the
// polygon — same lenient rule the reference uses (footprintInsideGridPoly)
// to avoid over-clipping on narrow/irregular sites where a strict "all 4
// corners" test would reject too much real programme.
export function footprintInsidePolygon(x0, x1, z0, z1, poly) {
  if (!poly || poly.length < 3) return true;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  if (!pointInPolygon(cx, cz, poly)) return false;
  const corners = [
    [x0, z0], [x1, z0],
    [x0, z1], [x1, z1],
  ];
  const insideCount = corners.filter(([px, pz]) => pointInPolygon(px, pz, poly)).length;
  return insideCount >= 3;
}

// Converts the real site polygon (lat/lng coords) into the SAME centred-local
// metres frame the massing boxes already live in (addBox subtracts the real
// GLB envelope's own centre from every box — see MassingStage.jsx's addBox).
// This is the inverse of applyFit: world point → subtract translation →
// un-scale → un-rotate (transpose of applyFit's rotation, since it's
// orthogonal). No equivalent in the reference generator, which only ever
// works in one grid frame — the live pipeline needs to go world→local
// instead of local→world.
export function siteToLocalPolygon(coords, cLat, cLng, fit) {
  if (!coords || coords.length < 3) return null;
  const cos = Math.cos(fit.angle), sin = Math.sin(fit.angle);
  return coords.map(([lat, lng]) => {
    const { x: worldX, z: worldZ } = latLngToXZ(lat, lng, cLat, cLng);
    const dx = (worldX - fit.cx) / fit.scale;
    const dz = (worldZ - fit.cz) / fit.scale;
    return { x: dx * cos - dz * sin, z: dx * sin + dz * cos };
  });
}

// Deterministic seeded PRNG (mulberry32) — used to generate reproducible
// iteration sets (same seed → same layout every render), not Math.random().
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
