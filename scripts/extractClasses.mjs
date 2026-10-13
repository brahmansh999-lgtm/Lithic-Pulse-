// Extracts the 4 CANONICAL building-class precedents straight from the real
// shipping GLBs in BLDGS/ — glbsmall/glbmedium/glblarge/glbXL.glb — and tags
// each with its sizeClass + glb path. These 4 records ARE the source of truth
// the Architect pipeline binds to (one site class → one of these → its zoning,
// massing and column geometry). Replaces the 11 anonymous precedent_N records
// for the hard-locked demo path.
//
// Reuses extractZoning.mjs's extractOne() verbatim (same geometry math:
// footprint, floors, real columnPositions, zoneBlocks) — this file only adds
// the class mapping + tagging, so the two extractors never drift.
//
// Runs OFFLINE in Node (the BLDGS GLBs are 70-445 MB; the browser only ever
// loads the small JSON this produces).
//
// Usage: node scripts/extractClasses.mjs > src/planner/data/classPrecedents.json

import { extractOne } from './extractZoning.mjs';
import { existsSync, readFileSync } from 'fs';

// class → source GLB. Order is small→xl so the output array reads in size order.
const CLASS_GLBS = [
  { sizeClass: 'small',  file: 'BLDGS/glbsmall.glb',  label: 'Small' },
  { sizeClass: 'medium', file: 'BLDGS/glbmedium.glb', label: 'Medium' },
  { sizeClass: 'large',  file: 'BLDGS/glblarge.glb',  label: 'Large' },
  { sizeClass: 'xl',     file: 'BLDGS/glbXL.glb',     label: 'Extra Large' },
];

// Recovered originals not already represented by one of the 4 classes above
// (iteration 6/7/9/10 excluded — duplicate/same-building-as-shipped, see
// scripts/extractMassing.mjs's RECOVERED_FILES comment for the identity
// evidence: matching footprintAreaM2 + floorCount against classPrecedents.json).
// Run with `node scripts/extractClasses.mjs --recovered >
// src/planner/data/classPrecedents.recovered.json`, then merge by hand — kept
// as a SEPARATE output rather than silently appended, so a bad run never
// corrupts the live classPrecedents.json the app already depends on.
const RECOVERED_GLBS = [
  { sizeClass: 'iteration1',  file: 'bldg_gl/iteration 1.glb',  label: 'Iteration 1' },
  { sizeClass: 'iteration2',  file: 'bldg_gl/iteration 2.glb',  label: 'Iteration 2' },
  { sizeClass: 'iteration3',  file: 'bldg_gl/iteration 3.glb',  label: 'Iteration 3' },
  { sizeClass: 'iteration4',  file: 'bldg_gl/iteration 4.glb',  label: 'Iteration 4' },
  { sizeClass: 'iteration5',  file: 'bldg_gl/iteration 5.glb',  label: 'Iteration 5' },
  { sizeClass: 'iteration8',  file: 'bldg_gl/iteration 8.glb',  label: 'Iteration 8' },
  { sizeClass: 'iteration11', file: 'bldg_gl/Iteration 11.glb', label: 'Iteration 11' },
];

async function main() {
  const useRecovered = process.argv.includes('--recovered');
  const targets = useRecovered ? RECOVERED_GLBS : CLASS_GLBS;
  const results = [];
  for (const { sizeClass, file, label } of targets) {
    if (!existsSync(file)) {
      process.stderr.write(`  SKIP: ${file} not found\n`);
      continue;
    }
    process.stderr.write(`extracting ${sizeClass} from ${file}...\n`);
    try {
      const spec = await extractOne(file);
      if (!spec) { process.stderr.write(`  FAILED: no geometry in ${file}\n`); continue; }
      results.push({
        id: `class_${sizeClass}`,
        sizeClass,
        name: label,
        // browser-loadable path (BLDGS is copied to public at build/serve time;
        // see Phase A note — the app only needs this string, not the GLB itself yet)
        glb: '/' + file,
        ...spec,
      });
      const c = spec.counts || {};
      process.stderr.write(
        `  ok: ${spec.floorCount}fl  ${spec.footprintAreaM2}m²  ` +
        `${spec.columnPositions?.length || 0} cols  grid ${spec.columnGridM}m  ` +
        `cores ${spec.stairCoreCount}\n`
      );
    } catch (e) {
      process.stderr.write(`  FAILED: ${e.message}\n`);
    }
  }
  console.log(JSON.stringify(results, null, 2));
}

main();
