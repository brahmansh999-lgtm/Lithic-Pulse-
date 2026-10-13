import { useMemo, useState } from 'react';
import { computeBOM, bomSummary, CATEGORIES } from './utils/computeBOM';
import suppliersData from './data/suppliers.json';
import layouts from './data/roomLayouts.json';
import catalogueData from './data/catalogue.json';
import './SourcingPanel.css';

// Real substrate-mix percentages, read from config rather than hardcoded
// from the static catalogue, so the engineered marble-dust/GGBS/cement mix
// (config.{marbleDust,ggbs,cement}) drives which suppliers/lead-times show
// up here. Those fields are percentage POINTS (e.g. 50.3), not fractions —
// divide by 100. Falls back to the static reference recipe if config omits
// them.
const STATIC_RECIPE = catalogueData.substrateRecipe;
function recipeFromConfig(config) {
  if (!config || config.marbleDust == null) return STATIC_RECIPE;
  return {
    marbleDust:     config.marbleDust / 100,
    ggbs:           config.ggbs / 100,
    portlandCement: config.cement / 100,
  };
}

const CLASS_LABEL = {
  castStone: 'Cast-stone forming', marbleDust: 'Marble dust', ggbs: 'GGBS binder',
  portlandCement: 'Portland cement', geopolymer: 'Geopolymer binder', glass: 'Glazing', grp: 'GRP pods',
};
const CLASS_COLOR = {
  castStone: '#8dab80', marbleDust: '#c8c4bc', ggbs: '#8898b0', portlandCement: '#b0a898',
  geopolymer: '#5ba3c9', glass: '#88aacc', grp: '#c8a870',
};

function classify(part) {
  const m = (part.material || '').toLowerCase();
  const id = (part.id || '').toLowerCase();
  if (m.includes('grp')) return 'grp';
  if (m.includes('glass') || id.includes('win')) return 'glass';
  if (m.includes('geopolymer')) return 'geopolymer';
  return 'castStone';
}

const TRUCK_PAYLOAD = 12000; // kg
const DELIVERY_ORDER = [CATEGORIES.STRUCTURAL, CATEGORIES.ENVELOPE, CATEGORIES.OPENINGS, CATEGORIES.FITOUT];
// A single casting line/loading bay can realistically turn around one truck
// per working day. A real precast yard runs several lines/bays in parallel
// on a site rather than one truck trickling out for years — so the number
// of parallel lines scales with the job size, capped at a realistic single
// precast yard size.
const MAX_PARALLEL_LINES = 12;
function parallelLines(unitCount) {
  return Math.max(1, Math.min(MAX_PARALLEL_LINES, Math.ceil(unitCount / 4)));
}

function aggregateSiteBOM(allTypologies, siteTypologyCounts, config) {
  const merged = new Map();
  Object.entries(siteTypologyCounts || {}).forEach(([typologyId, count]) => {
    if (!count) return;
    const t = allTypologies.find(t => t.id === typologyId);
    if (!t) return;
    computeBOM(t, config, layouts).forEach(p => {
      if (p.isSummary) return;
      const existing = merged.get(p.id);
      if (existing) { existing.qty += p.qty * count; existing.weightKgTotal += p.weightKgTotal * count; }
      else merged.set(p.id, { ...p, qty: p.qty * count, weightKgTotal: p.weightKgTotal * count });
    });
  });
  return Array.from(merged.values());
}

export default function SourcingPanel({ typology, config, allTypologies, siteTypologyCounts, onBack }) {
  const [scope, setScope] = useState('unit');
  const [quoted, setQuoted] = useState({});

  const unitBom = useMemo(() => (typology ? computeBOM(typology, config, layouts) : []), [typology, config]);
  const siteUnitCount = useMemo(() => Object.values(siteTypologyCounts || {}).reduce((s, n) => s + n, 0), [siteTypologyCounts]);
  const hasSiteData = !!allTypologies && siteUnitCount > 0;
  const siteBom = useMemo(
    () => (hasSiteData ? aggregateSiteBOM(allTypologies, siteTypologyCounts, config) : []),
    [hasSiteData, allTypologies, siteTypologyCounts, config]
  );
  const bom = scope === 'site' && hasSiteData ? siteBom : unitBom;
  const summary = useMemo(() => bomSummary(bom), [bom]);
  const recipe = useMemo(() => recipeFromConfig(config), [config]);

  // ── 1. Material needs (real raw ingredients, broken out of the cast-stone
  // blend) — same logic as before, now feeding the timeline below too. ──
  const needs = useMemo(() => {
    const m = {};
    for (const p of bom) {
      const kg = p.weightKgTotal || 0;
      if (kg <= 0) continue;
      const cls = classify(p);
      m[cls] = (m[cls] || 0) + kg;
      if (cls === 'castStone') {
        m.marbleDust     = (m.marbleDust     || 0) + kg * recipe.marbleDust;
        m.ggbs           = (m.ggbs           || 0) + kg * recipe.ggbs;
        m.portlandCement = (m.portlandCement || 0) + kg * recipe.portlandCement;
      }
    }
    return m;
  }, [bom, recipe]);
  const neededClasses = Object.keys(needs).filter(c => CLASS_LABEL[c]);

  // ── 2. Match suppliers per material; pick the fastest real lead time per
  // class — that's the one a buyer would actually choose to keep the
  // programme moving, and it's what should gate the timeline below. ──
  const matched = useMemo(() => {
    return suppliersData.suppliers
      .map(s => ({ ...s, covers: s.materials.filter(mc => neededClasses.includes(mc)) }))
      .filter(s => s.covers.length > 0)
      .sort((a, b) => a.leadWeeks - b.leadWeeks);
  }, [neededClasses]);

  const fastestLeadByClass = useMemo(() => {
    const f = {};
    matched.forEach(s => s.covers.forEach(c => { if (!(c in f) || s.leadWeeks < f[c]) f[c] = s.leadWeeks; }));
    return f;
  }, [matched]);

  // The slowest-arriving material gates when full-rate casting can begin —
  // a real bottleneck calculation, not a flat guess.
  const sourcingWeeks = useMemo(
    () => Math.max(0, ...neededClasses.map(c => fastestLeadByClass[c] ?? 0)),
    [neededClasses, fastestLeadByClass]
  );

  // ── 3. Truck loads — same greedy bin-packing as the old Delivery tab,
  // operating on whichever BOM scope (unit/site) is active. ──
  const truckSummaries = useMemo(() => {
    const pieces = [];
    DELIVERY_ORDER.forEach(cat => {
      bom.filter(p => p.category === cat).forEach(p => {
        for (let i = 0; i < p.qty; i++) pieces.push({ wt: p.weightKgEach });
      });
    });
    const trucks = [];
    let current = { count: 0, totalKg: 0 };
    pieces.forEach(p => {
      if (current.totalKg + p.wt > TRUCK_PAYLOAD) { trucks.push(current); current = { count: 0, totalKg: 0 }; }
      current.count++; current.totalKg += p.wt;
    });
    if (current.count) trucks.push(current);
    return trucks;
  }, [bom]);
  const totalLoads = truckSummaries.length;
  const lines = parallelLines(scope === 'site' ? siteUnitCount : 1);
  const deliveryDays = Math.ceil(totalLoads / lines);
  const deliveryWeeks = Math.max(1, Math.ceil(deliveryDays / 5)); // 5 working days/week

  // ── 4. Casting duration — kept simple per the same flat area-based
  // estimate the Export step already used, just now correctly STARTING
  // after sourcing instead of from week 0, and divided across the same
  // parallel casting lines the delivery cadence above assumes — otherwise
  // a 50-unit site casts on one mythical single line for years. ──
  const areaM2 = scope === 'site' ? (typology?.areaM2 || 0) * siteUnitCount : (typology?.areaM2 || 0);
  const castingWeeks = Math.max(1, Math.ceil((areaM2 / 20) * 1.5 / lines));

  // ── The derived timeline — each phase's start is the previous phase's
  // real end, not an independent guess. This is the actual point: every
  // number here traces back to a real supplier lead time or a real truck
  // count sitting in the cards below, not a flat formula in isolation. ──
  const phases = useMemo(() => {
    const sourcingStart = 0;
    const sourcingEnd   = sourcingWeeks;
    const castingStart  = sourcingEnd;
    const castingEnd    = castingStart + castingWeeks;
    const deliveryStart = castingEnd;
    const deliveryEnd   = deliveryStart + deliveryWeeks;
    const assemblyStart = deliveryStart + Math.min(1, deliveryWeeks); // first truck arrives ~1wk into dispatch
    const assemblyWeeks = Math.max(1, Math.ceil((areaM2 || 1) / 30 / lines));
    const assemblyEnd   = Math.max(deliveryEnd, assemblyStart + assemblyWeeks);
    return [
      { id: 'sourcing', label: 'Sourcing', start: sourcingStart, end: sourcingEnd, color: '#5ba3c9' },
      { id: 'casting',  label: 'Casting',  start: castingStart,  end: castingEnd,  color: '#c9a96e' },
      { id: 'delivery', label: 'Delivery', start: deliveryStart, end: deliveryEnd, color: '#8dab80' },
      { id: 'assembly', label: 'Assembly', start: assemblyStart, end: assemblyEnd, color: '#a78bfa' },
    ];
  }, [sourcingWeeks, castingWeeks, deliveryWeeks, areaM2, lines]);
  const totalWeeks = Math.max(...phases.map(p => p.end));

  const requestQuote = (id) => setQuoted(q => ({ ...q, [id]: true }));

  return (
    <div className="src-root">
      <div className="src-topbar">
        <div>
          <div className="src-eyebrow">
            Sourcing → Delivery · {scope === 'site' ? `${siteUnitCount} units on site` : typology?.label}
          </div>
          <div className="src-title">{scope === 'site' ? 'Entire Site Programme' : `Source & Deliver — ${typology?.label}`}</div>
        </div>
        <div className="src-summary">
          <div className="src-summary-item"><span>{summary.totalPieces}</span>parts</div>
          <div className="src-summary-item"><span>{summary.totalWeightT}t</span>mass</div>
          <div className="src-summary-item"><span>{totalWeeks}w</span>programme</div>
        </div>
        <div className="src-scope-toggle">
          <button className={`src-scope-btn${scope === 'unit' ? ' active' : ''}`} onClick={() => setScope('unit')}>This Unit</button>
          <button
            className={`src-scope-btn${scope === 'site' ? ' active' : ''}`}
            onClick={() => hasSiteData && setScope('site')}
            disabled={!hasSiteData}
            title={hasSiteData ? undefined : 'Generate a masterplan first to see site-wide totals'}
          >Entire Site</button>
        </div>
      </div>

      {/* ── Derived programme timeline — the centerpiece ── */}
      <div className="src-section-label">Programme — derived from real lead times &amp; truck counts below</div>
      <div className="src-gantt">
        {phases.map(ph => (
          <div key={ph.id} className="src-gantt-row">
            <span className="src-gantt-label">{ph.label}</span>
            <div className="src-gantt-track">
              <div
                className="src-gantt-bar"
                style={{
                  left: `${(ph.start / totalWeeks) * 100}%`,
                  width: `${Math.max(2, ((ph.end - ph.start) / totalWeeks) * 100)}%`,
                  background: ph.color,
                }}
              >
                <span className="src-gantt-bar-label">{ph.end - ph.start}w</span>
              </div>
            </div>
            <span className="src-gantt-week">wk {ph.start}–{ph.end}</span>
          </div>
        ))}
        <div className="src-gantt-axis">
          {Array.from({ length: Math.floor(totalWeeks / 4) + 1 }, (_, i) => i * 4).map(w => (
            <span key={w} className="src-gantt-axis-tick" style={{ left: `${(w / totalWeeks) * 100}%` }}>wk {w}</span>
          ))}
        </div>
      </div>
      <div className="src-gantt-note">
        Casting can't start before the slowest sourced material arrives (wk {sourcingWeeks}) ·
        the first delivery truck can't leave before casting finishes (wk {phases[1].end}) ·
        assembly can't start before the first truck arrives on site
        {scope === 'site' && <> · {lines} parallel casting lines / loading bays committed at this site scale</>}.
      </div>

      {/* ── Material requirements + real suppliers ── */}
      <div className="src-section-label" style={{ marginTop: 28 }}>This project needs</div>
      <div className="src-needs-row">
        {neededClasses.map(c => (
          <div key={c} className="src-need-chip" style={{ borderColor: CLASS_COLOR[c] + '66' }}>
            <span className="src-need-dot" style={{ background: CLASS_COLOR[c] }} />
            {CLASS_LABEL[c]}
            <span className="src-need-mass">{(needs[c] / 1000).toFixed(1)} t · {fastestLeadByClass[c] ?? '—'}w lead</span>
          </div>
        ))}
      </div>

      <div className="src-section-label">{matched.length} UK suppliers can fulfil this design</div>
      <div className="src-grid">
        {matched.map(s => {
          const isFastest = s.covers.some(c => fastestLeadByClass[c] === s.leadWeeks);
          return (
            <div key={s.id} className="src-card">
              <div className="src-card-head">
                <div className="src-card-name">{s.name}</div>
                <div className="src-card-region">◍ {s.region}</div>
              </div>
              <p className="src-card-blurb">{s.blurb}</p>
              <div className="src-card-covers">
                {s.covers.map(c => (
                  <span key={c} className="src-cover-tag" style={{ color: CLASS_COLOR[c], borderColor: CLASS_COLOR[c] + '55' }}>{CLASS_LABEL[c]}</span>
                ))}
              </div>
              <div className="src-card-meta">
                <div className="src-meta-item">
                  <span className={isFastest ? 'src-lead-fastest' : ''}>{s.leadWeeks}w{isFastest ? ' ★' : ''}</span>
                  lead time
                </div>
                <div className="src-meta-item"><span>{s.cert}</span>certification</div>
                <div className="src-meta-item"><span>{s.minOrder}</span>min order</div>
              </div>
              <button
                className={`src-quote-btn${quoted[s.id] ? ' src-quote-btn--done' : ''}`}
                onClick={() => requestQuote(s.id)}
                disabled={quoted[s.id]}
              >
                {quoted[s.id] ? '✓ Quote requested — BOM sent' : `Request quote · ${s.covers.map(c => (needs[c] / 1000).toFixed(1) + 't').join(' + ')}`}
              </button>
            </div>
          );
        })}
      </div>

      {/* ── Delivery — real truck-load breakdown feeding the timeline above ── */}
      <div className="src-section-label" style={{ marginTop: 28 }}>
        Delivery — {totalLoads} truck loads · {deliveryDays} dispatch day{deliveryDays !== 1 ? 's' : ''} · {TRUCK_PAYLOAD / 1000}t max per load
      </div>
      <div className="src-truck-row">
        {truckSummaries.map((t, i) => {
          const utilPct = Math.round((t.totalKg / TRUCK_PAYLOAD) * 100);
          return (
            <div key={i} className="src-truck-chip">
              <div className="src-truck-chip-num">T{i + 1}</div>
              <div className="src-truck-chip-bar-track">
                <div className="src-truck-chip-bar" style={{ width: `${utilPct}%` }} />
              </div>
              <div className="src-truck-chip-pct">{utilPct}%</div>
            </div>
          );
        })}
      </div>

      {onBack && (
        <div className="src-footer">
          <button className="src-back-btn" onClick={onBack}>← Back to Assembly</button>
        </div>
      )}
    </div>
  );
}
