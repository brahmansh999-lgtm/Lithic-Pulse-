import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

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
export default function RoomEnv({ intensity = 1 }) {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    pmrem.compileEquirectangularShader();
    const rt = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = rt.texture;
    scene.environmentIntensity = intensity;
    pmrem.dispose();
    return () => {
      rt.texture.dispose();
      scene.environment = null;
    };
  }, [gl, scene, intensity]);
  return null;
}
