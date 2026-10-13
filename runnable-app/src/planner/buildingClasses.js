// THE KEYSTONE — the single object that makes the Architect pipeline's hook
// provable instead of cosmetic. See docs/ARCHITECT_PIPELINE_MASTERPLAN.md.
//
// One building CLASS (small | medium | large | xl) binds together, immutably:
//   - the real shipping GLB                (BLDGS/glb<class>.glb)
//   - that GLB's measured geometry         (classPrecedents.json — footprint,
//                                            floors, real columnPositions,
//                                            zoneBlocks, span, grid, cores)
//   - the architect's design-rule preset   (from zoningTargets.js, transcribed
//                                            from the SPATIALLOGIC sketches)
//
// And one curated SITE hard-locks to exactly one class (SITE_CLASS). On the
// Small site you get the Small building, its geometry, and its rules — never
// another class. This is the invariant the whole demo rests on (I1, I2).

import classPrecedents from './data/classPrecedents.json';
import { DESIGN_RULE_PRESETS } from './zoningTargets';

// ── SITE → CLASS hard-lock ────────────────────────────────────────────────
// The 4-site, 4-class, 1:1 demo lock (R2 in the masterplan doc). Site IDs are
// the 1-based useBrownfieldData() indices, and MUST match CURATED_SITE_IDS in
// curatedSites.js (the list the SitePicker actually offers). Updated 2026-07-01
// alongside the curated set (2 rectangles + 2 real polygons):
//    556 75 Torrington Park, N12 (Barnet)        → small (irregular polygon)
//    643 Odeon Cinema, Kensington High Street     → medium (rectangle)
//   1550 Dover Court Estate, Islington            → large (single core, rectangle)
//    888 Padcroft Works, Yiewsley (Hillingdon)    → xl    (large double, irregular polygon)
export const SITE_CLASS = {
  556:  'small',
  643:  'medium',
  1550: 'large',
  888:  'xl',
};

// Which design-rule preset each class uses (the sketch-derived rules live in
// zoningTargets.js; this just maps class → preset id so the two stay aligned).
const CLASS_RULE_PRESET = {
  small:  'small_building',
  medium: 'medium_building',
  large:  'large_building',
  xl:     'extra_large_building',
};

// ── CLASS_REGISTRY — class → { sizeClass, glb, geometry, designRules } ─────
// geometry is the full extracted record from classPrecedents.json (the same
// shape scoreAgainstZoning / scoreAgainstGLBShape already consume). designRules
// is the resolved preset object, not just an id, so callers get everything in
// one read.
function buildRegistry() {
  const reg = {};
  for (const rec of classPrecedents) {
    const cls = rec.sizeClass;
    if (!cls) continue;
    reg[cls] = {
      sizeClass: cls,
      glb: rec.glb,
      geometry: rec,
      designRules: DESIGN_RULE_PRESETS[CLASS_RULE_PRESET[cls]] || null,
    };
  }
  return reg;
}

export const CLASS_REGISTRY = buildRegistry();

// All classes present in the registry, in size order (handy for UI/strips).
const CLASS_ORDER = ['small', 'medium', 'large', 'xl'];
export const BUILDING_CLASSES = CLASS_ORDER.filter(c => CLASS_REGISTRY[c]);

// ── Lookups (the public API every stage uses) ─────────────────────────────

// classForSite(siteId) → 'small'|'medium'|'large'|'xl'|null
// null = this site is not part of the hard-locked demo set. Callers decide
// whether to fall back to the legacy free-choice path or block.
export function classForSite(siteId) {
  return SITE_CLASS[siteId] ?? null;
}

// classRecordForSite(siteId) → the full registry entry (geometry + rules + glb)
// or null. This is the one call the zoning gate makes to know everything about
// the building this site must produce.
export function classRecordForSite(siteId) {
  const cls = classForSite(siteId);
  return cls ? CLASS_REGISTRY[cls] ?? null : null;
}

// glbForClass(class) → '/BLDGS/glb<class>.glb' or null
export function glbForClass(sizeClass) {
  return CLASS_REGISTRY[sizeClass]?.glb ?? null;
}

// classGeometry(class) → the measured precedent record (the matched GLB) or null
export function classGeometry(sizeClass) {
  return CLASS_REGISTRY[sizeClass]?.geometry ?? null;
}

// isLockedSite(siteId) → true if this site is in the 4-site demo lock.
export function isLockedSite(siteId) {
  return siteId in SITE_CLASS;
}
