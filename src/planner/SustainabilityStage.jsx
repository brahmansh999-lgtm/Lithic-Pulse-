/**
 * SustainabilityStage — sits between Massing and Import in the pipeline.
 * Full comparative analysis of cast stone vs. traditional concrete for the
 * specific building just massed: embodied carbon, mix composition, and
 * dead-load, all computed from the SAME cited source figures already used
 * by CarbonBadge/SustainabilityMatrix elsewhere in the app (carbonTracker.js)
 * — nothing on this page is a new, independently-invented number.
 */
import { useEffect, useRef } from 'react';
import CarbonBadge from '../shared/CarbonBadge';
import SustainabilityMatrix from '../shared/SustainabilityMatrix';
import {
  compareByVolume, formatTonnes, structuralWeightTonnes,
  CAST_STONE_DENSITY_KG_PER_M3, CONCRETE_DENSITY_KG_PER_M3,
  CARBON_SOURCE_NOTE,
} from '../shared/carbonTracker';
import './SustainabilityStage.css';

// Qualitative points, each traceable to the mix composition already cited in
// carbonTracker.js (GGBS/marble-dust by-product content, lower cement
// fraction, denser/lighter dead load) rather than invented marketing claims.
const REASONS = [
  {
    tag: 'Carbon',
    title: 'A fraction of the embodied carbon',
    body: 'Portland cement is the dominant carbon driver in any concrete-family mix. The cast stone mix uses roughly a tenth as much cement per kg as standard structural concrete, replacing it with GGBS and marble dust — both by-products, not freshly fired binder.',
  },
  {
    tag: 'Circularity',
    title: 'Built from by-products, not virgin material',
    body: 'GGBS is a by-product of steel manufacture; marble dust is a by-product of quarrying. Together they make up the majority of the cast stone mix by weight — material that would otherwise be industrial waste, cited against a standard concrete mix that is 100% virgin aggregate and cement.',
  },
  {
    tag: 'Dead load',
    title: 'Lighter structure, same footprint',
    body: 'At a lower density than standard structural concrete, the same building volume carries less dead load — smaller foundations and less material moved to site for the same floor area.',
  },
  {
    tag: 'Transparency',
    title: 'Every figure is sourced, not assumed',
    body: 'Cast stone quantities come from the real per-unit mix this app already computes bills of materials from. Emission factors are public ICE Database v3 benchmarks, and the concrete baseline is a cited industry figure — not cherry-picked to flatter the comparison.',
  },
];

function useReveal() {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const nodes = el.querySelectorAll('.ss-reveal');
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add('ss-in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.15 });
    nodes.forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, []);
  return ref;
}

export default function SustainabilityStage({ site, volumeM3, unitCount, floorCount, onBack, onContinue }) {
  const pageRef = useReveal();
  const result = compareByVolume(volumeM3);
  const weightTonnes = volumeM3 ? structuralWeightTonnes(volumeM3) : null;
  const concreteWeightTonnes = volumeM3
    ? (volumeM3 * CONCRETE_DENSITY_KG_PER_M3) / 1000
    : null;

  return (
    <div className="ss-root" ref={pageRef}>
      {/* Header — same pattern as Site/Massing/Import stages */}
      <div className="ss-header">
        <button onClick={onBack} className="ss-back">← Massing</button>

        <div className="ss-header-title">
          <span className="ss-eyebrow">04 / Sustainability</span>
          <span className="ss-header-sub">
            {site?.name ?? 'Site'}
            {volumeM3 ? <span className="ss-header-dim"> · {Math.round(volumeM3).toLocaleString()} m³ structural volume</span> : null}
          </span>
        </div>

        <div className="ss-steps">
          {['Site', 'Massing', 'Sustainability', 'Import'].map((s, i) => (
            <div key={s} className="ss-step-item">
              {i > 0 && <div className="ss-step-rule" />}
              <span className={`ss-step-label ${i === 2 ? 'ss-step-label--active' : ''}`}>{s}</span>
            </div>
          ))}
        </div>

        <button onClick={onContinue} className="ss-continue">Import →</button>
      </div>

      {/* Scrollable content */}
      <div className="ss-scroll">
        {/* Hero statement */}
        <section className="ss-hero ss-reveal">
          <span className="ss-eyebrow ss-eyebrow--center">Cast stone vs. concrete</span>
          <h1 className="ss-hero-h1">
            The same building.<br />A fraction of the impact.
          </h1>
          <p className="ss-hero-sub">
            Every home in this massing can be built in cast stone instead of traditional structural
            concrete — same volume, same floor count, dramatically lower embodied carbon. Here's the
            comparison for the building you just designed.
          </p>
        </section>

        {/* Headline numbers for THIS building */}
        {result && (
          <section className="ss-stats ss-reveal">
            <div className="ss-stat">
              <div className="ss-stat-val">{result.savedPct >= 0 ? '−' : '+'}{Math.abs(result.savedPct).toFixed(0)}%</div>
              <div className="ss-stat-label">embodied carbon vs. concrete</div>
            </div>
            <div className="ss-stat">
              <div className="ss-stat-val">{formatTonnes(result.savedCO2e)}t</div>
              <div className="ss-stat-label">CO2e saved, this building</div>
            </div>
            {weightTonnes != null && concreteWeightTonnes != null && (
              <div className="ss-stat">
                <div className="ss-stat-val">−{Math.round(concreteWeightTonnes - weightTonnes).toLocaleString()}t</div>
                <div className="ss-stat-label">lighter dead load than concrete</div>
              </div>
            )}
            <div className="ss-stat">
              <div className="ss-stat-val">{unitCount ?? '—'}</div>
              <div className="ss-stat-label">dwellings across {floorCount ?? '—'} floors</div>
            </div>
          </section>
        )}

        {/* Reasons grid — large text, not icon-card template grid */}
        <section className="ss-reasons">
          {REASONS.map((r) => (
            <div key={r.tag} className="ss-reason ss-reveal">
              <span className="ss-reason-tag">{r.tag}</span>
              <h3 className="ss-reason-title">{r.title}</h3>
              <p className="ss-reason-body">{r.body}</p>
            </div>
          ))}
        </section>

        {/* Detailed comparison — carbon bars + full matrix, same data source */}
        <section className="ss-compare ss-reveal">
          <span className="ss-eyebrow">Comparative analysis</span>
          <h2 className="ss-compare-h2">The numbers, side by side.</h2>
          <div className="ss-compare-grid">
            {result && (
              <div className="ss-compare-col">
                <CarbonBadge volumeM3={volumeM3} />
              </div>
            )}
            <div className="ss-compare-col">
              <SustainabilityMatrix />
            </div>
          </div>
          <p className="ss-source-note">{CARBON_SOURCE_NOTE}</p>
        </section>

        {/* Closing CTA */}
        <section className="ss-cta ss-reveal">
          <h2 className="ss-cta-h">Ready to continue?</h2>
          <p className="ss-cta-sub">Carry this massing into the Rhino import handoff.</p>
          <button onClick={onContinue} className="ss-cta-btn">Continue to Import →</button>
        </section>
      </div>
    </div>
  );
}
