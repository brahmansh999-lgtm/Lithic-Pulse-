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

const target = process.argv[2] || 'public/1l.glb';
const buf = readFileSync(resolve(root, target));
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const gltf = await new Promise((res, rej) => loader.parse(ab, '', res, rej));
const scene = gltf.scene;
scene.updateMatrixWorld(true);

console.log(`--- ${target} ---`);
const seen = new Set();
scene.traverse(n => {
  const nm = n.name || '(unnamed)';
  if (seen.has(nm)) return;
  seen.add(nm);
  console.log(`[${n.type}] "${n.name}" isMesh:${!!n.isMesh}`);
});
