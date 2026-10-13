/**
 * GLB geometry optimisation pass.
 *
 * Runs gltf-transform's geometry pipeline over the structural GLBs (rooms +
 * moulds) and writes optimised copies to public/<name>.opt.glb alongside the
 * originals. These GLBs carry no embedded textures (images: 0) — materials are
 * applied in code — so this pass is geometry-only: weld, dedup, prune, then
 * Draco compression.
 *
 * Run:  node scripts/optimize-glbs.mjs
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, dedup, prune, draco } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import { stat } from 'node:fs/promises';
import path from 'node:path';

const TARGETS = [
  'public/ROOM1.glb', 'public/ROOM2.glb', 'public/ROOM3.glb', 'public/ROOM4.glb',
  'public/ROOM5.glb', 'public/ROOM6.glb', 'public/ROOM7.glb', 'public/ROOM8.glb',
  'public/moulds/COL-B.glb', 'public/moulds/COLAA0.glb', 'public/moulds/COLG-A.glb',
  'public/moulds/COLMOL0-A.glb', 'public/moulds/COLO0-0.glb', 'public/moulds/EDO.glb',
];

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'draco3d.encoder': await draco3d.createEncoderModule(),
    'draco3d.decoder': await draco3d.createDecoderModule(),
  });

let totalIn = 0;
let totalOut = 0;

for (const src of TARGETS) {
  const out = src.replace(/\.glb$/, '.opt.glb');
  try {
    const doc = await io.read(src);
    await doc.transform(
      weld(),
      dedup(),
      prune(),
      draco(),
    );
    await io.write(out, doc);

    const inB = (await stat(src)).size;
    const outB = (await stat(out)).size;
    totalIn += inB;
    totalOut += outB;
    const pct = (100 * (1 - outB / inB)).toFixed(0);
    console.log(`${path.basename(src).padEnd(18)} ${(inB / 1048576).toFixed(2)}MB → ${(outB / 1048576).toFixed(2)}MB  (-${pct}%)`);
  } catch (e) {
    console.error(`FAILED ${src}: ${e.message}`);
  }
}

console.log('──────────────────────────────────────────');
console.log(`Total: ${(totalIn / 1048576).toFixed(1)}MB → ${(totalOut / 1048576).toFixed(1)}MB  (-${(100 * (1 - totalOut / totalIn)).toFixed(1)}%)`);
