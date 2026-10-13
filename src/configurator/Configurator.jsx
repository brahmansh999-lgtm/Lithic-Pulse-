import React, { useState, useMemo, Suspense, lazy, useEffect } from 'react';
import './configurator-tokens.css';
import './Configurator.css';

const RoomConfigurator      = lazy(() => import('./RoomConfigurator'));
const RoomHeroView          = lazy(() => import('./RoomHeroView'));
const ManufacturingWorkflow = lazy(() => import('./ManufacturingWorkflow'));
const AssemblyVisualizer    = lazy(() => import('./AssemblyVisualizer'));
const SourcingPanel         = lazy(() => import('./SourcingPanel'));
const FourRolesLive         = lazy(() => import('./FourRolesLive'));
const ExportPanel           = lazy(() => import('./ExportPanel'));

import typologiesData from './data/typologies.json';

const { typologies } = typologiesData;

function StepLoader() {
  return (
    <div style={{
      position: 'absolute', inset: 0, display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)',
    }}>
      <div style={{
        width: 32, height: 32, border: '2px solid rgba(20,20,15,0.15)',
        borderTopColor: 'var(--fg)', borderRadius: '50%',
        animation: 'spin 0.7s linear infinite',
      }} />
    </div>
  );
}

// Catalogue step removed (it was a reference-only surface, not wired to the
// real config/BOM) — View Your Home now proceeds straight to Manufacture.
// "Select Your Role" landing (step 0) removed — the Configurator always
// starts at Configure now.
// Source & Deliver and Export used to be their own top-level steps; they're
// now one combined sub-part nested inside Manufacture (see ManufactureStage
// below) — 4 top-level steps instead of 7.
// Architect Review used to be its own step (3) here — folded into View Your
// Home as a docked side panel instead (see ArchitectPanel.jsx, rendered from
// RoomHeroView), since reviewing the client's home is naturally the same
// screen as looking at it, not a separate later one to navigate back to.
const STEPS = [
  { id: 1, label: 'Configure' },
  { id: 2, label: 'View Your Home' },
  { id: 3, label: 'Manufacture' },
  { id: 4, label: 'Assemble' },
];

// Manufacture's own sub-navigation: Build (the manufacturing workflow) and
// Source & Export (Sourcing + Export combined into one part, since sourcing
// suppliers/delivery and exporting the BOM/spec are both "get this unit from
// the factory to site", not two separate concerns).
const MFG_SUBVIEWS = [
  { id: 'build', label: 'Build' },
  { id: 'source-export', label: 'Source & Export' },
];
const SOURCE_EXPORT_TABS = [
  { id: 'sourcing', label: 'Sourcing' },
  { id: 'export', label: 'Export' },
];

function ManufactureStage({ typology, config, allTypologies, siteTypologyCounts, onNext, onViewRoom }) {
  const [view, setView] = useState('build');
  const [seTab, setSeTab] = useState('sourcing');

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
      <div className="mfg-substage-bar">
        <div className="mfg-substage-group">
          {MFG_SUBVIEWS.map(v => (
            <button
              key={v.id}
              className={`mfg-substage-btn${view === v.id ? ' active' : ''}`}
              onClick={() => setView(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>
        {view === 'source-export' && (
          <div className="mfg-substage-group">
            {SOURCE_EXPORT_TABS.map(t => (
              <button
                key={t.id}
                className={`mfg-substage-btn mfg-substage-btn--sm${seTab === t.id ? ' active' : ''}`}
                onClick={() => setSeTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
        <button className="mfg-substage-next" onClick={onNext}>Proceed to Assemble →</button>
      </div>
      <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
        {view === 'build' && (
          <ManufacturingWorkflow
            typology={typology} config={config}
            allTypologies={allTypologies} siteTypologyCounts={siteTypologyCounts}
            onNext={() => setView('source-export')}
          />
        )}
        {view === 'source-export' && seTab === 'sourcing' && (
          <SourcingPanel
            typology={typology} config={config}
            allTypologies={allTypologies} siteTypologyCounts={siteTypologyCounts}
            onBack={() => setView('build')}
          />
        )}
        {view === 'source-export' && seTab === 'export' && (
          <ExportPanel
            typology={typology} config={config}
            onBack={() => setSeTab('sourcing')}
            onViewRoom={onViewRoom}
          />
        )}
      </div>
    </div>
  );
}

// Map planner typology IDs → configurator typology IDs
// Planner has 8 types (1b1p…4b8p), configurator has 11 — match by id where possible
function resolveTypology(plannerTypologyId) {
  if (!plannerTypologyId) return typologies[0];
  const match = typologies.find(t => t.id === plannerTypologyId);
  return match ?? typologies[0];
}

// Step changes used to swap instantly — the .step-view fade-in CSS existed
// but was never applied to anything, and conditional rendering ({step === N
// && <X/>}) unmounts the old step in the same tick the new one mounts, so
// there was no exit transition at all. Heavy step components (live 3D
// scenes, the AI render flow) make double-mounting both old+new genuinely
// risky, so instead of a true cross-fade we dip the container opacity to 0
// for one short beat around the swap — cheap, safe, and removes the jarring
// instant pop without keeping two Three.js scenes alive at once.
const STEP_FADE_MS = 140;
function useStepFade(step) {
  const [displayStep, setDisplayStep] = useState(step);
  const [fading, setFading] = useState(false);
  useEffect(() => {
    if (step === displayStep) return;
    setFading(true);
    const t = setTimeout(() => { setDisplayStep(step); setFading(false); }, STEP_FADE_MS);
    return () => clearTimeout(t);
  }, [step, displayStep]);
  return { displayStep, fading };
}

export default function Configurator({ initialTypologyId, plan, onClose }) {
  // The Configurator always starts at Configure (step 1) with a default
  // typology — the old "Select Your Role" landing (step 0) has been removed.
  const [step, setStep]         = useState(1);
  const { displayStep: stepView, fading } = useStepFade(step);
  const [typology, setTypology] = useState(() => resolveTypology(initialTypologyId ?? typologies[0].id));

  // Real per-typology unit counts across the whole generated site — lets the
  // Manufacture step's "Entire Site" tab multiply one unit's BOM by how many
  // of that typology (and every other typology) actually exist in the plan,
  // instead of only ever knowing about the single unit being configured.
  const siteTypologyCounts = useMemo(() => {
    if (!plan?.buildings) return {};
    const counts = {};
    plan.buildings.forEach(b => b.units.forEach(u => {
      counts[u.typologyId] = (counts[u.typologyId] || 0) + 1;
    }));
    return counts;
  }, [plan]);
  const [showFourRoles, setShowFourRoles] = useState(false);
  const [placedFurniture, setPlacedFurniture] = useState([]);
  const [config, setConfig]     = useState({
    balcony:    'BAL_NONE',
    partition:  'PAR_OPEN',
    pigment:    'PIG_NONE',
    glazing:    'GLZ_STANDARD',
    // Structure — chosen in the Configure step, flows into the BOM. null means
    // "use the layout's default column count / primary column type".
    columnType:          'COL_QUARTER',
    columnCountOverride: null,
    marbleDust: 50.3,
    ggbs:       20.1,
    cement:     5,
    water:      16.7,
    basaltFibre:       0.25,
    superplasticizer:  0.25,
  });

  // If caller passes a new initialTypologyId (shouldn't happen but guard anyway)
  useEffect(() => {
    if (initialTypologyId) {
      setTypology(resolveTypology(initialTypologyId));
      setStep(1);
    }
  }, [initialTypologyId]);

  const canGoTo = () => !!typology;

  return (
    <div className="configurator-overlay">
      {/* Close button */}
      <button className="configurator-close" onClick={onClose}>
        ← Back to Masterplan
      </button>

      <div className="app">
        <nav className="nav">
          <span className="nav-brand">Lithic Pulse</span>

          <div className="nav-steps">
            {STEPS.map((s, i) => (
              <React.Fragment key={s.id}>
                {i > 0 && <div className="nav-divider" />}
                <button
                  className={`nav-step${step === s.id ? ' active' : ''}${step > s.id ? ' done' : ''}`}
                  onClick={() => canGoTo(s.id) && setStep(s.id)}
                  disabled={!canGoTo(s.id)}
                >
                  <span className="nav-step-num">{step > s.id ? '✓' : s.id + 1}</span>
                  {s.label}
                </button>
              </React.Fragment>
            ))}
          </div>

          {typology && (
            <span className="nav-unit-chip">
              {typology.label} · {typology.areaM2} m²
            </span>
          )}

          {/* Jury highlight: open the live four-role connected view on demand. */}
          <button className="nav-fourroles-btn" onClick={() => setShowFourRoles(true)}>
            ◳ Connected View
          </button>
        </nav>

        <div className="main-content">
          <Suspense fallback={<StepLoader />}>
            <div className="step-fade" style={{ opacity: fading ? 0 : 1 }}>
            {stepView === 1 && (
              <RoomConfigurator
                typology={typology}
                config={config}
                setConfig={setConfig}
                placedFurniture={placedFurniture}
                setPlacedFurniture={setPlacedFurniture}
                onNext={() => setStep(2)}
              />
            )}
            {stepView === 2 && (
              <RoomHeroView
                typology={typology}
                placedFurniture={placedFurniture}
                onNext={() => setStep(3)}
              />
            )}
            {stepView === 3 && (
              <ManufactureStage
                typology={typology}
                config={config}
                allTypologies={typologies}
                siteTypologyCounts={siteTypologyCounts}
                onNext={() => setStep(4)}
                onViewRoom={() => setStep(2)}
              />
            )}
            {stepView === 4 && (
              <AssemblyVisualizer
                typology={typology}
                config={config}
                placedFurniture={placedFurniture}
                onNext={onClose}
              />
            )}
            </div>
          </Suspense>
        </div>
      </div>

      {/* Full-screen four-role connected view — reads/writes the SAME
          typology + config as Configure/Manufacture/Source/Export, so a
          change made here is the live session, not a simulation of one. */}
      {showFourRoles && (
        <div className="configurator-overlay" style={{ zIndex: 50 }}>
          <Suspense fallback={<StepLoader />}>
            <FourRolesLive
              onBack={() => setShowFourRoles(false)}
              typology={typology}
              config={config}
              setConfig={setConfig}
              onSelectTypology={(t) => { setTypology(t); setPlacedFurniture([]); }}
            />
          </Suspense>
        </div>
      )}
    </div>
  );
}
