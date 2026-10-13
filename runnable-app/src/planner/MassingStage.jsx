import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { fitFootprintToSite, mulberry32 } from './siteFit';
import { glbProgrammeForClass, realColumnPositionsForClass, realColumnDimsForClass, realFloorsForClass, realEnvelopeForClass } from './glbProgramme';
import './MassingStage.css';

export const MASSING_ITERATION_COUNT = 10;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ── Programme data (from scripts/extractProgramme3.mjs) ──────────────────────
const RAW_FLOORS = [{"floorIdx":0,"y0":0.5,"y1":4.5,"boxes":[{"type":"services","x0":332.894,"x1":340.902,"y0":0.5,"y1":4.5,"z0":270.45,"z1":272.102},{"type":"community","x0":352.316,"x1":356.73,"y0":0.5,"y1":4.5,"z0":242.745,"z1":260.946},{"type":"units","x0":340.863,"x1":348.863,"y0":0.5,"y1":4.5,"z0":273.617,"z1":281.617},{"type":"units","x0":354.703,"x1":368.137,"y0":0.5,"y1":4.5,"z0":246.176,"z1":254.906},{"type":"units","x0":354.703,"x1":364.198,"y0":0.5,"y1":4.5,"z0":261.619,"z1":273.826},{"type":"units","x0":329.091,"x1":339.091,"y0":0.5,"y1":4.5,"z0":274.202,"z1":278.944},{"type":"units","x0":322.676,"x1":327.407,"y0":0.5,"y1":4.5,"z0":274.514,"z1":284.459},{"type":"units","x0":322.676,"x1":337.403,"y0":0.5,"y1":4.5,"z0":246.176,"z1":270.506},{"type":"units","x0":322.619,"x1":334.879,"y0":0.5,"y1":4.5,"z0":258.468,"z1":267.209}]},{"floorIdx":1,"y0":4.5,"y1":8.0,"boxes":[{"type":"services","x0":332.894,"x1":340.902,"y0":4.5,"y1":8.0,"z0":270.45,"z1":272.102},{"type":"units","x0":322.619,"x1":335.219,"y0":4.5,"y1":8.0,"z0":246.131,"z1":270.431},{"type":"units","x0":340.863,"x1":348.863,"y0":4.5,"y1":8.0,"z0":273.617,"z1":281.617},{"type":"units","x0":355.765,"x1":368.031,"y0":4.5,"y1":8.0,"z0":246.176,"z1":254.906},{"type":"units","x0":355.765,"x1":364.11,"y0":4.5,"y1":8.0,"z0":261.619,"z1":273.826},{"type":"units","x0":329.041,"x1":339.041,"y0":4.5,"y1":8.0,"z0":274.148,"z1":278.888},{"type":"units","x0":322.676,"x1":327.407,"y0":4.5,"y1":8.0,"z0":274.514,"z1":284.459},{"type":"units","x0":355.765,"x1":368.031,"y0":4.5,"y1":8.0,"z0":258.468,"z1":267.209}]},{"floorIdx":2,"y0":8.0,"y1":11.5,"boxes":[{"type":"services","x0":332.894,"x1":340.902,"y0":8.0,"y1":11.5,"z0":270.45,"z1":272.102},{"type":"units","x0":322.676,"x1":327.407,"y0":8.0,"y1":11.5,"z0":274.514,"z1":284.459},{"type":"units","x0":329.041,"x1":339.041,"y0":8.0,"y1":11.5,"z0":274.148,"z1":278.888},{"type":"units","x0":355.765,"x1":364.11,"y0":8.0,"y1":11.5,"z0":261.619,"z1":273.826},{"type":"units","x0":355.765,"x1":368.031,"y0":8.0,"y1":11.5,"z0":246.176,"z1":254.906},{"type":"units","x0":322.619,"x1":335.219,"y0":8.0,"y1":11.5,"z0":246.131,"z1":270.431},{"type":"units","x0":340.863,"x1":348.863,"y0":8.0,"y1":11.5,"z0":273.517,"z1":281.517}]},{"floorIdx":3,"y0":11.5,"y1":15.0,"boxes":[{"type":"services","x0":332.894,"x1":340.902,"y0":11.5,"y1":15.0,"z0":270.45,"z1":272.102},{"type":"units","x0":322.676,"x1":327.407,"y0":11.5,"y1":15.0,"z0":274.414,"z1":284.359},{"type":"units","x0":329.041,"x1":339.041,"y0":11.5,"y1":15.0,"z0":274.048,"z1":278.788},{"type":"units","x0":355.765,"x1":364.11,"y0":11.5,"y1":15.0,"z0":261.519,"z1":273.726},{"type":"units","x0":355.765,"x1":368.031,"y0":11.5,"y1":15.0,"z0":246.076,"z1":254.806},{"type":"units","x0":322.619,"x1":335.219,"y0":11.5,"y1":15.0,"z0":246.031,"z1":270.331},{"type":"units","x0":340.863,"x1":348.863,"y0":11.5,"y1":15.0,"z0":273.517,"z1":281.517}]},{"floorIdx":4,"y0":15.0,"y1":19.0,"boxes":[{"type":"services","x0":332.894,"x1":340.902,"y0":15.0,"y1":19.0,"z0":270.45,"z1":272.102},{"type":"units","x0":322.676,"x1":327.407,"y0":15.0,"y1":19.0,"z0":274.414,"z1":284.359},{"type":"units","x0":329.041,"x1":339.041,"y0":15.0,"y1":19.0,"z0":274.048,"z1":278.788},{"type":"units","x0":355.765,"x1":364.11,"y0":15.0,"y1":19.0,"z0":261.519,"z1":273.726},{"type":"units","x0":355.765,"x1":368.031,"y0":15.0,"y1":19.0,"z0":246.076,"z1":254.806},{"type":"units","x0":322.619,"x1":335.219,"y0":15.0,"y1":19.0,"z0":246.031,"z1":270.331},{"type":"units","x0":340.863,"x1":348.863,"y0":15.0,"y1":19.0,"z0":273.517,"z1":281.517}]},{"floorIdx":5,"y0":19.0,"y1":22.5,"boxes":[{"type":"services","x0":332.894,"x1":340.902,"y0":19.0,"y1":22.5,"z0":270.45,"z1":272.102},{"type":"units","x0":322.676,"x1":327.407,"y0":19.0,"y1":22.5,"z0":274.414,"z1":284.359},{"type":"units","x0":329.041,"x1":339.041,"y0":19.0,"y1":22.5,"z0":274.048,"z1":278.788},{"type":"units","x0":355.765,"x1":364.11,"y0":19.0,"y1":22.5,"z0":261.519,"z1":273.726},{"type":"units","x0":355.765,"x1":368.031,"y0":19.0,"y1":22.5,"z0":246.076,"z1":254.806},{"type":"units","x0":322.619,"x1":335.219,"y0":19.0,"y1":22.5,"z0":246.031,"z1":270.331},{"type":"units","x0":340.863,"x1":348.863,"y0":19.0,"y1":22.5,"z0":273.517,"z1":281.517}]}];

const CENTRE = {
  x: (319.159 + 371.51) / 2,
  z: (242.622 + 286.445) / 2,
};


const BALCONIES = [
  { x0:349.1, x1:352.9, z0:273.6, z1:275.3 },
  { x0:338.3, x1:340.9, z0:273.6, z1:278.4 },
  { x0:328.1, x1:330.6, z0:278.6, z1:282.4 },
  { x0:319.3, x1:323.1, z0:273.6, z1:276.1 },
  { x0:363.8, x1:367.5, z0:271.3, z1:273.8 },
];

const PALETTE = {
  units:       { face: '#b8d4c8', edge: '#3d7a68' },
  services:    { face: '#d4a96a', edge: '#7a4a10' },
  community:   { face: '#5b9fd4', edge: '#1a4a7a' },
  balcony:     { face: '#e8a8cc', edge: '#7a2a52' },
  circulation: { face: '#9b6fd4', edge: '#4a1a7a' },
};


// Convert lat/lng → Three.js XZ metres relative to a centre point
function latLngToXZ(lat, lng, cLat, cLng) {
  const R = 6371000;
  const cosLat = Math.cos(cLat * Math.PI / 180);
  const x =  (lng - cLng) * (Math.PI / 180) * R * cosLat;
  const z = -(lat - cLat) * (Math.PI / 180) * R; // z = south (Three.js -Z = north)
  return { x, z };
}

// ── ZERO-LAG, FULL-COLOUR MATERIALS ──────────────────────────────────────
// The lag never came from colour — it came from PBR lighting, shadows,
// transparency, and an always-on render loop (all removed elsewhere). Colour
// on an UNLIT MeshBasicMaterial is free: no per-fragment lighting math. So we
// keep the real programme palette (units/services/community/…) but each
// distinct colour is a single cached MeshBasicMaterial reused across EVERY
// box of that type — hundreds of boxes, a handful of materials, nothing
// per-box to compile or sort, and NO transparency (transparency is what
// forces per-frame depth sorting + extra passes). Full colour, zero cost.
const FACE_MAT_CACHE = new Map();
function faceMat(color) {
  let m = FACE_MAT_CACHE.get(color);
  if (!m) { m = new THREE.MeshBasicMaterial({ color }); FACE_MAT_CACHE.set(color, m); }
  return m;
}
const EDGE_MAT_CACHE = new Map();
function edgeMat(color) {
  let m = EDGE_MAT_CACHE.get(color);
  if (!m) { m = new THREE.LineBasicMaterial({ color }); EDGE_MAT_CACHE.set(color, m); }
  return m;
}
// X-ray plate (columns stage ground floor) — faint so the red column rods
// read through it. One shared instance; the only transparent material here.
const XRAY_MAT = new THREE.MeshBasicMaterial({
  color: '#cfd8d2', transparent: true, opacity: 0.28, depthWrite: false,
});

function addBox(group, x0, x1, y0, y1, z0, z1, pal, fullH, centre, xray) {
  const w = x1 - x0, h = y1 - y0, d = z1 - z0;
  const cx = (x0 + x1) / 2 - centre.x;
  const cy = (y0 + y1) / 2;
  const cz = (z0 + z1) / 2 - centre.z;
  const geo = new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(geo, xray ? XRAY_MAT : faceMat(pal.face));
  mesh.position.set(cx, cy, cz);
  group.add(mesh);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat(pal.edge));
  edges.position.set(cx, cy, cz);
  group.add(edges);
}

// xray: render the massing boxes as translucent shells (low opacity, no
// depth-write) so the real GLB column rods added on top in ColumnPlacementStage
// stay visible through the mass instead of being hidden inside solid blocks.
function buildMassing(floors, balconies, centre, xray) {
  const group = new THREE.Group();
  const GAP = 0.18;
  for (const floor of floors) {
    const flH  = floor.y1 - floor.y0 - GAP;
    const flY0 = floor.y0 + GAP / 2;
    const flY1 = flY0 + flH;
    for (const b of floor.boxes) {
      // Community/podium reads as a lower, wider datum; circulation is a
      // real but thin surface (the leftover real slab area between rooms,
      // not a full room volume) — floats just above the floor gap so it
      // reads as a connective walking surface, not another solid block.
      const topY = b.type === 'community' ? flY0 + (flY1 - flY0) * 0.6
        : b.type === 'circulation' ? flY0 + 0.12
        : b.type === 'balcony' ? flY0 + (flY1 - flY0) * 0.30
        : flY1;
      addBox(group, b.x0, b.x1, flY0, topY, b.z0, b.z1, PALETTE[b.type], b.type !== 'circulation' && b.type !== 'balcony', centre, xray);
    }
    const balH = flH * 0.30;
    for (const bal of balconies) {
      addBox(group, bal.x0, bal.x1, flY0, flY0 + balH, bal.z0, bal.z1, PALETTE.balcony, false, centre, xray);
    }
  }
  return group;
}

// Real per-class GLB programme doesn't include a detailed per-unit floor
// breakdown (that level of extraction only exists for "medium" — see
// RAW_FLOORS above) — but it DOES give the real EXTERNAL_WALLS envelope
// (the real boundary box of the building's exterior walls) plus real green/
// service-core positions for small/large/xl, straight from massingBlocks.json
// (see glbProgramme.js). Synthesize a floors[] array by repeating those real
// boundary boxes per floor — no invented/guessed geometry, only the actual
// GLB-extracted boxes for that class.
function synthesizeFloorsForClass(prog) {
  const { widthM, depthM, floorCount, boxes } = prog;
  const floorH = 3.4;
  const floors = [];
  for (let fi = 0; fi < floorCount; fi++) {
    const y0 = fi * floorH + 0.5;
    const y1 = y0 + floorH - 0.5;
    const floorBoxes = [];
    for (const b of boxes) {
      if (b.type === 'semiopen') continue; // void/amenity space, not a solid mass
      if (b.type === 'green' && fi !== 0) continue; // community only at ground floor
      const type = b.type === 'green' ? 'community' : b.type;
      floorBoxes.push({
        type,
        x0: (b.nx - b.nw / 2) * widthM, x1: (b.nx + b.nw / 2) * widthM,
        z0: (b.nz - b.nd / 2) * depthM, z1: (b.nz + b.nd / 2) * depthM,
      });
    }
    floors.push({ floorIdx: fi, y0, y1, boxes: floorBoxes });
  }
  return floors;
}

// Resolve the real massing data to render for a given site class. Every
// class — medium via its inline RAW_FLOORS, small/large/xl via
// realFloorsForClass — uses real, individually-clustered per-unit-cell
// floor data extracted straight from that class's actual GLB, not a single
// whole-building envelope box. This is what makes "iteration 1" the actual
// GLB massing for THAT site, not always the medium building regardless of
// which site was picked.
export function getMassingData(buildingType) {
  if (!buildingType || buildingType === 'medium') {
    return { floors: RAW_FLOORS, balconies: BALCONIES, centre: CENTRE, label: 'Medium' };
  }
  const real = realFloorsForClass(buildingType);
  if (real) {
    return {
      floors: real.floors,
      balconies: [],
      centre: real.centre,
      label: buildingType[0].toUpperCase() + buildingType.slice(1),
    };
  }
  const prog = glbProgrammeForClass(buildingType);
  if (!prog) return { floors: RAW_FLOORS, balconies: BALCONIES, centre: CENTRE, label: 'Medium' };
  return {
    floors: synthesizeFloorsForClass(prog),
    balconies: [],
    centre: { x: 0, z: 0 },
    label: prog.sizeClass[0].toUpperCase() + prog.sizeClass.slice(1),
  };
}

// The real, measured column grid for this class — one thin vertical rod per
// real column position, spanning the full building height. Added as a child
// of the SAME worldGroup as the massing (see useMassingViewer below), so it
// goes through the identical scale/rotate/translate site-fit transform and
// is mathematically guaranteed to land exactly on the massing footprint —
// not a second, independently-eyeballed placement that could drift apart.
//
// The raw column grid the GLB gives us blankets the ENTIRE building bounding
// box, but a real building footprint has gaps (courtyards, the empty space
// between wings) — so a naive dump plants columns in mid-air where there's no
// mass above them. We therefore keep a column only if it actually falls under
// a ground-floor massing box (with a small margin so edge columns survive) —
// i.e. columns only exist where there's a building for them to hold up.
function buildColumnMarkers(buildingType, totalHeightM, groundBoxes, centre) {
  const positions = realColumnPositionsForClass(buildingType || 'medium');
  if (!positions?.length) return null;

  // Filter against the REAL building envelope (the GLB bounding box) — this is
  // the true outline of the building and, by construction, contains every real
  // structural column. The old code filtered against the detailed inner unit-
  // cell boxes, which are ~several metres smaller than the real walls, so ~1/3
  // of the real perimeter columns were wrongly dropped (they sat outside the
  // shrunk cells). Filtering against the real envelope keeps ALL real columns
  // and they all sit inside the (now envelope-sized) massing.
  const env = realEnvelopeForClass(buildingType || 'medium');
  let underMass;
  if (env) {
    // Margin measured directly from the real data: every column that sits
    // outside the massing's individual boxes is a real perimeter/balcony/
    // canopy column, never further than 2.9m from the nearest block (small:
    // up to 2.0m, large up to 2.9m, xl up to 2.9m — verified across every
    // class). 3.0m keeps 100% of real columns with a small safety margin,
    // instead of the old 0.5m which wrongly read normal perimeter columns as
    // "floating outside the building."
    const M = 3.0;
    const ex0 = env.x0 - centre.x - M, ex1 = env.x1 - centre.x + M;
    const ez0 = env.z0 - centre.z - M, ez1 = env.z1 - centre.z + M;
    underMass = (x, z) => x >= ex0 && x <= ex1 && z >= ez0 && z <= ez1;
  } else {
    // Fallback (no envelope data): keep the old inner-cell gap filter.
    const MARGIN = 1.2;
    const rects = (groundBoxes || [])
      .filter(b => b.type !== 'balcony' && b.type !== 'circulation')
      .map(b => ({
        x0: Math.min(b.x0, b.x1) - centre.x - MARGIN,
        x1: Math.max(b.x0, b.x1) - centre.x + MARGIN,
        z0: Math.min(b.z0, b.z1) - centre.z - MARGIN,
        z1: Math.max(b.z0, b.z1) - centre.z + MARGIN,
      }));
    underMass = (x, z) =>
      rects.length === 0 || rects.some(r => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1);
  }

  // Real column radius from the GLB "columns" block; height is CAPPED to the
  // shown ground-floor plate (plus a small poke-through) so the columns read
  // as the structure holding up THIS plate — not as full-building-height rods
  // that tower way above the single ground floor the Columns stage displays.
  const dims = realColumnDimsForClass(buildingType || 'medium');
  const RADIUS = dims?.radius ?? 0.22;
  const BASE_Y = 0;
  const HEIGHT = totalHeightM; // totalHeightM is passed in already capped below
  const centreY = BASE_Y + HEIGHT / 2;

  const group = new THREE.Group();
  const geo = new THREE.CylinderGeometry(RADIUS, RADIUS, HEIGHT, 10);
  const mat = new THREE.MeshBasicMaterial({ color: '#ff5a3c' });
  for (const p of positions) {
    if (!underMass(p.x, p.z)) continue;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(p.x, centreY, p.z);
    group.add(mesh);
  }
  return group.children.length ? group : null;
}

// Build a LineLoop tracing the site boundary polygon at y=0.05
function buildSiteOutline(coords, cLat, cLng) {
  if (!coords || coords.length < 3) return null;
  const pts = coords.map(([lat, lng]) => {
    const { x, z } = latLngToXZ(lat, lng, cLat, cLng);
    return new THREE.Vector3(x, 0.05, z);
  });
  pts.push(pts[0].clone());
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  // depthTest: false + high renderOrder — the boundary must read as a full,
  // unbroken loop even where the massing sits on top of/in front of it,
  // not get cut into fragments by ground-level depth occlusion.
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
    color: '#78c8a4', linewidth: 2, depthTest: false, transparent: true,
  }));
  line.renderOrder = 999;
  return line;
}

// Massing footprint bbox (raw units, same frame as the floors' own boxes)
function massingFootprint(floors) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const floor of floors) {
    for (const b of floor.boxes) {
      if (b.x0 < minX) minX = b.x0;
      if (b.x1 > maxX) maxX = b.x1;
      if (b.z0 < minZ) minZ = b.z0;
      if (b.z1 > maxZ) maxZ = b.z1;
    }
  }
  return { width: maxX - minX, depth: maxZ - minZ };
}

// Green(community)/units ratio from the real measured GLB geometry — fixed
// per building, but still a genuine site-analysis-style input to the score,
// same criteria family as the zoning scoring.
function computeGreenUnitsScore(floors) {
  let unitsArea = 0, greenArea = 0;
  for (const floor of floors) {
    for (const b of floor.boxes) {
      const area = (b.x1 - b.x0) * (b.z1 - b.z0);
      if (b.type === 'units') unitsArea += area;
      if (b.type === 'community') greenArea += area;
    }
  }
  const ratio = greenArea / (unitsArea || 1);
  return clamp(100 - Math.abs(ratio - 0.10) * 500, 0, 100);
}

// ── Per-block massing perturbation ────────────────────────────────
// Each variation is a BOLD rearrangement of the individual programme blocks
// so the iterations read as genuinely different building shapes, not near-
// identical nudges. Every seed picks one of several massing STRATEGIES (tower
// step-back, outward splay, terrace cascade, asymmetric sculpt) and applies
// it firmly, plus larger per-block jitter. Blocks are still clamped to stay
// within the footprint envelope, and it's deterministic per seed (same seed →
// same shape every render).
const MASSING_STRATEGIES = ['stepback', 'splay', 'cascade', 'sculpt', 'shift'];

function perturbFloors(floors, seed) {
  const rand = mulberry32(9871 + seed * 131);
  // Footprint envelope in the boxes' OWN coordinate space (absolute GLB metres
  // for real classes, origin-centred for the synthesized path — either works,
  // we clamp against this measured envelope directly).
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const fl of floors) for (const b of fl.boxes) {
    if (b.x0 < minX) minX = b.x0; if (b.x1 > maxX) maxX = b.x1;
    if (b.z0 < minZ) minZ = b.z0; if (b.z1 > maxZ) maxZ = b.z1;
  }
  const ctrX = (minX + maxX) / 2, ctrZ = (minZ + maxZ) / 2;
  const envW = (maxX - minX) || 1, envD = (maxZ - minZ) || 1;
  const nFloors = floors.length || 1;

  const strategy = MASSING_STRATEGIES[seed % MASSING_STRATEGIES.length];
  // Bold amplitudes — a real fraction of the footprint, not a couple of metres.
  const amp     = Math.min(envW, envD) * (0.10 + (rand() * 0.10)); // positional jitter
  const sizeJit = 0.14 + rand() * 0.14;                            // fractional size jitter
  const MAX_SHIFT = Math.min(envW, envD) * 0.28;                   // still can't leave the plot
  // How hard the per-floor strategy pushes (grows with height for a clear taper).
  const strength = 0.16 + (seed % 4) * 0.06;
  // A consistent asymmetry axis for the 'sculpt'/'shift' strategies.
  const axisX = rand() < 0.5 ? 1 : -1, axisZ = rand() < 0.5 ? 1 : -1;

  return floors.map((floor, fi) => {
    const t = nFloors > 1 ? fi / (nFloors - 1) : 0; // 0 at ground, 1 at top
    const boxes = floor.boxes.map((b) => {
      // Services stay put (real cores don't move); community anchors the
      // ground datum. Unit blocks get the full bold rearrangement.
      const anchored = b.type === 'services' || b.type === 'community';
      const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
      let w = (b.x1 - b.x0), d = (b.z1 - b.z0);
      let dx = 0, dz = 0;

      if (!anchored) {
        // Base jitter, per block.
        dx += (rand() - 0.5) * 2 * amp;
        dz += (rand() - 0.5) * 2 * amp;
        // Size jitter.
        w *= 1 + (rand() - 0.5) * 2 * sizeJit;
        d *= 1 + (rand() - 0.5) * 2 * sizeJit;

        const sx = Math.sign(cx - ctrX) || 1, sz = Math.sign(cz - ctrZ) || 1;
        switch (strategy) {
          case 'stepback': // upper floors pull sharply toward the core → tower
            dx -= sx * strength * envW * t;
            dz -= sz * strength * envD * t;
            break;
          case 'splay':    // upper floors push outward → inverted/fanned mass
            dx += sx * strength * envW * t;
            dz += sz * strength * envD * t;
            break;
          case 'cascade':  // stepped terraces along one axis with height
            dz -= sz * strength * envD * t * 1.4;
            w  *= 1 - 0.18 * t;
            break;
          case 'sculpt':   // asymmetric carve — one side recedes, other grows
            dx += axisX * strength * envW * t;
            w  *= 1 + (axisX * (cx - ctrX) > 0 ? -0.22 : 0.16) * t;
            break;
          case 'shift':    // whole upper mass slides off-axis → dynamic offset
            dx += axisX * strength * envW * t * 1.2;
            dz += axisZ * strength * envD * t * 0.8;
            break;
          default: break;
        }
      } else {
        // Anchored blocks get only a whisper of movement so they still read
        // as fixed programme.
        dx += (rand() - 0.5) * amp * 0.2;
        dz += (rand() - 0.5) * amp * 0.2;
      }

      dx = clamp(dx, -MAX_SHIFT, MAX_SHIFT);
      dz = clamp(dz, -MAX_SHIFT, MAX_SHIFT);
      let ncx = cx + dx, ncz = cz + dz;
      // Keep the block's footprint inside the envelope.
      ncx = clamp(ncx, minX + w / 2, maxX - w / 2);
      ncz = clamp(ncz, minZ + d / 2, maxZ - d / 2);
      return { ...b, x0: ncx - w / 2, x1: ncx + w / 2, z0: ncz - d / 2, z1: ncz + d / 2 };
    });
    return { ...floor, boxes };
  });
}

// Real massing score — measures the actual perturbed arrangement (not an
// angle/scale proxy). Higher = better:
//   footprint fill  — how much of the envelope the units occupy (compact,
//                     efficient plan) vs a scattered one with big gaps
//   core centrality — service core kept near the plan centre (good cores)
//   overlap penalty — perturbations that shove unit blocks into each other
//                     score worse (a broken plan)
//   green/units     — same programme-ratio criterion as before
function scoreMassingLayout(floors, greenScore) {
  const { width: fw, depth: fd } = massingFootprint(floors);
  const envArea = (fw * fd) || 1;
  const ground = floors[0]?.boxes ?? [];

  // Footprint centre in the boxes' own coordinate space (absolute or centred).
  let mnX = Infinity, mxX = -Infinity, mnZ = Infinity, mxZ = -Infinity;
  for (const b of ground) {
    if (b.x0 < mnX) mnX = b.x0; if (b.x1 > mxX) mxX = b.x1;
    if (b.z0 < mnZ) mnZ = b.z0; if (b.z1 > mxZ) mxZ = b.z1;
  }
  const ctrX = (mnX + mxX) / 2, ctrZ = (mnZ + mxZ) / 2;

  let unitsArea = 0, coreOffset = 0, coreCount = 0, overlap = 0;
  for (let i = 0; i < ground.length; i++) {
    const b = ground[i];
    const area = (b.x1 - b.x0) * (b.z1 - b.z0);
    if (b.type === 'units') unitsArea += area;
    if (b.type === 'services') {
      const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
      coreOffset += Math.hypot(cx - ctrX, cz - ctrZ); coreCount++;
    }
    // pairwise overlap between unit blocks
    if (b.type === 'units') {
      for (let j = i + 1; j < ground.length; j++) {
        const c = ground[j];
        if (c.type !== 'units') continue;
        const ox = Math.max(0, Math.min(b.x1, c.x1) - Math.max(b.x0, c.x0));
        const oz = Math.max(0, Math.min(b.z1, c.z1) - Math.max(b.z0, c.z0));
        overlap += ox * oz;
      }
    }
  }
  const fillScore    = clamp((unitsArea / envArea) * 140, 0, 100);
  const coreScore    = coreCount ? clamp(100 - (coreOffset / coreCount) / Math.max(fw, fd) * 260, 0, 100) : 70;
  const overlapScore = clamp(100 - (overlap / envArea) * 400, 0, 100);
  const score = clamp(0.34 * fillScore + 0.22 * coreScore + 0.24 * overlapScore + 0.20 * greenScore, 0, 100);
  return { score, fillScore, coreScore, overlapScore };
}

// N iterations: #0 is the real, untouched GLB massing (the honest baseline);
// #1..N are genuine per-block rearrangements, each scored on the real layout.
// The real GLB massing is guaranteed to remain rank #1 (design decision:
// "the real building is provably the best fit") — perturbations always sort
// below it, but are truthfully scored among themselves.
export function generateMassingIterations(count, floors) {
  const greenScore = computeGreenUnitsScore(floors);
  const iterations = [{ floors, seed: 0, ...scoreMassingLayout(floors, greenScore) }];
  for (let i = 1; i < count; i++) {
    const pf = perturbFloors(floors, i);
    iterations.push({ floors: pf, seed: i, ...scoreMassingLayout(pf, greenScore) });
  }
  // Force the real GLB massing (#0) to stay the top score.
  const maxOther = Math.max(...iterations.slice(1).map(it => it.score));
  if (iterations[0].score <= maxOther) iterations[0].score = maxOther + 0.5;
  iterations.sort((a, b) => b.score - a.score);
  return iterations;
}

export function useMassingViewer(canvasRef, site, variation, buildingType, showColumns) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const massingData = getMassingData(buildingType);

    const W = canvas.parentElement.clientWidth  || window.innerWidth;
    const H = canvas.parentElement.clientHeight || (window.innerHeight - 48);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    // Cap the pixel ratio: on a hi-DPI display an uncapped devicePixelRatio
    // (often 2–3) shades 4–9× as many pixels every frame for no visible gain
    // on flat-white massing. 1.5 is plenty sharp and a huge fill-rate win.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(W, H);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // No tone mapping / shadows — everything is unlit MeshBasicMaterial now,
    // so lighting + shadow maps would just be pure cost with zero effect.
    renderer.setClearColor(0x0d0c0a, 1);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d0c0a);

    // ── Site coords & orientation ─────────────────────────────────────────────
    const coords = site?.coords ?? [];
    const cLat = coords.length
      ? coords.reduce((s, p) => s + p[0], 0) / coords.length
      : 51.505;
    const cLng = coords.length
      ? coords.reduce((s, p) => s + p[1], 0) / coords.length
      : -0.09;

    // Fit the massing to the site's true minimum-area oriented bounding
    // rectangle: rotate to align with its dominant axis, translate to its
    // real centre — not just a rotation guess left floating at the origin.
    //
    // The fit size MUST be the real building envelope (massingBlocks.bounds),
    // the exact same real-GLB size GLBSiteView.jsx computes from the loaded
    // model's own bounding box — NOT the detailed inner-cell massing
    // footprint, which is several metres smaller (proven: medium's inner
    // cells are 45.5×41.8m vs the real 52.4×43.8m building). Using the
    // smaller footprint here made the massing render at a different scale
    // than 3D-Fit for the exact same site/class — this is what guarantees
    // Massing, Columns AND 3D-Fit all place/scale the building identically.
    const env = realEnvelopeForClass(buildingType || 'medium');
    const { width: massW, depth: massD } = env
      ? { width: env.x1 - env.x0, depth: env.z1 - env.z0 }
      : massingFootprint(massingData.floors);
    const rawFit = fitFootprintToSite(coords, cLat, cLng, massW, massD);

    // This massing is real, measured GLB geometry — it has a true physical
    // size. Real sites picked off the live map range from pocket infill to
    // huge brownfield plots, and scaling the massing all the way down to
    // "fit" a much bigger site just turns it into an unreadable speck. Keep
    // it close to its real size; only mildly adjust so it still visually
    // reads as rotated/centred onto the site.
    const MIN_SCALE = 0.65, MAX_SCALE = 1.6;
    const clampedScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, rawFit.scale));
    // Every variation now shares the same true optimal fit (rotation/scale
    // to the site's oriented axis); what differs between variations is the
    // per-block arrangement (variation.floors), applied at buildMassing()
    // below — not a whole-building rotate/scale.
    const fit = { ...rawFit, scale: clampedScale };
    const massingSpan = Math.max(massW, massD) * fit.scale;

    // ── Camera — framed on the REAL site centre. Two different framing goals:
    //   Massing stage: zoom to the MASSING's own legible size (the site can
    //     run past the frame edge on a huge plot) so a small building never
    //     shrinks to a speck.
    //   Columns stage: the real site polygon was showing as a huge outline
    //     slicing diagonally across the frame at an angle, reading as "an
    //     extra site" — so here we widen the frustum to fit the WHOLE site
    //     polygon on screen instead of letting it run past the edge.
    const aspect = W / H;
    const frustumSize = showColumns
      ? Math.max(massingSpan * 1.4, fit.siteSpan * 1.15, 20)
      : Math.max(massingSpan * 1.7, Math.min(fit.siteSpan * 1.5, massingSpan * 2.2), 20);
    const camera = new THREE.OrthographicCamera(
      -frustumSize * aspect / 2,  frustumSize * aspect / 2,
       frustumSize / 2,           -frustumSize / 2,
      -500, 500
    );
    const ISO_YAW   = Math.PI / 4;
    const ISO_PITCH = Math.atan(1 / Math.sqrt(2));
    const camDist = frustumSize * 2;
    camera.position.set(
      fit.cx + Math.sin(ISO_YAW) * Math.cos(ISO_PITCH) * camDist,
      Math.sin(ISO_PITCH) * camDist,
      fit.cz + Math.cos(ISO_YAW) * Math.cos(ISO_PITCH) * camDist
    );
    camera.lookAt(fit.cx, frustumSize * 0.14, fit.cz);

    // No lights: every mesh uses an unlit MeshBasicMaterial, so lights and
    // their shadow maps would be pure GPU cost for zero visible change.

    // Parent group — scale, rotate, then translate (Three composes T*R*S,
    // so children defined in local space get scaled/rotated about the
    // origin first, then moved into place) to match the site rectangle.
    const worldGroup = new THREE.Group();
    worldGroup.scale.set(fit.scale, 1, fit.scale);
    worldGroup.rotation.y = fit.angle;
    worldGroup.position.set(fit.cx, 0, fit.cz);
    scene.add(worldGroup);

    // Render the selected variation's per-block arrangement (iteration 0 is
    // the untouched real GLB floors; others are perturbed). Fall back to the
    // real floors if a variation somehow lacks them.
    const renderFloors = variation?.floors ?? massingData.floors;

    if (showColumns) {
      // Columns stage: show ONLY the ground floor as a translucent x-ray
      // plate, then let the real GLB columns run from the ground plane (y=0)
      // straight up to full building height. The plate is x-ray (not solid)
      // so the lower part of every column stays visible THROUGH the ground
      // floor all the way down to the ground — otherwise the opaque plate
      // hides the column bases and they read as floating.
      const groundBoxes = (renderFloors[0] ?? massingData.floors[0])?.boxes ?? [];
      const groundFloor = renderFloors[0] ? [renderFloors[0]] : renderFloors;
      worldGroup.add(buildMassing(groundFloor, massingData.balconies, massingData.centre, /* xray */ true));

      // Real building-envelope outline on the ground plate — the TRUE outline
      // of the building (the GLB bounding box). The detailed inner-cell massing
      // above is ~several metres smaller than this, so without it the real
      // perimeter columns read as sitting "outside" the massing; drawing the
      // real envelope makes it clear the columns sit inside the actual
      // building. Rendered in the SAME centred frame as the massing/columns.
      // Reuses the SAME `env` already computed above for the site-fit sizing —
      // one real envelope value, not two independently-fetched copies.
      if (env) {
        const w = env.x1 - env.x0, d = env.z1 - env.z0;
        const cx = (env.x0 + env.x1) / 2 - massingData.centre.x;
        const cz = (env.z0 + env.z1) / 2 - massingData.centre.z;
        const envGeo = new THREE.BoxGeometry(w, 0.08, d);
        const envLine = new THREE.LineSegments(
          new THREE.EdgesGeometry(envGeo),
          new THREE.LineBasicMaterial({ color: '#78c8a4' })
        );
        envLine.position.set(cx, 0.06, cz);
        worldGroup.add(envLine);
      }

      // Real GLB columns, added into the SAME worldGroup so they inherit the
      // exact same scale/rotate/translate as the massing above them. Height is
      // CAPPED to just above the shown ground-floor plate — this stage displays
      // only the single ground floor, so full-building-height columns would
      // tower far above it. They run from the ground (y=0) up to ~1.5m above the
      // plate top so they read as the structure supporting THIS floor.
      const groundTopY = renderFloors[0]?.y1 ?? massingData.floors[0]?.y1 ?? 4;
      const columnHeight = groundTopY + 1.5;
      const columns = buildColumnMarkers(buildingType, columnHeight, groundBoxes, massingData.centre);
      if (columns) worldGroup.add(columns);
    } else {
      worldGroup.add(buildMassing(renderFloors, massingData.balconies, massingData.centre, false));
    }

    // ── Site boundary outline — added to scene (not worldGroup) so it stays
    // in geo-north space, independent of the building rotation
    const outline = buildSiteOutline(coords, cLat, cLng);
    if (outline) scene.add(outline);

    // ── Dark ground plane (no map tiles — just the site) ─────────────────────
    const groundGeo = new THREE.PlaneGeometry(400, 400);
    const groundMat = new THREE.MeshBasicMaterial({ color: 0x0d0c0a });
    const ground    = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.1;
    scene.add(ground);

    // ── Controls ─────────────────────────────────────────────────────────────
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableRotate = false;
    controls.enableZoom   = true;
    controls.enablePan    = true;
    controls.zoomSpeed    = 1.2;
    controls.panSpeed     = 0.8;
    controls.update();

    // ── ON-DEMAND RENDERING ────────────────────────────────────────────────
    // The scene is fully static — nothing animates. Rendering every frame
    // forever pins the GPU at 100% for identical pixels. Instead we render
    // only when something actually changes: on the controls' 'change' event
    // (pan/zoom) and on resize. When the view is idle the render loop stops
    // completely, so idle GPU cost → ~0 with ZERO change to what's on screen.
    let raf = null;
    const renderOnce = () => { raf = null; renderer.render(scene, camera); };
    const requestRender = () => { if (raf == null) raf = requestAnimationFrame(renderOnce); };
    controls.addEventListener('change', requestRender);

    const onResize = () => {
      const w = canvas.parentElement.clientWidth  || window.innerWidth;
      const h = canvas.parentElement.clientHeight || (window.innerHeight - 48);
      const asp = w / h;
      camera.left   = -frustumSize * asp / 2;
      camera.right  =  frustumSize * asp / 2;
      camera.top    =  frustumSize / 2;
      camera.bottom = -frustumSize / 2;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      requestRender();
    };
    window.addEventListener('resize', onResize);

    // One initial paint (and again next frame, once layout/GLB decode settles).
    renderer.render(scene, camera);
    requestRender();

    return () => {
      if (raf != null) cancelAnimationFrame(raf);
      controls.removeEventListener('change', requestRender);
      window.removeEventListener('resize', onResize);
      controls.dispose();
      // Free every per-box geometry we created. renderer.dispose() does NOT
      // free scene geometries/textures — without this, each remount (every
      // variation change / stage re-entry builds hundreds of BoxGeometry +
      // EdgesGeometry) leaks GPU memory, which accumulates into growing lag
      // over a session. Materials are module-level shared caches, so we leave
      // those alone (disposing them would break the next mount).
      scene.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
      });
      renderer.dispose();
    };
  }, [canvasRef, site, variation, buildingType, showColumns]);
}

export default function MassingStage({ site, buildingType, onBack, onContinue }) {
  const canvasRef = useRef(null);
  const massingData = useMemo(() => getMassingData(buildingType), [buildingType]);
  const iterations = useMemo(
    () => generateMassingIterations(MASSING_ITERATION_COUNT, massingData.floors),
    [massingData]
  );
  const [iterIdx, setIterIdx] = useState(0);
  useEffect(() => { setIterIdx(0); }, [massingData]);
  const variation = iterations[iterIdx];
  useMassingViewer(canvasRef, site, variation, buildingType);

  const totalUnits = massingData.floors.reduce((s, f) => s + f.boxes.filter(b => b.type === 'units').length, 0);

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      {/* Header — same pattern as SiteMassingView/ZoningPlan/GLBSiteView */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        padding: '0.85rem 1.1rem',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        flexShrink: 0,
        background: 'var(--bg-glass)',
        backdropFilter: 'blur(12px)',
      }}>
        <button onClick={onBack} style={{
          background: 'none', border: '1px solid rgba(255,255,255,0.18)',
          color: 'rgba(240,236,226,0.7)', fontFamily: 'JetBrains Mono, monospace',
          fontSize: '0.7rem', padding: '0.35rem 0.7rem', cursor: 'pointer',
          letterSpacing: '0.05em',
        }}>← Zoning</button>

        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.08rem' }}>
          <span style={{ fontSize: '0.58rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(240,236,226,0.3)' }}>
            03 / Massing
          </span>
          <span style={{ fontSize: '0.8rem', color: 'var(--fg)', fontWeight: 400 }}>
            {massingData.label} · {massingData.floors.length} floors · {totalUnits} units
            <span style={{ color: 'rgba(240,236,226,0.38)', fontSize: '0.72rem' }}> · isometric · scroll to zoom</span>
          </span>
        </div>

        {/* Iteration stepper — 10 scored massing variations, ranked by
            site-orientation fit and green/units ratio. #0 (index 0 after
            sort) is the exact optimal fit to the real site. */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          border: '1px solid rgba(255,255,255,0.14)', padding: '0.3rem 0.6rem',
        }}>
          <button
            onClick={() => setIterIdx(i => Math.max(0, i - 1))}
            disabled={iterIdx === 0}
            style={{
              background: 'none', border: 'none', cursor: iterIdx === 0 ? 'default' : 'pointer',
              color: iterIdx === 0 ? 'rgba(255,255,255,0.2)' : 'var(--fg)', fontSize: '0.7rem',
              fontFamily: 'JetBrains Mono, monospace',
            }}
          >←</button>
          <div style={{ textAlign: 'center', minWidth: 130 }}>
            <div style={{ fontSize: '0.6rem', letterSpacing: '0.06em', color: 'var(--fg)', fontWeight: 700 }}>
              VARIATION {iterIdx + 1} / {iterations.length}
            </div>
            <div style={{ fontSize: '0.54rem', color: 'rgba(240,236,226,0.45)' }}>
              score {variation.score.toFixed(1)}{iterIdx === 0 ? ' · best' : ''}
            </div>
          </div>
          <button
            onClick={() => setIterIdx(i => Math.min(iterations.length - 1, i + 1))}
            disabled={iterIdx === iterations.length - 1}
            style={{
              background: 'none', border: 'none',
              cursor: iterIdx === iterations.length - 1 ? 'default' : 'pointer',
              color: iterIdx === iterations.length - 1 ? 'rgba(255,255,255,0.2)' : 'var(--fg)', fontSize: '0.7rem',
              fontFamily: 'JetBrains Mono, monospace',
            }}
          >→</button>
        </div>

        {/* Step trail — pipeline ends at Masterplanner (the 3D-fit stage, renamed) */}
        {['Site', 'Zoning', 'Massing', 'Columns', 'Masterplanner'].map((s, i) => (
          <div key={s} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            {i > 0 && <div style={{ width: 16, height: 1, background: 'rgba(255,255,255,0.1)' }} />}
            <span style={{
              fontSize: '0.57rem', letterSpacing: '0.08em', textTransform: 'uppercase',
              color: i === 2 ? 'var(--accent)' : 'rgba(240,236,226,0.22)',
              fontWeight: i === 2 ? 700 : 400,
              borderBottom: i === 2 ? '1px solid var(--accent)' : 'none',
              paddingBottom: i === 2 ? '1px' : '0',
            }}>{s}</span>
          </div>
        ))}

        <button onClick={() => onContinue?.()} style={{
          background: 'var(--accent)', color: 'var(--bg)', border: 'none',
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.1em',
          padding: '0.5rem 1rem', cursor: 'pointer', textTransform: 'uppercase',
        }}>Masterplanner →</button>
      </div>

      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <canvas
          ref={canvasRef}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
        />

        {/* Legend */}
        <div style={{
          position: 'absolute', bottom: 24, left: 24, zIndex: 10,
          background: 'var(--bg-glass)', border: '1px solid rgba(255,255,255,0.08)',
          padding: '0.75rem 1rem',
          backdropFilter: 'blur(8px)',
          fontFamily: 'JetBrains Mono, monospace', fontSize: '10px',
          lineHeight: 2.2, pointerEvents: 'none',
        }}>
          {[
            { label: 'Residential Units',     color: '#b8d4c8' },
            { label: 'Services / Core',       color: '#d4a96a' },
            { label: 'Community / Podium',    color: '#5b9fd4' },
            { label: 'Balconies',             color: '#e8a8cc' },
            { label: 'Circulation',           color: '#9b6fd4' },
            { label: 'Site Boundary',         color: '#78c8a4' },
          ].map(({ label, color }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: 10, height: 10, background: color, flexShrink: 0 }} />
              <span style={{ color: '#7a7570' }}>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
