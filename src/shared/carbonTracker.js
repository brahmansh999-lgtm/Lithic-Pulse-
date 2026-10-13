// carbonTracker — single source of truth for the "cast stone vs. traditional
// concrete" embodied-carbon comparison shown at every pipeline stage
// (Zoning/Massing/Columns via volume estimate, Manufacturer/Configurator via
// real BOM weight). One module so every stage's number is computed the same
// way and can never independently drift, same reasoning as ZoningPlan's
// unit/floor count fix (src/planner/ZoningPlan.jsx).

// ── Cast stone mix — derived from the REAL per-unit material ratios already
// used by the live BOM (src/configurator/utils/aggregateBOM.js DEFAULT_CONFIG:
// marbleDust 50.3kg, ggbs 20.1kg, cement 5kg, water 16.7kg, basaltFibre 0.25kg,
// superplasticizer 0.25kg per unit — corrected 2026 to the real mix; cement
// was previously overstated at 11.7kg and basalt/superplasticizer were
// lumped into one 0.6kg "basalt" figure using basalt's much higher factor,
// which understated how green the real mix actually is). This is the actual
// mix the app already computes quantities for, not an invented material.
//
// Per-kg embodied carbon factors (kgCO2e per kg of material), cited:
//   - Cement (Portland/CEM I):      0.91  — ICE Database v3 (Circular Ecology), CEM I
//   - GGBS (ground granulated
//     blast-furnace slag, a steel
//     industry by-product):         0.07  — ICE Database v3, GGBS
//   - Marble dust (inert quarry
//     by-product filler, no firing):0.02  — treated as near-inert aggregate;
//                                     small factor covers quarrying/transport only
//   - Basalt fibre:                 1.30  — ICE Database v3, basalt fibre reinforcement
//   - Superplasticizer (chemical
//     admixture, used in small
//     doses — NOT the same factor
//     as basalt fibre):             0.75  — public admixture LCA figures typically
//                                     cite ~0.6–0.9 kgCO2e/kg; midpoint used
//   - Water:                        0.0003 — ICE Database v3, mains water
const CAST_STONE_MIX_KG_PER_UNIT = {
  marbleDust:       50.3,
  ggbs:             20.1,
  cement:            5,
  water:            16.7,
  basaltFibre:       0.25,
  superplasticizer:  0.25,
};

const FACTOR_KGCO2E_PER_KG = {
  marbleDust:       0.02,
  ggbs:             0.07,
  cement:           0.91,
  water:            0.0003,
  basaltFibre:      1.30,
  superplasticizer: 0.75,
};

const CAST_STONE_TOTAL_KG_PER_UNIT_MIX =
  Object.values(CAST_STONE_MIX_KG_PER_UNIT).reduce((s, v) => s + v, 0); // 99.4 kg of the reference mix

// Blended cast-stone factor: kgCO2e per kg of the actual mix, weighted by
// each material's real share of the mix (not a guess — this IS the mix the
// app's own BOM computes quantities for).
export const CAST_STONE_KGCO2E_PER_KG = Object.entries(CAST_STONE_MIX_KG_PER_UNIT)
  .reduce((sum, [key, kg]) => sum + kg * FACTOR_KGCO2E_PER_KG[key], 0) / CAST_STONE_TOTAL_KG_PER_UNIT_MIX;

// Cast stone dry density — used only to turn a massing VOLUME (m³) into an
// estimated weight (kg) at early stages (Zoning/Massing/Columns) before real
// per-part BOM weights exist. ~2,200 kg/m³ is typical for a GGBS/marble-dust
// cast-stone mix (denser than standard concrete ~2,400 kg/m³ is close but not
// identical — this is a stated estimate, not a measured value for THIS mix).
export const CAST_STONE_DENSITY_KG_PER_M3 = 2200;

// ── Traditional concrete benchmark — a cited reference figure, NOT measured
// from this product. Standard structural concrete (~C30/C40, ~350kg Portland
// cement per m³ mix), embodied carbon ≈ 0.10–0.13 kgCO2e/kg material,
// ≈ 290–350 kgCO2e/m³ — ICE Database v3 (Circular Ecology) "Concrete (general)"
// and RIBA/LETI 2030 typical structural concrete benchmarks. We use the
// midpoint of each cited range so the comparison isn't cherry-picked to
// either extreme.
export const CONCRETE_KGCO2E_PER_KG = 0.115;          // midpoint of 0.10–0.13
export const CONCRETE_DENSITY_KG_PER_M3 = 2400;        // standard structural concrete
export const CONCRETE_KGCO2E_PER_M3 = 320;             // midpoint of 290–350, used directly for volume-based estimates

export const CARBON_SOURCE_NOTE =
  'Cast stone quantities are the real mix (marble dust, GGBS, cement, water, basalt fibre, superplasticizer). ' +
  'Per-kg CO2 factors are public benchmarks (ICE Database v3), pending real supplier EPD data. ' +
  'Concrete figure is a cited reference benchmark (ICE Database v3 / RIBA-LETI 2030), not measured from this product.';

// compareByWeight(castStoneKg) → { castStoneCO2e, concreteCO2e, savedCO2e, savedPct }
// Use when a REAL per-part weight is known (Manufacturer/Configurator BOM).
// Compares against the concrete a builder would need to achieve the same MASS
// (same structural volume, since concrete is the substitution baseline).
export function compareByWeight(castStoneKg) {
  if (!castStoneKg || castStoneKg <= 0) return null;
  const castStoneCO2e = castStoneKg * CAST_STONE_KGCO2E_PER_KG;
  // Equivalent concrete volume for the same kg, at concrete's own density —
  // i.e. "how much concrete would you need to build the same structure".
  const equivalentVolumeM3 = castStoneKg / CAST_STONE_DENSITY_KG_PER_M3;
  const concreteKg = equivalentVolumeM3 * CONCRETE_DENSITY_KG_PER_M3;
  const concreteCO2e = concreteKg * CONCRETE_KGCO2E_PER_KG;
  const savedCO2e = concreteCO2e - castStoneCO2e;
  const savedPct = concreteCO2e > 0 ? (savedCO2e / concreteCO2e) * 100 : 0;
  return { castStoneCO2e, concreteCO2e, savedCO2e, savedPct, basisKg: castStoneKg };
}

// compareByVolume(volumeM3) → same shape as compareByWeight, for early
// pipeline stages (Zoning/Massing/Columns) that only have a massing VOLUME
// estimate (footprint × floor height × floor count), not real BOM parts yet.
// Marked lower-confidence in the returned object so callers can label it
// "estimated" rather than presenting it with the same certainty as a real
// BOM-driven figure.
export function compareByVolume(volumeM3) {
  if (!volumeM3 || volumeM3 <= 0) return null;
  const castStoneKg = volumeM3 * CAST_STONE_DENSITY_KG_PER_M3;
  const result = compareByWeight(castStoneKg);
  return result ? { ...result, estimated: true, basisM3: volumeM3 } : null;
}

// Real, cited-density weight only — no structural claim. There is no
// strength/load-capacity/height-limit data for this cast-stone mix anywhere
// in the app (no MPa figure, no engineered max-height rule), so this
// deliberately stops at weight and does not extrapolate a "safe height" or
// "max floors" number — that would be invented, not derived.
export function structuralWeightTonnes(volumeM3) {
  if (!volumeM3 || volumeM3 <= 0) return null;
  return (volumeM3 * CAST_STONE_DENSITY_KG_PER_M3) / 1000;
}

export function formatTonnes(kgCO2e) {
  return (kgCO2e / 1000).toFixed(kgCO2e >= 10000 ? 0 : 1);
}
