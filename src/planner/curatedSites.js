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
//
// Added 2026-08-13 — 6 more real "Permissioned" small-scale sites (site
// selection intentionally kept small-only per business direction: real
// architectural design work happens in Rhino downstream of this pipeline,
// so the curated set stays small/manageable rather than opening the full
// ~1,700-site dataset). Each fit-checked the same way as the original 4 —
// minimum-area oriented bounding rectangle vs. the small class's 27.1x45.1m
// GLB footprint, >=15% margin on the tighter axis:
//   540  2-16 Amelia Street SE17                        — 8 corners,  52x51m, fits 27x45m small
//   1104 69 Oldchurch Road, Romford                      — 10 corners, 95x31m, fits 27x45m small  [DEFERRED]
//   1142 North Kensington Gate North                     — 11 corners, 52x32m, fits 27x45m small  [DEFERRED]
//   449  159 Tottenham Lane N8                            — 18 corners, 57x31m, fits 27x45m small  [DEFERRED]
//   562  Land at Lampton Road TW3                         — 20 corners, 52x52m, fits 27x45m small  [DEFERRED]
//   1369 The Well House, George Road, Kingston            — 11 corners, 82x32m, fits 27x45m small  [DEFERRED]
//
// Narrowed 2026-08-16 to just [556, 643, 1550, 888, 540] — the 5 simplest
// (one rectangle + one simple polygon per size class), so multi-building
// tiling and the new bubble-resize/road-highlight features land on solid
// geometry first. The 10-20-corner sites above are DEFERRED pending a later
// expansion pass, not removed — see CURATED_SITE_IDS below.

// Narrowed 2026-08-16 to the 5 SIMPLEST sites (one rectangle + one simple
// polygon per size class, all 4 classes covered) so multi-building tiling,
// bubble-resize, and road-edge highlighting land on solid, low-risk geometry
// first. The other 6 (1104/1142/449/562/1369 — genuinely 10-20-corner
// irregular polygons) are DEFERRED, not removed — see their entries kept
// below, commented out, for when the set expands again.
export const CURATED_SITE_IDS = [556, 643, 1550, 888, 540];
// export const CURATED_SITE_IDS_DEFERRED = [1104, 1142, 449, 562, 1369];

// Which GLB file and building type belongs to each curated site.
// Matched by minimum-area rotated bounding rectangle — each GLB clears >=1.5m on every side.
export const SITE_GLB = {
  556:  { glb: '/BLDGS/glbsmall.glb',  buildingType: 'small'  }, // 47×79m polygon → 27×45m small
  643:  { glb: '/BLDGS/glbmedium.glb', buildingType: 'medium' }, // 60×58m rectangle → 52×44m medium
  1550: { glb: '/BLDGS/glblarge.glb',  buildingType: 'large'  }, // 66×71m rectangle → 58×60m large
  888:  { glb: '/BLDGS/glbXL.glb',     buildingType: 'xl'     }, // 130×155m polygon → 58×119m XL
  540:  { glb: '/BLDGS/glbsmall.glb',  buildingType: 'small'  }, // 52×51m → 27×45m small
  // Deferred sites (see CURATED_SITE_IDS above) — kept for when they return.
  // 1104: { glb: '/BLDGS/glbsmall.glb',  buildingType: 'small'  }, // 95×31m → 27×45m small
  // 1142: { glb: '/BLDGS/glbsmall.glb',  buildingType: 'small'  }, // 52×32m → 27×45m small
  // 449:  { glb: '/BLDGS/glbsmall.glb',  buildingType: 'small'  }, // 57×31m → 27×45m small
  // 562:  { glb: '/BLDGS/glbsmall.glb',  buildingType: 'small'  }, // 52×52m → 27×45m small
  // 1369: { glb: '/BLDGS/glbsmall.glb',  buildingType: 'small'  }, // 82×32m → 27×45m small
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
  540: 1,
  // 1104: 1,
  // 1142: 1,
  // 449: 1,
  // 562: 1,
  // 1369: 1,
};
