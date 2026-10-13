/**
 * GLBSiteView — shows the REAL building for a site: if the architect has
 * imported a Rhino-designed GLB for this site, that model, fitted inside the
 * real site boundary. Otherwise there IS no "final building" to show yet —
 * the platform does not fabricate one. This used to call synthesizeBuilding()
 * to generate a fake finished building from massing/column data and present
 * it as the design; that was dishonest (a box-massing extrusion with rule-
 * driven facade dressing is not an architect's design) and has been removed.
 * See MassingStage.jsx's "Export (JSON + OBJ + GLB)" button for the real handoff.
 */
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { fitFootprintToSite, latLngToXZ, clampFitScale } from './siteFit';
import { getRhinoImport } from './rhinoImportStore';
import RhinoImportButton from './RhinoImport';

// Dev-only escape hatch to A/B against one of the 4 fixed hand-modeled demo
// GLBs (?glb=1 in the URL) — never shown to a real user by default.
const USE_LEGACY_GLB = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('glb');

// Ground plane matches the app's white page background (var(--bg) =
// #ffffff), same as the Massing/Columns stages' ground plane, so this stage
// no longer reads as a separate dark viewport. Overlay text drawn ON TOP OF
// the canvas therefore uses the page's own dark-ink palette (rgba(20,20,15,…))
// instead of the white-on-dark palette this stage used while the ground was
// near-black.
const GROUND_COLOR = '#ffffff';
const OVER_CANVAS_STRONG = 'rgba(20,20,15,0.82)';
const OVER_CANVAS_DIM    = 'rgba(20,20,15,0.55)';
const OVER_CANVAS_FAINT  = 'rgba(20,20,15,0.35)';

// Single shared grey/white material for the whole building — we deliberately
// ignore the GLB's own (blue/pink/tan) materials in the 3D-fit view: the
// architect wants a clean neutral massing, and dropping the real materials
// also drops all their texture/shader overhead. One material instance is
// reused across every mesh so there's nothing per-mesh to compile.
// MeshLambertMaterial (not Basic) — a fully unlit white blob hid every facade
// line/setback/balcony into one flat silhouette; you couldn't SEE the
// geometry at all. Lambert is still cheap (one dot-product per fragment, no
// PBR/specular/env-map work) but responds to the single directional light
// below, so faces at different angles read as distinct planes — the
// architectural-model look (flat white, shaded by orientation) instead of a
// paper cutout. One shared instance, still nothing per-mesh to compile.
const GREY_MAT = new THREE.MeshLambertMaterial({ color: '#e4e1da' });
// Thin dark edge lines per mesh (same technique as the Massing/Columns
// stages) — this is what makes floor splits, window mullions, and balcony
// edges crisply visible instead of disappearing into the flat shaded faces.
const EDGE_MAT = new THREE.LineBasicMaterial({ color: '#3a3a3a', transparent: true, opacity: 0.55 });

const GLB_BY_TYPE = {
  small:  '/BLDGS/glbsmall.glb',
  medium: '/BLDGS/glbmedium.glb',
  large:  '/BLDGS/glblarge.glb',
  xl:     '/BLDGS/glbXL.glb',
};

const META = {
  small:  { label: 'Small',  floors: 4, units: 18  },
  medium: { label: 'Medium', floors: 6, units: 42  },
  large:  { label: 'Large',  floors: 6, units: 64  },
  xl:     { label: 'XL',     floors: 6, units: 112 },
};

export default function GLBSiteView({ buildingType = 'medium', chosenVariation, siteName, site, siteBounds, onBack, onViewHome, viewHomeLabel = 'View your individual home →', alwaysShowContinue = false, demoMode = false, backLabel = '← SUSTAINABILITY', stageLabel = '05 / Rhino Import', showStepTrail = true }) {
  const canvasRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [importVersion, setImportVersion] = useState(0);
  const meta = META[buildingType] ?? META.medium;
  const rhinoImport = getRhinoImport(site?.id);
  // demoMode (Home Owner role): no architect-to-homeowner backend handoff
  // exists yet (rhinoImportStore is in-memory/session-only — see its own
  // comment), so a real home owner would otherwise always hit "no building
  // designed yet" and the architect's own upload control. Until that real
  // handoff exists, seed the same fixed per-class demo GLB the ?glb=1 dev
  // flag already uses (USE_LEGACY_GLB) as the home owner's building — same
  // mechanism, just switched on by role instead of a URL param.
  const hasBuilding = USE_LEGACY_GLB || demoMode || !!rhinoImport;
  const handleImported = () => { setLoading(true); setImportVersion(v => v + 1); };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const W = canvas.parentElement.clientWidth || window.innerWidth;
    const H = canvas.parentElement.clientHeight || (window.innerHeight - 48);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(W, H);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // No tone mapping / shadow maps — the building is unlit MeshBasicMaterial,
    // so both would be pure GPU cost with zero visible effect.

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);
    scene.fog = new THREE.Fog(0xffffff, 300, 600);

    // Perspective camera — free orbit
    const camera = new THREE.PerspectiveCamera(42, W / H, 0.5, 1000);
    camera.position.set(80, 60, 80);
    camera.lookAt(0, 12, 0);

    // Minimal lighting: one directional "sun" (no shadow map — that's the
    // expensive part, this is just a cheap per-fragment dot product) plus a
    // soft ambient fill so shaded sides aren't pure black. This is what lets
    // MeshLambertMaterial actually shade the building's faces by orientation
    // so the massing's real form (setbacks, floors, balconies) is visible.
    scene.add(new THREE.AmbientLight('#dfe6ea', 0.65));
    const sun = new THREE.DirectionalLight('#fff6ea', 1.3);
    sun.position.set(60, 90, 50);
    scene.add(sun);

    // Ground plane — unlit, flat dark base
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(600, 600),
      new THREE.MeshBasicMaterial({ color: GROUND_COLOR })
    );
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    // ── Site coords & centroid — the SAME frame the Massing/Columns stages
    // use (see MassingStage.useMassingViewer), so the GLB here lands in the
    // identical location/orientation as the massing and its columns, not an
    // independent origin-centred placement.
    const coords = site?.coords ?? [];
    const cLat = coords.length ? coords.reduce((s, p) => s + p[0], 0) / coords.length : 51.505;
    const cLng = coords.length ? coords.reduce((s, p) => s + p[1], 0) / coords.length : -0.09;

    // Site boundary outline — same geo-north frame as the massing stage's
    // outline, drawn directly in world space (independent of the building
    // rotation) so the plot reads identically across all three stages.
    if (coords.length >= 3) {
      const pts = coords.map(([lat, lng]) => {
        const { x, z } = latLngToXZ(lat, lng, cLat, cLng);
        return new THREE.Vector3(x, 0.05, z);
      });
      pts.push(pts[0].clone());
      const outline = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: '#78c8a4', transparent: true, depthTest: false })
      );
      outline.renderOrder = 999;
      scene.add(outline);
    }

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 10;
    controls.maxDistance = 400;
    controls.maxPolarAngle = Math.PI / 2 - 0.04;
    controls.target.set(0, 12, 0);
    controls.update();

    // ── ON-DEMAND RENDERING (damping-aware) ─────────────────────────────────
    // Nothing in the scene animates, so we don't render every frame. But this
    // view uses enableDamping (inertial glide after a drag), which needs the
    // loop to keep ticking *while the glide settles*. So: while interacting we
    // run a normal rAF loop that calls controls.update() (which returns true
    // until the camera stops moving); once it settles we stop the loop and go
    // fully idle. Identical pixels to the old always-on loop, ~0 idle cost.
    let raf = null;
    const loop = () => {
      const moving = controls.update(); // true while damping is still moving
      renderer.render(scene, camera);
      raf = moving ? requestAnimationFrame(loop) : null;
    };
    const kick = () => { if (raf == null) raf = requestAnimationFrame(loop); };
    // 'change' fires on user input and on each damping step; kick the loop so
    // the glide is rendered, then it self-terminates when update() settles.
    controls.addEventListener('change', kick);
    const renderStill = () => { if (raf == null) renderer.render(scene, camera); };

    // Guard for the async GLB load: if the user navigates away before the GLB
    // finishes decoding, the effect cleanup runs first — we must NOT then add a
    // heavy model into a torn-down scene (it would leak, since renderer.dispose
    // already ran and can't free it). Flip this in cleanup and bail in the cb.
    let disposed = false;

    // Places any world-space model into the scene using the SAME fit +
    // worldGroup TRS as MassingStage.useMassingViewer: rotate to the site's
    // oriented axis, scale (via the shared clampFitScale, so a small building
    // on a huge plot keeps its real size while a building too big for its
    // plot shrinks to fit rather than bursting the boundary), translate to
    // the site's true centre. This is what guarantees Massing, Columns and
    // this final view all show the building in the identical location.
    function placeInScene(model, size) {
      const rawFit = fitFootprintToSite(coords, cLat, cLng, size.x, size.z);
      const fit = { ...rawFit, scale: clampFitScale(rawFit.scale) };

      const worldGroup = new THREE.Group();
      worldGroup.scale.set(fit.scale, 1, fit.scale);
      worldGroup.rotation.y = fit.angle;
      worldGroup.position.set(fit.cx, 0, fit.cz);

      // Tile the SAME real model across the site the same way Massing/Columns
      // tile their boxes — chosenVariation.tileOffsets are the exact
      // (dx,dz,angle) transforms MassingStage's siteTiling.js computed for
      // this variation, in the same local, pre-worldGroup frame this model
      // already sits in (model.position was just centred on its own bbox,
      // i.e. local origin, same as siteToLocalPolygon's frame) — so they
      // apply directly with no conversion. Falls back to a single instance
      // (today's behaviour) when no tiling info is available.
      //
      // Rotation pivot caveat: siteTiling.js rotates every box about the
      // GROUND FLOOR's own bbox centre (bcx,bcz, carried on each transform)
      // — NOT the whole-building bbox centre this model is centred on
      // (which is local origin, i.e. (0,0) here) — the two aren't the same
      // point for an asymmetric real footprint. So a rigid rotation of this
      // whole model must: (1) rotate the model's own local-origin position
      // about (bcx,bcz) by angle — same rotatePoint formula siteTiling.js
      // uses — THEN add (dx,dz), and (2) spin the model's own orientation
      // by the same angle, so the whole mesh ends up rotated about the
      // correct real pivot, matching where the massing/columns boxes went.
      const offsets = chosenVariation?.tileOffsets?.length ? chosenVariation.tileOffsets : [{ dx: 0, dz: 0, angle: 0 }];
      offsets.forEach(({ dx, dz, angle, bcx = 0, bcz = 0 }, i) => {
        const instance = i === 0 ? model : model.clone();
        if (angle) {
          const cos = Math.cos(angle), sin = Math.sin(angle);
          const ox = 0 - bcx, oz = 0 - bcz;
          const rx = bcx + ox * cos - oz * sin, rz = bcz + ox * sin + oz * cos;
          instance.position.x += rx + dx;
          instance.position.z += rz + dz;
          instance.rotation.y += angle;
        } else {
          instance.position.x += dx;
          instance.position.z += dz;
        }
        worldGroup.add(instance);
      });
      scene.add(worldGroup);

      const spanOnSite = Math.max(size.x, size.z) * fit.scale;
      const dist = Math.max(spanOnSite * 1.5, 30);
      camera.position.set(fit.cx + dist * 0.7, dist * 0.55, fit.cz + dist * 0.7);
      controls.target.set(fit.cx, size.y * fit.scale * 0.4, fit.cz);
      controls.update();

      renderStill();
    }

    // Shared GLB post-processing: neutral grey material + crisp edge lines,
    // used for both the legacy demo GLB and a real Rhino-imported GLB — the
    // only difference between those two paths is which URL is loaded from.
    function processAndPlaceGltf(gltf) {
      if (disposed) return;
      const model = gltf.scene;
      model.updateMatrixWorld(true);

      const box = new THREE.Box3().setFromObject(model);
      const centre = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      model.position.set(-centre.x, -box.min.y, -centre.z);

      const edgeAdds = [];
      model.traverse(n => {
        if (n.isMesh) {
          const old = n.material;
          if (Array.isArray(old)) old.forEach(m => m?.dispose?.());
          else old?.dispose?.();
          n.material = GREY_MAT;
          const edges = new THREE.LineSegments(new THREE.EdgesGeometry(n.geometry, 25), EDGE_MAT);
          edgeAdds.push([n, edges]);
        } else if (n.isLine || n.isLineSegments || n.isPoints || n.isSprite) {
          n.visible = false;
        }
      });
      for (const [mesh, edges] of edgeAdds) mesh.add(edges);

      placeInScene(model, size);
      setLoading(false);
    }

    if (USE_LEGACY_GLB || demoMode || rhinoImport) {
      // Load GLB — meshopt only, decoded by three's tiny bundled decoder. No
      // DRACO: the old DRACOLoader pulled its decoder from a remote gstatic URL,
      // which is exactly the kind of thing that made the model "not load" when
      // that fetch was slow/blocked. The GLBs are re-encoded to meshopt offline
      // (the legacy demo path); a Rhino-imported GLB is loaded from its blob URL.
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);

      const glbPath = (USE_LEGACY_GLB || demoMode)
        ? (GLB_BY_TYPE[buildingType] ?? GLB_BY_TYPE.medium)
        : rhinoImport.url;

      loader.load(glbPath, processAndPlaceGltf, undefined, (err) => {
        console.error('GLB load failed:', err);
        setLoadError('Could not load model.');
        setLoading(false);
      });
    } else {
      // No architect-designed building exists for this site yet — nothing to
      // show. Draw the site outline only; the UI surfaces an honest "not
      // designed yet" state instead of fabricating a building.
      setLoading(false);
    }

    const onResize = () => {
      const w = canvas.parentElement.clientWidth || window.innerWidth;
      const h = canvas.parentElement.clientHeight || (window.innerHeight - 48);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      renderStill();
    };
    window.addEventListener('resize', onResize);

    // Initial paint (the GLB paints again itself once it finishes loading).
    renderer.render(scene, camera);

    return () => {
      disposed = true;
      if (raf != null) cancelAnimationFrame(raf);
      controls.removeEventListener('change', kick);
      window.removeEventListener('resize', onResize);
      controls.dispose();
      // Free per-mount geometries (ground plane, boundary outline, and the GLB
      // meshes — the big ones). renderer.dispose() alone does NOT free scene
      // geometry, so without this every stage re-entry leaks GPU memory that
      // accumulates into session-long lag. GREY_MAT is module-shared — leave it.
      scene.traverse(obj => { if (obj.geometry) obj.geometry.dispose(); });
      renderer.dispose();
    };
  }, [buildingType, site, chosenVariation, importVersion, demoMode]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        padding: '0.75rem 1.1rem',
        borderBottom: '1px solid rgba(20,20,15,0.07)',
        flexShrink: 0, background: 'var(--bg-glass)',
        backdropFilter: 'blur(12px)',
      }}>
        <button onClick={onBack} style={{
          background: 'none', border: '1px solid rgba(20,20,15,0.18)',
          color: 'rgba(20,20,15,0.65)', fontFamily: 'var(--mono)',
          fontSize: '0.7rem', padding: '0.35rem 0.7rem', cursor: 'pointer', letterSpacing: '0.05em',
        }}>{backLabel}</button>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.08rem' }}>
          <span style={{ fontSize: '0.58rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(20,20,15,0.3)' }}>
            {stageLabel}
          </span>
          <span style={{ fontSize: '0.8rem', color: 'var(--fg)', fontWeight: 400 }}>
            {siteName ?? 'Site'}&nbsp;
            <span style={{ color: 'rgba(20,20,15,0.38)', fontSize: '0.72rem' }}>
              · {meta.label} class · {siteBounds?.widthM ?? '?'}m × {siteBounds?.depthM ?? '?'}m
            </span>
          </span>
        </div>

        {/* Step trail — the architect's Site→Massing→Import pipeline. Columns
            was folded into Massing as a live toggle, not its own stage. Home
            Owner and Manufacturer never go through those stages, so showing
            it there would reference a workflow they never saw. */}
        {showStepTrail && ['Site', 'Massing', 'Sustainability', 'Import'].map((s, i) => (
          <div key={s} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            {i > 0 && <div style={{ width: 16, height: 1, background: 'rgba(20,20,15,0.1)' }} />}
            <span style={{
              fontSize: '0.57rem', letterSpacing: '0.08em', textTransform: 'uppercase',
              color: i === 3 ? 'var(--accent)' : 'rgba(20,20,15,0.22)',
              fontWeight: i === 3 ? 700 : 400,
              borderBottom: i === 3 ? '1px solid var(--accent)' : 'none',
              paddingBottom: i === 3 ? '1px' : '0',
            }}>{s}</span>
          </div>
        ))}
      </div>

      {/* Canvas */}
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <canvas
          ref={canvasRef}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
        />

        {loading && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '0.5rem',
            pointerEvents: 'none',
          }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '0.7rem', color: OVER_CANVAS_DIM, letterSpacing: '0.14em' }}>
              LOADING MODEL…
            </div>
          </div>
        )}

        {!loading && !loadError && !hasBuilding && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '0.6rem',
            pointerEvents: 'none', textAlign: 'center', padding: '0 2rem',
          }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '0.72rem', color: OVER_CANVAS_STRONG, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              No building designed yet
            </div>
            <div style={{ fontFamily: 'var(--sans)', fontSize: '0.75rem', color: OVER_CANVAS_DIM, maxWidth: 340 }}>
              Export the massing and column data for Rhino from the Massing stage, design the building, then import the finished model here.
            </div>
          </div>
        )}

        {loadError && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--mono)', fontSize: '0.75rem', color: '#ff6655',
          }}>{loadError}</div>
        )}

        {/* Controls hint */}
        {!loading && (
          <div style={{
            position: 'absolute', bottom: 24, right: 24,
            fontFamily: 'var(--mono)', fontSize: '0.62rem',
            color: OVER_CANVAS_FAINT, lineHeight: 2, textAlign: 'right', pointerEvents: 'none',
            letterSpacing: '0.06em',
          }}>
            <div>SCROLL — zoom</div>
            <div>DRAG — orbit</div>
            <div>RIGHT DRAG — pan</div>
          </div>
        )}

        {/* Left dashboard — either the import affordance (no building yet) or
            the "view your individual home" entry point once a real,
            Rhino-designed building has been imported for this site. */}
        {!loading && (
          <div style={{
            position: 'absolute', top: 24, left: 24, width: 264,
            background: 'var(--bg-glass)', border: '1px solid rgba(20,20,15,0.1)',
            padding: '1.1rem 1.15rem', fontFamily: 'var(--mono)',
            backdropFilter: 'blur(10px)', display: 'flex', flexDirection: 'column', gap: '0.9rem',
          }}>
            <div>
              <div style={{ fontSize: '0.55rem', letterSpacing: '0.14em', color: 'rgba(20,20,15,0.3)', textTransform: 'uppercase', marginBottom: '0.4rem' }}>Site</div>
              <div style={{ fontSize: '1.05rem', color: 'var(--fg)', fontWeight: 600 }}>{meta.label} class</div>
              <div style={{ fontSize: '0.68rem', color: 'rgba(20,20,15,0.45)' }}>
                {siteBounds?.widthM ?? '?'}m × {siteBounds?.depthM ?? '?'}m
              </div>
            </div>

            <div style={{ height: 1, background: 'rgba(20,20,15,0.08)' }} />

            {(hasBuilding || alwaysShowContinue) ? (
              <div>
                <div style={{ fontSize: '0.55rem', letterSpacing: '0.14em', color: 'rgba(20,20,15,0.3)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                  {hasBuilding ? 'Your home' : 'Production data'}
                </div>
                <div style={{ fontSize: '0.7rem', color: 'rgba(20,20,15,0.5)', lineHeight: 1.6, marginBottom: '0.75rem' }}>
                  {hasBuilding
                    ? 'Step inside one of the homes in this building and lay it out your way.'
                    : 'The bill of materials is computed from the real building programme, independent of the 3D import.'}
                </div>
                <button onClick={onViewHome} style={{
                  width: '100%', background: 'var(--accent)', color: 'var(--bg)', border: 'none',
                  fontFamily: 'var(--mono)', fontSize: '0.72rem', fontWeight: 700,
                  letterSpacing: '0.08em', padding: '0.65rem 0.8rem', cursor: 'pointer',
                  textTransform: 'uppercase',
                }}>{viewHomeLabel}</button>
              </div>
            ) : null}
            {!hasBuilding && !alwaysShowContinue && (
              <div>
                <div style={{ fontSize: '0.55rem', letterSpacing: '0.14em', color: 'rgba(20,20,15,0.3)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Import design</div>
                <div style={{ fontSize: '0.7rem', color: 'rgba(20,20,15,0.5)', lineHeight: 1.6, marginBottom: '0.75rem' }}>
                  Upload the architect's Rhino-exported .glb once the building has been designed.
                </div>
                <RhinoImportButton siteId={site?.id} onImported={handleImported} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
