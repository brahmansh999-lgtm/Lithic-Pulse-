import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { fitFootprintToSite, mulberry32, siteToLocalPolygon, footprintInsidePolygon, pointInPolygon, clampFitScale } from './siteFit';
import { glbProgrammeForClass, realColumnPositionsForClass, realColumnDimsForClass, realFloorsForClass, realEnvelopeForClass, realStairAreaForClass, realCorridorWidthForClass } from './glbProgramme';
import { buildRealRoomVariation, REAL_ROOM_VARIATIONS } from './realRoomVariations';
import { buildZoneGraph, relaxGraph } from './bubbleLayout';
import {
  wingFloorTierNodes, wingAdjacency, wingBaseRadius, wingZoneTypes, wingType,
  UNITS_BED_GROUPS, BED_GROUP_BASE_RADIUS, bedGroupAdjacency, WING_SIZE_DECAY,
  CORE_ZONE_TYPES, CORE_STAIR_AREA_M2, CORE_LIFT_AREA_M2, WING_SUBZONE_TYPES,
} from './zoningGraph';
import { rasterizeSitePolygon, largestConnectedRegion, assignCellsToZones, cellsToBoxes, insetPolygon, clipBoxToGrid, pointToCell, GRID_CELL, BOUNDARY_SETBACK_M } from './siteGrid';
import { subdivideIntoDwellings, countDwellings, dwellingMix, stampBoxHeights, bedGroupShares } from './dwellings';
import { sunniestEdge, biasForcesFromFacts } from './siteFacts';
import BubbleDiagram, { isMovableZone } from './BubbleDiagram';
import { useOsmContext } from './useOsmContext';
import CarbonBadge from '../shared/CarbonBadge';
import { computeTileTransforms, replicateFloorsAcrossSite } from './siteTiling';
import { downloadRhinoExport } from './rhinoExport';
import { CLASS_REGISTRY, classGeometry } from './buildingClasses';
import { traceOutline } from './mergeFootprints';

export const MASSING_ITERATION_COUNT = 10;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Dragging a bubble (pointermove) or a slider (range input) fires a state
// update on EVERY intermediate tick — but each tick used to feed straight
// into briefLayouts/iterations, which re-run 8 full bubble relaxations plus
// 10 dwelling-subdivision+column-filter passes synchronously. That's dozens
// of expensive recomputes per second of dragging, which is what made this
// page lag. The UI state itself still updates instantly (sliders/bubbles
// read the raw value, so they never feel unresponsive) — only the value fed
// into the HEAVY memo is debounced, so the real recompute happens once,
// shortly after the user stops moving, instead of on every pixel.
function useDebouncedValue(value, delayMs) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

// ── Programme data (from scripts/extractProgramme3.mjs) ──────────────────────
const RAW_FLOORS = [{"floorIdx":0,"y0":0.5,"y1":4.5,"boxes":[{"type":"services","x0":332.894,"x1":340.902,"y0":0.5,"y1":4.5,"z0":270.45,"z1":272.102},{"type":"community","x0":352.316,"x1":356.73,"y0":0.5,"y1":4.5,"z0":242.745,"z1":260.946},{"type":"units","x0":340.863,"x1":348.863,"y0":0.5,"y1":4.5,"z0":273.617,"z1":281.617},{"type":"units","x0":354.703,"x1":368.137,"y0":0.5,"y1":4.5,"z0":246.176,"z1":254.906},{"type":"units","x0":354.703,"x1":364.198,"y0":0.5,"y1":4.5,"z0":261.619,"z1":273.826},{"type":"units","x0":329.091,"x1":339.091,"y0":0.5,"y1":4.5,"z0":274.202,"z1":278.944},{"type":"units","x0":322.676,"x1":327.407,"y0":0.5,"y1":4.5,"z0":274.514,"z1":284.459},{"type":"units","x0":322.676,"x1":337.403,"y0":0.5,"y1":4.5,"z0":246.176,"z1":270.506},{"type":"units","x0":322.619,"x1":334.879,"y0":0.5,"y1":4.5,"z0":258.468,"z1":267.209}]},{"floorIdx":1,"y0":4.5,"y1":8.0,"boxes":[{"type":"services","x0":332.894,"x1":340.902,"y0":4.5,"y1":8.0,"z0":270.45,"z1":272.102},{"type":"units","x0":322.619,"x1":335.219,"y0":4.5,"y1":8.0,"z0":246.131,"z1":270.431},{"type":"units","x0":340.863,"x1":348.863,"y0":4.5,"y1":8.0,"z0":273.617,"z1":281.617},{"type":"units","x0":355.765,"x1":368.031,"y0":4.5,"y1":8.0,"z0":246.176,"z1":254.906},{"type":"units","x0":355.765,"x1":364.11,"y0":4.5,"y1":8.0,"z0":261.619,"z1":273.826},{"type":"units","x0":329.041,"x1":339.041,"y0":4.5,"y1":8.0,"z0":274.148,"z1":278.888},{"type":"units","x0":322.676,"x1":327.407,"y0":4.5,"y1":8.0,"z0":274.514,"z1":284.459},{"type":"units","x0":355.765,"x1":368.031,"y0":4.5,"y1":8.0,"z0":258.468,"z1":267.209}]},{"floorIdx":2,"y0":8.0,"y1":11.5,"boxes":[{"type":"services","x0":332.894,"x1":340.902,"y0":8.0,"y1":11.5,"z0":270.45,"z1":272.102},{"type":"units","x0":322.676,"x1":327.407,"y0":8.0,"y1":11.5,"z0":274.514,"z1":284.459},{"type":"units","x0":329.041,"x1":339.041,"y0":8.0,"y1":11.5,"z0":274.148,"z1":278.888},{"type":"units","x0":355.765,"x1":364.11,"y0":8.0,"y1":11.5,"z0":261.619,"z1":273.826},{"type":"units","x0":355.765,"x1":368.031,"y0":8.0,"y1":11.5,"z0":246.176,"z1":254.906},{"type":"units","x0":322.619,"x1":335.219,"y0":8.0,"y1":11.5,"z0":246.131,"z1":270.431},{"type":"units","x0":340.863,"x1":348.863,"y0":8.0,"y1":11.5,"z0":273.517,"z1":281.517}]},{"floorIdx":3,"y0":11.5,"y1":15.0,"boxes":[{"type":"services","x0":332.894,"x1":340.902,"y0":11.5,"y1":15.0,"z0":270.45,"z1":272.102},{"type":"units","x0":322.676,"x1":327.407,"y0":11.5,"y1":15.0,"z0":274.414,"z1":284.359},{"type":"units","x0":329.041,"x1":339.041,"y0":11.5,"y1":15.0,"z0":274.048,"z1":278.788},{"type":"units","x0":355.765,"x1":364.11,"y0":11.5,"y1":15.0,"z0":261.519,"z1":273.726},{"type":"units","x0":355.765,"x1":368.031,"y0":11.5,"y1":15.0,"z0":246.076,"z1":254.806},{"type":"units","x0":322.619,"x1":335.219,"y0":11.5,"y1":15.0,"z0":246.031,"z1":270.331},{"type":"units","x0":340.863,"x1":348.863,"y0":11.5,"y1":15.0,"z0":273.517,"z1":281.517}]},{"floorIdx":4,"y0":15.0,"y1":19.0,"boxes":[{"type":"services","x0":332.894,"x1":340.902,"y0":15.0,"y1":19.0,"z0":270.45,"z1":272.102},{"type":"units","x0":322.676,"x1":327.407,"y0":15.0,"y1":19.0,"z0":274.414,"z1":284.359},{"type":"units","x0":329.041,"x1":339.041,"y0":15.0,"y1":19.0,"z0":274.048,"z1":278.788},{"type":"units","x0":355.765,"x1":364.11,"y0":15.0,"y1":19.0,"z0":261.519,"z1":273.726},{"type":"units","x0":355.765,"x1":368.031,"y0":15.0,"y1":19.0,"z0":246.076,"z1":254.806},{"type":"units","x0":322.619,"x1":335.219,"y0":15.0,"y1":19.0,"z0":246.031,"z1":270.331},{"type":"units","x0":340.863,"x1":348.863,"y0":15.0,"y1":19.0,"z0":273.517,"z1":281.517}]},{"floorIdx":5,"y0":19.0,"y1":22.5,"boxes":[{"type":"services","x0":332.894,"x1":340.902,"y0":19.0,"y1":22.5,"z0":270.45,"z1":272.102},{"type":"units","x0":322.676,"x1":327.407,"y0":19.0,"y1":22.5,"z0":274.414,"z1":284.359},{"type":"units","x0":329.041,"x1":339.041,"y0":19.0,"y1":22.5,"z0":274.048,"z1":278.788},{"type":"units","x0":355.765,"x1":364.11,"y0":19.0,"y1":22.5,"z0":261.519,"z1":273.726},{"type":"units","x0":355.765,"x1":368.031,"y0":19.0,"y1":22.5,"z0":246.076,"z1":254.806},{"type":"units","x0":322.619,"x1":335.219,"y0":19.0,"y1":22.5,"z0":246.031,"z1":270.331},{"type":"units","x0":340.863,"x1":348.863,"y0":19.0,"y1":22.5,"z0":273.517,"z1":281.517}]}];

const CENTRE = {
  x: (319.159 + 371.51) / 2,
  z: (242.622 + 286.445) / 2,
};

export const PALETTE = {
  // Fallback for 'units' floorplate with no resolved bed count yet (a
  // leftover sliceBox fragment too small/oddly-shaped to be a home — see
  // dwellings.js) — neutral grey, not green: it isn't landscaping, and
  // BED_PALETTE below already owns green-shape territory with actual homes.
  units:       { face: '#c9c6be', edge: '#726d61' },
  services:    { face: '#d4a96a', edge: '#7a4a10' },
  community:   { face: '#5b9fd4', edge: '#1a4a7a' },
  // Real green patches (see zoningGraph.js's green_0..green_N) — a low,
  // bright-green planted slab, deliberately NOT styled like a building
  // volume (see the height rule below), so it reads as landscaping whether
  // it lands as a ground-floor courtyard between wings or an upper-floor
  // roof terrace.
  greenpatch:  { face: '#8fc98a', edge: '#3f7a44' },
  // Real corridor, carved from each wing's own claimed cells — see
  // carveWingCorridor/CORRIDOR_WIDTH_M below (a genuine London Housing
  // Design Guide minimum, not an invented number).
  circulation: { face: '#9b6fd4', edge: '#4a1a7a' },
  entry:       { face: '#e06a4a', edge: '#8a2a10' },
  // Rule-based estimate, not measured GLB geometry — see zoningGraph.js's
  // CORE_ZONE_TYPES note.
  core_stair:  { face: '#8a8a8a', edge: '#333333' },
  core_lift:   { face: '#6a90b8', edge: '#1f4060' },
  // Real balconies (see glbProgramme.js's programme{Small,Large,Xl}.json —
  // extracted from each real building's own railing geometry, its 3D proxy
  // since balcony slabs themselves aren't separately modelled). A thin
  // outdoor terrace, not a room — same "shallow slab" treatment as
  // greenpatch below, just a distinct colour so it doesn't read as planting.
  balcony:     { face: '#d4c48a', edge: '#8a7a3a' },
};

// Dwellings are shaded by bed count so the massing reads as a real unit mix.
// Hues follow the same 1B→4B ramp the Masterplan viewer already uses
// (masterplanGenerator's BED_COLORS), kept in step so a 3-bed is the same
// colour in both views rather than two unrelated schemes. Bold, genuinely
// different hues (yellow/blue/red/violet), not shades of one colour — and
// deliberately excludes green, which this same 3D view already uses for
// real landscaping (greenpatch/community): a unit that green read as more
// landscaping rather than a home.
export const BED_PALETTE = {
  1: { face: '#e8d43f', edge: '#8a7a1f' }, // 1B — yellow
  2: { face: '#4a6fd4', edge: '#1f2f7a' }, // 2B — blue
  3: { face: '#d1453f', edge: '#7a1f1a' }, // 3B — red
  4: { face: '#8b3fa8', edge: '#4a1f5c' }, // 4B / penthouse — violet
};
export function bedPalette(beds) {
  return BED_PALETTE[beds] ?? PALETTE.units;
}


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
export function faceMat(color) {
  let m = FACE_MAT_CACHE.get(color);
  if (!m) { m = new THREE.MeshBasicMaterial({ color }); FACE_MAT_CACHE.set(color, m); }
  return m;
}
const EDGE_MAT_CACHE = new Map();
export function edgeMat(color) {
  let m = EDGE_MAT_CACHE.get(color);
  if (!m) { m = new THREE.LineBasicMaterial({ color }); EDGE_MAT_CACHE.set(color, m); }
  return m;
}
// X-ray plate (Show Columns mode) — dimmed hard so the columns are clearly
// the subject, not the massing. Units are secondary context here, not the
// thing being reviewed, so both the face AND the edge lines go to a faint
// flat grey instead of the massing's normal per-bed-count colours — full-
// strength colored wireframes were competing with the columns for attention.
const XRAY_MAT = new THREE.MeshBasicMaterial({
  color: '#e2e4e0', transparent: true, opacity: 0.14, depthWrite: false,
});
// Edge lines kept more visible than the face fill (0.14) — a column's
// height genuinely depends on where each floor above it actually steps
// back (see columnRunsToFootprint), and that step-back is otherwise
// invisible at 0.35, making very different column heights right next to
// each other look arbitrary instead of legibly "that floor stopped here".
const XRAY_EDGE_MAT = new THREE.LineBasicMaterial({
  color: '#9aa098', transparent: true, opacity: 0.6,
});

export function addBox(group, x0, x1, y0, y1, z0, z1, pal, fullH, centre, xray) {
  const w = x1 - x0, h = y1 - y0, d = z1 - z0;
  const cx = (x0 + x1) / 2 - centre.x;
  const cy = (y0 + y1) / 2;
  const cz = (z0 + z1) / 2 - centre.z;
  const geo = new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(geo, xray ? XRAY_MAT : faceMat(pal.face));
  mesh.position.set(cx, cy, cz);
  group.add(mesh);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), xray ? XRAY_EDGE_MAT : edgeMat(pal.edge));
  edges.position.set(cx, cy, cz);
  group.add(edges);
}

// Circulation reads as a real corridor spine, not a room volume — a thin
// centerline PATH along the corridor box's own long axis, not its full real
// width. A true single-pixel THREE.Line is worthless here (WebGL ignores
// line-width on virtually every platform, so it vanishes at any zoom a
// presentation would actually use) — a narrow ribbon gives the same "it's a
// path, not a room" read while staying visible on screen. Width is capped
// small and independent of the real corridor width (which stays the honest
// number in the data/area budget; only the render simplifies it to a line).
// Wide enough to actually read on screen at a normal (non-zoomed-in) view —
// 0.5m was true to a real walking path but rendered as a sub-pixel hairline
// at default zoom, effectively invisible (verified live: barely a smudge at
// the massing stage's default camera distance). This is a presentation
// legibility choice, not a real dimension — the honest corridor width stays
// in the underlying box data/area budget untouched.
const CORRIDOR_LINE_WIDTH_M = 1.4;
const CORRIDOR_LINE_HEIGHT_M = 0.3;
export function addCorridorLine(group, box, y, pal, centre) {
  const dx = box.x1 - box.x0, dz = box.z1 - box.z0;
  const alongX = dx >= dz;
  const half = CORRIDOR_LINE_WIDTH_M / 2;
  const cx = (box.x0 + box.x1) / 2, cz = (box.z0 + box.z1) / 2;
  const x0 = alongX ? box.x0 : cx - half;
  const x1 = alongX ? box.x1 : cx + half;
  const z0 = alongX ? cz - half : box.z0;
  const z1 = alongX ? cz + half : box.z1;
  addBox(group, x0, x1, y, y + CORRIDOR_LINE_HEIGHT_M, z0, z1, pal, true, centre, false);
}

// Extrude a real polygonal footprint (mergeFootprints' `outline`) instead of a
// cuboid, so an L/T/U-shaped zone renders as the shape it actually is rather
// than as a bounding box that swallows its own notch.
//
// Three's ExtrudeGeometry extrudes along +Z from a 2D XY shape, so the shape
// is built in (x, z) and then rotated flat: X stays X, the shape's Y becomes
// world Z, and the extrusion depth becomes world Y (height).
export function addPolyPrism(group, outline, y0, y1, pal, centre, xray) {
  const h = y1 - y0;
  if (!(h > 0) || !outline || outline.length < 3) return;
  const shape = new THREE.Shape();
  shape.moveTo(outline[0].x - centre.x, outline[0].z - centre.z);
  for (let i = 1; i < outline.length; i++) {
    shape.lineTo(outline[i].x - centre.x, outline[i].z - centre.z);
  }
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
  // Lay the extrusion down: shape-plane XY -> world XZ, depth -> world +Y.
  geo.rotateX(Math.PI / 2);
  // rotateX maps +Z(depth) to -Y, so translate up by the full height to sit
  // the prism on y0 rather than hanging below it.
  geo.translate(0, y1, 0);
  const mesh = new THREE.Mesh(geo, xray ? XRAY_MAT : faceMat(pal.face));
  group.add(mesh);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), xray ? XRAY_EDGE_MAT : edgeMat(pal.edge));
  group.add(edges);
}

// xray: render the massing boxes as translucent shells (low opacity, no
// depth-write) so the real GLB column rods added on top in ColumnPlacementStage
// stay visible through the mass instead of being hidden inside solid blocks.
// Adjacent units/core boxes are real, separate rectangles that happen to
// touch edge-to-edge (party walls) — but with zero gap between them, two
// touching boxes of the same or contrasting colour read visually as one
// fused notched shape (an apparent L/T/U) even though neither box's own
// geometry is anything but a plain rectangle. A small visual-only reveal
// shrinks each room-like box a hair on every side so the render shows the
// real seam between them; it never touches the underlying box data (areas,
// overlap scoring, exports) — purely how buildMassing draws it.
const ROOM_REVEAL_M = 0.15;
const REVEALED_TYPES = new Set(['units', 'core_stair', 'core_lift']);

function buildMassing(floors, centre, xray) {
  const group = new THREE.Group();
  const GAP = 0.18;
  for (const floor of floors) {
    const flH  = floor.y1 - floor.y0 - GAP;
    const flY0 = floor.y0 + GAP / 2;
    const flY1 = flY0 + flH;
    for (const b of floor.boxes) {
      // Green space is deliberately not drawn in the 3D massing — explicit
      // user call. The zoning/area-budget system still allocates and scores
      // it (courtyard/terrace area stays a real accounted zone), only the
      // render skips it.
      if (b.type === 'greenpatch') continue;
      // Community/podium reads as a lower, wider datum; circulation is a
      // real but thin surface (the leftover real slab area between rooms,
      // not a full room volume) — floats just above the floor gap so it
      // reads as a connective walking surface, not another solid block.
      // A green patch is shallower still — a planted slab, not a room —
      // whether it's a ground-floor courtyard or an upper-floor terrace.
      let topY = b.type === 'community' ? flY0 + (flY1 - flY0) * 0.6
        : b.type === 'greenpatch' ? flY0 + Math.min(0.35, (flY1 - flY0) * 0.15)
        : b.type === 'balcony' ? flY0 + Math.min(0.35, (flY1 - flY0) * 0.15)
        : b.type === 'circulation' ? flY0 + 0.12
        : flY1;
      // Double-height penthouses (dwellings.js) extrude one extra floor
      // height ABOVE the roofline rather than consuming the floor below, so
      // the storey count and every dwelling underneath stay untouched and
      // only the silhouette changes. heightFloors is optional — a box without
      // it renders exactly as before.
      if (b.heightFloors > 1 && b.type === 'units') {
        topY = flY0 + flH * b.heightFloors + GAP * (b.heightFloors - 1);
      }
      // Colour dwellings by bed count so the massing reads as a real unit mix
      // rather than one flat green; untyped floorplate keeps the base palette.
      const pal = (b.type === 'units' && b.beds) ? bedPalette(b.beds) : PALETTE[b.type];
      // A merged zone carries a real polygonal outline (L/T/U shape). Extrude
      // that rather than its bounding box, which would fill in the notch and
      // claim area the zone does not have.
      let rx0 = b.x0, rx1 = b.x1, rz0 = b.z0, rz1 = b.z1;
      if (REVEALED_TYPES.has(b.type)) {
        const r = ROOM_REVEAL_M / 2;
        if (rx1 - rx0 > ROOM_REVEAL_M * 2) { rx0 += r; rx1 -= r; }
        if (rz1 - rz0 > ROOM_REVEAL_M * 2) { rz0 += r; rz1 -= r; }
      }
      if (b.outline) addPolyPrism(group, b.outline, flY0, topY, pal, centre, xray);
      else if (b.type === 'circulation') addCorridorLine(group, b, flY0 + 0.12, pal, centre);
      else addBox(group, rx0, rx1, flY0, topY, rz0, rz1, pal, true, centre, xray);
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

// Resolve the real massing data to render for a given site class. All 4
// classes (small/medium/large/xl) now go through the SAME realFloorsForClass
// path (data/programme{Small,Medium,Large,Xl}.json) — real, individually-
// clustered per-unit-cell floor data extracted straight from that class's
// actual GLB, not a single whole-building envelope box, and not a second,
// divergent derivation for medium (see glbProgramme.js's REAL_FLOORS_BY_CLASS
// comment). This is what makes "iteration 1" the actual GLB massing for THAT
// site, not always the medium building regardless of which site was picked.
// A hard cap on real storey count, applied at the single choke point every
// class's floor data passes through — cascades to floorsFromBubbleLayout,
// generateMassingIterations' floors-up/floors-down topology op, the 3D view,
// Columns stage and the Rhino export alike, so nothing downstream can ever
// see more than this many floors regardless of what the source GLB actually
// measured (medium is 6, large/xl are 5 — see programme*.json). User-set
// design constraint, not a measured fact: keeps every scheme at a walk-up-
// plus-lift scale rather than the taller real precedents.
export const MAX_BUILDING_FLOORS = 4;

export function getMassingData(buildingType) {
  const cls = buildingType || 'medium';
  const real = realFloorsForClass(cls);
  if (real) {
    return {
      floors: real.floors.slice(0, MAX_BUILDING_FLOORS),
      centre: real.centre,
      label: cls[0].toUpperCase() + cls.slice(1),
    };
  }
  // Fallback chain only reached if programmeMedium.json/massingBlocks.json
  // ever fail to load — inline RAW_FLOORS/CENTRE stay as a last resort.
  const prog = glbProgrammeForClass(cls);
  if (!prog) return { floors: RAW_FLOORS.slice(0, MAX_BUILDING_FLOORS), centre: CENTRE, label: 'Medium' };
  return {
    floors: synthesizeFloorsForClass(prog).slice(0, MAX_BUILDING_FLOORS),
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
// Filters the real measured column positions down to whichever ones actually
// sit under THIS variation's own ground-floor boxes (groundBoxes) — not the
// fixed real building envelope, since a massing variation can now genuinely
// reshape/shrink the footprint (splitUnitBlocks/mergeClosestUnitBlocks/
// adjustFloorCount in generateMassingIterations). Extracted as a standalone,
// non-Three.js function so ColumnPlacementStage.jsx's on-screen stats panel
// and the Rhino export can use the EXACT same filtered set the 3D view
// renders — previously those read the raw unfiltered
// realColumnPositionsForClass() directly, so an architect could download an
// export with columns the on-screen view never showed. Same generous margin
// the original filter used (real perimeter/balcony/canopy columns sit up to
// ~2.9m outside their nearest block, verified across every class).
// Detects the real column grid's own module/pitch from its measured
// positions. NOT a simple per-axis mode of raw coordinates: checked
// directly against XL's real data, many real columns come as tightly
// COUPLED PAIRS ~0.6-0.9m apart (a genuine structural detail — flanking a
// wall opening — already noted in ColumnPlacementStage's span-stats
// comment, not extraction noise), which dominates any naive "most common
// gap" measurement and produces a pitch far too fine to be the real bay
// spacing. Real columns/wings also don't sit on one single global
// rectilinear axis (irregular footprint, angled wings), so per-axis mode
// detection doesn't converge on a clean value either way.
//
// Instead: merge points within 3m into cluster centres (collapsing coupled
// pairs into one representative bay position), then take the MEDIAN
// nearest-neighbour distance between cluster centres as an isotropic real
// bay-spacing estimate — checked directly against XL: median ~4.0m once
// coupled pairs are merged, a plausible real column bay. Falls back to 8m
// (the pitch that recurs in every class's own unit-cell box dimensions,
// see subdivideIntoDwellings) if the real set is too sparse to measure.
function detectColumnPitch(positions) {
  const CLUSTER_THRESHOLD = 3;
  const used = new Array(positions.length).fill(false);
  const clusters = [];
  for (let i = 0; i < positions.length; i++) {
    if (used[i]) continue;
    const group = [positions[i]];
    used[i] = true;
    for (let j = i + 1; j < positions.length; j++) {
      if (used[j]) continue;
      if (Math.hypot(positions[i].x - positions[j].x, positions[i].z - positions[j].z) < CLUSTER_THRESHOLD) {
        group.push(positions[j]); used[j] = true;
      }
    }
    clusters.push({
      x: group.reduce((s, p) => s + p.x, 0) / group.length,
      z: group.reduce((s, p) => s + p.z, 0) / group.length,
    });
  }
  const nn = clusters.map((p, i) => {
    let best = Infinity;
    for (let j = 0; j < clusters.length; j++) {
      if (i === j) continue;
      const d = Math.hypot(p.x - clusters[j].x, p.z - clusters[j].z);
      if (d < best) best = d;
    }
    return best;
  }).filter(Number.isFinite).sort((a, b) => a - b);
  const pitch = nn.length ? nn[Math.floor(nn.length / 2)] : 8;
  const anchorX = Math.min(...positions.map(p => p.x));
  const anchorZ = Math.min(...positions.map(p => p.z));
  return { pitchX: pitch, pitchZ: pitch, anchorX, anchorZ };
}

const MAX_EXTENDED_COLUMNS = 4000; // perf/legibility safeguard, not a design truth

// User-directed ("map all the edges"): walk EVERY real room box's own full
// perimeter — every corner plus intermediate points along each edge at
// `spacing` — not just each edge's corners/midpoint. Points still land
// EXACTLY on the box's own x0/x1/z0/z1 line (never "near" it), so every
// real edge is genuinely traced, not sampled at 3 points and called done.
// The dedupe step in extendColumnsAlongBoxEdges (floored at
// MIN_COLUMN_SPACING_M) is what keeps this from reading as cluttered.
function boxPerimeterPoints(x0, x1, z0, z1, spacing) {
  const w = x1 - x0, d = z1 - z0;
  if (!(w > 0) || !(d > 0)) return [];
  const nx = Math.max(1, Math.round(w / spacing));
  const nz = Math.max(1, Math.round(d / spacing));
  const pts = [];
  for (let i = 0; i <= nx; i++) {
    const x = x0 + (w * i) / nx;
    pts.push({ x, z: z0 }, { x, z: z1 });
  }
  for (let j = 1; j < nz; j++) {
    const z = z0 + (d * j) / nz;
    pts.push({ x: x0, z }, { x: x1, z });
  }
  return pts;
}

// User-directed ("map exactly to the boundary of the bldg"): walk the
// building's TRUE exterior silhouette — traceOutline's real union outline
// of every real room box together (party walls between adjacent units
// cancel out, only the outer ring survives) — not each box's own edges
// (which include those interior party walls) and not a filled interior
// grid. Points still land EXACTLY on the outline's own segments, walked at
// `spacing` along each edge, same convention as boxPerimeterPoints.
function outlinePerimeterPoints(ring, spacing) {
  const pts = [];
  for (let i = 0; i < ring.length; i++) {
    const p0 = ring[i], p1 = ring[(i + 1) % ring.length];
    const segLen = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    if (segLen < 1e-6) continue;
    const n = Math.max(1, Math.round(segLen / spacing));
    for (let k = 0; k <= n; k++) {
      if (k === n && i < ring.length - 1) continue; // next segment's start covers this
      const t = k / n;
      pts.push({ x: p0.x + (p1.x - p0.x) * t, z: p0.z + (p1.z - p0.z) * t });
    }
  }
  return pts;
}

function pointInsideBox(x, z, b, tol = 0.05) {
  return x >= b.x0 - tol && x <= b.x1 + tol && z >= b.z0 - tol && z <= b.z1 + tol;
}

function distPointToSegment(px, pz, x0, z0, x1, z1) {
  const dx = x1 - x0, dz = z1 - z0;
  const lenSq = dx * dx + dz * dz;
  const t = lenSq > 1e-12 ? Math.max(0, Math.min(1, ((px - x0) * dx + (pz - z0) * dz) / lenSq)) : 0;
  return Math.hypot(px - (x0 + t * dx), pz - (z0 + t * dz));
}

// Real-rooms boxes (variations 1-9) carry a real, possibly ROTATED `outline`
// polygon (transformBoxToOutline) — their own x0/x1/z0/z1 is just that
// rotated shape's bounding box, not its true walls. Containment against the
// bounding box alone would accept a point genuinely outside a rotated room
// and near a fake AABB corner. Ray-cast inside-test, with a `tol`-wide band
// around every real edge so a point walked exactly ON the polygon (the
// normal case here) still counts even where floating-point/ray-cast edge
// ambiguity would otherwise flip it.
function pointNearOutline(x, z, outline, tol) {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const xi = outline[i].x, zi = outline[i].z, xj = outline[j].x, zj = outline[j].z;
    if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) inside = !inside;
  }
  if (inside) return true;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    if (distPointToSegment(x, z, outline[j].x, outline[j].z, outline[i].x, outline[i].z) <= tol) return true;
  }
  return false;
}

function pointInBoxShape(x, z, b, tol = 0.05) {
  return b.outline?.length >= 3 ? pointNearOutline(x, z, b.outline, tol) : pointInsideBox(x, z, b, tol);
}

// True area-weighted centroid of a polygon (shoelace formula) — used to find
// where a real building can actually grow INTO an irregular/tapering site,
// as opposed to the site's own oriented bounding rectangle's centre (which,
// on a wedge-shaped site, can sit right at the narrow/pinched end).
function polygonCentroid(poly) {
  let area = 0, cx = 0, cz = 0;
  for (let i = 0; i < poly.length; i++) {
    const p0 = poly[i], p1 = poly[(i + 1) % poly.length];
    const cross = p0.x * p1.z - p1.x * p0.z;
    area += cross;
    cx += (p0.x + p1.x) * cross;
    cz += (p0.z + p1.z) * cross;
  }
  area *= 0.5;
  if (Math.abs(area) < 1e-9) {
    let sx = 0, sz = 0;
    for (const p of poly) { sx += p.x; sz += p.z; }
    return { x: sx / poly.length, z: sz / poly.length };
  }
  return { x: cx / (6 * area), z: cz / (6 * area) };
}

// Real columns were positioned against the ORIGINAL real building's own
// walls — our synthesized zoning boxes don't always split at those same
// lines, so a handful of real columns can land deep in a box's interior
// rather than on any of today's box edges. Keeping the whole column field
// restricted to "inside/on a real box" (user-directed) reads as one
// consistent rule — trace the real massing boxes' own footprint — rather
// than two different placement logics visually colliding.
// Renamed from filterToBoxEdges: now a containment test (inside-or-on-edge),
// not an edge-distance test — needed once interiorGridPoints started
// contributing points that are deliberately NOT on any edge.
const EDGE_TOLERANCE_M = 0.05;

export function filterToBoxEdges(points, realBoxes, centre, tol = EDGE_TOLERANCE_M) {
  if (!realBoxes?.length) return points;
  const localBoxes = realBoxes.map(b => ({
    x0: b.x0 - centre.x, x1: b.x1 - centre.x, z0: b.z0 - centre.z, z1: b.z1 - centre.z,
    ...(b.outline?.length >= 3 ? { outline: b.outline.map(p => ({ x: p.x - centre.x, z: p.z - centre.z })) } : {}),
  }));
  return points.filter(p => localBoxes.some(b => pointInBoxShape(p.x, p.z, b, tol)));
}

// User-directed: column heights read as patchy/random in the 3D view —
// most positions stopped dead at the ground floor while a few, by pure
// coincidence, happened to land inside an upper floor's independently-
// reshaped (often ~25-30% smaller/shifted) footprint and shot straight to
// full height, right next to a neighbour that stopped short. Real floor
// plates commonly cantilever/set back a little past their own perimeter
// beam line without dropping the column beneath them — so "does this floor
// still support this column" is checked with a few metres of give, not a
// hairline 5cm edge match. This doesn't invent height (a column still
// stops the moment a floor is genuinely no longer anywhere near it) — it
// just stops an honest step-back from reading as an arbitrary coin-flip.
const UPPER_FLOOR_SUPPORT_TOLERANCE_M = 2.5;

// User-directed: TARGET_SITE_COVERAGE can make the real ground floor extend
// well beyond the area the fixed real column set (realColumnPositionsForClass)
// actually spans — that set is a MEASURED, FIXED count (e.g. 584 for XL), it
// doesn't grow with the massing. Rather than leave the extended area with no
// columns at all (structurally hollow) or invent an arbitrary new structural
// design, this walks the perimeter of every real ground-floor box (units/
// green/services) at the REAL measured grid's own detected pitch (see
// detectColumnPitch) — placing columns exactly on the real box edges/corners,
// the same way real structural columns actually sit on a floor plate's own
// boundary, never in the padding of a loose bounding rectangle. Generated
// columns are tagged `real:false` so callers/renderers can distinguish
// "measured" from "pattern-continued".
// User-directed: real measured columns are no longer shown at all (see
// filterColumnsToFootprint below) — only this pattern-continued grid is.
// Dedupes ONLY against already-accepted extended points (NOT against real
// column positions, since real ones are being dropped from the output
// entirely) — walking the FULL perimeter of every box regardless of where
// real columns used to be, so there are no gaps left where a since-removed
// real column used to sit.
// User-directed: adjacent corner/midpoint/grid points were landing close
// enough to read as one clumped marker rather than two distinct columns —
// enforce a hard floor here regardless of the real measured pitch.
const MIN_COLUMN_SPACING_M = 3.5;

// Cross-box dedupe tolerance — deliberately much SMALLER than
// MIN_COLUMN_SPACING_M. This only needs to catch two boxes' truly shared
// boundary (their edges coincide almost exactly, or real-data jitter puts
// them a few cm apart) so it isn't drawn twice. Using the full 3.5-6m
// MIN_COLUMN_SPACING_M here instead was too aggressive: any box small
// enough, or packed close enough to its neighbours, that ALL of its own
// candidate points happened to fall within that radius of an
// already-accepted point from a DIFFERENT box lost its entire perimeter —
// whole edges rendered with zero columns, even though they're genuinely
// distinct real walls. MIN_COLUMN_SPACING_M still governs how far apart
// points are walked ALONG one box's own edge (see boxPerimeterPoints call
// below) and the interior grid pitch — just not this cross-box merge.
const SHARED_EDGE_DEDUPE_M = 0.5;

// Two boxes share a real edge if they touch on one axis and overlap on the
// other — same test as mergeFootprints.js's sharesEdge, duplicated here
// (rather than imported) because this one deliberately ignores box type:
// column placement cares about the building's true silhouette, not about
// keeping distinct dwellings from merging into one room.
const CLUSTER_EPS = 0.26;
function boxesShareEdge(a, b) {
  const xTouch = Math.abs(a.x1 - b.x0) <= CLUSTER_EPS || Math.abs(b.x1 - a.x0) <= CLUSTER_EPS;
  const zTouch = Math.abs(a.z1 - b.z0) <= CLUSTER_EPS || Math.abs(b.z1 - a.z0) <= CLUSTER_EPS;
  const xOverlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const zOverlap = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
  if (xTouch && zOverlap > CLUSTER_EPS) return true;
  if (zTouch && xOverlap > CLUSTER_EPS) return true;
  return xOverlap > CLUSTER_EPS && zOverlap > CLUSTER_EPS;
}

// Groups boxes into their connected components (union-find) so traceOutline
// — which only ever walks ONE closed ring — is called once per real,
// physically separate cluster (e.g. distinct wings either side of a
// courtyard) instead of silently tracing just whichever cluster its start
// vertex happened to land in and dropping the rest.
function connectedBoxClusters(boxes) {
  const parent = boxes.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (i, j) => { const a = find(i), b = find(j); if (a !== b) parent[a] = b; };
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (boxesShareEdge(boxes[i], boxes[j])) union(i, j);
    }
  }
  const groups = new Map();
  boxes.forEach((b, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(b);
  });
  return [...groups.values()];
}

function extendColumnsAlongBoxEdges(realBoxes, centre, pitch) {
  const minSpacing = Math.max(MIN_COLUMN_SPACING_M, Math.max(1, pitch.pitchX) * 0.5);
  const accepted = [];
  const extra = [];
  const addCandidates = (candidates) => {
    for (const c of candidates) {
      if (extra.length >= MAX_EXTENDED_COLUMNS) return;
      // Dedupe against already-accepted points — only catches a genuinely
      // shared boundary (adjacent boxes' coincident edge, or an interior
      // grid point landing right on a box edge), not merely "another real
      // column happens to be somewhat nearby".
      const tooClose = accepted.some(a => Math.hypot(a.x - c.x, a.z - c.z) < SHARED_EDGE_DEDUPE_M);
      if (tooClose) continue;
      accepted.push(c);
      extra.push({ x: c.x, z: c.z, real: false });
    }
  };
  // User-directed: columns in London Context (Enhanced) mode must follow
  // the ENHANCED variation's own real geometry — a real-rooms box's
  // x0/x1/z0/z1 is only the bounding box of its (possibly rotated/drifted)
  // real `outline`, not its true walls (see realRoomVariations.js's
  // transformBoxToOutline). traceOutline's lattice only understands plain
  // x0/x1/z0/z1 rects, so running it on rotated boxes would trace their
  // AABB envelope, not the deconstructed shape actually on screen. Walking
  // each box's own real outline directly keeps columns glued to whichever
  // variation (0-9) is currently shown, rotation and all.
  if (realBoxes.some(b => b.outline?.length >= 3)) {
    for (const b of realBoxes) {
      if (extra.length >= MAX_EXTENDED_COLUMNS) break;
      const ring = b.outline?.length >= 3
        ? b.outline.map(p => ({ x: p.x - centre.x, z: p.z - centre.z }))
        : [
            { x: b.x0 - centre.x, z: b.z0 - centre.z }, { x: b.x1 - centre.x, z: b.z0 - centre.z },
            { x: b.x1 - centre.x, z: b.z1 - centre.z }, { x: b.x0 - centre.x, z: b.z1 - centre.z },
          ];
      addCandidates(outlinePerimeterPoints(ring, minSpacing));
    }
  } else {
    // True exterior silhouette of every real (axis-aligned, procedural) box
    // together — traceOutline cancels interior party walls between adjacent
    // units and returns the real union ring (null for a plain single
    // rectangle, or when the trace fails/is too complex). traceOutline only
    // walks ONE connected ring, so a footprint made of several un-touching
    // clusters (separate wings across a courtyard, say) must be split into
    // its connected components first, or every cluster but the one the walk
    // happened to start from is silently dropped. Each cluster then gets its
    // own outline (or falls back to its own boxes' plain perimeters when
    // it's a single box, or when traceOutline fails on it).
    // Per-box edges, not a traced cluster union — measured live this session
    // on a 15-box compact cluster, traceOutline's union ring produced FEWER
    // points (4) than a 4-box cluster's own outline (23), an outline that
    // apparently under-traces once a real cluster gets big/complex enough,
    // leaving the single largest, most important mass of the building the
    // most under-covered instead of the best. Walking every real box's own
    // 4 edges directly is simpler and can't silently drop real edge length
    // regardless of how many boxes are touching — the minor cost (a handful
    // of candidate points can land on a shared interior party wall between
    // two touching units rather than only the true exterior silhouette) is
    // worth it for guaranteed, predictable coverage on every real edge.
    for (const b of realBoxes) {
      if (extra.length >= MAX_EXTENDED_COLUMNS) break;
      addCandidates(boxPerimeterPoints(b.x0 - centre.x, b.x1 - centre.x, b.z0 - centre.z, b.z1 - centre.z, minSpacing));
    }
  }
  // User-directed: pattern-continued column count halved. Thinning every
  // other point keeps the reduction exact while preserving even coverage
  // around the boundary, since points are walked in ring order.
  return extra.filter((_, i) => i % 2 === 0);
}

// User-directed: the real measured column set (red, `real:true`) is no
// longer included in the returned/rendered column set at all — only the
// pattern-continued grid (peach, `real:false`), walked along every real
// massing box's own edges at the real measured pitch (see
// detectColumnPitch). The real positions are still READ (never deleted
// from the source data) — they're the input `detectColumnPitch` measures
// the real pitch from — just not themselves part of the output anymore.
// Each column is one continuous cylinder spanning the FULL building height
// (see buildColumnMarkers) — real structure, not a per-floor prop — but
// every floor above the ground is independently re-solved (varyFloorHeights/
// floorsFromBubbleLayout genuinely shift a floor's own box edges ~25-30%
// floor to floor). Without this check, a column derived purely from the
// ground floor's edges could pass straight through the middle of an upper
// floor's room with no wall to actually bear on there — geometrically
// present but structurally meaningless above ground level. `upperFloors`
// (optional — every existing caller still works without it) restricts the
// returned set to positions that also sit on a real box edge on EVERY
// floor, not just the ground floor, so a rendered column has something to
// carry at every level it passes through.
export function filterColumnsToFootprint(buildingType, groundBoxes, centre, allFloors) {
  const positions = realColumnPositionsForClass(buildingType || 'medium');
  if (!positions?.length) return [];

  // User-directed: columns were showing up scattered outside the building's
  // real silhouette — traced back to balcony boxes (thin decks that
  // deliberately overhang past the core structure's own outline) still
  // being counted as columnable real boxes alongside circulation. Only
  // units/services/community are actual enclosed structure; balconies and
  // circulation aren't real column-bearing floor plate.
  const realBoxes = (groundBoxes || []).filter(b => b.type === 'units' || b.type === 'services' || b.type === 'community');
  if (!realBoxes.length) return [];

  const pitch = detectColumnPitch(positions);
  const extended = extendColumnsAlongBoxEdges(realBoxes, centre, pitch);
  const groundFiltered = filterToBoxEdges(extended, realBoxes, centre);

  const upperFloors = (allFloors ?? []).slice(1);
  if (!upperFloors.length) return groundFiltered;
  return groundFiltered.filter(p => upperFloors.every(fl => {
    const boxes = (fl.boxes ?? []).filter(b => b.type === 'units' || b.type === 'services' || b.type === 'community');
    return boxes.length > 0 && filterToBoxEdges([p], boxes, centre, UPPER_FLOOR_SUPPORT_TOLERANCE_M).length > 0;
  }));
}

// Same real ground-edge candidates as filterColumnsToFootprint, but instead
// of an all-or-nothing "valid on EVERY floor or dropped entirely" filter
// (which — measured live — kept only 34 of 119 real edge candidates on a
// typical variation, because each floor's plate is independently reshaped
// and few positions coincidentally line up across all of them), each
// candidate keeps the CONTIGUOUS run of floors it's actually valid on,
// starting from the ground. A column stops rising the moment it no longer
// sits on a real edge — it can't skip a floor and reappear above a gap with
// nothing under it — but every position that's real at the ground still
// shows up, honestly capped at whatever height it's actually supported to.
// This is what "Show columns" renders now: many more columns, most of them
// real for at least a few storeys, rather than a sparse few valid for all.
export function columnRunsToFootprint(buildingType, groundBoxes, centre, allFloors) {
  const positions = realColumnPositionsForClass(buildingType || 'medium');
  if (!positions?.length) return [];

  // User-directed: columns were showing up scattered outside the building's
  // real silhouette — traced back to balcony boxes (thin decks that
  // deliberately overhang past the core structure's own outline) still
  // being counted as columnable real boxes alongside circulation. Only
  // units/services/community are actual enclosed structure; balconies and
  // circulation aren't real column-bearing floor plate.
  const realBoxes = (groundBoxes || []).filter(b => b.type === 'units' || b.type === 'services' || b.type === 'community');
  if (!realBoxes.length) return [];

  const pitch = detectColumnPitch(positions);
  const extended = extendColumnsAlongBoxEdges(realBoxes, centre, pitch);
  const groundFiltered = filterToBoxEdges(extended, realBoxes, centre);

  const floors = allFloors ?? [];
  return groundFiltered.map(p => {
    let topFloorIdx = 0;
    for (let i = 1; i < floors.length; i++) {
      const boxes = (floors[i].boxes ?? []).filter(b => b.type === 'units' || b.type === 'services' || b.type === 'community');
      if (!boxes.length || filterToBoxEdges([p], boxes, centre, UPPER_FLOOR_SUPPORT_TOLERANCE_M).length === 0) break;
      topFloorIdx = i;
    }
    return { ...p, topFloorIdx };
  });
}

// precomputedPositions: the tiled column list generateMassingIterations
// already built for this variation (variation.columns) — pass it through
// unchanged rather than recomputing via filterColumnsToFootprint, which
// assumes ONE contiguous footprint and would mis-map real column positions
// onto a multi-instance tiled ground-boxes bbox. Falls back to the old
// single-instance computation only when absent (e.g. no massing generated).
// RENDERING-ONLY dedupe: the real GLB data genuinely includes tightly
// coupled column pairs ~0.6-0.9m apart (a real structural detail, see
// detectColumnPitch's own comment) — real, correct, and kept as-is in the
// data every other consumer sees (stats panel, Rhino export). At 3D-view
// scale, several of these near-coincident cylinders overlapping in screen
// space render as one dense, artifact-looking dark blob rather than
// individually legible columns. Merges points within 1m into a single
// averaged marker for the VISUAL mesh only — this function's return value,
// not the `positions` array itself, so nothing downstream loses data.
function dedupeForRendering(positions, thresholdM = 1.0) {
  const used = new Array(positions.length).fill(false);
  const merged = [];
  for (let i = 0; i < positions.length; i++) {
    if (used[i]) continue;
    const group = [positions[i]];
    used[i] = true;
    for (let j = i + 1; j < positions.length; j++) {
      if (used[j]) continue;
      if (positions[j].real !== positions[i].real) continue; // never merge real with pattern-continued
      if (Math.hypot(positions[i].x - positions[j].x, positions[i].z - positions[j].z) < thresholdM) {
        group.push(positions[j]); used[j] = true;
      }
    }
    merged.push({
      x: group.reduce((s, p) => s + p.x, 0) / group.length,
      z: group.reduce((s, p) => s + p.z, 0) / group.length,
      real: group[0].real,
    });
  }
  return merged;
}

export function buildColumnMarkers(buildingType, totalHeightM, groundBoxes, centre, precomputedPositions, allFloors) {
  const dims = realColumnDimsForClass(buildingType || 'medium');
  const RADIUS = dims?.radius ?? 0.22;
  const BASE_Y = 0;
  const group = new THREE.Group();
  const realMat = new THREE.MeshBasicMaterial({ color: '#ff5a3c' });
  // Columns generated by extendColumnGrid (real:false) — same real measured
  // pitch, continued into area TARGET_SITE_COVERAGE added beyond the fixed
  // real column set's own reach — get a visibly different colour so
  // "measured" and "pattern-continued" are never presented as the same
  // certainty, same convention as this codebase's other labelled assumptions.
  const extendedMat = new THREE.MeshBasicMaterial({ color: '#ffb08a' });

  // No precomputed set and floors are known: use columnRunsToFootprint —
  // every column is drawn at its OWN real supported height (see that
  // function's comment for why "valid on every floor or dropped" was too
  // strict and left most of the building's real edges bare). Falls back to
  // the old uniform-height path when a variation already precomputed a flat
  // position list, or when no floors were passed at all.
  if (!precomputedPositions && allFloors?.length) {
    const runs = dedupeForRendering(columnRunsToFootprint(buildingType, groundBoxes, centre, allFloors));
    if (!runs.length) return null;
    const geoCache = new Map();
    for (const p of runs) {
      const topY = allFloors[p.topFloorIdx]?.y1 ?? totalHeightM;
      const height = Math.max(0.5, Math.min(topY + 1.0, totalHeightM));
      let geo = geoCache.get(height);
      if (!geo) { geo = new THREE.CylinderGeometry(RADIUS, RADIUS, height, 10); geoCache.set(height, geo); }
      const mesh = new THREE.Mesh(geo, p.real === false ? extendedMat : realMat);
      mesh.position.set(p.x, BASE_Y + height / 2, p.z);
      group.add(mesh);
    }
    return group.children.length ? group : null;
  }

  // allFloors matters here even though this stage only ever DISPLAYS the
  // ground floor (see the x-ray plate above) — filterColumnsToFootprint's
  // own upper-floor check is what keeps a rendered column real (something to
  // carry at every level it passes through), not just resting on the one
  // plate shown. Omitting it silently readmitted ground-only columns.
  const rawPositions = precomputedPositions ?? filterColumnsToFootprint(buildingType, groundBoxes, centre, allFloors);
  if (!rawPositions.length) return null;
  const positions = dedupeForRendering(rawPositions);

  // Real column radius from the GLB "columns" block; height is CAPPED to the
  // shown ground-floor plate (plus a small poke-through) so the columns read
  // as the structure holding up THIS plate — not as full-building-height rods
  // that tower way above the single ground floor the Columns stage displays.
  const HEIGHT = totalHeightM; // totalHeightM is passed in already capped below
  const centreY = BASE_Y + HEIGHT / 2;

  const geo = new THREE.CylinderGeometry(RADIUS, RADIUS, HEIGHT, 10);
  for (const p of positions) {
    const mesh = new THREE.Mesh(geo, p.real === false ? extendedMat : realMat);
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

// Green(greenpatch)/units ratio from this variation's own laid-out geometry
// — a genuine site-analysis-style input to the score, same criteria family
// as the zoning scoring.
function computeGreenUnitsScore(floors) {
  let unitsArea = 0, greenArea = 0;
  for (const floor of floors) {
    for (const b of floor.boxes) {
      const area = (b.x1 - b.x0) * (b.z1 - b.z0);
      if (b.type === 'units') unitsArea += area;
      if (b.type === 'greenpatch') greenArea += area;
    }
  }
  const ratio = greenArea / (unitsArea || 1);
  return clamp(100 - Math.abs(ratio - 0.10) * 500, 0, 100);
}

// ── Real topology operations ──────────────────────────────────────────────
// perturbFloors (below) only moves/resizes the EXISTING blocks — every
// iteration ends up the same silhouette with light noise on top. These
// operations change the actual block STRUCTURE per floor before perturbation
// runs, so iterations differ in real massing terms (a split introduces a
// court that wasn't there; a floor-count change makes the building genuinely
// shorter/taller), not just position/size jitter on a fixed shape. Every op
// only touches 'units' blocks — services/community stay real and untouched,
// same anchoring principle perturbFloors already uses.

// Split each unit block on a floor into two narrower blocks with a real gap
// between them (a light-well/court cut through the massing). Only applied
// where a block is wide enough that the split still reads as a real block,
// not a sliver.
function splitUnitBlocks(floors, axis, gapFrac) {
  return floors.map(fl => ({
    ...fl,
    boxes: fl.boxes.flatMap(b => {
      if (b.type !== 'units') return [b];
      const w = b.x1 - b.x0, d = b.z1 - b.z0;
      const along = axis === 'x' ? w : d;
      if (along < 6) return [b]; // too narrow to split and still read as real
      const gap = along * gapFrac;
      if (axis === 'x') {
        const half = (w - gap) / 2;
        return [
          { ...b, x0: b.x0, x1: b.x0 + half },
          { ...b, x0: b.x1 - half, x1: b.x1 },
        ];
      }
      const half = (d - gap) / 2;
      return [
        { ...b, z0: b.z0, z1: b.z0 + half },
        { ...b, z0: b.z1 - half, z1: b.z1 },
      ];
    }),
  }));
}

// Merge the two closest unit blocks on each floor into one larger volume
// (bounding rect of the pair) — the opposite move from splitUnitBlocks: a
// denser, more consolidated massing instead of a fragmented one.
function mergeClosestUnitBlocks(floors) {
  return floors.map(fl => {
    const units = fl.boxes.filter(b => b.type === 'units');
    const rest = fl.boxes.filter(b => b.type !== 'units');
    if (units.length < 2) return fl;
    // Try pairs closest-first — the bounding rect of two boxes that aren't
    // cleanly axis-adjacent can swallow a THIRD box sitting in the gap
    // between them, silently overlapping it (a real, measured cause of the
    // massing's overlap penalty). Skip any pair whose merged bbox would
    // overlap a box it isn't actually merging, and try the next-closest
    // pair instead of forcing a bad merge.
    const pairs = [];
    for (let i = 0; i < units.length; i++) {
      for (let j = i + 1; j < units.length; j++) {
        const cx1 = (units[i].x0 + units[i].x1) / 2, cz1 = (units[i].z0 + units[i].z1) / 2;
        const cx2 = (units[j].x0 + units[j].x1) / 2, cz2 = (units[j].z0 + units[j].z1) / 2;
        pairs.push({ i, j, dist: Math.hypot(cx1 - cx2, cz1 - cz2) });
      }
    }
    pairs.sort((p, q) => p.dist - q.dist);
    for (const { i, j } of pairs) {
      const a = units[i], b = units[j];
      const merged = {
        type: 'units',
        x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1),
        y0: a.y0, y1: a.y1,
        z0: Math.min(a.z0, b.z0), z1: Math.max(a.z1, b.z1),
      };
      const keep = units.filter((_, k) => k !== i && k !== j);
      // Also check against non-units boxes (stair/lift cores in particular)
      // — a merged bbox spanning two dwellings can just as easily swallow a
      // core sitting between them as it can a third dwelling.
      if (keep.some(bb => boxesOverlapXZ(merged, bb)) || rest.some(bb => boxesOverlapXZ(merged, bb))) continue;
      return { ...fl, boxes: [...rest, merged, ...keep] };
    }
    return fl; // no pair merges cleanly — leave this floor's units untouched
  });
}

// A deliberate, labelled DESIGN move (not measured data) — same footing as
// PENTHOUSE_SHARE_BY_BRIEF/WING_SIZE_DECAY in dwellings.js/zoningGraph.js:
// admittedly imposed, not read from the GLB. Real floors here already carry
// their own real extracted height (see synthesizeFloorsForClass/
// realFloorsForClass's comments — "real detected floor-slab levels"), but
// that real variance is only ~5-10%, imperceptible in the rendered massing —
// every floor reads as the same extruded slab with different internal box
// splits, which is what read as "not varying at all". This scales each
// floor's REAL height by a seeded per-floor multiplier — most floors stay
// close to their real height, a seeded subset become taller "feature"
// floors (the amenity/light-filled storey real buildings often have) or
// shorter "compact" ones — so the silhouette itself has visible rhythm.
// Never touches footprint/area, only vertical extent, and every iteration's
// own seed gets its own rhythm so the massing gallery reads as genuinely
// different buildings, not the same block re-split internally.
function varyFloorHeights(floors, seed) {
  if (!Array.isArray(floors) || floors.length < 2) return floors;
  const rand = mulberry32(90017 + (seed | 0) * 733);
  const realH = floors.map(f => f.y1 - f.y0);
  let y = floors[0].y0;
  return floors.map((f, fi) => {
    const r = rand();
    const mult = r < 0.18 ? 1.35 + rand() * 0.25   // feature floor: taller
      : r < 0.30 ? 0.78 + rand() * 0.10             // compact floor: shorter
      : 0.95 + rand() * 0.12;                       // normal, mild jitter
    const h = realH[fi] * mult;
    const y0 = y, y1 = y + h;
    y = y1;
    return { ...f, y0, y1 };
  });
}

// Drop or add a floor at the top of the stack — a genuinely shorter/taller
// building, not just a taper. Dropping copies down from the floor below
// (still real programme geometry, just one fewer storey); adding duplicates
// the top floor's real layout at a new storey. Height clamped by the same
// feasible-floor-range logic Zoning already surfaces, so this never proposes
// something wildly outside what the site could plausibly support.
function adjustFloorCount(floors, delta, floorToFloorM) {
  if (delta === 0 || floors.length < 2) return floors;
  if (delta < 0) {
    const keep = Math.max(2, floors.length + delta);
    return floors.slice(0, keep);
  }
  const out = floors.map(f => ({ ...f, boxes: f.boxes.map(b => ({ ...b })) }));
  const top = out[out.length - 1];
  for (let i = 0; i < delta; i++) {
    if (out.length >= MAX_BUILDING_FLOORS) break; // never propose past the storey cap
    const y0 = top.y1 + (i === 0 ? 0 : 0);
    const nf = {
      floorIdx: out.length,
      y0: out[out.length - 1].y1,
      y1: out[out.length - 1].y1 + floorToFloorM,
      boxes: out[out.length - 1].boxes
        .filter(b => b.type !== 'community' && b.type !== 'greenpatch') // community/podium and green patches are purpose-placed, don't repeat them
        .map(b => ({ ...b })),
    };
    out.push(nf);
  }
  return out;
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

// Per-seed topology op — paired with the strategy so each of the 10
// iterations combines a real structural change with the positional
// treatment, instead of just the latter. 'none' means the shape stays
// topologically the same as the baseline (perturbation only) — kept in the
// rotation so not every iteration is a hard structural departure.
const TOPOLOGY_OPS = ['none', 'split-x', 'split-z', 'merge', 'floors-down', 'floors-up'];

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
      // ground datum; green patches are purpose-placed courtyards/terraces,
      // not random blocks, so they stay put too. Unit blocks get the full
      // bold rearrangement.
      const anchored = b.type === 'services' || b.type === 'community' || b.type === 'greenpatch';
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

const boxesOverlapXZ = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;

// perturbFloors above jitters every unit block's position/size INDEPENDENTLY
// — real variety, but with nothing to stop two boxes' independent random
// shifts landing on top of each other. That is the actual, measured cause of
// this massing's overlap penalty (up to 54% on real iterations, not a rare
// edge case): every box moves for its own reasons, none of them aware of
// its neighbours. A short pairwise separation pass, same idea as
// bubbleLayout.js's relaxGraph repulsion but for axis-aligned boxes instead
// of circles: push each overlapping pair apart along whichever axis needs
// the least push to clear it, a few passes so a 3+ box pile-up settles too.
const DEOVERLAP_PASSES = 6;
function resolveUnitOverlaps(floors) {
  return floors.map((floor) => {
    const boxes = floor.boxes.map(b => ({ ...b }));
    const units = boxes.filter(b => b.type === 'units');
    // Stair/lift cores must stay vertically aligned floor-to-floor — a real
    // structural requirement, not a layout preference — so they never move
    // here. They still count as solid obstacles a dwelling can't sit inside:
    // treated as FIXED anchors below, so an overlapping unit gets pushed
    // fully off the core instead of the two splitting the push (which,
    // applied to a fixed core, would leave the core itself shifted and no
    // longer aligned with the same core on the floor above/below).
    const cores = boxes.filter(b => b.type === 'core_stair' || b.type === 'core_lift');
    for (let pass = 0; pass < DEOVERLAP_PASSES; pass++) {
      let moved = false;
      for (let i = 0; i < units.length; i++) {
        for (let j = i + 1; j < units.length; j++) {
          const a = units[i], b = units[j];
          if (!boxesOverlapXZ(a, b)) continue;
          const overlapX = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
          const overlapZ = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
          moved = true;
          // Push apart along whichever axis has the smaller penetration —
          // the cheaper separation, same principle as relaxGraph's repulsion.
          if (overlapX <= overlapZ) {
            const push = overlapX / 2 + 0.02;
            const dir = (a.x0 + a.x1) <= (b.x0 + b.x1) ? -1 : 1;
            a.x0 += dir * push; a.x1 += dir * push;
            b.x0 -= dir * push; b.x1 -= dir * push;
          } else {
            const push = overlapZ / 2 + 0.02;
            const dir = (a.z0 + a.z1) <= (b.z0 + b.z1) ? -1 : 1;
            a.z0 += dir * push; a.z1 += dir * push;
            b.z0 -= dir * push; b.z1 -= dir * push;
          }
        }
        for (const core of cores) {
          const a = units[i];
          if (!boxesOverlapXZ(a, core)) continue;
          const overlapX = Math.min(a.x1, core.x1) - Math.max(a.x0, core.x0);
          const overlapZ = Math.min(a.z1, core.z1) - Math.max(a.z0, core.z0);
          moved = true;
          // Core is fixed, so 'a' has to cover the WHOLE overlap itself
          // (not half of it, like the units-vs-units push above).
          if (overlapX <= overlapZ) {
            const push = overlapX + 0.04;
            const dir = (a.x0 + a.x1) <= (core.x0 + core.x1) ? -1 : 1;
            a.x0 += dir * push; a.x1 += dir * push;
          } else {
            const push = overlapZ + 0.04;
            const dir = (a.z0 + a.z1) <= (core.z0 + core.z1) ? -1 : 1;
            a.z0 += dir * push; a.z1 += dir * push;
          }
        }
      }
      if (!moved) break;
    }
    return { ...floor, boxes: [...boxes.filter(b => b.type !== 'units'), ...units] };
  });
}

// No home reads as floating. perturbFloors above deliberately shifts upper
// floors further sideways the higher they sit (the stepback/splay/cascade/
// sculpt/shift strategies) for real massing variety — but pushed far enough,
// a box can end up with NOTHING below it at all: no support, no legible
// cantilever, just a block hanging in mid-air. Verified live: a 3-bed box
// and several fragments came back completely clear of every box on the
// floor beneath them. This runs a floor-by-floor pass (ground up) and pulls
// any box with zero real XZ overlap with the floor below it straight down
// onto the closest box there instead — same size, same shape, just moved to
// actually bear on something. Checked against EVERY box type on the floor
// below (not just other units) — a unit legitimately oversailing a real
// green terrace or entry canopy below it is not floating, it has something
// real under it.
function enforceVerticalSupport(floors) {
  if (!Array.isArray(floors) || floors.length < 2) return floors;
  const out = floors.map(f => ({ ...f, boxes: f.boxes.map(b => ({ ...b })) }));
  for (let fi = 1; fi < out.length; fi++) {
    const below = out[fi - 1].boxes.filter(b => b.type !== 'circulation');
    if (!below.length) continue;
    out[fi].boxes = out[fi].boxes.map((b) => {
      if (b.type !== 'units' || below.some(bb => boxesOverlapXZ(b, bb))) return b;
      const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
      let nearest = below[0], bestD = Infinity;
      for (const bb of below) {
        const bcx = (bb.x0 + bb.x1) / 2, bcz = (bb.z0 + bb.z1) / 2;
        const d = Math.hypot(bcx - cx, bcz - cz);
        if (d < bestD) { bestD = d; nearest = bb; }
      }
      const w = b.x1 - b.x0, d = b.z1 - b.z0;
      const ncx = (nearest.x0 + nearest.x1) / 2, ncz = (nearest.z0 + nearest.z1) / 2;
      return { ...b, x0: ncx - w / 2, x1: ncx + w / 2, z0: ncz - d / 2, z1: ncz + d / 2 };
    });
  }
  return out;
}

// Point-in-shape test: a plain rectangle for an ordinary box, or a real
// point-in-polygon (ray casting) test against `outline` for a merged L/T/U
// footprint (see mergeFootprints.js's traceOutline).
function pointInShape(x, z, b) {
  if (!b.outline) return x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1;
  const pts = b.outline;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, zi = pts[i].z, xj = pts[j].x, zj = pts[j].z;
    const intersect = ((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Real overlap area between two boxes, honest about `outline`. mergeFootprints
// deliberately keeps a LEGACY bounding rectangle for a merged L/T/U shape
// wider than the shape's real notched footprint (documented there — every
// consumer that doesn't understand `outline` still needs a valid box), and a
// plain rect-vs-rect AABB test treats that inflated legacy box as if it were
// solid. Verified live: 85% of this massing's "overlapping" pairs were a real
// dwelling's box against a merged group's bounding box, not its real shape —
// one measured case had a real merged area of 65m² registering a 221m²
// bounding box, "swallowing" an entire neighbouring apartment that was never
// actually touched. Two plain rectangles (the common case) still use the
// cheap exact AABB formula; only a pair where EITHER side carries a real
// outline falls through to sampling the AABB-overlap region against both
// real shapes, so a merged group's notch is honestly excluded.
function realOverlapArea(a, b, ox0, ox1, oz0, oz1) {
  if (!a.outline && !b.outline) return (ox1 - ox0) * (oz1 - oz0);
  const STEP = 1; // metres — real architectural resolution, not a grid epsilon
  let hits = 0, total = 0;
  for (let x = ox0 + STEP / 2; x < ox1; x += STEP) {
    for (let z = oz0 + STEP / 2; z < oz1; z += STEP) {
      total++;
      if (pointInShape(x, z, a) && pointInShape(x, z, b)) hits++;
    }
  }
  return total ? (hits / total) * (ox1 - ox0) * (oz1 - oz0) : 0;
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
    // pairwise overlap between unit blocks — real shape-aware, see
    // realOverlapArea above.
    if (b.type === 'units') {
      for (let j = i + 1; j < ground.length; j++) {
        const c = ground[j];
        if (c.type !== 'units') continue;
        const ox0 = Math.max(b.x0, c.x0), ox1 = Math.min(b.x1, c.x1);
        const oz0 = Math.max(b.z0, c.z0), oz1 = Math.min(b.z1, c.z1);
        if (ox1 > ox0 && oz1 > oz0) overlap += realOverlapArea(b, c, ox0, ox1, oz0, oz1);
      }
    }
  }
  const fillScore    = clamp((unitsArea / envArea) * 140, 0, 100);
  const coreScore    = coreCount ? clamp(100 - (coreOffset / coreCount) / Math.max(fw, fd) * 260, 0, 100) : 70;
  const overlapScore = clamp(100 - (overlap / envArea) * 400, 0, 100);
  const score = clamp(0.34 * fillScore + 0.22 * coreScore + 0.24 * overlapScore + 0.20 * greenScore, 0, 100);
  return { score, fillScore, coreScore, overlapScore };
}

// Simple string hash -> uint32 seed, so the bubble relaxation is
// deterministic per site (same site+class always relaxes to the same
// layout) without depending on Math.random()/Date.now().
function seedFromSite(site) {
  const str = site?.id ?? site?.name ?? JSON.stringify(site?.coords ?? []);
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return (h >>> 0) || 1;
}

// Real OSM road points (useOsmContext's {xM,zM}, metres east/north of
// geoRef's own bounding-box origin) -> the SAME local-fit metres frame
// localSitePoly lives in (site centroid -> world XZ -> un-scale/un-rotate,
// same transform siteToLocalPolygon uses). geoRef's origin and the site's
// own cLat/cLng centroid are different points, so the offset between them
// (in the shared cLat/cLng-relative world XZ frame) has to be added first.
function roadPointsToLocalFrame(roads, geoRef, cLat, cLng, fit) {
  if (!roads?.length || !geoRef) return [];
  const originOffset = latLngToXZ(geoRef.minLat, geoRef.minLng, cLat, cLng);
  const cos = Math.cos(fit.angle), sin = Math.sin(fit.angle);
  const pts = [];
  for (const road of roads) {
    for (const p of road.points) {
      const worldX = originOffset.x + p.xM;
      const worldZ = originOffset.z + p.zM;
      const dx = (worldX - fit.cx) / fit.scale;
      const dz = (worldZ - fit.cz) / fit.scale;
      pts.push({ x: dx * cos - dz * sin, z: dx * sin + dz * cos });
    }
  }
  return pts;
}

// Find the real road point nearest the site polygon, and the polygon edge
// midpoint closest to it — that midpoint is the actual road-facing frontage,
// used as a directional bias target for the 'entry' bubble-graph node
// (see relaxGraph's biasForces) instead of guessing the longest edge.
function entryBiasFromRoads(localPoly, roadPoints) {
  if (!roadPoints.length) return null;
  let best = null, bestDist = Infinity, bestEdge = null;
  let cx = 0, cz = 0;
  for (const p of localPoly) { cx += p.x; cz += p.z; }
  cx /= localPoly.length; cz /= localPoly.length;
  for (let i = 0; i < localPoly.length; i++) {
    const a = localPoly[i], b = localPoly[(i + 1) % localPoly.length];
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    for (const rp of roadPoints) {
      const d = Math.hypot(rp.x - mx, rp.z - mz);
      if (d < bestDist) { bestDist = d; best = { x: mx, z: mz }; bestEdge = { a, b }; }
    }
  }
  if (!best) return null;
  // Pull the target inboard off the boundary line — see siteFacts.TARGET_INSET
  // for why aiming exactly at an edge pushes bubbles out of the site.
  const inset = 0.35;
  return {
    type: 'entry',
    targetX: best.x + (cx - best.x) * inset,
    targetZ: best.z + (cz - best.z) * inset,
    strength: 1.2,
    // The actual polygon edge this frontage was matched to — kept (not just
    // the biased target point) so the bubble diagram can highlight the real
    // road-adjacent boundary segment, not just show an abstract entry dot.
    edgeA: bestEdge.a,
    edgeB: bestEdge.b,
  };
}

// EVERY floor replaced with a real bubble-diagram layout: zone types relax
// under adjacency (spring), non-overlap (repulsion) and real-site-polygon
// containment forces (see bubbleLayout.js) instead of a fixed template fit
// into the site's bounding rectangle. Ground floor gets the full node set
// (entry/circulation/services/green/semiopen/units); upper floors get the
// smaller units+circulation tier (FLOOR_TIER_NODES.upper), same asymmetry
// the real GLB programme already has. Running every floor through its own
// polygon-constrained relaxation (not just ground floor) is what stops
// upper-floor boxes (e.g. circulation) from landing outside/disconnected
// from where the ground floor and site boundary actually are.
// Returns { floors, clip } — `clip` is { grid, cx, cz }, the same buildable
// grid these boxes were carved from, handed back so generateMassingIterations
// can re-clip after it moves boxes around (see clipFloorsToSite). Null clip
// means "no usable site polygon", and every downstream clip becomes a no-op.

// User-directed design target (not a measured value, same convention as
// MAX_FIT_SCALE in siteFit.js): the total real ground-floor footprint
// (units+green+services) is scaled to claim roughly this fraction of the
// site's real buildable area — see floorsFromBubbleLayout's coverageScale.
// 0.72 is the midpoint of the requested 70-75% band.
const TARGET_SITE_COVERAGE = 0.72;

// How many real spatial WINGS the housing mass splits into — a real building
// on a small plot reads as one mass; a bigger plot supports genuinely
// separate blocks with real gaps between them. Derived from the site's own
// real buildable area (largestConnectedRegion's cell count × cellSize²),
// not the building class — two different-shaped sites of the same class can
// still get a different wing count if their usable land differs. 3000m² per
// wing is a design choice (roughly what one of the smaller curated sites'
// entire buildable area already is), not a measured constant.
//
// MIN_WINGS is 1, not 2: forcing every site into at least 2 separate
// regions was measured live to cost far more real capacity than genuine
// wing separation should (site 556: 22→9 dwellings, a 59% drop — real
// buildings lose maybe 10-15% to inter-wing corridors/cores, not 59%).
// Splitting a small site's already-small housing mass into 2 hard-separated
// sub-grids compounds the per-region minimum-box-size cutoff
// (siteGrid.cellsToBoxes' minCells) on top of an already-small budget, for
// no real architectural benefit — a small building often genuinely IS one
// mass. wingCount=1 degenerates cleanly to the old single-zone behaviour
// (wingAdjacency/wingAreaShares both handle n=1 as a base case, not a
// special one), so this only removes an unwarranted forced split, not the
// wing mechanism itself.
// Real perimeter-block schemes (Barcelona's Eixample, a London mansion
// block) read as ONE coherent mass with real internal courtyards, not
// several small buildings scattered across a plot — so wing count is now
// biased hard toward staying low; the interior-courtyard carve below (see
// carveCourtyard) is what actually gives the massing real architectural
// variety, not fragmenting into separate blobs. Raised from 3000 to 7000
// m²/wing and MAX_WINGS from 4 to 2 for exactly this reason.
const M2_PER_WING = 7000;
const MIN_WINGS = 1, MAX_WINGS = 2;
function wingCountForArea(buildableAreaM2) {
  return Math.max(MIN_WINGS, Math.min(MAX_WINGS, Math.round(buildableAreaM2 / M2_PER_WING)));
}

// Massing STYLE archetypes — a real, selectable second lever on top of the
// PROGRAMME_BRIEFS (which redistribute AREA between zones; a style instead
// changes how the housing mass is SPATIALLY ARRANGED). Both reuse the exact
// same wing/relaxation/cell-assignment machinery — a style is just a
// different wing COUNT and a different wing SEEDING pattern (see
// wingCountForStyle/wingSeedTarget below), plus one independent post-process
// for 'stepped' (see applyStepSetback). No new geometry primitive, no
// special-cased rendering path — every style still produces ordinary wing_i
// nodes that assignCellsToZones/cellsToBoxes carve exactly as before.
export const MASSING_STYLES = [
  { key: 'organic',         label: 'Organic (measured)' },
  { key: 'slab',            label: 'Slab block' },
  { key: 'point-tower',     label: 'Point towers' },
  { key: 'perimeter-block', label: 'Perimeter block' },
  { key: 'stepped',         label: 'Stepped' },
  { key: 'comb',            label: 'Comb / fingers' },
  { key: 'tower-cluster',   label: 'Tower cluster (stepped)' },
];
export const DEFAULT_MASSING_STYLE = 'organic';

// How many real wings each style wants, before any explicit user override.
// 'slab' forces exactly one continuous mass; 'point-tower'/'comb'/
// 'perimeter-block' need MORE, smaller wings than the organic default to
// actually read as towers/fingers/a ring rather than degenerate to the same
// 1-2 wing organic result — real, distinct outcomes from the same mechanism,
// not just a label.
function wingCountForStyle(styleKey, buildableAreaM2, override) {
  if (override != null) return Math.max(1, Math.min(8, Math.round(override)));
  switch (styleKey) {
    case 'slab': return 1;
    case 'point-tower': return Math.max(3, Math.min(8, Math.round(buildableAreaM2 / 2200)));
    case 'tower-cluster': return Math.max(4, Math.min(7, Math.round(buildableAreaM2 / 1900)));
    case 'comb': return Math.max(3, Math.min(6, Math.round(buildableAreaM2 / 3500)));
    case 'perimeter-block': return Math.max(3, Math.min(6, Math.round(buildableAreaM2 / 3200)));
    case 'stepped':
    case 'organic':
    default:
      return wingCountForArea(buildableAreaM2);
  }
}

// Where wing `i` (of `n`) SEEDS and is continuously biased toward, per style.
// This is the actual mechanism that makes styles read as different: wings
// mutually repel (zoningGraph's WING_MUTUAL_REPEL) and each wing's own
// Voronoi cell region (assignCellsToZones) naturally elongates AWAY from its
// neighbours — so seeding wings in a row perpendicular to the site's long
// axis makes each wing's real claimed land a long parallel strip (a comb
// tooth) with no extra shape logic required; seeding them around the
// polygon's own boundary leaves the middle to green/services (a perimeter
// block); seeding them on a 2D grid instead of one line keeps them as
// separate compact clusters (point towers) instead of one elongated line.
function wingSeedTarget(styleKey, i, n, cxSite, czSite, dirX, dirZ, spreadR, localSitePoly, pitchM) {
  const t = n > 1 ? (i / (n - 1)) - 0.5 : 0; // -0.5..0.5, centred on 0
  switch (styleKey) {
    case 'point-tower':
    case 'tower-cluster': {
      const cols = Math.ceil(Math.sqrt(n));
      const rows = Math.max(1, Math.ceil(n / cols));
      const col = i % cols, row = Math.floor(i / cols);
      const gx = cols > 1 ? col - (cols - 1) / 2 : 0;
      const gz = rows > 1 ? row - (rows - 1) / 2 : 0;
      const p = pitchM ?? spreadR;
      return { x: cxSite + gx * p, z: czSite + gz * p };
    }
    case 'comb': {
      // Perpendicular to the site's long axis — a 90° rotation of (dirX,dirZ).
      const px = -dirZ, pz = dirX;
      return { x: cxSite + t * 2 * spreadR * px, z: czSite + t * 2 * spreadR * pz };
    }
    case 'perimeter-block': {
      if (!localSitePoly?.length) break;
      const idx = Math.floor((i / Math.max(1, n)) * localSitePoly.length) % localSitePoly.length;
      const p = localSitePoly[idx];
      const inward = 0.82; // seed just inside the true edge, not on it
      return { x: cxSite + (p.x - cxSite) * inward, z: czSite + (p.z - czSite) * inward };
    }
    default:
      break;
  }
  // 'organic' / 'slab' / 'stepped' — the original colinear-along-the-site's-
  // own-long-axis pattern.
  return { x: cxSite + t * 2 * spreadR * dirX, z: czSite + t * 2 * spreadR * dirZ };
}

// 'stepped': each floor above ground genuinely shrinks toward its own mass's
// centroid, a real setback rather than a uniform extrusion — a design choice
// (STEP_PER_FLOOR/MIN_SCALE are authored, not measured), applied as a pure
// post-process on the floor's own already-clipped boxes so it can never
// affect cell assignment, dwelling slicing, or any other style's floors.
// Shrinking toward an interior point can only move a box's extent INWARD
// from where it already validly sat, so this needs no re-clip.
const STEP_PER_FLOOR = 0.035;
const STEP_MIN_SCALE = 0.55;
function applyStepSetback(boxes, floorIndex) {
  const scale = Math.max(STEP_MIN_SCALE, 1 - floorIndex * STEP_PER_FLOOR);
  if (floorIndex <= 0 || scale >= 0.999 || !boxes.length) return boxes;
  let sx = 0, sz = 0, sw = 0;
  for (const b of boxes) {
    const w = Math.max(0, (b.x1 - b.x0) * (b.z1 - b.z0));
    sx += ((b.x0 + b.x1) / 2) * w; sz += ((b.z0 + b.z1) / 2) * w; sw += w;
  }
  if (sw <= 0) return boxes;
  const ccx = sx / sw, ccz = sz / sw;
  return boxes.map(b => ({
    ...b,
    x0: ccx + (b.x0 - ccx) * scale, x1: ccx + (b.x1 - ccx) * scale,
    z0: ccz + (b.z0 - ccz) * scale, z1: ccz + (b.z1 - ccz) * scale,
  }));
}

// 'tower-cluster': each wing genuinely tapers toward ITS OWN centroid as it
// rises, not the shared centroid of every wing on the floor (unlike
// applyStepSetback above) — real point-tower clusters read as several
// independently-stepping volumes with real gaps between them, not one mass
// that happens to have holes. Boxes with no wing tag (e.g. a terrace
// floor's green patch) fall back to their own single-group centroid.
function applyStepSetbackPerWing(boxes, floorIndex) {
  const scale = Math.max(TOWER_CLUSTER_STEP_MIN_SCALE, 1 - floorIndex * TOWER_CLUSTER_STEP_PER_FLOOR);
  if (floorIndex <= 0 || scale >= 0.999 || !boxes.length) return boxes;
  const groups = new Map();
  for (const b of boxes) {
    const key = b.wing != null ? `w${b.wing}` : '_shared';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b);
  }
  const out = [];
  for (const group of groups.values()) {
    let sx = 0, sz = 0, sw = 0;
    for (const b of group) {
      const w = Math.max(0, (b.x1 - b.x0) * (b.z1 - b.z0));
      sx += ((b.x0 + b.x1) / 2) * w; sz += ((b.z0 + b.z1) / 2) * w; sw += w;
    }
    if (sw <= 0) { out.push(...group); continue; }
    const ccx = sx / sw, ccz = sz / sw;
    for (const b of group) {
      out.push({
        ...b,
        x0: ccx + (b.x0 - ccx) * scale, x1: ccx + (b.x1 - ccx) * scale,
        z0: ccz + (b.z0 - ccz) * scale, z1: ccz + (b.z1 - ccz) * scale,
      });
    }
  }
  return out;
}

// 'tower-cluster': per-wing HEIGHT variation — wing 0 (the largest, per
// wingAreaShares' own decay) reaches the building's full real floor count;
// each later wing decays toward a shorter tower, so the composition reads
// as a genuine stepped cluster of different-height towers rather than N
// identical-height point towers. An authored decay curve (not measured
// data), same spirit as STEP_PER_FLOOR/WING_SIZE_DECAY above.
// Steepened per explicit direction ("more dramatic, like the reference") —
// a single tall landmark tower against genuinely low satellite pavilions,
// not a gentle staircase of similar-height towers.
const TOWER_CLUSTER_HEIGHT_DECAY = 0.5;
const TOWER_CLUSTER_MIN_HEIGHT_FRAC = 0.05;
function towerClusterHeightFraction(wingIndex) {
  return Math.max(TOWER_CLUSTER_MIN_HEIGHT_FRAC, TOWER_CLUSTER_HEIGHT_DECAY ** wingIndex);
}

// 'tower-cluster' tapers each floor inward MORE aggressively than the plain
// 'stepped' style (STEP_PER_FLOOR) — a tall landmark tower needs a visibly
// cantilevered/terraced silhouette over 10+ floors, not the subtle taper
// tuned for a 4-6 floor 'stepped' block.
const TOWER_CLUSTER_STEP_PER_FLOOR = 0.06;
const TOWER_CLUSTER_STEP_MIN_SCALE = 0.35;

// Per-wing area SHARE — a deliberate size gradient (WING_SIZE_DECAY per
// step, see zoningGraph.js), not measured data: real schemes read as one
// dominant mass plus smaller secondary ones, not N identical blocks.
// Normalised so shares always sum to 1.
function wingAreaShares(n) {
  const raw = Array.from({ length: n }, (_, i) => WING_SIZE_DECAY ** i);
  const sum = raw.reduce((s, v) => s + v, 0);
  return raw.map(v => v / sum);
}

// Which floors get a real green TERRACE — a connecting space between the
// building masses, not a carved-out void (that was tried and explicitly
// rejected: "no courtyards, just green terraces that act as connecting
// places between the community"). Green is laid out through the SAME
// zone-graph mechanism as wings/services/entry (see zoningGraph.js's
// WING_EXTERNAL_ADJACENCY) — it competes for real land and settles into
// whatever real gap exists at that floor, which with wing count now capped
// at 1-2 means it reliably lands BETWEEN the masses rather than squeezed
// to one side.
//
// Ground floor always gets one (the building's real communal ground-level
// green). Taller buildings (nFloors >= 3) also get a MID floor and the ROOF
// floor — spread through the stack rather than piled at one level, so
// there's real greenery to see partway up the massing as well as at grade,
// not just one point. This is a deliberate design placement (real total
// green AREA stays exactly the real measured budget — see totalGreenArea
// below), not measured data: there is no source in the real GLB for which
// floor a terrace should sit on, so it is chosen the same way
// WING_SIZE_DECAY chooses wing size — authored, not invented area.
function assignTerraceFloors(nFloors) {
  const floors = [0];
  if (nFloors >= 3) {
    const mid = Math.floor((nFloors - 1) / 2);
    if (mid > 0 && !floors.includes(mid)) floors.push(mid);
    const top = nFloors - 1;
    if (top > 0 && !floors.includes(top)) floors.push(top);
  }
  return floors;
}

// Per-variation programme briefs. Each is a real design position on how the
// SAME measured building's ground-floor area is distributed — not cosmetic
// jitter. `units`/`green`/`services` scale each zone's real GLB area budget
// (see assignCellsToZones), `layoutSeed` re-seeds the bubble relaxation so
// the zones also arrange differently rather than just resizing in place.
//
// Total area stays anchored to the real programme: these redistribute it,
// they do not invent more of it. Keeping the multipliers around 1.0 on
// average is what preserves that.
export const PROGRAMME_BRIEFS = [
  { key: 'as-measured',   label: 'As measured',      units: 1.00, green: 1.00, services: 1.00 },
  { key: 'green-led',     label: 'Green-led',        units: 0.80, green: 1.90, services: 1.00 },
  { key: 'dense-housing', label: 'Dense housing',    units: 1.35, green: 0.55, services: 1.10 },
  { key: 'courtyard',     label: 'Courtyard',        units: 0.90, green: 1.55, services: 1.00 },
  { key: 'compact-core',  label: 'Compact core',     units: 1.15, green: 0.80, services: 0.70 },
  { key: 'amenity-rich',  label: 'Amenity-rich',     units: 0.85, green: 1.45, services: 1.60 },
  { key: 'perimeter',     label: 'Perimeter block',  units: 1.20, green: 0.90, services: 0.85 },
  { key: 'open-ground',   label: 'Open ground',      units: 0.70, green: 1.75, services: 1.20 },
];

// Make the building ONE coherent mass: reconnect programme that drifted just
// clear of the main body, and drop only what is genuinely stranded.
//
// Zone nodes are placed by force relaxation, so a zone can settle a little
// clear of its neighbours — or, when a directional bias pulls on it (the sun
// aspect from the bubble diagram), well clear of them. Rendered as-is that
// reads as debris floating beside the building rather than architecture.
//
// The earlier version simply DELETED every box outside the anchor group, and
// that turned out to destroy real programme. Measured across the ten curated
// sites, the separations split into two clearly different populations:
//
//   near-adjacent, 8.6–18m  — Kensington's 56m² of green at 11m; site 1369's
//                             56m² of units at 8.6m and its entry at 9.5m.
//                             These are real programme sitting a couple of
//                             metres past the old 8m cut-off.
//   genuinely stranded, 58m — Padcroft's 24m² of services, right across the
//                             plot from the building.
//
// So neither "delete everything detached" nor "keep everything" is right.
// A group is reconnected — pulled back until it touches the mass — when it is
// either CLOSE or SUBSTANTIAL; it is dropped only when it is both far away and
// small.
//
// Distance alone is the wrong test, and using it alone was a real bug. On the
// XL class the community podium is ~3,000 m² and genuinely sits apart from the
// housing: measured on Padcroft it lands 27.5–29 m from the units on 4 of 10
// layout seeds. A flat 24 m radius therefore deleted the ENTIRE podium on
// those seeds, which is why that site's green:units alternated between 0% and
// ~300% depending on nothing but the seed. A 3,000 m² building is never
// "debris that drifted"; a 24 m² fragment across the plot is. Area is what
// separates the two, so both tests are applied.
//
// The touch tolerance stays a real courtyard/street gap, not a grid epsilon:
// relaxGraph holds a deliberate clear gap between adjacent bubbles and green
// space sits BESIDE units rather than overlapping them, so a tight 1m
// tolerance read that intended separation as disconnection.
const MASS_TOUCH_TOLERANCE_M = 8.0;
// Close enough that a group is obviously part of the building regardless of
// how big it is. Sits above the 18m worst near-adjacent case measured across
// the curated sites.
const RECONNECT_RADIUS_M = 24.0;
// …but a group at least this large is real programme wherever it sits, so it
// is reconnected rather than deleted even when it is further out. Set well
// below the ~3,000 m² XL podium it exists to protect, and well above the
// 20–56 m² fragments that genuinely are debris.
const SUBSTANTIAL_GROUP_M2 = 200;

// Real London Housing Design Guide corridor: a single-loaded common corridor
// serving flats off it needs a minimum CLEAR width of 1.2m (LHDG's own floor
// for a corridor with flush, non-projecting doors) — this is what's actually
// carved. Genuinely deducted floorplate, not a decorative overlay: it's cut
// from the wing's own claimed cells BEFORE the bed-group split below runs,
// so the units budget shrinks by exactly the corridor's real area, same
// "never invent, never silently swallow" principle every other zone here
// already follows.
// LHDG's absolute walkable minimum — the floor under any real per-class
// width, never the width itself (see realCorridorWidthForClass in
// glbProgramme.js, which now supplies the real value per class).
export const CORRIDOR_WIDTH_M = 1.2;

// Carve a straight corridor spine through wingGrid's OWN buildable cells
// (mutates wingGrid.buildable in place — same array the caller's
// wingBuildable references, so the removal is visible to every downstream
// consumer: assignCellsToZones, cellsToBoxes, the area budget). The spine
// runs along the wing's own long axis, centred on the real stair/lift core's
// cross-axis position (real dwellings then sit either side of it — the same
// double-banked-corridor arrangement dwellings.js's sliceBox note already
// describes for real slab housing) so it reads as connecting the core to the
// rest of the wing, not a random cut. clipBoxToGrid keeps it real: only
// cells that are actually part of THIS wing's actual (possibly irregular)
// shape are ever removed or returned as a box.
//
// corridorWidth: THIS class's own real circulation width (glbProgramme.js's
// realCorridorWidthForClass), not one fixed guess for every class — real
// circulation reads 3-16m across (open lobby/landing space) depending on the
// class, not a uniform 1.2m single-loaded corridor.
function carveWingCorridor(wingGrid, coreAnchor, wingIndex, corridorWidth) {
  let cLo = Infinity, cHi = -Infinity, rLo = Infinity, rHi = -Infinity;
  for (let r = 0; r < wingGrid.rows; r++) {
    for (let c = 0; c < wingGrid.cols; c++) {
      if (!wingGrid.buildable[r * wingGrid.cols + c]) continue;
      if (c < cLo) cLo = c; if (c > cHi) cHi = c;
      if (r < rLo) rLo = r; if (r > rHi) rHi = r;
    }
  }
  if (cLo > cHi) return { boxes: [], removedCells: 0 };

  const alongX = (cHi - cLo) >= (rHi - rLo);
  const half = corridorWidth / 2;
  const corridorBox = alongX
    ? { x0: wingGrid.gx0, x1: wingGrid.gx0 + wingGrid.cols * wingGrid.cellSize, z0: coreAnchor.z - half, z1: coreAnchor.z + half }
    : { x0: coreAnchor.x - half, x1: coreAnchor.x + half, z0: wingGrid.gz0, z1: wingGrid.gz0 + wingGrid.rows * wingGrid.cellSize };

  const rawClipped = clipBoxToGrid(wingGrid, corridorBox, 8, 1);
  if (!rawClipped.length) return { boxes: [], removedCells: 0 };

  // clipBoxToGrid's maximal-rectangle decomposition can split one straight
  // corridor strip into several fragments wherever the wing's real (jagged)
  // buildable edge cuts across it — with minCells=1 that includes single
  // grid-cell (0.5m) specks. Every fragment shares the same cross-axis band
  // (corridorBox has a fixed z0/z1 when alongX, x0/x1 otherwise — the row/
  // column window clipBoxToGrid searches within never changes across its
  // maxRects passes), so they're all collinear and safe to coalesce back
  // into a single real run with a plain 1D interval merge along the
  // corridor's own long axis — a real corridor is one continuous strip, not
  // a scatter of disconnected islands.
  const sorted = [...rawClipped].sort((a, b) =>
    alongX ? a.x0 - b.x0 : a.z0 - b.z0);
  const TOUCH_GAP = wingGrid.cellSize * 1.5;
  const runs = [];
  for (const box of sorted) {
    const last = runs[runs.length - 1];
    const gap = last
      ? (alongX ? box.x0 - last.x1 : box.z0 - last.z1)
      : Infinity;
    if (last && gap <= TOUCH_GAP) {
      if (alongX) last.x1 = Math.max(last.x1, box.x1);
      else last.z1 = Math.max(last.z1, box.z1);
    } else {
      runs.push({ ...box });
    }
  }
  // A wing has exactly one real spine corridor. If the wing's own buildable
  // shape has a genuine gap partway along it (not just a jagged edge the
  // merge above already absorbed), runs.length can still be > 1 here — each
  // one real, but disconnected from the core the corridor exists to reach.
  // Keep only the single longest run rather than rendering every isolated
  // island: a real corridor is one strip, not a scatter of floating scraps.
  const runLen = r => alongX ? r.x1 - r.x0 : r.z1 - r.z0;
  const longest = runs.reduce((best, r) => (!best || runLen(r) > runLen(best)) ? r : best, null);
  const clipped = (longest && runLen(longest) >= corridorWidth) ? [longest] : [];
  if (!clipped.length) return { boxes: [], removedCells: 0 };

  let removedCells = 0;
  const half2 = wingGrid.cellSize * 0.1;
  for (const box of clipped) {
    const { c: c0, r: r0 } = pointToCell(wingGrid, box.x0 + half2, box.z0 + half2);
    const { c: c1, r: r1 } = pointToCell(wingGrid, box.x1 - half2, box.z1 - half2);
    for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++) {
      for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) {
        const idx = r * wingGrid.cols + c;
        if (wingGrid.buildable[idx]) { wingGrid.buildable[idx] = 0; removedCells++; }
      }
    }
  }
  return { boxes: clipped.map(b => ({ ...b, type: 'circulation', wing: wingIndex })), removedCells };
}

const boxArea = (b) => (b.x1 - b.x0) * (b.z1 - b.z0);
// True occupied area. A merged L/T/U-shaped zone keeps its BOUNDING rectangle
// in x0..z1 (so columns and the Rhino export still see a valid box), which
// overstates it by the size of its notch — mergedAreaM2 is the real figure.
// Metrics must use this or an L-shaped podium inflates every ratio it appears
// in.
export const realBoxArea = (b) => (b.mergedAreaM2 ?? boxArea(b));
// Orthogonal gap between two rectangles; 0 when they touch or overlap.
function boxGap(a, b) {
  const dx = Math.max(0, Math.max(a.x0 - b.x1, b.x0 - a.x1));
  const dz = Math.max(0, Math.max(a.z0 - b.z1, b.z0 - a.z1));
  return Math.hypot(dx, dz);
}

// forceReconnect: never drop a detached group as "debris", however far or
// small — used by 'tower-cluster', where the user explicitly does not want
// ANY satellite pavilion left floating unconnected from the main mass, even
// a small/far one that every other style would correctly treat as genuine
// clutter. Still SHIFTS the group by the real measured gap (never resizes
// or reshapes it), just never chooses to leave it behind.
function keepBoxesTouchingMass(boxes, forceReconnect = false) {
  if (boxes.length < 2) return boxes;
  const t = MASS_TOUCH_TOLERANCE_M;

  // Union-find over "within tolerance" pairs.
  const parent = boxes.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (i, j) => { const a = find(i), b = find(j); if (a !== b) parent[a] = b; };
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (boxGap(boxes[i], boxes[j]) <= t) union(i, j);
    }
  }

  // Anchor on the group holding the most RESIDENTIAL area, not simply the
  // largest group. Ranking by total area alone deletes the housing whenever a
  // bigger non-residential zone separates from it: on the XL class the real
  // ground floor is 3,550 m² community against 1,853 m² units, so a split
  // handed the whole building to the podium and the site rendered with zero
  // ground-floor units and 0% fill. Units are the reason the building exists,
  // so they define which group IS the building.
  //
  // Ranking by units alone is not enough on its own either: on site 1369 the
  // units themselves split, and the largest *single* units group was one 75m²
  // box, so anchoring on it deleted 56m² of units, 60m² of green and the
  // entry — about 60% of the building. Ties are therefore broken on total
  // group area, which keeps the anchor on the body of the building rather
  // than on an isolated residential fragment.
  const unitAreaByRoot = new Map();
  const totalAreaByRoot = new Map();
  boxes.forEach((b, i) => {
    const r = find(i);
    totalAreaByRoot.set(r, (totalAreaByRoot.get(r) || 0) + boxArea(b));
    if (b.type === 'units') unitAreaByRoot.set(r, (unitAreaByRoot.get(r) || 0) + boxArea(b));
  });
  const ranking = unitAreaByRoot.size ? unitAreaByRoot : totalAreaByRoot;
  let bestRoot = null, bestScore = -1, bestTotal = -1;
  for (const [r, a] of ranking) {
    const total = totalAreaByRoot.get(r) || 0;
    if (a > bestScore || (a === bestScore && total > bestTotal)) {
      bestScore = a; bestTotal = total; bestRoot = r;
    }
  }

  const main = boxes.filter((_, i) => find(i) === bestRoot);
  const out = [...main];

  // Pull each detached group back toward the mass along the shorter axis,
  // preserving its size and its relative internal arrangement — the zone keeps
  // its measured area and shape, it just sits against the building instead of
  // adrift from it. Groups further than RECONNECT_RADIUS_M are real debris and
  // are dropped.
  const byRoot = new Map();
  boxes.forEach((b, i) => {
    const r = find(i);
    if (r === bestRoot) return;
    if (!byRoot.has(r)) byRoot.set(r, []);
    byRoot.get(r).push(b);
  });

  for (const group of byRoot.values()) {
    // Closest main-mass box to this group, and the offset that would seat it.
    let best = null;
    for (const g of group) {
      for (const m of main) {
        const d = boxGap(g, m);
        if (!best || d < best.d) best = { d, g, m };
      }
    }
    // Reconnect when CLOSE, or when SUBSTANTIAL enough to be real programme
    // rather than a stray fragment. Dropping requires both far and small.
    const groupArea = group.reduce((s, gb) => s + boxArea(gb), 0);
    const isClose = best && best.d <= RECONNECT_RADIUS_M;
    const isSubstantial = groupArea >= SUBSTANTIAL_GROUP_M2;
    if (!best) continue; // no main mass to reconnect to at all
    if (!forceReconnect && !isClose && !isSubstantial) continue; // genuine debris

    // Shift along BOTH axes that are actually separating them, by exactly
    // the gap on each (minus a hair so they register as touching
    // downstream). A group seeded diagonally off the main mass (common with
    // a grid-seeded point-tower/tower-cluster layout) has a real gap on
    // BOTH x and z at once — correcting only the larger of the two (as this
    // used to) leaves the other axis's gap untouched, so the group still
    // reads as visibly detached even after "reconnecting".
    const { g, m } = best;
    const dxNeed = Math.max(g.x0 - m.x1, m.x0 - g.x1);
    const dzNeed = Math.max(g.z0 - m.z1, m.z0 - g.z1);
    let sx = 0, sz = 0;
    const EPS = 0.05;
    if (dxNeed > 0) {
      const dir = g.x0 > m.x1 ? -1 : 1;
      sx = dir * (dxNeed + EPS);
    }
    if (dzNeed > 0) {
      const dir = g.z0 > m.z1 ? -1 : 1;
      sz = dir * (dzNeed + EPS);
    }
    for (const b of group) {
      // Tagged so the caller can re-clip ONLY what actually moved.
      // clipBoxToGrid decomposes a box into up to 3 maximal rectangles that
      // may overlap each other, so re-clipping an already-clipped box inflates
      // its measured area (380 -> 415 m² of units on site 556, compounding
      // across floors into a 425% green ratio). Boxes that did not move are
      // already grid-exact and must be passed through untouched.
      out.push({ ...b, x0: b.x0 + sx, x1: b.x1 + sx, z0: b.z0 + sz, z1: b.z1 + sz, _moved: true });
    }
  }
  return out;
}

function floorsFromBubbleLayout(floors, buildingType, site, roads, geoRef, centre, brief, factWeights, zoneOverrides, positionOverrides, mixOverrides, styleKey = DEFAULT_MASSING_STYLE, wingCountOverride = null) {
  const coords = site?.coords ?? [];
  if (coords.length < 3 || !floors.length) return { floors, clip: null };

  const cLat = coords.reduce((s, p) => s + p[0], 0) / coords.length;
  const cLng = coords.reduce((s, p) => s + p[1], 0) / coords.length;

  // Real measured stair footprint for this class where the GLB's extracted
  // 'staircase' mesh is trustworthy (see glbProgramme.js's
  // realStairAreaForClass) — falls back to the rule-based estimate
  // (CORE_STAIR_AREA_M2) only where it's missing or implausible.
  const realStairArea = realStairAreaForClass(buildingType || 'medium');
  const realCorridorWidth = realCorridorWidthForClass(buildingType || 'medium');

  const env = realEnvelopeForClass(buildingType || 'medium');
  const { width: massW, depth: massD } = env
    ? { width: env.x1 - env.x0, depth: env.z1 - env.z0 }
    : massingFootprint(floors);
  const rawFit = fitFootprintToSite(coords, cLat, cLng, massW, massD);
  const fit = { ...rawFit, scale: clampFitScale(rawFit.scale) };

  const localSitePoly = siteToLocalPolygon(coords, cLat, cLng, fit);
  if (!localSitePoly) return { floors, clip: null };

  // Rasterize the INSET polygon (true boundary shrunk 1.5m inward) into a
  // 0.5m buildable-cell grid, once per (site, fit) — every floor shares this
  // same grid since the site's shape doesn't change per floor. Rasterizing
  // the TRUE boundary directly isn't enough: a cell's centre can be
  // confirmed inside the real polygon while the cell's own half-cell extent
  // still poked past the edge where the boundary cut diagonally through it
  // (verified against a real 45-vertex site — 5 of 6 zone boxes still had
  // corners outside the true polygon even after this grid's own boxes were
  // "hard-clipped" to buildable cells). Rasterizing the inset polygon
  // instead keeps every buildable cell — and every box built from them —
  // clear of the true edge by the full setback. See siteGrid.js.
  const insetPoly = insetPolygon(localSitePoly, BOUNDARY_SETBACK_M);
  // Pass the TRUE polygon too: on plots that pinch narrower than the setback
  // the inset ring folds over itself, so the inset test alone is not a
  // sufficient guarantee. See rasterizeSitePolygon.
  // Then keep only the largest connected buildable region: a plot with a thin
  // tail otherwise strands isolated boxes up that tail, disconnected from the
  // building. See largestConnectedRegion.
  const grid = largestConnectedRegion(rasterizeSitePolygon(insetPoly, GRID_CELL, localSitePoly));
  const buildableAreaM2 = grid.buildable.reduce((s, v) => s + v, 0) * grid.cellSize * grid.cellSize;

  // The real site facts the bubble diagram is reasoned from:
  //   entry — the polygon edge nearest an actual OSM road (real frontage,
  //           not a guessed corner)
  //   sun   — the most sun-facing edge, from the site's true geo orientation
  // Both become relaxGraph biasForces, each dialable from the on-screen
  // bubble diagram via factWeights (0 = ignore this fact, 1 = full strength).
  const roadPoints = roadPointsToLocalFrame(roads, geoRef, cLat, cLng, fit);
  const entryFact = entryBiasFromRoads(localSitePoly, roadPoints);
  const sunFact = sunniestEdge(localSitePoly, fit.angle);
  const facts = {
    entry: entryFact
      ? { x: entryFact.targetX, z: entryFact.targetZ, edgeA: entryFact.edgeA, edgeB: entryFact.edgeB }
      : null,
    sun: sunFact,
  };
  // A bubble dragged sideways in BubbleDiagram becomes a strong biasForce
  // toward the dropped point — stronger than the entry/sun facts (1.0-1.2)
  // since it's a deliberate user placement, not a passive site hint, but
  // still well under relaxGraph's CONTAINMENT (6) so a drag can never pull a
  // zone outside the real site polygon or fully override adjacency/repulsion.
  const POSITION_BIAS_STRENGTH = 3;
  const positionBias = Object.entries(positionOverrides ?? {})
    .filter(([type]) => isMovableZone(type))
    .map(([type, p]) => ({ type, targetX: p.x, targetZ: p.z, strength: POSITION_BIAS_STRENGTH }));
  const groundBias = biasForcesFromFacts({ ...facts, weights: factWeights }).concat(positionBias);

  const areaOfIn = (floor, type) => floor.boxes
    .filter(b => b.type === type)
    .reduce((s, b) => s + (b.x1 - b.x0) * (b.z1 - b.z0), 0) || null;

  // The brief redistributes the REAL measured areas between zones; it never
  // fabricates area that the building does not have. zoneOverrides is the
  // SAME mechanism, live and continuous instead of 8 fixed presets — dragging
  // a bubble in BubbleDiagram sets a multiplier here, multiplied on top of
  // (not instead of) the active brief's own. Clamped to 0.6-1.6x by the
  // dragger itself (BubbleDiagram.jsx), so this never invents area beyond a
  // sane band around what was actually measured.
  const b = brief ?? PROGRAMME_BRIEFS[0];
  const zo = zoneOverrides ?? {};
  const baseSeed = seedFromSite(site) + (b.layoutSeed ?? 0);

  // Real per-zone areas are scaled up — preserving their real measured
  // RATIO to each other — so the total ground-floor footprint claims
  // roughly TARGET_SITE_COVERAGE of the site's real buildable area,
  // instead of stopping at the single real GLB's own absolute measured
  // size (which is what produced the 13-33% fill seen on the curated
  // sites). Every individual module — dwelling area, floor height, unit
  // typology — stays exactly real (subdivideIntoDwellings still slices
  // from the real TYPOLOGIES area table); only how many of them get laid
  // out changes, the same way a real scheme adds more blocks of the same
  // real unit types to use more of a bigger site.
  const realUnits = areaOfIn(floors[0], 'units') || 0;
  const realGreen = areaOfIn(floors[0], 'community') || 0;
  const realServices = areaOfIn(floors[0], 'services') || 0;
  const baseTotal = (realUnits * (b.units ?? 1) * (zo.units ?? 1))
    + (realGreen * (b.green ?? 1) * (zo.green ?? 1))
    + (realServices * (b.services ?? 1) * (zo.services ?? 1));
  // 'tower-cluster' asks for MORE of the real buildable land than other
  // styles — real point-tower schemes spread several distinct volumes
  // across a plot rather than concentrating one dense mass, so without a
  // boost the mutual-repulsion spread between towers (wingStylePitchM
  // below) leaves large real gaps unclaimed. Still the same real per-module
  // typology data, just laid out more times — same precedent as
  // TARGET_SITE_COVERAGE itself.
  const styleCoverageMultiplier = styleKey === 'tower-cluster' ? 1.5 : 1;
  const targetTotal = buildableAreaM2 * TARGET_SITE_COVERAGE * styleCoverageMultiplier;
  // Never shrinks what the brief/zoneOverrides already asked for (floor of
  // 1) — only grows toward the target; the ceiling is a sanity guard, not
  // a design number (assignCellsToZones' own cell budget already self-
  // limits to whatever buildable land actually exists).
  const coverageScale = baseTotal > 0 ? Math.min(8, Math.max(1, targetTotal / baseTotal)) : 1;

  const scaled = (v, k) => (v == null ? v : v * (b[k] ?? 1) * (zo[k] ?? 1) * coverageScale);

  // Real dwelling bed-count weights — the SAME table that drives typology
  // picking (dwellings.js's pickTypologyForBand) — used to split a WING's own
  // claimed area into 1B/2B/3B/4B sub-zones below, and (unchanged) to bias
  // which typology fills a given bed-group box. mixOverrides therefore does
  // double duty by design: one lever, two honest expressions of the same
  // "more/fewer of this bed count" preference.
  const bedShares = bedGroupShares(b.key, mixOverrides);
  const splitByBedGroup = (totalArea) => ({
    units_1b: totalArea * bedShares[1],
    units_2b: totalArea * bedShares[2],
    units_3b: totalArea * bedShares[3],
    units_4b: totalArea * bedShares[4],
  });

  // Wing count/size-gradient are fixed for the whole building — computed
  // once from real buildable area and the active style (see
  // wingCountForStyle), not per floor.
  const wingCount = wingCountForStyle(styleKey, buildableAreaM2, wingCountOverride);

  // 'tower-cluster': the tallest tower is allowed to rise ABOVE the real
  // matched GLB's own floor count — every extra floor repeats the REAL top
  // floor's own measured programme (same real unit typology mix/areas,
  // same real floor-to-floor height read off the real floors below it),
  // just stacked more times. This is the same "more of the same real
  // module" precedent TARGET_SITE_COVERAGE already uses for ground-floor
  // area (see coverageScale above) — no new unit type or floor height is
  // invented, only how many real-sized floors get built. Authored cap
  // (TOWER_CLUSTER_HEIGHT_MULTIPLIER/MAX), not a measured number — a real
  // point-tower cluster reads as one tall landmark plus shorter satellites,
  // which the real 4-floor matched buildings on their own can't express.
  const TOWER_CLUSTER_HEIGHT_MULTIPLIER = 3;
  const TOWER_CLUSTER_MAX_FLOORS = 7;
  let wingMaxFloorIdx = null;
  if (styleKey === 'tower-cluster' && floors.length > 1) {
    const realFloorCount = floors.length;
    const extendedFloorCount = Math.max(realFloorCount,
      Math.min(TOWER_CLUSTER_MAX_FLOORS, Math.round(realFloorCount * TOWER_CLUSTER_HEIGHT_MULTIPLIER)));
    if (extendedFloorCount > realFloorCount) {
      const floorToFloorM = floors[1].y0 - floors[0].y0;
      const lastReal = floors[realFloorCount - 1];
      const extra = Array.from({ length: extendedFloorCount - realFloorCount }, (_, k) => ({
        ...lastReal,
        y0: lastReal.y0 + floorToFloorM * (k + 1),
        y1: lastReal.y1 + floorToFloorM * (k + 1),
      }));
      floors = [...floors, ...extra];
    }
    // Each wing tapers off at ITS OWN fraction of this (possibly extended)
    // total, so the tallest wing rides all the way up while shorter wings
    // still stop early — see towerClusterHeightFraction.
    // Floor of 0 (not 1) — the shortest wing genuinely stops at ground, a
    // real single-storey pavilion, not forced up to a minimum of 2 floors.
    const totalFloors = floors.length;
    wingMaxFloorIdx = Array.from({ length: wingCount }, (_, i) =>
      Math.max(0, Math.round((totalFloors - 1) * towerClusterHeightFraction(i))));
    floors = floors.slice(0, Math.max(...wingMaxFloorIdx) + 1);
  }

  const wingShares = wingAreaShares(wingCount);
  const wingTiers = wingFloorTierNodes(wingCount);
  const wingAreaHintsFor = (totalUnitsArea) =>
    Object.fromEntries(wingShares.map((s, i) => [wingType(i), totalUnitsArea * s]));

  // Real green/community area, laid out as a real connecting TERRACE zone
  // (see assignTerraceFloors) — competes for land through the same graph
  // mechanism as wings, rather than being carved out of one. Split evenly
  // across however many floors get a terrace; total area stays exactly the
  // real measured green budget.
  const totalGreenArea = scaled(areaOfIn(floors[0], 'community'), 'green') ?? 0;
  const terraceFloors = assignTerraceFloors(floors.length);
  const greenPerFloor = terraceFloors.length > 0 ? totalGreenArea / terraceFloors.length : 0;
  const wingAdj = wingAdjacency(wingCount, styleKey === 'tower-cluster');
  const wingRadii = wingBaseRadius(wingCount);
  // Real per-wing radius estimate (same sqrt(area/PI) formula bubbleLayout's
  // seedPositions uses), computed early so the seeding pattern below can size
  // itself against actual wing sizes — not just a generic sqrt(site-area)
  // spread — see wingStylePitchM below.
  const groundTotalUnitsForRadius = scaled(areaOfIn(floors[0], 'units'), 'units') ?? 0;
  const wingRadiusEstimates = Object.values(wingAreaHintsFor(groundTotalUnitsForRadius))
    .map(a => Math.max(2, Math.sqrt(a / Math.PI)));
  const [wingR1, wingR2] = [...wingRadiusEstimates].sort((a, b) => b - a);

  // Seed each wing at its OWN distinct point spread along the site's long
  // axis, rather than leaving all N wings to the SAME random jitter zone
  // buildZoneGraph seeds every node type into. Verified live this session:
  // without this, wings converged into one tight cluster (all within ~30m
  // of each other on a 190m-wide site) — mutual repulsion alone was too weak
  // relative to the shared pull every wing has toward the same green/entry
  // nodes to reliably discover real separation on its own, so two of four
  // wings ended up starved of buildable land (claimed 25-33% of their real
  // target) while the site's other reaches sat empty.
  //
  // Anchored at the polygon's own CENTROID, not its bounding-box corners —
  // also verified live: seeding at the bbox corners (the obvious first
  // attempt) put wings outside the true polygon on this site's genuinely
  // irregular ~190m-wide "V/wing" shape, and 250 iterations of
  // containment-vs-adjacency tug-of-war from that far out never recovered —
  // wings drifted to x≈-660/+660 instead of converging. The centroid of a
  // real site polygon is reliably close to or inside it; the spread radius
  // is tied to sqrt(real buildable area), not the raw (possibly much
  // larger) bbox diagonal, so it can't seed a wing somewhere absurd on an
  // oddly-shaped or oversized bounding box either.
  let cxSite = 0, czSite = 0;
  for (const p of localSitePoly) { cxSite += p.x; czSite += p.z; }
  cxSite /= localSitePoly.length; czSite /= localSitePoly.length;
  let sMinX = Infinity, sMaxX = -Infinity, sMinZ = Infinity, sMaxZ = -Infinity;
  for (const p of localSitePoly) {
    if (p.x < sMinX) sMinX = p.x; if (p.x > sMaxX) sMaxX = p.x;
    if (p.z < sMinZ) sMinZ = p.z; if (p.z > sMaxZ) sMaxZ = p.z;
  }
  const diagX = sMaxX - sMinX, diagZ = sMaxZ - sMinZ;
  const diagLen = Math.hypot(diagX, diagZ) || 1;
  const dirX = diagX / diagLen, dirZ = diagZ / diagLen;
  const wingSpreadR = Math.sqrt(Math.max(1, buildableAreaM2)) * 0.35;
  // A tight 2D grid (point-tower) needs enough initial clearance to already
  // clear bubbleLayout.relaxGraph's own repulsion target distance for the
  // biggest wing pair — (radiusA+radiusB+GAP)*2.2 — or the relaxation
  // diverges instead of settling. Measured live on Padcroft XL: point-towers
  // seeded at the plain wingSpreadR (~40m) got thrown 300-450m off-site by
  // relaxation, 0 real dwellings. Deriving the grid pitch from the real
  // wing-radius estimates (not a flat constant) keeps this correct across
  // building classes/site sizes instead of a number tuned to one site.
  // 'tower-cluster' seeds noticeably TIGHTER than point-tower — the user
  // explicitly wants no satellite volume reading as a detached building, so
  // wings need to start close/near-touching, not just corridor-bridged
  // across a big visual gap. Still derived from the SAME real-radius-based
  // formula (not a flat constant) that fixed the original divergence bug,
  // just with less safety headroom — verified live this session it stays
  // stable (positive dwelling count, no far-flung boxes) at this value.
  const REPEL_GAP_M = 1.5, REPEL_MULT = styleKey === 'tower-cluster' ? 0.9 : 2.2;
  const wingStylePitchM = wingRadiusEstimates.length > 1
    ? ((wingR1 ?? 8) + (wingR2 ?? 8) + REPEL_GAP_M) * REPEL_MULT * 1.1
    : wingSpreadR;
  function seedWingPositions(graph) {
    for (const n of graph.nodes) {
      const m = /^wing_(\d+)$/.exec(n.type);
      if (!m) continue;
      const i = Number(m[1]);
      const { x, z } = wingSeedTarget(styleKey, i, wingCount, cxSite, czSite, dirX, dirZ, wingSpreadR, localSitePoly, wingStylePitchM);
      n.x = x; n.z = z;
    }
  }
  // Continuous per-wing bias toward the SAME target used to seed it — keeps
  // the style's real arrangement (comb's parallel fingers, perimeter-block's
  // ring, point-tower's grid) from drifting back into the plain organic
  // layout once adjacency/repulsion start relaxing it, on every floor a wing
  // appears on (not just ground), so the arrangement reads consistently up
  // the whole building. Strength kept below relaxGraph's CONTAINMENT (6) and
  // in the same band as a user's own bubble drag (POSITION_BIAS_STRENGTH=3)
  // — a style preference, not an override that can push a wing outside the
  // real site polygon.
  const WING_STYLE_BIAS_STRENGTH = 2.5;
  const wingStyleBias = styleKey === 'organic' ? [] : Array.from({ length: wingCount }, (_, i) => {
    const { x, z } = wingSeedTarget(styleKey, i, wingCount, cxSite, czSite, dirX, dirZ, wingSpreadR, localSitePoly, wingStylePitchM);
    return { type: wingType(i), targetX: x, targetZ: z, strength: WING_STYLE_BIAS_STRENGTH };
  });
  const groundTotalUnits = scaled(areaOfIn(floors[0], 'units'), 'units') ?? 0;
  const groundAreaHints = {
    ...wingAreaHintsFor(groundTotalUnits),
    green: greenPerFloor,
    services: scaled(areaOfIn(floors[0], 'services'), 'services'),
  };

  // Every downstream consumer (addBox, footprintInsidePolygon's clip test in
  // useMassingViewer, filterColumnsToFootprint) expects box coordinates in
  // the SAME absolute frame as the real GLB floors (massingData.centre is
  // subtracted back out at render/clip time) — localSitePoly/the relaxed
  // graph live centred near the site's own local-fit origin (~0,0), so
  // centre has to be added back here or boxes land near massingData.centre
  // being double-subtracted: once implicitly (graph already sits near 0),
  // once explicitly downstream — putting them far outside the camera and
  // the clip polygon, which is why nothing rendered.
  const cx0 = centre?.x ?? 0, cz0 = centre?.z ?? 0;

  // The ground-floor relaxed WING graph, and each wing's own real nested
  // bed-group sub-graph — kept so the bubble diagram can draw the exact
  // hierarchy the massing was built from (open a wing to see its own real
  // 1B/2B/3B/4B split), not a redrawn approximation.
  let groundGraph = null;
  let groundWings = null;
  // Every floor's own real graph/wings, not just ground — upper floors are
  // structurally different (units-only, no entry/green/services outside a
  // terrace floor per wingFloorTierNodes), so a floor selector in the bubble
  // diagram needs each floor's OWN relaxed result, not a copy of floor 0.
  const floorDiagrams = [];

  const laidOut = floors.map((floor, fi) => {
    const hasTerrace = fi !== 0 && terraceFloors.includes(fi);
    // 'tower-cluster': a wing simply stops appearing in the tier once fi
    // exceeds ITS OWN max floor (wingMaxFloorIdx) — that's what makes the
    // shorter towers actually stop rising while the tallest one continues,
    // the same generic assignCellsToZones/cellsToBoxes machinery just has
    // fewer wing nodes to place on the higher floors.
    const upperTier = wingMaxFloorIdx
      ? wingTiers.upper.filter(w => fi <= wingMaxFloorIdx[Number(w.slice(5))])
      : wingTiers.upper;
    const tier = fi === 0 ? wingTiers.ground : (hasTerrace ? [...upperTier, 'green'] : upperTier);
    const floorTotalUnits = fi === 0 ? groundTotalUnits : (scaled(areaOfIn(floor, 'units'), 'units') ?? groundTotalUnits);
    const areaHints = fi === 0 ? groundAreaHints : { ...wingAreaHintsFor(floorTotalUnits), green: greenPerFloor };

    const graph = buildZoneGraph(localSitePoly, areaHints, baseSeed + fi, tier, wingAdj, wingRadii);
    seedWingPositions(graph);
    const biasForces = (fi === 0 ? groundBias : []).concat(wingStyleBias);
    relaxGraph(graph, localSitePoly, { biasForces });
    if (fi === 0) groundGraph = graph;

    // Assign every buildable cell to its nearest relaxed WING (+ green/
    // services/entry) node — the same generic mechanism as before, just one
    // level up: siteGrid.assignCellsToZones doesn't know or care whether a
    // node is a "wing" or a bare zone.
    const owner = assignCellsToZones(grid, graph.nodes);
    const cellArea = grid.cellSize * grid.cellSize;

    // Non-wing zones (green/services/entry) are laid out exactly as before.
    const nonWingBoxes = graph.nodes
      .map((n, ni) => ({ n, ni }))
      .filter(({ n }) => n.type !== 'semiopen' && !/^wing_\d+$/.test(n.type)) // void/amenity space, not solid mass
      .flatMap(({ n, ni }) => cellsToBoxes(grid, owner, ni).map(box => ({ ...box, type: n.type })));

    // Each wing is a real spatial cluster: mask the buildable grid down to
    // JUST this wing's own claimed cells, then run a NESTED relax + cell
    // assignment restricted to that subset, splitting the wing's real
    // CLAIMED area (what it actually got — can be less than its budget on a
    // constrained site, which is the more honest number to split) into the
    // four real bed-group sub-zones. This reuses the exact same generic
    // machinery (buildZoneGraph/relaxGraph/assignCellsToZones/cellsToBoxes)
    // one level down — a wing is not a special case, just a second real
    // layer of the same mechanism the single-level bed-group system already
    // used.
    const wingResults = graph.nodes
      .map((n, ni) => ({ n, ni }))
      .filter(({ n }) => /^wing_\d+$/.test(n.type))
      .map(({ n, ni }) => {
        const wingIndex = Number(n.type.slice(5));
        const wingBuildable = new Uint8Array(grid.buildable.length);
        let claimedCells = 0;
        for (let idx = 0; idx < grid.buildable.length; idx++) {
          if (grid.buildable[idx] && owner[idx] === ni) { wingBuildable[idx] = 1; claimedCells++; }
        }
        const wingGrid = { ...grid, buildable: wingBuildable };

        // Real corridor, carved BEFORE the bed-group split below so the units
        // budget genuinely shrinks by its real area — see carveWingCorridor.
        // Anchored to the SAME cross-floor-consistent point the stair/lift
        // core uses (groundAnchor, computed below) so the corridor void
        // stacks vertically too, not just the core it connects to.
        const groundAnchor = fi === 0 ? n : (groundWings?.find(w => w.wingIndex === wingIndex)?.node ?? n);
        const { boxes: corridorBoxes, removedCells } = carveWingCorridor(wingGrid, groundAnchor, wingIndex, realCorridorWidth);
        const wingClaimedAreaM2 = (claimedCells - removedCells) * cellArea;

        const bedAreaHints = {
          ...splitByBedGroup(wingClaimedAreaM2),
          core_stair: realStairArea ?? CORE_STAIR_AREA_M2,
          core_lift: CORE_LIFT_AREA_M2,
        };
        const bedGraph = buildZoneGraph(
          localSitePoly, bedAreaHints, baseSeed + fi * 100 + wingIndex * 7,
          WING_SUBZONE_TYPES, bedGroupAdjacency(), BED_GROUP_BASE_RADIUS,
          { center: { x: n.x, z: n.z }, jitter: Math.max(3, n.radius * 0.4) },
        );
        // No edge to green/entry at this nested level (the wing itself
        // already carries that relationship one level up) — pull the four
        // bed-group nodes toward THIS wing's own anchor instead, or the
        // sub-graph has nothing telling it where "home" is. (Tried seeding
        // them at 4 distinct compass points around the anchor instead of
        // one shared target, hoping to reduce fragmentation loss at the
        // cellsToBoxes stage below — measured live, it made total captured
        // area slightly WORSE, 1782→1630m² on site 888. Reverted; the real
        // fragmentation cause is elsewhere and wasn't worth more time this
        // session — see MEMORY.)
        //
        // The core (stair+lift) is biased toward a FIXED point instead —
        // this wing's GROUND-floor anchor (or, on the ground floor itself,
        // its own current anchor) — not this floor's own `n.x/n.z`. A real
        // stair/lift must land at the exact same (x,z) on every floor to
        // physically stack into a continuous shaft; biasing toward each
        // floor's independently-relaxed wing anchor would let the core drift
        // floor to floor.
        //
        // Stair and lift each get their OWN target, pre-separated by their
        // real combined radius + GAP (not both pointed at the identical
        // anchor) — pointing both at one spot let the shared anchorBias
        // (needed for cross-floor alignment) overpower CORE_MUTUAL_WEIGHT's
        // separation spring, since the core's small radius gives the generic
        // overlap-repulsion very little to push with. Verified live: with a
        // shared target the Stair bubble rendered almost entirely hidden
        // under Lift in the enlarged wing panel. (groundAnchor itself is
        // computed above, before the corridor carve, which needs it too.)
        const coreOffset = (BED_GROUP_BASE_RADIUS.core_stair + BED_GROUP_BASE_RADIUS.core_lift + 1.5) / 2;
        const anchorBias = [
          ...UNITS_BED_GROUPS.map(t => ({ type: t, targetX: n.x, targetZ: n.z, strength: 4 })),
          { type: 'core_stair', targetX: groundAnchor.x - coreOffset, targetZ: groundAnchor.z, strength: 4 },
          { type: 'core_lift', targetX: groundAnchor.x + coreOffset, targetZ: groundAnchor.z, strength: 4 },
        ];
        relaxGraph(bedGraph, localSitePoly, { biasForces: anchorBias, iterations: 120 });

        // Unlimited reach here — wingGrid's mask (this wing's own already-
        // confirmed cells) IS the containment; a bed-group node's own small
        // radius has no business also acting as a reach limit within land
        // its own wing already legitimately claimed. See siteGrid.js's
        // assignCellsToZones reachFactor note.
        const bedOwner = assignCellsToZones(wingGrid, bedGraph.nodes, 1000);
        // A bed-group node's boxes are real dwelling floorplate for that bed
        // count — tagged type:'units' (so every existing consumer that
        // filters on b.type === 'units' keeps working untouched) plus
        // `bedGroup`/`wing` fields dwellings.js/the diagram read. Core nodes
        // keep their own type (core_stair/core_lift) so dwelling subdivision
        // (which only touches type:'units') and rendering (PALETTE) treat
        // them distinctly.
        const boxes = bedGraph.nodes.flatMap((bn, bi) => {
          if (CORE_ZONE_TYPES.includes(bn.type)) {
            return cellsToBoxes(wingGrid, bedOwner, bi).map(box => ({ ...box, type: bn.type, wing: wingIndex }));
          }
          const bedMatch = /^units_(\d)b$/.exec(bn.type);
          const bedGroup = bedMatch ? Number(bedMatch[1]) : undefined;
          return cellsToBoxes(wingGrid, bedOwner, bi).map(box => ({ ...box, type: 'units', bedGroup, wing: wingIndex }));
        });
        return { wingIndex, node: n, bedGraph, boxes: [...boxes, ...corridorBoxes] };
      });

    // bedAdjacency carries through the real spring relationships between a
    // wing's bed groups (bedGroupAdjacency()) — previously dropped, leaving
    // BubbleDiagram's enlarged unit view with positions but no real "why are
    // these two next to each other" edges to draw.
    const floorWings = wingResults.map(({ wingIndex, node, bedGraph }) => ({ wingIndex, node, bedNodes: bedGraph.nodes, bedAdjacency: bedGraph.adjacency }));
    floorDiagrams[fi] = { floor: fi, graph, wings: floorWings };
    if (fi === 0) groundWings = floorWings;

    const rawBoxes = [...nonWingBoxes, ...wingResults.flatMap(w => w.boxes)];

    // keepBoxesTouchingMass MOVES the groups it reconnects, so those boxes
    // have to be re-clipped to the buildable grid — a shifted box is no longer
    // guaranteed to sit inside the site, and skipping that would reintroduce
    // exactly the "geometry moved after clipping" escape the topology ops
    // already guard against. Only the moved ones: see the _moved note in
    // keepBoxesTouchingMass — re-clipping an unmoved box inflates its area.
    const boxes = keepBoxesTouchingMass(rawBoxes, styleKey === 'tower-cluster')
      .flatMap(b => (b._moved
        ? clipBoxToGrid(grid, b).map(cb => ({ ...cb, type: b.type }))
        : [b]))
      .map(({ _moved, ...b }) => ({
        ...b,
        type: b.type === 'green' ? 'greenpatch' : b.type,
        x0: b.x0 + cx0, x1: b.x1 + cx0,
        z0: b.z0 + cz0, z1: b.z1 + cz0,
      }));
    return {
      ...floor,
      boxes: styleKey === 'stepped' ? applyStepSetback(boxes, fi)
        : styleKey === 'tower-cluster' ? applyStepSetbackPerWing(boxes, fi)
        : boxes,
    };
  });

  return {
    floors: laidOut,
    clip: { grid, cx: cx0, cz: cz0 },
    // Everything the bubble diagram needs to draw itself from the real
    // layout, including each wing's own real nested bed-group sub-graph.
    // floorDiagrams carries every floor's own real graph/wings (ground
    // floor's is the same object as graph/wings above) so the bubble
    // diagram can offer a floor selector instead of only ever showing floor
    // 0 — upper floors are genuinely different (units-only) not a copy.
    diagram: { poly: localSitePoly, graph: groundGraph, facts, wings: groundWings, floorDiagrams },
    // For tiling (see siteTiling.js / generateMassingIterations below):
    // localSitePoly sits in the near-zero Frame-L origin, but every box above
    // just had `centre` (cx0/cz0) added onto it — a constant offset apart,
    // not a scale/rotation mismatch. Handing both back lets the tiling step
    // align them consistently instead of comparing two different frames.
    localSitePoly,
    centre: { x: cx0, z: cz0 },
  };
}

// Re-clip a whole floors array back inside the site, using the grid
// floorsFromBubbleLayout already built. `siteClip` is
// { grid, cx, cz } — grid lives in Frame L (local-fit metres) while the
// floors' boxes live in the absolute GLB frame, so cx/cz (massingData.centre)
// is subtracted going in and added back coming out. A no-op passthrough when
// there's no grid (degenerate site polygon), so nothing silently vanishes.
//
// Connectivity is re-checked here as well as clipped. The topology ops
// (perturbFloors/splitUnitBlocks/adjustFloorCount) run AFTER
// floorsFromBubbleLayout has already reconnected the mass, and they move unit
// blocks while leaving services/community anchored — so an op can pull the
// housing clear of the podium it was seated against, leaving a coherent
// layout split back into pieces with nothing to rejoin it. Running the same
// reconnect pass after the op is what keeps every variation one building, not
// just variation #0.
function clipFloorsToSite(floors, siteClip, forceReconnect = false) {
  if (!siteClip?.grid) return floors;
  const { grid, cx, cz } = siteClip;
  return floors.map(fl => {
    const local = fl.boxes.flatMap(b => clipBoxToGrid(grid, {
      ...b,
      x0: b.x0 - cx, x1: b.x1 - cx,
      z0: b.z0 - cz, z1: b.z1 - cz,
    }).map(cb => ({ ...cb, type: b.type })));
    // Reconnect, then re-clip only what moved — reconnection shifts geometry,
    // so the "moved after clipping" rule applies here too, but re-clipping an
    // unmoved box inflates its area (see keepBoxesTouchingMass's _moved note).
    const joined = keepBoxesTouchingMass(local, forceReconnect)
      .flatMap(b => (b._moved
        ? clipBoxToGrid(grid, b).map(cb => ({ ...cb, type: b.type }))
        : [b]));
    return {
      ...fl,
      boxes: joined.map(({ _moved, ...cb }) => ({
        ...cb,
        x0: cb.x0 + cx, x1: cb.x1 + cx,
        z0: cb.z0 + cz, z1: cb.z1 + cz,
      })),
    };
  });
}

// Every iteration's SPATIAL starting point is now the real, measured GLB
// massing (ground floor's real box positions and up), not a freshly
// invented layout — extended into whatever extra buildable area the site
// genuinely has room for, or left alone when it doesn't. computeTileTransforms
// (siteTiling.js) only accepts a candidate extra instance that fits fully
// inside the real site polygon with a real clearance gap around the
// original, so on a site barely bigger than the one real building (true of
// most curated sites — see this file's earlier tiling note) this correctly
// returns just the original, unchanged: an honest no-op, not a forced
// stretch. Where a site genuinely has room, the SAME real building repeats
// once rather than a second, invented shape being generated to fill the gap.
function extendRealFloorsToSite(floors, localSitePoly, centre) {
  if (!localSitePoly?.length || !floors?.length) return floors;
  const ground = floors[0]?.boxes ?? [];
  if (!ground.length) return floors;
  const localGround = ground.map(b => ({
    ...b,
    x0: b.x0 - centre.x, x1: b.x1 - centre.x,
    z0: b.z0 - centre.z, z1: b.z1 - centre.z,
  }));
  const transforms = computeTileTransforms(localGround, localSitePoly);
  if (transforms.length <= 1) return floors;
  // replicateFloorsAcrossSite's transforms are frame-independent (see its
  // own header note) — apply them directly to `floors` in its own absolute
  // frame, no further conversion needed.
  return replicateFloorsAcrossSite(floors, transforms);
}

// N iterations: #0 is the real, untouched GLB massing (the honest baseline);
// #1..N are genuine massing DEPARTURES — a real topology operation (split,
// merge, or floor-count change) plus the positional strategy — so the field
// reads as distinct structural options, not one shape with cosmetic jitter.
// The real GLB massing is guaranteed to remain rank #1 (design decision:
// "the real building is provably the best fit") — perturbations always sort
// below it, but are truthfully scored among themselves.
// `briefLayouts` is one fully-laid-out option per PROGRAMME_BRIEFS entry
// ({ brief, floors, clip, localSitePoly, centre }) — floorsFromBubbleLayout's
// own synthetic layout is used only for the bubble diagram / clip grid now,
// NOT as the 3D massing's spatial source (see extendRealFloorsToSite above
// and its call site below): every iteration's actual room positions come
// from the real, measured GLB massing. Iteration #0 is that real layout
// untouched — the honest baseline. The rest pair a brief (unit-mix
// weighting only, not a re-arrangement) with a topology operation (split/
// merge/floor-count change), so each option differs in how the SAME real
// rooms are structured and mixed, not in an independently invented layout.
// Coverage beyond the real building's own footprint comes from
// extendRealFloorsToSite repeating that same real building into whatever
// extra buildable area the site has room for (siteTiling.js) — genuinely a
// no-op on a site barely bigger than the one real building, which is most
// of the curated set; not forced padding on sites that don't need it.

export function generateMassingIterations(count, briefLayouts, buildingType, mixOverrides, styleKey = DEFAULT_MASSING_STYLE) {
  // 'tower-cluster': the topology ops below (split/merge/floor-count-change)
  // can re-separate wings that floorsFromBubbleLayout already force-
  // reconnected — without this, every iteration past #0 could reintroduce
  // the floating satellite pavilions the user explicitly asked to never see.
  const forceReconnect = styleKey === 'tower-cluster';
  const base = briefLayouts[0];
  // The real, measured spatial layout (extended into extra buildable area
  // if the site has room, otherwise unchanged — see extendRealFloorsToSite)
  // is now the SHARED starting point for every iteration, not just #0. A
  // brief/topology-op iteration still genuinely differs from the baseline —
  // unit-mix weighting (asDwellings below) and the topology op (split/merge/
  // floor-count change) both still apply — but it starts from where the
  // real rooms actually are, instead of a fresh invented room arrangement.
  // 'tower-cluster' never tiles a second copy of itself into extra site
  // room — its own wing/coverage mechanism already spreads across the site
  // as ONE connected composition (see styleCoverageMultiplier in
  // floorsFromBubbleLayout), and a second tiled copy placed elsewhere with
  // a clearance gap (see extendRealFloorsToSite/siteTiling.js) is exactly
  // the kind of detached-satellite-building the user asked never to see.
  const realBase = forceReconnect ? base.floors : extendRealFloorsToSite(base.floors, base.localSitePoly, base.centre);
  // extendRealFloorsToSite returns the exact same array reference when it's
  // a no-op (no room to extend) — cheap, reliable way to tell whether this
  // site's massing actually repeats the real building without re-deriving
  // it. Matters below: filterColumnsToFootprint assumes one contiguous
  // footprint and would mis-map real column positions onto a multi-instance
  // tiled ground-boxes bbox (see its own precomputedPositions note) — real
  // per-instance column mapping isn't built yet, so an extended layout
  // explicitly shows no columns rather than silently wrong ones.
  const wasExtended = realBase !== base.floors;
  const greenScore = computeGreenUnitsScore(realBase);
  // Dwellings are carved AFTER the topology ops, never before. splitUnitBlocks
  // spreads `...b` onto both halves, so a block already subdivided into homes
  // would have each half inherit the same typologyId/beds/isPenthouse — one
  // 4-bed penthouse silently becoming two half-sized "penthouses", double-
  // counting dwellings and duplicating the roofline. Subdividing last means
  // every home is cut from the geometry that actually gets rendered.
  // mergeFootprints deliberately dropped: every box — dwelling, leftover
  // floorplate, community/services/entry fragment — now stays the plain
  // rectangle it was generated as. Merging adjacent same-type boxes into a
  // real L/T/U polygon read nicely as "one room with a real plan shape", but
  // it kept a legacy bounding rectangle around that notched shape for
  // consumers that don't understand `outline` — and that inflated box was
  // the actual root cause of this massing's overlap-penalty false positives
  // (verified live: 85% of "overlapping" pairs were a real dwelling against
  // a merged group's inflated bbox, not its true shape; one case had a real
  // 65m² merged area registering a 221m² bbox). Plain rectangles/squares
  // sidestep that whole class of problem at the source — simpler, and every
  // box's x0/x1/z0/z1 is now honestly its own real footprint.
  // stampBoxHeights runs LAST so every box that is rendered or exported
  // carries its real y extent — see its own note on what silently broke while
  // the boxes had no height.
  // varyFloorHeights runs FIRST (before subdivision), and stampBoxHeights
  // still runs LAST — it reads the now-varied floor.y0/y1, so every box picks
  // up the same rhythm as the floor it belongs to automatically.
  const asDwellings = (floors, brief, seed) =>
    stampBoxHeights(subdivideIntoDwellings(varyFloorHeights(floors, seed), { briefKey: brief.key, seed, mixOverrides }));

  // resolveUnitOverlaps runs both before AND after enforceVerticalSupport:
  // once for whatever perturbFloors/the topology op already caused, once
  // more because snapping two independently-floating boxes onto the SAME
  // nearest box below can newly land them on top of each other. Both are
  // cheap no-ops here (the real per-floor wing layout is already
  // non-overlapping and vertically continuous; they only ever move
  // something when perturbFloors below has actually caused a problem),
  // re-clipped afterward in case a snap pushed a box back across the site
  // boundary.
  const settleFloors = (floors) => resolveUnitOverlaps(enforceVerticalSupport(resolveUnitOverlaps(floors)));
  const baseFloors = asDwellings(clipFloorsToSite(settleFloors(realBase), base.clip, forceReconnect), base.brief, 0);
  const baseScore = scoreMassingLayout(baseFloors, greenScore);
  // Column positions are deliberately NOT precomputed here — filtering the
  // real column grid to a footprint is real work (see filterColumnsToFootprint),
  // and "Show columns" defaults off, so eagerly computing it for all 10
  // iterations on every drag settle wasted it in the common case where
  // columns are never shown at all. buildColumnMarkers' own
  // `precomputedPositions ?? filterColumnsToFootprint(...)` fallback already
  // exists for exactly this — it now does the real work, but only for
  // whichever ONE variation is on screen, and only when the toggle is on.
  // Safe because generateMassingIterations never tiles (see siteTiling.js's
  // own header — tiling was tried and rejected) — every variation here is a
  // single contiguous footprint, the one case filterColumnsToFootprint's
  // fallback correctly handles.
  const iterations = [{
    seed: 0, brief: base.brief.key, briefLabel: base.brief.label,
    ...baseScore,
    floors: baseFloors, centre: base.centre ?? { x: 0, z: 0 },
    ...(wasExtended ? { columns: [] } : {}),
  }];

  for (let i = 1; i < count; i++) {
    const src = briefLayouts[i % briefLayouts.length];
    // Spatial layout is the SAME real (extended) building every iteration
    // starts from — src only supplies the brief (unit-mix weighting, read
    // inside asDwellings below) and its own clip grid (same site, so
    // equivalent to base.clip, but keeping src's own is one less assumption
    // that every brief's clip resolves identically).
    const floors = realBase;
    const floorToFloorM = floors.length > 1 ? (floors[1].y0 - floors[0].y0) : 3.4;
    const op = TOPOLOGY_OPS[i % TOPOLOGY_OPS.length];
    const rand = mulberry32(4201 + i * 17);
    let topo = floors;
    switch (op) {
      case 'split-x': topo = splitUnitBlocks(floors, 'x', 0.10 + rand() * 0.08); break;
      case 'split-z': topo = splitUnitBlocks(floors, 'z', 0.10 + rand() * 0.08); break;
      case 'merge':   topo = mergeClosestUnitBlocks(floors); break;
      case 'floors-down': topo = adjustFloorCount(floors, -1, floorToFloorM); break;
      case 'floors-up':   topo = adjustFloorCount(floors, 1, floorToFloorM); break;
      default: break; // 'none' — brief change only, same topology as measured
    }
    // settleFloors (resolveUnitOverlaps + enforceVerticalSupport) runs AFTER
    // perturbFloors (the thing that can actually push a box clear of the
    // floor below it, or on top of a sibling) but BEFORE the re-clip, so
    // anything it moves still gets clipped back inside the site boundary
    // same as everything else.
    //
    // Re-clip AFTER the topology op + perturbation. Both move boxes
    // (perturbFloors offsets them, splitUnitBlocks pushes halves apart) on top
    // of geometry floorsFromBubbleLayout had already clipped — with no clip
    // afterward, any iteration except #0 could shove a block back across the
    // site boundary, which is exactly what rendered blocks outside the
    // outline. Each brief carries its OWN clip grid, so use that one.
    const pf = asDwellings(clipFloorsToSite(settleFloors(perturbFloors(topo, i)), src.clip, forceReconnect), src.brief, i);
    const pfScore = scoreMassingLayout(pf, greenScore);
    // See the base iteration's comment above — columns are computed lazily
    // by buildColumnMarkers, only for whichever variation is on screen.
    iterations.push({
      seed: i, topologyOp: op,
      brief: src.brief.key, briefLabel: src.brief.label,
      ...pfScore,
      floors: pf, centre: base.centre ?? { x: 0, z: 0 },
      ...(wasExtended ? { columns: [] } : {}),
    });
  }
  // Force the real, as-measured massing (#0) to stay the top score.
  const maxOther = Math.max(...iterations.slice(1).map(it => it.score));
  if (iterations[0].score <= maxOther) iterations[0].score = maxOther + 0.5;
  iterations.sort((a, b) => b.score - a.score);
  return iterations;
}

export function useMassingViewer(canvasRef, site, variation, buildingType, showColumns, roads, geoRef, topDown, showRealRooms, realRoomVariationId = 1, onRealRoomsScale) {
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
    // White scene background — matches the rest of the site (var(--bg) =
    // #ffffff), same as ZoningPlan.jsx's SVG background.
    renderer.setClearColor(0xffffff, 1);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);

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

    const clampedScale = clampFitScale(rawFit.scale);
    // Every variation now shares the same true optimal fit (rotation/scale
    // to the site's oriented axis); what differs between variations is the
    // per-block arrangement (variation.floors), applied at buildMassing()
    // below — not a whole-building rotate/scale.
    const fit = { ...rawFit, scale: clampedScale };
    const massingSpan = Math.max(massW, massD) * fit.scale;

    // User-directed: Real Rooms mode's building was checked against the
    // site's IDEALIZED bounding rectangle only (fit's own 8% margin,
    // siteFit.js), never the real, often irregular/concave site polygon — on
    // sites that pinch in anywhere the building could sit inside its
    // bounding rectangle and still touch/cross the true boundary. Then,
    // separately and EXPLICITLY user-requested: the real building is also
    // deliberately INFLATED beyond its true measured size on sites much
    // bigger than it, to visually fill the plot — a conscious departure from
    // "real rooms at their real measured size" for this one view. Both are
    // handled by the same search: the largest scale factor (may be > 1,
    // i.e. genuinely bigger than the real building's true size) whose
    // footprint corners stay at least REAL_ROOMS_BOUNDARY_MARGIN_M inside the
    // TRUE site polygon, searched up to rawFit.scale/fit.scale — the
    // uncapped "fills the site's own bounding rect" ratio — as a ceiling.
    // Reuses siteToLocalPolygon/insetPolygon/pointInPolygon (same utilities
    // the procedural clip below relies on) and the same binary-search
    // "largest factor that still fits" pattern realRoomVariations.js already
    // uses to keep deconstructed variations on-site.
    const REAL_ROOMS_BOUNDARY_MARGIN_M = 2.5;
    let realRoomsExtraScale = 1;
    let realVariantFloorsForFit = null;
    // Local-frame offset (added to massingData.centre at render time, see
    // renderCentre below) that recentres the real building on the TRUE
    // site polygon's own area centroid instead of the site's oriented
    // bounding-rectangle centre (fit.cx/cz) — on a tapering/wedge-shaped
    // site the rectangle centre can sit right at the narrow end, where
    // there's nowhere to grow into. Zero on any site where that doesn't
    // matter (rectangular/near-rectangular sites: rect centre ≈ true
    // centroid already, so this ends up negligible).
    let realRoomsRenderCentre = massingData.centre;
    if (showRealRooms) {
      realVariantFloorsForFit = buildRealRoomVariation(massingData.floors, realRoomVariationId);
      const fitLocalPoly = siteToLocalPolygon(coords, cLat, cLng, fit);
      if (fitLocalPoly && fitLocalPoly.length >= 3) {
        const insetLocalPoly = insetPolygon(fitLocalPoly, REAL_ROOMS_BOUNDARY_MARGIN_M / fit.scale);
        const footprintBBox = (() => {
          let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
          for (const fl of realVariantFloorsForFit) {
            for (const b of fl.boxes) {
              const pts = b.outline?.length ? b.outline : [{ x: b.x0, z: b.z0 }, { x: b.x1, z: b.z1 }];
              for (const p of pts) {
                const lx = p.x - massingData.centre.x, lz = p.z - massingData.centre.z;
                if (lx < minX) minX = lx; if (lx > maxX) maxX = lx;
                if (lz < minZ) minZ = lz; if (lz > maxZ) maxZ = lz;
              }
            }
          }
          return { minX, maxX, minZ, maxZ };
        })();
        const polyCentroid = polygonCentroid(insetLocalPoly);
        const footprintCentre = {
          x: (footprintBBox.minX + footprintBBox.maxX) / 2,
          z: (footprintBBox.minZ + footprintBBox.maxZ) / 2,
        };
        // Growth pivots at the TRUE polygon's own centroid (fixed, not
        // scaled) rather than the footprint's own centre scaling away from
        // the origin — so a bigger building grows into the site's actual
        // widest area, not away from whatever point the site-rect fit
        // happened to centre it at.
        const cornersFit = (scale) => {
          const hw = (footprintBBox.maxX - footprintBBox.minX) / 2 * scale;
          const hd = (footprintBBox.maxZ - footprintBBox.minZ) / 2 * scale;
          const corners = [
            [polyCentroid.x - hw, polyCentroid.z - hd], [polyCentroid.x + hw, polyCentroid.z - hd],
            [polyCentroid.x + hw, polyCentroid.z + hd], [polyCentroid.x - hw, polyCentroid.z + hd],
          ];
          return corners.every(([x, z]) => pointInPolygon(x, z, insetLocalPoly));
        };
        if (Number.isFinite(footprintBBox.minX)) {
          // rawFit.scale/fit.scale (the site's own oriented bounding
          // RECTANGLE fit) is NOT a safe ceiling here: on a long, tapering,
          // non-rectangular site, the min-area rectangle around the whole
          // polygon can be narrow even though the polygon itself has plenty
          // of room to grow INTO near the building's fixed centre — so that
          // ceiling could cap the search far below what the true polygon
          // actually allows. Instead: exponentially grow a candidate scale
          // (doubling from 1) until it stops fitting the true polygon or
          // hits a sane cap, THEN bisect between the last-fitting and
          // first-failing values — finds the real limit regardless of the
          // site's rectangle shape.
          const GROWTH_CAP = 40;
          let lo = 0, hi = 1;
          if (cornersFit(1)) {
            lo = 1;
            hi = 2;
            while (hi < GROWTH_CAP && cornersFit(hi)) { lo = hi; hi *= 2; }
            hi = Math.min(hi, GROWTH_CAP);
            if (hi === GROWTH_CAP && cornersFit(hi)) lo = hi;
          }
          for (let i = 0; i < 24; i++) {
            const mid = (lo + hi) / 2;
            if (cornersFit(mid)) lo = mid; else hi = mid;
          }
          realRoomsExtraScale = lo;
        }
        // Bake the recentring into massingData.centre's real-rooms
        // counterpart: buildMassing renders each box at (box.coord - centre),
        // so subtracting (polyCentroid - footprintCentre) from centre shifts
        // the rendered footprint by exactly that vector, landing its own
        // centre on the true polygon's centroid.
        realRoomsRenderCentre = {
          x: massingData.centre.x - (polyCentroid.x - footprintCentre.x),
          z: massingData.centre.z - (polyCentroid.z - footprintCentre.z),
        };
      }
    }
    // Surface the applied scale back to the component so the header can
    // flag it — same "never hide a departure from real measured data"
    // convention as the `real:false` peach columns / CarbonBadge disclaimers
    // elsewhere in this file. 1 = true measured size (or Real Rooms is off).
    onRealRoomsScale?.(showRealRooms ? realRoomsExtraScale : 1);

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
    // Top-down (plan) view: camera straight overhead, no perspective/depth
    // ambiguity — added specifically so boundary-violation checks are
    // unambiguous (isometric occlusion made "is this box inside the real
    // polygon" genuinely hard to judge by eye, even when the underlying
    // coordinates are correct). North stays screen-up (no yaw), matching
    // how the site polygon/outline are already drawn in true geo-space.
    const camDist = frustumSize * 2;
    // User-directed: don't change the site's on-screen angle while
    // enhancing — a Real Rooms-only camera yaw (previously fit.angle + a
    // deliberate extra tilt, to make the real building read "straight") made
    // the whole view, site outline included, visibly rotate/jump the moment
    // Enhance was toggled. The camera now stays fixed regardless of
    // showRealRooms, so the site keeps the exact same angle on screen
    // whether Enhance is on or off — only the geometry inside changes.
    const camYawOffset = 0;
    if (topDown) {
      camera.position.set(fit.cx, camDist, fit.cz);
      camera.up.set(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), camYawOffset);
      camera.lookAt(fit.cx, 0, fit.cz);
    } else {
      const ISO_YAW   = Math.PI / 4 + camYawOffset;
      const ISO_PITCH = Math.atan(1 / Math.sqrt(2));
      camera.position.set(
        fit.cx + Math.sin(ISO_YAW) * Math.cos(ISO_PITCH) * camDist,
        Math.sin(ISO_PITCH) * camDist,
        fit.cz + Math.cos(ISO_YAW) * Math.cos(ISO_PITCH) * camDist
      );
      camera.lookAt(fit.cx, frustumSize * 0.14, fit.cz);
    }

    // No lights: every mesh uses an unlit MeshBasicMaterial, so lights and
    // their shadow maps would be pure GPU cost for zero visible change.

    // Parent group — scale, rotate, then translate (Three composes T*R*S,
    // so children defined in local space get scaled/rotated about the
    // origin first, then moved into place) to match the site rectangle.
    // fit.angle keeps the building genuinely fitted to the real site's own
    // minimum-area rectangle (siteFit.js) — dropping it (an earlier attempt)
    // decoupled the building from the site fit entirely and let it render
    // outside the real boundary. Always kept; see camYawOffset below for how
    // Real Rooms reads "straight" WITHOUT losing that fit. realRoomsExtraScale
    // (computed above, only for Real Rooms) adds a further real, metre-based
    // shrink so the building clears the TRUE site polygon, not just its
    // bounding rectangle.
    const worldGroup = new THREE.Group();
    const worldScale = fit.scale * realRoomsExtraScale;
    worldGroup.scale.set(worldScale, 1, worldScale);
    worldGroup.rotation.y = fit.angle;
    worldGroup.position.set(fit.cx, 0, fit.cz);
    scene.add(worldGroup);

    // Render the selected variation's per-block arrangement (iteration 0 is
    // the untouched real GLB floors; others are perturbed). Fall back to the
    // real floors if a variation somehow lacks them.
    const unclippedFloors = variation?.floors ?? massingData.floors;

    // Clip EVERY box type to the REAL site polygon (not just its bounding
    // rectangle) — a last-line-of-defence render-time check, independent of
    // whatever upstream source produced these boxes. This used to only clip
    // 'units' (community/services were assumed to be real, GLB-anchored
    // positions that should never move) — but community/services/entry/
    // circulation now come from the bubble-diagram layout (floorsFromBubble
    // Layout/siteGrid.js's clipBoxToBuildableBounds), and if THAT upstream
    // clip is ever bypassed (e.g. the massingData.floors fallback on line
    // 867, which has zero polygon awareness), a 'units'-only filter here let
    // an unclipped box straight through — that's what caused massing to
    // visibly render outside the real site boundary. Clipping every type
    // here closes that gap regardless of source. No-op when a box already
    // sits fully inside the polygon (the normal case for already-clipped
    // bubble boxes), so this only changes behavior for boxes that actually
    // cross the boundary.
    // This pass TRIMS rather than passes/drops. It used to filter with
    // footprintInsidePolygon, whose deliberately lenient "centre + 3 of 4
    // corners" rule let a box with one corner poking out render whole — the
    // visible overflow at a site's edge. That leniency existed when this was
    // the only clip and a strict test over-rejected real programme; the
    // buildable grid now guarantees containment upstream, so this can be
    // exact. Rebuilding the same grid here (rather than trusting the boxes)
    // keeps it a genuine last line of defence, independent of whatever
    // produced them — including the massingData.floors fallback below, which
    // has no polygon awareness of its own.
    const localSitePoly = siteToLocalPolygon(coords, cLat, cLng, fit);
    const renderGrid = localSitePoly
      ? largestConnectedRegion(rasterizeSitePolygon(
          insetPolygon(localSitePoly, BOUNDARY_SETBACK_M), GRID_CELL, localSitePoly))
      : null;
    // Only a box that actually crosses the boundary gets re-fragmented here
    // (clipBoxToGrid now leaves a fully-interior box untouched — see its own
    // comment) — but when a box IS trimmed, its new edge is grid-snapped
    // while its still-untouched neighbour isn't, so the pair can end up a
    // sliver short of matching. One more overlap pass over just this floor's
    // 'units' boxes closes that last, edge-only gap.
    const renderFloors = renderGrid
      ? resolveUnitOverlaps(unclippedFloors.map(fl => ({
          ...fl,
          boxes: fl.boxes.flatMap(b => clipBoxToGrid(renderGrid, {
            ...b,
            x0: b.x0 - massingData.centre.x, x1: b.x1 - massingData.centre.x,
            z0: b.z0 - massingData.centre.z, z1: b.z1 - massingData.centre.z,
          }).map(cb => ({
            ...cb,
            x0: cb.x0 + massingData.centre.x, x1: cb.x1 + massingData.centre.x,
            z0: cb.z0 + massingData.centre.z, z1: cb.z1 + massingData.centre.z,
          }))),
        })))
      : unclippedFloors;

    if (showRealRooms) {
      // Real rooms mode: bypass the procedural wing/zoning generator
      // entirely (briefLayouts/generateMassingIterations — the thing that
      // was producing the messy, incoherent box scatter) and render
      // massingData.floors AS EXTRACTED, unmodified. That data — programme
      // {Small,Medium,Large,Xl}.json — already IS the real per-room layout:
      // extractProgramme3/4.mjs read each room straight off the GLB's own
      // native mesh grouping (the source CAD export already grouped each
      // room's floor-plate fragments into one Group per room), not a
      // reconstruction from raw wall panels. This is "iteration 1", the real
      // baseline every generated variation perturbs away from — so showing
      // it directly is the real building, not an approximation of it.
      //
      // realRoomVariationId (1-9, see realRoomVariations.js) subdivides the
      // same real floors into real dwellings with a per-variation unit-mix
      // bias, and fuses one real vertically-stacked room pair into a
      // double-height 4-bed home on a low/mid/high floor band.
      // Reuses realVariantFloorsForFit (computed above, alongside
      // realRoomsExtraScale) rather than calling buildRealRoomVariation
      // again — same seeded inputs, so it's the identical result, just
      // without redoing the work.
      worldGroup.add(buildMassing(realVariantFloorsForFit, realRoomsRenderCentre, showColumns));
      // User-directed: Show columns should also work on the real building,
      // not just the procedural massing. Uses the SAME filterColumnsToFootprint/
      // buildColumnMarkers path as the procedural branch below, just pointed
      // at the real-room floors' own ground boxes/centre — x0/x1/z0/z1 stay
      // valid bounds even for a rotated/drifted box (transformBoxToOutline
      // updates them alongside `outline`), so the real edge-detection still
      // works; it just can't be as precise against a genuinely rotated wall
      // as it is against an axis-aligned one.
      if (showColumns) {
        const realGroundBoxes = realVariantFloorsForFit[0]?.boxes ?? [];
        const realTopY = realVariantFloorsForFit.length
          ? realVariantFloorsForFit[realVariantFloorsForFit.length - 1].y1
          : (massingData.floors[massingData.floors.length - 1]?.y1 ?? 4);
        const realColumns = buildColumnMarkers(
          buildingType, realTopY + 1.0, realGroundBoxes, realRoomsRenderCentre, null, realVariantFloorsForFit,
        );
        if (realColumns) worldGroup.add(realColumns);
      }
    } else if (showColumns) {
      // Show columns throughout the WHOLE building, not just resting on the
      // ground floor — every floor renders (x-ray, not solid) so a column
      // running past floor 3's units is exactly as visible as one at the
      // ground, and stays visible through every floor plate rather than
      // being hidden inside opaque massing.
      const groundBoxes = (renderFloors[0] ?? massingData.floors[0])?.boxes ?? [];
      worldGroup.add(buildMassing(renderFloors, massingData.centre, /* xray */ true));

      // (No longer drawing the fixed single-GLB envelope outline here: the
      // real ground-floor plate now legitimately extends beyond that fixed
      // envelope — see TARGET_SITE_COVERAGE — so it would render as a
      // stale, misleadingly-small box inside the real massing rather than
      // a useful reference.)

      // Real GLB columns, added into the SAME worldGroup so they inherit the
      // exact same scale/rotate/translate as the massing above them. Height
      // now runs the FULL building — filterColumnsToFootprint already only
      // keeps a column position that sits on a real box edge on EVERY floor
      // (see its own comment), so a column drawn full-height genuinely has
      // something to carry at every level it passes through, not just the
      // ground plate.
      const topY = renderFloors.length ? renderFloors[renderFloors.length - 1].y1
        : (massingData.floors[massingData.floors.length - 1]?.y1 ?? 4);
      const columnHeight = topY + 1.0;
      const columns = buildColumnMarkers(buildingType, columnHeight, groundBoxes, massingData.centre, variation?.columns, renderFloors);
      if (columns) worldGroup.add(columns);
    } else {
      worldGroup.add(buildMassing(renderFloors, massingData.centre, false));
    }

    // ── Site boundary outline — skipped entirely in Show Columns mode:
    // that view is about the structure, not the site context. Added to
    // scene (not worldGroup) so it stays in geo-north space, independent of
    // the building rotation, whenever it IS shown.
    // User-directed: real OSM road centrelines are no longer drawn at all —
    // at this scale they visibly cut straight across the massing/real rooms
    // (roads are recorded kerb-to-kerb across a whole junction, not clipped
    // to outside the site), reading as broken geometry rather than context.
    if (!showColumns) {
      const outline = buildSiteOutline(coords, cLat, cLng);
      if (outline) scene.add(outline);
    }

    // ── Ground plane (no map tiles — just the site) — white, matches scene bg
    const groundGeo = new THREE.PlaneGeometry(400, 400);
    const groundMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const ground    = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.1;
    scene.add(ground);

    // ── Controls ─────────────────────────────────────────────────────────────
    const controls = new OrbitControls(camera, renderer.domElement);
    // Target the SITE, not the world origin. OrbitControls defaults its target
    // to (0,0,0) and its first update() re-aims the camera at that target —
    // overriding the camera.lookAt(fit.cx, …, fit.cz) set above and leaving
    // the view off-axis. In plan mode that tilt is what made blocks appear to
    // cross the site outline even though the geometry is provably inside it
    // (the clip is verified at 0 violations across all 1,723 sites), because
    // a tilted "plan" view projects the tops of extruded blocks sideways past
    // the ground-level boundary line.
    controls.target.set(fit.cx, 0, fit.cz);
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
  }, [canvasRef, site, variation, buildingType, showColumns, roads, geoRef, topDown, showRealRooms, realRoomVariationId, onRealRoomsScale]);
}

export default function MassingStage({ site, buildingType, onBack, onContinue }) {
  const canvasRef = useRef(null);
  const massingData = useMemo(() => getMassingData(buildingType), [buildingType]);

  // A geoRef for useOsmContext's real road query — same bounding-box shape
  // SitePicker.jsx already builds (minLat/maxLat/minLng/maxLng/lngScale),
  // derived here directly from site.coords so this stage doesn't depend on
  // a prop thread from SitePicker's own (currently-dropped) geoRef state.
  const geoRef = useMemo(() => {
    const coords = site?.coords;
    if (!coords?.length) return null;
    const lats = coords.map(p => p[0]), lngs = coords.map(p => p[1]);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    return { minLat, maxLat, minLng, maxLng, lngScale: Math.cos(minLat * Math.PI / 180) };
  }, [site]);
  const { roads } = useOsmContext(geoRef);

  // How strongly each real site fact pulls on the layout. Driven by the
  // bubble diagram below the canvas; changing one re-solves the relaxation
  // and rebuilds the massing.
  const [factWeights, setFactWeights] = useState({ entry: 1, sun: 1 });
  // Live per-zone area multipliers, set by dragging a bubble bigger/smaller
  // in BubbleDiagram — the same mechanism PROGRAMME_BRIEFS uses (scaled()
  // above), just continuously adjustable instead of only 8 presets.
  const [zoneOverrides, setZoneOverrides] = useState({});
  // Live per-zone target positions (Frame L, same frame as localSitePoly/
  // graph.nodes), set by dragging a bubble sideways in BubbleDiagram. Fed
  // into relaxGraph as an extra biasForce (same mechanism entry/sun already
  // use — see floorsFromBubbleLayout) so a moved bubble is a real preference
  // the relaxation settles toward, not a teleport that could overlap another
  // zone or leave the site polygon.
  const [positionOverrides, setPositionOverrides] = useState({});
  // Live per-bed-count weight multiplier, nudged from the Unit mix control
  // in the metrics panel below. Same "reweight, never fabricate" mechanism
  // as zoneOverrides/positionOverrides — see dwellings.js's
  // applyMixOverrides: it changes which real typologies get picked out of
  // the SAME real floorplate area, so pushing toward bigger homes reduces
  // dwelling count rather than inventing floor area.
  const [mixOverrides, setMixOverrides] = useState({});
  // Massing STYLE archetype (slab/point-tower/perimeter-block/stepped/comb)
  // and an explicit wing-count override — both live controls surfaced in the
  // Massing toolbar and the bubble diagram, driving floorsFromBubbleLayout's
  // wing count/seeding exactly like a bubble drag drives zoneOverrides/
  // positionOverrides. null override means "let the style pick its own count"
  // (see wingCountForStyle).
  const [massingStyle, setMassingStyle] = useState(DEFAULT_MASSING_STYLE);
  const [wingCountOverride, setWingCountOverride] = useState(null);
  // Switching style resets any explicit wing-count override — the new style's
  // own default (wingCountForStyle) should apply first; the user can then
  // fine-tune it again with +/-, rather than carrying over a count picked
  // for a different archetype.
  const handleStyleChange = (key) => { setMassingStyle(key); setWingCountOverride(null); };

  // These four are the ones a continuous drag (bubble reposition/resize, unit
  // -mix slider) hammers with dozens of updates per second — debounce just
  // these before they reach the heavy relax/subdivide pipeline below. Style
  // and wing-count changes are discrete clicks, not drags, so they stay live.
  const factWeightsD = useDebouncedValue(factWeights, 120);
  const zoneOverridesD = useDebouncedValue(zoneOverrides, 120);
  const positionOverridesD = useDebouncedValue(positionOverrides, 120);
  const mixOverridesD = useDebouncedValue(mixOverrides, 120);

  // One FULL layout per programme brief — each re-runs the whole bubble
  // relaxation + area-budgeted cell assignment, so the variations differ in
  // how the real programme is distributed and arranged, not just in how one
  // fixed set of boxes was shuffled afterwards.
  const briefLayouts = useMemo(
    () => PROGRAMME_BRIEFS.map(brief => ({
      brief,
      ...floorsFromBubbleLayout(massingData.floors, buildingType, site, roads, geoRef, massingData.centre, brief, factWeightsD, zoneOverridesD, positionOverridesD, mixOverridesD, massingStyle, wingCountOverride),
    })),
    [massingData, buildingType, site, roads, geoRef, factWeightsD, zoneOverridesD, positionOverridesD, mixOverridesD, massingStyle, wingCountOverride]
  );
  const iterations = useMemo(
    () => generateMassingIterations(MASSING_ITERATION_COUNT, briefLayouts, buildingType, mixOverridesD, massingStyle),
    [briefLayouts, buildingType, mixOverridesD, massingStyle]
  );
  const [iterIdx, setIterIdx] = useState(0);
  useEffect(() => { setIterIdx(0); }, [massingData]);
  const variation = iterations[iterIdx];
  // Show the diagram for the brief actually on screen, so the bubbles match
  // the massing being looked at rather than always the baseline layout.
  const activeDiagram = useMemo(() => (
    briefLayouts.find(bl => bl.brief.key === variation?.brief)?.diagram
      ?? briefLayouts[0]?.diagram
  ), [briefLayouts, variation]);
  const [topDown, setTopDown] = useState(false);
  // Live column-grid overlay, toggleable right here in Massing — previously
  // the real structural grid only became visible after committing to the
  // separate Columns stage. Each iteration/brief already carries its own
  // real column set (generateMassingIterations' `.columns`, same field
  // ColumnPlacementStage reads), so this is the SAME useMassingViewer path
  // Columns uses, just flipped on in place — you see how a bubble drag or
  // style change actually drives the structural grid before ever leaving
  // this screen.
  const [showColumns, setShowColumns] = useState(false);
  // Real rooms: swaps the procedurally-generated variation (briefLayouts/
  // generateMassingIterations) for massingData.floors AS EXTRACTED — the
  // real per-room programme{Small,Medium,Large,Xl}.json data, read straight
  // off each room's own native mesh group in the source GLB.
  const [showRealRooms, setShowRealRooms] = useState(false);
  // 0-9, see realRoomVariations.js — which real-room deconstruction to
  // render; only meaningful while showRealRooms is on. Defaults to 0 — the
  // real building exactly as extracted, undeformed — so turning Real Rooms
  // on shows the actual real building first, not an already-twisted one.
  const [realRoomVariationId, setRealRoomVariationId] = useState(0);
  // User-directed: Real Rooms mode deliberately inflates the real building
  // beyond its true measured size on sites much bigger than it, to fill the
  // plot. 1 = true measured size; > 1 = how many times bigger than real the
  // building is currently being shown, set by useMassingViewer's effect
  // (which does the actual site-polygon-fit search) so the header can flag
  // it honestly rather than silently rendering an inflated building.
  const [realRoomsAppliedScale, setRealRoomsAppliedScale] = useState(1);
  useMassingViewer(canvasRef, site, variation, buildingType, showColumns, roads, geoRef, topDown, showRealRooms, realRoomVariationId, setRealRoomsAppliedScale);
  // For the header only — the SAME computation useMassingViewer's effect
  // does internally to build the 3D scene, so the header's floor/dwelling
  // counts actually match what's on screen in real-rooms mode (a double-
  // height variation is genuinely one storey taller — see
  // realRoomVariations.js's insertRepeatedFloor).
  const realRoomVariantFloors = useMemo(
    () => (showRealRooms ? buildRealRoomVariation(massingData.floors, realRoomVariationId) : null),
    [showRealRooms, massingData, realRoomVariationId]
  );

  // Header count must be the DWELLINGS on screen, not the raw GLB's `units`
  // box count — those boxes are floorplate fragments, so the header read "38
  // units" while the variation actually contained 58 homes.

  // Real structural volume for the carbon tracker — sum of actual 'units'
  // box dimensions (x1-x0)*(y1-y0)*(z1-z0) across every floor, in metres³.
  // Must come from `variation.floors` (the massing actually on screen), not
  // `massingData.floors` (the static per-class GLB baseline) — the baseline
  // can legitimately have zero 'units'-typed boxes for some classes even
  // while the on-screen variation has dozens of real dwellings, which made
  // CarbonBadge's compareByVolume(0) silently return null and the whole
  // Embodied Carbon panel vanish (real bug, found live on the Medium class).
  const structuralVolumeM3 = variation.floors.reduce((s, f) =>
    s + f.boxes.filter(b => b.type === 'units')
      .reduce((bs, b) => bs + (b.x1 - b.x0) * (b.y1 - b.y0) * (b.z1 - b.z0), 0)
  , 0);

  // Per-VARIATION unit count and GIA (gross internal area, ground-floor
  // footprint) — real, computed from this specific iteration's own boxes
  // (variation.floors), not the static baseline. fillScore/coreScore/
  // overlapScore already come from scoreMassingLayout() (see above) — this
  // just makes them legible as an actual comparison table instead of a
  // single folded-in 0-100 number, so picking a variation is a real,
  // inspectable structural decision rather than "pick the prettiest one".
  // Real DWELLINGS, not floorplate fragments. This used to count `units`
  // BOXES — but a box out of the cell grid is a piece of floorplate (78–107 m²
  // on the small class), not an apartment, so the figure understated the
  // building's real home count and meant nothing architecturally. dwellings.js
  // subdivides those plates into 1B/2B/3B/4B homes at their real measured
  // areas, and this counts those.
  const variationUnits = countDwellings(variation.floors);
  const { mix: bedMix, penthouses: penthouseCount } = dwellingMix(variation.floors);
  const mixLabel = [1, 2, 3, 4]
    .filter(n => bedMix[n] > 0)
    .map(n => `${bedMix[n]}×${n}B`)
    .join('  ') || '—';
  // Total residential GIA across EVERY floor — this was previously labelled
  // "GIA (ground floor)", which made a healthy 6-storey figure read as an
  // impossible ground-floor one (3,609 m² looked like 2.4x the site when it
  // is really ~600 m² per floor on a 3,478 m² plot). The number was right;
  // only the label was wrong.
  const variationGiaM2 = variation.floors.reduce((s, f) =>
    s + f.boxes.filter(b => b.type === 'units').reduce((bs, b) => bs + realBoxArea(b), 0)
  , 0);
  // Real target to compare variationUnits against — not invented, and not
  // borrowed from an unrelated building. classGeometry(buildingType) is the
  // SAME real GLB precedent already hard-locked to this site's class (see
  // buildingClasses.js's SITE_CLASS/CLASS_REGISTRY — the same source Columns
  // reads its structural grid from). Its measured unitCountEstimate /
  // (footprintAreaM2 * floorCount) is a real units-per-m²-of-GIA density;
  // scaling that by THIS variation's own real GIA gives an honest expected
  // count to show alongside the actual one, without touching how dwellings.js
  // slices dwellings (which stays area-driven, never count-driven).
  const precedentClass = classGeometry(buildingType || 'medium');
  const precedentTargetUnits = (precedentClass?.unitCountEstimate && precedentClass?.footprintAreaM2 && precedentClass?.floorCount)
    ? Math.round((precedentClass.unitCountEstimate / (precedentClass.footprintAreaM2 * precedentClass.floorCount)) * variationGiaM2)
    : null;
  // Export (JSON + 3D/OBJ) — same downloadRhinoExport ColumnPlacementStage
  // uses, wired in here too so whatever's actually on screen can be taken
  // out of the browser without first continuing to the Columns stage.
  // User-directed: this used to always export the PROCEDURAL massing
  // (variation.floors), even while Real Rooms was the thing actually being
  // looked at — the export and the screen could show two different
  // buildings. Now branches on showRealRooms so Export always matches what's
  // rendered.
  // filterColumnsToFootprint/columnRunsToFootprint return positions in LOCAL
  // (centre-subtracted) space — the same frame buildMassing/buildColumnMarkers
  // use for on-screen rendering, where a shared worldGroup transform re-projects
  // everything back to the real site together. Export has no such shared
  // transform: floors are written out in their own raw/world coordinates, so a
  // column list passed through unchanged would land ~massingData.centre metres
  // away from the building it's supposed to sit under. Re-adding centre here
  // converts back to the same world frame the floors are already in — verified
  // live: before this, an exported column sat near (‑5, 0) while its floor sat
  // near (355, 175), a few hundred metres apart in the same file.
  const toWorldColumns = (localColumns, centre) =>
    (localColumns ?? []).map(c => ({ ...c, x: c.x + centre.x, z: c.z + centre.z }));

  const handleExportMassing = () => {
    if (showRealRooms) {
      // Real Rooms floors always carry a real `outline` polygon per box
      // (realRoomVariations.js's transformBoxToOutline, a no-op rotation for
      // Variation 0) — rhinoExport.js's payload/OBJ builders already branch
      // on b.outline (prismToObjFaces vs boxToObjFaces), so no export-format
      // changes were needed, just pointing it at the real-rooms floors.
      // Columns: now computed the SAME outline-aware way "Show columns"
      // renders them live (see extendColumnsAlongBoxEdges/pointInBoxShape),
      // so a rotated/drifted variation (1-9) still gets columns that follow
      // its actual walls rather than an axis-aligned guess — only exported
      // when Show Columns is actually on, so the file never claims structure
      // the user never saw on screen.
      const floors = realRoomVariantFloors ?? massingData.floors;
      const realGroundBoxes = floors[0]?.boxes ?? [];
      const realColumns = showColumns
        ? toWorldColumns(filterColumnsToFootprint(buildingType, realGroundBoxes, massingData.centre, floors), massingData.centre)
        : [];
      downloadRhinoExport({
        siteId: site?.id,
        siteName: `${site?.name ?? buildingType} real-rooms-v${realRoomVariationId}`,
        buildingType,
        floors,
        envelope: realEnvelopeForClass(buildingType),
        columnPositions: realColumns,
        columnDims: realColumnDimsForClass(buildingType),
        designRules: CLASS_REGISTRY[buildingType]?.designRules ?? null,
      });
      return;
    }
    // Procedural massing — recomputes the exact same filtered column set
    // buildColumnMarkers renders for showColumns (variation.columns when
    // present, else the live filterColumnsToFootprint fallback), so the
    // export can never diverge from what's actually visible.
    const groundBoxes = (variation.floors[0] ?? massingData.floors[0])?.boxes ?? [];
    const exportColumns = toWorldColumns(
      variation?.columns ?? filterColumnsToFootprint(buildingType, groundBoxes, massingData.centre, variation.floors),
      massingData.centre,
    );
    downloadRhinoExport({
      siteId: site?.id,
      siteName: site?.name,
      buildingType,
      floors: variation.floors,
      envelope: realEnvelopeForClass(buildingType),
      columnPositions: exportColumns,
      columnDims: realColumnDimsForClass(buildingType),
      designRules: CLASS_REGISTRY[buildingType]?.designRules ?? null,
    });
  };
  const groundUnitsM2 = (variation.floors[0]?.boxes ?? [])
    .filter(b => b.type === 'units')
    .reduce((s, b) => s + realBoxArea(b), 0);
  // Real ground-floor green(community)/units footprint ratio — a FACT read
  // off this variation's own geometry, not a target: no cited planning ratio
  // exists in this codebase to compare against (the 0.30/0.10 figures used
  // internally by scoreZoningBoxes/computeGreenUnitsScore are hand-tuned
  // scoring inputs, not sourced regulatory targets), so this is presented as
  // "what the current layout has", not "what it should have".
  const groundFloor = variation.floors[0];
  const variationGreenM2 = groundFloor?.boxes.filter(b => b.type === 'greenpatch')
    .reduce((s, b) => s + realBoxArea(b), 0) ?? 0;
  // Compare ground-floor green against GROUND-FLOOR units. It previously
  // divided by GIA across all floors, so a 6-storey building reported ~1/6th
  // of its real ratio (Kensington showed 1-3% where its measured ground floor
  // is 80 m² green to 857 m² units = 9.4%).
  const greenUnitsRatioPct = groundUnitsM2 > 0 ? (variationGreenM2 / groundUnitsM2) * 100 : 0;

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      {/* Header — same pattern as SiteMassingView/ZoningPlan/GLBSiteView */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        padding: '0.85rem 1.1rem',
        borderBottom: '1px solid rgba(20,20,15,0.08)',
        flexShrink: 0,
        background: 'var(--bg-glass)',
        backdropFilter: 'blur(12px)',
      }}>
        <button onClick={onBack} style={{
          background: 'none', border: '1px solid rgba(20,20,15,0.18)',
          color: 'rgba(20,20,15,0.7)', fontFamily: 'var(--mono)',
          fontSize: '0.7rem', padding: '0.35rem 0.7rem', cursor: 'pointer',
          letterSpacing: '0.05em',
        }}>← Site</button>

        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.08rem' }}>
          <span style={{ fontSize: '0.58rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(20,20,15,0.3)' }}>
            03 / Massing
          </span>
          <span style={{ fontSize: '0.8rem', color: 'var(--fg)', fontWeight: 400 }}>
            {massingData.label} · {realRoomVariantFloors ? realRoomVariantFloors.length : variation.floors.length} floors
            · {realRoomVariantFloors ? countDwellings(realRoomVariantFloors) : variationUnits} dwellings
            <span style={{ color: 'rgba(20,20,15,0.38)', fontSize: '0.72rem' }}> · {topDown ? 'plan' : 'isometric'} · scroll to zoom</span>
          </span>
          {showRealRooms && realRoomsAppliedScale > 1.03 && (
            <span
              title="This site is much bigger than the real building, so it's being shown scaled up to fill the plot — the rooms are no longer at their true measured size. Turn this off by design, not a bug: it was an explicit request to visually fill the site."
              style={{ fontSize: '0.62rem', color: '#b4622a', fontWeight: 600 }}
            >
              ⚠ scaled {realRoomsAppliedScale.toFixed(1)}× to fill site — not true measured size
            </span>
          )}
        </div>

        {/* Iteration stepper — 10 scored massing variations, ranked by
            site-orientation fit and green/units ratio. #0 (index 0 after
            sort) is the exact optimal fit to the real site. */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          border: '1px solid rgba(20,20,15,0.14)', padding: '0.3rem 0.6rem',
        }}>
          <button
            onClick={() => setIterIdx(i => Math.max(0, i - 1))}
            disabled={iterIdx === 0}
            style={{
              background: 'none', border: 'none', cursor: iterIdx === 0 ? 'default' : 'pointer',
              color: iterIdx === 0 ? 'rgba(20,20,15,0.2)' : 'var(--fg)', fontSize: '0.7rem',
              fontFamily: 'var(--mono)',
            }}
          >←</button>
          <div style={{ textAlign: 'center', minWidth: 150 }}>
            <div style={{ fontSize: '0.6rem', letterSpacing: '0.06em', color: 'var(--fg)', fontWeight: 700 }}>
              {variation.briefLabel
                ? variation.briefLabel.toUpperCase()
                : `VARIATION ${iterIdx + 1} / ${iterations.length}`}
            </div>
            <div style={{ fontSize: '0.54rem', color: 'rgba(20,20,15,0.45)' }}>
              {iterIdx + 1}/{iterations.length} · score {variation.score.toFixed(1)}{iterIdx === 0 ? ' · best' : ''}
            </div>
          </div>
          <button
            onClick={() => setIterIdx(i => Math.min(iterations.length - 1, i + 1))}
            disabled={iterIdx === iterations.length - 1}
            style={{
              background: 'none', border: 'none',
              cursor: iterIdx === iterations.length - 1 ? 'default' : 'pointer',
              color: iterIdx === iterations.length - 1 ? 'rgba(20,20,15,0.2)' : 'var(--fg)', fontSize: '0.7rem',
              fontFamily: 'var(--mono)',
            }}
          >→</button>
        </div>

        {/* Step trail — Columns was folded into this stage as a live toggle
            (see the "Show columns" button below). Sustainability sits between
            Massing and Import, comparing this massing's cast stone vs.
            concrete footprint before the Rhino/GLB handoff stage. */}
        {['Site', 'Massing', 'Sustainability', 'Import'].map((s, i) => (
          <div key={s} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            {i > 0 && <div style={{ width: 16, height: 1, background: 'rgba(20,20,15,0.1)' }} />}
            <span style={{
              fontSize: '0.57rem', letterSpacing: '0.08em', textTransform: 'uppercase',
              color: i === 1 ? 'var(--accent)' : 'rgba(20,20,15,0.22)',
              fontWeight: i === 1 ? 700 : 400,
              borderBottom: i === 1 ? '1px solid var(--accent)' : 'none',
              paddingBottom: i === 1 ? '1px' : '0',
            }}>{s}</span>
          </div>
        ))}

        <button
          onClick={() => onContinue?.(variation, { structuralVolumeM3, variationUnits, floorCount: variation.floors.length })}
          style={{
            background: 'var(--accent)', color: 'var(--bg)', border: 'none',
            fontFamily: 'var(--mono)',
            fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.1em',
            padding: '0.5rem 1rem', cursor: 'pointer', textTransform: 'uppercase',
          }}>Sustainability →</button>
      </div>

      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <canvas
          ref={canvasRef}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
        />

        {/* View toggle — isometric (default) vs. straight top-down plan.
            Top-down removes all perspective/depth ambiguity, so it's the
            reliable way to check "does this box actually stay inside the
            real site boundary" by eye, without isometric occlusion making a
            correctly-placed box look like it crosses a line that's really
            behind/in front of it. */}
        <div style={{ position: 'absolute', top: 16, left: 16, zIndex: 10, display: 'flex', gap: '0.4rem' }}>
          <button
            onClick={() => setTopDown(v => !v)}
            style={{
              background: topDown ? 'var(--accent)' : 'var(--bg-glass)',
              color: topDown ? 'var(--bg)' : 'var(--fg)',
              border: '1px solid rgba(20,20,15,0.14)',
              fontFamily: 'var(--mono)', fontSize: '0.65rem', fontWeight: 700,
              letterSpacing: '0.06em', padding: '0.4rem 0.7rem', cursor: 'pointer',
              textTransform: 'uppercase', backdropFilter: 'blur(8px)',
            }}
          >{topDown ? '⬒ Plan view' : '◇ Isometric'}</button>
          <button
            onClick={() => setShowColumns(v => !v)}
            title="Overlay the real structural column grid for this variation, live as you edit"
            style={{
              background: showColumns ? 'var(--accent)' : 'var(--bg-glass)',
              color: showColumns ? 'var(--bg)' : 'var(--fg)',
              border: '1px solid rgba(20,20,15,0.14)',
              fontFamily: 'var(--mono)', fontSize: '0.65rem', fontWeight: 700,
              letterSpacing: '0.06em', padding: '0.4rem 0.7rem', cursor: 'pointer',
              textTransform: 'uppercase', backdropFilter: 'blur(8px)',
            }}
          >{showColumns ? '⏹ Hide columns' : '⏹ Show columns'}</button>
          <button
            onClick={handleExportMassing}
            title={showRealRooms
              ? `Download the real building currently shown (this variation's real rooms/dwellings, exact measured geometry) as JSON (full data, Grasshopper-ready), OBJ, and GLB (open directly in Rhino, Blender, or any 3D app).${showColumns ? ' Includes the real structural column grid, fitted to this variation.' : ' Turn on Show Columns to include the structural grid too.'}`
              : "Download this massing + real structural column grid as JSON (full data, Grasshopper-ready), OBJ, and GLB (open directly in Rhino, Blender, or any 3D app)"}
            style={{
              background: 'var(--bg-glass)',
              color: 'var(--fg)',
              border: '1px solid rgba(20,20,15,0.14)',
              fontFamily: 'var(--mono)', fontSize: '0.65rem', fontWeight: 700,
              letterSpacing: '0.06em', padding: '0.4rem 0.7rem', cursor: 'pointer',
              textTransform: 'uppercase', backdropFilter: 'blur(8px)',
            }}
          >⬇ Export (JSON + OBJ + GLB)</button>
          {/* Enhanced to London Context — its own visually distinct
              subsection (accent border + caption), not just another button
              in the row, since this is a major mode switch (real measured
              GLB geometry, fitted/enhanced to this actual London site) —
              not a minor view option like Plan/Isometric. Renamed from
              "Real rooms" per user direction. */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.4rem',
            border: `1px solid ${showRealRooms ? 'var(--accent)' : 'rgba(20,20,15,0.14)'}`,
            padding: '0.25rem 0.4rem 0.25rem 0.6rem',
            background: 'var(--bg-glass)', backdropFilter: 'blur(8px)',
          }}>
            <span style={{
              fontSize: '0.5rem', letterSpacing: '0.08em', textTransform: 'uppercase',
              color: 'rgba(20,20,15,0.4)', fontFamily: 'var(--mono)', fontWeight: 700,
            }}>London Context</span>
            <button
              onClick={() => setShowRealRooms(v => !v)}
              title="Swap the procedural unit-cell massing for the actual room polygons traced from this class's real GLB wall geometry, fitted to this real London site — real rooms at their real positions, not a generated approximation"
              style={{
                background: showRealRooms ? 'var(--accent)' : 'transparent',
                color: showRealRooms ? 'var(--bg)' : 'var(--fg)',
                border: '1px solid rgba(20,20,15,0.14)',
                fontFamily: 'var(--mono)', fontSize: '0.65rem', fontWeight: 700,
                letterSpacing: '0.06em', padding: '0.4rem 0.7rem', cursor: 'pointer',
                textTransform: 'uppercase',
              }}
            >{showRealRooms ? '⏹ Enhanced' : '⏹ Enhance'}</button>
            {showRealRooms && (
              <select
                value={realRoomVariationId}
                onChange={(e) => setRealRoomVariationId(Number(e.target.value))}
                title="Variation 0 is the real building exactly as extracted, undeformed. 1-9 are deconstructed-stacking variations (real room sizes, rotated/drifted floor-to-floor), each capped to stay within the real building's own footprint on this site."
                style={{
                  background: 'transparent', color: 'var(--fg)',
                  border: '1px solid rgba(20,20,15,0.14)',
                  fontFamily: 'var(--mono)', fontSize: '0.65rem', fontWeight: 700,
                  letterSpacing: '0.06em', padding: '0.4rem 0.5rem', cursor: 'pointer',
                  textTransform: 'uppercase',
                }}
              >
                {REAL_ROOM_VARIATIONS.map(v => (
                  <option key={v.id} value={v.id}>{v.id === 0 ? 'Variation 0 (Real)' : `Variation ${v.id}`}</option>
                ))}
              </select>
            )}
          </div>
          <select
            value={massingStyle}
            onChange={(e) => handleStyleChange(e.target.value)}
            title="Massing style archetype — changes how the housing mass is spatially arranged (real wing count/placement, not a cosmetic filter)"
            style={{
              background: 'var(--bg-glass)', color: 'var(--fg)',
              border: '1px solid rgba(20,20,15,0.14)',
              fontFamily: 'var(--mono)', fontSize: '0.65rem', fontWeight: 700,
              letterSpacing: '0.06em', padding: '0.4rem 0.5rem', cursor: 'pointer',
              textTransform: 'uppercase', backdropFilter: 'blur(8px)',
            }}
          >
            {MASSING_STYLES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.3rem',
            background: 'var(--bg-glass)', border: '1px solid rgba(20,20,15,0.14)',
            padding: '0.1rem 0.3rem', backdropFilter: 'blur(8px)',
          }}>
            <button
              onClick={() => setWingCountOverride(Math.max(1, (activeDiagram?.wings?.length ?? 1) - 1))}
              title="Fewer wings"
              style={{
                background: 'transparent', color: 'var(--fg)', border: 'none',
                fontFamily: 'var(--mono)', fontSize: '0.75rem', fontWeight: 700,
                padding: '0.3rem 0.4rem', cursor: 'pointer',
              }}
            >−</button>
            <span style={{
              fontFamily: 'var(--mono)', fontSize: '0.65rem', fontWeight: 700,
              letterSpacing: '0.06em', color: 'var(--fg)', minWidth: '4.5em', textAlign: 'center',
            }}>{activeDiagram?.wings?.length ?? 1} WING{(activeDiagram?.wings?.length ?? 1) === 1 ? '' : 'S'}</span>
            <button
              onClick={() => setWingCountOverride(Math.min(8, (activeDiagram?.wings?.length ?? 1) + 1))}
              title="More wings"
              style={{
                background: 'transparent', color: 'var(--fg)', border: 'none',
                fontFamily: 'var(--mono)', fontSize: '0.75rem', fontWeight: 700,
                padding: '0.3rem 0.4rem', cursor: 'pointer',
              }}
            >+</button>
          </div>
        </div>

        {/* Legend */}
        <div style={{
          position: 'absolute', bottom: 24, left: 24, zIndex: 10,
          background: 'var(--bg-glass)', border: '1px solid rgba(20,20,15,0.08)',
          padding: '0.75rem 1rem',
          backdropFilter: 'blur(8px)',
          fontFamily: 'var(--mono)', fontSize: '10px',
          lineHeight: 2.2, pointerEvents: 'none',
        }}>
          {[
            { label: '1 Bed',                 color: BED_PALETTE[1].face },
            { label: '2 Bed',                 color: BED_PALETTE[2].face },
            { label: '3 Bed',                 color: BED_PALETTE[3].face },
            { label: '4 Bed / Penthouse',     color: BED_PALETTE[4].face },
            { label: 'Services / Core',       color: '#d4a96a' },
            { label: 'Stair core (est.)',     color: PALETTE.core_stair.face },
            { label: 'Lift core (est.)',      color: PALETTE.core_lift.face },
            { label: 'Circulation (corridor)', color: PALETTE.circulation.face },
            { label: 'Community / Podium',    color: '#5b9fd4' },
            { label: 'Site Boundary',         color: '#78c8a4' },
          ].map(({ label, color }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: 10, height: 10, background: color, flexShrink: 0 }} />
              <span style={{ color: '#7a7570' }}>{label}</span>
            </div>
          ))}
        </div>

        {/* Right-side panel stack — variation metrics + carbon badge used to
            be two independently absolute-positioned boxes (one anchored
            top-right, one bottom-right), which overlapped into an
            unreadable mess on shorter viewports since neither knew how tall
            the other was. Now a single flex column bounded to the available
            height, so the two pieces stack in order and the whole stack
            scrolls internally instead of ever colliding with anything. */}
        <div style={{
          position: 'absolute', top: 24, right: 24, bottom: 24, zIndex: 10,
          display: 'flex', flexDirection: 'column', gap: '0.75rem',
          alignItems: 'flex-end', overflowY: 'auto', maxWidth: 260,
        }}>
          {/* Variation comparison readout — real per-iteration metrics (fill/
              core/overlap already computed by scoreMassingLayout for every
              iteration; unit count + GIA computed here from this variation's
              own boxes) so switching variations is a legible structural
              comparison, not just a different-looking picture. */}
          <div style={{
            background: 'var(--bg-glass)', border: '1px solid rgba(20,20,15,0.08)',
            padding: '0.75rem 1rem', backdropFilter: 'blur(8px)',
            fontFamily: 'var(--mono)', fontSize: '10px', minWidth: 180, width: '100%',
            flexShrink: 0,
          }}>
            <div style={{ letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(20,20,15,0.35)', marginBottom: '0.5rem' }}>
              Variation {iterIdx + 1} metrics
            </div>
            {[
              ['Floors', variation.floors.length],
              ['Dwellings', precedentTargetUnits ? `${variationUnits}  (precedent: ~${precedentTargetUnits})` : variationUnits],
              ['Penthouses (2× height)', penthouseCount],
              ['Residential GIA (all floors)', `${variationGiaM2.toFixed(0)} m²`],
              ['Ground-floor units', `${groundUnitsM2.toFixed(0)} m²`],
              ['Green:units ratio', `${greenUnitsRatioPct.toFixed(0)}%`],
              ['Footprint fill', `${variation.fillScore.toFixed(0)}%`],
              ['Core centrality', `${variation.coreScore.toFixed(0)}%`],
              ['Overlap penalty', `${(100 - variation.overlapScore).toFixed(0)}%`],
            ].map(([label, val]) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', color: '#7a7570', lineHeight: 1.9 }}>
                <span>{label}</span><span style={{ color: 'var(--fg)' }}>{val}</span>
              </div>
            ))}
            <div style={{ fontSize: '9px', color: 'rgba(20,20,15,0.32)', marginTop: '0.4rem', lineHeight: 1.5 }}>
              Green:units is this layout's real ground-floor ratio — no cited planning target exists in-app to compare it against.
            </div>

            {/* Live unit-mix control — nudges which real typologies get picked
                when slicing floorplate (dwellings.js's applyMixOverrides).
                Never invents floor area: the same real box area is filled,
                just with a different bed-count bias, so pushing toward bigger
                homes reduces dwelling count rather than growing the building. */}
            <div style={{ marginTop: '0.6rem', paddingTop: '0.5rem', borderTop: '1px solid rgba(20,20,15,0.08)' }}>
              <div style={{ color: '#7a7570', marginBottom: '0.35rem' }}>Unit mix — {mixLabel}</div>
              {[1, 2, 3, 4].map((beds) => (
                <div key={beds} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                  <span style={{ minWidth: 16, color: 'var(--fg)', fontWeight: 700 }}>{beds}B</span>
                  <input
                    type="range" min={5} max={800} step={5}
                    value={Math.round((mixOverrides[beds] ?? 1) * 100)}
                    onChange={(e) => setMixOverrides({ ...mixOverrides, [beds]: Number(e.target.value) / 100 })}
                    onDoubleClick={() => {
                      const next = { ...mixOverrides };
                      delete next[beds];
                      setMixOverrides(next);
                    }}
                    style={{ flex: 1, accentColor: 'var(--accent)', cursor: 'pointer' }}
                  />
                  <span style={{ minWidth: 24, textAlign: 'right', color: 'var(--fg)' }}>{bedMix[beds]}</span>
                </div>
              ))}
              <div style={{ fontSize: '9px', color: 'rgba(20,20,15,0.32)', lineHeight: 1.5 }}>
                Weight toward a bed count — same real floorplate area, different mix. Double-click a slider to reset.
              </div>
            </div>
          </div>

          {/* Carbon tracker — cast stone vs. traditional concrete, computed from
              this massing's REAL box volumes (more precise than Zoning's GIA
              estimate; still not a real BOM weight, see src/shared/carbonTracker.js) */}
          <div style={{ flexShrink: 0 }}>
            <CarbonBadge volumeM3={structuralVolumeM3} />
          </div>
        </div>
      </div>

      {/* Bubble diagram — the real relaxed zone graph the massing above is
          built from, plus the site facts driving it. Adjusting a fact's
          influence re-solves the relaxation and rebuilds the 3D massing. */}
      <BubbleDiagram
        diagram={activeDiagram}
        weights={factWeights}
        onWeightsChange={setFactWeights}
        zoneOverrides={zoneOverrides}
        onZoneOverridesChange={setZoneOverrides}
        positionOverrides={positionOverrides}
        onPositionOverridesChange={setPositionOverrides}
      />
    </div>
  );
}
