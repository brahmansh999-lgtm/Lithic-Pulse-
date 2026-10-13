import { compareByVolume, compareByWeight, formatTonnes, structuralWeightTonnes, CARBON_SOURCE_NOTE, CAST_STONE_DENSITY_KG_PER_M3 } from './carbonTracker';
import './CarbonBadge.css';

// CarbonBadge — small embodied-carbon comparison card, dropped into every
// pipeline stage (Zoning/Massing/Columns/Manufacturer) so the architect sees
// "cast stone vs. traditional concrete" grow more precise as real quantity
// data becomes available. Pass EITHER volumeM3 (early stages, estimated) OR
// weightKg (Manufacturer/Configurator, real BOM) — not both.
export default function CarbonBadge({ volumeM3, weightKg, compact = false }) {
  const result = weightKg != null ? compareByWeight(weightKg) : compareByVolume(volumeM3);
  if (!result) return null;

  const { castStoneCO2e, concreteCO2e, savedPct, estimated, basisM3 } = result;
  // Real weight from the cited density (2200 kg/m³) — NOT a structural
  // capacity or safe-height claim. No strength/load figure exists for this
  // mix, so we stop at weight and say so explicitly rather than imply more.
  const weightTonnes = basisM3 != null ? structuralWeightTonnes(basisM3) : null;

  return (
    <div className={`cb-root ${compact ? 'cb-root--compact' : ''}`} title={CARBON_SOURCE_NOTE}>
      <div className="cb-head">
        <span className="cb-title">Embodied Carbon</span>
        {estimated && <span className="cb-tag">estimated from massing volume</span>}
      </div>
      <div className="cb-bars">
        <div className="cb-bar-row">
          <span className="cb-bar-label">Cast stone</span>
          <div className="cb-bar-track">
            <div
              className="cb-bar-fill cb-bar-fill--cast"
              style={{ width: `${Math.max(4, (castStoneCO2e / concreteCO2e) * 100)}%` }}
            />
          </div>
          <span className="cb-bar-value">{formatTonnes(castStoneCO2e)}t CO2e</span>
        </div>
        <div className="cb-bar-row">
          <span className="cb-bar-label">Concrete</span>
          <div className="cb-bar-track">
            <div className="cb-bar-fill cb-bar-fill--concrete" style={{ width: '100%' }} />
          </div>
          <span className="cb-bar-value">{formatTonnes(concreteCO2e)}t CO2e</span>
        </div>
      </div>
      <div className={`cb-saved ${savedPct < 0 ? 'cb-saved--negative' : ''}`}>
        <span className="cb-saved-pct">{savedPct >= 0 ? '-' : '+'}{Math.abs(savedPct).toFixed(0)}%</span>
        <span className="cb-saved-label">
          {savedPct >= 0
            ? 'lower embodied carbon than an equivalent traditional concrete structure'
            : 'higher embodied carbon than an equivalent traditional concrete structure — see factors below'}
        </span>
      </div>
      {weightTonnes != null && (
        <div className="cb-provisional">
          Structural weight: ~{weightTonnes.toFixed(0)}t (from {CAST_STONE_DENSITY_KG_PER_M3} kg/m³ cited density).
          Weight only — no strength/load-capacity or max-height figure exists for this mix.
        </div>
      )}
      <div className="cb-provisional">
        Provisional factors (public benchmarks) — pending real supplier EPD data for GGBS, cement and basalt fibre.
      </div>
    </div>
  );
}
