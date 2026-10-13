# The Architect Role — Pipeline Masterplan (Site → Zoning → Massing → Columns)

> Single source of truth for making the Architect half of the platform **foolproof and
> provable**: the right building lands on the right site, and the zoning, massing, and
> column placement we show are *demonstrably* the genesis of the final shipping GLB —
> not a cosmetic stat-similarity claim.
>
> Status legend: ✅ exists & correct · ⚠️ exists but broken/partial · ❌ missing

---

## 0. The Hook (what every stage must serve)

There are **4 building GLBs** — `BLDGS/glbsmall.glb`, `glbmedium.glb`, `glblarge.glb`,
`glbXL.glb` — classified **Small / Medium / Large / Extra-Large**. There are **4 site
classes** of the same names. The promise to the juror is:

> *On the Small site you get the Small building. Its zoning, its massing, and its column
> grid were all derived, on screen, from that exact building's real geometry. Same for
> Medium → Large → XL. The pipeline is the proof.*

Everything below exists to make that one sentence literally true and visible.

---

## 1. Current reality (what I found in the code)

| Layer | File | Status | Note |
|---|---|---|---|
| 4 class GLBs on disk | `BLDGS/*.glb` | ✅ | 70 / 228 / 213 / 425 MB. Never loaded by the app. |
| GLB geometry extractor | `scripts/extractZoning.mjs` | ✅ | Already extracts footprint, floors, `columnPositions`, `zoneBlocks`. Points at a now-deleted `bldg_gl/` dir. |
| Precedent data | `src/planner/data/precedentZoning.json` | ⚠️ | 11 anonymous `precedent_N` ("iteration 1–11"). **None tagged with a size class. None points at a `.glb`.** |
| Curated sites | `src/planner/curatedSites.js` | ⚠️ | 7 site IDs. No site→building-class binding. |
| Site size tier | `SitePicker.jsx` `sizeTierOf()` | ⚠️ | Area tertiles → small/medium/big. **Disconnected from the 4 building classes.** |
| Zoning gate | `ArchitectZoningGate.jsx` | ⚠️ | `SITE_DESIGN_RULE_PRESET` maps 4 site IDs → *rule presets* only. Precedent is picked manually from all 11. |
| Design rules | `zoningTargets.js` `DESIGN_RULE_PRESETS` | ⚠️ | ~40% of the sketch rules encoded (cores, noise corner, communal corner, balcony/solar azimuth). Missing: community-zone-East, river-view, vehicular-one-corner, voids+solids. |
| Massing variations | `zoningMassingVariations.js` | ⚠️ | Uses **one generic DXF plate (42×30 m) for all four classes.** `bestGLBMatch` picks the stat-closest precedent — **can match the wrong class.** |
| Column stage | `ColumnStage.jsx` | ✅ | Consumes `chosen.matchedGLB.columnPositions`. Works *if* the right GLB is matched. |

### The three real defects

1. **No class binding.** Site class never forces a building class never forces a GLB.
   `bestGLBMatch` is free to pick a 348-unit XL precedent for a pocket site.
2. **The 4 GLBs are inert.** The "matched GLB" is an abstract precedent, not the file
   that actually ships on that site, so "the building came from this massing" is unproven.
3. **One zoning source for all sizes.** Small and XL are massed from the same 42×30 plate,
   so the massing can't resemble the per-class end building.

---

## 2. Target architecture

```
SITE (curated, has a hard class tag)
   │  small | medium | large | xl   ← CLASS, not an area tertile
   ▼
CLASS REGISTRY  (one record per class)
   ├─ glb file            BLDGS/glb<class>.glb
   ├─ measured geometry   footprint, floors, f2f, column grid + REAL columnPositions, zoneBlocks
   └─ design rules        full rule set transcribed from the SPATIALLOGIC sketches
   ▼
ZONING  (02)   target numbers scaled from THIS class's measured geometry to THIS site's area
   │            + ≥10 rule-driven layout iterations, each previewed
   ▼
MASSING (02b)  ≥10 silhouette variations massed on THIS class's own zoneBlocks plate
   │            scored ONLY against THIS class's GLB (hard-locked — never another class)
   │            each variation pre-computes where its columns will be
   ▼
COLUMNS (03)   real measured columnPositions from THIS class's GLB, mapped onto the
                chosen massing's footprint
   ▼
 → matches BLDGS/glb<class>.glb  ← the proof closes here
```

The **CLASS REGISTRY** is the new keystone. It is the single object that says
"Small ⇒ this GLB ⇒ this geometry ⇒ these rules," and every stage reads its class off it.

---

## 3. The rulebook (transcribed from the two SPATIALLOGIC sketches)

> Source: `SPATIALLOGIC/WhatsApp Image 2026-06-30 at 10.46.0{1,2}.jpeg`. These are the
> architect's authored zoning rules per building size — the spec the generator must obey.

### Small & Medium — *site: Berkly Square* — **single service core**
- Minimal service space (reduce wastage). **One** service core.
- Balance between community and resident rest spaces.
- **Community zone in the EAST** → soft/subtle morning light (seating areas).
- **Most balconies face EAST** → morning sun through the day.
- **Openings toward SOUTH** → max solar gain.
- **Voids + solids** to break the monotony of the building.
- **Vehicular + community clustered to ONE corner** to concentrate noise.
- Vehicular access **limited to one side** of the site (noise).
- Courtyards as **buffer** spaces.

### Large — *site: London Sustainable Industries, South plot 10/40* — **double service core**
- **Two** service cores (large footprint).
- **Balconies facing SOUTH/WEST** get max sun; other faces get subtle light.
- **Courtyard + communal in the SOUTH-WEST** → max light.
- Courtyard as buffer; **roofed + open** communal areas.
- Main road access.
- **Vehicular in one corner**, **vehicular/pedestrian separated** (noise).
- **Voids + solids** to break monotony. Single coherent block (not fragmented).

### XL (large-double, river variant) — **double service core**
- **Views oriented to the river.**
- Courtyards as buffer; main access.
- **Communal spaces in E / W / S** for max sun.
- **Most balconies face E / W / S.**
- Vehicular/pedestrian separated. "Everything else pretty much same" as Large.

### Rule → generator-parameter mapping

| Sketch rule | Param (today / needed) | Status |
|---|---|---|
| 1 vs 2 cores | `fixedCoreCount` | ✅ |
| Noise to one corner | `noiseClusterCorner` | ✅ |
| Communal corner (SW) | `communalCorner` | ✅ |
| Balcony facing (E / E·W·S) | `balconyAzimuth` / `balconyFacingMulti` | ✅ |
| Openings south | `solarAzimuth` | ✅ |
| **Community zone in EAST** | `communityZoneSide` | ❌ new |
| **River-view orientation** | `viewAzimuth` / `viewFeature` | ❌ new |
| **Vehicular one side/corner** | `vehicularCorner` (distinct from noise) | ❌ new |
| **Voids + solids / break monotony** | `voidSolidVariance` (massing-profile bias) | ❌ new |

---

## 4. Execution plan (stage by stage, each independently shippable)

### Phase A — Class Registry + GLB binding (the keystone) ✅ DONE (2026-07-01)
> Shipped: `scripts/extractClasses.mjs` → `src/planner/data/classPrecedents.json` (4
> class-tagged records w/ real geometry). New `src/planner/buildingClasses.js` =
> `CLASS_REGISTRY` + `SITE_CLASS` hard-lock + `classForSite/classRecordForSite/glbForClass`.
> `ArchitectZoningGate.jsx` now forces the class precedent + rules for locked sites and shows
> a 🔒 locked precedent card. Build clean, binding verified (all 4 sites → correct GLB).
> KNOWN ISSUE → Phase B: `glbmedium.glb` extracted only **4 columns** (its column meshes are
> named differently than the extractor's "column" fuzzy-match expects) — implausible for an
> 1703 m² 8-floor building; real grid must be recovered before the Medium column stage is honest.

#### Original Phase A spec (for reference):
1. Re-point `scripts/extractZoning.mjs` at `BLDGS/`, tag each output with
   `sizeClass: small|medium|large|xl` and `glb: '/BLDGS/glb<class>.glb'`.
   Re-run → write `src/planner/data/classPrecedents.json` (4 records).
2. New `src/planner/buildingClasses.js`: `CLASS_REGISTRY` keyed by class →
   `{ glb, geometry (the extracted record), designRules }`. Export
   `classForSite(siteId)` and `glbForClass(class)`.
3. New `SITE_CLASS` map (one entry per curated site → exactly one class). This is the
   **hard lock**. Replace the area-tertile `sizeTierOf` for curated sites with this.

### Phase B — Hard-locked matcher ✅ DONE (2026-07-01)
> Shipped: `generateZoningMassingVariations({ lockedClass })` now scores every candidate
> against the site's locked class GLB ONLY (`candidatePrecedents = [lockedClass]`), never the
> stat-closest of 11. `MassingStage` resolves `classGeometry(spec.lockedClass)` and threads it
> through; callout + sub-header state the lock explicitly. `ColumnStage` gets the locked GLB
> name via `chosenMassing.matchedGLB.name`. **Verified via Vite SSR: all 20 variations on each
> of the 4 sites converge to that site's own GLB (I2 holds); unlocked path unchanged.**
> ALSO FIXED: `estimateColumnGrid` was sampling only the lowest 1m basement band → undercounted
> columns on every GLB (medium read 4!). Now collapses the full column stack onto the floor
> plan. Real counts: small 83 / medium 241 / large 292 / xl 584 (was 15/4/155/310).
> NOTE for Phase C: Small converges at only ~60% (Med/Large ~90%) because massing still uses the
> generic 42×30 plate — Phase C (per-class plate from each GLB's siteSpanM) closes this gap.

#### Original Phase B spec (for reference):
4. In `zoningMassingVariations.js`, `siteFitPrecedents` / `bestGLBMatch` must score
   **only against the site's locked class precedent** — never cross-class. The "match %"
   becomes "how close did this massing get to *the* building," which is the honest claim.
5. Each massing variation carries `matchedGLB = the locked class GLB` + its
   `columnPositions`, so the Column stage is already correct.

### Phase C — Per-class zoning source ✅ DONE (2026-07-01)
> Shipped: `plotDimsFor(lockedClass)` sizes the massing plate to each GLB's real
> footprint (siteSpanM scaled to footprintAreaM2, aspect kept), threaded through
> `toPlan(candidate, plotDims, floorCount)` + the generator. Per-class floor count now
> drives `plan.floors.max`. **Convergence: Small 60%→99%, Medium 94%→99%, Large 91%→97%,
> XL 78%→98% — footprints AND floor counts now match the real GLBs within ~2%.**
> ALSO FIXED a real footprint-definition bug: `scoreAgainstGLBShape` was SUMMING every
> floor-group's units plate (counting footprint ~4×). Now uses `plan.footprintM2` (the real
> ground plate, recorded in `toPlan`), falling back to the sum only for the legacy
> generateMasterplan path. This bug had been silently inflating every plan's footprint.

#### Original Phase C spec (for reference):
6. Massing plate (`PLOT_W_M/PLOT_D_M`) comes from the class's measured `siteSpanM`,
   not the fixed 42×30. `zoneBlocks` come from the class GLB's own extraction, so Small
   is massed from Small's real exterior proportions, XL from XL's.

### Phase D — Full rule encoding ✅ DONE (2026-07-01)
> Shipped: the 4 missing sketch rules now exist on all presets AND drive the generator:
> `communityZoneSide` (Medium=East), `vehicularCorner` (one-corner, separate from noise),
> `viewAzimuth`/`viewFeature` (XL=river/east), `voidSolidVariance` (stepped massing). All four
> are scored in `designRulesScore` and recorded on the building in `masterplanGenerator` for the
> zoning diagram. Surfaced in the `ArchitectZoningGate` rules panel.
> KEY FIX: rules were only a glbScore TIEBREAKER, so toggling one almost never changed which
> iterations surfaced. Added a BLENDED `rankScore = glbScore + ruleBonus*0.28`, so rules reorder
> within a convergence band without floating poor-fit candidates. Verified: all 4 rules now
> change the ranking; convergence preserved at 96–98%; ≥10 iterations at BOTH Zoning (18) and
> Massing (20).
> DESIGN DECISION (2026-07-01, user): Medium's sketch asks for community-East AND vehicular-SW,
> which contend for the single non-units edge — **noise/vehicular wins**; community-East is a
> weak subordinate preference (reward 6 vs noise 10 + vehicular 8), fires in isolation but yields
> in the full preset. Encoded intentionally, not accidentally.

#### Original Phase D spec (for reference):
7. Add the 4 missing params to `DESIGN_RULE_PRESETS` and make them *drive* the generator
   (`designRulesScore` + `generateMasterplan` orientation), not just annotate the UI.
8. Ensure ≥10 iterations at **both** Zoning and Massing, each one rule-consistent, each
   previewing the massing it implies (zoning choice already constrains the silhouette).

### Phase E — Legendary graphics (BIG-level) ✅ DONE (2026-07-01)
> Shipped: new `src/planner/isoEngine.js` = ONE shared isometric engine + the architect's own
> hand-drawn legend (green-communal / semi-open / service-core / dwellings), used by both
> Massing and Columns so the stages read as one study. MassingZoningPreview rewritten to a
> **2D-packed cell mosaic** per floor (exploded plates of green/gold/white zone cells, like the
> sketch) instead of 1D strips. ColumnStage: shared engine, ghosted building volume + shadow
> ground plane, glowing real-GLB columns, a **NN% MATCH** convergence badge, balanced
> canvas+sidebar layout. Verified by screenshot across ALL 4 classes (massing grid + column
> hero) — small 98% / medium 97% / large 97% / xl 96%, all rendering correctly. Build clean.
> CRITICAL BUG FOUND + FIXED via screenshot loop: the SVG `strokeWidth="0.22"` (in normalised
> 0..1 units) on ~0.25-wide cells painted each cell almost entirely black — the diagrams
> rendered as dark silhouettes despite correct bright geometry in the DOM. Dropped to 0.012.
> (The pure-SSR-render-vs-app-render diff is what isolated it — DOM had bright fills, screen was
> black ⇒ stroke, not colour/opacity/HMR.)

#### Original Phase E spec (for reference):
9. Separate visual pass once the logic is provably correct: consistent isometric language
   across Zoning↔Massing↔Columns, the legend from the sketches (green / semi-open /
   service core), animated stage-to-stage "this became that" reveal, the locked-GLB
   ghost behind the converging massing. Planned after A–D so we polish truth, not fiction.

---

## 5. Invariants (the regression tests this must never violate)

- **I1.** `classForSite(siteId)` is total over all curated sites and returns exactly one class.
- **I2.** On site of class X, every massing variation's `matchedGLB` is `glb<X>` — never another class.
- **I3.** Zoning targets are scaled from class X's measured geometry, applied to *this site's* area.
- **I4.** Column positions rendered in stage 03 are the measured `columnPositions` of `glb<X>`.
- **I5.** Each enabled design rule changes generator output (not just UI text) — verifiable by toggling it and seeing the iteration set change.
- **I6.** ≥10 distinct iterations at Zoning and ≥10 at Massing, all rule-consistent.

---

## 6. Open questions / risks

- **R1.** The 4 GLBs are 70–445 MB. The browser must NOT load them whole at this stage —
  we ship only the small extracted JSON (the extractor already runs offline in Node). The
  full GLB is the *final* viewer's concern, not the architect pipeline's.
- **R2.** ✅ RESOLVED. Demo is exactly **4 sites, 4 classes, 1:1** (the other 3 curated IDs
  — 687/1339/238 — are dropped from the locked set, NOT deleted from the codebase):

  | Class | Site ID | Site | GLB |
  |---|---|---|---|
  | Small | 1721 | Connaught Tunnel East, Silvertown | `BLDGS/glbsmall.glb` |
  | Medium | 568 | Hillside, 9 Fountain Drive | `BLDGS/glbmedium.glb` |
  | Large (single) | 1722 | LSIP South Plot 10, Dagenham | `BLDGS/glblarge.glb` |
  | XL (large double) | 1723 | Royal Albert Dock, Beckton | `BLDGS/glbXL.glb` |

  This is the `SITE_CLASS` hard-lock map (Phase A, step 3). No site or data file is deleted.
- **R3.** XL rules ("river variant") need a confirmed site with an actual river edge for the
  `viewAzimuth` to be meaningful, else it's arbitrary.

---

*Authored from a full read of: `zoningTargets.js`, `zoningMassingVariations.js`,
`ArchitectZoningGate.jsx`, `MassingStage.jsx`, `ColumnStage.jsx`, `curatedSites.js`,
`SitePicker.jsx`, `scripts/extractZoning.mjs`, `precedentZoning.json`, and the two
SPATIALLOGIC sketches. Nothing here is assumed — every ✅/⚠️/❌ was checked against source.*
