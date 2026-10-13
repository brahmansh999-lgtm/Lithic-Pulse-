/**
 * Verify: extract floor-plate mesh bboxes directly from GLB and compare
 * against what programme_medium.json has. Print both side by side.
 */
import { createRequire } from 'module';
import { readFileSync } from 'fs';
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

// --- GROUND TRUTH: raw mesh bboxes from 'floors' node per floor ---
const floorsNode = scene.getObjectByName('floors');
const rawByFloor = FLOOR_Y.slice(0, -1).map(() => []);

floorsNode?.traverse(c => {
  if (!c.isMesh) return;
  const b = new THREE.Box3().setFromObject(c);
  if (b.isEmpty()) return;
  const w = b.max.x - b.min.x;
  const d = b.max.z - b.min.z;
  const h = b.max.y - b.min.y;
  if (h > 1.5 || w < 1.5 || d < 1.5) return;
  const fi = floorIdx((b.min.y + b.max.y) / 2);
  if (fi >= 0) rawByFloor[fi].push(b);
});

// --- WHAT WE RENDER: the hardcoded data in MassingStage ---
const CENTRE = {
  x: (319.159 + 371.51) / 2,
  z: (242.622 + 286.445) / 2,
};

// The rendered boxes (from MassingStage RAW_FLOORS — copy floor 0 unit boxes as check)
const RENDERED_F0_UNITS = [
  { x0:340.863, x1:348.863, z0:273.617, z1:281.617 },
  { x0:354.703, x1:368.137, z0:246.176, z1:254.906 },
  { x0:354.703, x1:364.198, z0:261.619, z1:273.826 },
  { x0:329.091, x1:339.091, z0:274.202, z1:278.944 },
  { x0:322.676, x1:327.407, z0:274.514, z1:284.459 },
  { x0:322.676, x1:337.403, z0:246.176, z1:270.506 },
  { x0:322.619, x1:334.879, z0:258.468, z1:267.209 },
];

console.log('=== GROUND TRUTH: raw GLB floor-plate meshes (floor 1, y 0.5-4.5) ===');
console.log(`Total raw meshes on floor 1: ${rawByFloor[0].length}`);

// Merge them same way as script did
function mergeXZ(boxes, gap = 0.5) {
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

const merged = mergeXZ(rawByFloor[0]);
console.log(`\nMerged into ${merged.length} unit footprints (GLB ground truth):`);
merged.forEach((b, i) => {
  console.log(`  GLB unit ${i+1}: x[${b.min.x.toFixed(2)}-${b.max.x.toFixed(2)}]  z[${b.min.z.toFixed(2)}-${b.max.z.toFixed(2)}]  ${(b.max.x-b.min.x).toFixed(1)}x${(b.max.z-b.min.z).toFixed(1)}m`);
});

console.log('\n=== WHAT IS RENDERED in MassingStage (floor 0 unit boxes) ===');
RENDERED_F0_UNITS.forEach((b, i) => {
  console.log(`  Rendered unit ${i+1}: x[${b.x0.toFixed(2)}-${b.x1.toFixed(2)}]  z[${b.z0.toFixed(2)}-${b.z1.toFixed(2)}]  ${(b.x1-b.x0).toFixed(1)}x${(b.z1-b.z0).toFixed(1)}m`);
});

console.log('\n=== CENTRE offset applied in viewer ===');
console.log(`CENTRE.x = ${CENTRE.x.toFixed(3)}, CENTRE.z = ${CENTRE.z.toFixed(3)}`);
console.log('First rendered unit in THREE.js coords:');
const u = RENDERED_F0_UNITS[0];
console.log(`  cx = ${((u.x0+u.x1)/2 - CENTRE.x).toFixed(2)}, cz = ${((u.z0+u.z1)/2 - CENTRE.z).toFixed(2)}`);

console.log('\n=== OVERALL GLB bounds (from massing.json) ===');
const massing = JSON.parse(readFileSync(resolve(root, 'public/BLDGS/massing.json'), 'utf8'));
const m = massing.medium;
console.log(`  x: ${m.bounds.x0} → ${m.bounds.x1}  (${(m.bounds.x1-m.bounds.x0).toFixed(1)}m wide)`);
console.log(`  z: ${m.bounds.z0} → ${m.bounds.z1}  (${(m.bounds.z1-m.bounds.z0).toFixed(1)}m deep)`);
console.log(`  y: ${m.bounds.y0} → ${m.bounds.y1}  (${(m.bounds.y1-m.bounds.y0).toFixed(1)}m tall)`);

// Check: do rendered unit x/z values fall inside the GLB bounds?
console.log('\n=== BOUNDS CHECK: are rendered units inside GLB footprint? ===');
let allOk = true;
RENDERED_F0_UNITS.forEach((b, i) => {
  const ok = b.x0 >= m.bounds.x0 - 1 && b.x1 <= m.bounds.x1 + 1 &&
             b.z0 >= m.bounds.z0 - 1 && b.z1 <= m.bounds.z1 + 1;
  console.log(`  Unit ${i+1}: ${ok ? '✓ INSIDE' : '✗ OUTSIDE'} GLB bounds`);
  if (!ok) allOk = false;
});
console.log(allOk ? '\n✓ ALL units map correctly inside GLB footprint' : '\n✗ SOME units fall outside GLB bounds — mapping is WRONG');
