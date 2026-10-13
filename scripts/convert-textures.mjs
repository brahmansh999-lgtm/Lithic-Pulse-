/**
 * Texture optimisation pass.
 *
 * Converts the loose 4K PNG/JPG texture sets in public/textures/ into compact
 * WebP maps written to public/textures-opt/. Originals are never modified.
 *
 * Per-map policy (only the maps materials.js actually uses):
 *   diff  → 2048, WebP q80, sRGB colour
 *   nor   → 2048, WebP q92, near-lossless (normals are artifact-sensitive)
 *   rough → 1024, WebP q85, data
 *   ao    → 1024, WebP q85, data
 *   metal → 1024, WebP q85, data
 *   disp  → skipped entirely (never sampled by any material)
 *
 * Run:  node scripts/convert-textures.mjs
 */
import sharp from 'sharp';
import { readdir, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const SRC = path.resolve('public/textures');
const OUT = path.resolve('public/textures-opt');

// map basename (without ext) → { size, quality }  | null = skip
const POLICY = {
  diff:  { size: 2048, quality: 80 },
  nor:   { size: 2048, quality: 92 },
  rough: { size: 1024, quality: 85 },
  ao:    { size: 1024, quality: 85 },
  metal: { size: 1024, quality: 85 },
  disp:  null, // unused — drop it
};

sharp.cache(false);
sharp.concurrency(Math.max(1, (await import('node:os')).cpus?.().length ?? 4));

let inBytes = 0;
let outBytes = 0;
let written = 0;
let skipped = 0;

const sets = (await readdir(SRC, { withFileTypes: true }))
  .filter(d => d.isDirectory())
  .map(d => d.name);

for (const set of sets) {
  const srcDir = path.join(SRC, set);
  const outDir = path.join(OUT, set);
  if (!existsSync(outDir)) await mkdir(outDir, { recursive: true });

  const files = await readdir(srcDir);
  for (const file of files) {
    const base = path.parse(file).name.toLowerCase(); // diff / nor / rough ...
    const policy = POLICY[base];
    const srcPath = path.join(srcDir, file);

    if (policy === null || policy === undefined) {
      skipped++;
      continue;
    }

    inBytes += (await stat(srcPath)).size;
    const outPath = path.join(outDir, `${base}.webp`);

    await sharp(srcPath)
      .resize(policy.size, policy.size, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: policy.quality, effort: 6 })
      .toFile(outPath);

    outBytes += (await stat(outPath)).size;
    written++;
    process.stdout.write(`  ${set}/${base}.webp  ${(outBytes / 1048576).toFixed(1)}MB total\r`);
  }
}

console.log('\n──────────────────────────────────────────');
console.log(`Sets:     ${sets.length}`);
console.log(`Written:  ${written} maps   Skipped (disp/unused): ${skipped}`);
console.log(`Input:    ${(inBytes / 1048576).toFixed(1)} MB`);
console.log(`Output:   ${(outBytes / 1048576).toFixed(1)} MB`);
console.log(`Reduction: ${(100 * (1 - outBytes / inBytes)).toFixed(1)}%`);
console.log(`→ ${OUT}`);
