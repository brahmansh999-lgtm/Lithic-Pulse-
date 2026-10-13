/**
 * Better unit extraction: use the 'floors' node child meshes.
 * Each floor mesh in a Revit/SketchUp export typically = one room/unit slab.
 * Cluster them by XZ bbox to find distinct unit footprints.
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

// Get the 'floors' node — individual floor slabs = individual units
const floorsNode = scene.getObjectByName('floors');
const internalNode = scene.getObjectByName('internal_walls');

console.log('floors node:', floorsNode ? 'found' : 'not found');
console.log('internal_walls node:', internalNode ? 'found' : 'not found');

// Collect all mesh bboxes from the floors group
const allMeshBoxes = [];
const targetNode = floorsNode || internalNode;
if (targetNode) {
  targetNode.traverse(child => {
    if (!child.isMesh) return;
    const box = new THREE.Box3().setFromObject(child);
    if (box.isEmpty()) return;
    const w = box.max.x - box.min.x;
    const d = box.max.z - box.min.z;
    const h = box.max.y - box.min.y;
    // Only meshes that look like floor plates (thin in Y, wide in XZ)
    if (h < 1.5 && w > 1.5 && d > 1.5) {
      allMeshBoxes.push(box);
    }
  });
}

console.log(`\nFloor-like meshes: ${allMeshBoxes.length}`);

// Sort by Y then cluster meshes that are at same Y level and overlapping in XZ
// Each unique XZ bbox = one unit
const byY = {};
for (const box of allMeshBoxes) {
  const midY = Math.round((box.min.y + box.max.y) / 2 * 2) / 2; // 0.5m bins
  if (!byY[midY]) byY[midY] = [];
  byY[midY].push(box);
}

console.log('\nY levels with floor meshes:');
Object.entries(byY).sort((a,b) => parseFloat(a[0]) - parseFloat(b[0])).forEach(([y, boxes]) => {
  console.log(`  y~${y}: ${boxes.length} meshes`);
  // Show XZ extents of first few
  boxes.slice(0, 5).forEach(b => {
    console.log(`    x: ${b.min.x.toFixed(1)}-${b.max.x.toFixed(1)}  z: ${b.min.z.toFixed(1)}-${b.max.z.toFixed(1)}  w:${(b.max.x-b.min.x).toFixed(1)} d:${(b.max.z-b.min.z).toFixed(1)}`);
  });
});

// Find units = distinct non-overlapping XZ regions at each floor level
// Use bbox uniqueness: group meshes that share the same XZ bbox (same unit slab repeated per floor)
function mergeOverlapping(boxes) {
  // Sort and merge overlapping boxes in XZ
  const units = [];
  const used = new Set();

  for (let i = 0; i < boxes.length; i++) {
    if (used.has(i)) continue;
    let merged = boxes[i].clone();
    let changed = true;
    while (changed) {
      changed = false;
      for (let j = 0; j < boxes.length; j++) {
        if (used.has(j) || j === i) continue;
        // Check XZ overlap
        if (boxes[j].min.x < merged.max.x && boxes[j].max.x > merged.min.x &&
            boxes[j].min.z < merged.max.z && boxes[j].max.z > merged.min.z) {
          merged.union(boxes[j]);
          used.add(j);
          changed = true;
        }
      }
    }
    used.add(i);
    units.push(merged);
  }
  return units;
}

// Get unique unit footprints from floor 1 meshes (the "template" floor)
const floor1Y = Object.keys(byY).map(Number).filter(y => y > 0.3 && y < 2.0);
if (floor1Y.length > 0) {
  const f1boxes = byY[floor1Y[0]] || [];
  console.log(`\nMerging ${f1boxes.length} floor-1 meshes into units...`);
  const units = mergeOverlapping(f1boxes);
  console.log(`Found ${units.length} distinct unit footprints on floor 1:`);
  units.forEach((u, i) => {
    console.log(`  Unit ${i+1}: x ${u.min.x.toFixed(1)}-${u.max.x.toFixed(1)}  z ${u.min.z.toFixed(1)}-${u.max.z.toFixed(1)}  ${(u.max.x-u.min.x).toFixed(1)}m x ${(u.max.z-u.min.z).toFixed(1)}m`);
  });
}
