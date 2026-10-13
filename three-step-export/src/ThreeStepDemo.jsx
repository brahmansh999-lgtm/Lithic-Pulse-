import { useState, useMemo } from 'react';
import SitePicker from './planner/SitePicker';
import MasterplanViewer from './planner/MasterplanViewer';
import PlanControls from './planner/PlanControls';
import { generateMasterplan } from './planner/masterplanGenerator';
import './App.css';

// Standalone 3-step flow:
//   1. SitePicker      — pick a brownfield site on the map
//   2. MasterplanViewer (stage='boxes') + PlanControls — explore massing seeds
//   3. MasterplanViewer (stage='glb')   — render the community in 3D, select a unit
export default function ThreeStepDemo() {
  const [siteBounds, setSiteBounds] = useState(null);
  const [sitePolygon, setSitePolygon] = useState(null);
  const [siteContext, setSiteContext] = useState(null);
  const [siteAnalysis, setSiteAnalysis] = useState(null);
  const [seed, setSeed] = useState(1);
  const [stage, setStage] = useState('boxes');
  const [selectedUnit, setSelectedUnit] = useState(null);
  const [filterTypology, setFilterTypology] = useState(null);
  const [hoverTypology, setHoverTypology] = useState(null);
  const [mixTargets, setMixTargets] = useState(null);
  const [solarAzimuth, setSolarAzimuth] = useState(180);
  const [windAzimuth, setWindAzimuth] = useState(225);
  const [accessEdges, setAccessEdges] = useState(['south', 'east']);
  const [showSolar, setShowSolar] = useState(false);
  const [concept, setConcept] = useState(null);

  const { plan, planError } = useMemo(() => {
    if (!siteBounds) return { plan: null, planError: null };
    try {
      const p = generateMasterplan(siteBounds, seed, sitePolygon, {
        mixTargets, solarAzimuth, windAzimuth, accessEdges, siteContext, concept,
      });
      return { plan: p, planError: null };
    } catch (e) {
      return { plan: null, planError: e?.message ?? String(e) };
    }
  }, [siteBounds, seed, sitePolygon, mixTargets, solarAzimuth, windAzimuth, accessEdges, siteContext, concept]);

  const floorMax = plan?.floors.max ?? 9;

  function handleConfirm(bounds) {
    const w = Math.min(2500, Math.max(24, bounds.widthM || 100));
    const d = Math.min(2500, Math.max(24, bounds.depthM || 100));
    setSiteBounds({ widthM: w, depthM: d });
    setSitePolygon(bounds.sitePolygon ?? null);
    setSiteContext(bounds.siteContext ?? null);
    setSiteAnalysis(bounds.analysis ?? null);
    setStage('boxes');
    setSelectedUnit(null);
    if (bounds.analysis) {
      setSolarAzimuth(bounds.analysis.solarAzimuth);
      setWindAzimuth(bounds.analysis.windAzimuth);
      setAccessEdges(bounds.analysis.accessEdges);
    }
  }

  function backToSitePick() {
    setSiteBounds(null); setSitePolygon(null); setSiteContext(null);
    setSiteAnalysis(null); setSelectedUnit(null); setStage('boxes'); setFilterTypology(null);
  }

  // Step 1 — pick a site
  if (!siteBounds) return <SitePicker onConfirm={handleConfirm} onBack={backToSitePick} />;

  // Steps 2 (boxes) & 3 (glb) — same layout, driven by `stage`
  return (
    <div className="app-layout">
      {planError && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: '340px', bottom: 0, zIndex: 999,
          background: 'rgba(0,0,0,0.85)', color: '#ff6666', fontFamily: 'monospace',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
          <div style={{ fontSize: '1rem', marginBottom: '0.5rem', color: '#ffaa44' }}>Generator Error</div>
          <div style={{ fontSize: '0.8rem', maxWidth: '600px', textAlign: 'center', wordBreak: 'break-word' }}>{planError}</div>
        </div>
      )}
      <MasterplanViewer
        plan={plan}
        maxFloor={floorMax}
        selectedUnit={selectedUnit}
        onSelectUnit={u => setSelectedUnit(u)}
        stage={stage}
        siteGlb={null}
        filterTypology={filterTypology}
        hoverTypology={hoverTypology}
        showSolar={showSolar}
      />
      <PlanControls
        seed={seed} setSeed={setSeed}
        plan={plan}
        selectedUnit={selectedUnit}
        stage={stage}
        onConfirmDesign={() => setStage('glb')}
        filterTypology={filterTypology}
        setFilterTypology={setFilterTypology}
        hoverTypology={hoverTypology}
        setHoverTypology={setHoverTypology}
        onOpenConfigurator={() => {}}
        onBack={backToSitePick}
        mixTargets={mixTargets}
        setMixTargets={setMixTargets}
        solarAzimuth={solarAzimuth}
        setSolarAzimuth={setSolarAzimuth}
        showSolar={showSolar}
        setShowSolar={setShowSolar}
        concept={concept}
        setConcept={setConcept}
      />
    </div>
  );
}
