import { EffectComposer, N8AO, Bloom, SMAA, Vignette, DepthOfField, GodRays } from '@react-three/postprocessing';

/**
 * Shared cinematic postprocessing stack for the configurator's hero canvases.
 *
 * Tuned for architectural-viz, not games: the goal is "expensive render", not
 * "effect demo". Everything here is deliberately restrained —
 *
 *   N8AO     – high-quality ambient occlusion. Grounds geometry in contact
 *              shadows so slabs/columns read as solid mass, not floating cards.
 *   Bloom    – luminance-gated, only the brightest speculars (polished column
 *              edges, glass) glow. High threshold keeps walls matte.
 *   SMAA     – clean subpixel edges without the cost of MSAA on a heavy scene.
 *   Vignette – barely-there falloff to draw the eye to the unit centre.
 *
 * Works under frameloop="demand": the composer only runs on invalidation, so a
 * static unit costs nothing once settled.
 */
export default function CinematicFX({
  ao = true,
  aoIntensity = 1.4,
  aoRadius = 1.1,
  aoQuality = 'low',      // 'low' | 'medium' | 'high' | 'ultra' — N8AO sample count
  aoHalfRes = true,       // half-res AO pass: ~half the per-frame cost, ~identical look
  bloomIntensity = 0.28,
  bloomThreshold = 0.95,
  vignette = 0.28,
  // Optional cinematic depth-of-field. Off by default so every existing caller
  // is unaffected; opt in (e.g. the "View Your Home" hero) for a soft-focus,
  // premium look. focusDistance/focalLength/bokeh are normalised 0..1-ish.
  dof = false,
  dofFocusDistance = 0.012,
  dofFocalLength = 0.025,
  dofBokeh = 2.4,
  // Volumetric god-rays — light shafts cutting across the room from a bright
  // "sun" mesh (a disc placed outside the window, along the key light's
  // direction). Off by default; pass a Mesh ref to turn it on. This is what
  // actually sells "archviz interior" in a still — Lumion/Enscape/Corona all
  // lean on the same trick of visible volumetric light through openings.
  sun = null,
  sunDensity = 0.85,
  sunDecay = 0.93,
  sunWeight = 0.6,
  sunExposure = 0.35,
}) {
  return (
    <EffectComposer enableNormalPass multisampling={0}>
      {sun ? (
        <GodRays
          sun={sun}
          samples={60}
          density={sunDensity}
          decay={sunDecay}
          weight={sunWeight}
          exposure={sunExposure}
          clampMax={1}
          blur
        />
      ) : <></>}
      {ao ? (
        <N8AO
          aoRadius={aoRadius}
          intensity={aoIntensity}
          distanceFalloff={1.0}
          quality={aoQuality}
          color="black"
          halfRes={aoHalfRes}
        />
      ) : <></>}
      {dof ? (
        <DepthOfField
          focusDistance={dofFocusDistance}
          focalLength={dofFocalLength}
          bokehScale={dofBokeh}
        />
      ) : <></>}
      <Bloom
        intensity={bloomIntensity}
        luminanceThreshold={bloomThreshold}
        luminanceSmoothing={0.18}
        mipmapBlur
      />
      <Vignette eskil={false} offset={0.32} darkness={vignette} />
      <SMAA />
    </EffectComposer>
  );
}
