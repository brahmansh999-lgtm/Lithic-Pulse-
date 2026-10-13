/**
 * Extract real per-unit-cell programme for small/large/xl GLBs, the same way
 * extractProgramme3.mjs did for medium (which produced RAW_FLOORS): cluster
 * the internal_walls + floor-plate meshes per floor into real unit-cell
 * bounding boxes (not a single whole-building envelope), plus real service
 * (staircase/lift) and community (community_space/PLINTH) boxes per floor.
 *
 * Run: node scripts/extractProgramme4.mjs
 * Writes public/BLDGS/programme_<class>.json for small/large/xl.
 */
import { createRequire } from 'module';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dir, '..');

const THREE = require('three');
if (typeof globalThis.self === 'undefined') globalThis.self = globalThis;

const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
const { DRACOLoader } = await import('three/examples/jsm/loaders/DRACOLoader.js');

const draco = new DRACOLoader();
draco.setDecoderPath(resolve(root, 'node_modules/three/examples/jsm/libs/draco/'));
draco.setDecoderConfig({ type: 'js' });

const CLASSES = [
  { sizeClass: 'small', glb: 'BLDGS/glbsmall.glb' },
  { sizeClass: 'large', glb: 'BLDGS/glblarge.glb' },
  { sizeClass: 'xl',    glb: 'BLDGS/glbXL.glb' },
];

// Recovered originals (bldg_gl/iteration N.glb, restored from the Recycle
// Bin — see MEMORY: masterplan-site-scale / seed-building expansion). 10
// genuinely distinct real buildings (iteration 6 is a byte-identical
// duplicate of iteration 1, skipped). Run with `node scripts/
// extractProgramme4.mjs --recovered` to extract these instead of the 3
// shipped classes above, writing public/BLDGS/programme_iterationN.json.
const RECOVERED_CLASSES = [
  { sizeClass: 'iteration1',  glb: 'bldg_gl/iteration 1.glb' },
  { sizeClass: 'iteration2',  glb: 'bldg_gl/iteration 2.glb' },
  { sizeClass: 'iteration3',  glb: 'bldg_gl/iteration 3.glb' },
  { sizeClass: 'iteration4',  glb: 'bldg_gl/iteration 4.glb' },
  { sizeClass: 'iteration5',  glb: 'bldg_gl/iteration 5.glb' },
  { sizeClass: 'iteration7',  glb: 'bldg_gl/iteration 7.glb' },
  { sizeClass: 'iteration8',  glb: 'bldg_gl/iteration 8.glb' },
  { sizeClass: 'iteration9',  glb: 'bldg_gl/Iteration 9.glb' },
  { sizeClass: 'iteration10', glb: 'bldg_gl/Iteration 10.glb' },
  { sizeClass: 'iteration11', glb: 'bldg_gl/Iteration 11.glb' },
];

// Cluster raw y0 values (mesh min-y) into real floor levels — real building
// GLBs don't always model every repeated storey's internal partitions, so
// the true floor count/spacing must come from what's actually there, not an
// assumed uniform floor-to-floor height times an estimated floor count.
function detectFloorLevels(node, tol = 1.2) {
  const ys = [];
  node?.traverse(c => {
    if (!c.isMesh) return;
    const b = new THREE.Box3().setFromObject(c);
    if (b.isEmpty()) return;
    ys.push(b.min.y);
  });
  ys.sort((a, b) => a - b);
  const levels = [];
  for (const y of ys) {
    if (!levels.length || y - levels[levels.length - 1] > tol) levels.push(y);
  }
  return levels;
}

function mergeXZ(boxes, gap = 0.3) {
  const used = new Set();
  const out = [];
  for (let i = 0; i < boxes.length; i++) {
    if (used.has(i)) continue;
    const m = boxes[i].clone();
    used.add(i);
    let changed = true;
    while (changed) {
      changed = false;
      for (let j = 0; j < boxes.length; j++) {
        if (used.has(j)) continue;
        if (boxes[j].min.x <= m.max.x + gap && boxes[j].max.x >= m.min.x - gap &&
            boxes[j].min.z <= m.max.z + gap && boxes[j].max.z >= m.min.z - gap) {
          m.union(boxes[j]);
          used.add(j);
          changed = true;
        }
      }
    }
    out.push(m);
  }
  return out;
}

// The 11 source GLBs come from different CAD/Grasshopper exports with
// inconsistent top-level node naming (confirmed by direct inspection of all
// 10 distinct bldg_gl/iteration N.glb files: 'STAIRS' vs 'staircase', 'LIFT'
// vs 'lift', 'inner_railings' vs 'railings' — same real geometry, different
// export-time label). Try each real alias in turn rather than assuming the 4
// shipped GLBs' exact names are universal.
function findNode(scene, ...names) {
  for (const n of names) {
    const node = scene.getObjectByName(n);
    if (node) return node;
  }
  return null;
}

function toObj(b, y0, y1, type) {
  return {
    type,
    x0: +b.min.x.toFixed(3), x1: +b.max.x.toFixed(3),
    y0: +y0.toFixed(3),       y1: +y1.toFixed(3),
    z0: +b.min.z.toFixed(3), z1: +b.max.z.toFixed(3),
  };
}

async function run(cfg) {
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  const buf = readFileSync(resolve(root, cfg.glb));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const gltf = await new Promise((res, rej) => loader.parse(ab, '', res, rej));
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);

  const bbox = new THREE.Box3().setFromObject(scene);
  const flNodeForLevels = scene.getObjectByName('floors');
  const levels = detectFloorLevels(flNodeForLevels);
  // Real floor-slab levels detected from the actual GLB geometry (not an
  // assumed uniform floor height) — floorCount is whatever the model
  // actually has distinct floor-plate data for.
  const typicalH = levels.length > 1
    ? (levels[levels.length - 1] - levels[0]) / (levels.length - 1)
    : 3.6;
  const FLOOR_Y = [...levels, levels[levels.length - 1] + typicalH];
  const floorCount = levels.length;

  function floorIdx(y) {
    for (let i = 0; i < FLOOR_Y.length - 1; i++) {
      if (y >= FLOOR_Y[i] - 1.5 && y < FLOOR_Y[i + 1] + 0.5) return i;
    }
    return -1;
  }

  function collectByFloor(node, minW = 0.5, minD = 0.5) {
    const byFloor = FLOOR_Y.slice(0, -1).map(() => []);
    node?.traverse(c => {
      if (!c.isMesh) return;
      const b = new THREE.Box3().setFromObject(c);
      if (b.isEmpty()) return;
      const w = b.max.x - b.min.x;
      const d = b.max.z - b.min.z;
      // Reject if EITHER dimension is degenerate — real floor-plate quads
      // (the flat reference planes marking an actual room footprint) have
      // both a real width AND a real depth. A skirting/trim-line mesh
      // (e.g. a 10m-long, 0m-deep strip along a slab edge) has one
      // dimension near zero; keeping those in (the old `&&` bug) corrupted
      // the per-unit merge with degenerate strip fragments, breaking real
      // rooms into gapped, disconnected pieces.
      if (w < minW || d < minD) return;
      const fi = floorIdx((b.min.y + b.max.y) / 2);
      if (fi >= 0) byFloor[fi].push(b);
    });
    return byFloor;
  }

  // "floors" node isn't flat mesh soup — its own top-level Group children
  // are each already one real room's floor-plate (the CAD export's native
  // grouping: e.g. Group "mesh_1013" bundles mesh_1013, mesh_1013_1..._7,
  // the triangulated pieces of ONE room). Using these directly gives real,
  // clean per-room boxes with zero merge-tolerance guessing — far more
  // reliable than re-clustering flattened fragments by approximate XZ
  // overlap (which is what the previous version of this script did).
  function collectRoomGroupsByFloor(node, minW = 1.5, minD = 1.5) {
    const byFloor = FLOOR_Y.slice(0, -1).map(() => []);
    for (const group of node?.children ?? []) {
      const b = new THREE.Box3().setFromObject(group);
      if (b.isEmpty()) continue;
      const w = b.max.x - b.min.x, d = b.max.z - b.min.z;
      if (w < minW || d < minD) continue;
      const fi = floorIdx((b.min.y + b.max.y) / 2);
      if (fi >= 0) byFloor[fi].push(b);
    }
    return byFloor;
  }

  const flNode = scene.getObjectByName('floors');
  const flByFloor = collectRoomGroupsByFloor(flNode, 1.5, 1.5);

  // The real poured structural slab ("slabs" node) extends past the internal
  // wall face and is genuinely continuous wherever real rooms sit next to
  // each other with only a thin gap between their wall-face boxes — that
  // real leftover slab area (not covered by any classified room/service/
  // community/balcony) becomes the 'circulation' surface below, so the
  // building reads as continuously floored at ground level even where full-
  // height room volumes don't touch, without inventing extra room mass.
  const slabsNode = scene.getObjectByName('slabs');
  const slabsByFloor = collectByFloor(slabsNode, 1.0, 1.0);

  const stairNode = findNode(scene, 'staircase', 'STAIRS');
  const liftNode = findNode(scene, 'lift', 'LIFT');
  const stairByFloor = collectByFloor(stairNode, 0.1, 0.1);
  const liftByFloor = collectByFloor(liftNode, 0.1, 0.1);

  // Real balcony 3D geometry doesn't exist in these GLBs (the "balconies"
  // node is a 2-point 2D drafting annotation, not a volume) — but every
  // balcony has a real railing, so the "railings" node is the real 3D proxy
  // for where balconies actually are.
  const railNode = findNode(scene, 'railings', 'inner_railings');
  const railByFloor = collectByFloor(railNode, 0.3, 0.3);

  // Not every real building has a community/podium space — several source
  // files genuinely have none (verified: no 'community_space'/'PLINTH' node
  // exists at all on iteration 1/2/3/4/5/6/10), so communityNode staying
  // null there is correct/honest, not a lookup failure to work around.
  const communityNode = findNode(scene, 'community_space', 'PLINTH');

  const allBoxes = [];

  for (let fi = 0; fi < floorCount; fi++) {
    const y0 = FLOOR_Y[fi], y1 = FLOOR_Y[fi + 1];

    const svcBoxes = [...(stairByFloor[fi] || []), ...(liftByFloor[fi] || [])];
    const svcMerged = mergeXZ(svcBoxes, 1.0);
    svcMerged.forEach(b => allBoxes.push({ floorIdx: fi, ...toObj(b, y0, y1, 'services') }));

    let communityBox = null;
    if (fi === 0 && communityNode) {
      const pb = new THREE.Box3().setFromObject(communityNode);
      if (!pb.isEmpty()) { communityBox = pb; allBoxes.push({ floorIdx: fi, ...toObj(pb, y0, y1, 'community') }); }
    }

    const railMerged = mergeXZ(railByFloor[fi] || [], 0.8)
      .filter(b => (b.max.x - b.min.x) > 0.8 && (b.max.z - b.min.z) > 0.8);
    railMerged.forEach(b => allBoxes.push({ floorIdx: fi, ...toObj(b, y0, y1, 'balcony') }));

    // flByFloor boxes are already one real, clean room each (native Group
    // boundaries, not reconstructed fragments) — don't re-merge them, that
    // would fuse genuinely distinct adjacent rooms back into a blob. Just
    // drop any that overlap an already-classified service/community/balcony
    // zone (e.g. a stairwell landing that also got a "floors" reference box).
    const claimedSoFar = [...svcMerged, ...railMerged, ...(communityBox ? [communityBox] : [])];
    const roomMerged = (flByFloor[fi] || []).filter(b => (
      !claimedSoFar.some(s =>
        b.min.x < s.max.x && b.max.x > s.min.x &&
        b.min.z < s.max.z && b.max.z > s.min.z)
    ));
    roomMerged.forEach(b => allBoxes.push({ floorIdx: fi, ...toObj(b, y0, y1, 'units') }));

    const slabBoxesRaw = (slabsByFloor[fi] || []).filter(b => (
      !claimedSoFar.some(s =>
        b.min.x < s.max.x && b.max.x > s.min.x &&
        b.min.z < s.max.z && b.max.z > s.min.z)
    ));
    const slabMerged = mergeXZ(slabBoxesRaw, 0.6)
      .filter(b => (b.max.x - b.min.x) > 2 && (b.max.z - b.min.z) > 2);

    // Circulation — real leftover floor area: sample each real slab block on
    // a 1m grid, mark cells already claimed by rooms/services/community/
    // balcony, and merge the unclaimed real cells into corridor/lobby boxes.
    // This is real geometry (the actual slab, minus the actual classified
    // rooms), not an invented corridor shape — rendered as a thin surface.
    //
    // Guard: per-room detection ('floors' node clustering) isn't equally
    // complete on every real floor — where it barely found any rooms, most
    // of a wing's slab area comes back "unclaimed" by construction, which
    // would wrongly read as one huge corridor swallowing a whole wing. Real
    // circulation is a minority of a floor plate, not the majority — so any
    // wing where the unclaimed fraction is large falls back to being real
    // 'units' floor area instead (accurate to "we don't have finer detail
    // here", not a fabricated corridor).
    const claimed = [...roomMerged, ...claimedSoFar];
    const CIRC_FRACTION_CAP = 0.4;
    const circCells = [];
    const fallbackUnitBoxes = [];
    const CELL = 1.0;
    for (const slab of slabMerged) {
      const w = slab.max.x - slab.min.x, d = slab.max.z - slab.min.z;
      const nx = Math.max(1, Math.round(w / CELL)), nz = Math.max(1, Math.round(d / CELL));
      const cw = w / nx, cd = d / nz;
      const slabCells = [];
      for (let i = 0; i < nx; i++) {
        for (let j = 0; j < nz; j++) {
          const cx0 = slab.min.x + i * cw, cx1 = cx0 + cw;
          const cz0 = slab.min.z + j * cd, cz1 = cz0 + cd;
          const ccx = (cx0 + cx1) / 2, ccz = (cz0 + cz1) / 2;
          const isClaimed = claimed.some(o =>
            ccx > o.min.x && ccx < o.max.x && ccz > o.min.z && ccz < o.max.z);
          if (!isClaimed) {
            slabCells.push(new THREE.Box3(
              new THREE.Vector3(cx0, y0, cz0), new THREE.Vector3(cx1, y0 + 0.15, cz1)
            ));
          }
        }
      }
      const unclaimedFraction = slabCells.length / (nx * nz);
      if (unclaimedFraction > CIRC_FRACTION_CAP) {
        fallbackUnitBoxes.push(slab);
      } else {
        circCells.push(...slabCells);
      }
    }
    fallbackUnitBoxes.forEach(b => allBoxes.push({ floorIdx: fi, ...toObj(b, y0, y1, 'units') }));
    const circMerged = mergeXZ(circCells, CELL * 0.6)
      .filter(b => (b.max.x - b.min.x) * (b.max.z - b.min.z) > 2.5);
    circMerged.forEach(b => allBoxes.push({ floorIdx: fi, ...toObj(b, y0, y0 + 0.15, 'circulation') }));

    const u = allBoxes.filter(b => b.floorIdx === fi && b.type === 'units').length;
    const s = allBoxes.filter(b => b.floorIdx === fi && b.type === 'services').length;
    const c = allBoxes.filter(b => b.floorIdx === fi && b.type === 'community').length;
    const bal = allBoxes.filter(b => b.floorIdx === fi && b.type === 'balcony').length;
    const circ = allBoxes.filter(b => b.floorIdx === fi && b.type === 'circulation').length;
    console.log(`[${cfg.sizeClass}] Floor ${fi + 1}: ${u} units  ${s} services  ${c} community  ${bal} balcony  ${circ} circulation`);
  }

  const floors = FLOOR_Y.slice(0, -1).map((y0, fi) => ({
    floorIdx: fi, y0, y1: FLOOR_Y[fi + 1],
    boxes: allBoxes.filter(b => b.floorIdx === fi),
  }));

  const outPath = resolve(root, `public/BLDGS/programme_${cfg.sizeClass}.json`);
  writeFileSync(outPath, JSON.stringify({ floors }, null, 2));
  console.log(`Wrote ${outPath}\n`);
}

const targets = process.argv.includes('--recovered') ? RECOVERED_CLASSES : CLASSES;
const results = { ok: [], failed: [] };
for (const cfg of targets) {
  try {
    await run(cfg);
    results.ok.push(cfg.sizeClass);
  } catch (e) {
    console.error(`[${cfg.sizeClass}] FAILED: ${e.message}\n`);
    results.failed.push({ sizeClass: cfg.sizeClass, error: e.message });
  }
}
console.log('=== Summary ===');
console.log('OK:', results.ok.join(', ') || '(none)');
console.log('FAILED:', results.failed.map(f => f.sizeClass).join(', ') || '(none)');
