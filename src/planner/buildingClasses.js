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
// The site→class demo lock (R2 in the masterplan doc). Site IDs are the
// 1-based useBrownfieldData() indices, and MUST match CURATED_SITE_IDS in
// curatedSites.js (the list the SitePicker actually offers). Original 4
// (2026-07-01, 2 rectangles + 2 real polygons):
//    556 75 Torrington Park, N12 (Barnet)        → small (irregular polygon)
//    643 Odeon Cinema, Kensington High Street     → medium (rectangle)
//   1550 Dover Court Estate, Islington            → large (single core, rectangle)
//    888 Padcroft Works, Yiewsley (Hillingdon)    → xl    (large double, irregular polygon)
// Added 2026-08-13 — 6 more small-scale sites (all real, "Permissioned" GLA
// brownfield sites, all fit-checked against the small class's 27.1x45.1m
// GLB footprint via siteFit.js's fitFootprintToSite/minAreaRect with >=15%
// margin, same standard the original 4 were vetted against):
//    540 2-16 Amelia Street, SE17 (Southwark)         → small
//   1104 69 Oldchurch Road, Romford (Havering)        → small
//   1142 North Kensington Gate North (OPDC)           → small
//    449 159 Tottenham Lane, N8 (Haringey)            → small
//    562 Land at Lampton Road, TW3 (Hounslow)         → small
//   1369 The Well House, George Road (Kingston)       → small
export const SITE_CLASS = {
  556:  'small',
  643:  'medium',
  1550: 'large',
  888:  'xl',
  540:  'small',
  1104: 'small',
  1142: 'small',
  449:  'small',
  562:  'small',
  1369: 'small',
};

// Which design-rule preset each class uses (the sketch-derived rules live in
// zoningTargets.js; this just maps class → preset id so the two stay aligned).
//
// The 7 recovered classes (iteration1/2/3/4/5/8/11 — real buildings restored
// from the Recycle Bin, see MEMORY: seed-building expansion) have no sketch
// of their own, so each is mapped to whichever of the 4 ORIGINAL classes its
// real measured footprintAreaM2 sits closest to (classPrecedents.json:
// small=896m², medium=1703m², large=2707m², xl=5724m²) — reusing the nearest
// real rule set rather than inventing new sketch-derived rules that were
// never actually sketched:
//   iteration1  2873m² → large  (Δ166,  nearest)
//   iteration2  3349m² → large  (Δ642 vs Δ2375 to xl)
//   iteration3  3349m² → large  (same basis as iteration2)
//   iteration4  4441m² → xl     (Δ1283 vs Δ1734 to large)
//   iteration5  2491m² → large  (Δ216,  nearest)
//   iteration8  5867m² → xl     (Δ143,  nearest)
//   iteration11 1702m² → medium (Δ1,    effectively exact)
const CLASS_RULE_PRESET = {
  small:  'small_building',
  medium: 'medium_building',
  large:  'large_building',
  xl:     'extra_large_building',
  iteration1:  'large_building',
  iteration2:  'large_building',
  iteration3:  'large_building',
  iteration4:  'extra_large_building',
  iteration5:  'large_building',
  iteration8:  'extra_large_building',
  iteration11: 'medium_building',
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
