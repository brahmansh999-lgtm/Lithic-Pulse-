import { useState, useMemo, useEffect, lazy, Suspense } from 'react';
import { generateMasterplan } from './planner/masterplanGenerator';
import { sequenceBuilds, MAX_SEQUENCER_BUILDINGS } from './planner/buildSequencer';
import LandingPage from './landing/LandingPage';
import SplashScreen from './landing/SplashScreen';
import './App.css';

// Everything below is only needed once the user leaves the landing page —
// lazy-loaded so the initial bundle (and the landing page's first paint)
// doesn't pull in three.js / GLTFLoader / the planner pipeline up front.
const SitePicker           = lazy(() => import('./planner/SitePicker'));
const HomeOwnerView        = lazy(() => import('./homeowner/HomeOwnerView'));
const ManufacturerView     = lazy(() => import('./manufacturer/ManufacturerView'));
const ResidentStoryGallery = lazy(() => import('./residents/ResidentStoryGallery'));
const SiteMassingView      = lazy(() => import('./planner/SiteMassingView'));

// Dev shortcut: open the unit Configurator directly at /?configurator, skipping
// the Site→Zoning→Massing→Columns→3D-Fit pipeline. The Configurator starts at
// its own 5-unit picker and needs no site/GLB props, so this is safe.
const DirectConfigurator = lazy(() => import('./configurator/Configurator'));

// Load GLB site boundary → returns normalised 2D polygon [{x,z}] scaled to [0..1]×[0..1]
// three.js's GLTFLoader is dynamically imported here (not at module top level)
// so it never lands in the landing page's initial bundle — this only runs
// once a site GLB is actually picked, well past the landing/splash screens.
const _polyCache = {};
async function loadSitePolygon(glbPath) {
  if (_polyCache[glbPath]) return _polyCache[glbPath];
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  const p = loader.loadAsync(glbPath).then(gltf => {
    let positions = null;
    gltf.scene.traverse(n => {
      // Site GLBs use LINE_STRIP geometry → Three.js creates Line objects, not Mesh
      if (!positions && (n.isMesh || n.isLine) && n.geometry?.attributes?.position)
        positions = n.geometry.attributes.position;
    });
    if (!positions || positions.count < 3) return null;

    const pts = [];
    for (let i = 0; i < positions.count; i++)
      pts.push({ x: positions.getX(i), z: positions.getZ(i) });

    // Compute bounding box
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    pts.forEach(p => {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
    });
    const rX = maxX - minX || 1, rZ = maxZ - minZ || 1;
    return pts.map(p => ({ x: (p.x - minX) / rX, z: (p.z - minZ) / rZ }));
  }).catch(() => null);
  _polyCache[glbPath] = p;
  return p;
}

export default function App() {
  const [splashDone, setSplashDone] = useState(false); // intro splash shown before landing, every load
  const [view, setView] = useState('landing');
  const [role, setRole] = useState(null); // null | 'homeowner' | 'architect' | 'developer' | 'manufacturer' | 'resident'
  const [siteMassingDone, setSiteMassingDone] = useState(false); // true after site+massing step
  const [selectedSite, setSelectedSite] = useState(null); // raw site object from SitePicker
  const [selectedBuildingType, setSelectedBuildingType] = useState(null); // 'small'|'medium'|'large'|'xl'
  const [siteBounds, setSiteBounds] = useState(null);

  // Lock body scroll in planner, restore for landing
  useEffect(() => {
    const isPlanner = view !== 'landing';
    document.body.classList.toggle('planner-mode', isPlanner);
    document.getElementById('root')?.classList.toggle('planner-mode', isPlanner);
    return () => {
      document.body.classList.remove('planner-mode');
      document.getElementById('root')?.classList.remove('planner-mode');
    };
  }, [view]);
  const [siteGlb, setSiteGlb]         = useState(null);
  const [sitePolygon, setSitePolygon] = useState(null);
  const [siteContext, setSiteContext] = useState(null);
  const [siteId, setSiteId]           = useState(null);
  const [siteAnalysis, setSiteAnalysis] = useState(null);
  // Real lat/lng <-> grid conversion basis + site centre, for fetching real
  // OSM context (buildings/roads) around the site in MasterplanViewer.
  const [geoRef, setGeoRef]           = useState(null);
  const [siteLatLng, setSiteLatLng]   = useState(null);
  const [polyReady, setPolyReady]     = useState(true);  // false while polygon is loading
  const [seed, setSeed]               = useState(1);
  const [selectedUnit, setSelectedUnit] = useState(null);
  const [stage, setStage]           = useState('boxes');
  const [filterTypology, setFilterTypology] = useState(null);
  const [hoverTypology, setHoverTypology]   = useState(null);
  const [configuratorUnit, setConfiguratorUnit] = useState(null);
  const [mixTargets, setMixTargets]         = useState(null);   // { [typoId]: fraction } | null
  const [solarAzimuth, setSolarAzimuth]     = useState(180);
  const [windAzimuth, setWindAzimuth]       = useState(225);    // prevailing SW wind
  const [accessEdges, setAccessEdges]       = useState(['south','east']);
  const [showSolar, setShowSolar]           = useState(false);
  const [concept, setConcept]               = useState(null);  // null = auto-pick by seed
  const [buildWeek, setBuildWeek]           = useState(null);  // null = build-sequence overlay off; number = scrubbed week

  // Load polygon from GLB file when a site GLB is provided
  // When no GLB, sitePolygon is set directly by handleConfirm (OSM coords) — don't clear it here
  useEffect(() => {
    if (!siteGlb) { setPolyReady(true); return; }
    setPolyReady(false);
    loadSitePolygon(siteGlb).then(poly => {
      setSitePolygon(poly ?? null);
      setPolyReady(true);
    });
  }, [siteGlb]);

  const { plan, planError } = useMemo(() => {
    if (!siteBounds || !polyReady) return { plan: null, planError: null };
    try {
      const p = generateMasterplan(siteBounds, seed, sitePolygon, { mixTargets, solarAzimuth, windAzimuth, accessEdges, siteContext, concept });
      return { plan: p, planError: null };
    } catch (e) {
      console.error('generateMasterplan threw:', e);
      return { plan: null, planError: e?.message ?? String(e) };
    }
  }, [siteBounds, seed, sitePolygon, polyReady, mixTargets, solarAzimuth, windAzimuth, accessEdges, siteContext, concept]);

  const floorMax = plan?.floors.max ?? 9;

  // Computed once here and passed down to both MasterplanViewer (3D overlay)
  // and PlanControls (scrubber panel) so toggling/dragging doesn't trigger
  // the same expensive sequencing pass twice in parallel. Only recomputes
  // when plan/accessEdges/the on-off toggle change — NOT on every week scrub.
  const buildingCount = plan?.buildings?.filter(b => b.units?.length > 0).length ?? 0;
  const buildSeqTooLarge = buildingCount > MAX_SEQUENCER_BUILDINGS;
  const buildSeqOn = buildWeek !== null;
  const buildSequence = useMemo(
    () => (plan && buildSeqOn && !buildSeqTooLarge ? sequenceBuilds(plan, {}, accessEdges) : null),
    [plan, accessEdges, buildSeqOn, buildSeqTooLarge]
  );

  // When the seed changes, reset to the box stage and clear any selection.
  useEffect(() => { setStage('boxes'); setSelectedUnit(null); setBuildWeek(null); }, [seed]);

  function handleConfirm(bounds) {
    const w = Math.min(2500, Math.max(24, bounds.widthM || 100));
    const d = Math.min(2500, Math.max(24, bounds.depthM || 100));
    setSiteBounds({ widthM: w, depthM: d });
    setSiteGlb(bounds.glb ?? null);
    setSitePolygon(bounds.sitePolygon ?? null);
    setSiteContext(bounds.siteContext ?? null);
    setSiteId(bounds.siteId ?? null);
    setSiteAnalysis(bounds.analysis ?? null);
    setGeoRef(bounds.geoRef ?? null);
    setSiteLatLng(bounds.siteLat != null && bounds.siteLng != null ? { lat: bounds.siteLat, lng: bounds.siteLng } : null);
    setSelectedUnit(null);
    setStage('boxes');
    setSelectedSite(bounds._rawSite ?? null);
    setSelectedBuildingType(bounds.buildingType ?? null);
    setSiteMassingDone(false); // show site+massing step first
    if (bounds.analysis) {
      setSolarAzimuth(bounds.analysis.solarAzimuth);
      setWindAzimuth(bounds.analysis.windAzimuth);
      setAccessEdges(bounds.analysis.accessEdges);
    }
  }

  // Dev shortcut — /?configurator jumps straight into the Configurator,
  // skipping the whole Site→Zoning→Massing→Columns→3D-Fit pipeline. Placed
  // after all hooks so React's rules-of-hooks aren't broken.
  if (typeof window !== 'undefined' && window.location.search.includes('configurator')) {
    return (
      <Suspense fallback={null}>
        <DirectConfigurator onClose={() => { window.location.href = window.location.pathname; }} />
      </Suspense>
    );
  }

  // Landing page always mounts (for SEO + scroll story).
  // The planner overlays on top when the user clicks "Open Masterplanner".
  // The intro splash overlays the landing on every load and zooms through to
  // reveal it — so the landing must be mounted underneath, not replaced.
  if (view === 'landing') {
    return (
      <>
        <LandingPage onEnter={(r) => { setRole(r); setView('app'); }} />
        {!splashDone && <SplashScreen onDone={() => setSplashDone(true)} />}
      </>
    );
  }

  const backToLanding = () => {
    setRole(null); setView('landing');
    setSiteBounds(null); setSiteGlb(null); setSitePolygon(null); setSiteContext(null);
    setSiteId(null); setSiteAnalysis(null);
    setSelectedUnit(null); setStage('boxes'); setFilterTypology(null);
    setConfiguratorUnit(null);
    setGeoRef(null); setSiteLatLng(null);
  };

  if (role === 'homeowner') return <Suspense fallback={null}><HomeOwnerView onBack={backToLanding} /></Suspense>;
  if (role === 'manufacturer') return <Suspense fallback={null}><ManufacturerView onBack={backToLanding} /></Suspense>;
  if (role === 'resident') return <Suspense fallback={null}><ResidentStoryGallery onBack={backToLanding} /></Suspense>;

  if (!siteBounds) return <Suspense fallback={null}><SitePicker onConfirm={handleConfirm} onBack={backToLanding} role={role} /></Suspense>;

  // Terminal screen for architect/developer: Site → Zoning → Massing →
  // Columns → 3D-fit (the fully-formed building GLB + "View your individual
  // home" → 5-unit picker → Configurator). The old post-columns generated
  // masterplanner (MasterplanViewer + PlanControls) has been removed
  // everywhere — SiteMassingView is now the last stop.
  return (
    <Suspense fallback={null}>
    <SiteMassingView
      site={selectedSite}
      siteBounds={siteBounds}
      buildingType={selectedBuildingType}
      onBack={() => { setSiteBounds(null); setSiteMassingDone(false); setSelectedSite(null); setSelectedBuildingType(null); }}
    />
    </Suspense>
  );
}
