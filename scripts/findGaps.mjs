/**
 * Find what geometry exists in the XZ gaps between unit boxes on floor 1.
 * Check: balconies, railings, external_wall, EXTERNAL_WALLS nodes.
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

// Known unit XZ boxes on floor 1 (y 0.5-4.5)
const UNITS = [
  { x0:340.91, x1:348.91, z0:273.61, z1:281.62 },
  { x0:354.66, x1:368.03, z0:246.18, z1:254.93 },
  { x0:354.65, x1:364.13, z0:261.60, z1:273.84 },
  { x0:329.05, x1:339.08, z0:274.16, z1:278.93 },
  { x0:322.71, x1:327.42, z0:274.52, z1:284.53 },
  { x0:338.63, x1:353.30, z0:246.22, z1:270.59 },
  { x0:322.64, x1:334.90, z0:258.50, z1:267.21 },
];

function inUnit(x, z) {
  return UNITS.some(u => x >= u.x0 - 0.3 && x <= u.x1 + 0.3 && z >= u.z0 - 0.3 && z <= u.z1 + 0.3);
}

// Overall GLB footprint
const FOOT = { x0: 319.159, x1: 371.51, z0: 242.622, z1: 286.445 };

// Check all top-level nodes for geometry in gap zones on floor 1
const nodesToCheck = [
  'Make2D$Visible$Curves$balconies', 'railings', 'floors', 'slabs',
  'EXTERNAL_WALLS', 'external_wall', 'internal_walls', 'glasses', 'Default', '0'
];

console.log('=== Nodes with geometry in GAP areas (floor 1, y 0.5-4.5) ===\n');

for (const name of nodesToCheck) {
  const node = scene.getObjectByName(name);
  if (!node) { console.log(`${name}: NOT FOUND`); continue; }

  const gapBoxes = [];
  node.traverse(c => {
    if (!c.isMesh) return;
    const b = new THREE.Box3().setFromObject(c);
    if (b.isEmpty()) return;
    const midY = (b.min.y + b.max.y) / 2;
    if (midY < 0.3 || midY > 4.8) return; // floor 1 only
    const midX = (b.min.x + b.max.x) / 2;
    const midZ = (b.min.z + b.max.z) / 2;
    // Must be inside overall footprint
    if (midX < FOOT.x0 || midX > FOOT.x1 || midZ < FOOT.z0 || midZ > FOOT.z1) return;
    // Must NOT overlap any unit
    if (!inUnit(midX, midZ)) {
      const w = b.max.x - b.min.x;
      const d = b.max.z - b.min.z;
      if (w > 0.3 && d > 0.3) gapBoxes.push(b);
    }
  });

  if (gapBoxes.length === 0) { console.log(`${name}: no gap geometry`); continue; }

  // Merge gap boxes
  const used = new Set();
  const merged = [];
  for (let i = 0; i < gapBoxes.length; i++) {
    if (used.has(i)) continue;
    const m = gapBoxes[i].clone(); used.add(i);
    let changed = true;
    while (changed) {
      changed = false;
      for (let j = 0; j < gapBoxes.length; j++) {
        if (used.has(j)) continue;
        if (gapBoxes[j].min.x <= m.max.x+1 && gapBoxes[j].max.x >= m.min.x-1 &&
            gapBoxes[j].min.z <= m.max.z+1 && gapBoxes[j].max.z >= m.min.z-1) {
          m.union(gapBoxes[j]); used.add(j); changed = true;
        }
      }
    }
    merged.push(m);
  }

  console.log(`${name}: ${gapBoxes.length} meshes → ${merged.length} gap zones:`);
  merged.forEach(b => {
    console.log(`  x[${b.min.x.toFixed(1)}-${b.max.x.toFixed(1)}] z[${b.min.z.toFixed(1)}-${b.max.z.toFixed(1)}]  ${(b.max.x-b.min.x).toFixed(1)}x${(b.max.z-b.min.z).toFixed(1)}m`);
  });
  console.log('');
}
