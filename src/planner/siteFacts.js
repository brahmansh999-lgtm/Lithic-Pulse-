// siteFacts — derives the real, checkable facts about a site that a bubble
// diagram is reasoned from: where the entry frontage is (nearest real OSM
// road), where the sun comes from, and which polygon edge each fact points
// at. Pure functions, Frame L (local-fit metres — the same frame
// siteToLocalPolygon/bubbleLayout.js already work in), so everything here can
// be fed straight into relaxGraph's biasForces.
//
// Frame note: latLngToXZ maps north to -Z, so in Frame L (before the site-fit
// rotation is applied) SOUTH is +Z. The site-fit rotation means Frame L is
// NOT geo-aligned, so the sun direction has to be rotated by -fit.angle to be
// expressed in it — see sunBiasForSite.

// London. The whole curated set is London brownfield (brownfield_london.geojson),
// so a single latitude is honest here rather than pretending to a generality
// the data does not have.
export const SITE_LATITUDE_DEG = 51.5;

// Mid-afternoon sun bearing, degrees clockwise from north (180 = due south).
// Due south is the standard planning simplification for "best aspect" in the
// northern hemisphere: it is where a facade gets the most usable daylight
// across the year. Not a solar-path simulation — no such model exists in this
// codebase, and pretending otherwise would be a fake number.
export const SUN_BEARING_DEG = 180;

// Polygon edge midpoints, longest first — the candidate frontages.
export function polygonEdges(localPoly) {
  if (!localPoly || localPoly.length < 3) return [];
  const edges = [];
  for (let i = 0; i < localPoly.length; i++) {
    const a = localPoly[i], b = localPoly[(i + 1) % localPoly.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    edges.push({
      a, b, len,
      mx: (a.x + b.x) / 2,
      mz: (a.z + b.z) / 2,
    });
  }
  return edges.sort((p, q) => q.len - p.len);
}

// Where the sun comes FROM, as a unit vector in Frame L.
//
// `fit.angle` is the rotation applied to place the building on the site, so
// Frame L is the geo frame rotated by -fit.angle. A bearing measured
// clockwise from north maps to geo XZ as (sin(bearing), -cos(bearing)) given
// north = -Z; rotating that into Frame L is what makes "south" mean the same
// physical direction regardless of how the site itself is oriented.
export function sunDirectionLocal(fitAngle = 0, bearingDeg = SUN_BEARING_DEG) {
  const bearing = (bearingDeg * Math.PI) / 180;
  const gx = Math.sin(bearing);
  const gz = -Math.cos(bearing);
  const c = Math.cos(fitAngle), s = Math.sin(fitAngle);
  // Same world->local rotation siteToLocalPolygon applies.
  return { x: gx * c - gz * s, z: gx * s + gz * c };
}

// The site's sunniest frontage: the edge midpoint furthest along the sun
// direction from the centroid, i.e. the side of the plot the sun actually
// reaches first. Used to bias daylight-hungry programme (green space, and
// with it the units that face it) toward real solar aspect instead of an
// arbitrary corner.
// `inset` pulls the returned target back toward the centroid, as a fraction
// of its distance from it. A target sitting exactly ON the boundary is a trap:
// relaxGraph's containment force only fires once a node is already OUTSIDE
// the polygon, so a bias aimed at the edge parks the bubble on the line and
// nudges it over — which is exactly what pushed Green and Semi-open outside
// the site and made green:units read 0%. Aiming a little inboard keeps the
// aspect honest while leaving the zone inside the plot.
const TARGET_INSET = 0.35;
export function sunniestEdge(localPoly, fitAngle = 0, inset = TARGET_INSET) {
  const edges = polygonEdges(localPoly);
  if (!edges.length) return null;
  let cx = 0, cz = 0;
  for (const p of localPoly) { cx += p.x; cz += p.z; }
  cx /= localPoly.length; cz /= localPoly.length;

  const sun = sunDirectionLocal(fitAngle);
  let best = null, bestProj = -Infinity;
  for (const e of edges) {
    // Project the edge midpoint onto the sun direction, measured from the
    // centroid. Largest projection = the most sun-facing side.
    const proj = (e.mx - cx) * sun.x + (e.mz - cz) * sun.z;
    if (proj > bestProj) { bestProj = proj; best = e; }
  }
  if (!best) return null;
  return {
    x: best.mx + (cx - best.mx) * inset,
    z: best.mz + (cz - best.mz) * inset,
    len: best.len,
  };
}

// Turn the derived facts into relaxGraph biasForces. `strength` values are
// deliberately small — biases nudge a converged layout, they do not override
// adjacency (see relaxGraph's own comment on directional bias).
//
// `weights` lets the UI dial each influence from 0 (ignore this fact) to 1
// (full strength), which is what makes the on-screen bubble diagram an actual
// control rather than a picture.
export function biasForcesFromFacts({ entry, sun, weights = {} }) {
  const forces = [];
  const wEntry = weights.entry ?? 1;
  const wSun = weights.sun ?? 1;

  if (entry && wEntry > 0) {
    forces.push({ type: 'entry', targetX: entry.x, targetZ: entry.z, strength: 1.2 * wEntry });
  }
  if (sun && wSun > 0) {
    // Green/amenity space wants the sunny aspect; that is the one zone whose
    // value is genuinely daylight-dependent in this programme.
    forces.push({ type: 'green', targetX: sun.x, targetZ: sun.z, strength: 1.0 * wSun });
  }
  return forces;
}
