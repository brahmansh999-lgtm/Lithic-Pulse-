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
