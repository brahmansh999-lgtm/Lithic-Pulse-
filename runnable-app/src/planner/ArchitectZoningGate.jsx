import { useEffect, useMemo, useRef, useState } from 'react';
import { precedents, buildZoningSpec, scoreAgainstZoning, DESIGN_RULE_PRESETS, NO_DESIGN_RULES } from './zoningTargets';
import { classRecordForSite } from './buildingClasses';
import { generateMasterplan, CONCEPTS } from './masterplanGenerator';
import { attachColumnGrids } from './structuralGrid';
import ZoningDiagram from './ZoningDiagram';
import './ArchitectZoningGate.css';

const PREVIEW_SEED_BUDGET = 18;
const PREVIEW_COUNT = 10;

// Auto-selects the correct design rule preset for each curated site,
// so the architect sees the right typology rules pre-loaded when the
// zoning panel opens — no manual selection needed.
// Must match CURATED_SITE_IDS / SITE_CLASS. Updated 2026-07-01:
// 556 = 75 Torrington Park (small), 643 = Odeon Kensington (medium),
// 1550 = Dover Court Estate (large single), 888 = Padcroft Works (xl / large double).
const SITE_DESIGN_RULE_PRESET = {
  556:  'small_building',
  643:  'medium_building',
  1550: 'large_building',
  888:  'extra_large_building',
};

// Generates up to PREVIEW_COUNT distinct candidate plans (ranked by
// scoreAgainstZoning, best first) instead of only the single highest-
// scoring one — the architect steps through these zoning iterations
// (ArchitectZoningGate's own step-through UI) before approving one, same
// pattern as the Massing step's candidate step-through.
function findTopPreviews(siteBounds, sitePolygon, spec, count = PREVIEW_COUNT) {
  const siteContext = spec.targetFloorCount ? { maxFloors: spec.targetFloorCount + 1 } : undefined;
  const results = [];
  for (let i = 0; i < PREVIEW_SEED_BUDGET; i++) {
    const concept = CONCEPTS[i % CONCEPTS.length];
    const seed = i + 1;
    let plan;
    try {
      plan = generateMasterplan(siteBounds, seed, sitePolygon, { siteContext, concept, designRules: spec.designRules, lockedClass: spec.lockedClass ?? null });
    } catch { continue; }
    if (!plan) continue;
    const { score } = scoreAgainstZoning(plan, spec);
    results.push({ plan, score, seed });
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, count);
}

// Overlay panel — slides in over the right side of the map after a site is
// selected. The map stays fully visible underneath so the architect always
// has spatial context. Layout: big live zoning diagram on top, precedent
// picker list below it, numeric targets in a compact bottom strip.
export default function ArchitectZoningGate({ siteBounds, sitePolygon, siteId, onApprove, onBack, onPreviewPlan, onPreviewRules }) {
  // HARD LOCK (Phase A): if this site is one of the 4 demo sites, the building
  // CLASS — and therefore its precedent geometry, GLB and design rules — is
  // forced. The architect does NOT pick a precedent for locked sites; the
  // class's own measured GLB geometry is the precedent (invariant I2/I3).
  const lockedClass = classRecordForSite(siteId);

  const [pickedId, setPickedId] = useState(precedents[0]?.id ?? null);
  const [overrides, setOverrides] = useState({});
  const [showTargets, setShowTargets] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [designRulesId, setDesignRulesId] = useState(
    () => lockedClass?.designRules?.id || SITE_DESIGN_RULE_PRESET[siteId] || NO_DESIGN_RULES.id
  );
  const [ruleOverrides, setRuleOverrides] = useState({});

  // When the site changes (e.g. architect goes back and picks a different site),
  // reset to the correct preset for that site and clear any manual overrides.
  // For a locked site, that's the class's own rule preset.
  useEffect(() => {
    const lc = classRecordForSite(siteId);
    setDesignRulesId(lc?.designRules?.id || SITE_DESIGN_RULE_PRESET[siteId] || NO_DESIGN_RULES.id);
    setRuleOverrides({});
  }, [siteId]);

  const siteAreaM2 = (siteBounds?.widthM || 0) * (siteBounds?.depthM || 0);
  // Locked site → the precedent IS the class's measured GLB geometry (forced).
  // Unlocked site → legacy free-choice from the 11 precedents.
  const picked = lockedClass ? lockedClass.geometry : precedents.find(p => p.id === pickedId);
  const baseSpec = useMemo(
    () => (picked ? buildZoningSpec(picked, siteAreaM2) : null),
    [picked, siteAreaM2]
  );
  const activeDesignRules = useMemo(() => {
    const base = DESIGN_RULE_PRESETS[designRulesId] || NO_DESIGN_RULES;
    return { ...base, ...ruleOverrides };
  }, [designRulesId, ruleOverrides]);
  const spec = useMemo(
    () => (baseSpec ? {
      ...baseSpec,
      ...overrides,
      designRules: activeDesignRules,
      // Carry the hard-locked class + GLB downstream so Massing/Columns bind to
      // THIS building only (Phase B consumes lockedClass/lockedGLB).
      lockedClass: lockedClass?.sizeClass ?? null,
      lockedGLB: lockedClass?.glb ?? null,
    } : null),
    [baseSpec, overrides, activeDesignRules, lockedClass]
  );
  const setField = (field, value) => setOverrides(o => ({ ...o, [field]: value }));
  const setRuleField = (field, value) => setRuleOverrides(o => ({ ...o, [field]: value }));

  // Preview generation is deferred to a setTimeout so it never blocks the
  // initial render — 18 × generateMasterplan synchronously on mount was
  // freezing the map and corrupting the heatmap display.
  const [previews, setPreviews] = useState([]);
  const [previewsLoading, setPreviewsLoading] = useState(false);
  const previewGenRef = useRef(0);

  useEffect(() => {
    if (!siteBounds || !spec) { setPreviews([]); return; }
    const genId = ++previewGenRef.current;
    setPreviewsLoading(true);
    const t = setTimeout(() => {
      if (genId !== previewGenRef.current) return;
      const results = findTopPreviews(siteBounds, sitePolygon, spec).map(({ plan, score, seed }) => {
        if (spec.targetColumnGridM) attachColumnGrids(plan, spec.targetColumnGridM);
        return { plan, score, seed };
      });
      if (genId !== previewGenRef.current) return;
      setPreviews(results);
      setPreviewsLoading(false);
      setPreviewIndex(0);
    }, 60);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteBounds, sitePolygon, spec?.sourceId, spec?.targetUnitCount, spec?.targetFloorCount, spec?.designRules?.id]);

  const clampedIndex = Math.min(previewIndex, Math.max(0, previews.length - 1));
  const activePreview = previews[clampedIndex] || null;
  const previewPlan = activePreview?.plan || null;

  useEffect(() => {
    onPreviewPlan?.(previewPlan);
  }, [previewPlan, onPreviewPlan]);

  useEffect(() => {
    onPreviewRules?.(activeDesignRules);
  }, [activeDesignRules, onPreviewRules]);

  const handleDesignRulesChange = (id) => {
    setDesignRulesId(id);
    setRuleOverrides({});
  };

  return (
    <div className="azg-overlay">
      {/* Thin floating header — map stays fully visible underneath */}
      <div className="azg-header">
        <button className="azg-back" onClick={onBack}>← Site</button>
        <div className="azg-header-title">
          <span className="azg-header-step">02 / Zoning</span>
          <span className="azg-header-sub">
            {(siteAreaM2 / 10000).toFixed(2)} ha · pick a precedent
            {activeDesignRules.id !== NO_DESIGN_RULES.id && (
              <span className="azg-header-rule-badge">{activeDesignRules.label}</span>
            )}
          </span>
        </div>

        {previewsLoading && (
          <span className="azg-preview-count" style={{ opacity: 0.5 }}>generating layouts…</span>
        )}
        {!previewsLoading && previews.length > 0 && (
          <div className="azg-preview-nav">
            <button
              className="azg-nav-btn"
              disabled={clampedIndex === 0}
              onClick={() => setPreviewIndex(i => Math.max(0, i - 1))}
            >
              ←
            </button>
            <span className="azg-preview-count">
              Layout {clampedIndex + 1} / {previews.length} · fit {activePreview?.score ?? 0}
            </span>
            <button
              className="azg-nav-btn"
              disabled={clampedIndex === previews.length - 1}
              onClick={() => setPreviewIndex(i => Math.min(previews.length - 1, i + 1))}
            >
              →
            </button>
          </div>
        )}

        <button className="azg-targets-toggle" onClick={() => setShowTargets(v => !v)}>
          {showTargets ? '▲ Hide targets' : '▼ Targets'}
          {spec && (
            <span className="azg-targets-summary">
              {spec.targetUnitCount} units · {spec.targetFloorCount} fl · {spec.targetColumnGridM}m grid
            </span>
          )}
        </button>
        <button className="azg-approve" onClick={() => spec && onApprove(spec)}>
          Generate Variations →
        </button>
      </div>

      {showTargets && spec && (
        <div className="azg-targets-grid azg-targets-grid--floating">
          <TargetRow label="Units" value={spec.targetUnitCount} onChange={v => setField('targetUnitCount', v)} />
          <TargetRow label="Floors" value={spec.targetFloorCount} onChange={v => setField('targetFloorCount', v)} />
          <TargetRow label="Floor-to-floor m" value={spec.targetFloorToFloorM} step={0.1} onChange={v => setField('targetFloorToFloorM', v)} />
          <TargetRow label="Column grid m" value={spec.targetColumnGridM} step={0.1} onChange={v => setField('targetColumnGridM', v)} />
          <TargetRow label="Stair cores" value={spec.targetStairCoreCount} onChange={v => setField('targetStairCoreCount', v)} />

          {/* ── Design rules panel ── */}
          <div className="azg-rules-section">
            <div className="azg-rules-heading">Design Rules</div>
            <div className="azg-rules-preset-row">
              {[NO_DESIGN_RULES, ...Object.values(DESIGN_RULE_PRESETS)].map(p => (
                <button
                  key={p.id}
                  className={`azg-rules-preset ${designRulesId === p.id ? 'azg-rules-preset--active' : ''}`}
                  onClick={() => handleDesignRulesChange(p.id)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {designRulesId !== NO_DESIGN_RULES.id && (
              <div className="azg-rules-fields">
                <RuleSelect
                  label="Service cores"
                  hint="Small/Medium = 1 core · Large = 2 cores"
                  value={String(activeDesignRules.fixedCoreCount ?? 'auto')}
                  options={[{ v: 'auto', l: 'Auto' }, { v: '1', l: '1 — Single' }, { v: '2', l: '2 — Double' }]}
                  onChange={v => setRuleField('fixedCoreCount', v === 'auto' ? null : Number(v))}
                />
                <RuleSelect
                  label="Noise corner"
                  hint="Vehicular + community clustered here"
                  value={activeDesignRules.noiseClusterCorner ?? 'off'}
                  options={[{ v: 'off', l: 'Off' }, { v: 'sw', l: 'SW' }, { v: 'se', l: 'SE' }, { v: 'nw', l: 'NW' }, { v: 'ne', l: 'NE' }]}
                  onChange={v => setRuleField('noiseClusterCorner', v === 'off' ? null : v)}
                />
                <RuleSelect
                  label="Communal corner"
                  hint="Courtyard + communal zone for max light"
                  value={activeDesignRules.communalCorner ?? 'off'}
                  options={[{ v: 'off', l: 'Off' }, { v: 'sw', l: 'SW (max light)' }, { v: 'se', l: 'SE' }, { v: 'nw', l: 'NW' }, { v: 'ne', l: 'NE' }]}
                  onChange={v => setRuleField('communalCorner', v === 'off' ? null : v)}
                />
                <RuleInfoRow
                  label="Balcony facing"
                  value={
                    activeDesignRules.balconyFacingMulti?.length
                      ? activeDesignRules.balconyFacingMulti.map(f => f.charAt(0).toUpperCase() + f.slice(1)).join(' · ')
                      : activeDesignRules.balconyAzimuth != null
                        ? ['N','E','S','W'][Math.round(((activeDesignRules.balconyAzimuth % 360) + 360) % 360 / 90) % 4]
                        : '—'
                  }
                  hint="Comfort-driven · set per typology sketch"
                />
                <RuleSelect
                  label="Opening / solar"
                  hint="South = max solar gain for glazing"
                  value={String(activeDesignRules.solarAzimuth ?? 180)}
                  options={[{ v: '0', l: 'N' }, { v: '90', l: 'E' }, { v: '180', l: 'S (solar gain)' }, { v: '270', l: 'W' }]}
                  onChange={v => setRuleField('solarAzimuth', Number(v))}
                />
                <RuleSelect
                  label="Community zone"
                  hint="Amenity face — Medium: East (soft morning light)"
                  value={activeDesignRules.communityZoneSide ?? 'off'}
                  options={[{ v: 'off', l: 'Off' }, { v: 'east', l: 'East' }, { v: 'west', l: 'West' }, { v: 'south', l: 'South' }, { v: 'north', l: 'North' }]}
                  onChange={v => setRuleField('communityZoneSide', v === 'off' ? null : v)}
                />
                <RuleSelect
                  label="Vehicular corner"
                  hint="Vehicular kept to one corner, separated from pedestrian"
                  value={activeDesignRules.vehicularCorner ?? 'off'}
                  options={[{ v: 'off', l: 'Off' }, { v: 'sw', l: 'SW' }, { v: 'se', l: 'SE' }, { v: 'nw', l: 'NW' }, { v: 'ne', l: 'NE' }]}
                  onChange={v => setRuleField('vehicularCorner', v === 'off' ? null : v)}
                />
                <RuleSelect
                  label="View toward"
                  hint={activeDesignRules.viewFeature ? `Protected outlook · ${activeDesignRules.viewFeature}` : 'Protected outlook (XL: river)'}
                  value={String(activeDesignRules.viewAzimuth ?? 'off')}
                  options={[{ v: 'off', l: 'Off' }, { v: '0', l: 'N' }, { v: '90', l: 'E (river)' }, { v: '180', l: 'S' }, { v: '270', l: 'W' }]}
                  onChange={v => setRuleField('viewAzimuth', v === 'off' ? null : Number(v))}
                />
                <RuleSelect
                  label="Voids + solids"
                  hint="Stepped/cascading massing to break monotony"
                  value={activeDesignRules.voidSolidVariance ? 'on' : 'off'}
                  options={[{ v: 'off', l: 'Off' }, { v: 'on', l: 'On' }]}
                  onChange={v => setRuleField('voidSolidVariance', v === 'on')}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Floor-plan zoning diagram — right side panel showing exact zone
          layouts (units / green+communal / semi-open / service core) for
          each building in the current preview, matching the hand-drawn sketches. */}
      <div className="azg-zoning-panel">
        <div className="azg-zoning-panel-label">Zoning · Floor Plan</div>
        <ZoningDiagram previewPlan={previewPlan} />
      </div>

      {/* Floating precedent strip — bottom of map, no side panel.
          Locked site: shows the single forced class building (non-switchable),
          since the precedent is bound to this site's GLB. Unlocked site: the
          legacy free pick across all 11 precedents. */}
      <div className="azg-precedent-strip">
        {lockedClass ? (
          <div className="azg-prec-card azg-prec-card--active azg-prec-card--locked">
            <div className="azg-prec-name">
              🔒 {lockedClass.geometry.name} building
            </div>
            <div className="azg-prec-stats">
              <span>{lockedClass.geometry.floorCount}fl</span>
              <span>{lockedClass.geometry.coverageEstimatePct}%</span>
              <span>{lockedClass.geometry.columnGridM}m</span>
              <span>{lockedClass.geometry.columnPositions?.length ?? 0} cols</span>
            </div>
          </div>
        ) : (
          precedents.map(p => (
            <button
              key={p.id}
              className={`azg-prec-card ${pickedId === p.id ? 'azg-prec-card--active' : ''}`}
              onClick={() => { setPickedId(p.id); setOverrides({}); setPreviewIndex(0); }}
            >
              <div className="azg-prec-name">{p.name}</div>
              <div className="azg-prec-stats">
                <span>{p.floorCount}fl</span>
                <span>{p.coverageEstimatePct}%</span>
                <span>{p.columnGridM}m</span>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function TargetRow({ label, value, onChange, step = 1 }) {
  return (
    <div className="azg-target-row">
      <label>{label}</label>
      <input
        type="number"
        step={step}
        value={value ?? ''}
        onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
      />
    </div>
  );
}

function RuleToggle({ label, hint, value, onChange }) {
  return (
    <div className="azg-rule-row">
      <div className="azg-rule-labels">
        <span className="azg-rule-label">{label}</span>
        <span className="azg-rule-hint">{hint}</span>
      </div>
      <button
        className={`azg-rule-toggle ${value ? 'azg-rule-toggle--on' : ''}`}
        onClick={() => onChange(!value)}
      >
        {value ? 'ON' : 'OFF'}
      </button>
    </div>
  );
}

function RuleSelect({ label, hint, value, options, onChange }) {
  return (
    <div className="azg-rule-row">
      <div className="azg-rule-labels">
        <span className="azg-rule-label">{label}</span>
        <span className="azg-rule-hint">{hint}</span>
      </div>
      <select
        className="azg-rule-select"
        value={value}
        onChange={e => onChange(e.target.value)}
      >
        {options.map(o => <option key={o.v ?? 'off'} value={o.v ?? 'off'}>{o.l}</option>)}
      </select>
    </div>
  );
}

function RuleInfoRow({ label, value, hint }) {
  return (
    <div className="azg-rule-row">
      <div className="azg-rule-labels">
        <span className="azg-rule-label">{label}</span>
        <span className="azg-rule-hint">{hint}</span>
      </div>
      <span className="azg-rule-info-val">{value}</span>
    </div>
  );
}
