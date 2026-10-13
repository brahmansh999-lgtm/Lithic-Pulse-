import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import RoomEnv from '../shared/RoomEnv';
import CinematicFX from '../shared/CinematicFX';
import { applyMaterials, makeGlassMat } from './utils/materials';
import './AssemblyVisualizer.css';

// ─── Assembly phases — generic, works for all room layer sets ─────────────────

// Construction sequence: floor → columns → furniture → openings → interior
// walls → exterior envelope → upper slab. Every phase uses the same gentle
// 'rise' so the build feels like one continuous, seamless slow-motion assembly
// (no jarring drops/slides between steps). Rooms whose GLB only has a combined
// 'slab' node fold it into phase 1; richer rooms separate floor / top slab.
const PHASES = [
  { id: 1, label: 'Floor',          keys: ['floors', 'bottom slabs', 'slab'],                     anim: 'rise', color: '#a8a49e', accent: '#c8c0b0' },
  { id: 2, label: 'Columns',        keys: ['columns'],                                            anim: 'rise', color: '#dedad6', accent: '#e8e4e0' },
  { id: 3, label: 'Furniture',      keys: ['furniture', 'default'],                               anim: 'rise', color: '#e8e4da', accent: '#cfcbc2' },
  { id: 4, label: 'Doors & Windows',keys: ['doors', 'door', 'windows', 'glasses', 'glass'],       anim: 'rise', color: '#88aacc', accent: '#aaccee' },
  { id: 5, label: 'Interior Walls', keys: ['internal walls', 'internal wal'],                     anim: 'rise', color: '#bcb8b2', accent: '#d0ccc6' },
  { id: 6, label: 'Exterior Walls', keys: ['external walls', 'external wal', 'fins', 'staircase', 'balconies'], anim: 'rise', color: '#dedad4', accent: '#eae6e0' },
  { id: 7, label: 'Upper Slab',     keys: ['top slabs'],                                          anim: 'rise', color: '#c0bcb6', accent: '#d4d0ca' },
];

function phaseOf(layerKey) {
  for (const ph of PHASES) if (ph.keys.includes(layerKey)) return ph.id;
  return 7; // unknown layers go into final phase
}
function animOf(layerKey) {
  for (const ph of PHASES) if (ph.keys.includes(layerKey)) return ph.anim;
  return 'rise';
}

// ─── Camera auto-fit — frame the FINAL model once, then glide cinematically ──
// Framerate-independent damping so the orbit is silky on any refresh rate.

const _camDir   = new THREE.Vector3(1, 1.2, 1).normalize();
const _camWant  = new THREE.Vector3();

function damp(current, target, lambda, dt) {
  // Exponential smoothing that is identical regardless of frame rate.
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

// ─── On-demand render pump ────────────────────────────────────────────────
// The scene runs frameloop="demand", so it only renders when we ask. This
// pump keeps frames flowing WHILE something is actually moving — the whole
// time it's playing, plus a settle window after any phase/play/hidden change
// so the camera damp + part fly-in glide to rest — then goes silent. Idle
// (paused, or sequence complete and settled) costs ZERO GPU instead of
// grinding a 4K shadow map + AO/bloom pass at 60fps forever.
function RenderPump({ playing, phase, hidden }) {
  const { invalidate } = useThree();
  const settle = useRef(0);
  // Re-open the settle window on any change that starts motion.
  useEffect(() => { settle.current = 1.6; invalidate(); }, [phase, playing, hidden, invalidate]);
  useFrame((_, dt) => {
    if (playing) { invalidate(); return; }        // continuous turntable while playing
    if (settle.current > 0) { settle.current -= dt; invalidate(); } // glide to rest, then stop
  });
  return null;
}

function CameraRig({ fullBounds, phase, playing }) {
  const { camera, size } = useThree();
  const half    = useRef(0);   // current (animated) ortho half-height
  const halfTgt = useRef(0);   // target ortho half-height
  const yaw     = useRef(0);   // slow signature orbit, in radians

  useFrame((_, dt) => {
    const b = fullBounds.current;
    if (!b.ready) return;

    const mx  = b.maxDim || 10;
    const asp = size.width / size.height;

    // The whole erected model always fits — we never re-fit per phase, so the
    // frame never snaps. A touch of breathing room during part fly-in.
    halfTgt.current = (mx / 2) * 1.5;
    if (half.current === 0) half.current = halfTgt.current; // seed first frame
    half.current = damp(half.current, halfTgt.current, 4, dt);
    const h = half.current;

    // Signature slow turntable while playing — gives the sequence life without
    // ever feeling busy. Eases to a rest when paused.
    const targetSpeed = playing && phase > 0 && phase < PHASES.length ? 0.06 : 0;
    yaw.current += targetSpeed * dt;

    camera.left = -h * asp; camera.right =  h * asp;
    camera.top  =  h;       camera.bottom = -h;
    camera.near = -mx * 30; camera.far   =  mx * 30;

    const cs = Math.cos(yaw.current), sn = Math.sin(yaw.current);
    _camWant.set(
      _camDir.x * cs - _camDir.z * sn,
      _camDir.y,
      _camDir.x * sn + _camDir.z * cs,
    ).normalize().multiplyScalar(mx * 4).add(b.center);

    // Damp the position too so any retarget is a glide, never a jump.
    camera.position.x = damp(camera.position.x, _camWant.x, 6, dt);
    camera.position.y = damp(camera.position.y, _camWant.y, 6, dt);
    camera.position.z = damp(camera.position.z, _camWant.z, 6, dt);
    camera.lookAt(b.center);
    camera.updateProjectionMatrix();
  });

  return null;
}

// ─── Shadow governor ──────────────────────────────────────────────────────────
// Re-rendering the 2K shadow map every frame is the single biggest GPU cost
// here. Parts only move for ~0.62s after each phase change, so we only refresh
// shadows while something is actually moving and freeze them at rest. Result:
// the GPU idles between phases instead of grinding a full shadow pass at 60fps.

function ShadowGovernor({ phase, playing }) {
  const { gl } = useThree();
  const settle = useRef(0);

  useEffect(() => {
    gl.shadowMap.autoUpdate = false;        // we drive updates manually
    gl.shadowMap.needsUpdate = true;
  }, [gl]);

  // Any phase change (or play toggle) opens a ~1.3s window of live shadows —
  // long enough to cover the ~1.1s part seat so shadows track the motion.
  useEffect(() => { settle.current = 1.3; }, [phase, playing]);

  useFrame((_, dt) => {
    if (settle.current > 0) {
      settle.current -= dt;
      gl.shadowMap.needsUpdate = true;      // keep refreshing while parts move
    }
  });
  return null;
}

// ─── Single layer node with 4K materials ─────────────────────────────────────

const glassMat = makeGlassMat();

function LayerNode({ layerKey, scene, phase, hidden, sceneSize, matCache }) {
  const groupRef = useRef();
  const offset   = useRef(new THREE.Vector3()); // resting offset for this layer
  const t        = useRef(0);                    // 0 = staged, 1 = seated
  const wasVis   = useRef(false);
  const myPhase  = phaseOf(layerKey);
  const anim     = animOf(layerKey);

  useEffect(() => {
    let found = null;
    scene.traverse(n => {
      if (found) return;
      const k = (n.name || '').toLowerCase().replace(/\s+/g, ' ').trim();
      if (k === layerKey) found = n;
    });
    if (!found || !groupRef.current) return;
    const clone = found.clone(true);
    const mat = matCache[layerKey];
    clone.traverse(child => {
      if (!child.isMesh) return;
      child.material = mat;
      child.castShadow    = true;
      child.receiveShadow = true;
      if (mat === glassMat) child.renderOrder = 1;
    });
    while (groupRef.current.children.length) groupRef.current.remove(groupRef.current.children[0]);
    groupRef.current.add(clone);
  }, [scene, layerKey, matCache]);

  // Compute the staged offset once (depends only on model size + anim type).
  // Offsets are kept modest so each part stays inside the frame while it seats —
  // the model reads as a complete, composed object at every point in the play,
  // rather than parts whipping in from far off-canvas.
  useEffect(() => {
    const h = sceneSize.y || 10;
    const w = Math.max(sceneSize.x, sceneSize.z) || 10;
    if (anim === 'rise')       offset.current.set(0, -h * 0.6, 0);
    else if (anim === 'drop')  offset.current.set(0,  h * 0.7, 0);
    else if (anim === 'slide') offset.current.set(w * 0.6, 0, 0);
    else                       offset.current.set(0,  h * 0.6, 0);
  }, [sceneSize, anim]);

  useFrame((_, dt) => {
    const g = groupRef.current;
    if (!g) return;
    const visible = !hidden.has(layerKey) && phase >= myPhase;
    g.visible = visible;

    if (!visible) {
      // Re-stage instantly off-canvas, ready to fly in next time it appears.
      wasVis.current = false;
      t.current = 0;
      g.position.copy(offset.current);
      return;
    }
    if (!wasVis.current) { wasVis.current = true; t.current = 0; }

    // Framerate-independent settle. ~1.8s to seat — slow-motion glide, with an
    // ease-out so each part decelerates into place. The long seat nearly fills
    // the phase dwell so the build feels like one continuous motion, not a
    // series of quick pops with dead gaps between them.
    t.current = Math.min(1, t.current + dt / 1.8);
    const e = 1 - Math.pow(1 - t.current, 3); // cubic ease-out
    g.position.copy(offset.current).multiplyScalar(1 - e);

    // Fade the part in as it seats so it materialises gently rather than
    // popping to full opacity the instant the phase flips. Seamless entrance.
    // Once fully seated we restore opaque rendering (transparent:false) so there
    // is no lingering transparency cost or sorting artifact at rest.
    const seated = t.current >= 1;
    const fade   = seated ? 1 : Math.min(1, t.current / 0.5); // opaque by half-seat
    g.traverse(child => {
      if (!child.isMesh || !child.material) return;
      const m = child.material;
      if (m === glassMat) return;            // glass keeps its own opacity
      if (seated) {
        if (m.transparent) { m.transparent = false; m.opacity = 1; m.needsUpdate = true; }
      } else {
        if (!m.transparent) m.transparent = true;
        m.opacity = fade;
      }
    });
  });

  return <group ref={groupRef} visible={false} />;
}

// ─── Layer toggle panel ───────────────────────────────────────────────────────

function LayerPanel({ layerUI, phase, hidden, onToggle }) {
  return (
    <div className="asm-layers-panel">
      <div className="asm-layers-title">Layers</div>
      {layerUI.map(({ key, label, phase: lPhase }) => {
        const isHidden = hidden.has(key);
        const notYet   = phase < lPhase;
        return (
          <button
            key={key}
            className={`asm-layer-btn${isHidden ? ' hidden' : ''}${notYet ? ' not-yet' : ''}`}
            onClick={() => !notYet && onToggle(key)}
            disabled={notYet}
            title={notYet ? 'Not yet assembled' : (isHidden ? 'Show' : 'Hide')}
          >
            <span className="asm-layer-dot" style={{ background: PHASES.find(p => p.keys.includes(key))?.color || '#888' }} />
            <span className="asm-layer-name">{label}</span>
            <span className="asm-layer-eye">{isHidden ? '○' : '●'}</span>
          </button>
        );
      })}
      <button className="asm-layers-reset" onClick={() => onToggle(null)}>
        Show all
      </button>
    </div>
  );
}

// ─── Inner 3D scene component ─────────────────────────────────────────────────

function AssemblyCanvas({ glbPath, phase, playing, hidden, pigmentHex, placedFurniture }) {
  const { scene } = useGLTF(glbPath);
  const rootRef   = useRef();
  const sizeRef   = useRef(new THREE.Vector3(10, 10, 10));
  const floorYRef = useRef(0);
  // Static bounds of the fully-erected model — computed once, read every frame
  // by CameraRig so the view never re-fits (and never snaps) between phases.
  const fullBounds = useRef({ ready: false, center: new THREE.Vector3(), maxDim: 10 });

  const layerKeys = useMemo(() => {
    const keys = new Set();
    scene.traverse(n => {
      const k = (n.name || '').toLowerCase().replace(/\s+/g, ' ').trim();
      if (k && k !== 'scene' && k !== 'rootnode') keys.add(k);
    });
    return [...keys];
  }, [scene]);

  const matCache = useMemo(() => {
    applyMaterials(scene, pigmentHex);
    const cache = {};
    scene.traverse(n => {
      const k = (n.name || '').toLowerCase().replace(/\s+/g, ' ').trim();
      if (!k || k === 'scene' || k === 'rootnode') return;
      n.traverse(child => {
        if (child.isMesh && !cache[k]) cache[k] = child.material;
      });
    });
    const glassKeys = ['windows', 'glasses', 'glass'];
    glassKeys.forEach(k => { if (cache[k]) cache[k] = glassMat; });
    return cache;
  }, [scene, pigmentHex]);

  useEffect(() => {
    const box = new THREE.Box3().setFromObject(scene);
    sizeRef.current = box.getSize(new THREE.Vector3());
    const ctr = box.getCenter(new THREE.Vector3());
    floorYRef.current = box.min.y;
    fullBounds.current.center.copy(ctr);
    fullBounds.current.maxDim = Math.max(sizeRef.current.x, sizeRef.current.y, sizeRef.current.z) || 10;
    fullBounds.current.ready = true;
  }, [scene]);

  // When placed furniture is present, the GLB's baked furniture layer is
  // replaced by the real placed items — hide it so there's no double geometry.
  const effectiveHidden = useMemo(() => {
    if (!placedFurniture?.length) return hidden;
    const h = new Set(hidden);
    h.add('furniture');
    h.add('default');
    return h;
  }, [hidden, placedFurniture]);

  return (
    <>
      <group ref={rootRef}>
        {layerKeys.map(key => (
          <LayerNode
            key={key}
            layerKey={key}
            scene={scene}
            phase={phase}
            hidden={effectiveHidden}
            sceneSize={sizeRef.current}
            pigmentHex={pigmentHex}
            matCache={matCache}
          />
        ))}
      </group>
      <PlacedFurnitureLayer
        placedFurniture={placedFurniture}
        phase={phase}
        hidden={hidden}
        sceneSize={sizeRef.current}
        floorY={floorYRef.current}
      />
      <CameraRig fullBounds={fullBounds} phase={phase} playing={playing} />
      <ShadowGovernor phase={phase} playing={playing} />
    </>
  );
}

// ─── Placed furniture layer — renders the actual items the user placed ────────
// Each item is a simple box mesh matching the real w/d/h from the catalogue.
// They rise into position during phase 3, same timing as all other layers.

const MAT_COLORS = {
  fabric:   '#c8b89a',
  wood:     '#8a7060',
  metal:    '#909098',
  concrete: '#c0b8a8',
  none:     '#d4cfc8',
};

function PlacedFurnitureLayer({ placedFurniture, phase, hidden, sceneSize, floorY }) {
  const FURN_PHASE = 3;
  const visible = !hidden.has('furniture') && phase >= FURN_PHASE;

  // Animate the entire group rising in together, same as LayerNode
  const groupRef = useRef();
  const t = useRef(0);
  const wasVis = useRef(false);
  const offsetY = (sceneSize?.y || 10) * 0.6;

  useFrame((_, dt) => {
    const g = groupRef.current;
    if (!g) return;
    g.visible = visible;
    if (!visible) { wasVis.current = false; t.current = 0; g.position.y = -offsetY; return; }
    if (!wasVis.current) { wasVis.current = true; t.current = 0; }
    t.current = Math.min(1, t.current + dt / 1.8);
    const e = 1 - Math.pow(1 - t.current, 3);
    g.position.y = -offsetY * (1 - e);

    const fade = t.current >= 1 ? 1 : Math.min(1, t.current / 0.5);
    g.traverse(child => {
      if (!child.isMesh || !child.material) return;
      if (t.current >= 1) {
        if (child.material.transparent) { child.material.transparent = false; child.material.opacity = 1; child.material.needsUpdate = true; }
      } else {
        if (!child.material.transparent) child.material.transparent = true;
        child.material.opacity = fade;
      }
    });
  });

  if (!placedFurniture?.length) return null;

  return (
    <group ref={groupRef} visible={false}>
      {placedFurniture.map((item, i) => {
        const color = item.color || MAT_COLORS[item.mat] || '#c0b8a8';
        const y = floorY + item.h / 2;
        return (
          <group key={i} position={[item.x ?? 0, y, item.z ?? 0]} rotation={[0, item.rot ?? 0, 0]}>
            <mesh castShadow receiveShadow>
              <boxGeometry args={[item.w, item.h, item.d]} />
              <meshStandardMaterial
                color={color}
                roughness={item.mat === 'metal' ? 0.3 : 0.75}
                metalness={item.mat === 'metal' ? 0.6 : 0.0}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

// ─── Main export ─────────────────────────────────────────────────────────────

export default function AssemblyVisualizer({ typology, config, placedFurniture, onNext }) {
  const [phase,   setPhase]   = useState(0);
  const [playing, setPlaying] = useState(true); // auto-erect on entry — no "press play" gate
  const [hidden,  setHidden]  = useState(new Set());

  const glbPath   = typology?.glb || '/1l.glb';
  const PIGMENT_HEX = {
    PIG_NONE:  '#f0ece6',
    PIG_WARM:  '#e8d4b0',
    PIG_SLATE: '#c4ccd8',
    PIG_ONYX:  '#3a3632',
    PIG_CHALK: '#f4f0ea',
  };
  const pigmentHex = PIGMENT_HEX[config?.pigment] || '#f0ece6';

  // Auto-play advance. A short lead-in lets the GLB + materials warm up before
  // the first part rises in (no opening stutter); then a slow, steady cadence.
  // Each phase dwells 2.9s — the ~1.8s slow-motion seat fills most of it, so the
  // next phase begins just as the last part settles: seamless, no dead gaps.
  // Whole erection runs ~22s: 1.2s lead-in + 7 phases × 2.9s dwell.
  useEffect(() => {
    if (!playing) return;
    if (phase >= PHASES.length) { setPlaying(false); return; }
    const id = setTimeout(() => setPhase(p => p + 1), phase === 0 ? 1200 : 2900);
    return () => clearTimeout(id);
  }, [playing, phase]);

  const goBack     = () => { setPlaying(false); setPhase(p => Math.max(0, p - 1)); };
  const goForward  = () => { setPlaying(false); setPhase(p => Math.min(PHASES.length, p + 1)); };
  const handlePlay = () => { if (phase >= PHASES.length) setPhase(0); setPlaying(v => !v); };

  const toggleLayer = (key) => {
    if (key === null) { setHidden(new Set()); return; }
    setHidden(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  };

  const currentPhase = phase > 0 && phase <= PHASES.length ? PHASES[phase - 1] : null;

  return (
    <div className="asm-layout">
      <div className="asm-main">
        <Canvas
          className="asm-canvas"
          orthographic
          camera={{ near: -10000, far: 10000 }}
          shadows="soft"
          gl={{
            antialias: true, powerPreference: 'high-performance',  // MSAA + SMAA in post
            alpha: false,
            toneMapping: THREE.ACESFilmicToneMapping,
            toneMappingExposure: 1.0,
            outputColorSpace: THREE.SRGBColorSpace,
          }}
          dpr={Math.min(window.devicePixelRatio, 2)}
          frameloop="demand"
        >
          <RenderPump playing={playing} phase={phase} hidden={hidden} />
          <color attach="background" args={['#050506']} />
          <RoomEnv intensity={0.6} />

          <directionalLight position={[10, 20, 10]} intensity={2.6} color="#fff5e8" castShadow
            shadow-mapSize={[4096, 4096]} shadow-camera-left={-40} shadow-camera-right={40}
            shadow-camera-top={40} shadow-camera-bottom={-40}
            shadow-bias={-0.0002} shadow-normalBias={0.02} />
          <directionalLight position={[-8, 12, -8]} intensity={0.9} color="#b0c8ff" />
          <directionalLight position={[0, -6, 2]}   intensity={0.3} color="#ffe4b0" />
          <ambientLight intensity={0.12} />

          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]} receiveShadow>
            <planeGeometry args={[200, 200]} />
            <meshStandardMaterial color="#080809" roughness={1} />
          </mesh>

          <React.Suspense fallback={null}>
            <AssemblyCanvas
              key={glbPath}
              glbPath={glbPath}
              phase={phase}
              playing={playing}
              hidden={hidden}
              pigmentHex={pigmentHex}
              placedFurniture={placedFurniture}
            />
          </React.Suspense>

          {/* Cinematic pass — this scene animates every frame, so AO runs at
              half-res (high quality, ~half the per-frame cost). Grounds the
              parts in contact shadows without dropping below 60fps on the 3070. */}
          <CinematicFX aoIntensity={0.7} aoQuality="high" aoHalfRes
            bloomIntensity={0.22} bloomThreshold={0.92} vignette={0.22} />

        </Canvas>

        {/* Phase label — top left */}
        {currentPhase && (
          <div className="asm-phase-label" key={phase}>
            <div className="asm-ph-num">Phase {phase} / {PHASES.length}</div>
            <div className="asm-ph-name">{currentPhase.label}</div>
            <div className="asm-ph-bar">
              <div className="asm-ph-bar-fill"
                style={{ width: `${(phase / PHASES.length) * 100}%`, background: currentPhase.accent }} />
            </div>
          </div>
        )}

        {phase === 0 && (
          <div className="asm-hint">
            <div className="asm-hint-icon asm-hint-icon-live" />
            <div className="asm-hint-text">Assembling<br/>erection sequence</div>
          </div>
        )}

        {/* Layer toggle panel — populated dynamically after GLB loads */}
        <React.Suspense fallback={null}>
          <LayerPanelLoader glbPath={glbPath} phase={phase} hidden={hidden} onToggle={toggleLayer} />
        </React.Suspense>

        {/* Timeline dock */}
        <div className="asm-timeline">
          <div className="asm-tl-controls">
            <button className="asm-tl-btn" onClick={goBack} disabled={phase === 0}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M8 2L4 6l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            <button className="asm-tl-play" onClick={handlePlay}>
              {playing
                ? <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><rect x="2" y="2" width="3" height="8" rx="1"/><rect x="7" y="2" width="3" height="8" rx="1"/></svg>
                : <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><path d="M3 2l7 4-7 4V2z"/></svg>
              }
            </button>
            <button className="asm-tl-btn" onClick={goForward} disabled={phase >= PHASES.length}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>

          <div className="asm-tl-track">
            <div className="asm-tl-bar">
              <div className="asm-tl-bar-fill" style={{ width: `${(phase / PHASES.length) * 100}%` }} />
            </div>
            {PHASES.map(ph => (
              <button
                key={ph.id}
                className={`asm-tl-step${phase >= ph.id ? ' done' : ''}${phase === ph.id ? ' current' : ''}`}
                style={{ left: `${((ph.id - 1) / (PHASES.length - 1)) * 100}%` }}
                onClick={() => { setPlaying(false); setPhase(ph.id); }}
                title={ph.label}
              >
                <div className="asm-tl-dot"
                  style={phase >= ph.id ? { background: ph.color, borderColor: ph.accent } : {}}>
                  {phase >= ph.id ? '✓' : ph.id}
                </div>
                <span className="asm-tl-label">{ph.label}</span>
              </button>
            ))}
          </div>

          <button className="asm-next-btn" onClick={onNext}>
            Export
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <path d="M2 5.5h7M6.5 3l3 2.5L6.5 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Separate component so layer panel can Suspense independently ─────────────

function LayerPanelLoader({ glbPath, phase, hidden, onToggle }) {
  const { scene } = useGLTF(glbPath);

  const layerUI = useMemo(() => {
    const keys = new Set();
    scene.traverse(n => {
      const k = (n.name || '').toLowerCase().replace(/\s+/g, ' ').trim();
      if (k && k !== 'scene' && k !== 'rootnode') keys.add(k);
    });
    // Always include furniture layer so it's toggleable even if not a top-level GLB node
    keys.add('furniture');
    return [...keys].map(k => ({
      key: k,
      label: k.replace(/\b\w/g, c => c.toUpperCase()),
      phase: phaseOf(k),
    })).sort((a, b) => a.phase - b.phase);
  }, [scene, glbPath]);

  return <LayerPanel layerUI={layerUI} phase={phase} hidden={hidden} onToggle={onToggle} />;
}
