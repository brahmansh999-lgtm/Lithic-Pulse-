/**
 * Extract programme from medium GLB.
 * Real 3D nodes: internal_walls, slabs, santech/Г-САНТЕХНИКА, staircase, PLINTH
 *
 * Strategy per floor:
 *  - Get all internal_wall mesh XZ boxes → cluster into unit cells
 *  - Get santech boxes → services
 *  - PLINTH → community/lobby ground floor
 *  - staircase → services
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
const loader = new GLTFLoader();
loader.setDRACOLoader(draco);

const buf = readFileSync(resolve(root, 'BLDGS/glbmedium.glb'));
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const gltf = await new Promise((res, rej) => loader.parse(ab, '', res, rej));
const scene = gltf.scene;
scene.updateMatrixWorld(true);

const FLOOR_Y = [0.5, 4.5, 8.0, 11.5, 15.0, 19.0, 22.5];

function floorIdx(y) {
  for (let i = 0; i < FLOOR_Y.length - 1; i++) {
    if (y >= FLOOR_Y[i] - 1.5 && y < FLOOR_Y[i + 1] + 0.5) return i;
  }
  return -1;
}

function toObj(b, y0, y1, type) {
  return {
    type,
    x0: +b.min.x.toFixed(3), x1: +b.max.x.toFixed(3),
    y0: +y0.toFixed(3),       y1: +y1.toFixed(3),
    z0: +b.min.z.toFixed(3), z1: +b.max.z.toFixed(3),
  };
}

// ── Cluster overlapping boxes in XZ ──────────────────────────────────────────
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

// Collect meshes from a node filtered by floor
function collectByFloor(node, minW = 0.5, minD = 0.5) {
  const byFloor = FLOOR_Y.slice(0, -1).map(() => []);
  node?.traverse(c => {
    if (!c.isMesh) return;
    const b = new THREE.Box3().setFromObject(c);
    if (b.isEmpty()) return;
    const w = b.max.x - b.min.x;
    const d = b.max.z - b.min.z;
    if (w < minW && d < minD) return;
    const fi = floorIdx((b.min.y + b.max.y) / 2);
    if (fi >= 0) byFloor[fi].push(b);
  });
  return byFloor;
}

// ── internal_walls → unit cells per floor ────────────────────────────────────
const iwNode = scene.getObjectByName('internal_walls');
const iwByFloor = collectByFloor(iwNode, 0.3, 0.3);

// ── floors node → unit floor plates ──────────────────────────────────────────
const flNode = scene.getObjectByName('floors');
const flByFloor = collectByFloor(flNode, 1.5, 1.5);

// For each floor, merge floor-plate meshes to get unit footprints
// Then intersect with internal_wall clusters to refine

// ── santech / Г-САНТЕХНИКА → services ────────────────────────────────────────
const santechNode = scene.getObjectByName('santech') || scene.getObjectByName('Г-САНТЕХНИКА');
const santechByFloor = collectByFloor(santechNode, 0.1, 0.1);

// ── staircase → services ──────────────────────────────────────────────────────
const stairNode = scene.getObjectByName('staircase');
const stairByFloor = collectByFloor(stairNode, 0.1, 0.1);

// ── PLINTH → community ground floor ──────────────────────────────────────────
const plinthNode = scene.getObjectByName('PLINTH');

const allBoxes = [];

for (let fi = 0; fi < FLOOR_Y.length - 1; fi++) {
  const y0 = FLOOR_Y[fi];
  const y1 = FLOOR_Y[fi + 1];

  // Services: merge staircase + santech
  const svcBoxes = [...stairByFloor[fi], ...santechByFloor[fi]];
  const svcMerged = mergeXZ(svcBoxes, 1.0);
  svcMerged.forEach(b => allBoxes.push({ floorIdx: fi, ...toObj(b, y0, y1, 'services') }));

  // Community: PLINTH only on floor 0
  if (fi === 0 && plinthNode) {
    const pb = new THREE.Box3().setFromObject(plinthNode);
    if (!pb.isEmpty()) allBoxes.push({ floorIdx: fi, ...toObj(pb, y0, y1, 'community') });
  }

  // Units: merge floor-plate meshes, exclude areas covered by services
  const svcAreas = svcMerged;
  const flBoxes = flByFloor[fi].filter(b => {
    // exclude if this box overlaps any service area
    return !svcAreas.some(s =>
      b.min.x < s.max.x && b.max.x > s.min.x &&
      b.min.z < s.max.z && b.max.z > s.min.z
    );
  });

  const unitMerged = mergeXZ(flBoxes, 0.5);
  // Filter out tiny leftover boxes
  unitMerged
    .filter(b => (b.max.x - b.min.x) > 2 && (b.max.z - b.min.z) > 2)
    .forEach(b => allBoxes.push({ floorIdx: fi, ...toObj(b, y0, y1, 'units') }));

  const u = allBoxes.filter(b => b.floorIdx === fi && b.type === 'units').length;
  const s = allBoxes.filter(b => b.floorIdx === fi && b.type === 'services').length;
  const c = allBoxes.filter(b => b.floorIdx === fi && b.type === 'community').length;
  console.log(`Floor ${fi+1} (y${y0}–${y1}): ${u} units  ${s} services  ${c} community`);
  allBoxes.filter(b => b.floorIdx === fi && b.type === 'units').forEach(b => {
    console.log(`  unit: ${(b.x1-b.x0).toFixed(1)}m x ${(b.z1-b.z0).toFixed(1)}m`);
  });
}

const floors = FLOOR_Y.slice(0, -1).map((y0, fi) => ({
  floorIdx: fi, y0, y1: FLOOR_Y[fi + 1],
  boxes: allBoxes.filter(b => b.floorIdx === fi),
}));

writeFileSync(resolve(root, 'public/BLDGS/programme_medium.json'), JSON.stringify({ floors }, null, 2));
console.log('\nWrote public/BLDGS/programme_medium.json');
