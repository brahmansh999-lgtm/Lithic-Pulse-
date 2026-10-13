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

// Show scene hierarchy top 3 levels
function printTree(node, depth, maxDepth) {
  if (depth > maxDepth) return;
  const box = new THREE.Box3().setFromObject(node);
  const w = box.isEmpty() ? '?' : (box.max.x - box.min.x).toFixed(1);
  const d = box.isEmpty() ? '?' : (box.max.z - box.min.z).toFixed(1);
  const h = box.isEmpty() ? '?' : (box.max.y - box.min.y).toFixed(1);
  const midY = box.isEmpty() ? '?' : ((box.min.y + box.max.y) / 2).toFixed(1);
  console.log('  '.repeat(depth) + `[${node.type}] "${node.name}" children:${node.children.length} | ${w}x${h}x${d}m midY:${midY}`);
  if (depth < maxDepth) node.children.forEach(c => printTree(c, depth + 1, maxDepth));
}

// Find all top-level UN_ nodes (direct children of scene or Layer0)
const topUN = [];
scene.traverse(n => {
  if (/^UN(_\d+)?$/.test(n.name)) {
    const parentName = n.parent?.name || '';
    // Only add if parent is NOT also a UN node
    if (!/^UN/.test(parentName)) topUN.push(n);
  }
});

console.log(`Top-level UN nodes: ${topUN.length}`);
console.log('\nFirst 15:');
topUN.slice(0, 15).forEach(n => {
  const box = new THREE.Box3().setFromObject(n);
  const w = (box.max.x - box.min.x).toFixed(1);
  const d = (box.max.z - box.min.z).toFixed(1);
  const h = (box.max.y - box.min.y).toFixed(1);
  const midY = ((box.min.y + box.max.y) / 2).toFixed(2);
  console.log(`  "${n.name}" parent:"${n.parent?.name}" ${w}m x ${d}m x ${h}m  midY:${midY}  children:${n.children.length}`);
});

// What are the direct children of scene?
console.log('\nDirect scene children:');
scene.children.forEach(c => {
  const box = new THREE.Box3().setFromObject(c);
  const h = box.isEmpty() ? '?' : (box.max.y - box.min.y).toFixed(1);
  const midY = box.isEmpty() ? '?' : ((box.min.y + box.max.y) / 2).toFixed(1);
  console.log(`  "${c.name}" type:${c.type} children:${c.children.length} h:${h}m midY:${midY}`);
  // Show children of this node too
  c.children.slice(0,5).forEach(cc => {
    const cb = new THREE.Box3().setFromObject(cc);
    const cw = cb.isEmpty() ? '?' : (cb.max.x - cb.min.x).toFixed(1);
    const cd = cb.isEmpty() ? '?' : (cb.max.z - cb.min.z).toFixed(1);
    const ch = cb.isEmpty() ? '?' : (cb.max.y - cb.min.y).toFixed(1);
    const cmy = cb.isEmpty() ? '?' : ((cb.min.y + cb.max.y) / 2).toFixed(1);
    console.log(`    "${cc.name}" ${cw}x${ch}x${cd}m midY:${cmy}`);
  });
});
