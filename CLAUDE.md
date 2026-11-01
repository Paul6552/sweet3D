# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Sweet3D is a browser-only web version of Sweet Home 3D: no server, no login, no backend. Projects live in IndexedDB and are imported/exported as `.sh3d` files compatible with the desktop app (5.3+). Stack: Vite + React 19 + TypeScript (strict), MUI, TanStack Router, zustand + immer, Konva (2D plan), react-three-fiber (3D), fflate (ZIP), idb.

## Commands

```bash
npm run dev        # http://localhost:5173 (strictPort); predev regenerates catalog + packs if inputs changed
npm run build      # tsc -b && vite build -> dist/ (prebuild also runs catalog + packs)
npm run lint       # oxlint (config: .oxlintrc.json)
npm test           # vitest run
npx vitest run src/model/roofs.test.ts      # single test file
npx vitest run -t "newBasementLevel"        # tests matching a name
npm run catalog    # rebuild public/catalog from vendor/sh3d/*.jar
npm run packs      # force-rebuild public/packs (downloads into vendor/packs-cache; --offline supported)
docker compose up -d --build                # nginx on http://localhost:8180
```

Tests are colocated (`*.test.ts`) and cover pure model/geometry code (levels, roofs, straight skeleton, wall geometry); there are no component tests.

## Conventions

- Code comments, test names and UI-facing default strings are **German**.
- All commit messages (subject and body) must be in **English**, without exception — even though older commits in the history are German. Subjects use an `Area: description` style (e.g. `Roof: dormers`, `Levels: basements below the terrain`).
- Commit directly on `main` and push to `origin main` after committing; no feature branches or pull requests.
- All UI text goes through i18next; add keys to **both** `src/i18n/de.ts` and `src/i18n/en.ts` (they mirror each other).
- Model units follow `com.eteks.sweethome3d.model`: lengths in **cm**, angles in **radians**, so `.sh3d` import/export maps 1:1. Keep new fields round-trippable through `src/io/sh3dImport.ts` / `sh3dExport.ts` where Sweet Home 3D has an equivalent.

## Architecture

### Data model and commands (`src/model/`)
- `home.ts` defines the `Home` document (walls, rooms, roofs, furniture, dimension lines, labels, levels, compass, camera). Every item carries a `level` id.
- All mutations are `HomeCommand`s (`commands.ts`) — **plain serializable data**, applied by `applyCommand(draft, command)` on an immer draft. `batch` groups commands into one undo step. Never mutate `home` elsewhere; add a new command type instead.
- Heavy geometry lives here as pure functions: `roofs.ts` + `roofSkeleton.ts` (weighted straight skeleton with edge profiles, dormers, skylights), `levels.ts` (level ordering, the special roof level that follows the top storey, basements with negative elevation), `clipping.ts` (polygon-clipping wrapper).

### Leader/follower sync and undo (`src/sync/`, `src/store/editorStore.ts`)
- Any panel (catalog, furniture list, plan, 3D view) can be detached into its own browser window (route `/editor/$projectId/panel/$panelId?leader=…`).
- The main editor window is the **leader** (`leader.ts`): it executes every `EditorAction`, runs `produceWithPatches`, keeps the undo/redo history (patch/inverse pairs, max 200), autosaves, and broadcasts immer patches over a `BroadcastChannel`.
- Detached windows are **followers** (`follower.ts`): they get a snapshot, then apply patches; their `dispatch` forwards actions to the leader. Leader liveness is detected via a Web Lock (`navigator.locks`).
- Components always go through `dispatch(...)` / `executeCommand(...)` from `editorStore.ts`, which is wired to whichever role the window has. Camera and level selection are actions without undo steps.

### Persistence (`src/storage/`, `src/model/contents.ts`)
- IndexedDB stores: `projects` (summaries + thumbnail), `homes` (the `Home` JSON without binaries), `contents` (imported models/images as Blobs), `libraries` (imported furniture/texture libraries).
- Binary references in the model are strings `content:<key>`; multi-file models use `<id>/<file>` keys so relative MTL references resolve. `localStorage` is only for small settings.

### Catalog (`src/catalog/`, `src/api/catalog.ts`, `scripts/`)
- `scripts/build-catalog.mjs` extracts the default furniture/texture catalog from the GPL Sweet Home 3D JARs in `vendor/sh3d/` into static files in `public/catalog`. `scripts/build-packs.mjs` builds extra libraries (Poly Haven glTF → OBJ/MTL with PBR extensions, SH3D free models) into `public/packs`, configured by `scripts/catalog-packs.json`. Both skip work when outputs are newer than inputs.
- `src/catalog/sh3fParser.ts` parses `.sh3f`/`.sh3t` libraries and is shared between the Node build scripts and the browser (keep it free of DOM/Node-only APIs).

### Views
- `src/plan/`: Konva 2D editor — `PlanCanvas`/`PlanRenderer`, `hitTest.ts`, `magnetism.ts` (snapping), `wallEditing.ts` (mitered joints), `roomDetection.ts`; transient tool state in `planStore.ts`.
- `src/view3d/`: r3f scene built from the `Home` — `wallGeometry.ts` (openings for doors/windows), `roofGeometry.ts`, `staircases.ts` (stairs cut floor/ceiling openings), `groundHoles.ts` (basements), `materials.ts`/`modelLoader.ts`, and lighting (`sun.ts` NOAA sun position from compass + date/time, `sky.ts`, `indoorLight.ts` per-level light maps so enclosed rooms get light only through windows/lights, `eyeAdaptation.ts`, `brightRooms.ts` for the “Räume immer hell” mode).
- Photo mode (`PhotoDialog.tsx`, `pathTracerShader.ts`) uses three-gpu-pathtracer with a trimmed custom shader compiled once with final defines and adaptive tile size, to avoid GPU resets on weak (Mesa/Intel) drivers. Multi-material meshes are split per material group for the path tracer. Keep the photo look consistent with the realtime 3D view when changing lighting/materials.
- Upper levels and ceilings hidden in the view still cast shadows via a separate shadow-only camera layer.

### Editor shell (`src/editor/`, `src/dialogs/`, `src/projects/`)
- `EditorPage` hosts resizable panels (`panels.tsx`, `layoutStore.ts`), autosave, shortcuts and clipboard. Property dialogs are opened through `dialogs/dialogStore.ts` and rendered by `DialogHost`.

## Deployment / licensing notes

- `dist/` is a static site; the server must fall back to `index.html` for `/editor/...` paths (see `nginx.conf`, `vercel.json`).
- `vendor/sh3d` and the generated `public/catalog` are GPL-2.0+; `public/packs` keep their own licenses (see `NOTICE`); the rest is MIT.
