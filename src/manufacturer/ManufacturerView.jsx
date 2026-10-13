import { useMemo, useState } from 'react';
import { useBrownfieldData } from '../planner/useBrownfieldData';
import { siteToMasterplanInput } from '../planner/SitePicker';
import GLBSiteView from '../planner/GLBSiteView';
import { CURATED_SITE_IDS, SITE_GLB } from '../planner/curatedSites';
import { TYPOLOGIES } from '../planner/masterplanGenerator';
import { aggregateBOM } from '../configurator/utils/aggregateBOM';
import CarbonBadge from '../shared/CarbonBadge';
import progSmall from '../../public/BLDGS/programme_small.json';
import progMedium from '../../public/BLDGS/programme_medium.json';
import progLarge from '../../public/BLDGS/programme_large.json';
import progXl from '../../public/BLDGS/programme_xl.json';
import './ManufacturerView.css';

const PROGRAMME = { small: progSmall, medium: progMedium, large: progLarge, xl: progXl };

// Category swatch colours for the BOM spec-table — same 4 real categories
// computeBOM.js's CATEGORIES defines (Structural/Envelope/Openings/Fit-Out),
// mapped onto the real global tokens (src/index.css) rather than an
// independently eyeballed palette.
const BOM_CAT_COLOR = {
  'Structural': '#c94a2c', // var(--red)
  'Envelope':   '#14140f', // var(--fg)
  'Openings':   '#2f74a3', // var(--blue)
  'Fit-Out':    '#3f8f57', // var(--green)
};

// Count the REAL unit cells in a class's building GLB programme (extracted
// straight from the .glb — see public/BLDGS/programme_*.json), then spread
// them across the 5 typologies so the aggregate BOM reflects the actual
// building the manufacturer is producing — sourced from the 3D-fit building
// structure, NOT a generated masterplan (that layer has been removed).
function unitsForClass(buildingType) {
  const prog = PROGRAMME[buildingType] || PROGRAMME.medium;
  let unitBoxes = 0;
  (prog.floors || []).forEach(fl => (fl.boxes || []).forEach(b => {
    if (b.type === 'units' || b.type === 'unit') unitBoxes++;
  }));
  if (!unitBoxes) return [];
  // Round-robin the real unit count across the 5 typologies (stable, so the
  // BOM is deterministic per class).
  const typos = TYPOLOGIES;
  return Array.from({ length: unitBoxes }, (_, i) => ({ typologyId: typos[i % typos.length].id }));
}

// Manufacturer: full visibility of the production output for each curated
// site — the 3D-fit building (the real class GLB, the structure being built)
// plus the aggregate bill-of-materials for that building. Zero edit
// affordances. No masterplan / iteration-gallery layer.
export default function ManufacturerView({ onBack }) {
  const { sites, loading } = useBrownfieldData();
  const [siteId, setSiteId] = useState(null);
  const [showBom, setShowBom] = useState(false);

  const curatedSites = useMemo(
    () => sites.filter(s => CURATED_SITE_IDS.includes(s.id)),
    [sites]
  );

  const selectedSite = useMemo(
    () => curatedSites.find(s => s.id === siteId) || null,
    [curatedSites, siteId]
  );

  const input = useMemo(
    () => selectedSite ? siteToMasterplanInput(selectedSite) : null,
    [selectedSite]
  );

  const buildingType = SITE_GLB[siteId]?.buildingType ?? 'medium';
  const units = useMemo(() => (selectedSite ? unitsForClass(buildingType) : []), [selectedSite, buildingType]);
  const bom = useMemo(() => (units.length ? aggregateBOM(units) : null), [units]);

  // ── Site list ──────────────────────────────────────────────────
  if (!selectedSite) {
    return (
      <div className="mfg-view">
        {onBack && <button className="mfg-back" onClick={onBack}>← Back</button>}
        <div className="mfg-header">
          <div className="mfg-header-kicker">06 / Production Dashboard</div>
          <h1>Production dashboard</h1>
          <p>The building structure and aggregate bill-of-materials for each active site.</p>
        </div>
        {loading && <div className="mfg-loading">Loading sites…</div>}
        <div className="mfg-list">
          {curatedSites.map((s, i) => (
            <button key={s.id} className="mfg-list-item" onClick={() => { setSiteId(s.id); setShowBom(false); }}>
              <div className="mfg-list-num">{String(i + 1).padStart(2, '0')}</div>
              <div className="mfg-list-body">
                <div className="mfg-list-name">{s.name}</div>
                <div className="mfg-list-meta">{s.borough} · {s.area}</div>
              </div>
              <div className="mfg-list-arrow">→</div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── Aggregate BOM table (the production numbers) ──────────────
  if (showBom) {
    return (
      <div className="mfg-view">
        <div className="mfg-plan-topbar">
          <button className="mfg-back" onClick={() => setShowBom(false)}>← Back to structure</button>
          <div className="mfg-plan-title">{selectedSite.name} · {buildingType.toUpperCase()} · {units.length} units</div>
        </div>
        {bom ? (
          <>
            <div className="mfg-summary-row">
              <div className="mfg-stat"><span>{units.length}</span>Homes</div>
              <div className="mfg-stat"><span>{bom.summary.totalWeightT}t</span>Total weight</div>
              <div className="mfg-stat"><span>{bom.summary.totalMoulds}</span>Unique moulds</div>
            </div>

            {/* Carbon tracker — real weight from the aggregated BOM (not an
                estimate, unlike the earlier Zoning/Massing/Columns stages). */}
            <div style={{ margin: '0 0 1.25rem' }}>
              <CarbonBadge weightKg={parseFloat(bom.summary.totalWeightT) * 1000} />
            </div>
            <table className="mfg-bom-table">
              <thead>
                <tr>
                  <th>Category</th><th>Component</th><th className="mfg-bom-num">Qty</th><th className="mfg-bom-num">Weight (t)</th>
                </tr>
              </thead>
              <tbody>
                {bom.parts.map((p, i) => (
                  <tr key={p.id} className={i % 2 === 0 ? 'mfg-bom-row--alt' : undefined}>
                    <td className="mfg-bom-cat">
                      <span className="mfg-bom-swatch" style={{ background: BOM_CAT_COLOR[p.category] || 'var(--fg-dimmer)' }} />
                      {p.category}
                    </td>
                    <td>{p.label}</td>
                    <td className="mfg-bom-num">{p.qty.toLocaleString()}</td>
                    <td className="mfg-bom-num">{(p.weightKgTotal / 1000).toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <div className="mfg-plan-error">No bill-of-materials available for this building.</div>
        )}
      </div>
    );
  }

  // ── 3D-fit building (the real structure being produced) ───────
  return (
    <GLBSiteView
      buildingType={buildingType}
      site={selectedSite}
      siteName={selectedSite.name}
      siteBounds={input?.siteBounds}
      onBack={() => setSiteId(null)}
      onViewHome={() => setShowBom(true)}
      viewHomeLabel="View bill of materials →"
      alwaysShowContinue
      backLabel="← Sites"
      stageLabel="05 / Building"
      showStepTrail={false}
    />
  );
}
