// The real GLA brownfield sites the platform is built around, all
// already status "Permissioned" in brownfield_london.geojson. IDs match
// the 1-based index useBrownfieldData() assigns when parsing that file in
// feature order — NOT the GeoJSON's own `properties.id`.
//
// These are the ONLY sites the platform treats as workable — SitePicker
// forces every other site's status to "Not permissioned" regardless of
// what brownfield_london.geojson itself says, so the architect works
// through exactly these, one at a time (see SitePicker's allSites memo).
//
// Updated 2026-07-01 — the set is now deliberately 2 clean rectangles +
// 2 genuinely irregular polygons, so the pipeline isn't "every site is a
// box" (the Medium/Large plots really ARE ~99% rectangles — that's the real
// geometry, not a bug — but the Small/XL are now real multi-corner polygons
// so the zoning/massing has to fit an irregular outline). All four are real,
// "Permissioned" GLA brownfield sites; each was checked to still fit its
// class GLB footprint (siteSpanM from classPrecedents.json) inside its own
// minimum-area oriented bounding rectangle with clear margin:
//   556  75 Torrington Park, London N12 (Barnet)       — polygon, 69% rect, 6 corners, 47x79m, fits 27x45m  small
//   643  257-265 (Odeon Cinema) Kensington High Street  — rectangle, ~99% rect, 60x58m,          fits 52x44m  medium
//   1550 Dover Court Estate, Dove/Wall/Baxter Road      — rectangle, ~99% rect, 66x71m,          fits 58x60m  large
//   888  Padcroft Works, Tavistock Road, Yiewsley       — polygon, 69% rect, 7 corners, 130x155m, fits 58x119m XL
// (Previous rectangular-only set was 1104 Oldchurch / 643 / 1550 / 1722 LSIP.)

export const CURATED_SITE_IDS = [556, 643, 1550, 888];

// Which GLB file and building type belongs to each curated site.
// Matched by minimum-area rotated bounding rectangle — each GLB clears >=1.5m on every side.
export const SITE_GLB = {
  556:  { glb: '/BLDGS/glbsmall.glb',  buildingType: 'small'  }, // 47×79m polygon → 27×45m small
  643:  { glb: '/BLDGS/glbmedium.glb', buildingType: 'medium' }, // 60×58m rectangle → 52×44m medium
  1550: { glb: '/BLDGS/glblarge.glb',  buildingType: 'large'  }, // 66×71m rectangle → 58×60m large
  888:  { glb: '/BLDGS/glbXL.glb',     buildingType: 'xl'     }, // 130×155m polygon → 58×119m XL
};

// One hand-picked seed per curated site = "the finalised plan" Home Owners
// see. This is the entire "fake it" approval step — a constant, not a live
// workflow. Update after eyeballing each site's top-20 in the Iteration
// Gallery (Architect view) and choosing the best-looking result.
export const FINALISED_SEED_BY_SITE = {
  556: 1,
  643: 1,
  1550: 1,
  888: 1,
};
