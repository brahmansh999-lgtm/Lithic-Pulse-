import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

// Shared by both the Configure (furniture placement) view and the AI-render
// Hero view, so windows show the same exterior skyline in every screen
// instead of just a flat tinted glass void in some and a real backdrop in
// others. Clusters every mesh under a 'window'/'glass' named ancestor into
// distinct openings, then drops a flat skyline-textured plane just outside
// each one — you see it THROUGH the glass material, the same way a real
// window works optically. Runs once per mount (ready flip), not per frame.
export default function WindowSkylineBackdrop({ ready, roomBox = null, textureUrl = '/textures-opt/london_skyline_composite.jpg' }) {
  const { scene, invalidate } = useThree();
  const doneRef = useRef(false);
  useEffect(() => {
    if (!ready || doneRef.current) return;
    doneRef.current = true;

    const winMeshes = [];
    scene.traverse((n) => {
      if (!n.isMesh || !n.geometry) return;
      for (let p = n; p; p = p.parent) {
        const nm = (p.name || '').toLowerCase();
        if (nm.includes('window') || nm.includes('glass')) { winMeshes.push(n); break; }
        if (nm.includes('column')) break;
      }
    });
    if (winMeshes.length === 0) return;

    const roomCenter = new THREE.Vector3();
    if (roomBox) roomBox.getCenter(roomCenter);
    else {
      const b = new THREE.Box3().setFromObject(scene);
      if (!b.isEmpty()) b.getCenter(roomCenter);
    }

    const openings = [];
    const CLUSTER_R = 2.0;
    for (const m of winMeshes) {
      const b = new THREE.Box3().setFromObject(m);
      if (b.isEmpty()) continue;
      const c = b.getCenter(new THREE.Vector3());
      let cl = openings.find(o => o.center.distanceTo(c) < CLUSTER_R);
      if (!cl) { cl = { box: b.clone(), center: c }; openings.push(cl); }
      else { cl.box.union(b); cl.center = cl.box.getCenter(new THREE.Vector3()); }
    }

    // The source photo is mostly flat sky/ground — the skyline silhouette
    // only occupies a narrow band around its vertical centre. Cropping the
    // UV repeat/offset to that band keeps the skyline filling the opening
    // instead of reading as a flat grey colour.
    const backdropTex = new THREE.TextureLoader().load(textureUrl);
    backdropTex.colorSpace = THREE.SRGBColorSpace;
    backdropTex.repeat.set(1, 0.42);
    backdropTex.offset.set(0, 0.30);
    backdropTex.wrapT = THREE.ClampToEdgeWrapping;

    const backdrops = [];
    for (const op of openings) {
      const size = op.box.getSize(new THREE.Vector3());
      const center = op.box.getCenter(new THREE.Vector3());
      const outDir = new THREE.Vector3(center.x - roomCenter.x, 0, center.z - roomCenter.z);
      if (outDir.lengthSq() < 1e-6) outDir.set(0, 0, 1);
      outDir.normalize();
      const horiz = Math.max(size.x, size.z, 1.0);
      const w = horiz * 2.2;
      const h = Math.max(size.y, 1.0) * 2.2;
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ map: backdropTex, toneMapped: false, fog: false }),
      );
      plane.position.set(center.x + outDir.x * 4, center.y, center.z + outDir.z * 4);
      plane.lookAt(roomCenter.x, center.y, roomCenter.z);
      scene.add(plane);
      backdrops.push(plane);
    }

    invalidate();
    return () => {
      for (const p of backdrops) { scene.remove(p); p.geometry.dispose(); p.material.dispose(); }
      backdropTex.dispose();
    };
  }, [ready, scene, invalidate, roomBox, textureUrl]);

  return null;
}
