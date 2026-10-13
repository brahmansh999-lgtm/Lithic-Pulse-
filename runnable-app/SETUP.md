# Running this on a new machine

This is a full, runnable copy of the app — enough to get from the landing
page through Site selection → Zoning → Massing → Columns → Masterplanner
(the same flow as the source machine), plus the full Configurator.

## Setup

```
npm install
npm run dev
```

Then open the printed local URL (defaults to http://localhost:5200).

## Notes

- **`node_modules` is not included** — `npm install` rebuilds it from
  `package.json` / `package-lock.json` (same locked versions as the source
  machine, so behavior should match).
- **`.env` is not included** (it's gitignored on the source machine and may
  hold private API keys). Copy `.env.example` to `.env` and fill in a
  `GEMINI_API_KEY` ONLY if you want the optional AI-render feature — the
  Site→Masterplanner pipeline itself does not need it.
- **`public/BLDGS/orig` was intentionally excluded** — it's ~369MB of unused
  backup GLBs not referenced by the running app. The 4 real building models
  the app actually loads (`glbsmall.glb`, `glbmedium.glb`, `glblarge.glb`,
  `glbXL.glb`, plus `programme_*.json`/`massing.json`) ARE included under
  `public/BLDGS/`.
- Everything else under `public/` (furniture, room GLBs, textures, DXF/geojson
  site files, HDRI) is included as-is.

## Pipeline entry points

- Full app: land on the landing page, pick a role (Architect/Developer),
  pick a site → Zoning → Massing → Columns → Masterplanner → "View your
  individual home" → Configurator.
- Dev shortcut: `http://localhost:5200/?configurator` jumps straight into
  the Configurator, skipping the whole pipeline.
