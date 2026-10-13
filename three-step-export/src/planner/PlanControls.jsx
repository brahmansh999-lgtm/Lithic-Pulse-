import { useState, Suspense, useMemo, useCallback, useRef, useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, useGLTF, ContactShadows, Text } from '@react-three/drei';
import { EffectComposer, Bloom, ToneMapping, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import RoomEnv from '../shared/RoomEnv';
import './PlanControls.css';
import { BED_COLORS, TYPOLOGY_MAP, TYPOLOGIES, CONCEPTS, CONCEPT_LABELS } from './masterplanGenerator';

// ─── Unit Mix Sliders ─────────────────────────────────────────────
// Shows a slider per typology so the user can set target percentages.
// The remaining share is distributed automatically.
function UnitMixPanel({ mixTargets, setMixTargets }) {
  const isCustom = !!mixTargets;

  const handleToggle = useCallback(() => {
    if (isCustom) { setMixTargets(null); return; }
    // Default to equal split
    const eq = 1 / TYPOLOGIES.length;
    const m = {};
    TYPOLOGIES.forEach(t => { m[t.id] = eq; });
    setMixTargets(m);
  }, [isCustom, setMixTargets]);

  const handleSlider = useCallback((id, frac) => {
    setMixTargets(prev => {
      const next = { ...prev, [id]: frac };
      // Normalise so total = 1
      const total = Object.values(next).reduce((s, v) => s + v, 0);
      if (total <= 0) return prev;
      const norm = {};
      Object.entries(next).forEach(([k, v]) => { norm[k] = v / total; });
      return norm;
    });
  }, [setMixTargets]);

  return (
    <div className="pc-section">
      <div className="pc-label">
        Unit Mix
        <button onClick={handleToggle} className={`pc-toggle-btn ${isCustom ? 'pc-toggle-btn--on' : ''}`}>
          {isCustom ? 'Custom ✓' : 'Auto'}
        </button>
      </div>
      {isCustom && mixTargets && (
        <div className="pc-mix-list">
          {TYPOLOGIES.map(t => {
            const pct = Math.round((mixTargets[t.id] ?? 0) * 100);
            const bedColor = BED_COLORS[t.beds] || '#e8e4da';
            return (
              <div key={t.id} className="pc-mix-row">
                <div className="pc-mix-dot" style={{ background: bedColor }} />
                <span className="pc-mix-label">{t.label}</span>
                <input type="range" min="0" max="100" value={pct}
                  onChange={e => handleSlider(t.id, +e.target.value / 100)}
                  style={{ flex: 1, accentColor: bedColor, height: '3px' }} />
                <span className="pc-mix-pct" style={{ color: bedColor }}>{pct}%</span>
              </div>
            );
          })}
          <div className="pc-mix-note">Sliders auto-normalise to 100%</div>
        </div>
      )}
    </div>
  );
}

// ─── Solar controls ───────────────────────────────────────────────
// Dragging the slider updates the visible handle/label instantly (local
// state), but only commits to the real `solarAzimuth` prop — which triggers
// a full masterplan regeneration — after the user pauses for a beat. Without
// this, every pixel of drag re-ran the placement algorithm, making the
// slider feel like it was dragging through wet cement.
function SolarPanel({ solarAzimuth, setSolarAzimuth, showSolar, setShowSolar }) {
  const [liveAzimuth, setLiveAzimuth] = useState(solarAzimuth);
  const commitTimer = useRef(null);

  useEffect(() => { setLiveAzimuth(solarAzimuth); }, [solarAzimuth]);
  useEffect(() => () => clearTimeout(commitTimer.current), []);

  const dirLabel = az => {
    if (az < 22.5 || az >= 337.5) return 'N';
    if (az < 67.5)  return 'NE';
    if (az < 112.5) return 'E';
    if (az < 157.5) return 'SE';
    if (az < 202.5) return 'S';
    if (az < 247.5) return 'SW';
    if (az < 292.5) return 'W';
    return 'NW';
  };

  const handleChange = (e) => {
    const v = +e.target.value;
    setLiveAzimuth(v);
    clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(() => setSolarAzimuth(v), 120);
  };
  const handleCommit = (e) => {
    clearTimeout(commitTimer.current);
    setSolarAzimuth(+e.target.value);
  };

  return (
    <div className="pc-section">
      <div className="pc-label">
        Solar Orientation
        <button onClick={() => setShowSolar(s => !s)} className={`pc-toggle-btn ${showSolar ? 'pc-toggle-btn--solar' : ''}`}>
          {showSolar ? 'Heatmap ☀' : 'Heatmap'}
        </button>
      </div>
      <div className="pc-solar-row">
        <span className="pc-solar-dir-label">Sun</span>
        <input type="range" min="0" max="359" value={liveAzimuth}
          onChange={handleChange}
          onMouseUp={handleCommit}
          onTouchEnd={handleCommit}
          onKeyUp={handleCommit}
          style={{ flex: 1, accentColor: '#f0ece2', height: '3px' }} />
        <span className="pc-solar-dir-val">{dirLabel(liveAzimuth)}</span>
      </div>
      <div className="pc-mix-note">{liveAzimuth}° — glazing faces this direction</div>
    </div>
  );
}

// Preload all GLBs so the viewer opens instantly
['/ROOM1.glb','/ROOM2.glb','/ROOM3.glb','/ROOM4.glb',
 '/ROOM5.glb','/ROOM6.glb','/ROOM7.glb','/ROOM8.glb'].forEach(p => useGLTF.preload(p));

// ─── Single GLB room — uplifted materials, centred on XZ ─────────
// Base clone is keyed only on scene (i.e. glbPath) — never re-cloned on selection change.
// Selection state is applied as a separate transparent overlay box, not by mutating materials.

// ─── Compact furniture catalogue for the room viewer ─────────────
const FURN_CATALOGUE = [
  { category: 'Beds', color: '#c8a870', items: [
    { id: 'bed-single', label: 'Single Bed',   w: 0.90, d: 2.0, color: '#c8b89a' },
    { id: 'bed-double', label: 'Double Bed',   w: 1.40, d: 2.0, color: '#d0c0a0' },
    { id: 'bed-queen',  label: 'Queen Bed',    w: 1.60, d: 2.0, color: '#b8a888' },
    { id: 'bed-king',   label: 'King Bed',     w: 1.80, d: 2.1, color: '#c0b090' },
  ]},
  { category: 'Sofas', color: '#808088', items: [
    { id: 'sofa-2',    label: '2-Seat Sofa',   w: 1.40, d: 0.85, color: '#808088' },
    { id: 'sofa-3',    label: '3-Seat Sofa',   w: 2.00, d: 0.90, color: '#7a7068' },
    { id: 'sofa-l',    label: 'L-Shape Sofa',  w: 2.40, d: 1.60, color: '#6a6058' },
    { id: 'armchair',  label: 'Armchair',      w: 0.80, d: 0.80, color: '#8a8888' },
  ]},
  { category: 'Dining', color: '#9a8878', items: [
    { id: 'tbl-d4',     label: 'Table 4P',     w: 1.40, d: 0.90, color: '#9a8878' },
    { id: 'tbl-d6',     label: 'Table 6P',     w: 1.80, d: 0.90, color: '#8a7868' },
    { id: 'tbl-d8',     label: 'Table 8P',     w: 2.40, d: 1.00, color: '#7a6858' },
    { id: 'bench',      label: 'Bench',        w: 1.40, d: 0.38, color: '#9a8878' },
  ]},
  { category: 'Tables', color: '#b89868', items: [
    { id: 'tbl-coffee', label: 'Coffee Table', w: 1.10, d: 0.55, color: '#9a8878' },
    { id: 'tbl-side',   label: 'Side Table',   w: 0.50, d: 0.50, color: '#b8a898' },
    { id: 'desk',       label: 'Work Desk',    w: 1.20, d: 0.60, color: '#b0a090' },
    { id: 'desk-lg',    label: 'Large Desk',   w: 1.60, d: 0.70, color: '#a09080' },
  ]},
  { category: 'Storage', color: '#a09080', items: [
    { id: 'wardrobe-2d', label: 'Wardrobe 2D', w: 1.20, d: 0.60, color: '#b0a898' },
    { id: 'wardrobe-3d', label: 'Wardrobe 3D', w: 1.80, d: 0.60, color: '#a89888' },
    { id: 'bookshelf',   label: 'Bookshelf',   w: 0.90, d: 0.30, color: '#a89880' },
    { id: 'tv-unit',     label: 'TV Unit',     w: 1.60, d: 0.42, color: '#808088' },
  ]},
  { category: 'Kitchen', color: '#707878', items: [
    { id: 'kit-counter', label: 'Counter',     w: 2.40, d: 0.60, color: '#c8c0b0' },
    { id: 'kit-island',  label: 'Island',      w: 1.60, d: 0.90, color: '#d0c8b8' },
    { id: 'fridge',      label: 'Fridge',      w: 0.70, d: 0.70, color: '#c0c0c8' },
    { id: 'washing-m',   label: 'Washer',      w: 0.60, d: 0.60, color: '#a8a8b0' },
  ]},
  { category: 'Bathroom', color: '#88a0b0', items: [
    { id: 'bathtub',     label: 'Bathtub',     w: 1.70, d: 0.75, color: '#d8e8f0' },
    { id: 'shower',      label: 'Shower',      w: 0.90, d: 0.90, color: '#c0d8e8' },
    { id: 'wc',          label: 'WC',          w: 0.40, d: 0.70, color: '#e0e8f0' },
    { id: 'vanity',      label: 'Vanity',      w: 1.20, d: 0.50, color: '#d8d4cc' },
  ]},
];

// ─── Single placed furniture piece in the 3D scene ────────────────
function FurniturePiece({ piece, onDelete }) {
  const [hovered, setHovered] = useState(false);
  const H = 0.48;
  return (
    <group position={[piece.x, H / 2 + 0.01, piece.z]}>
      <mesh
        castShadow
        onClick={e => { e.stopPropagation(); onDelete(piece.uid); }}
        onPointerOver={e => { e.stopPropagation(); setHovered(true); document.body.style.cursor = 'pointer'; }}
        onPointerOut={e => { e.stopPropagation(); setHovered(false); document.body.style.cursor = 'auto'; }}
      >
        <boxGeometry args={[piece.w, H, piece.d]} />
        <meshStandardMaterial
          color={hovered ? '#ff4444' : piece.color}
          roughness={0.55} metalness={0.05}
          emissive={new THREE.Color(hovered ? '#ff1111' : piece.color)}
          emissiveIntensity={hovered ? 0.35 : 0.08}
          transparent opacity={hovered ? 0.85 : 1}
        />
      </mesh>
      {/* Top face outline so it reads clearly against the floor */}
      <lineSegments position={[0, H / 2 + 0.005, 0]}>
        <edgesGeometry args={[new THREE.BoxGeometry(piece.w + 0.02, 0.01, piece.d + 0.02)]} />
        <lineBasicMaterial color={hovered ? '#ff6666' : '#ffffff'} transparent opacity={hovered ? 0.9 : 0.35} />
      </lineSegments>
      {/* Label floating above */}
      <Text
        position={[0, H / 2 + 0.28, 0]}
        fontSize={0.18}
        color={hovered ? '#ff8888' : '#ffffff'}
        anchorX="center" anchorY="middle"
        renderOrder={10}
        depthOffset={-1}
      >
        {piece.label}
      </Text>
      {hovered && (
        <Text
          position={[0, H / 2 + 0.52, 0]}
          fontSize={0.14}
          color="#ff6666"
          anchorX="center" anchorY="middle"
          renderOrder={10}
          depthOffset={-1}
        >
          click to remove
        </Text>
      )}
    </group>
  );
}

// ─── Drop target raycaster — converts canvas drop coords → world XZ ─
function DropHandler({ floorY, roomW, roomD, onDrop, draggedRef }) {
  const { camera, gl } = useThree();
  const floorPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), -floorY), [floorY]);
  const raycaster  = useMemo(() => new THREE.Raycaster(), []);
  const target     = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    const canvas = gl.domElement;
    const handleDrop = e => {
      if (!draggedRef.current) return;
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width)  * 2 - 1;
      const ny = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
      raycaster.setFromCamera({ x: nx, y: ny }, camera);
      if (raycaster.ray.intersectPlane(floorPlane, target)) {
        const hw = roomW / 2, hd = roomD / 2;
        const x = Math.max(-hw + draggedRef.current.w / 2, Math.min(hw - draggedRef.current.w / 2, target.x));
        const z = Math.max(-hd + draggedRef.current.d / 2, Math.min(hd - draggedRef.current.d / 2, target.z));
        onDrop({ ...draggedRef.current, x, z, uid: Math.random().toString(36).slice(2) });
      }
      draggedRef.current = null;
    };
    const handleDragOver = e => e.preventDefault();
    canvas.addEventListener('drop', handleDrop);
    canvas.addEventListener('dragover', handleDragOver);
    return () => { canvas.removeEventListener('drop', handleDrop); canvas.removeEventListener('dragover', handleDragOver); };
  }, [camera, gl, floorPlane, raycaster, target, onDrop, draggedRef, roomW, roomD]);

  return null;
}

// ─── Single-floor room viewer (just the selected floor's GLB) ─────
function SingleRoomFloor({ glbPath, W, D }) {
  const { scene } = useGLTF(glbPath);
  const obj = useMemo(() => {
    const c = scene.clone(true);
    const box = new THREE.Box3().setFromObject(c);
    const cx = (box.min.x + box.max.x) / 2;
    const cz = (box.min.z + box.max.z) / 2;
    c.position.set(-cx, 0, -cz);
    c.traverse(n => {
      if (!n.isMesh) return;
      const src = Array.isArray(n.material) ? n.material[0] : n.material;
      const m = src.clone();
      // Boost brightness so furniture/walls read clearly
      m.roughness    = Math.min(m.roughness ?? 0.8, 0.55);
      m.metalness    = Math.max(m.metalness ?? 0.0, 0.08);
      m.envMapIntensity = 2.4;
      if (m.color) m.color.multiplyScalar(1.45);
      if (m.map)   { m.map.anisotropy = 16; m.map.needsUpdate = true; }
      n.material = m;
      n.castShadow = true;
      n.receiveShadow = true;
    });
    return c;
  }, [scene]);

  // Invisible floor plane for drop detection
  return (
    <group>
      <primitive object={obj} />
      {/* Floor plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]} receiveShadow>
        <planeGeometry args={[W, D]} />
        <meshStandardMaterial color="#1a1820" roughness={0.95} metalness={0.02} />
      </mesh>
    </group>
  );
}

function GLBViewer({ unit, onClose }) {
  const typo = TYPOLOGY_MAP[unit.typologyId];
  const W = typo.gridX * 3;
  const D = typo.gridZ * 3;

  const [placedFurniture, setPlacedFurniture] = useState([]);
  const [activeCat, setActiveCat] = useState(0);
  const draggedRef = useRef(null);

  const handleDrop = useCallback(piece => {
    setPlacedFurniture(prev => [...prev, piece]);
  }, []);

  const handleDelete = useCallback(uid => {
    setPlacedFurniture(prev => prev.filter(p => p.uid !== uid));
  }, []);

  return (
    <div className="pc-glb-overlay" onClick={onClose}>
      {/* ── Header ── */}
      <div className="pc-glb-header" onClick={e => e.stopPropagation()}>
        <div>
          <div className="pc-glb-title">{typo.label} — Floor {unit.floor + 1}</div>
          <div className="pc-glb-subtitle">
            {unit.areaM2} m² · {unit.beds} bed{unit.beds > 1 ? 's' : ''} · {W.toFixed(1)} × {D.toFixed(1)} m
            {placedFurniture.length > 0 && (
              <span style={{ marginLeft: '0.8rem', color: '#e8e4da' }}>
                {placedFurniture.length} item{placedFurniture.length > 1 ? 's' : ''} placed
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {placedFurniture.length > 0 && (
            <button onClick={e => { e.stopPropagation(); setPlacedFurniture([]); }} style={{
              fontSize: '0.62rem', background: 'rgba(255,60,60,0.12)',
              border: '1px solid rgba(255,60,60,0.35)', color: '#ff6666',
              borderRadius: '4px', padding: '0.15rem 0.5rem', cursor: 'pointer',
            }}>Clear All</button>
          )}
          <button className="pc-glb-close" onClick={onClose}>✕</button>
        </div>
      </div>

      {/* ── Body: catalogue left + canvas right ── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }} onClick={e => e.stopPropagation()}>

        {/* Furniture catalogue panel */}
        <div style={{
          width: '200px', flexShrink: 0,
          background: 'rgba(8,8,14,0.97)', borderRight: '1px solid rgba(255,255,255,0.07)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          {/* Category tabs */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.2rem', padding: '0.5rem', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            {FURN_CATALOGUE.map((cat, i) => (
              <button key={cat.category} onClick={() => setActiveCat(i)} style={{
                fontSize: '0.60rem', padding: '0.15rem 0.4rem', borderRadius: '3px', cursor: 'pointer',
                background: activeCat === i ? cat.color + '33' : 'transparent',
                border: `1px solid ${activeCat === i ? cat.color : 'rgba(255,255,255,0.12)'}`,
                color: activeCat === i ? cat.color : 'rgba(255,255,255,0.45)',
                fontWeight: activeCat === i ? 700 : 400,
              }}>{cat.category}</button>
            ))}
          </div>

          {/* Drag hint */}
          <div style={{ padding: '0.4rem 0.6rem', fontSize: '0.58rem', color: 'rgba(255,255,255,0.28)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            Drag items onto the floor plan
          </div>

          {/* Item list */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '0.3rem 0.4rem' }}>
            {FURN_CATALOGUE[activeCat].items.map(item => (
              <div
                key={item.id}
                draggable
                onDragStart={() => { draggedRef.current = item; }}
                onDragEnd={() => {}}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.4rem',
                  padding: '0.32rem 0.4rem', marginBottom: '0.18rem',
                  borderRadius: '5px', cursor: 'grab',
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.07)',
                  userSelect: 'none',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
              >
                <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: item.color, flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.82)', fontWeight: 500 }}>{item.label}</div>
                  <div style={{ fontSize: '0.57rem', color: 'rgba(255,255,255,0.32)' }}>{item.w}×{item.d} m</div>
                </div>
              </div>
            ))}
          </div>

          {/* Placed list */}
          {placedFurniture.length > 0 && (
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', padding: '0.4rem 0.5rem' }}>
              <div style={{ fontSize: '0.60rem', color: 'rgba(255,255,255,0.35)', marginBottom: '0.3rem' }}>Placed ({placedFurniture.length})</div>
              <div style={{ maxHeight: '120px', overflowY: 'auto' }}>
                {placedFurniture.map(p => (
                  <div key={p.uid} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.18rem 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <div style={{ width: '7px', height: '7px', borderRadius: '2px', background: p.color, flexShrink: 0 }} />
                      <span style={{ fontSize: '0.60rem', color: 'rgba(255,255,255,0.6)' }}>{p.label}</span>
                    </div>
                    <button onClick={() => handleDelete(p.uid)} style={{
                      background: 'none', border: 'none', color: 'rgba(255,80,80,0.7)',
                      cursor: 'pointer', fontSize: '0.70rem', padding: '0 0.1rem',
                    }}>×</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 3D canvas */}
        <div className="pc-glb-canvas" style={{ flex: 1, position: 'relative' }}>
          <Canvas
            camera={{ position: [W * 1.8, W * 1.4, D * 2.2], fov: 45 }}
            gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.3, powerPreference: 'high-performance' }}
            shadows
            dpr={[1, 2]}
          >
            <color attach="background" args={['#0d0d14']} />

            {/* Bright key light — makes room details pop */}
            <directionalLight position={[W * 1.2, 8, D * 1.5]} intensity={2.4} castShadow
              shadow-mapSize-width={2048} shadow-mapSize-height={2048}
              shadow-camera-near={0.5} shadow-camera-far={60}
              shadow-camera-left={-W * 1.5} shadow-camera-right={W * 1.5}
              shadow-camera-top={D * 1.5} shadow-camera-bottom={-D * 1.5}
            />
            <directionalLight position={[-W, 6, -D]} intensity={0.6} color="#9ab4ff" />
            <pointLight position={[0, 3.5, 0]} intensity={1.2} color="#ffeedd" distance={20} />
            <ambientLight intensity={0.7} />

            <RoomEnv />
            <Suspense fallback={null}>
              <SingleRoomFloor glbPath={typo.glb} W={W} D={D} />
              {placedFurniture.map(p => (
                <FurniturePiece key={p.uid} piece={p} onDelete={handleDelete} />
              ))}
              <ContactShadows
                position={[0, 0.01, 0]}
                opacity={0.55} scale={Math.max(W, D) * 2}
                blur={1.8} far={6}
              />
            </Suspense>

            <DropHandler
              floorY={0.01}
              roomW={W} roomD={D}
              onDrop={handleDrop}
              draggedRef={draggedRef}
            />

            <OrbitControls
              target={[0, 1.5, 0]}
              dampingFactor={0.08}
              minDistance={2} maxDistance={Math.max(W, D) * 3.5}
              makeDefault
            />

            <EffectComposer>
              <Bloom luminanceThreshold={0.80} luminanceSmoothing={0.5} intensity={0.12} mipmapBlur />
              <Vignette eskil={false} offset={0.25} darkness={0.4} />
              <ToneMapping />
            </EffectComposer>
          </Canvas>

          {/* Instruction overlay */}
          {placedFurniture.length === 0 && (
            <div style={{
              position: 'absolute', bottom: '1.2rem', left: '50%', transform: 'translateX(-50%)',
              background: 'rgba(8,8,14,0.85)', backdropFilter: 'blur(8px)',
              border: '1px solid rgba(255,255,255,0.12)', borderRadius: '6px',
              padding: '0.4rem 0.8rem', fontSize: '0.62rem', color: 'rgba(255,255,255,0.5)',
              pointerEvents: 'none', whiteSpace: 'nowrap',
            }}>
              Drag items from the left panel onto the floor · Click placed items to remove
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main sidebar ─────────────────────────────────────────────────
export default function PlanControls({
  seed, setSeed,
  plan,
  selectedUnit,
  stage,
  onConfirmDesign,
  filterTypology,
  setFilterTypology,
  hoverTypology,
  setHoverTypology,
  onOpenConfigurator,
  onBack,
  mixTargets,
  setMixTargets,
  solarAzimuth,
  setSolarAzimuth,
  showSolar,
  setShowSolar,
  concept,
  setConcept,
}) {
  // Count how many units of each typology exist in the plan
  const typoCounts = useMemo(() => {
    if (!plan) return {};
    const counts = {};
    plan.buildings.forEach(b => b.units.forEach(u => {
      counts[u.typologyId] = (counts[u.typologyId] || 0) + 1;
    }));
    return counts;
  }, [plan]);

  // Floor distribution per typology (for hover tooltip)
  const typoFloorRanges = useMemo(() => {
    if (!plan) return {};
    const ranges = {};
    plan.buildings.forEach(b => b.units.forEach(u => {
      if (!ranges[u.typologyId]) ranges[u.typologyId] = { min: u.floor, max: u.floor };
      else {
        if (u.floor < ranges[u.typologyId].min) ranges[u.typologyId].min = u.floor;
        if (u.floor > ranges[u.typologyId].max) ranges[u.typologyId].max = u.floor;
      }
    }));
    return ranges;
  }, [plan]);

  const stats = plan ? [
    { label: 'Total Units', value: plan.totalUnits },
    { label: 'Retail / Civic GF', value: `${(plan.groundFloorAreaM2 ?? 0).toLocaleString()} m²` },
    { label: 'Green Space', value: `${plan.greenPercent}%` },
    { label: 'Towers', value: plan.buildings.filter(b => b.type === 'tower').length },
    { label: 'Low-rise', value: plan.buildings.filter(b => b.type === 'lowrise').length },
    { label: 'Floors', value: `${plan.floors.min}–${plan.floors.max}` },
    { label: 'Roads', value: `${plan.roads?.length ?? 0} cells` },
  ] : [];

  return (
    <>
      <div className="plan-controls">
        <button className="pc-back" onClick={onBack}>← Change Site</button>

        {stage === 'boxes' && (
          <div className="pc-section">
            <div className="pc-label">
              Design Seed <span>#{seed}</span>
            </div>
            {plan && (
              <div className="pc-concept-tag">{plan.conceptLabel}</div>
            )}
            <select
              value={concept ?? ''}
              onChange={e => setConcept(e.target.value || null)}
              className="pc-slider"
              style={{ width: '100%', marginTop: '0.4rem', padding: '0.3rem 0.4rem',
                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)',
                color: '#e8e4da', borderRadius: '4px', fontSize: '0.68rem', cursor: 'pointer' }}
            >
              <option value="">Auto (by seed)</option>
              {CONCEPTS.map(c => (
                <option key={c} value={c}>{CONCEPT_LABELS[c]}</option>
              ))}
            </select>
            <input
              type="range" min="1" max="100"
              value={seed}
              onChange={e => setSeed(+e.target.value)}
              className="pc-slider"
            />
            <div className="pc-iter-buttons" style={{ marginTop: '0.55rem' }}>
              <button onClick={() => setSeed(s => Math.max(1, s - 1))}>Prev</button>
              <button onClick={() => setSeed(1 + Math.floor(Math.random() * 100))}>Random</button>
              <button onClick={() => setSeed(s => Math.min(100, s + 1))}>Next</button>
            </div>
          </div>
        )}

        {plan && (
          <div className="pc-section">
            <div className="pc-label">Site Stats</div>
            <div className="pc-stats">
              {stats.map(s => (
                <div key={s.label} className="pc-stat">
                  <span className="pc-stat-val">{s.value}</span>
                  <span className="pc-stat-key">{s.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {stage === 'boxes' && (
          <UnitMixPanel mixTargets={mixTargets} setMixTargets={setMixTargets} />
        )}

        {stage === 'boxes' && (
          <SolarPanel
            solarAzimuth={solarAzimuth} setSolarAzimuth={setSolarAzimuth}
            showSolar={showSolar} setShowSolar={setShowSolar}
          />
        )}

        {plan && (
          <div className="pc-section">
            <div className="pc-label">
              Room Types
              {filterTypology && (
                <button onClick={() => setFilterTypology(null)}
                  style={{ marginLeft: '0.5rem', fontSize: '0.62rem', background: 'none', border: '1px solid rgba(232,228,218,0.4)', color: '#e8e4da', borderRadius: '4px', padding: '0.1rem 0.4rem', cursor: 'pointer' }}>
                  Clear
                </button>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              {TYPOLOGIES.map(t => {
                const count = typoCounts[t.id] || 0;
                const active = filterTypology === t.id;
                const isHovered = hoverTypology === t.id;
                const bedColor = BED_COLORS[t.beds] || '#e8e4da';
                const flRange = typoFloorRanges[t.id];
                return (
                  <div key={t.id} style={{ position: 'relative' }}>
                    <button
                      onClick={() => setFilterTypology(active ? null : t.id)}
                      onMouseEnter={() => setHoverTypology?.(t.id)}
                      onMouseLeave={() => setHoverTypology?.(null)}
                      style={{
                        width: '100%',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        background: active ? `${bedColor}18` : isHovered ? `${bedColor}10` : 'rgba(255,255,255,0.03)',
                        border: active ? `1px solid ${bedColor}` : isHovered ? `1px solid ${bedColor}66` : '1px solid rgba(255,255,255,0.07)',
                        borderRadius: '6px', padding: '0.36rem 0.6rem',
                        cursor: 'pointer', transition: 'all 0.13s',
                      }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: bedColor, flexShrink: 0 }} />
                        <span style={{ fontSize: '0.72rem', color: active ? bedColor : 'rgba(255,255,255,0.75)', fontWeight: active || isHovered ? 700 : 400 }}>
                          {t.label}
                        </span>
                        <span style={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.3)' }}>
                          {t.areaM2}m²
                        </span>
                      </div>
                      <span style={{ fontSize: '0.68rem', color: active || isHovered ? bedColor : 'rgba(255,255,255,0.4)', fontWeight: 600, minWidth: '1.8rem', textAlign: 'right' }}>
                        ×{count}
                      </span>
                    </button>
                    {isHovered && flRange && (
                      <div style={{
                        position: 'absolute', right: 0, top: '110%', zIndex: 100,
                        background: 'rgba(8,8,14,0.96)', backdropFilter: 'blur(12px)',
                        border: `1px solid ${bedColor}44`,
                        borderRadius: '6px', padding: '0.5rem 0.7rem',
                        fontSize: '0.68rem', color: 'rgba(255,255,255,0.8)',
                        whiteSpace: 'nowrap', pointerEvents: 'none',
                        boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
                      }}>
                        <div style={{ color: bedColor, fontWeight: 700, marginBottom: '0.25rem' }}>{t.label} · {t.areaM2} m²</div>
                        <div>{count} units · floors {flRange.min + 1}–{flRange.max + 1}</div>
                        <div style={{ color: 'rgba(255,255,255,0.4)', marginTop: '0.2rem' }}>
                          {active ? '← click to deselect' : '← click to isolate in 3D'}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {stage === 'boxes' && plan && (
          <div className="pc-section">
            <button className="pc-select-btn" style={{ width: '100%' }} onClick={onConfirmDesign}>
              Render Community in 3D →
            </button>
            <div className="pc-hint" style={{ marginTop: '0.6rem' }}>
              <div className="pc-hint-icon">↑</div>
              <div>Drag the seed to explore 100 unique designs, then render with real room geometry.</div>
            </div>
          </div>
        )}

        {stage === 'glb' && (
          selectedUnit ? (
            <div className="pc-selected">
              <div className="pc-selected-header">Selected Unit</div>
              <div className="pc-selected-id">{TYPOLOGY_MAP[selectedUnit.typologyId]?.label ?? selectedUnit.typologyId}</div>
              <div className="pc-selected-detail">Floor {selectedUnit.floor + 1} · {selectedUnit.areaM2} m²</div>
              <div className="pc-selected-detail">{selectedUnit.beds} bedroom{selectedUnit.beds > 1 ? 's' : ''}</div>
              <div className="pc-btn-row">
                <button className="pc-select-btn" onClick={() => {
                  localStorage.setItem('planner_selected_unit', JSON.stringify(selectedUnit));
                  onOpenConfigurator(selectedUnit);
                }}>
                  Configure This Unit →
                </button>
              </div>
            </div>
          ) : (
            <div className="pc-hint">
              <div className="pc-hint-icon">↑</div>
              <div>Click any unit in the community to select it and view its room in 3D.</div>
            </div>
          )
        )}
      </div>

    </>
  );
}
