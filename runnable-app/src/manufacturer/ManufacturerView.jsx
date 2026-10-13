import { useMemo, useState } from 'react';
import { useBrownfieldData } from '../planner/useBrownfieldData';
import { siteToMasterplanInput } from '../planner/SitePicker';
import GLBSiteView from '../planner/GLBSiteView';
import { CURATED_SITE_IDS, SITE_GLB } from '../planner/curatedSites';
import { TYPOLOGIES } from '../planner/masterplanGenerator';
import { aggregateBOM } from '../configurator/utils/aggregateBOM';
import progSmall from '../../public/BLDGS/programme_small.json';
import progMedium from '../../public/BLDGS/programme_medium.json';
import progLarge from '../../public/BLDGS/programme_large.json';
import progXl from '../../public/BLDGS/programme_xl.json';
import './ManufacturerView.css';

const PROGRAMME = { small: progSmall, medium: progMedium, large: progLarge, xl: progXl };

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
          <h1>Production dashboard</h1>
          <p>The building structure and aggregate bill-of-materials for each active site.</p>
        </div>
        {loading && <div className="mfg-loading">Loading sites…</div>}
        <div className="mfg-site-grid">
          {curatedSites.map(s => (
            <button key={s.id} className="mfg-site-card" onClick={() => { setSiteId(s.id); setShowBom(false); }}>
              <div className="mfg-site-card-name">{s.name}</div>
              <div className="mfg-site-card-meta">{s.borough} · {s.area}</div>
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
            <table className="mfg-bom-table">
              <thead>
                <tr><th>Component</th><th>Category</th><th>Qty</th><th>Weight (t)</th></tr>
              </thead>
              <tbody>
                {bom.parts.map(p => (
                  <tr key={p.id}>
                    <td>{p.label}</td>
                    <td>{p.category}</td>
                    <td>{p.qty.toLocaleString()}</td>
                    <td>{(p.weightKgTotal / 1000).toFixed(1)}</td>
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
      siteName={selectedSite.name}
      siteBounds={input?.siteBounds}
      onBack={() => setSiteId(null)}
      onViewHome={() => setShowBom(true)}
      viewHomeLabel="View bill of materials →"
    />
  );
}
