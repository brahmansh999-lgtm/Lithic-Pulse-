import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { resolve } from 'path';
const require = createRequire(import.meta.url);
const THREE = require('three');
if (typeof globalThis.self === 'undefined') globalThis.self = globalThis;
const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
const { DRACOLoader } = await import('three/examples/jsm/loaders/DRACOLoader.js');
const draco = new DRACOLoader();
draco.setDecoderPath(resolve('node_modules/three/examples/jsm/libs/draco/'));
draco.setDecoderConfig({ type: 'js' });
const loader = new GLTFLoader();
loader.setDRACOLoader(draco);
const buf = readFileSync('BLDGS/glbmedium.glb');
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const gltf = await new Promise((res,rej) => loader.parse(ab,'',res,rej));
const scene = gltf.scene;
scene.updateMatrixWorld(true);

const slabsNode = scene.getObjectByName('slabs');
if (slabsNode) {
  const ys = [];
  slabsNode.traverse(c => {
    if (c.isMesh) {
      const box = new THREE.Box3().setFromObject(c);
      if (!box.isEmpty()) ys.push({ name: c.name, y0: +box.min.y.toFixed(3), y1: +box.max.y.toFixed(3), mid: +((box.min.y+box.max.y)/2).toFixed(3) });
    }
  });
  ys.sort((a,b) => a.mid - b.mid);
  console.log('Slab meshes (sorted by Y):');
  ys.forEach(s => console.log(' ', s.name.padEnd(30), s.y0, '->', s.y1, 'mid:', s.mid));
} else {
  console.log('No slabs node. Top-level children:', scene.children.map(c=>c.name));
}
