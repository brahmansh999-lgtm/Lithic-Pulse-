// Scratch inspector — lists top-level scene node names in each recovered
// bldg_gl/iteration N.glb, to check whether extractProgramme4.mjs's exact
// node-name lookups ('floors','slabs','staircase','lift','railings',
// 'community_space'/'PLINTH') will find matches, before running the full
// extractor against all 10 distinct files.
import { createRequire } from 'module';
import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dir = dirname(fileURLToPath(import.meta.url));
const root = __dir;

const THREE = require('three');
if (typeof globalThis.self === 'undefined') globalThis.self = globalThis;

const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
const { DRACOLoader } = await import('three/examples/jsm/loaders/DRACOLoader.js');

const draco = new DRACOLoader();
draco.setDecoderPath(resolve(root, 'node_modules/three/examples/jsm/libs/draco/'));
draco.setDecoderConfig({ type: 'js' });

const dir = resolve(root, 'bldg_gl');
const files = readdirSync(dir).filter(f => f.toLowerCase().endsWith('.glb')).sort();

const NEEDED = ['floors', 'slabs', 'staircase', 'lift', 'railings', 'community_space', 'PLINTH'];

async function inspect(file) {
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  const buf = readFileSync(resolve(dir, file));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const gltf = await new Promise((res, rej) => loader.parse(ab, '', res, rej));
  const scene = gltf.scene;
  const topNames = scene.children.map(c => c.name);
  const found = {};
  for (const key of NEEDED) {
    found[key] = !!scene.getObjectByName(key);
  }
  console.log(`\n=== ${file} ===`);
  console.log('top-level nodes:', topNames.join(', '));
  console.log('exact-match found:', JSON.stringify(found));
}

for (const f of files) {
  try {
    await inspect(f);
  } catch (e) {
    console.log(`\n=== ${f} === FAILED: ${e.message}`);
  }
}
