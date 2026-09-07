# Surface — Show-Control Console for Live-Event Graphics

Takes a show's data (first pack: a boxing bout sheet) and produces a screen-aware cue list, then builds Resolume Arena
compositions, disguise tracks and Bitfocus Companion pages from it — or runs the cues itself. Independent desktop app;
links to ShowCall (run of show) and PixelMapper (screens) but does not depend on MantaGlow to run.

Plan and research: see the "BoutKit Build Plan" artifact (Claude) — v3, 7 Sep 2026.

## Tech Stack (matches ShowCall / PixelMapper conventions)

- **Core**: pure TypeScript in `core/` — no I/O except `core/gen/cuesheet.ts` (exceljs) and `core/intake` (ffprobe). Everything else is data in / data out so it can be unit-tested and reused by the CLI, the desktop app and MantaGlow.
- **CLI**: `cli/boutkit.ts` via tsx. **Tests**: vitest (`npm test`). **Typecheck**: `npm run typecheck`.
- **UI**: `src/` React + Vite + TS (zustand, socket.io-client, plain CSS tokens in `src/styles.css` — the MantaGlow house style: General Sans, warm-neutral OKLCH palette, amber primary, glass panels, 1rem radii, light + dark; Time Tracker is the reference, no condensed/display fonts). **The Card Board is the app** (`src/pages/Board.tsx`, `server/board.ts`): rows = EVENT + bouts in running order, columns = the graphics a bout needs, each cell a thumbnail of the real file with one square per screen (ready / will convert / missing). Prepare mode: drop the promoter's folder (`POST /api/prepare` = intake + OCR + transcode in one go), drop a newer sheet (`POST /api/sheet` merges, keeps `doc.versions`), copy the promoter request (`GET /api/board/request`), Build Resolume live (`POST /api/build/resolume` → `ResolumeAdapter.build`). Run mode: the same grid, every cell/round is a GO button, live bout row highlighted; Space/Backspace/Esc. Clicking a cell selects it and its per-screen detail shows in the rail (one at a time, Esc clears — no popovers). Drawers: Projects (Hub), Card (Review), **Screens** (`src/pages/Screens.tsx`: screens with stable ids, labels, sizes, grouping into surfaces, independent flag, "also called" words for the matcher, routing matrix graphic×surface with "Auto by resolution", paste-import from PixelGrid), Cues, Media (advanced intake), Engines (Health). Thumbnails: `GET /api/thumb?f=<abs>` (ffmpeg frame, cached in `<dataDir>/surface-thumbs`). Dev: `npm run server -- --data ~/.surface` + `npm run dev`.

## Core model (`core/types.ts`)

- **Screen** (id, w, h) ← PixelMapper `Screen` (pixel size = panelsX·panel.w × panelsY·panel.h). **Surface** = screens that always show the same content; `independent: true` surfaces (host booth, LED tables, scale panels) are never hit by scope `ALL`.
- **Layers per surface**: `BASE` (loops underneath), `OVERLAY` (over the base, *cleared* not re-cued), `FULL` (covers all while it runs).
- **Behaviour** on media: `loop` · `playHold` (VTs, winner stings) · `playToMarker` (weigh-in scale) · `timed` (round card: N s then revert to base).
- **Stinger** (`doc.stingers[]`, `doc.transitions` = default per graphic type, e.g. `{ WINNER: "stinger:whoosh" }`): broadcast's wipe — the runner fires the alpha animation over FULL on the in-scope surfaces, waits `coverSec`, then lands the cue (a hidden hard cut). Resolume: reserved columns after the cues hold the stinger in every group's FULL layer. DVE presets are typed but not executed yet.
- **Cue**: `n` (== Resolume column, stable once published), `id` like `B08.R01`, `scope` (surfaces or `ALL`), per-surface `targets` of layer actions, optional `transition` (`cut|fade|stinger|dve`), `follow`, engine addresses filled by `core/resolve.ts`.
- **Pack**: derives cues from `doc.data`. `core/packs/boxing-fightnight.ts` (d3 tags N.x), `core/packs/boxing-fightweek.ts` — Press Conference (100+N.x; LED `TABLE_*` surfaces carry one fighter each) and Weigh-in (200+N.x; `SCALE` surface plays the scale file to a marker and pauses). Numbering is FIXED — see header comments; never renumber published cues. Select with `deriveCues(doc, packId)`.
- **Slot/asset name**: `{GROUP}_{GRAPHIC}[_{VARIANT}]_{SCREEN}_{W}x{H}`.

## Engine facts (verified Sep 2026)

- Resolume Arena 7.8+ REST/WebSocket on :8080 (`/api/v1`): `layergroups/add`, `columns/add`, `grow-to`, rename via `PUT {"name":{"value":..}}`, `clips/{n}/open` with `file:///` or `source:///video/Text Block`, `composition/save`. Active deck only; cannot set Advanced Output (venue template). Scoped cue = `POST /composition/layergroups/{g}/columns/{n}/connect`.
- disguise: REST transport API r23.2+ (`gototag`, `gotosection`), Python execute `POST /api/session/python/execute` r30.7+ Pro, cue-table TSV import in Track Editor everywhere, OSC `/d3/showcontrol/cue`. One transport per surface for scoped cues.
- Companion 5.0.4: no page-creation API — import generated `version: 12` page files via Buttons tab; `POST /api/location/{p}/{r}/{c}/style` restyles legacy buttons. Modules: `resolume-arena` (`connectColumn` {lookupMode:byIndex, action:set, value}; `connectLayerGroupColumn` {layerGroup, action:set, value} — verified against the module source Sep 2026), `disguise-osc` (`cue` int), `generic-http` for Bridge mode.
- **Composition layout** (`doc.build.resolumeLayout`, `core/engine/adapter.ts` `resolumeAddress`/`resolumeGroupsFor`): `per-screen` = a layer group per surface, scoped cues connect only their groups (Companion presses one action per group); `together` = one SHOW group with a layer per surface where every column fires everything at once + a ROUNDS group for overlays (his last show ran this way). disguise follows the same switch (SHOW/ROUNDS tracks vs a track per group×surface). Chosen in the board's Build panel; `tests/layout.test.ts`.

## Commands

```bash
npm install
npm test
npm run cli -- parse fixtures/text/2026-06-13-glendale-timing.txt show.json
npm run cli -- merge show.json fixtures/text/2026-06-13-glendale-timing.txt   # later version → diff
npm run cli -- cues  show.json
npm run cli -- build fixtures/2026-06-13-glendale.bout.json out --mode bridge
npm run cli -- intake show.json examples/Fight\ Night --direction opener-first --a red   # read-only mapping + transcode plan
```

## Parsers (`core/parse/`)

- `detectKind` → `timing_sheet` | `bout_sheet` | `rundown`. Input is `pdftotext -layout` text (the CLI shells out to pdftotext for PDFs).
- `timing-sheet.ts`: bout blocks with Walk/First Bell/Final Bell/Walk Out/READY BY, stacked TITLE column, corner side and walk/intro order read from the column header, `DAZN FEED:` marks broadcast start.
- `bout-sheet.ts`: 4-line blocks (heading / names / hometowns / records); corner side ONLY from the RED/BLUE CORNER header; sheets list the main event first so running order is reversed (flagged).
- `rundown.ts`: TV running order; columns sliced by page geometry (gutters = cuts no word crosses, nearest the midpoint between header words). VT / FF GFX / MC rows become `origin: "rundown"` custom cue candidates.
- `geo.ts`: hometown → ISO country with confidence; men's weight-class limits for suggestions; record parser. Everything inferred goes to `review.flags`.
- `mergeSheets(base, incoming)`: later versions merge by fighter name / red-blue pair and return a human diff; fighter ids never change.

## Media intake (`core/intake/`)

- `tokens.ts`: every path level contributes evidence (kind words, bout+side `3a`, round numbers, screen words, written resolutions, names); archive/layered folders are ignored, `_Updates` wins. Folder-vs-file disagreements become `conflicts`.
- `scheme.ts`: resolves the promoter's numbering for the whole delivery (1 = opener or main; a = red or blue) from files that name a fighter; the sheet is the authority, files are evidence. Unknown → operator confirms (`override`).
- `match.ts`: files → slots. A screen is only ever assigned from pixels (probe) or a known venue screen word (`ScreenSynonyms`), never guessed. Event-wide round cards fill every bout's round slot; one per-fighter graphic fills both WALKOUT and FIGHTER when only one was delivered.
- `ocr.ts`: optional second pass — ffmpeg samples 4 frames (30/55/80/97 %; ultra-wide rasters chunked), tesseract reads them, words/round numbers fold into the tokeniser evidence (`applyOcr`). Server runs it only on unmatched / low-confidence files when `ocr: true`.
- `transcode.ts`: matched file → engine media under the slot name as ffmpeg argv (data). DXV for Resolume, HAP for disguise, PNG stays; scale/letterbox to the slot; tile rasters wider than 16384 px; strip stray audio except walkouts/VTs; originals deleted only after verification (flag).
- Real deliveries surveyed in `fixtures/examples-survey/` (`tests/fixtures-deliveries.ts` rebuilds both packages); the media itself lives in `examples/` (git-ignored, 103 GB).

## Engine + server (`core/engine/`, `server/`)

- `Runner` (`core/engine/runner.ts`): show-time state machine — per-surface BASE/OVERLAY/FULL, scoped fire, timed reverts (cancelled when something newer lands on that layer), follow-ons, panic (clears OVERLAY+FULL, keeps BASE), Companion variables. Pure logic; timers injectable.
- Adapters (`core/engine/adapters.ts`): `MockAdapter` (records), `ResolumeAdapter` (REST: composition column connect for ALL, per-layergroup connect for scoped cues, layer clear for reverts), `DisguiseAdapter` (REST `gototag` per in-scope transport; OSC `/d3/showcontrol/cue` fallback), `CompanionAdapter` (pushes variables as custom variables). Surface order = Resolume group order; 3 layers per group.
- `server/index.ts`: Express + Socket.IO. Bridge API the generated Companion pages call: `POST /api/cue/:n/go`, `/api/next`, `/api/prev`, `/api/panic`, `/api/text/:key`, `/api/media/ended`; `GET /api/state|cues|variables|health`. Config `surface.config.json` picks adapters (mock by default) — see `surface.config.example.json`. `npm run server -- show.json`.

## Transcode execution, bridges, desktop shell

- `core/intake/execute.ts`: runs the plan with ffmpeg, checks encoders once (no `dxv` → HAP Q; no `hap` → H.264, recorded as `fallback`), writes to `.part` then verifies (decodes, duration within 70 ms) before renaming; `_manifest.json` keyed by source size+mtime makes re-runs skip; originals deleted only with `deleteOriginals` and only after verify. Tiles and pads to 4-px alignment for GPU codecs. Server: `POST /api/transcode` (progress via Socket.IO `transcode`), `GET /api/transcode`.
- `core/integrations/showcall.ts`: `toShowCall` (section header per bout, Video-department instruction per cue, cue_number == Surface number) and `fromShowCall` (non-Surface cues → custom candidates). `core/integrations/pixelmapper.ts`: `fromPixelMapper` (PixelGrid Screen/ScreenGroup → Screen/Surface + seeded screen words; host/booth/table/scale names → independent) and `contentGuideRows`. Endpoints: `/api/export/showcall`, `/api/import/showcall`, `/api/import/pixelmapper`, `/api/content-guide`, `/api/bundle`.
- `electron/main.cjs`: starts the server in-process (`ELECTRON_RUN_AS_NODE`) with `--data <userData>`, serves `dist/` via `SURFACE_STATIC`; `preload.cjs` exposes `window.surface.{pickFolder, readSheet (pdftotext), hubSignIn, hubSignOut, openHub}`. `npm run app` (built UI) / `npm run app:dev` (Vite). Packaging: electron-builder (`npm run dist:win|mac`, output `release/`, prebuilt server in `dist-server/`); `.github/workflows/release.yml` builds and publishes installers on `v*` tags, `ci.yml` runs typecheck+tests. **Install node_modules on the OS you run on** — an install from the Linux VM leaves Linux-only esbuild/Electron binaries and no `.cmd` shims on Windows.

## Hub + projects (`server/projects.ts`, `core/hub/client.ts`, `src/pages/Hub.tsx`, `docs/HUB.md`)

- Offline-first: with `cfg.dataDir` the server keeps projects at `<dataDir>/projects/<id>/show.json` (+ `index.json`, `active.json`); the open project is the live show and every save goes to it. Without a data dir it is the old single-show server (tests use both).
- MantaGlow account: `HubClient` speaks the hub's existing desktop auth (`x-hub-session-token`) and per-app data API (`/api/data/surface/project:<id>`). Token comes from the Better Auth cookie in the Electron sign-in window (`tokenFromCookie`), is verified via `/api/hub/users/me` and kept in `<dataDir>/hub.json`. Endpoints: `GET /api/hub/status[?refresh]`, `POST /api/hub/token|signout`, `GET/POST /api/projects`, `POST /api/projects/import` (sheet text → new project), `POST /api/projects/:id/open`, `DELETE /api/projects/:id[?cloud=1]`, `POST /api/projects/sync`.
- Sync = explicit, last-write-wins per project on `updatedAt`; both-changed → ours wins, theirs saved as `show.conflict-<ts>.json`, state `conflict`. Never sync automatically during a show.
- The hub needs Surface seeded (`hasOffline: true`) and access granted — snippet in `docs/HUB.md`. `tests/hub.test.ts` runs a fake hub.

## Conventions

- Never make a generator read a source document; parsers write `ShowDoc`, humans approve (`review.status`), generators read.
- Generators emit operation lists (`ResolumeOp[]`) — adapters execute or serialise them. Keep them pure so a card change is a diff.
- Promoter-supplied media is the norm; templates are the fallback. Intake maps files to slots (`core/intake`), never the other way round.
