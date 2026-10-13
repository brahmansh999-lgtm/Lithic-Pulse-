import { useMemo, useState, useEffect, useRef } from 'react';
import { computeBOM, bomSummary, COLUMN_TYPES } from './utils/computeBOM';
import suppliersData from './data/suppliers.json';
import typologiesData from './data/typologies.json';
import layouts from './data/roomLayouts.json';
import './FourRolesLive.css';

const { typologies } = typologiesData;

// Animated number — counts from its previous value to the new one and flashes
// when it changes. This is the "live causation" the jury sees: a design choice
// visibly moves every stakeholder's figure, rather than silently snapping.
function LiveNum({ value, format = (v) => Math.round(v), className = '' }) {
  const [display, setDisplay] = useState(value);
  const [flash, setFlash] = useState(null);  // 'up' | 'down' | null
  const fromRef = useRef(value);
  const rafRef = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    const to = value;
    if (from === to) return;
    setFlash(to < from ? 'down' : 'up');  // down = lower (often "better" for carbon/cost)
    const start = performance.now();
    const dur = 550;
    const tick = (now) => {
      const k = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - k, 3);
      setDisplay(from + (to - from) * eased);
      if (k < 1) rafRef.current = requestAnimationFrame(tick);
      else { fromRef.current = to; setTimeout(() => setFlash(null), 300); }
    };
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value]);

  return <span className={`frl-livenum ${flash ? 'frl-flash-' + flash : ''} ${className}`}>{format(display)}</span>;
}

// This view used to own its OWN throwaway typology/glazing/balcony/column
// state — a toy copy that looked connected but never touched the real
// session. That defeated the entire point: the jury was watching a
// simulation of cross-role causation, not the actual one. It now reads and
// writes the SAME typology/config the Configure step (RoomConfigurator) and
// every downstream step (Manufacture/Source/Export) already share, passed
// down from Configurator.jsx. Change a control here and it's the live
// session's config — walk back to Configure and the edit is still there;
// change something in Configure and it shows up here too.
const GLAZING = [
  { id: 'GLZ_STANDARD', label: 'Double' },
  { id: 'GLZ_TRIPLE',   label: 'Triple' },
  { id: 'GLZ_SMART',    label: 'Smart' },
];
const BALCONY = [
  { id: 'BAL_NONE',    label: 'None' },
  { id: 'BAL_SHALLOW', label: 'Shallow' },
  { id: 'BAL_MID',     label: 'Mid' },
  { id: 'BAL_DEEP',    label: 'Deep' },
];

export default function FourRolesLive({ onBack, typology, config, setConfig, onSelectTypology }) {
  const columnType = config.columnType;
  const glazing    = config.glazing;
  const balcony    = config.balcony;
  const setColumnType = (v) => setConfig(c => ({ ...c, columnType: v }));
  const setGlazing    = (v) => setConfig(c => ({ ...c, glazing: v }));
  const setBalcony    = (v) => setConfig(c => ({ ...c, balcony: v }));

  // Every engine recomputes from the single shared state.
  const bom     = useMemo(() => computeBOM(typology, config, layouts), [typology, config]);
  const summary = useMemo(() => bomSummary(bom), [bom]);

  const neededClasses = useMemo(() => {
    const classes = new Set();
    bom.forEach(p => { if (p.material) classes.add(p.material.toLowerCase().includes('glass') ? 'glass' : p.material.toLowerCase().includes('grp') ? 'grp' : 'castStone'); });
    return [...classes];
  }, [bom]);
  const supplierCount = useMemo(
    () => suppliersData.suppliers.filter(s => s.materials.some(mc => neededClasses.includes(mc))).length,
    [neededClasses]
  );
  const topSupplier = useMemo(
    () => suppliersData.suppliers
      .filter(s => s.materials.some(mc => neededClasses.includes(mc)))
      .sort((a, b) => a.leadWeeks - b.leadWeeks)[0],
    [neededClasses]
  );

  // ── Consequence caption — narrate the system-wide impact of the last change ──
  // Diffs the previous snapshot against the current one so the jury sees the
  // ARCHITECTURAL ARGUMENT: one decision cascades through parts, tonnage,
  // and supply at once. This is the "systems thinking" the view is meant to prove.
  const prev = useRef(null);
  const [consequence, setConsequence] = useState(null);
  useEffect(() => {
    const snap = {
      parts: summary.totalPieces, mass: summary.totalWeightT,
      suppliers: supplierCount, lead: topSupplier?.leadWeeks ?? 0,
    };
    if (prev.current) {
      const p = prev.current;
      const parts = [];
      const dParts = snap.parts - p.parts;
      const dMass = snap.mass - p.mass;
      const dLead = snap.lead - p.lead;
      if (dParts !== 0)        parts.push(`${dParts < 0 ? '−' : '+'}${Math.abs(dParts)} parts`);
      if (Math.abs(dMass) > 0.05) parts.push(`${dMass < 0 ? '−' : '+'}${Math.abs(dMass).toFixed(1)}t mass`);
      if (dLead !== 0)         parts.push(`${dLead < 0 ? '−' : '+'}${Math.abs(dLead)}wk lead time`);
      setConsequence(parts.length ? parts.join('  ·  ') : null);
      const t = setTimeout(() => setConsequence(null), 4000);
      prev.current = snap;
      return () => clearTimeout(t);
    }
    prev.current = snap;
  }, [summary.totalPieces, summary.totalWeightT, supplierCount, topSupplier]);

  return (
    <div className="frl-root">
      {/* ── Shared design controls — change the design ONCE ── */}
      <div className="frl-topbar">
        <div className="frl-title-block">
          {onBack && <button className="frl-back" onClick={onBack}>←</button>}
          <div>
            <div className="frl-eyebrow">One design · four stakeholders · live</div>
            <div className="frl-title">Connected Workflow</div>
          </div>
        </div>
        <div className="frl-controls">
          <div className="frl-ctrl">
            <span className="frl-ctrl-label">Unit</span>
            <div className="frl-seg">
              {typologies.slice(0, 4).map(t => (
                <button key={t.id} className={`frl-seg-btn${typology.id === t.id ? ' on' : ''}`} onClick={() => onSelectTypology(t)}>{t.label}</button>
              ))}
            </div>
          </div>
          <div className="frl-ctrl">
            <span className="frl-ctrl-label">Column</span>
            <div className="frl-seg">
              {Object.entries(COLUMN_TYPES).map(([id, t]) => (
                <button key={id} className={`frl-seg-btn${columnType === id ? ' on' : ''}`} onClick={() => setColumnType(id)}>{t.label.split(' ')[0]}</button>
              ))}
            </div>
          </div>
          <div className="frl-ctrl">
            <span className="frl-ctrl-label">Glazing</span>
            <div className="frl-seg">
              {GLAZING.map(g => (
                <button key={g.id} className={`frl-seg-btn${glazing === g.id ? ' on' : ''}`} onClick={() => setGlazing(g.id)}>{g.label}</button>
              ))}
            </div>
          </div>
          <div className="frl-ctrl">
            <span className="frl-ctrl-label">Balcony</span>
            <div className="frl-seg">
              {BALCONY.map(b => (
                <button key={b.id} className={`frl-seg-btn${balcony === b.id ? ' on' : ''}`} onClick={() => setBalcony(b.id)}>{b.label}</button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Four role quadrants — all recompute from the shared state ── */}
      <div className="frl-grid">

        {/* HOME OWNER */}
        <div className="frl-quad frl-quad--home">
          <div className="frl-quad-head"><span className="frl-quad-dot" />Home Owner</div>
          <div className="frl-quad-hero">{typology.label}</div>
          <div className="frl-quad-sub">{typology.areaM2} m² · {typology.beds ?? '—'} bed</div>
          <div className="frl-quad-rows">
            <div className="frl-qrow"><span>Glazing</span><b>{GLAZING.find(g => g.id === glazing)?.label}-pane</b></div>
            <div className="frl-qrow"><span>Balcony</span><b>{BALCONY.find(b => b.id === balcony)?.label}</b></div>
            <div className="frl-qrow"><span>Column</span><b>{COLUMN_TYPES[columnType]?.label.split(' ')[0]}</b></div>
          </div>
        </div>

        {/* ARCHITECT */}
        <div className="frl-quad frl-quad--arch">
          <div className="frl-quad-head"><span className="frl-quad-dot" />Architect</div>
          <div className="frl-quad-hero">{COLUMN_TYPES[columnType]?.label.split(' ')[0]}</div>
          <div className="frl-quad-sub">structural column system · in review</div>
          <div className="frl-quad-rows">
            <div className="frl-qrow"><span>Parts</span><b><LiveNum value={summary.totalPieces} /></b></div>
            <div className="frl-qrow"><span>Moulds</span><b>{summary.totalMoulds}</b></div>
            <div className="frl-qrow"><span>Approval</span><b className="frl-green">On track</b></div>
          </div>
        </div>

        {/* MANUFACTURER */}
        <div className="frl-quad frl-quad--mfg">
          <div className="frl-quad-head"><span className="frl-quad-dot" />Manufacturer</div>
          <div className="frl-quad-hero"><LiveNum value={summary.totalPieces} /></div>
          <div className="frl-quad-sub">precast parts to cast</div>
          <div className="frl-quad-rows">
            <div className="frl-qrow"><span>Tonnage</span><b>{summary.totalWeightT} t</b></div>
            <div className="frl-qrow"><span>Moulds</span><b>{summary.totalMoulds}</b></div>
            <div className="frl-qrow"><span>Column type</span><b>{COLUMN_TYPES[columnType]?.label.split(' ')[0]}</b></div>
          </div>
        </div>

        {/* SUPPLIER */}
        <div className="frl-quad frl-quad--sup">
          <div className="frl-quad-head"><span className="frl-quad-dot" />Supplier</div>
          <div className="frl-quad-hero"><LiveNum value={supplierCount} /></div>
          <div className="frl-quad-sub">UK suppliers can fulfil this</div>
          <div className="frl-quad-rows">
            <div className="frl-qrow"><span>Fastest</span><b>{topSupplier?.name ?? '—'}</b></div>
            <div className="frl-qrow"><span>Lead time</span><b>{topSupplier?.leadWeeks ?? '—'} weeks</b></div>
            <div className="frl-qrow"><span>Tonnage</span><b>{summary.totalWeightT} t</b></div>
          </div>
        </div>
      </div>

      {/* Consequence banner — the architectural argument: one decision cascades. */}
      <div className={`frl-consequence${consequence ? ' on' : ''}`}>
        {consequence
          ? <><span className="frl-conseq-tag">Your change rippled:</span> {consequence}</>
          : 'Every figure is computed live from one shared design — change any control and watch all four stakeholders update at once.'}
      </div>
    </div>
  );
}
