import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';

// Drop-in replacement for drei's <Environment preset="..."> that needs no
// network. drei's presets fetch an HDR from a public CDN; when that fetch is
// slow or unreachable the env texture is bound before its image data has
// arrived, which makes three log:
//   "THREE.WebGLRenderer: Texture marked for update but no image data found."
// A PMREM built from three's RoomEnvironment is generated entirely on the GPU,
// so it always carries valid image data and never touches the network.
//
// The texture is GPU-resident and tied to the renderer that created it, so we
// rebuild it whenever the renderer changes (a context loss or Canvas remount
// hands us a fresh `gl`) instead of reusing a dead-context texture.
//
// Optional `hdriUrl`: when supplied, an equirectangular HDRI (.hdr/.exr, or a
// regular jpg/png panorama) replaces the synthetic studio environment — used
// to give windows a real exterior (sky/skyline) to reflect and show, instead
// of always falling back to the procedural RoomEnvironment box.
export default function RoomEnv({ intensity = 1, hdriUrl = null, showBackground = false }) {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    let disposed = false;
    let rt = null;
    let rawTex = null;

    function applyEnv(sourceTex) {
      if (disposed) return;
      rawTex = sourceTex;
      rawTex.mapping = THREE.EquirectangularReflectionMapping;
      rt = pmrem.fromEquirectangular(rawTex);
      scene.environment = rt.texture;
      scene.environmentIntensity = intensity;
      if (showBackground) {
        scene.background = rawTex;
        scene.backgroundIntensity = intensity;
      }
      pmrem.dispose();
    }

    function loadSynthetic() {
      pmrem.compileEquirectangularShader();
      rt = pmrem.fromScene(new RoomEnvironment(), 0.04);
      if (!disposed) { scene.environment = rt.texture; scene.environmentIntensity = intensity; }
      pmrem.dispose();
    }

    if (hdriUrl) {
      // A dev-server SPA fallback (or any misconfigured static host) returns
      // 200 + index.html for a missing asset instead of a real 404, which
      // would otherwise reach the binary HDR/EXR parser and throw deep inside
      // three's loader instead of triggering our onError fallback. A real
      // HEAD/content-type check catches the "file doesn't exist yet" case
      // cleanly before that happens.
      fetch(hdriUrl, { method: 'HEAD' }).then(res => {
        if (disposed) return;
        const ct = res.headers.get('content-type') || '';
        if (!res.ok || ct.includes('text/html')) { loadSynthetic(); return; }
        const lower = hdriUrl.toLowerCase();
        const loader = lower.endsWith('.exr') ? new EXRLoader() : lower.endsWith('.hdr') ? new RGBELoader() : new THREE.TextureLoader();
        loader.load(hdriUrl, applyEnv, undefined, loadSynthetic);
      }).catch(loadSynthetic);
    } else {
      loadSynthetic();
    }

    return () => {
      disposed = true;
      if (rt) rt.texture.dispose();
      if (rawTex) rawTex.dispose();
      scene.environment = null;
      if (showBackground) scene.background = null;
    };
  }, [gl, scene, intensity, hdriUrl, showBackground]);
  return null;
}
