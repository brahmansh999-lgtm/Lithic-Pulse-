import { useState } from 'react';
import kit from './data/kitOfParts.json';
import moulds from './data/moulds.json';
import catalogueData from './data/catalogue.json';
import layouts from './data/roomLayouts.json';
import { computeBOM, bomSummary, CATEGORIES } from './utils/computeBOM';
import './ExportPanel.css';

// ─── constants ───────────────────────────────────────────────────────────────

const RECIPE = catalogueData.substrateRecipe;

// Static reference catalogue (TabCatalogue only) — a parts encyclopedia,
// independent of the user's Configure choices, unrelated to the real
// config-aware BOM used by Parts Count/Materials/Delivery below.
const CAT_COMP = catalogueData.components;
const CAT_COMP_KEYS = Object.keys(CAT_COMP);
const CAT_COMP_COLORS = {
  COL_Q:          '#dedad6',
  VLT_FRAG:       '#c8c0b0',
  CORE_MONO:      '#8898b0',
  PANEL_SOLID:    '#bcb8b2',
  PANEL_WINDOW:   '#88aacc',
  PANEL_DOOR:     '#7a5030',
  SLAB_DECK:      '#a8a49e',
  FOUNDATION_PAD: '#6a7060',
};

// Per-CATEGORY swatch colours — the real computeBOM part list is grouped by
// CATEGORIES (Structural/Envelope/Openings/Fit-Out), not the old static
// component-key taxonomy, so parts/materials/delivery now key off that.
const CATEGORY_COLORS = {
  [CATEGORIES.STRUCTURAL]: '#a8a49e',
  [CATEGORIES.ENVELOPE]:   '#bcb8b2',
  [CATEGORIES.OPENINGS]:   '#88aacc',
  [CATEGORIES.FITOUT]:     '#8898b0',
};

// Concrete volume density (kg/m³) for the geopolymer mix — used for m³ calc
const DENSITY_KG_M3 = 2150;

// ─── helper ──────────────────────────────────────────────────────────────────

// Real, config-aware BOM — replaces the old getPartCounts() static lookup
// (which only bucketed by bed count and never saw the user's actual column
// type/count, balcony, partition, glazing, or pigment choices from Configure).
function getBOM(typology, config) {
  if (!typology) return [];
  return computeBOM(typology, config || {}, layouts);
}

// ─── Tab: Specification (original export) ────────────────────────────────────

function TabSpec({ typology, config, onBack, onViewRoom }) {
  const balcony   = kit.balconies.find(b => b.id === config.balcony);
  const partition = kit.partitions.find(p => p.id === config.partition);
  const pigment   = kit.pigmentation.find(p => p.id === config.pigment);
  const glazing   = kit.glazing.find(g => g.id === config.glazing);

  const baseCost  = typology.areaM2 * kit.baseCostPerM2 * (balcony?.costMult || 1);
  const labour    = typology.areaM2 * kit.labourPerM2;
  const delivery  = kit.deliveryCostBase;
  const total     = baseCost + labour + delivery;

  const castingWeeks  = Math.ceil((typology.areaM2 / 20) * 1.5);
  const assemblyWeeks = Math.ceil(typology.areaM2 / 30);
  const totalWeeks    = castingWeeks + assemblyWeeks + 2;

  const ref = {
    marbleDust:       RECIPE.marbleDust * 100,
    ggbs:             RECIPE.ggbs * 100,
    water:            RECIPE.water * 100,
    cement:           RECIPE.portlandCement * 100,
    basaltFibre:      RECIPE.basaltFibers * 100,
    superplasticizer: RECIPE.superplasticizer * 100,
  };

  const matBars = [
    { label: 'Marble Dust',      val: config.marbleDust,        refVal: ref.marbleDust,       color: '#c8c4bc' },
    { label: 'GGBS Binder',      val: config.ggbs,               refVal: ref.ggbs,             color: '#8898b0' },
    { label: 'Water',            val: config.water,              refVal: ref.water,            color: '#6888a0' },
    { label: 'Portland Cement',  val: config.cement,              refVal: ref.cement,           color: '#b0a898' },
    { label: 'Basalt Fibre',     val: config.basaltFibre,        refVal: ref.basaltFibre,       color: '#a8c890' },
    { label: 'Superplasticizer', val: config.superplasticizer,   refVal: ref.superplasticizer,  color: '#c8a8d0' },
  ];

  const handleDownload = () => {
    const refId = `LP-${typology.id.toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
    const lines = [
      '═══════════════════════════════════════════════',
      '  LITHIC PULSE — MANUFACTURING SPECIFICATION',
      '═══════════════════════════════════════════════',
      '',
      `  Reference  : ${refId}`,
      `  Date       : ${new Date().toLocaleDateString('en-GB')}`,
      '',
      '── UNIT ────────────────────────────────────────',
      `  Typology   : ${typology.label}`,
      `  Floor Area : ${typology.areaM2} m²`,
      '',
      '── CONFIGURATION ───────────────────────────────',
      `  Balcony    : ${balcony?.label}`,
      `  Partitions : ${partition?.label}`,
      `  Pigment    : ${pigment?.label}`,
      `  Glazing    : ${glazing?.label} (U=${glazing?.uValue} W/m²K)`,
      '',
      '── MATERIAL MIX ────────────────────────────────',
      `  Marble Dust       : ${config.marbleDust.toFixed(1)}%`,
      `  GGBS Binder       : ${config.ggbs.toFixed(1)}%`,
      `  Portland Cement   : ${config.cement.toFixed(1)}%`,
      `  Water             : ${config.water.toFixed(1)}%`,
      `  Basalt Fibre      : ${config.basaltFibre.toFixed(2)}%`,
      `  Superplasticizer  : ${config.superplasticizer.toFixed(2)}%`,
      '',
      '── PROGRAMME ───────────────────────────────────',
      `  Casting    : ${castingWeeks} weeks`,
      `  Assembly   : ${assemblyWeeks} weeks`,
      `  Contingency: 2 weeks`,
      `  Total      : ${totalWeeks} weeks`,
      '',
      '── COST ESTIMATE ───────────────────────────────',
      `  Materials  : £${Math.round(baseCost).toLocaleString()}`,
      `  Labour     : £${Math.round(labour).toLocaleString()}`,
      `  Delivery   : £${Math.round(delivery).toLocaleString()}`,
      `  TOTAL      : £${Math.round(total).toLocaleString()}`,
      '',
      '═══════════════════════════════════════════════',
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `lithic-pulse-${typology.id}-spec.txt`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="exp-tab-spec">
      <div className="exp-spec-cols">
        {/* Left */}
        <div className="exp-spec-left">
          <div className="exp-section-head">Unit</div>
          {[
            ['Floor Area', `${typology.areaM2} m²`],
            ['Module Grid', `${typology.gridX} × ${typology.gridZ}`],
            ['Storage', `${typology.storageM3} m³`],
            ['Type', typology.twoStorey ? '2-Storey' : 'Single Storey'],
          ].map(([l,v]) => (
            <div key={l} className="exp-row">
              <span className="exp-row-label">{l}</span>
              <span className="exp-row-val">{v}</span>
            </div>
          ))}

          <div className="exp-section-head" style={{ marginTop: 24 }}>Configuration</div>
          {[
            ['Balcony',      balcony?.label],
            ['Partitions',   partition?.label],
            ['Pigmentation', pigment?.label],
            ['Glazing',      `${glazing?.label} · U=${glazing?.uValue}`],
          ].map(([l,v]) => (
            <div key={l} className="exp-row">
              <span className="exp-row-label">{l}</span>
              <span className="exp-row-val">{v}</span>
            </div>
          ))}

          <div className="exp-section-head" style={{ marginTop: 24 }}>Programme</div>
          {[
            ['Casting Phase', `${castingWeeks} weeks`],
            ['Assembly Phase', `${assemblyWeeks} weeks`],
            ['Contingency', '2 weeks'],
            ['Total', `${totalWeeks} weeks`],
          ].map(([l,v]) => (
            <div key={l} className="exp-row">
              <span className="exp-row-label">{l}</span>
              <span className="exp-row-val">{v}</span>
            </div>
          ))}

          <div className="exp-section-head" style={{ marginTop: 24 }}>Cost Estimate</div>
          {[
            ['Materials', `£${Math.round(baseCost).toLocaleString()}`],
            ['Labour',    `£${Math.round(labour).toLocaleString()}`],
            ['Delivery',  `£${Math.round(delivery).toLocaleString()}`],
          ].map(([l,v]) => (
            <div key={l} className="exp-row">
              <span className="exp-row-label">{l}</span>
              <span className="exp-row-val">{v}</span>
            </div>
          ))}
          <div className="exp-total">
            <span className="exp-total-label">Total</span>
            <span className="exp-total-val">£{Math.round(total).toLocaleString()}</span>
          </div>

          <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button className="exp-btn primary" onClick={handleDownload}>↓ Download Spec Sheet</button>
            <button className="exp-btn accent" onClick={onViewRoom}>→ View Room</button>
            <button className="exp-btn secondary" onClick={onBack}>← Back to Assembly</button>
          </div>
        </div>

        {/* Right */}
        <div className="exp-spec-right">
          <div className="exp-section-head">Material Formulation vs. Reference</div>
          {matBars.map(r => (
            <div key={r.label} className="exp-mat-item">
              <div className="exp-mat-header">
                <span className="exp-mat-name">{r.label}</span>
                <div className="exp-mat-vals">
                  <span className="exp-mat-user">{r.val.toFixed(1)}%</span>
                  <span className="exp-mat-ref">ref {r.refVal.toFixed(1)}%</span>
                </div>
              </div>
              <div className="exp-mat-track">
                <div className="exp-mat-fill" style={{ width: `${Math.min(r.val, 70)}%`, background: r.color }} />
                <div className="exp-mat-ref-mark" style={{ left: `${Math.min(r.refVal, 70)}%` }} />
              </div>
            </div>
          ))}

          <div className="exp-section-head" style={{ marginTop: 32 }}>Master Moulds Required</div>
          <div className="exp-moulds-grid">
            {moulds.masterMoulds.map(m => (
              <div key={m.id} className="exp-mould-card">
                <div className="exp-mould-card-head">
                  <div className="exp-mould-dot" style={{ background: m.color }} />
                  <span className="exp-mould-card-name">{m.name}</span>
                </div>
                <div className="exp-mould-card-meta">
                  {m.weightKg} kg · {m.castingTimeH + m.demoulTimeH + m.finishH}h cycle
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Manufacturing Catalogue ─────────────────────────────────────────────

function TabCatalogue() {
  const [selected, setSelected] = useState(CAT_COMP_KEYS[0]);
  const part = CAT_COMP[selected];

  const materialColors = {
    'Formative Low-Carbon Cast Stone': '#c8c4bc',
    'Heavy Geopolymer Binder':         '#8898a8',
  };

  return (
    <div className="exp-catalogue">
      {/* Part list — left */}
      <div className="cat-list">
        <div className="cat-list-title">Parts Catalogue</div>
        {CAT_COMP_KEYS.map(key => {
          const p = CAT_COMP[key];
          const active = selected === key;
          return (
            <button
              key={key}
              className={`cat-item${active ? ' active' : ''}`}
              onClick={() => setSelected(key)}
            >
              <div className="cat-item-dot" style={{ background: CAT_COMP_COLORS[key] }} />
              <div className="cat-item-body">
                <span className="cat-item-id">{key}</span>
                <span className="cat-item-name">{p.name}</span>
              </div>
              <span className="cat-item-wt">{p.weightKg} kg</span>
            </button>
          );
        })}
      </div>

      {/* Detail — right */}
      <div className="cat-detail">
        <div className="cat-detail-head">
          <div className="cat-detail-eyebrow">Component · {selected}</div>
          <div className="cat-detail-name">{part.name}</div>
          <div className="cat-detail-mould">{part.mouldID}</div>
        </div>

        <div className="cat-detail-body">
          <div className="cat-stat-grid">
            {[
              { label: 'Unit Weight', val: `${part.weightKg} kg`,      sub: 'per piece' },
              { label: 'Assembly',    val: part.assemblyUnit.split('·')[0].trim(), sub: 'per node' },
            ].map(({ label, val, sub }) => (
              <div key={label} className="cat-stat">
                <span className="cat-stat-val">{val}</span>
                <span className="cat-stat-label">{label}</span>
                <span className="cat-stat-sub">{sub}</span>
              </div>
            ))}
          </div>

          <div className="cat-field-group">
            <div className="cat-field">
              <span className="cat-field-label">Assembly Unit</span>
              <span className="cat-field-val">{part.assemblyUnit}</span>
            </div>
            <div className="cat-field">
              <span className="cat-field-label">Material</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div className="cat-mat-dot" style={{ background: materialColors[part.material] || '#888' }} />
                <span className="cat-field-val">{part.material}</span>
              </div>
            </div>
            <div className="cat-field">
              <span className="cat-field-label">Mould ID</span>
              <span className="cat-field-val cat-field-mono">{part.mouldID}</span>
            </div>
          </div>

          {/* Mix recipe for this part's material */}
          <div className="cat-recipe">
            <div className="cat-recipe-title">Substrate Recipe</div>
            {[
              { label: 'Marble Dust',       pct: RECIPE.marbleDust,       color: '#c8c4bc' },
              { label: 'GGBS',              pct: RECIPE.ggbs,             color: '#8898b0' },
              { label: 'Water',             pct: RECIPE.water,            color: '#6888a0' },
              { label: 'Portland Cement',   pct: RECIPE.portlandCement,   color: '#b0a898' },
              { label: 'Basalt Fibres',     pct: RECIPE.basaltFibers,     color: '#a8c890' },
              { label: 'Superplasticizer',  pct: RECIPE.superplasticizer, color: '#c0b090' },
            ].map(({ label, pct, color }) => (
              <div key={label} className="cat-recipe-row">
                <span className="cat-recipe-label">{label}</span>
                <div className="cat-recipe-bar-wrap">
                  <div className="cat-recipe-bar" style={{ width: `${pct * 100}%`, background: color }} />
                </div>
                <span className="cat-recipe-pct">{(pct * 100).toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Parts Count ─────────────────────────────────────────────────────────

function TabPartsCount({ typology, config }) {
  const parts = getBOM(typology, config);
  const realParts = parts.filter(p => !p.isSummary);
  const { totalPieces, totalWeightT } = bomSummary(parts);
  const totalWeight = Math.round(parseFloat(totalWeightT) * 1000);

  return (
    <div className="exp-parts">
      <div className="exp-parts-header">
        <div>
          <div className="exp-section-head">Parts Count</div>
          <div className="exp-parts-subtitle">{typology?.label || '—'} · complete bill of quantities</div>
        </div>
        <div className="exp-parts-totals">
          <div className="exp-parts-total-pill">
            <span className="exp-parts-total-val">{totalPieces}</span>
            <span className="exp-parts-total-label">Total Pieces</span>
          </div>
          <div className="exp-parts-total-pill">
            <span className="exp-parts-total-val">{totalWeightT} t</span>
            <span className="exp-parts-total-label">Total Weight</span>
          </div>
        </div>
      </div>

      <div className="exp-parts-table">
        <div className="exp-parts-thead">
          <span>Component</span>
          <span>Part ID</span>
          <span>Unit Wt.</span>
          <span>Qty</span>
          <span>Total Wt.</span>
          <span>Share</span>
        </div>
        {realParts.map(p => {
          const share = totalWeight > 0 ? (p.weightKgTotal / totalWeight) * 100 : 0;
          return (
            <div key={p.id} className="exp-parts-row">
              <div className="exp-parts-cell-name">
                <div className="exp-parts-dot" style={{ background: p.color || CATEGORY_COLORS[p.category] }} />
                <span>{p.label}</span>
              </div>
              <span className="exp-parts-mono">{p.id}</span>
              <span className="exp-parts-num">{p.weightKgEach.toLocaleString()} kg</span>
              <span className="exp-parts-num exp-parts-qty">{p.qty}</span>
              <span className="exp-parts-num">{p.weightKgTotal.toLocaleString()} kg</span>
              <div className="exp-parts-share-cell">
                <div className="exp-parts-share-bar">
                  <div className="exp-parts-share-fill"
                    style={{ width: `${share}%`, background: p.color || CATEGORY_COLORS[p.category] }} />
                </div>
                <span className="exp-parts-share-pct">{share.toFixed(1)}%</span>
              </div>
            </div>
          );
        })}
        <div className="exp-parts-foot">
          <span>Total</span>
          <span />
          <span />
          <span className="exp-parts-num exp-parts-qty">{totalPieces}</span>
          <span className="exp-parts-num">{totalWeight.toLocaleString()} kg</span>
          <span />
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Materials Calculator ────────────────────────────────────────────────

function TabMaterials({ typology, config }) {
  const parts = getBOM(typology, config).filter(p => !p.isSummary);
  const totalConcKg = parts.reduce((sum, p) => sum + p.weightKgTotal, 0);
  const totalConcM3 = totalConcKg / DENSITY_KG_M3;

  const ingredients = [
    { label: 'Marble Dust',      pct: RECIPE.marbleDust,       color: '#c8c4bc', unit: 'kg' },
    { label: 'GGBS Binder',      pct: RECIPE.ggbs,             color: '#8898b0', unit: 'kg' },
    { label: 'Water',            pct: RECIPE.water,            color: '#6888a0', unit: 'L'  },
    { label: 'Portland Cement',  pct: RECIPE.portlandCement,   color: '#b0a898', unit: 'kg' },
    { label: 'Basalt Fibres',    pct: RECIPE.basaltFibers,     color: '#a8c890', unit: 'kg' },
    { label: 'Superplasticizer', pct: RECIPE.superplasticizer, color: '#c0b090', unit: 'L'  },
  ];

  const maxKg = Math.max(...ingredients.map(i => i.pct * totalConcKg));

  return (
    <div className="exp-materials">
      <div className="exp-mat-calc-header">
        <div className="exp-section-head">Materials Calculator</div>
        <div className="exp-mat-calc-subtitle">
          Based on {totalConcM3.toFixed(1)} m³ cast stone · {(totalConcKg / 1000).toFixed(1)} t total
        </div>
      </div>

      <div className="exp-mat-calc-grid">
        {ingredients.map(({ label, pct, color, unit }) => {
          const qty = pct * totalConcKg;
          const barW = maxKg > 0 ? (qty / maxKg) * 100 : 0;
          return (
            <div key={label} className="exp-mat-calc-card">
              <div className="exp-mat-calc-card-top">
                <div className="exp-mat-calc-swatch" style={{ background: color }} />
                <span className="exp-mat-calc-label">{label}</span>
              </div>
              <div className="exp-mat-calc-qty">
                {qty >= 1000
                  ? <><span className="exp-mat-calc-big">{(qty / 1000).toFixed(2)}</span><span className="exp-mat-calc-unit">t</span></>
                  : <><span className="exp-mat-calc-big">{Math.round(qty)}</span><span className="exp-mat-calc-unit">{unit}</span></>
                }
              </div>
              <div className="exp-mat-calc-bar-wrap">
                <div className="exp-mat-calc-bar" style={{ width: `${barW}%`, background: color }} />
              </div>
              <div className="exp-mat-calc-pct">{(pct * 100).toFixed(1)}% of mix</div>
            </div>
          );
        })}
      </div>

      <div className="exp-mat-calc-note">
        <div className="exp-section-head" style={{ marginBottom: 12 }}>Concrete Volume Breakdown</div>
        <div className="exp-mat-vol-table">
          {parts.map(p => {
            const volM3 = p.weightKgTotal / DENSITY_KG_M3;
            return (
              <div key={p.id} className="exp-mat-vol-row">
                <div className="exp-mat-vol-dot" style={{ background: p.color || CATEGORY_COLORS[p.category] }} />
                <span className="exp-mat-vol-name">{p.label}</span>
                <span className="exp-mat-vol-qty">{p.qty} pcs</span>
                <div className="exp-mat-vol-bar-wrap">
                  <div className="exp-mat-vol-bar"
                    style={{ width: `${totalConcM3 > 0 ? (volM3 / totalConcM3) * 100 : 0}%`, background: p.color || CATEGORY_COLORS[p.category] }} />
                </div>
                <span className="exp-mat-vol-val">{volM3.toFixed(2)} m³</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const TABS = [
  { id: 'spec',      label: 'Specification' },
  { id: 'catalogue', label: 'Catalogue'     },
  { id: 'parts',     label: 'Parts Count'   },
  { id: 'materials', label: 'Materials'     },
];

export default function ExportPanel({ typology, config, onBack, onViewRoom }) {
  const [tab, setTab] = useState('spec');

  return (
    <div className="exp-root">
      {/* Top tab bar */}
      <div className="exp-tabs">
        <div className="exp-tabs-left">
          <span className="exp-tabs-brand">Export</span>
          {typology && <span className="exp-tabs-unit">{typology.label}</span>}
        </div>
        <div className="exp-tabs-nav">
          {TABS.map(t => (
            <button
              key={t.id}
              className={`exp-tab-btn${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="exp-tab-body">
        {tab === 'spec'      && <TabSpec      typology={typology} config={config} onBack={onBack} onViewRoom={onViewRoom} />}
        {tab === 'catalogue' && <TabCatalogue />}
        {tab === 'parts'     && <TabPartsCount typology={typology} config={config} />}
        {tab === 'materials' && <TabMaterials  typology={typology} config={config} />}
      </div>
    </div>
  );
}
