import { useRef, useMemo, useEffect, useState, useCallback, Component } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { TYPOLOGY_MAP } from './masterplanGenerator';
import { phaseAtWeek } from './buildSequencer';
import { useOsmContext } from './useOsmContext';

// Mutable: synced to plan.cellSize at the top of MasterplanViewer's render,
// before any child component reads it. masterplanGenerator.js grows cellSize
// above 2.0m on very large/wide sites (>720m) to cap the grid at 360x360
// cells — if this stayed hardcoded at 2.0 here, the viewer's camera/building
// world-space math would disagree with the generator's, and the scene would
// render completely off-camera (a silent black canvas) on any site that
// large. Every one of this file's many CELL usages reads this same binding.
let CELL   = 2.0;
const FLOOR_H = 3.2;

const GLB_PATHS = [
  '/ROOM1.glb', '/ROOM2.glb', '/ROOM3.glb', '/ROOM4.glb',
  '/ROOM5.glb', '/ROOM6.glb', '/ROOM7.glb', '/ROOM8.glb',
];
const TYPO_GLB_INDEX = {
  '1b1p': 0, '1b2p': 1, '2b3p': 2, '2b4p': 3,
  '3b4p': 4, '3b5p': 5, '4b5p': 6, '4b8p': 7,
};

// ─── Shared geometry primitives ───────────────────────────────────
const BOX1    = new THREE.BoxGeometry(1, 1, 1);
const SPHERE1 = new THREE.SphereGeometry(1, 7, 5);

// Unit-cube wireframe (12 edges) — baked per-instance into one merged buffer
// per floor band so every massing box gets a crisp white outline at a cost of
// one draw call per band, NOT one object per box (which would lag big sites).
const BOX1_EDGES = new THREE.EdgesGeometry(BOX1);
// Soft white edge — the reference's defining "study-model" line quality.
const EDGE_MAT = new THREE.LineBasicMaterial({
  color: '#ffffff', transparent: true, opacity: 0.55,
});

// ─── Material palette — white architectural model on black, BIG-style ──────
const mk = (color, rough, metal, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });

// Building body — lavender/purple study-model massing, graduating
// deeper-to-lighter so height reads as depth against the black void.
// Matches the reference render's clean monochrome-purple volume.
const MAT_BODY_0  = mk('#9d96b8', 0.55, 0.04); // ground floor — deepest lavender
const MAT_BODY_1  = mk('#aaa3c6', 0.50, 0.04); // low floors
const MAT_BODY_2  = mk('#b8b1d4', 0.46, 0.04); // mid floors
const MAT_BODY_3  = mk('#c8c2e0', 0.42, 0.04); // upper floors
const MAT_BODY_4  = mk('#d8d3ec', 0.38, 0.04); // crown floors — palest lavender

// Slab band — subtle dark separation line between floors
const SLAB_MAT    = mk('#1a1a1a', 0.85, 0.02);

// Rooftop parapet cap — palest lavender-white, crowns each volume cleanly
const CAP_MAT     = mk('#e6e2f2', 0.40, 0.04);

// Raised ground plinth deck — treehouse_cluster concept (measured from glbforaggregation:
// the double-height plinth oversails its column line, the real cantilever in that system)
const PLINTH_MAT  = mk('#ece7da', 0.35, 0.03);

// Selected highlight — bright white, lifted off the model
const MAT_SELECTED = mk('#ffffff', 0.25, 0.05, {
  emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.35,
});

// Typology accent strip — monochrome greys, no colour-coding
const TYPO_ACCENT_COLORS = {
  '1b1p': '#ffffff', '1b2p': '#ffffff',
  '2b3p': '#e6e6e6', '2b4p': '#e6e6e6',
  '3b4p': '#cccccc', '3b5p': '#cccccc',
  '4b5p': '#b3b3b3', '4b8p': '#b3b3b3',
};
const _accentMatCache = {};
function getAccentMat(typologyId) {
  if (_accentMatCache[typologyId]) return _accentMatCache[typologyId];
  const c = TYPO_ACCENT_COLORS[typologyId] ?? '#ffffff';
  _accentMatCache[typologyId] = mk(c, 0.45, 0.04, {
    emissive: new THREE.Color(c), emissiveIntensity: 0.08,
  });
  return _accentMatCache[typologyId];
}

// Glass — GLB stage only (real typology meshes, see buildFloorMat/matRole).
// Cooler, more reflective and more transparent than the box-stage flat
// lavender massing — reads as real curtain-wall glazing under interior
// light rather than a translucent study-model fill (reference: the lit
// glass floors against the dark frame in the white-context render).
const MAT_GLASS      = mk('#cdd8de', 0.06, 0.35, { transparent: true, opacity: 0.42 });
const MAT_GLASS_DARK = mk('#aab5bc', 0.06, 0.35, { transparent: true, opacity: 0.38 });

// Podium tone — GLB stage. The generator's floor 0 is a deliberate OPEN
// COLONNADE on columns (see OpenColonnade), not an enclosed wall, so this
// warm terracotta/brick tone is applied there (OpenColonnade's warm=true
// path) rather than to a solid ground-floor mesh — gives the reference
// render's masonry-base read while keeping the open-ground structure intact.
const MAT_PODIUM_GLB = mk('#8a5a48', 0.78, 0.04);

// Roof cap — GLB stage top floor. Dark flat-roof/plant-enclosure read,
// matching the reference's dark roof level above the glazed floors.
const MAT_ROOFCAP_GLB = mk('#1c1c20', 0.88, 0.08);

// Landscape — black ground, white-line paths, no colour planting
const GROUND_MAT = mk('#000000', 0.95, 0.00); // black surround
const PAVING_MAT = mk('#141414', 0.90, 0.00); // near-black paving inside site
const GRASS_MAT  = mk('#1c1c1c', 0.92, 0.00); // dark grey ground plane
const LAWN_MAT   = mk('#262626', 0.94, 0.00); // slightly lighter ground plane
const PATH_MAT   = mk('#3a3a3a', 0.80, 0.02); // grey stone path
const TRUNK_MAT  = mk('#2a2a2a', 0.90, 0.00); // dark grey trunk
const LEAF_MAT   = mk('#4a4a4a', 0.85, 0.00); // grey canopy

// Dimmed (filtered out) units
const MAT_DIMMED = new THREE.MeshStandardMaterial({
  color: '#3a3a3a', roughness: 0.9, metalness: 0.0, transparent: true, opacity: 0.25,
});

// Misc
const SITE_LINE_MAT   = new THREE.LineBasicMaterial({ color: '#ffffff', linewidth: 1 });
// transparent+opacity 0 (not visible:false) so the raycaster still hit-tests
// this layer — three.js's raycaster skips visible:false objects entirely,
// which silently made every click on the massing a no-op.
const CLICK_MAT       = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });

// Podium + landmark fins — white tower fins
const MAT_TOWER_ACCENT = mk('#ffffff', 0.35, 0.05, {
  emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.20,
});

// Connective tissue
const MAT_DECK       = mk('#dadada', 0.55, 0.04);   // light deck
const MAT_DECK_EDGE  = mk('#bdbdbd', 0.50, 0.04);   // darker parapet rim
const MAT_BRIDGE     = mk('#e0e0e0', 0.45, 0.10);   // light metallic sky-bridge
const MAT_BRIDGE_GLASS = mk('#dfe4e8', 0.10, 0.10, { transparent: true, opacity: 0.40 });
const MAT_EXT_STAIR  = mk('#ffffff', 0.40, 0.08, {
  emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.12,
});

// Terraces / roof gardens — grey-on-black, reads as a planar element
const MAT_TERRACE    = mk('#2e2e2e', 0.85, 0.00);   // dark grey terrace
const MAT_ROOF_GARDEN = mk('#242424', 0.88, 0.00);  // darker roof
const MAT_TERR_RAIL  = mk('#e6e6e6', 0.45, 0.08);   // light steel parapet
const MAT_PAVILION   = mk('#d8d8d8', 0.40, 0.06);   // light glass pavilion
const MAT_PAV_GLASS  = mk('#dfe4e8', 0.10, 0.10, { transparent: true, opacity: 0.35 });
const MAT_PROMENADE  = mk('#333333', 0.75, 0.02);   // dark stone promenade

// Circulation cores
const LOBBY_MAT = mk('#e8e8e8', 0.50, 0.04);
const LIFT_MAT  = mk('#d0d0d0', 0.45, 0.08);
const STAIR_MAT = mk('#f0f0f0', 0.45, 0.02);

// ─── Floor material selector ──────────────────────────────────────
function floorMat(floor, totalFloors, selected) {
  if (selected) return MAT_SELECTED;
  if (floor === 0) return MAT_BODY_0;
  const r = totalFloors > 1 ? floor / (totalFloors - 1) : 0;
  if (r < 0.25) return MAT_BODY_1;
  if (r < 0.50) return MAT_BODY_2;
  if (r < 0.75) return MAT_BODY_3;
  return MAT_BODY_4;
}

// Frame material grades (for GLB mode) — dark anodized aluminium, warmer and
// more metallic than the old flat-black steel reading, closer to the
// reference render's dark mullion grid against lit glass.
const FRAME_MATS = [
  mk('#15131a', 0.55, 0.42),
  mk('#1e1c26', 0.52, 0.46),
  mk('#262332', 0.48, 0.50),
  mk('#302c40', 0.44, 0.52),
  mk('#3a3650', 0.40, 0.55),
];
function frameMat(floor, totalFloors) {
  const i = Math.min(FRAME_MATS.length - 1,
    Math.floor((floor / Math.max(1, totalFloors - 1)) * (FRAME_MATS.length - 1)));
  return FRAME_MATS[i];
}

function matRole(mat) {
  if (!mat) return 'other';
  const n = (mat.name || '').toLowerCase();
  if (n.includes('glass')) return 'glass';
  if (n.includes('plaster') || n.includes('concrete') || n.includes('wall')) return 'wall';
  if (!mat.name && mat.color && mat.color.r < 0.15 && mat.color.g < 0.15 && mat.color.b < 0.15) return 'frame';
  return 'other';
}

// floor/totalFloors selects a ROOF CAP (top floor) treatment before falling
// back to regular glazed-floor grading — matches the reference render's
// dark roof level above the glazed body. NOTE: floor 0 ("podium") never
// reaches this function in the GLB stage — GLBUnits excludes floor<1 units
// entirely (the ground floor is rendered by the separate podium/ground-deck
// geometry), so there is no podium branch here despite MAT_PODIUM_GLB
// existing — it's reserved for if/when GLBUnits starts rendering ground-
// floor units directly.
function buildFloorMat(role, floor, totalFloors) {
  const isRoofCap = totalFloors > 1 && floor >= totalFloors - 1;
  if (isRoofCap) return MAT_ROOFCAP_GLB;

  if (role === 'glass')  return floor > totalFloors * 0.50 ? MAT_GLASS : MAT_GLASS_DARK;
  if (role === 'frame')  return frameMat(floor, totalFloors);
  return floorMat(floor, totalFloors, false);
}

// ─── Site GLB loader ──────────────────────────────────────────────
const _siteCache = {};
function loadSiteOutline(glbPath) {
  if (_siteCache[glbPath]) return _siteCache[glbPath];
  const loader = new GLTFLoader();
  const promise = loader.loadAsync(glbPath).then(gltf => {
    let positions = null;
    gltf.scene.traverse(n => {
      if (!positions && (n.isMesh || n.isLine) && n.geometry?.attributes?.position)
        positions = n.geometry.attributes.position;
    });
    if (!positions) return null;
    const pts = [];
    for (let i = 0; i < positions.count; i++)
      pts.push(new THREE.Vector3(positions.getX(i), 0, positions.getZ(i)));
    if (pts.length > 1) pts.push(pts[0].clone());
    return pts;
  }).catch(() => null);
  _siteCache[glbPath] = promise;
  return promise;
}

// Normalise raw GLB pts → world XZ spanning the full grid
function normaliseSitePts(rawPts, cols, rows) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  rawPts.forEach(p => {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
  });
  const rX = maxX - minX || 1, rZ = maxZ - minZ || 1;
  return rawPts.map(p => ({
    x: ((p.x - minX) / rX) * cols * CELL,
    z: ((p.z - minZ) / rZ) * rows * CELL,
  }));
}

// ShapeGeometry is XY plane. rotateX(-PI/2) maps shape-Y → -worldZ.
// Negate Z input so the polygon lands at correct positive world-Z coords.
function buildSiteShapeGeo(worldPts, yOffset = 0) {
  const pts2d = worldPts.slice(0, -1).map(p => new THREE.Vector2(p.x, -p.z));
  const shape  = new THREE.Shape(pts2d);
  const geo    = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, yOffset, 0);
  return geo;
}

// ─── SitePavedGround ──────────────────────────────────────────────
function SitePavedGround({ glbPath, cols, rows }) {
  const [geo, setGeo] = useState(null);
  useEffect(() => {
    if (!glbPath) return;
    let alive = true;
    loadSiteOutline(glbPath).then(raw => {
      if (!alive || !raw || raw.length < 3) return;
      setGeo(buildSiteShapeGeo(normaliseSitePts(raw, cols, rows), 0.005));
    });
    return () => { alive = false; };
  }, [glbPath, cols, rows]);
  if (!geo) return null;
  return <mesh geometry={geo} material={PAVING_MAT} />;
}

// ─── SiteOutline ──────────────────────────────────────────────────
function SiteOutline({ glbPath, cols, rows }) {
  const [lineObj, setLineObj] = useState(null);
  useEffect(() => {
    if (!glbPath) return;
    let alive = true;
    let created = null;
    loadSiteOutline(glbPath).then(raw => {
      if (!alive || !raw) return;
      const wpts = normaliseSitePts(raw, cols, rows);
      const vec3 = wpts.map(p => new THREE.Vector3(p.x, 0.08, p.z));
      const geo  = new THREE.BufferGeometry().setFromPoints(vec3);
      created = new THREE.Line(geo, SITE_LINE_MAT);
      setLineObj(created);
    });
    return () => {
      alive = false;
      if (created) { created.geometry.dispose(); created = null; }
    };
  }, [glbPath, cols, rows]);
  if (!lineObj) return null;
  return <primitive object={lineObj} />;
}

// ─── District zone ground planes — per-concept coloured base ─────
// Each concept has 2–4 distinct programme zones (e.g. tower quarter, low fabric,
// green boulevard). These coloured ground planes make the zones immediately
// legible in plan view and give depth to the iso view.
const ZONE_MATS = {
  tower:     new THREE.MeshStandardMaterial({ color: '#1a1824', roughness: 0.94, metalness: 0.02 }),
  mid:       new THREE.MeshStandardMaterial({ color: '#1e1c26', roughness: 0.96, metalness: 0.01 }),
  low:       new THREE.MeshStandardMaterial({ color: '#1c1e22', roughness: 0.97, metalness: 0.00 }),
  civic:     new THREE.MeshStandardMaterial({ color: '#1a2020', roughness: 0.93, metalness: 0.02 }),
  boulevard: new THREE.MeshStandardMaterial({ color: '#181c18', roughness: 0.98, metalness: 0.00 }),
};

function DistrictZones({ plan }) {
  const { concept, cols, rows } = plan;
  const CELL_W = CELL;

  const zones = useMemo(() => {
    if (!concept) return [];
    const w = cols * CELL_W, d = rows * CELL_W;
    const sb = 2 * CELL_W;
    const iW = w - sb * 2, iD = d - sb * 2;
    const ox = sb, oz = sb;

    const make = (x, z, wz, dz, type) => {
      const geo = new THREE.PlaneGeometry(wz, dz);
      geo.rotateX(-Math.PI / 2);
      geo.translate(x + wz/2, 0.004, z + dz/2);
      return { geo, mat: ZONE_MATS[type] || ZONE_MATS.mid };
    };

    switch (concept) {
      case 'courtyard_block': {
        const cx = ox + iW * 0.28, cxe = ox + iW * 0.72;
        const cz2 = oz + iD * 0.28, cze = oz + iD * 0.72;
        return [
          make(ox, oz, iW, cz2 - oz, 'tower'),        // N arm
          make(ox, cze, iW, oz + iD - cze, 'tower'),  // S arm
          make(ox, cz2, cx - ox, cze - cz2, 'mid'),   // W arm
          make(cxe, cz2, ox + iW - cxe, cze - cz2, 'mid'), // E arm
          make(cx, cz2, cxe - cx, cze - cz2, 'civic'),     // courtyard void
        ];
      }
      case 'superblock_grid': {
        const sc = iW * 0.46, sr = iD * 0.46;
        return [
          make(ox, oz, sc, sr, 'low'),                        // NW
          make(ox + sc, oz, iW - sc, sr, 'tower'),            // NE
          make(ox, oz + sr, sc, iD - sr, 'mid'),              // SW
          make(ox + sc, oz + sr, iW - sc, iD - sr, 'mid'),   // SE
        ];
      }
      case 'mountain_cascade': {
        // Stepped bands — 4 vertical slices, alternating low/tower
        const sliceW = iW / 4;
        return [0,1,2,3].map(i => make(ox + i * sliceW, oz, sliceW, iD,
          i === 0 || i === 3 ? 'low' : i === 1 ? 'mid' : 'tower'));
      }
      case 'pixel_towers':
        return [make(ox, oz, iW, iD, 'tower')];
      case 'green_spine': {
        // Bands: N half low, S half mid, central boulevard
        const mid = oz + iD * 0.48;
        return [
          make(ox, oz, iW, mid - oz, 'low'),
          make(ox, mid, iW, oz + iD - mid, 'mid'),
        ];
      }
      case 'radial_park':
        return [make(ox, oz, iW, iD, 'civic')];
      case 'linear_datum': {
        const r1 = oz + iD * 0.30, r2 = oz + iD * 0.62;
        return [
          make(ox, oz, iW, r1 - oz, 'low'),
          make(ox, r1, iW, r2 - r1, 'tower'),
          make(ox, r2, iW, oz + iD - r2, 'low'),
        ];
      }
      case 'void_interstitial':
        return [make(ox, oz, iW, iD, 'mid')];
      default:
        return [];
    }
  }, [concept, cols, rows]);

  if (!zones.length) return null;
  return (
    <group>
      {zones.map(({ geo, mat }, i) => (
        <mesh key={i} geometry={geo} material={mat} />
      ))}
    </group>
  );
}

// ─── SiteFloor — dark outer context surround only ─────────────────
// Draws the real site polygon when available so large/irregular sites
// don't render a rectangular slab of dead space around sparse massing —
// falls back to the bounding-box rectangle when no polygon is given.
function SiteFloor({ cols, rows, sitePolyGrid }) {
  const geo = useMemo(() => {
    if (sitePolyGrid && sitePolyGrid.length >= 3) {
      // rotateX(-PI/2) maps shape-space y -> world -z, so negate y here to
      // land on world +z (matching how every other building/cell position
      // in this file computes world z directly as row * CELL, no flip).
      const shape = new THREE.Shape(sitePolyGrid.map(p => new THREE.Vector2(p.x * CELL, -p.z * CELL)));
      const g = new THREE.ShapeGeometry(shape);
      g.rotateX(-Math.PI / 2);
      g.translate(0, -0.06, 0);
      return g;
    }
    const w = cols * CELL, d = rows * CELL;
    const g = new THREE.PlaneGeometry(w + 80, d + 80);
    g.rotateX(-Math.PI / 2);
    g.translate(w / 2, -0.06, d / 2);
    return g;
  }, [cols, rows, sitePolyGrid]);
  useEffect(() => () => geo.dispose(), [geo]);
  return <mesh geometry={geo} material={GROUND_MAT} />;
}

// ─── Real OSM context — surrounding buildings + roads ─────────────
// Renders REAL neighbouring building footprints (flat pale massing, no
// material detail) and REAL road centrelines fetched live from OpenStreetMap
// via useOsmContext, around the actual site — not fake/procedural geometry.
//
// Coordinates come back from useOsmContext as METRES east(xM)/north(zM) of
// geoRef's own bounding-box origin (geoRef.minLat/minLng) — used DIRECTLY as
// world x/z here, no rescaling. That origin is the same one SiteFloor's
// sitePolyGrid path implicitly places at world (0,0) (sitePolygon is
// normalised 0..1 against that same site bounding box, then scaled by
// cols*CELL/rows*CELL) — so both line up in the same world frame without
// needing to share cols/rows at all. An earlier version multiplied these by
// cols*CELL/rows*CELL (the SITE's own small grid width) on top of an
// already-normalised-against-a-much-larger-area value, which threw real
// neighbouring buildings to wildly wrong, scattered world positions — surfaced
// as chaotic floating geometry in the live app. Fixed by keeping this
// function's output in plain world metres throughout, never re-normalised.
const OSM_CONTEXT_MAT = new THREE.MeshStandardMaterial({ color: '#cfcfc8', roughness: 0.95, metalness: 0 });
const OSM_ROAD_MAT = new THREE.LineBasicMaterial({ color: '#9a9a92', transparent: true, opacity: 0.55 });
const OSM_DEFAULT_LEVELS = 3; // OSM building:levels tag is frequently absent — flat low massing reads as plausible neighbouring context either way

// Real OSM `way` geometry is frequently non-simple (self-intersecting,
// duplicate/collinear points, multi-part buildings) — THREE.Shape /
// ExtrudeGeometry can throw on that. This sits inside MasterplanErrorBoundary
// (wraps the whole <Canvas>), so ONE bad building polygon throwing here would
// previously blank the ENTIRE 3D scene (HUD panel still rendering fine
// outside the boundary, canvas empty underneath — exactly what surfaced as
// "nothing renders, but the stats panel looks normal"). Every building is now
// built defensively and skipped individually on failure instead.
function isFiniteXZ(p) { return Number.isFinite(p.xM) && Number.isFinite(p.zM); }

function OsmContext({ geoRef }) {
  const { buildings, roads } = useOsmContext(geoRef);

  const buildingMeshes = useMemo(() => {
    const out = [];
    for (const b of buildings) {
      if (b.points.length < 3 || !b.points.every(isFiniteXZ)) continue;
      try {
        const shape = new THREE.Shape(b.points.map(p => new THREE.Vector2(p.xM, -p.zM)));
        const height = (b.levels ?? OSM_DEFAULT_LEVELS) * FLOOR_H;
        const geo = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
        geo.rotateX(-Math.PI / 2);
        out.push({ geo, height });
      } catch {
        // Skip this one malformed building — never let it take down the rest.
      }
    }
    return out;
  }, [buildings]);

  useEffect(() => () => buildingMeshes.forEach(b => b.geo.dispose()), [buildingMeshes]);

  const roadLines = useMemo(() => {
    const out = [];
    for (const r of roads) {
      if (r.points.length < 2 || !r.points.every(isFiniteXZ)) continue;
      const pts = r.points.map(p => new THREE.Vector3(p.xM, 0.01, p.zM));
      out.push(new THREE.BufferGeometry().setFromPoints(pts));
    }
    return out;
  }, [roads]);

  useEffect(() => () => roadLines.forEach(g => g.dispose()), [roadLines]);

  if (!geoRef) return null;
  if (!buildingMeshes.length && !roadLines.length) return null;

  return (
    <group>
      {buildingMeshes.map((b, i) => (
        <mesh key={i} geometry={b.geo} material={OSM_CONTEXT_MAT} receiveShadow />
      ))}
      {roadLines.map((g, i) => (
        <primitive key={i} object={new THREE.Line(g, OSM_ROAD_MAT)} />
      ))}
    </group>
  );
}

// ─── Architectural grid overlay ────────────────────────────────────
// Thin white grid lines on the ground plane — references read as
// axonometric architectural drawings with a grid substrate.
const GRID_MAT = new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.032 });

function ArchGrid({ cols, rows }) {
  const obj = useMemo(() => {
    const w = cols * CELL, d = rows * CELL;
    const pts = [];
    const step = CELL * 4; // one grid line every 4 cells
    for (let x = 0; x <= w; x += step) {
      pts.push(new THREE.Vector3(x, 0.002, 0));
      pts.push(new THREE.Vector3(x, 0.002, d));
    }
    for (let z = 0; z <= d; z += step) {
      pts.push(new THREE.Vector3(0, 0.002, z));
      pts.push(new THREE.Vector3(w, 0.002, z));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const segments = new THREE.LineSegments(geo, GRID_MAT);
    return segments;
  }, [cols, rows]);
  return <primitive object={obj} />;
}

// ─── GreenZones — fully instanced trees, merged ground quads ──────
function GreenZones({ cells }) {
  const { grassGeo, lawnGeo, pathGeo, treeTrunkTransforms, treeCanopyTransforms } = useMemo(() => {
    const grassParts = [], lawnParts = [], pathParts = [];
    const trunkT = [], canopyT = [];
    const S = CELL + 0.06;

    cells.forEach(cell => {
      const x = cell.col * CELL + CELL / 2;
      const z = cell.row * CELL + CELL / 2;
      const makeQuad = (y) => {
        const g = new THREE.PlaneGeometry(S, S);
        g.rotateX(-Math.PI / 2);
        g.translate(x, y, z);
        return g;
      };
      if (cell.type === 'tree') {
        lawnParts.push(makeQuad(0.02));
        // Tall slim trunk
        trunkT.push({ pos: [x, 2.0, z], scale: [0.14, 4.0, 0.14] });
        // Compact canopy — small sphere sits on top
        canopyT.push({ pos: [x, 4.8, z], scale: [1.0, 1.0, 1.0] });
      } else if (cell.type === 'path') {
        pathParts.push(makeQuad(0.022));
      } else {
        grassParts.push(makeQuad(0.02));
      }
    });

    const merge = ps => ps.length > 1 ? mergeGeometries(ps, false) : ps[0] ?? null;
    return {
      grassGeo:  merge(grassParts),
      lawnGeo:   merge(lawnParts),
      pathGeo:   merge(pathParts),
      treeTrunkTransforms:  trunkT,
      treeCanopyTransforms: canopyT,
    };
  }, [cells]);

  const trunkRef  = useRef();
  const canopyRef = useRef();
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => {
    const apply = (ref, list) => {
      if (!ref.current || !list.length) return;
      list.forEach(({ pos, scale }, i) => {
        dummy.position.set(...pos);
        dummy.scale.set(...scale);
        dummy.updateMatrix();
        ref.current.setMatrixAt(i, dummy.matrix);
      });
      ref.current.instanceMatrix.needsUpdate = true;
    };
    apply(trunkRef,  treeTrunkTransforms);
    apply(canopyRef, treeCanopyTransforms);
  }, [treeTrunkTransforms, treeCanopyTransforms, dummy]);

  return (
    <group>
      {grassGeo && <mesh geometry={grassGeo} material={GRASS_MAT} />}
      {lawnGeo  && <mesh geometry={lawnGeo}  material={LAWN_MAT}  />}
      {pathGeo  && <mesh geometry={pathGeo}  material={PATH_MAT}  />}
      {treeTrunkTransforms.length > 0 && (
        <instancedMesh ref={trunkRef}
          args={[BOX1, TRUNK_MAT, treeTrunkTransforms.length]} frustumCulled={false} />
      )}
      {treeCanopyTransforms.length > 0 && (
        <instancedMesh ref={canopyRef}
          args={[SPHERE1, LEAF_MAT, treeCanopyTransforms.length]} frustumCulled={false} />
      )}
    </group>
  );
}

// ─── Podium deck — continuous shared ground plinth ────────────────
// Merges all deck cells into one slab + a slightly raised parapet rim, so
// clusters of buildings read as sitting on a shared raised ground (the thing
// that makes them a connected community rather than scattered objects).
const DECK_H = FLOOR_H * 0.92;
function PodiumDeck({ cells, buildingCells }) {
  const { deckGeo, edgeGeo } = useMemo(() => {
    if (!cells || !cells.length) return { deckGeo: null, edgeGeo: null };
    const keyOf = (c, r) => `${c},${r}`;
    const set = new Set(cells.map(c => keyOf(c.col, c.row)));
    const bld = buildingCells || new Set();
    const deckParts = [], edgeParts = [];
    const S = CELL + 0.04;
    cells.forEach(cell => {
      const x = cell.col * CELL + CELL / 2;
      const z = cell.row * CELL + CELL / 2;
      const g = new THREE.BoxGeometry(S, DECK_H, S);
      g.translate(x, DECK_H / 2, z);
      deckParts.push(g);
      // parapet rim only on the OUTER edge — neighbour is neither deck nor a
      // building (i.e. facing open ground / park). No rims hugging buildings.
      const nb = [[1,0],[-1,0],[0,1],[0,-1]];
      nb.forEach(([dc, dr]) => {
        const nk = keyOf(cell.col + dc, cell.row + dr);
        if (!set.has(nk) && !bld.has(nk)) {
          const e = new THREE.BoxGeometry(dc !== 0 ? 0.18 : S, 0.5, dr !== 0 ? 0.18 : S);
          e.translate(x + dc * CELL / 2, DECK_H + 0.25, z + dr * CELL / 2);
          edgeParts.push(e);
        }
      });
    });
    const merge = ps => ps.length ? (ps.length > 1 ? mergeGeometries(ps, false) : ps[0]) : null;
    return { deckGeo: merge(deckParts), edgeGeo: merge(edgeParts) };
  }, [cells, buildingCells]);
  if (!deckGeo) return null;
  return (
    <group>
      <mesh geometry={deckGeo} material={MAT_DECK} />
      {edgeGeo && <mesh geometry={edgeGeo} material={MAT_DECK_EDGE} />}
    </group>
  );
}

// ─── Sky bridges — elevated links between nearby tall buildings ────
function SkyBridges({ bridges }) {
  const { bodyGeo, glassGeo } = useMemo(() => {
    if (!bridges || !bridges.length) return { bodyGeo: null, glassGeo: null };
    const bodyParts = [], glassParts = [];
    bridges.forEach(b => {
      const x1 = b.ax * CELL, z1 = b.az * CELL;
      const x2 = b.bx * CELL, z2 = b.bz * CELL;
      const dx = x2 - x1, dz = z2 - z1;
      const len = Math.hypot(dx, dz);
      if (len < 0.5) return;
      const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
      const y  = b.floor * FLOOR_H + FLOOR_H * 0.5;
      const ang = Math.atan2(dz, dx);
      const W = 2.2, Hh = FLOOR_H * 0.78;
      const body = new THREE.BoxGeometry(len, Hh, W);
      body.rotateY(-ang);
      body.translate(cx, y, cz);
      bodyParts.push(body);
      const glass = new THREE.BoxGeometry(len - 0.6, Hh * 0.5, W + 0.06);
      glass.rotateY(-ang);
      glass.translate(cx, y + 0.1, cz);
      glassParts.push(glass);
    });
    const merge = ps => ps.length ? (ps.length > 1 ? mergeGeometries(ps, false) : ps[0]) : null;
    return { bodyGeo: merge(bodyParts), glassGeo: merge(glassParts) };
  }, [bridges]);
  if (!bodyGeo) return null;
  return (
    <group>
      <mesh geometry={bodyGeo} material={MAT_BRIDGE} />
      {glassGeo && <mesh geometry={glassGeo} material={MAT_BRIDGE_GLASS} />}
    </group>
  );
}

// ─── Exterior stairs — expressed circulation landing on the podium ─
function ExteriorStairs({ stairs }) {
  const geo = useMemo(() => {
    if (!stairs || !stairs.length) return null;
    const parts = [];
    stairs.forEach(s => {
      const x = s.col * CELL + CELL / 2;
      const z = s.row * CELL + CELL / 2;
      const h = s.floors * FLOOR_H;
      // vertical circulation shaft
      const shaft = new THREE.BoxGeometry(1.3, h, 1.3);
      shaft.translate(x, h / 2, z);
      parts.push(shaft);
      // diagonal stair treads suggested by stacked offset slabs every floor
      for (let f = 0; f < s.floors; f++) {
        const tread = new THREE.BoxGeometry(1.5, 0.16, 1.5);
        const off = (f % 2 ? 0.5 : -0.5);
        tread.translate(x + off, f * FLOOR_H + FLOOR_H * 0.5, z);
        parts.push(tread);
      }
    });
    return parts.length > 1 ? mergeGeometries(parts, false) : parts[0];
  }, [stairs]);
  if (!geo) return null;
  return <mesh geometry={geo} material={MAT_EXT_STAIR} />;
}

// ─── Roof terraces & gardens — the social surfaces of the scheme ──
// Planted patches on every building's exposed roof: mid-height setbacks read
// as outdoor terraces (with a parapet rail), the tops as green roofs.
function RoofTerraces({ buildings, maxFloor }) {
  const { terrGeo, roofGeo, railGeo } = useMemo(() => {
    const terr = [], roof = [], rail = [];
    const S = CELL + 0.02;
    buildings.forEach(b => {
      if (!b.terraces) return;
      b.terraces.forEach(t => {
        if (t.floor > maxFloor) return;
        const x = t.col * CELL + CELL / 2;
        const z = t.row * CELL + CELL / 2;
        const y = t.floor * FLOOR_H;
        // roof gardens sit just ABOVE the parapet cap (cap tops ~+0.04) to
        // avoid z-fighting; setback terraces sit on their own (capless) roof.
        const base = t.kind === 'roof' ? 0.06 : 0.02;
        const g = new THREE.BoxGeometry(S, 0.20, S);
        g.translate(x, y + base + 0.10, z);
        (t.kind === 'roof' ? roof : terr).push(g);
        // a light parapet ring on planted setback terraces
        if (t.kind === 'terrace') {
          const e = new THREE.BoxGeometry(S, 0.34, 0.10);
          e.translate(x, y + 0.30, z + CELL / 2);
          rail.push(e);
        }
      });
    });
    const m = ps => ps.length ? (ps.length > 1 ? mergeGeometries(ps, false) : ps[0]) : null;
    return { terrGeo: m(terr), roofGeo: m(roof), railGeo: m(rail) };
  }, [buildings, maxFloor]);
  return (
    <group>
      {terrGeo && <mesh geometry={terrGeo} material={MAT_TERRACE} />}
      {roofGeo && <mesh geometry={roofGeo} material={MAT_ROOF_GARDEN} />}
      {railGeo && <mesh geometry={railGeo} material={MAT_TERR_RAIL} />}
    </group>
  );
}

// ─── Podium program — communal pavilions + deck gardens on the plinth ─
function PodiumProgram({ pavilions, deckGardens }) {
  const trunkRef = useRef(), canopyRef = useRef();
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const { bodyGeo, glassGeo, trees } = useMemo(() => {
    const bodyParts = [], glassParts = [], trees = [];
    (pavilions || []).forEach(p => {
      const x = p.col * CELL + (p.w * CELL) / 2;
      const z = p.row * CELL + (p.d * CELL) / 2;
      const bw = p.w * CELL - 0.4, bd = p.d * CELL - 0.4;
      const h = FLOOR_H * 0.85;
      const body = new THREE.BoxGeometry(bw, h, bd);
      body.translate(x, DECK_H + h / 2, z);
      bodyParts.push(body);
      const glass = new THREE.BoxGeometry(bw + 0.04, h * 0.6, bd + 0.04);
      glass.translate(x, DECK_H + h * 0.45, z);
      glassParts.push(glass);
    });
    (deckGardens || []).forEach(g => {
      trees.push({ x: g.col * CELL + CELL / 2, z: g.row * CELL + CELL / 2 });
    });
    const m = ps => ps.length ? (ps.length > 1 ? mergeGeometries(ps, false) : ps[0]) : null;
    return { bodyGeo: m(bodyParts), glassGeo: m(glassParts), trees };
  }, [pavilions, deckGardens]);

  useEffect(() => {
    const apply = (ref, yBase, scaleArr) => {
      if (!ref.current) return;
      trees.forEach((t, i) => {
        dummy.position.set(t.x, DECK_H + yBase, t.z);
        dummy.scale.set(...scaleArr);
        dummy.updateMatrix();
        ref.current.setMatrixAt(i, dummy.matrix);
      });
      ref.current.instanceMatrix.needsUpdate = true;
    };
    apply(trunkRef, 1.1, [0.12, 2.2, 0.12]);
    apply(canopyRef, 2.6, [0.95, 0.95, 0.95]);
  }, [trees, dummy]);

  return (
    <group>
      {bodyGeo && <mesh geometry={bodyGeo} material={MAT_PAVILION} />}
      {glassGeo && <mesh geometry={glassGeo} material={MAT_PAV_GLASS} />}
      {trees.length > 0 && <instancedMesh ref={trunkRef} args={[BOX1, TRUNK_MAT, trees.length]} frustumCulled={false} />}
      {trees.length > 0 && <instancedMesh ref={canopyRef} args={[SPHERE1, LEAF_MAT, trees.length]} frustumCulled={false} />}
    </group>
  );
}

// ─── Road network — tarmac roads, parking bays, entry aprons ────────
const MAT_ROAD    = mk('#111118', 0.97, 0.02);
const MAT_PARKING = mk('#0e0e15', 0.95, 0.03);
const MAT_ENTRY   = mk('#1c1c1c', 0.90, 0.04, {
  emissive: new THREE.Color('#2a2a2a'), emissiveIntensity: 0.08,
});

function RoadNetwork({ roads }) {
  const { roadGeo, parkGeo, entryGeo } = useMemo(() => {
    if (!roads || !roads.length) return { roadGeo: null, parkGeo: null, entryGeo: null };
    const roadParts = [], parkParts = [], entryParts = [];
    roads.forEach(r => {
      const x = r.col * CELL + CELL / 2;
      const z = r.row * CELL + CELL / 2;
      const g = new THREE.PlaneGeometry(CELL - 0.06, CELL - 0.06);
      g.rotateX(-Math.PI / 2);
      g.translate(x, 0.012, z);
      if (r.type === 'parking') parkParts.push(g);
      else if (r.type === 'entry') entryParts.push(g);
      else roadParts.push(g);
    });
    const merge = ps => ps.length ? (ps.length > 1 ? mergeGeometries(ps, false) : ps[0]) : null;
    return { roadGeo: merge(roadParts), parkGeo: merge(parkParts), entryGeo: merge(entryParts) };
  }, [roads]);
  return (
    <group>
      {roadGeo  && <mesh geometry={roadGeo}  material={MAT_ROAD}    />}
      {parkGeo  && <mesh geometry={parkGeo}  material={MAT_PARKING} />}
      {entryGeo && <mesh geometry={entryGeo} material={MAT_ENTRY}   />}
    </group>
  );
}

// ─── Solar heatmap overlay ────────────────────────────────────────
// Renders a semi-transparent coloured quad per cell based on solar exposure.
// Yellow = high sun, blue = shade. Only shown when showSolar=true.
//
// One merged BufferGeometry + one material for the whole grid (instead of a
// separate PlaneGeometry + MeshBasicMaterial + mesh per cell — on a 360x360
// grid that was up to ~130k draw calls). Per-cell colour AND per-cell opacity
// are preserved exactly: colour via vertex colours, opacity via a vertex
// alpha attribute consumed through onBeforeCompile (MeshBasicMaterial has no
// built-in per-vertex alpha, so the fragment shader is patched to multiply
// in vAlpha — same visual result, one draw call).
const _heatmapMatCache = new WeakMap();
function getHeatmapMaterial() {
  let mat = _heatmapMatCache.get(THREE);
  if (mat) return mat;
  mat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, depthWrite: false,
  });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float alpha;\nvarying float vAlpha;')
      .replace('#include <color_vertex>', '#include <color_vertex>\nvAlpha = alpha;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vAlpha;')
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( diffuse, opacity * vAlpha );');
  };
  _heatmapMatCache.set(THREE, mat);
  return mat;
}

function SolarHeatmap({ plan, show }) {
  const geometry = useMemo(() => {
    if (!show || !plan?.solarHeatmap) return null;
    const { cols, rows, solarHeatmap } = plan;
    const parts = [];
    const alphas = [];
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const heat = solarHeatmap[c * rows + r];
        if (heat < 0.01) continue;
        const x = c * CELL + CELL / 2;
        const z = r * CELL + CELL / 2;
        const g = new THREE.PlaneGeometry(CELL - 0.04, CELL - 0.04);
        g.rotateX(-Math.PI / 2);
        g.translate(x, 0.025, z);
        // Colour: cold blue (0) → warm yellow (1) — identical formula to before
        const r2 = Math.min(1, heat * 1.6);
        const gv = Math.min(1, heat * 1.2);
        const bv = Math.max(0, 1 - heat * 2);
        const vCount = g.attributes.position.count;
        const colors = new Float32Array(vCount * 3);
        for (let i = 0; i < vCount; i++) { colors[i*3] = r2; colors[i*3+1] = gv; colors[i*3+2] = bv; }
        g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        for (let i = 0; i < vCount; i++) alphas.push(heat * 0.55);
        parts.push(g);
      }
    }
    if (!parts.length) return null;
    const merged = mergeGeometries(parts, false);
    merged.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(alphas), 1));
    parts.forEach(g => g.dispose());
    return merged;
  }, [plan, show]);

  useEffect(() => () => { geometry?.dispose(); }, [geometry]);

  if (!geometry) return null;
  return <mesh geometry={geometry} material={getHeatmapMaterial()} />;
}

// ─── Promenade — continuous stepped ramp climbing a building flank ─
function Promenade({ steps }) {
  const geo = useMemo(() => {
    if (!steps || !steps.length) return null;
    const parts = [];
    steps.forEach(s => {
      const x = s.col * CELL + CELL / 2;
      const z = s.row * CELL + CELL / 2;
      const y = s.floor * FLOOR_H;
      const deck = new THREE.BoxGeometry(CELL * 1.1, 0.3, CELL * 1.3);
      deck.translate(x, y + 0.15, z);
      parts.push(deck);
      // outer balustrade — on the flank AWAY from the building it climbs
      const outer = s.side === 'W' ? -1 : 1;
      const rail = new THREE.BoxGeometry(0.16, 1.0, CELL * 1.3);
      rail.translate(x + outer * CELL * 0.5, y + 0.6, z);
      parts.push(rail);
    });
    return parts.length > 1 ? mergeGeometries(parts, false) : parts[0];
  }, [steps]);
  if (!geo) return null;
  return <mesh geometry={geo} material={MAT_PROMENADE} />;
}

// ─── Instanced box massing ────────────────────────────────────────
// Maps a unit to a stable floor-band key (0–6) for material grouping.
// More bands = more tonal variety in the massing so height reads clearly.
function floorBandKey(floor, totalFloors, dimmed) {
  if (dimmed) return 'dimmed';
  if (floor === 0) return 'f0';
  const r = totalFloors > 1 ? floor / (totalFloors - 1) : 0;
  if (r < 0.15) return 'f1';
  if (r < 0.35) return 'f2';
  if (r < 0.55) return 'f3';
  if (r < 0.75) return 'f4';
  return 'f5';
}

// Render buildings as explicit stepped slabs.
// Each slab is one tall box spanning its floor range — dramatic, readable, BIG-style.
function BoxMassing({ buildings, maxFloor, filterTypology, hoverTypology, selectedUnit, onSelect }) {
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const { groups, bandTransforms, capTransforms, plinthDeckTransforms, edgeTransforms, accentGroups, allUnits } = useMemo(() => {
    const groups = {};       // key → { mat, transforms[], unitRefs[] }
    const bandTransforms = []; // horizontal floor-band lines between slabs
    const capTransforms  = []; // rooftop parapet caps
    const plinthDeckTransforms = []; // raised ground plinth deck caps (treehouse_cluster)
    const accentGroups   = {}; // typology accent strips on south face
    const allUnits       = [];

    buildings.filter(b => (b.slabs?.length > 0 || b.units.length > 0)).forEach(b => {
      const slabs  = b.slabs  || [];
      const units  = b.units  || [];
      const tf     = b.floors;

      // Treehouse cluster: the ground bay is a measured double-height plinth
      // (~6.4 m vs ~3.5 m typical floor — see tree_pavilion in the generator),
      // so every floor above it shifts up by one extra FLOOR_H. Plain
      // buildings (no plinth slab) keep floor 1 starting at exactly FLOOR_H.
      const hasPlinth = slabs.some(s => s.plinth);
      const floorYOffset = hasPlinth ? FLOOR_H : 0;

      if (slabs.length > 0) {
        // ── SLAB-BASED RENDERING ─────────────────────────────────────
        // Floor 0 is open colonnade — skip it in solid massing, start from floor 1
        slabs.forEach((slab, si) => {
          if (slab.plinth) {
            // Raised double-height ground plinth — the real cantilever in
            // this system happens HERE (plinth oversails its column line),
            // not at the roof. Rendered as its own deck below the body,
            // open underneath (columns carry it — see OpenColonnade).
            if (!slab.doubleHeight) return;
            const oversailM = slab.oversailM || 0;
            const wx = (b.col + slab.xOff) * CELL - oversailM, wz = (b.row + slab.zOff) * CELL - oversailM;
            const sw = slab.sw * CELL + oversailM * 2, sd = slab.sd * CELL + oversailM * 2;
            const deckH = FLOOR_H * 0.16;
            const deckY = FLOOR_H * 2 - deckH / 2; // top of the double-height bay
            plinthDeckTransforms.push({
              pos: [wx + sw / 2, deckY, wz + sd / 2],
              scale: [sw, deckH, sd],
            });
            return;
          }
          const clampedEnd = Math.min(slab.floorEnd, maxFloor - 1);
          if (slab.floorStart >= maxFloor) return;
          // Colonnade: raise slab start to floor 1 minimum
          const effectiveStart = Math.max(1, slab.floorStart);

          const wx = (col => col * CELL)(b.col + slab.xOff);
          const wz = (row => row * CELL)(b.row + slab.zOff);
          const sw  = slab.sw * CELL;
          const sd  = slab.sd * CELL;
          const cx  = wx + sw / 2;
          const cz  = wz + sd / 2;

          const yBot = effectiveStart * FLOOR_H + floorYOffset;
          const yTop = (clampedEnd + 1) * FLOOR_H + floorYOffset;
          const h    = yTop - yBot;
          if (h <= 0) return;
          const yMid = yBot + h / 2;

          // Body — one tall box per slab (starting from floor 1 — GF is open colonnade)
          const midFloor = Math.floor((effectiveStart + clampedEnd) / 2);
          const mat = floorMat(midFloor, tf, false);
          const key = floorBandKey(midFloor, tf, false);
          if (!groups[key]) groups[key] = { mat, transforms: [], unitRefs: [] };
          groups[key].transforms.push({ pos: [cx, yMid, cz], scale: [sw - 0.12, h - 0.08, sd - 0.12] });

          // One representative unit ref for click/hover
          const rep = units.find(u => u.floor >= slab.floorStart && u.floor <= slab.floorEnd) || units[0];
          groups[key].unitRefs.push(rep || { typologyId: '2b3p', floor: midFloor });

          // Horizontal band lines at every floor junction within this slab (skip GF)
          for (let fl = Math.max(2, effectiveStart + 1); fl <= clampedEnd; fl++) {
            const by = fl * FLOOR_H + floorYOffset;
            bandTransforms.push({ pos: [cx, by, cz], scale: [sw, 0.28, sd] });
          }

          // Rooftop parapet cap on the top slab only
          if (si === slabs.length - 1 && clampedEnd === slab.floorEnd) {
            capTransforms.push({
              pos: [cx, yTop + 0.05, cz],
              scale: [sw + 0.14, 0.22, sd + 0.14],
            });
          }

          // Terrace surface between this slab and the next (if next is smaller)
          if (si < slabs.length - 1) {
            const next = slabs[si + 1];
            if (next.sw < slab.sw || next.sd < slab.sd) {
              // Green planted terrace where this slab's roof is exposed
              const tid = (units.find(u => u.floor >= slab.floorStart)?.typologyId) || '2b3p';
              if (!accentGroups[tid]) accentGroups[tid] = { mat: getAccentMat(tid), transforms: [] };
              accentGroups[tid].transforms.push({
                pos: [cx, yTop + 0.12, cz],
                scale: [sw - 0.20, 0.24, sd - 0.20],
              });
            }
          }

          // Accent strip — glowing colour band on south face, full slab height
          const tid = (units.find(u => u.floor >= slab.floorStart)?.typologyId) || '2b3p';
          if (!accentGroups[tid]) accentGroups[tid] = { mat: getAccentMat(tid), transforms: [] };
          const aW = sw * 0.45;
          const aH = h * 0.65;
          accentGroups[tid].transforms.push({
            pos: [cx, yBot + h * 0.55, wz + sd - 0.06],
            scale: [aW, aH, 0.10],
          });

          // Collect representative units for allUnits (click proxies)
          if (rep) allUnits.push(rep);
        });

      } else {
        // ── FALLBACK: unit-based (buildings with no slabs) ────────────
        b.units.forEach(u => {
          if (u.floor >= maxFloor) return;
          const dimmed = !!(filterTypology && u.typologyId !== filterTypology);
          const mat = dimmed ? MAT_DIMMED : floorMat(u.floor, tf, false);
          const key = floorBandKey(u.floor, tf, dimmed);
          if (!groups[key]) groups[key] = { mat, transforms: [], unitRefs: [] };
          const x = u.col * CELL + (u.w * CELL) / 2;
          const y = u.floor * FLOOR_H + FLOOR_H / 2;
          const z = u.row * CELL + (u.d * CELL) / 2;
          const bw = u.w * CELL, bd = u.d * CELL;
          groups[key].transforms.push({ pos: [x, y, z], scale: [bw - 0.10, FLOOR_H - 0.32, bd - 0.10] });
          groups[key].unitRefs.push(u);
          allUnits.push(u);
        });
      }
    });

    // Flatten every body slab's transform (+ rooftop caps) into one list so a
    // single merged EdgeOverlay outlines the whole massing in one draw call.
    const edgeTransforms = [];
    Object.values(groups).forEach(g => { for (const t of g.transforms) edgeTransforms.push(t); });
    for (const t of capTransforms) edgeTransforms.push(t);
    for (const t of plinthDeckTransforms) edgeTransforms.push(t);

    return {
      groups: Object.entries(groups).map(([k, v]) => ({ ...v, key: k })),
      bandTransforms, capTransforms, plinthDeckTransforms, edgeTransforms,
      accentGroups: Object.entries(accentGroups).map(([k, v]) => ({ ...v, key: k })),
      allUnits,
    };
  }, [buildings, maxFloor, filterTypology]);

  const bandRef       = useRef();
  const capRef        = useRef();
  const plinthDeckRef = useRef();

  useEffect(() => {
    if (!bandRef.current) return;
    bandTransforms.forEach(({ pos, scale }, i) => {
      dummy.position.set(...pos); dummy.scale.set(...scale); dummy.updateMatrix();
      bandRef.current.setMatrixAt(i, dummy.matrix);
    });
    bandRef.current.instanceMatrix.needsUpdate = true;
  }, [bandTransforms, dummy]);

  useEffect(() => {
    if (!capRef.current) return;
    capTransforms.forEach(({ pos, scale }, i) => {
      dummy.position.set(...pos); dummy.scale.set(...scale); dummy.updateMatrix();
      capRef.current.setMatrixAt(i, dummy.matrix);
    });
    capRef.current.instanceMatrix.needsUpdate = true;
  }, [capTransforms, dummy]);

  useEffect(() => {
    if (!plinthDeckRef.current) return;
    plinthDeckTransforms.forEach(({ pos, scale }, i) => {
      dummy.position.set(...pos); dummy.scale.set(...scale); dummy.updateMatrix();
      plinthDeckRef.current.setMatrixAt(i, dummy.matrix);
    });
    plinthDeckRef.current.instanceMatrix.needsUpdate = true;
  }, [plinthDeckTransforms, dummy]);

  return (
    <group>
      {groups.map(g => (
        <InstanceGroup key={g.key} mat={g.mat} transforms={g.transforms}
          unitRefs={g.unitRefs} selectedUnit={selectedUnit} hoverTypology={hoverTypology} dummy={dummy} />
      ))}
      {bandTransforms.length > 0 && (
        <instancedMesh ref={bandRef} args={[BOX1, SLAB_MAT, bandTransforms.length]} frustumCulled={false} />
      )}
      {capTransforms.length > 0 && (
        <instancedMesh ref={capRef} args={[BOX1, CAP_MAT, capTransforms.length]} frustumCulled={false} />
      )}
      {plinthDeckTransforms.length > 0 && (
        <instancedMesh ref={plinthDeckRef} args={[BOX1, PLINTH_MAT, plinthDeckTransforms.length]} frustumCulled={false} />
      )}
      {accentGroups.map(ag => (
        <AccentGroup key={ag.key} mat={ag.mat} transforms={ag.transforms} dummy={dummy} />
      ))}
      <EdgeOverlay transforms={edgeTransforms} />
      <ClickProxies units={allUnits} onSelectUnit={onSelect} />
    </group>
  );
}

// ─── EdgeOverlay — crisp white outlines on the massing, lag-free ──
// Bakes the shared 12-edge cube wireframe at every box's transform into ONE
// merged line buffer → a single draw call for ALL the edges in the scene,
// regardless of how many thousands of boxes the site has. This is what keeps
// the reference's clean edge look without the per-box LineSegments explosion
// that would tank the framerate on large sites.
function EdgeOverlay({ transforms }) {
  const geo = useMemo(() => {
    if (!transforms || !transforms.length) return null;
    const m = new THREE.Matrix4();
    const parts = transforms.map(({ pos, scale }) => {
      const g = BOX1_EDGES.clone();
      m.compose(
        new THREE.Vector3(pos[0], pos[1], pos[2]),
        _IDENTITY_QUAT,
        new THREE.Vector3(scale[0], scale[1], scale[2]),
      );
      g.applyMatrix4(m);
      return g;
    });
    const merged = parts.length > 1 ? mergeGeometries(parts, false) : parts[0];
    parts.forEach(g => { if (g !== merged) g.dispose(); });
    return merged;
  }, [transforms]);
  useEffect(() => () => { geo?.dispose(); }, [geo]);
  if (!geo) return null;
  return <lineSegments geometry={geo} material={EDGE_MAT} frustumCulled={false} />;
}
const _IDENTITY_QUAT = new THREE.Quaternion();

function AccentGroup({ mat, transforms, dummy }) {
  const ref = useRef();
  useEffect(() => {
    if (!ref.current || !transforms.length) return;
    transforms.forEach(({ pos, scale }, i) => {
      dummy.position.set(...pos); dummy.scale.set(...scale); dummy.updateMatrix();
      ref.current.setMatrixAt(i, dummy.matrix);
    });
    ref.current.instanceMatrix.needsUpdate = true;
  }, [transforms, dummy]);
  if (!transforms.length) return null;
  return <instancedMesh ref={ref} args={[BOX1, mat, transforms.length]} frustumCulled={false} />;
}

const _selected = new THREE.Color('#ffffff');
const _hover = new THREE.Color('#d8d8d8');
const _white = new THREE.Color(1, 1, 1);
const _gold = new THREE.Color('#ffcf4d');

function InstanceGroup({ mat, transforms, unitRefs, selectedUnit, hoverTypology, dummy }) {
  const ref = useRef();

  useEffect(() => {
    if (!ref.current) return;
    transforms.forEach(({ pos, scale }, i) => {
      dummy.position.set(...pos); dummy.scale.set(...scale); dummy.updateMatrix();
      ref.current.setMatrixAt(i, dummy.matrix);
    });
    ref.current.instanceMatrix.needsUpdate = true;
  }, [transforms, dummy]);

  useEffect(() => {
    if (!ref.current || !unitRefs?.length) return;
    const mesh = ref.current;
    unitRefs.forEach((u, i) => {
      if (u === selectedUnit) mesh.setColorAt(i, _selected);
      else if (hoverTypology && u.typologyId === hoverTypology) mesh.setColorAt(i, _hover);
      else mesh.setColorAt(i, _white);
    });
    mesh.instanceColor.needsUpdate = true;
  }, [selectedUnit, hoverTypology, unitRefs]);

  if (!transforms.length) return null;
  return <instancedMesh ref={ref} args={[BOX1, mat, transforms.length]} frustumCulled={false} />;
}

// ─── Open colonnade ground floor ─────────────────────────────────
// Ground floor = columns only, open retail/civic space underneath the slab above.
// This is the BIG / OMA reading: the building hovers on slender columns.
// Each building gets:
//   - A thin overhead slab at floor 1 height (the ceiling of the colonnade)
//   - A grid of slim columns from grade up to that slab
//   - No walls — completely open at grade level
const COL_W   = 0.36;   // column section in metres
const COL_GRID = 4;     // place a column every N cells

const MAT_COLUMN  = mk('#e8e8e8', 0.50, 0.06);
const MAT_SOFFIT  = mk('#d4d4d4', 0.55, 0.04);
const MAT_COLUMN_WARM = MAT_PODIUM_GLB; // same terracotta tone, reused rather than duplicated
const MAT_SOFFIT_WARM = mk('#6e4838', 0.74, 0.04);

// warm=true (GLB stage only) tints the colonnade columns/soffit with the
// same terracotta tone as MAT_PODIUM_GLB — gives the reference render's
// masonry-base read at the building's lifted ground floor, without adding
// new solid wall geometry that would contradict the deliberate open-ground
// colonnade design (see decorateBuilding/OpenColonnade — floor 0 is
// structurally open on columns in this generator, not enclosed).
function OpenColonnade({ buildings, warm = false }) {
  const colRef    = useRef();
  const soffitRef = useRef();
  const dummy     = useMemo(() => new THREE.Object3D(), []);

  const { columns, soffits } = useMemo(() => {
    const columns = [], soffits = [];

    buildings.filter(b => b.units.length > 0 && b.floors >= 2).forEach(b => {
      const bx = b.col * CELL, bz = b.row * CELL;
      const bw = b.w * CELL,   bd = b.d * CELL;
      // Treehouse cluster plinth is measured double-height (~6.4m vs ~3.5m
      // typical floor — see tree_pavilion in the generator); every other
      // concept's colonnade stays the original single floor height.
      const plinthSlab = b.slabs?.find(s => s.plinth);
      const colH  = plinthSlab ? FLOOR_H * 2 : FLOOR_H;
      const slabT = 0.28;         // soffit slab thickness

      // Overhead soffit slab — thin plate at floor 1 level, full footprint
      soffits.push({
        pos:   [bx + bw/2, colH - slabT/2, bz + bd/2],
        scale: [bw - 0.10, slabT, bd - 0.10],
      });

      if (plinthSlab) {
        // Measured trumpet-column density: ~1 column per 16–20 m² of module
        // (see columnCount on the body slab in tree_pavilion) — sparse
        // individual supports, not a dense generic grid.
        const bodySlab = b.slabs.find(s => s.arched);
        const n = Math.max(1, bodySlab?.columnCount || 1);
        const cols2 = Math.max(1, Math.round(Math.sqrt(n * bw / Math.max(bd, 1))));
        const rows2 = Math.max(1, Math.ceil(n / cols2));
        for (let ci = 0; ci < cols2; ci++) {
          for (let ri = 0; ri < rows2; ri++) {
            if (ci * rows2 + ri >= n && n > 1) continue;
            const cx = bx + (ci + 0.5) * (bw / cols2);
            const cz = bz + (ri + 0.5) * (bd / rows2);
            columns.push({ pos: [cx, colH / 2, cz], scale: [COL_W * 1.6, colH - slabT, COL_W * 1.6] });
          }
        }
        return;
      }

      // Column grid — place at every COL_GRID-cell intersection
      const stepC = Math.max(1, Math.floor(b.w / Math.max(1, Math.round(b.w / COL_GRID))));
      const stepR = Math.max(1, Math.floor(b.d / Math.max(1, Math.round(b.d / COL_GRID))));
      for (let dc = 0; dc <= b.w; dc += stepC) {
        for (let dr = 0; dr <= b.d; dr += stepR) {
          const cx = bx + dc * CELL;
          const cz = bz + dr * CELL;
          // Keep columns strictly inside the footprint boundary
          if (cx < bx || cx > bx + bw || cz < bz || cz > bz + bd) continue;
          columns.push({
            pos:   [cx, colH / 2, cz],
            scale: [COL_W, colH - slabT, COL_W],
          });
        }
      }
    });

    return { columns, soffits };
  }, [buildings]);

  useEffect(() => {
    const apply = (ref, list) => {
      if (!ref.current || !list.length) return;
      list.forEach(({ pos, scale }, i) => {
        dummy.position.set(...pos); dummy.scale.set(...scale); dummy.updateMatrix();
        ref.current.setMatrixAt(i, dummy.matrix);
      });
      ref.current.instanceMatrix.needsUpdate = true;
    };
    apply(colRef,    columns);
    apply(soffitRef, soffits);
  }, [columns, soffits, dummy]);

  return (
    <group>
      {soffits.length > 0 && (
        <instancedMesh ref={soffitRef} args={[BOX1, warm ? MAT_SOFFIT_WARM : MAT_SOFFIT, soffits.length]} frustumCulled={false} />
      )}
      {columns.length > 0 && (
        <instancedMesh ref={colRef} args={[BOX1, warm ? MAT_COLUMN_WARM : MAT_COLUMN, columns.length]} frustumCulled={false} />
      )}
    </group>
  );
}

// ─── Landmark tower fins ──────────────────────────────────────────
// Tower-type buildings (type === 'tower') get thin vertical fins on their
// corners — visible from any angle and make towers immediately identifiable
// in the skyline vs. the low residential fabric.
function LandmarkFins({ buildings, maxFloor }) {
  const finRef = useRef();
  const dummy  = useMemo(() => new THREE.Object3D(), []);

  const fins = useMemo(() => {
    const out = [];
    buildings.filter(b => b.type === 'tower' && b.units.length > 0).forEach(b => {
      const fl   = Math.min(b.floors, maxFloor);
      const totalH = fl * FLOOR_H;
      const bx = b.col * CELL, bz = b.row * CELL;
      const bw = b.w * CELL,   bd = b.d * CELL;
      const finW = 0.30, finD = 0.30;
      // 4 corner fins running full building height
      [
        [bx + finW/2,      totalH/2, bz + finD/2],
        [bx + bw - finW/2, totalH/2, bz + finD/2],
        [bx + finW/2,      totalH/2, bz + bd - finD/2],
        [bx + bw - finW/2, totalH/2, bz + bd - finD/2],
      ].forEach(pos => {
        out.push({ pos, scale: [finW, totalH, finD] });
      });
    });
    return out;
  }, [buildings, maxFloor]);

  useEffect(() => {
    if (!finRef.current || !fins.length) return;
    fins.forEach(({ pos, scale }, i) => {
      dummy.position.set(...pos); dummy.scale.set(...scale); dummy.updateMatrix();
      finRef.current.setMatrixAt(i, dummy.matrix);
    });
    finRef.current.instanceMatrix.needsUpdate = true;
  }, [fins, dummy]);

  if (!fins.length) return null;
  return <instancedMesh ref={finRef} args={[BOX1, MAT_TOWER_ACCENT, fins.length]} frustumCulled={false} />;
}

// ─── Balcony slabs — thin horizontal projections at every floor ──────
// They project from the south (z+) and north (z-) faces of mid/high buildings.


// ─── Circulation cores — all elements stay INSIDE the building envelope ──
// Lobby: a recessed dark slot on the ground-floor exterior wall face (flush, not protruding)
// Lift/stair shafts: small boxes inside the building, running full height, on the interior face
function CirculationCores({ buildings, maxFloor }) {
  const lobbyRef = useRef(), liftRef = useRef(), stairRef = useRef(), slabRef = useRef();
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const { lobbies, lifts, stairs, slabs } = useMemo(() => {
    const lobbies = [], lifts = [], stairs = [], slabs = [];

    buildings.filter(b => b.units.length > 0).forEach(b => {
      const fl = Math.min(b.floors, maxFloor);
      const totalH = fl * FLOOR_H;
      const bx = b.col * CELL, bz = b.row * CELL;
      const bw = b.w * CELL,   bd = b.d * CELL;

      // Ground foundation slab — stays entirely under the building
      slabs.push({ pos: [bx + bw/2, 0.12, bz + bd/2], scale: [bw, 0.24, bd] });

      const cc = bw >= 15 ? 2 : 1;

      // Lobby: ground-floor entrance band on the SOUTH face (z = bz+bd), inset 0.1m
      const lobbyW = Math.max(3.0, bw * 0.45);
      const lobbyH = FLOOR_H * 0.88;
      const lobbyD = 0.28;
      lobbies.push({
        pos:   [bx + bw/2, lobbyH/2, bz + bd - lobbyD/2],
        scale: [lobbyW, lobbyH, lobbyD],
      });

      // Lift + stair shafts: inside the building on the south face, full height
      const shaftD = 0.75;
      for (let ci = 0; ci < cc; ci++) {
        const frac = cc === 1 ? 0.5 : (ci === 0 ? 0.28 : 0.72);
        const cx = bx + bw * frac;
        lifts.push({
          pos:   [cx - 0.65, totalH/2, bz + bd - shaftD/2],
          scale: [0.85, totalH, shaftD],
        });
        stairs.push({
          pos:   [cx + 0.80, totalH/2, bz + bd - shaftD/2],
          scale: [1.40, totalH, shaftD],
        });
      }
    });
    return { lobbies, lifts, stairs, slabs };
  }, [buildings, maxFloor]);

  useEffect(() => {
    const apply = (ref, list) => {
      if (!ref.current || !list.length) return;
      list.forEach(({ pos, scale }, i) => {
        dummy.position.set(...pos); dummy.scale.set(...scale); dummy.updateMatrix();
        ref.current.setMatrixAt(i, dummy.matrix);
      });
      ref.current.instanceMatrix.needsUpdate = true;
    };
    apply(slabRef,  slabs);
    apply(lobbyRef, lobbies);
    apply(liftRef,  lifts);
    apply(stairRef, stairs);
  }, [slabs, lobbies, lifts, stairs, dummy]);

  return (
    <group>
      {slabs.length   > 0 && <instancedMesh ref={slabRef}  args={[BOX1, SLAB_MAT,  slabs.length]}  frustumCulled={false} />}
      {lobbies.length > 0 && <instancedMesh ref={lobbyRef} args={[BOX1, LOBBY_MAT, lobbies.length]} frustumCulled={false} />}
      {lifts.length   > 0 && <instancedMesh ref={liftRef}  args={[BOX1, LIFT_MAT,  lifts.length]}   frustumCulled={false} />}
      {stairs.length  > 0 && <instancedMesh ref={stairRef} args={[BOX1, STAIR_MAT, stairs.length]}  frustumCulled={false} />}
    </group>
  );
}

// ─── GLB mesh extraction ──────────────────────────────────────────
// The source room models export every small part (bolts, trim, rebar
// segments — most under 10 triangles) as its own mesh node: 700-1750 mesh
// nodes per room, for only ~3-6k triangles total. Each one became a
// separate <TypologyInstances> (its own VAO + draw call), so loading one
// typology meant 700-1750 WebGL object creations, times 8 typologies —
// that's what made "Render Community in 3D" take 5-8+ seconds even on a
// site with only 84 units. Parts sharing a role share a material anyway,
// so merge same-role geometries into one buffer per role (rarely more
// than 3-4 per room) — same visual result, a tiny fraction of the draw calls.
function extractMeshesFromScene(scene) {
  const parts = [];
  scene.updateMatrixWorld(true);
  scene.traverse(n => {
    if (!n.isMesh) return;
    const geo    = n.geometry.clone();
    geo.applyMatrix4(n.matrixWorld);
    const rawMat = Array.isArray(n.material) ? n.material[0] : n.material;
    parts.push({ geo, role: matRole(rawMat) });
  });
  if (!parts.length) return [];
  const box = new THREE.Box3();
  parts.forEach(p => { p.geo.computeBoundingBox(); box.union(p.geo.boundingBox); });
  const size = new THREE.Vector3(); box.getSize(size);
  const center = new THREE.Vector3(); box.getCenter(center);
  parts.forEach(p => {
    p.geo.translate(-center.x, -box.min.y, -center.z);
    p.geo.scale(
      size.x > 0 ? 1/size.x : 1,
      size.y > 0 ? 1/size.y : 1,
      size.z > 0 ? 1/size.z : 1,
    );
  });

  const byRole = {};
  parts.forEach(p => { (byRole[p.role] ??= []).push(p.geo); });
  return Object.entries(byRole).map(([role, geos]) => {
    const merged = geos.length > 1 ? mergeGeometries(geos, false) : geos[0];
    if (geos.length > 1) geos.forEach(g => g.dispose());
    return { geo: merged, role };
  });
}

// ─── Eager GLB preload at module init — fires before any React render ─
// This eliminates the "click Render → wait N seconds for GLBs" lag entirely.
let _glbCache = null;
const _glbWaiters = [];
{
  const loader = new GLTFLoader();
  Promise.all(GLB_PATHS.map(p => loader.loadAsync(p)))
    .then(gltfs => {
      _glbCache = gltfs.map(g => extractMeshesFromScene(g.scene));
      _glbWaiters.forEach(fn => fn(_glbCache));
      _glbWaiters.length = 0;
    })
    .catch(err => console.error('GLB preload error', err));
}

function useRawGLBMeshes() {
  const [meshes, setMeshes] = useState(_glbCache);
  const { invalidate } = useThree();
  useEffect(() => {
    if (_glbCache) { setMeshes(_glbCache); return; }
    // Still loading — register a waiter
    const fn = m => { setMeshes(m); invalidate(); };
    _glbWaiters.push(fn);
    return () => {
      const idx = _glbWaiters.indexOf(fn);
      if (idx !== -1) _glbWaiters.splice(idx, 1);
    };
  }, [invalidate]);
  return meshes;
}

// ─── Instanced GLB units ──────────────────────────────────────────
function TypologyInstances({ geometry, material, transforms, selectedIdx, isHoveredGroup }) {
  const ref   = useRef();
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => {
    if (!ref.current || !transforms.length) return;
    transforms.forEach(({ pos, scale }, i) => {
      dummy.position.set(...pos); dummy.scale.set(...scale); dummy.updateMatrix();
      ref.current.setMatrixAt(i, dummy.matrix);
    });
    ref.current.instanceMatrix.needsUpdate = true;
  }, [transforms, dummy]);

  useEffect(() => {
    if (!ref.current || !transforms.length) return;
    transforms.forEach((_, i) => {
      if (i === selectedIdx) ref.current.setColorAt(i, _gold);
      else if (isHoveredGroup) ref.current.setColorAt(i, _hover);
      else ref.current.setColorAt(i, _white);
    });
    ref.current.instanceColor.needsUpdate = true;
  }, [selectedIdx, isHoveredGroup, transforms]);

  if (!transforms.length) return null;
  return <instancedMesh ref={ref} args={[geometry, material, transforms.length]} frustumCulled={false} />;
}

function ClickProxies({ units, onSelectUnit }) {
  const ref   = useRef();
  const dummy = useMemo(() => new THREE.Object3D(), []);
  useEffect(() => {
    if (!ref.current) return;
    units.forEach((u, i) => {
      dummy.position.set(
        u.col * CELL + (u.w * CELL) / 2,
        u.floor * FLOOR_H + FLOOR_H / 2,
        u.row * CELL + (u.d * CELL) / 2,
      );
      dummy.scale.set(u.w * CELL - 0.05, FLOOR_H - 0.05, u.d * CELL - 0.05);
      dummy.updateMatrix();
      ref.current.setMatrixAt(i, dummy.matrix);
    });
    ref.current.instanceMatrix.needsUpdate = true;
  }, [units, dummy]);
  const handleClick = useCallback(e => {
    e.stopPropagation();
    if (e.instanceId !== undefined && units[e.instanceId]) onSelectUnit(units[e.instanceId]);
  }, [units, onSelectUnit]);
  return <instancedMesh ref={ref} args={[BOX1, CLICK_MAT, units.length]}
    onClick={handleClick} frustumCulled={false} />;
}

function GLBUnits({ units, selectedUnit, onSelectUnit, maxFloor, filterTypology, hoverTypology }) {
  const allMeshes = useRawGLBMeshes();

  // Group by typology AND floor-band (body vs roof-cap) — one instanced mesh
  // per GLB sub-mesh per band. Splitting by band (not just typology) matters
  // because buildFloorMat() now gives the top floor a distinct dark roof-cap
  // material (see reference render's dark roof level) — batching every floor
  // of a typology into one group and grading off a single "representative"
  // floor would either paint the whole typology as roof-cap, or never
  // surface the roof-cap material at all, depending on which floor got
  // sampled. Two bands keeps draw-call count low (still O(typologies ×
  // meshParts × 2), not O(typologies × floors × meshParts)) while keeping
  // the roof-cap material confined to the floors it's actually meant for.
  const byTypoBand = useMemo(() => {
    const map = {};
    units.forEach(u => {
      if (u.floor < 1) return;
      const glbIdx = TYPO_GLB_INDEX[u.typologyId];
      if (glbIdx === undefined) return;
      const isRoofCap = maxFloor > 1 && u.floor >= maxFloor - 1;
      const key = `${u.typologyId}__${isRoofCap ? 'roof' : 'body'}`;
      if (!map[key]) map[key] = { typoId: u.typologyId, glbIdx, isRoofCap, units: [] };
      map[key].units.push(u);
    });
    return Object.values(map);
  }, [units, maxFloor]);

  const clickableUnits = useMemo(
    () => filterTypology ? units.filter(u => u.typologyId === filterTypology) : units,
    [units, filterTypology],
  );

  if (!allMeshes) return null;
  return (
    <group>
      {byTypoBand.map(({ typoId, glbIdx, isRoofCap, units: uList }) => {
        const meshDefs = allMeshes[glbIdx];
        const typo = TYPOLOGY_MAP[typoId];
        if (!typo || !meshDefs?.length) return null;
        const dimmed = filterTypology && typoId !== filterTypology;
        const transforms = uList.map(u => ({
          pos:   [u.col * CELL + (u.w * CELL)/2, u.floor * FLOOR_H, u.row * CELL + (u.d * CELL)/2],
          scale: [u.w * CELL, FLOOR_H, u.d * CELL],
        }));
        const selectedIdx = selectedUnit ? uList.indexOf(selectedUnit) : -1;
        // Representative floor for grading within this band — every unit in
        // this group is already on the same side of the roof-cap split, so
        // any floor in the group grades correctly (no longer an average
        // across the whole typology's full height range).
        const repFloor = uList[Math.floor(uList.length / 2)]?.floor ?? 1;
        const isHoveredGroup = !!(hoverTypology && typoId === hoverTypology);
        return meshDefs.map((md, mi) => (
          <TypologyInstances key={`${typoId}-${isRoofCap ? 'roof' : 'body'}-${mi}`}
            geometry={md.geo}
            material={dimmed ? MAT_DIMMED : buildFloorMat(md.role, repFloor, maxFloor)}
            transforms={transforms}
            selectedIdx={dimmed ? -1 : selectedIdx}
            isHoveredGroup={isHoveredGroup} />
        ));
      })}
      <ClickProxies units={clickableUnits} onSelectUnit={onSelectUnit} />
    </group>
  );
}

// ─── Environment & lighting setup ─────────────────────────────────
// The PMREM env texture is GPU-resident: it lives in a specific WebGL
// context. Caching it across context loss (or a Canvas remount, which the
// error boundary triggers) hands a dead-context texture to a fresh
// renderer — that's the "Texture marked for update but no image data
// found" warning. So we key the cache to the renderer that produced it and
// regenerate whenever the renderer changes.
let _envTexture = null;
let _envGL = null;
function EnvSetup() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const applyEnv = tex => {
      scene.environment = tex;
      scene.environmentIntensity = 0.28;
      scene.background = new THREE.Color('#000000');
    };

    if (_envTexture && _envGL === gl) {
      applyEnv(_envTexture);
      return;
    }

    // Renderer changed (new context) — drop the stale GPU texture.
    if (_envTexture && _envGL !== gl) {
      _envTexture.dispose?.();
      _envTexture = null;
    }

    const pmrem = new THREE.PMREMGenerator(gl);
    pmrem.compileEquirectangularShader();
    const rt = pmrem.fromScene(new RoomEnvironment(), 0.04);
    _envTexture = rt.texture;
    _envGL = gl;
    applyEnv(_envTexture);
    pmrem.dispose();
  }, [gl, scene]);
  return null;
}

// Eased rAF tween for the orthographic camera's discrete view-mode jumps
// (top/section/iso switch, floor change, compass turn). Deliberately NOT a
// useFrame subscription — it only schedules frames while the tween runs,
// then stops, so it can't drag this component back into a continuous
// render loop under frameloop="demand". Drag-pan stays untouched/instant
// since that needs to track the pointer 1:1, not ease toward a target.
function tweenOrthoCamera(camera, targetRef, from, to, { duration = 450, invalidate }) {
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const start = performance.now();
  let raf = 0;
  function tick(now) {
    const t = Math.min(1, (now - start) / duration);
    const e = easeOutCubic(t);
    const lerp = (a, b) => a + (b - a) * e;
    camera.position.lerpVectors(from.position, to.position, e);
    targetRef.current.lerpVectors(from.target, to.target, e);
    camera.up.lerpVectors(from.up, to.up, e).normalize();
    camera.left   = lerp(from.left,   to.left);
    camera.right  = lerp(from.right,  to.right);
    camera.top    = lerp(from.top,    to.top);
    camera.bottom = lerp(from.bottom, to.bottom);
    camera.near   = lerp(from.near,   to.near);
    camera.far    = lerp(from.far,    to.far);
    camera.zoom   = lerp(from.zoom,   to.zoom);
    camera.lookAt(targetRef.current);
    camera.updateProjectionMatrix();
    invalidate();
    if (t < 1) raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

// ─── Camera ───────────────────────────────────────────────────────
function IsoCamera({ cols, rows, buildings, sitePolyGrid, floorMax, viewMode, sectionY, compassAz }) {
  const { camera, gl, invalidate } = useThree();
  const target  = useRef(new THREE.Vector3());
  const zoom    = useRef(1);
  const drag    = useRef(null);

  // Fit camera once whenever layout params change — useEffect not useFrame
  useEffect(() => {
    // Real site polygons are rarely rectangular, so buildings often occupy
    // only part of the cols x rows bounding box (e.g. a triangular or
    // L-shaped site within a rectangular grid). Framing the camera to the
    // full grid extent left buildings as a tiny speck in one corner on
    // irregular/large sites. Frame to where the buildings actually are,
    // falling back to the full grid only if there's nothing to measure.
    let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
    (buildings || []).forEach(b => {
      if (!b.units?.length) return;
      minC = Math.min(minC, b.col); maxC = Math.max(maxC, b.col + b.w);
      minR = Math.min(minR, b.row); maxR = Math.max(maxR, b.row + b.d);
    });
    const hasBuildings = Number.isFinite(minC) && Number.isFinite(minR);
    const padCells = 3;
    const bC0 = hasBuildings ? Math.max(0, minC - padCells) : 0;
    const bC1 = hasBuildings ? Math.min(cols, maxC + padCells) : cols;
    const bR0 = hasBuildings ? Math.max(0, minR - padCells) : 0;
    const bR1 = hasBuildings ? Math.min(rows, maxR + padCells) : rows;

    const w = (bC1 - bC0) * CELL, d = (bR1 - bR0) * CELL, h = floorMax * FLOOR_H;
    const cx = (bC0 + (bC1 - bC0) / 2) * CELL, cz = (bR0 + (bR1 - bR0) / 2) * CELL;
    const aspect = gl.domElement.clientWidth / gl.domElement.clientHeight;

    // Orthographic near/far clip the scene relative to the camera's own
    // position, along its view direction — they must scale with the site's
    // size. A fixed ±2000 clipped large/wide real sites (>~900m) completely
    // out of view: dist exceeded far=2000 so nothing was ever in range,
    // producing a perfectly-generated but totally invisible scene with no
    // error anywhere. Scale clip range to the largest dimension in play,
    // with generous margin, so this can't recur regardless of site size.
    const clipRange = Math.max(w, d, h, 2000) * 1.5;

    // Snapshot current camera state as the tween's "from" before computing
    // the new "to" — capturing before any mutation so a tween interrupted by
    // a rapid second click still starts from where the camera actually is.
    const from = {
      position: camera.position.clone(), up: camera.up.clone(), target: target.current.clone(),
      left: camera.left, right: camera.right, top: camera.top, bottom: camera.bottom,
      near: camera.near, far: camera.far, zoom: camera.zoom,
    };
    let to;
    const newTarget = new THREE.Vector3(cx, 0, cz);

    if (viewMode === 'top') {
      const half = Math.max(w, d) * 0.58;
      to = {
        position: new THREE.Vector3(cx, 1000, cz), up: new THREE.Vector3(0, 0, -1), target: new THREE.Vector3(cx, 0, cz),
        left: -half * aspect, right: half * aspect, top: half, bottom: -half,
        near: -clipRange, far: clipRange, zoom: 1,
      };
    } else if (viewMode === 'section') {
      const halfW = Math.max(w, h) * 0.62;
      to = {
        position: new THREE.Vector3(cx, sectionY * FLOOR_H, -200), up: new THREE.Vector3(0, 1, 0), target: new THREE.Vector3(cx, sectionY * FLOOR_H, cz),
        left: -halfW * aspect, right: halfW * aspect, top: halfW, bottom: -halfW,
        near: -clipRange, far: clipRange, zoom: 1,
      };
    } else {
      const dist = Math.max(w, d, h) * 2.2;
      // azimuth in radians — 0° = North (−Z), 90° = East (+X)
      const azRad = ((compassAz ?? 45) * Math.PI) / 180;
      const half = Math.max(w, d) * 0.56;
      const clip = Math.max(clipRange, dist * 1.5);
      to = {
        position: new THREE.Vector3(cx + dist * Math.sin(azRad), dist * Math.tan(Math.atan(1 / Math.sqrt(2))) * 1.8, cz + dist * Math.cos(azRad)),
        up: new THREE.Vector3(0, 1, 0), target: newTarget,
        left: -half * aspect, right: half * aspect, top: half, bottom: -half,
        near: -clip, far: clip, zoom: 1,
      };
      zoom.current = 1;
    }
    const cancel = tweenOrthoCamera(camera, target, from, to, { invalidate });
    invalidate();
    return cancel;
  }, [cols, rows, buildings, floorMax, viewMode, sectionY, compassAz, camera, gl, invalidate]);

  // Raw wheel/mousemove events can fire 60–120+ times/second — each handler
  // below does camera math + updateProjectionMatrix + invalidate(), and with
  // frameloop="demand" every invalidate() pays for a full render (shadow
  // pass + every instanced mesh in the scene). Firing that per raw event
  // queued multiple full renders within a single browser frame, which is
  // what made panning/zooming feel laggy on anything but the smallest
  // sites. Coalescing to one rAF-scheduled update per frame fixes that
  // without changing the math or the visible behaviour at all.
  const pendingWheel = useRef(null);
  const pendingMove  = useRef(null);
  const rafId        = useRef(null);

  const flush = useCallback(() => {
    rafId.current = null;
    if (pendingWheel.current != null) {
      zoom.current = Math.max(0.3, Math.min(14, zoom.current * (1 - pendingWheel.current * 0.001)));
      camera.zoom = zoom.current;
      camera.updateProjectionMatrix();
      pendingWheel.current = null;
    }
    if (pendingMove.current) {
      const { clientX, clientY, el } = pendingMove.current;
      pendingMove.current = null;
      const half = Math.max(cols * CELL, rows * CELL) * 0.72;
      const aspect = el.clientWidth / el.clientHeight;
      const visW = (half * 2 * aspect) / camera.zoom;
      const visH = (half * 2) / camera.zoom;
      // Screen-relative drag must rotate by the CURRENT compass bearing, not
      // a hardcoded 45° — otherwise panning drags in the wrong direction
      // (and the reposition below snaps the camera back toward the 45°
      // bearing) whenever the user has picked a different compass facing.
      const azRad = ((compassAz ?? 45) * Math.PI) / 180;
      const dx = (clientX - drag.current.x) / el.clientWidth  * visW;
      const dy = (clientY - drag.current.y) / el.clientHeight * visH;
      const px =  dx * Math.cos(azRad) + dy * Math.sin(azRad);
      const pz = -dx * Math.sin(azRad) + dy * Math.cos(azRad);
      target.current.x = drag.current.tx - px * 0.85;
      target.current.z = drag.current.tz + pz * 0.85;
      const w = cols * CELL, d = rows * CELL;
      const dist = Math.max(w, d, floorMax * FLOOR_H) * 2.2;
      camera.position.set(
        target.current.x + dist * Math.sin(azRad),
        camera.position.y,
        target.current.z + dist * Math.cos(azRad),
      );
      camera.lookAt(target.current);
    }
    invalidate();
  }, [camera, cols, rows, floorMax, invalidate, compassAz]);

  const scheduleFlush = useCallback(() => {
    if (rafId.current == null) rafId.current = requestAnimationFrame(flush);
  }, [flush]);

  useEffect(() => {
    const el = gl.domElement;
    const onWheel = e => {
      e.preventDefault();
      pendingWheel.current = (pendingWheel.current || 0) + e.deltaY;
      scheduleFlush();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [gl, scheduleFlush]);

  useEffect(() => {
    if (viewMode === 'top' || viewMode === 'section') return;
    const el = gl.domElement;
    const onDown = e => {
      if (e.button !== 1 && e.button !== 2) return;
      e.preventDefault();
      drag.current = { x: e.clientX, y: e.clientY, tx: target.current.x, tz: target.current.z };
    };
    const onMove = e => {
      if (!drag.current) return;
      pendingMove.current = { clientX: e.clientX, clientY: e.clientY, el };
      scheduleFlush();
    };
    const onUp = () => { drag.current = null; };
    el.addEventListener('mousedown', onDown);
    el.addEventListener('mousemove', onMove);
    el.addEventListener('mouseup',   onUp);
    el.addEventListener('contextmenu', e => e.preventDefault());
    return () => {
      if (rafId.current != null) { cancelAnimationFrame(rafId.current); rafId.current = null; }
      el.removeEventListener('mousedown', onDown);
      el.removeEventListener('mousemove', onMove);
      el.removeEventListener('mouseup',   onUp);
    };
  }, [camera, gl, cols, rows, floorMax, invalidate, viewMode]);

  return null;
}

// ─── Section plane ────────────────────────────────────────────────
const _sectionPlaneMat = new THREE.MeshBasicMaterial({
  color: '#e8e4da', transparent: true, opacity: 0.07,
  side: THREE.DoubleSide, depthWrite: false,
});
const _sectionEdgeMat = new THREE.LineBasicMaterial({ color: '#e8e4da' });

function SectionPlane({ cols, rows, sectionY }) {
  const y = sectionY * FLOOR_H + FLOOR_H * 0.5;
  const w = cols * CELL, d = rows * CELL;
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(w + 2, d + 2);
    g.rotateX(-Math.PI / 2); g.translate(w/2, 0, d/2);
    return g;
  }, [w, d]);
  const edgeObj = useMemo(() => {
    const eg = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0,0,0), new THREE.Vector3(w,0,0),
      new THREE.Vector3(w,0,d), new THREE.Vector3(0,0,d),
      new THREE.Vector3(0,0,0),
    ]);
    return new THREE.Line(eg, _sectionEdgeMat);
  }, [w, d]);
  useEffect(() => () => { geo.dispose(); edgeObj.geometry.dispose(); }, [geo, edgeObj]);
  return (
    <group position={[0, y, 0]}>
      <mesh geometry={geo} material={_sectionPlaneMat} />
      <primitive object={edgeObj} />
    </group>
  );
}


// ─── Shared scene ─────────────────────────────────────────────────
// On very large sites (thousands of units), the heavy child components
// (instanced meshes, merged road/podium geometries) can still be finishing
// their own useMemo/useEffect setup after this first invalidate() fires —
// with frameloop="demand" that race meant the canvas could stay blank even
// though generation had completed. A short burst of follow-up invalidations
// (declining frequency, ~1.5s total) guarantees a frame paints once
// everything has actually settled, with no cost once the canvas is idle.
function PlanInvalidator({ planKey, hoverTypology, maxFloor, filterTypology }) {
  const { invalidate, gl } = useThree();
  useEffect(() => {
    // Shadow maps are computed in light-space from shadow-casting geometry —
    // panning/zooming the camera never changes either, so re-rendering the
    // shadow map on every pan/zoom-triggered invalidate() (the three.js
    // default) was pure waste: a full shadow pass over every instanced mesh
    // for a frame where nothing shadow-relevant moved. Recompute it once
    // per actual geometry/selection change (this effect's deps) and leave
    // it frozen for the camera-only renders in between.
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
    invalidate();
    const delays = [50, 150, 300, 600, 1000, 1500];
    const timers = delays.map(ms => setTimeout(() => { gl.shadowMap.needsUpdate = true; invalidate(); }, ms));
    return () => timers.forEach(clearTimeout);
  }, [planKey, hoverTypology, maxFloor, filterTypology, invalidate, gl]);
  return null;
}

function SharedScene({ plan, maxFloor, siteGlb, geoRef, viewMode, sectionY, compassAz, stage, hoverTypology, filterTypology, showSolar, children }) {
  const { buildings, greenZones, cols, rows, floors, podiumCells, bridges, exteriorStairs,
          pavilions, deckGardens, promenade, roads } = plan;
  // Include cols/rows/totalUnits so two different sites that happen to land
  // on the same seed number still produce a distinct key — otherwise the
  // PlanInvalidator effect below wouldn't re-fire on site change, leaving
  // the camera unrefit and the canvas showing the previous site's frame.
  const planKey = `${plan.seed}-${siteGlb ?? 'nosite'}-${stage}-${cols}x${rows}-${plan.totalUnits}`;
  const buildingCellSet = useMemo(() => {
    const s = new Set();
    buildings.forEach(b => {
      if (!b.units.length) return;
      for (let dc = 0; dc < b.w; dc++)
        for (let dr = 0; dr < b.d; dr++) s.add(`${b.col + dc},${b.row + dr}`);
    });
    return s;
  }, [buildings]);
  return (
    <>
      <PlanInvalidator planKey={planKey} hoverTypology={hoverTypology} maxFloor={maxFloor} filterTypology={filterTypology} />
      <EnvSetup />
      {/* Three-point lighting.
          The main light's shadow camera frustum defaults to a tiny ±5 box —
          fine for a single room, but a masterplan spans tens to hundreds of
          metres. Anything outside that default box fell outside the shadow
          map entirely and rendered fully shadowed (visually black once you
          zoomed in close enough to be looking at it, since ambient alone
          isn't bright enough to read). Size the frustum to the real site
          extent (cols/rows × CELL) so the whole plan is actually covered. */}
      <ambientLight intensity={0.55} color="#3a3a3a" />
      <directionalLight
        position={[80, 160, 60]} intensity={2.8} color="#ffffff" castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-Math.max(cols, rows) * CELL * 0.75}
        shadow-camera-right={Math.max(cols, rows) * CELL * 0.75}
        shadow-camera-top={Math.max(cols, rows) * CELL * 0.75}
        shadow-camera-bottom={-Math.max(cols, rows) * CELL * 0.75}
        shadow-camera-near={1}
        shadow-camera-far={Math.max(cols, rows) * CELL * 3}
        shadow-bias={-0.0003}
      />
      <directionalLight position={[-60, 80, -50]} intensity={0.60} color="#ffffff" />
      <directionalLight position={[20, 30, -100]} intensity={0.30} color="#ffffff" />

      <SiteFloor cols={cols} rows={rows} sitePolyGrid={plan.sitePolyGrid} />
      <ArchGrid cols={cols} rows={rows} />
      <DistrictZones plan={plan} />
      {geoRef && <OsmContext geoRef={geoRef} />}
      {siteGlb && <SitePavedGround glbPath={siteGlb} cols={cols} rows={rows} />}
      <SiteOutline glbPath={siteGlb} cols={cols} rows={rows} />
      <GreenZones cells={greenZones} />
      <RoadNetwork roads={roads} />
      <SolarHeatmap plan={plan} show={showSolar} />
      <PodiumDeck cells={podiumCells} buildingCells={buildingCellSet} />
      <PodiumProgram pavilions={pavilions} deckGardens={deckGardens} />
      <OpenColonnade buildings={buildings} warm={stage === 'glb'} />
      <LandmarkFins buildings={buildings} maxFloor={maxFloor} />
      <CirculationCores buildings={buildings} maxFloor={maxFloor} />
      <RoofTerraces buildings={buildings} maxFloor={maxFloor} />
      <SkyBridges bridges={bridges} />
      <ExteriorStairs stairs={exteriorStairs} />
      <Promenade steps={promenade} />

      {viewMode === 'section' && <SectionPlane cols={cols} rows={rows} sectionY={sectionY} />}
      {children}
      <IsoCamera cols={cols} rows={rows} buildings={buildings} floorMax={floors.max} viewMode={viewMode} sectionY={sectionY} compassAz={compassAz} />
    </>
  );
}

// ─── Build-sequence overlay ───────────────────────────────────────
// A translucent box per building, colour-coded by construction phase at the
// scrubbed week. Deliberately a SEPARATE instanced layer drawn on top of
// BoxMassing rather than recolouring BoxMassing's own instances — BoxMassing
// batches its boxes by floor-band material across ALL buildings (not per
// building), so there's no per-building handle to recolour without
// restructuring that grouping. A standalone overlay needs no such surgery
// and can be toggled on/off for free.
const PHASE_COLOR = {
  sourcing: '#5ba3c9',
  casting:  '#c9a96e',
  delivery: '#8dab80',
  assembly: '#a78bfa',
  done:     '#e8e4da',
};
const _phaseColorObj = new THREE.Color();

function BuildSequenceOverlay({ plan, buildWeek, sequence }) {
  const ref = useRef();
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const entries = useMemo(() => {
    if (!sequence) return [];
    const byId = new Map(plan.buildings.map(b => [b.id, b]));
    return sequence.buildings.map(s => ({ s, b: byId.get(s.id) })).filter(e => e.b);
  }, [plan, sequence]);

  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    entries.forEach(({ s, b }, i) => {
      const phase = phaseAtWeek(s.weeks, buildWeek);
      const started = buildWeek >= 0;
      const x = b.col * CELL + (b.w * CELL) / 2;
      const z = b.row * CELL + (b.d * CELL) / 2;
      const h = phase === 'done' || phase === 'assembly' ? b.floors * FLOOR_H : Math.max(FLOOR_H * 0.5, b.floors * FLOOR_H * 0.92);
      dummy.position.set(x, h / 2, z);
      dummy.scale.set(
        Math.max(0.5, b.w * CELL - 0.3),
        started && phase !== 'sourcing' ? h : 0.15,
        Math.max(0.5, b.d * CELL - 0.3)
      );
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      _phaseColorObj.set(PHASE_COLOR[phase] || '#888888');
      mesh.setColorAt(i, _phaseColorObj);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [entries, buildWeek, dummy]);

  if (!entries.length) return null;
  return (
    <instancedMesh ref={ref} args={[BOX1, undefined, entries.length]} renderOrder={5}>
      <meshStandardMaterial transparent opacity={0.55} roughness={0.5} depthWrite={false} />
    </instancedMesh>
  );
}

function BoxScene({ plan, maxFloor, onSelectUnit, selectedUnit, siteGlb, geoRef, viewMode, sectionY, compassAz, filterTypology, hoverTypology, stage, showSolar, buildWeek, buildSequence }) {
  const { buildings } = plan;
  return (
    <SharedScene plan={plan} maxFloor={maxFloor} onSelectUnit={onSelectUnit}
      selectedUnit={selectedUnit} siteGlb={siteGlb} geoRef={geoRef} viewMode={viewMode} sectionY={sectionY} compassAz={compassAz} stage={stage} hoverTypology={hoverTypology} filterTypology={filterTypology} showSolar={showSolar}>
      <BoxMassing
        buildings={buildings}
        maxFloor={maxFloor}
        filterTypology={filterTypology}
        hoverTypology={hoverTypology}
        selectedUnit={selectedUnit}
        onSelect={onSelectUnit}
      />
      {buildWeek !== null && buildSequence && (
        <BuildSequenceOverlay plan={plan} buildWeek={buildWeek} sequence={buildSequence} />
      )}
      <GLBWarmup />
    </SharedScene>
  );
}

// Pre-compiles every GLB typology's shader programs while the user is still
// looking at the box-massing view, so clicking "Render Community in 3D"
// doesn't pay for first-time WebGL shader compilation + buffer upload on
// the spot. Measured 5-8s of GPU/driver time on that first switch (mostly
// native shader compile, not JS) even on small sites — that's the actual
// "stuck after generator" feeling. Renders one zero-scale instance of each
// typology's meshes; invisible, but forces Three.js to compile every
// material/geometry combo the real GLBScene will need.
function GLBWarmup() {
  const allMeshes = useRawGLBMeshes();
  const { gl, camera, scene } = useThree();
  const warmedRef = useRef(false);
  useEffect(() => {
    if (!allMeshes || warmedRef.current) return;
    warmedRef.current = true;
    const group = new THREE.Group();
    group.scale.set(0, 0, 0);
    Object.entries(TYPO_GLB_INDEX).forEach(([typoId, glbIdx]) => {
      const meshDefs = allMeshes[glbIdx];
      if (!meshDefs?.length) return;
      meshDefs.forEach(md => {
        const mat = md.role === 'glass' ? MAT_GLASS
          : md.role === 'frame' ? frameMat(0, 1)
          : floorMat(0, 1, false);
        group.add(new THREE.InstancedMesh(md.geo, mat, 1));
      });
    });
    scene.add(group);
    gl.compile(scene, camera);
    scene.remove(group);
  }, [allMeshes, gl, camera, scene]);
  return null;
}

function GLBScene({ plan, maxFloor, onSelectUnit, selectedUnit, siteGlb, geoRef, viewMode, sectionY, compassAz, filterTypology, hoverTypology, stage, showSolar }) {
  const { buildings } = plan;
  const visibleUnits = useMemo(() => {
    const out = [];
    buildings.forEach(b => b.units.forEach(u => { if (u.floor < maxFloor) out.push(u); }));
    return out;
  }, [buildings, maxFloor]);
  return (
    <SharedScene plan={plan} maxFloor={maxFloor} onSelectUnit={onSelectUnit}
      selectedUnit={selectedUnit} siteGlb={siteGlb} geoRef={geoRef} viewMode={viewMode} sectionY={sectionY} compassAz={compassAz} stage={stage} hoverTypology={hoverTypology} filterTypology={filterTypology} showSolar={showSolar}>
      <GLBUnits units={visibleUnits} selectedUnit={selectedUnit}
        onSelectUnit={onSelectUnit} maxFloor={maxFloor} filterTypology={filterTypology} hoverTypology={hoverTypology} />
    </SharedScene>
  );
}

// ─── View toolbar buttons ─────────────────────────────────────────
const VIEW_BUTTONS = [
  { id: 'iso',     label: '3D' },
  { id: 'top',     label: '⊤ Plan' },
  { id: 'section', label: '✂ Section' },
];

// Compass iso angles — azimuth in degrees, elevation fixed
const COMPASS_DIRS = [
  { id: 'NE', az: 45  },
  { id: 'SE', az: 135 },
  { id: 'SW', az: 225 },
  { id: 'NW', az: 315 },
  { id: 'N',  az: 0   },
  { id: 'E',  az: 90  },
  { id: 'S',  az: 180 },
  { id: 'W',  az: 270 },
];

// ─── HUD constants ────────────────────────────────────────────────
const HUD_FONT = "'JetBrains Mono', 'Fira Mono', ui-monospace, monospace";
const HUD_SERIF = "'DM Serif Display', Georgia, serif";
const HUD_GLASS = {
  background: 'rgba(4,4,6,0.88)',
  backdropFilter: 'blur(18px)',
  WebkitBackdropFilter: 'blur(18px)',
  border: '1px solid rgba(255,255,255,0.072)',
};
const ACCENT = '#e8e4da';
const ACCENT_DIM = 'rgba(232,228,218,0.55)';

// ─── Public component ─────────────────────────────────────────────
// Some sites' polygons are degenerate enough (extreme aspect ratio, weird
// vertex layout) that the 3D scene build throws partway through and the
// canvas is left rendering nothing — a silent black screen with no clue
// why. This boundary catches that and shows a clear message + a way back
// to pick another site, instead of an unexplained blank viewport.
class MasterplanErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('MasterplanViewer scene failed to render:', error, info); }
  render() {
    if (this.state.error) {
      return (
        <div className="viewer-empty" style={{ flexDirection: 'column', gap: '0.6rem', textAlign: 'center', padding: '2rem' }}>
          <div>This site's boundary couldn't be rendered as a 3D massing model.</div>
          <div style={{ opacity: 0.6, fontSize: '0.85em' }}>Try a different design seed, or go back and pick another site.</div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function MasterplanViewer({ plan, maxFloor, onSelectUnit, selectedUnit, stage, siteGlb, geoRef, filterTypology, hoverTypology, showSolar, buildWeek, buildSequence }) {
  const [viewMode,  setViewMode]  = useState('iso');
  const [sectionY,  setSectionY]  = useState(0);
  const [compassAz, setCompassAz] = useState(45);

  if (!plan) return <div className="viewer-empty">Generate a plan to begin.</div>;

  // Must match the cell size the generator actually used for this plan's
  // grid — see the CELL declaration above for why this matters.
  CELL = plan.cellSize || 2.0;

  const isGLB    = stage === 'glb';
  const floorMax = plan.floors.max;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#000000' }}>
      <MasterplanErrorBoundary key={`${plan.seed}-${siteGlb ?? 'nosite'}`}>
        <Canvas
          orthographic
          camera={{ zoom: 1, near: -2000, far: 2000, position: [100, 100, 100] }}
          gl={{
            antialias:            true,
            toneMapping:          THREE.ACESFilmicToneMapping,
            toneMappingExposure:  1.15,
            powerPreference:      'high-performance',
            logarithmicDepthBuffer: false,
            alpha:                false,
            stencil:              false,
          }}
          dpr={Math.min(window.devicePixelRatio, 1.5)}
          frameloop="demand"
          style={{ width: '100%', height: '100%', background: '#000000' }}
        >
          {!isGLB
            ? <BoxScene plan={plan} maxFloor={maxFloor} onSelectUnit={onSelectUnit}
                selectedUnit={selectedUnit} siteGlb={siteGlb} geoRef={geoRef} stage={stage}
                viewMode={viewMode} sectionY={sectionY} compassAz={compassAz}
                filterTypology={filterTypology} hoverTypology={hoverTypology} showSolar={showSolar}
                buildWeek={buildWeek} buildSequence={buildSequence} />
            : <GLBScene plan={plan} maxFloor={maxFloor} onSelectUnit={onSelectUnit}
                selectedUnit={selectedUnit} siteGlb={siteGlb} geoRef={geoRef} stage={stage}
                viewMode={viewMode} sectionY={sectionY} compassAz={compassAz}
                filterTypology={filterTypology} hoverTypology={hoverTypology} showSolar={showSolar} />
          }
        </Canvas>
      </MasterplanErrorBoundary>

      {/* ── Top-left: concept label + scale badge ── */}
      <div style={{
        position: 'absolute', top: '1rem', left: '1.2rem',
        display: 'flex', flexDirection: 'column', gap: '0.45rem',
        fontFamily: HUD_FONT, pointerEvents: 'none',
      }}>
        <div style={{ ...HUD_GLASS, padding: '0.55rem 0.85rem', display: 'flex', flexDirection: 'column', gap: '0.18rem' }}>
          <div style={{ fontFamily: HUD_FONT, fontSize: '0.52rem', color: 'rgba(240,236,226,0.55)', letterSpacing: '0.22em', textTransform: 'uppercase' }}>
            {isGLB ? '03 / Community' : '02 / Masterplan'}
          </div>
          <div style={{ fontFamily: HUD_SERIF, fontSize: '1.05rem', color: '#ede9e0', letterSpacing: '-0.02em', lineHeight: 1.1, fontStyle: 'italic' }}>
            {plan.conceptLabel || 'Urban Masterplan'}
          </div>
        </div>
        <div style={{ ...HUD_GLASS, padding: '0.38rem 0.75rem', display: 'flex', gap: '1.2rem' }}>
          {[
            ['Units', plan.totalUnits],
            ['Floors', `${plan.floors.min}–${plan.floors.max}`],
            ['Green', `${plan.greenPercent}%`],
          ].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: '0.06rem' }}>
              <span style={{ fontSize: '0.82rem', color: ACCENT, fontFamily: HUD_SERIF, fontWeight: 400, lineHeight: 1 }}>{v}</span>
              <span style={{ fontSize: '0.50rem', color: 'rgba(237,233,224,0.28)', letterSpacing: '0.15em', textTransform: 'uppercase' }}>{k}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Top-centre: view mode switcher ── */}
      <div style={{
        position: 'absolute', top: '1rem', left: '50%', transform: 'translateX(-50%)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.3rem',
        fontFamily: HUD_FONT,
      }}>
        <div style={{ ...HUD_GLASS, display: 'flex', gap: '1px', padding: '3px' }}>
          {VIEW_BUTTONS.map(b => (
            <button key={b.id} onClick={() => setViewMode(b.id)} style={{
              background: viewMode === b.id ? ACCENT : 'transparent',
              color:      viewMode === b.id ? '#060605' : 'rgba(237,233,224,0.40)',
              border: 'none',
              padding: '0.28rem 1rem', fontSize: '0.60rem',
              fontFamily: HUD_FONT,
              fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase',
              cursor: 'pointer', transition: 'background 0.13s, color 0.13s',
              whiteSpace: 'nowrap',
            }}>
              {b.label}
            </button>
          ))}
        </div>

        {viewMode === 'iso' && (
          <div style={{ ...HUD_GLASS, display: 'grid', gridTemplateColumns: 'repeat(8, auto)', gap: '1px', padding: '3px' }}>
            {COMPASS_DIRS.map(d => (
              <button key={d.id} onClick={() => setCompassAz(d.az)} style={{
                background: compassAz === d.az ? 'rgba(232,228,218,0.14)' : 'transparent',
                color: compassAz === d.az ? ACCENT : 'rgba(237,233,224,0.28)',
                border: compassAz === d.az ? `1px solid rgba(232,228,218,0.36)` : '1px solid transparent',
                padding: '0.18rem 0.48rem',
                fontFamily: HUD_FONT,
                fontSize: '0.60rem', fontWeight: 700, letterSpacing: '0.08em',
                cursor: 'pointer', transition: 'all 0.1s',
                minWidth: '2rem', textAlign: 'center',
              }}>
                {d.id}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Section floor slider ── */}
      {viewMode === 'section' && (
        <div style={{
          position: 'absolute', bottom: '3.8rem', left: '50%', transform: 'translateX(-50%)',
          display: 'flex', alignItems: 'center', gap: '0.8rem',
          ...HUD_GLASS, padding: '0.5rem 1.2rem',
          fontFamily: HUD_FONT,
        }}>
          <span style={{ fontSize: '0.52rem', color: ACCENT_DIM, letterSpacing: '0.18em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Section</span>
          <span style={{ fontFamily: HUD_SERIF, fontSize: '1.1rem', color: ACCENT, letterSpacing: '-0.02em', minWidth: '3rem' }}>
            {sectionY === 0 ? 'GF' : `+${sectionY}`}
          </span>
          <input type="range" min={0} max={Math.max(0, floorMax - 1)} value={sectionY}
            onChange={e => setSectionY(+e.target.value)}
            style={{ width: '140px', accentColor: ACCENT, height: '2px' }}
          />
          <span style={{ fontSize: '0.50rem', color: 'rgba(237,233,224,0.22)', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>
            of {floorMax} floors
          </span>
        </div>
      )}

      {/* ── Bottom-centre: controls hint ── */}
      <div style={{
        position: 'absolute', bottom: '1rem', left: '50%', transform: 'translateX(-50%)',
        display: 'flex', gap: '1.4rem',
        ...HUD_GLASS, padding: '0.34rem 1.1rem',
        pointerEvents: 'none', fontFamily: HUD_FONT,
      }}>
        {[['Scroll', 'zoom'], ['Mid / Right drag', 'pan']].map(([k, v]) => (
          <span key={k} style={{ fontSize: '0.56rem', color: 'rgba(237,233,224,0.22)', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
            <span style={{ color: ACCENT_DIM, fontWeight: 700 }}>{k}</span>{' — '}{v}
          </span>
        ))}
      </div>

      {/* ── Bottom-left: scale bar ── */}
      <div style={{
        position: 'absolute', bottom: '1rem', left: '1.2rem',
        pointerEvents: 'none', fontFamily: HUD_FONT,
      }}>
        <div style={{ ...HUD_GLASS, padding: '0.38rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          <div style={{ display: 'flex', gap: 0 }}>
            {[0,1,2,3].map(i => (
              <div key={i} style={{
                width: '20px', height: '4px',
                background: i % 2 === 0 ? 'rgba(232,228,218,0.6)' : 'rgba(255,255,255,0.12)',
                borderRight: i < 3 ? '1px solid rgba(0,0,0,0.3)' : 'none',
              }} />
            ))}
          </div>
          <span style={{ fontSize: '0.48rem', color: 'rgba(237,233,224,0.30)', letterSpacing: '0.12em' }}>
            0 — {(CELL * 4 * 4).toFixed(0)}m
          </span>
        </div>
      </div>

      {/* ── Bottom-right: stage indicator ── */}
      <div style={{
        position: 'absolute', bottom: '1rem', right: '1.2rem',
        pointerEvents: 'none', fontFamily: HUD_FONT,
      }}>
        <div style={{ ...HUD_GLASS, padding: '0.38rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div style={{
            width: '6px', height: '6px', borderRadius: '50%',
            background: isGLB ? '#4caf7d' : ACCENT,
            boxShadow: `0 0 6px ${isGLB ? '#4caf7d' : ACCENT}`,
          }} />
          <span style={{ fontSize: '0.52rem', color: isGLB ? '#4caf7d' : ACCENT, letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 700 }}>
            {isGLB ? 'Rendered' : 'Massing'}
          </span>
        </div>
      </div>
    </div>
  );
}
