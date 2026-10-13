# 3-Step Masterplan Demo

Standalone copy of the 3-step flow:

1. **Pick a site** — `src/planner/SitePicker.jsx` (map of real London brownfield sites)
2. **Explore massing** — `src/planner/MasterplanViewer.jsx` (stage `boxes`) + `src/planner/PlanControls.jsx`
3. **Render in 3D** — `src/planner/MasterplanViewer.jsx` (stage `glb`), click a unit to inspect it

All wired together in `src/ThreeStepDemo.jsx`.

## Run it

```bash
npm install
npm run dev
```

Opens at http://localhost:5300

## Files

```
index.html
src/
  main.jsx                    entry point
  ThreeStepDemo.jsx           wires the 3 steps together
  App.css                     layout styles
  index.css                   design tokens / fonts
  planner/
    SitePicker.jsx / .css     step 1
    useBrownfieldData.js      loads public/brownfield_london.geojson
    masterplanGenerator.js    pure algorithmic massing generator (no React/Three)
    MasterplanViewer.jsx      steps 2 & 3 (3D scene)
    PlanControls.jsx / .css   steps 2 & 3 (sidebar)
  shared/
    RoomEnv.jsx               shared 3D environment lighting
public/
  brownfield_london.geojson   site boundary data
  ROOM1.glb ... ROOM8.glb     room geometry per typology
  favicon.svg
```
