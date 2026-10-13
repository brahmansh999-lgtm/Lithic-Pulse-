// bubbleLayout — turns zoningGraph's authored adjacency graph into real
// positions: nodes start seeded along the site's own long axis, then relax
// under spring (adjacency), repulsion (no overlap), and boundary-containment
// (stay inside the real site polygon) forces — a real bubble diagram, not a
// fixed template fit into a bounding box. Pure functions, no Three.js/React,
// same "shared metres-space math" pattern as siteFit.js.
import { pointInPolygon, mulberry32 } from './siteFit';
import { adjacencyLookup } from './zoningGraph';

// Seed node positions. Two modes:
//  - default: spread along the site polygon's own long axis (its bounding-
//    box diagonal as a cheap stand-in for a true principal axis — good
//    enough to seed relaxation into a sane basin; exact axis doesn't matter
//    since the spring/repulsion/boundary forces do the real work).
//  - `opts.center`: jitter tightly around a given point instead — used by
//    the nested per-wing bed-group sub-graph (MassingStage.jsx), which needs
//    to seed near its OWN wing's anchor, not spread across the whole site.
function seedPositions(localPoly, areaHints, seed, types, baseRadius, opts = {}) {
  let cx, cz, spanX, spanZ;
  if (opts.center) {
    cx = opts.center.x; cz = opts.center.z;
    spanX = spanZ = opts.jitter ?? 4;
  } else {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of localPoly) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
    }
    cx = (minX + maxX) / 2; cz = (minZ + maxZ) / 2;
    spanX = (maxX - minX) * 0.3; spanZ = (maxZ - minZ) * 0.3;
  }

  const rand = mulberry32(seed);
  return types.map(type => {
    const area = areaHints?.[type];
    const radius = area ? Math.max(2, Math.sqrt(area / Math.PI)) : (baseRadius[type] ?? 6);
    return {
      type,
      x: cx + (rand() - 0.5) * 2 * spanX,
      z: cz + (rand() - 0.5) * 2 * spanZ,
      radius,
      // Real programme area (m²) for this zone, straight from the measured
      // GLB floor. siteGrid.assignCellsToZones spends this as a hard budget,
      // so the massing reflects the building that was actually measured
      // rather than swelling to fill whatever land the site offers. Falls
      // back to the nominal radius's own area when no real hint exists, so a
      // zone without programme data still gets a sane, bounded footprint
      // instead of unlimited growth.
      targetArea: area || Math.PI * radius * radius,
    };
  });
}

// Build the graph: seeded nodes + adjacency edges, ready to relax. `types`
// restricts which zone nodes this graph includes; `adjacencyList` and
// `baseRadius` are the generic-shape data for those types (see
// zoningGraph.js's wingAdjacency/wingBaseRadius for the wing-level graph and
// bedGroupAdjacency/BED_GROUP_BASE_RADIUS for the nested per-wing one — the
// graph SHAPE now varies with wing count, so callers must always pass these
// explicitly rather than relying on one fixed default).
export function buildZoneGraph(localPoly, areaHints, seed, types, adjacencyList, baseRadius, opts) {
  return {
    nodes: seedPositions(localPoly, areaHints, seed, types, baseRadius, opts),
    adjacency: adjacencyLookup(types, adjacencyList),
  };
}

// Relax nodes under spring + repulsion + boundary-containment forces, plus
// optional directional bias forces (e.g. pull the 'entry' node toward the
// real road-facing side of the site — see roadBiasForce in MassingStage.jsx).
// Deterministic given the same seed (no Math.random anywhere here — only
// the seeded jitter used at seed time above). Runs entirely in cheap
// point/radius space; grid/polygon carving (if ever added) should happen
// once AFTER this converges, not per-iteration.
export function relaxGraph(graph, localPoly, { iterations = 250, biasForces = [] } = {}) {
  const { nodes, adjacency } = graph;
  const GAP = 1.5;           // desired clear gap between adjacent bubbles' edges
  const DAMPING = 0.85;
  const MAX_STEP = 3;        // clamp per-iteration displacement (metres)

  let cx = 0, cz = 0;
  for (const p of localPoly) { cx += p.x; cz += p.z; }
  cx /= localPoly.length; cz /= localPoly.length;

  const vel = nodes.map(() => ({ x: 0, z: 0 }));

  for (let iter = 0; iter < iterations; iter++) {
    const fx = nodes.map(() => 0);
    const fz = nodes.map(() => 0);

    // Spring forces along adjacency edges.
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      const edges = adjacency.get(a.type) || [];
      for (const { other, weight } of edges) {
        const j = nodes.findIndex(n => n.type === other);
        if (j <= i) continue; // each undirected pair once
        const b = nodes[j];
        const dx = b.x - a.x, dz = b.z - a.z;
        const dist = Math.hypot(dx, dz) || 0.001;
        const target = a.radius + b.radius + GAP;
        // Positive weight: pull toward target distance (attraction).
        // Negative weight: push apart, target distance scaled up so the
        // pair settles further apart than mere non-overlap requires.
        const targetDist = weight >= 0 ? target : target * 2.2;
        const strength = Math.abs(weight) * 0.02;
        const diff = (dist - targetDist) * strength * Math.sign(weight || 1);
        const ux = dx / dist, uz = dz / dist;
        fx[i] += ux * diff; fz[i] += uz * diff;
        fx[j] -= ux * diff; fz[j] -= uz * diff;
      }
    }

    // Repulsion — all pairs, only when overlapping (or too close for
    // unrelated bubbles), prevents zones stacking on top of each other.
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const dx = b.x - a.x, dz = b.z - a.z;
        const dist = Math.hypot(dx, dz) || 0.001;
        const minDist = a.radius + b.radius + GAP;
        if (dist < minDist) {
          const push = (minDist - dist) * 0.15;
          const ux = dx / dist, uz = dz / dist;
          fx[i] -= ux * push; fz[i] -= uz * push;
          fx[j] += ux * push; fz[j] += uz * push;
        }
      }
    }

    // Boundary containment — pull back toward the site centroid whenever a
    // node's centre falls outside the real polygon (irregular shapes
    // included; pointInPolygon handles concave boundaries correctly).
    //
    // This must DOMINATE the directional biases below. At 2.5 it did not: a
    // bias aimed near the site edge could hold a node outside the polygon
    // indefinitely, and those nodes' zones then got deleted downstream as
    // detached mass (Green and Semi-open were pushed clean out of the site by
    // the sun bias, and green:units reported 0%). A zone outside the site is
    // never a valid answer, so containment outranks any preference.
    const CONTAINMENT = 6;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (!pointInPolygon(n.x, n.z, localPoly)) {
        const dx = cx - n.x, dz = cz - n.z;
        const dist = Math.hypot(dx, dz) || 0.001;
        fx[i] += (dx / dist) * CONTAINMENT;
        fz[i] += (dz / dist) * CONTAINMENT;
      }
    }

    // Directional bias — pull a node toward a real-world target point (the
    // nearest point on an actual OSM road for 'entry'; the sun-facing edge for
    // 'green'). This ORIENTS the layout; it must not tear it apart.
    //
    // The pull EASES OFF as the node arrives, and that matters. It used to be
    // constant-magnitude, which never stops pushing: measured on Kensington,
    // at sun=50% the green node already sat 0.3m from its target — it had
    // arrived — yet the undiminished pull still stretched Green 7.6m PAST the
    // distance its spring to Units wants (8.5m at sun=100%). The bias was not
    // settling, it was winning a tug-of-war against adjacency, dragging Green
    // out to 0.65 of the way to the site edge where it read as detached
    // amenity rather than part of the building. Scaling by distance makes it a
    // spring toward the target instead of a constant shove, so it expresses a
    // real preference and then stops.
    const BIAS_FALLOFF_M = 12; // distance over which the pull reaches full strength
    for (const { type, targetX, targetZ, strength } of biasForces) {
      const i = nodes.findIndex(n => n.type === type);
      if (i < 0) continue;
      const n = nodes[i];
      const dx = targetX - n.x, dz = targetZ - n.z;
      const dist = Math.hypot(dx, dz) || 0.001;
      // Linear ramp, capped at 1: full strength when far, fading to nothing on
      // arrival so the node settles AT the target rather than pressing through
      // it forever.
      const falloff = Math.min(1, dist / BIAS_FALLOFF_M);
      fx[i] += (dx / dist) * strength * falloff;
      fz[i] += (dz / dist) * strength * falloff;
    }

    // Integrate with damping + per-step clamp.
    for (let i = 0; i < nodes.length; i++) {
      vel[i].x = (vel[i].x + fx[i]) * DAMPING;
      vel[i].z = (vel[i].z + fz[i]) * DAMPING;
      const stepDist = Math.hypot(vel[i].x, vel[i].z);
      if (stepDist > MAX_STEP) {
        vel[i].x = (vel[i].x / stepDist) * MAX_STEP;
        vel[i].z = (vel[i].z / stepDist) * MAX_STEP;
      }
      nodes[i].x += vel[i].x;
      nodes[i].z += vel[i].z;
    }
  }

  return graph;
}

// Converged node positions -> axis-aligned boxes in local metres, the exact
// shape MassingStage's buildMassing/addBox already consume ({type,x0,x1,z0,z1}).
// Slice 1: a simple square-ish rectangle around each node sized to its
// radius (area-accurate, aspect ~1:1) — grid-cell region carving (closer to
// the real site outline per zone) is a follow-up, not needed to verify the
// graph itself relaxes into a coherent layout.
export function boxesFromGraph(graph) {
  return graph.nodes.map(n => ({
    type: n.type,
    x0: n.x - n.radius, x1: n.x + n.radius,
    z0: n.z - n.radius, z1: n.z + n.radius,
  }));
}
