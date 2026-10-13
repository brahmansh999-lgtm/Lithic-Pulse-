import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import RoomEnv from '../shared/RoomEnv';
import CinematicFX from '../shared/CinematicFX';
import data from './data/typologies.json';
import { applyMaterials, centerScene } from './utils/materials';
import './TypeologySelector.css';

const { typologies } = data;

// ─── GLB Room viewer ─────────────────────────────────────────────────────────

function RoomModel({ glb }) {
  const { scene } = useGLTF(glb);
  const { camera, size, invalidate } = useThree();
  const pivotRef = useRef();

  // Static turntable angle baked in once per model — gives the same pleasant
  // three-quarter view the old per-frame spin settled toward, with zero
  // ongoing cost. A useFrame subscription here would force R3F to render
  // every frame forever, defeating frameloop="demand" (see RoomConfigurator.jsx).
  useEffect(() => {
    applyMaterials(scene, '#f0ece6');
    if (pivotRef.current) pivotRef.current.rotation.y = Math.PI * 0.18;

    const { size: sceneSize } = centerScene(scene);
    const maxDim = Math.max(sceneSize.x, sceneSize.y, sceneSize.z);
    const half   = maxDim * 0.82;
    const asp    = size.width / size.height;

    camera.left   = -half * asp;
    camera.right  =  half * asp;
    camera.top    =  half;
    camera.bottom = -half;
    camera.near   = -maxDim * 16;
    camera.far    =  maxDim * 16;

    const dir = new THREE.Vector3(1, 1.1, 1).normalize();
    camera.position.copy(dir).multiplyScalar(maxDim * 2);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    invalidate();
  }, [scene, glb, camera, size, invalidate]);

  return <group ref={pivotRef}><primitive object={scene} /></group>;
}

// ─── Main export ─────────────────────────────────────────────────────────────

export default function TypeologySelector({ onSelect, selected }) {
  const [current, setCurrent] = useState(selected || typologies[0]);

  const handleSelect = useCallback((t) => setCurrent(t), []);

  return (
    <div className="typo-root">
      <Canvas
        className="typo-canvas"
        orthographic
        camera={{ near: -10000, far: 10000 }}
        gl={{
          antialias: true,   // MSAA on geometry edges; SMAA in post adds sub-pixel cleanup
          powerPreference: 'high-performance',
          alpha: false,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.1,
          outputColorSpace: THREE.SRGBColorSpace,
        }}
        shadows="soft"
        dpr={Math.min(window.devicePixelRatio, 2)}
        frameloop="demand"
      >
        <color attach="background" args={['#08090b']} />
        <RoomEnv intensity={1.4} />

        <directionalLight
          position={[14, 24, 10]} intensity={3.0} color="#fff8f0"
          castShadow shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-40} shadow-camera-right={40}
          shadow-camera-top={40} shadow-camera-bottom={-40}
          shadow-bias={-0.0001} shadow-normalBias={0.012}
        />
        <directionalLight position={[-12, 16, -8]} intensity={1.0} color="#a0bce0" />
        <directionalLight position={[0,  -5,  4]}  intensity={0.50} color="#ffe8b0" />
        <directionalLight position={[0,   6, 24]}  intensity={0.40} color="#f4f6ff" />
        <ambientLight intensity={0.14} />

        <React.Suspense fallback={null}>
          <RoomModel key={current.glb} glb={current.glb} />
        </React.Suspense>

        <CinematicFX aoIntensity={0.9} aoQuality="high" bloomIntensity={0.26} vignette={0.22} />
      </Canvas>

      {/* Top-left: unit identity */}
      <div className="typo-identity" key={current.id + '-id'}>
        <div className="typo-identity-eyebrow">Unit Typology</div>
        <div className="typo-identity-label">{current.label}</div>
        <div className="typo-identity-sub">
          {current.beds} Bed &nbsp;·&nbsp; {current.persons} Person
        </div>
        {current.twoStorey && <div className="typo-identity-badge">Duplex</div>}
      </div>

      {/* Top-right: stats */}
      <div className="typo-stats" key={current.id + '-stats'}>
        <div className="typo-stat">
          <span className="typo-stat-val">{current.areaM2}</span>
          <span className="typo-stat-label">m² area</span>
        </div>
        <div className="typo-stat-sep" />
        <div className="typo-stat">
          <span className="typo-stat-val">{current.storageM3}</span>
          <span className="typo-stat-label">m³ storage</span>
        </div>
        <div className="typo-stat-sep" />
        <div className="typo-stat">
          <span className="typo-stat-val">{current.gridX}×{current.gridZ}</span>
          <span className="typo-stat-label">grid</span>
        </div>
      </div>

      {/* Bottom-left: description */}
      <div className="typo-desc" key={current.id + '-desc'}>
        <p className="typo-desc-text">{current.description}</p>
      </div>

      {/* Bottom-right: CTA */}
      <div className="typo-cta" key={current.id + '-cta'}>
        <button className="typo-cta-btn" onClick={() => onSelect(current)}>
          Configure Unit
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 7h8M8 4l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <span className="typo-cta-hint">Select from dock below</span>
      </div>

      {/* Bottom dock */}
      <div className="typo-dock">
        {typologies.map(t => (
          <button
            key={t.id}
            className={`typo-dock-item${current.id === t.id ? ' active' : ''}`}
            onClick={() => handleSelect(t)}
          >
            <div className="typo-dock-thumb">
              <div className="typo-dock-thumb-block" style={{ width: `${t.gridX * 8}px`, height: `${t.gridZ * 8}px` }} />
            </div>
            <span className="typo-dock-label">{t.label}</span>
            <span className="typo-dock-area">{t.areaM2} m²</span>
            {t.twoStorey && <span className="typo-dock-tag">2S</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

typologies.forEach(t => { if (t.glb) useGLTF.preload(t.glb); });
