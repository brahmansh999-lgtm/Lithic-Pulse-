/**
 * GLBSiteView — loads the matched GLB for the selected site and shows it
 * fitted inside the real site boundary. Full 3D viewer, free orbit + zoom.
 */
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { fitFootprintToSite, latLngToXZ } from './siteFit';

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

export default function GLBSiteView({ buildingType = 'medium', siteName, site, siteBounds, onBack, onViewHome, viewHomeLabel = 'View your individual home →' }) {
  const canvasRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const meta = META[buildingType] ?? META.medium;

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
    scene.background = new THREE.Color('var(--bg)');
    scene.fog = new THREE.Fog('var(--bg)', 300, 600);

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
      new THREE.MeshBasicMaterial({ color: '#1c2a1c' })
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

    // Load GLB — meshopt only, decoded by three's tiny bundled decoder. No
    // DRACO: the old DRACOLoader pulled its decoder from a remote gstatic URL,
    // which is exactly the kind of thing that made the model "not load" when
    // that fetch was slow/blocked. The GLBs are re-encoded to meshopt offline.
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);

    const glbPath = GLB_BY_TYPE[buildingType] ?? GLB_BY_TYPE.medium;

    loader.load(glbPath, (gltf) => {
      if (disposed) return; // component already unmounted — don't touch the scene
      const model = gltf.scene;
      model.updateMatrixWorld(true);

      // First zero the model in its own local frame: centre its footprint on
      // the origin and drop it onto y=0. This is the SAME local frame the
      // massing footprint uses (footprint centred, sitting on the ground), so
      // the site-fit transform below lands it in the same place as the massing.
      const box = new THREE.Box3().setFromObject(model);
      const centre = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      model.position.set(-centre.x, -box.min.y, -centre.z);

      const edgeAdds = [];
      model.traverse(n => {
        if (n.isMesh) {
          // Drop the GLB's own materials — architect wants a neutral grey/white
          // massing, not the coloured render. Dispose the originals so their
          // GPU resources are freed instead of lingering unused.
          const old = n.material;
          if (Array.isArray(old)) old.forEach(m => m?.dispose?.());
          else old?.dispose?.();
          n.material = GREY_MAT;

          // Crisp edge lines on every mesh so architectural detail (floor
          // splits, mullions, balcony edges) stays legible instead of
          // disappearing into the flat shaded faces. Collected and added
          // after traverse() so we don't mutate the tree mid-walk.
          const edges = new THREE.LineSegments(new THREE.EdgesGeometry(n.geometry, 25), EDGE_MAT);
          edgeAdds.push([n, edges]);
        } else if (n.isLine || n.isLineSegments || n.isPoints || n.isSprite) {
          // The source GLBs carry leftover CAD reference geometry — coloured
          // dimension/curve lines, diamond gizmo markers, construction guides
          // — authored in whatever bright blue/red/cyan the CAD tool defaulted
          // to. None of that is real building geometry, so it must not render
          // at all here (not even recoloured): hide it outright.
          n.visible = false;
        }
      });
      for (const [mesh, edges] of edgeAdds) mesh.add(edges);

      // Same fit + worldGroup TRS as MassingStage.useMassingViewer: rotate to
      // the site's oriented axis, scale (clamped to the same 0.65..1.6 band so
      // a small building on a huge plot stays its real size), translate to the
      // site's true centre. This is what guarantees Massing, Columns and this
      // 3D-Fit all show the building in the identical location/orientation.
      const rawFit = fitFootprintToSite(coords, cLat, cLng, size.x, size.z);
      const MIN_SCALE = 0.65, MAX_SCALE = 1.6;
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, rawFit.scale));
      const fit = { ...rawFit, scale };

      const worldGroup = new THREE.Group();
      worldGroup.scale.set(fit.scale, 1, fit.scale);
      worldGroup.rotation.y = fit.angle;
      worldGroup.position.set(fit.cx, 0, fit.cz);
      worldGroup.add(model);
      scene.add(worldGroup);

      // Frame the camera on the site centre (fit.cx/cz), at a distance driven
      // by the building's on-site size.
      const spanOnSite = Math.max(size.x, size.z) * fit.scale;
      const dist = Math.max(spanOnSite * 1.5, 30);
      camera.position.set(fit.cx + dist * 0.7, dist * 0.55, fit.cz + dist * 0.7);
      controls.target.set(fit.cx, size.y * fit.scale * 0.4, fit.cz);
      controls.update();

      renderStill(); // paint the freshly-framed, loaded model once
      setLoading(false);
    }, undefined, (err) => {
      console.error('GLB load failed:', err);
      setLoadError('Could not load model.');
      setLoading(false);
    });

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
  }, [buildingType, site]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        padding: '0.75rem 1.1rem',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        flexShrink: 0, background: 'var(--bg-glass)',
        backdropFilter: 'blur(12px)',
      }}>
        <button onClick={onBack} style={{
          background: 'none', border: '1px solid rgba(255,255,255,0.18)',
          color: 'rgba(240,236,226,0.65)', fontFamily: 'JetBrains Mono, monospace',
          fontSize: '0.7rem', padding: '0.35rem 0.7rem', cursor: 'pointer', letterSpacing: '0.05em',
        }}>← MASSING</button>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.08rem' }}>
          <span style={{ fontSize: '0.58rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(240,236,226,0.3)' }}>
            04 / Masterplanner
          </span>
          <span style={{ fontSize: '0.8rem', color: 'var(--fg)', fontWeight: 400 }}>
            {siteName ?? 'Site'}&nbsp;
            <span style={{ color: 'rgba(240,236,226,0.38)', fontSize: '0.72rem' }}>
              · {meta.label} · {meta.floors}F · {meta.units} units · {siteBounds?.widthM ?? '?'}m × {siteBounds?.depthM ?? '?'}m
            </span>
          </span>
        </div>

        {/* Step trail — Masterplanner (the 3D-fit stage, renamed) is the terminal stage */}
        {['Site', 'Zoning', 'Massing', 'Columns', 'Masterplanner'].map((s, i) => (
          <div key={s} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            {i > 0 && <div style={{ width: 16, height: 1, background: 'rgba(255,255,255,0.1)' }} />}
            <span style={{
              fontSize: '0.57rem', letterSpacing: '0.08em', textTransform: 'uppercase',
              color: i === 4 ? 'var(--accent)' : 'rgba(240,236,226,0.22)',
              fontWeight: i === 4 ? 700 : 400,
              borderBottom: i === 4 ? '1px solid var(--accent)' : 'none',
              paddingBottom: i === 4 ? '1px' : '0',
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
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.7rem', color: 'rgba(240,236,226,0.35)', letterSpacing: '0.14em' }}>
              LOADING {meta.label.toUpperCase()} GLB…
            </div>
          </div>
        )}

        {loadError && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'JetBrains Mono, monospace', fontSize: '0.75rem', color: '#ff6655',
          }}>{loadError}</div>
        )}

        {/* Controls hint */}
        {!loading && (
          <div style={{
            position: 'absolute', bottom: 24, right: 24,
            fontFamily: 'JetBrains Mono, monospace', fontSize: '0.62rem',
            color: 'rgba(240,236,226,0.25)', lineHeight: 2, textAlign: 'right', pointerEvents: 'none',
            letterSpacing: '0.06em',
          }}>
            <div>SCROLL — zoom</div>
            <div>DRAG — orbit</div>
            <div>RIGHT DRAG — pan</div>
          </div>
        )}

        {/* Left dashboard — building summary + the "view your individual
            home" entry point into the unit picker + configurator. This is
            the terminal handoff of the whole pipeline: the fully-formed
            building GLB is on screen, and from here the user drops into
            configuring one of the individual homes inside it. */}
        {!loading && (
          <div style={{
            position: 'absolute', top: 24, left: 24, width: 264,
            background: 'var(--bg-glass)', border: '1px solid rgba(255,255,255,0.1)',
            padding: '1.1rem 1.15rem', fontFamily: 'JetBrains Mono, monospace',
            backdropFilter: 'blur(10px)', display: 'flex', flexDirection: 'column', gap: '0.9rem',
          }}>
            <div>
              <div style={{ fontSize: '0.55rem', letterSpacing: '0.14em', color: 'rgba(240,236,226,0.3)', textTransform: 'uppercase', marginBottom: '0.4rem' }}>Building</div>
              <div style={{ fontSize: '1.05rem', color: 'var(--fg)', fontWeight: 600 }}>{meta.label}</div>
              <div style={{ fontSize: '0.68rem', color: 'rgba(240,236,226,0.45)', marginTop: '0.2rem' }}>
                {meta.floors} floors · {meta.units} units
              </div>
              <div style={{ fontSize: '0.68rem', color: 'rgba(240,236,226,0.45)' }}>
                fits {siteBounds?.widthM ?? '?'}m × {siteBounds?.depthM ?? '?'}m site
              </div>
            </div>

            <div style={{ height: 1, background: 'rgba(255,255,255,0.08)' }} />

            <div>
              <div style={{ fontSize: '0.55rem', letterSpacing: '0.14em', color: 'rgba(240,236,226,0.3)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Your home</div>
              <div style={{ fontSize: '0.7rem', color: 'rgba(240,236,226,0.5)', lineHeight: 1.6, marginBottom: '0.75rem' }}>
                Step inside one of the homes in this building and lay it out your way.
              </div>
              <button onClick={onViewHome} style={{
                width: '100%', background: 'var(--accent)', color: 'var(--bg)', border: 'none',
                fontFamily: 'JetBrains Mono, monospace', fontSize: '0.72rem', fontWeight: 700,
                letterSpacing: '0.08em', padding: '0.65rem 0.8rem', cursor: 'pointer',
                textTransform: 'uppercase',
              }}>{viewHomeLabel}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
