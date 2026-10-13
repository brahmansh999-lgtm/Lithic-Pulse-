/**
 * Final unit extractor: merge floor-plate meshes per floor into distinct unit boxes.
 * Output: public/BLDGS/units_medium.json
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

function mergeOverlapping(boxes) {
  const used = new Set();
  const units = [];
  for (let i = 0; i < boxes.length; i++) {
    if (used.has(i)) continue;
    const merged = boxes[i].clone();
    used.add(i);
    let changed = true;
    while (changed) {
      changed = false;
      for (let j = 0; j < boxes.length; j++) {
        if (used.has(j)) continue;
        if (boxes[j].min.x <= merged.max.x + 0.5 && boxes[j].max.x >= merged.min.x - 0.5 &&
            boxes[j].min.z <= merged.max.z + 0.5 && boxes[j].max.z >= merged.min.z - 0.5) {
          merged.union(boxes[j]);
          used.add(j);
          changed = true;
        }
      }
    }
    units.push(merged);
  }
  return units;
}

// Collect floor-plate meshes (thin Y, wide XZ) from the 'floors' node
const floorsNode = scene.getObjectByName('floors');
const byFloor = FLOOR_Y.slice(0, -1).map((y0, i) => ({ y0, y1: FLOOR_Y[i + 1], boxes: [] }));

floorsNode.traverse(child => {
  if (!child.isMesh) return;
  const box = new THREE.Box3().setFromObject(child);
  if (box.isEmpty()) return;
  const w = box.max.x - box.min.x;
  const d = box.max.z - box.min.z;
  const h = box.max.y - box.min.y;
  if (h > 1.5 || w < 1.5 || d < 1.5) return;
  const midY = (box.min.y + box.max.y) / 2;
  for (const fl of byFloor) {
    if (midY >= fl.y0 - 1.0 && midY < fl.y1) {
      fl.boxes.push(box);
      break;
    }
  }
});

const result = { floors: [] };
for (let i = 0; i < byFloor.length; i++) {
  const fl = byFloor[i];
  // If floor has no meshes, copy from the nearest floor that does
  let boxes = fl.boxes;
  if (boxes.length === 0) {
    const nearest = byFloor.find(f => f.boxes.length > 0);
    if (nearest) boxes = nearest.boxes;
  }

  const units = mergeOverlapping(boxes).map(u => ({
    x0: +u.min.x.toFixed(3),
    x1: +u.max.x.toFixed(3),
    y0: +fl.y0.toFixed(3),
    y1: +fl.y1.toFixed(3),
    z0: +u.min.z.toFixed(3),
    z1: +u.max.z.toFixed(3),
  }));

  result.floors.push({ floorIdx: i, y0: fl.y0, y1: fl.y1, units });
  console.log(`Floor ${i + 1} (y ${fl.y0}–${fl.y1}): ${fl.boxes.length} meshes → ${units.length} units`);
  units.forEach(u => console.log(`  ${(u.x1-u.x0).toFixed(1)}m x ${(u.z1-u.z0).toFixed(1)}m`));
}

writeFileSync(resolve(root, 'public/BLDGS/units_medium.json'), JSON.stringify(result, null, 2));
console.log('\nWrote public/BLDGS/units_medium.json');
