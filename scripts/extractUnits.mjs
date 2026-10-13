/**
 * Extract individual unit bounding boxes from the medium GLB.
 * Strategy: look at internal_walls mesh children — each wall mesh
 * separates units. We cluster floor mesh children by XZ position
 * to find distinct unit cells per floor.
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

// Floor slab Y levels (from clustering analysis)
const FLOOR_Y = [0.5, 4.5, 8.0, 11.5, 15.0, 19.0, 22.5];

// Collect ALL mesh bboxes per floor band
const floorMeshes = FLOOR_Y.slice(0, -1).map((y0, i) => ({
  floorIdx: i,
  y0,
  y1: FLOOR_Y[i + 1],
  meshBoxes: [],
}));

scene.traverse(child => {
  if (!child.isMesh) return;
  // Skip railings, glasses, slabs — we want walls + floors that define unit volumes
  const pname = (child.parent?.name || '').toLowerCase();
  const skip = ['railing', 'glass', 'slab', 'column', 'staircase', 'lift', 'layer0', 'plinth'];
  if (skip.some(s => pname.includes(s))) return;

  const box = new THREE.Box3().setFromObject(child);
  if (box.isEmpty()) return;
  const midY = (box.min.y + box.max.y) / 2;

  for (const fl of floorMeshes) {
    if (midY >= fl.y0 - 0.5 && midY < fl.y1 + 0.5) {
      fl.meshBoxes.push(box);
      break;
    }
  }
});

// For each floor, cluster mesh bboxes in XZ space using a grid
// Each cell that has geometry = one unit zone
function clusterUnitsOnFloor(meshBoxes, y0, y1) {
  if (meshBoxes.length === 0) return [];

  // Find XZ extent of this floor
  let xMin = Infinity, xMax = -Infinity, zMin = Infinity, zMax = -Infinity;
  for (const b of meshBoxes) {
    xMin = Math.min(xMin, b.min.x); xMax = Math.max(xMax, b.max.x);
    zMin = Math.min(zMin, b.min.z); zMax = Math.max(zMax, b.max.z);
  }

  // Divide into a grid and find occupied cells
  // Typical unit width ~6-8m, depth ~8-10m
  const UNIT_W = 6.0; // metres per grid cell X
  const UNIT_D = 8.0; // metres per grid cell Z

  const nX = Math.ceil((xMax - xMin) / UNIT_W);
  const nZ = Math.ceil((zMax - zMin) / UNIT_D);

  // For each mesh box, find which grid cells it overlaps
  const occupied = new Set();
  for (const b of meshBoxes) {
    const cx0 = Math.floor((b.min.x - xMin) / UNIT_W);
    const cx1 = Math.floor((b.max.x - xMin) / UNIT_W);
    const cz0 = Math.floor((b.min.z - zMin) / UNIT_D);
    const cz1 = Math.floor((b.max.z - zMin) / UNIT_D);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        if (cx >= 0 && cx < nX && cz >= 0 && cz < nZ) {
          occupied.add(`${cx},${cz}`);
        }
      }
    }
  }

  const units = [];
  for (const key of occupied) {
    const [cx, cz] = key.split(',').map(Number);
    units.push({
      x0: +(xMin + cx * UNIT_W).toFixed(3),
      x1: +(xMin + (cx + 1) * UNIT_W).toFixed(3),
      y0: +y0.toFixed(3),
      y1: +y1.toFixed(3),
      z0: +(zMin + cz * UNIT_D).toFixed(3),
      z1: +(zMin + (cz + 1) * UNIT_D).toFixed(3),
    });
  }
  return units;
}

const result = { floors: [] };
let totalUnits = 0;

for (const fl of floorMeshes) {
  const units = clusterUnitsOnFloor(fl.meshBoxes, fl.y0, fl.y1);
  result.floors.push({ floorIdx: fl.floorIdx, y0: fl.y0, y1: fl.y1, units });
  totalUnits += units.length;
  console.log(`Floor ${fl.floorIdx + 1} (y ${fl.y0}–${fl.y1}): ${fl.meshBoxes.length} meshes → ${units.length} units`);
}

console.log(`\nTotal: ${totalUnits} unit boxes across ${result.floors.length} floors`);

writeFileSync(resolve(root, 'public/BLDGS/units_medium.json'), JSON.stringify(result, null, 2));
console.log('Wrote public/BLDGS/units_medium.json');
