import React, { useState, useMemo, Suspense, lazy, useEffect } from 'react';
import './configurator-tokens.css';
import './Configurator.css';
import TypeologySelector from './TypeologySelector';

const RoomConfigurator      = lazy(() => import('./RoomConfigurator'));
const RoomHeroView          = lazy(() => import('./RoomHeroView'));
const ArchitectReview       = lazy(() => import('./ArchitectReview'));
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
      background: '#08090b',
    }}>
      <div style={{
        width: 32, height: 32, border: '2px solid rgba(232,228,218,0.2)',
        borderTopColor: '#e8e4da', borderRadius: '50%',
        animation: 'spin 0.7s linear infinite',
      }} />
    </div>
  );
}

// Catalogue step removed (it was a reference-only surface, not wired to the
// real config/BOM) — View Your Home now proceeds straight to Manufacture.
const STEPS = [
  { id: 0, label: 'Select' },
  { id: 1, label: 'Configure' },
  { id: 2, label: 'View Your Home' },
  { id: 3, label: 'Architect Review' },
  { id: 4, label: 'Manufacture' },
  { id: 5, label: 'Assemble' },
  { id: 6, label: 'Source & Deliver' },
  { id: 7, label: 'Export' },
];

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

export default function Configurator({ initialTypologyId, plan, onClose, skipRoleSelect = false }) {
  // The "Select Your Role" landing is step 0. When the Configurator is opened
  // from the pipeline ("View your individual home" after 3D-Fit), the user has
  // already chosen to configure their home, so that landing is redundant — we
  // skip straight to Configure (step 1) with a default typology. It still
  // shows for a bare open (no typology, no skip flag).
  const startAtConfigure = skipRoleSelect || !!initialTypologyId;
  const [step, setStep]         = useState(startAtConfigure ? 1 : 0);
  const { displayStep: stepView, fading } = useStepFade(step);
  const [typology, setTypology] = useState(() => resolveTypology(initialTypologyId ?? (skipRoleSelect ? typologies[0].id : undefined)));

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
    cement:     11.7,
    water:      16.7,
    basalt:       0.6,
  });

  // If caller passes a new initialTypologyId (shouldn't happen but guard anyway)
  useEffect(() => {
    if (initialTypologyId) {
      setTypology(resolveTypology(initialTypologyId));
      setStep(1);
    }
  }, [initialTypologyId]);

  const canGoTo = (s) => s === 0 || !!typology;

  const handleSelectTypology = (t) => {
    setTypology(t);
    setPlacedFurniture([]);
    setStep(1);
  };

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
            {/* When the role landing is skipped (pipeline entry), drop its nav
                chip too so step 0 is fully unreachable — no way back to the
                deleted "Select Your Role" page. */}
            {STEPS.filter(s => !(skipRoleSelect && s.id === 0)).map((s, i) => (
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
            {stepView === 0 && (
              <div className="roles-landing">
                <div className="roles-header">
                  <h1>Select Your Role</h1>
                  <p>Choose how you want to engage with this project</p>
                </div>
                <div className="roles-grid">
                  <RoleCard
                    title="Architect"
                    description="Design & Configure"
                    icon="🏗️"
                    onClick={() => { setTypology(typologies[0]); setStep(1); }}
                  />
                  <RoleCard
                    title="Home Owner"
                    description="View Your Home"
                    icon="🏠"
                    onClick={() => { setTypology(typologies[0]); setStep(2); }}
                  />
                  <RoleCard
                    title="Manufacturer"
                    description="BOM & Costing"
                    icon="🏭"
                    onClick={() => { setTypology(typologies[0]); setStep(4); }}
                  />
                  <RoleCard
                    title="Developer"
                    description="Full Project View"
                    icon="👨‍💼"
                    onClick={() => setShowFourRoles(true)}
                  />
                </div>
              </div>
            )}
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
              <ArchitectReview
                typology={typology}
                config={config}
                onBack={() => setStep(2)}
                onDone={() => setStep(4)}
              />
            )}
            {stepView === 4 && (
              <ManufacturingWorkflow
                typology={typology}
                config={config}
                allTypologies={typologies}
                siteTypologyCounts={siteTypologyCounts}
                onNext={() => setStep(5)}
              />
            )}
            {stepView === 5 && (
              <AssemblyVisualizer
                typology={typology}
                config={config}
                placedFurniture={placedFurniture}
                onNext={() => setStep(6)}
              />
            )}
            {stepView === 6 && (
              <SourcingPanel
                typology={typology}
                config={config}
                allTypologies={typologies}
                siteTypologyCounts={siteTypologyCounts}
                onBack={() => setStep(5)}
              />
            )}
            {stepView === 7 && (
              <ExportPanel
                typology={typology}
                config={config}
                onBack={() => setStep(6)}
                onViewRoom={() => setStep(2)}
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

function RoleCard({ title, description, icon, onClick }) {
  return (
    <div className="role-card" onClick={onClick}>
      <div className="role-card-icon">{icon}</div>
      <h2 className="role-card-title">{title}</h2>
      <p className="role-card-desc">{description}</p>
      <div className="role-card-arrow">→</div>
    </div>
  );
}
