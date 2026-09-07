# Surface — the brief

Read this first. `CLAUDE.md` is the dense reference; this is the story, the goals, and how the pieces fit, written for
a session that has never seen the repo. Keep it current when the shape of the app changes.

## 1. What Surface is

Surface is a desktop show-control console for live-event video graphics, built for the way Darian runs televised boxing
cards (DAZN broadcasts — Las Vegas, Glendale AZ) and made show-agnostic underneath so press conferences, weigh-ins and
later other event types are just "packs".

It sits between three things that today are glued together by hand:

1. **The promoter's paperwork** — bout sheets, timing sheets and TV running orders that arrive as PDFs and change
   several times before fight night.
2. **The promoter's graphics** — hundreds of pre-rendered PNG/MOV/MP4 files with inconsistent names (1a/1b, last names,
   bout numbers in either direction), rendered at whatever size they felt like, delivered days or hours before doors.
3. **The playback engine and its trigger surface** — Resolume Arena or disguise on the video PC, Bitfocus Companion on
   Stream Decks, with screens defined in PixelGrid (MantaGlow's PixelMapper).

Surface reads (1), ingests (2), and either builds (3) or replaces it. The operator's view of all of this is one screen:
the **Card Board** — rows are the event and the bouts in running order, columns are the graphics a bout needs
(walkouts, fighter v fighter, rounds, winner, holds, VTs), each cell a thumbnail of the real file with one square per
screen saying ready / will convert / missing. In Prepare mode the board is a checklist; in Run mode every cell is a GO
button.

It is part of the **MantaGlow** suite (mantaglow.com): ShowCall (run of show), PixelMapper / PixelGrid (LED screen
design), Time Tracker (the UI reference). Surface is downloadable and works offline; the MantaGlow account is used for
project sync and for pulling screens straight from PixelGrid.

## 2. Goals, in priority order

1. **Make fight week faster and less error-prone than doing it by hand.** The measure of every feature is "does the
   operator have less to organise?" — not feature count. Darian rejected the first UI (five tabs, slot tables) for
   exactly this reason; the Card Board replaced it.
2. **Never guess silently.** Sheets are parsed, files are matched, screens are auto-routed — and every inference lands
   in `review.flags` as something to confirm. The bout sheet is the authority; files are evidence.
3. **Speak every engine's real language.** Resolume REST, disguise cue tables / transport API, Companion page files with
   the module's actual action ids. Verified facts live in `CLAUDE.md` → "Engine facts"; do not invent endpoints.
4. **Look like MantaGlow, not like an AI made it.** General Sans, warm-neutral OKLCH palette, amber primary, glass
   panels, light + dark. Time Tracker is the reference. No condensed/display fonts, no purple gradients, no emoji as
   section markers.
5. **Grow into the playback itself.** Surface already decodes HAP natively and can open pixel-exact output windows on
   the PC's displays; the roadmap (`docs/PLAYER.md`) is to render the show without Resolume for the venues where that
   is simpler. Eventually: a physical console as intuitive as a lighting or audio desk.

Non-goals: not a web app (Electron desktop, server in-process); not a template/graphics generator (promoter media is
the norm, templates are the fallback); no dynamic audio processing (level matching is one static gain per clip).

## 3. Where things are

| what | where |
|---|---|
| Source of truth (git) | `D:\AI\surface` on darian-pc (no GitHub remote yet; intended `dharmon96/surface`) |
| CLI | `cli/surface.ts` (`npm run cli -- parse|merge|cues|build|intake`) |
| Sibling repos on the PC | `D:\AI\web` (MantaGlow site: `seed-apps` surface entry, `/apps/surface` page), `D:\AI\darian-infra` (droplet deploy; Caddy `surface.mantaglow.com` → GitHub release installers), `D:\AI\showcall`, `D:\AI\pixel-mapper-v2` |
| Example deliveries | `D:\AI\examples` (103 GB, git-ignored as `examples/`); surveyed in `fixtures/examples-survey/` |
| Sheet fixtures | `fixtures/text/*.txt` (pdftotext output), `fixtures/2026-06-13-glendale.bout.json` |
| App data at runtime | `%APPDATA%/Surface` (Electron userData): `projects/<id>/show.json`, `index.json`, `active.json`, `hub.json`, `surface.config.json`, `surface-thumbs/`, `surface-proxies/` |
| Docs | `CLAUDE.md` (reference), `docs/BRIEF.md` (this), `docs/HUB.md` (account + sync), `docs/PLAYER.md` (playback roadmap), `docs/VISION.md` (UX + console roadmap), `docs/card-board-mockup.html` |
| Published artifacts (Claude) | "BoutKit Build Plan" v3, Card Board mockup, "Surface Player" plan |

Run it: `npm install` (on the OS you run on — a Linux-VM install breaks Windows), `npm run build`, `npm run app`.
Dev: `npm run server -- --data ~/.surface` + `npm run dev` (Vite on :3009 proxies `/api` to :8090), or `npm run app:dev`.
Tests: `npm test` (vitest, ~80 tests, needs ffmpeg on PATH; tesseract optional). Typecheck: `npm run typecheck` (server)
and `npm run typecheck:ui`.

## 4. The show document

Everything is one JSON file per project, `ShowDoc` (`core/types.ts`, schema `surface/2.0`). Parsers write it, humans
approve it, generators and the runner read it. Never make a generator read a source PDF.

- `event` — id, name, date, venue.
- `screens[]` — physical rasters from PixelGrid: stable `id` (baked into file names, never renamed after intake), `name`,
  `w`, `h`, `testPattern` (PixelGrid's native render, under `<mediaRoot>/_TEST/`), `venue` (metres + rotation for the
  Venue view).
- `surfaces[]` — screens that always show the same thing (IMAG L + R). `independent: true` (host booth, LED tables,
  scale panels) is never hit by scope `ALL`.
- `routing` — graphic type → surfaces. `autoRouting` picks by area (biggest wall = main); the Screens drawer shows the
  choice on to-scale tiles with the screens' test patterns.
- `data` — pack data: `bouts[]` with fighters (stable ids), sides (red/blue), rounds, titles, timing.
- `review` — `status` draft/approved and `flags[]` (everything inferred).
- `build.resolumeLayout` — `per-screen` (a layer group per surface, scoped cues connect only their groups) or
  `together` (one SHOW group where every column fires everything, plus a ROUNDS group for overlays).
- `media` — slot → file relative to `mediaRoot`; filled by conversion and test-pattern import; every derived cue
  carries the file, so engine builds point at converted media.
- `outputs[]` — `OutputCanvas`: the rasters the PC sends to LED processors (PixelGrid canvases or one per screen), each
  with screens at canvas positions, a display assignment and a fit rule.
- `audio` — the show's loudness standard (`targetLufs` −18, `ceilingDbTp` −1, `levelMatch`, `masterDb`).
- `versions[]` — every sheet version merged in, with the diff.

**Slot names** are the contract between intake, cues and engines: `{GROUP}_{GRAPHIC}[_{VARIANT}]_{SCREEN}_{W}x{H}`,
e.g. `B03_WALK_RED_MAIN_LED_3840x1080`, `EVT_HOLD_SPONSOR_RIBBON_7680x216`, `EVT_TEST_IMAG_L_1920x1080`.

**Cues** (`Cue`): `n` (== Resolume column, stable once published — never renumber), `id` like `B08.R01`, `scope`
(surfaces or ALL), per-surface layer actions on `BASE` / `OVERLAY` / `FULL`, behaviour (`loop`, `playHold` for VTs and
winner stings, `timed` for round cards, `playToMarker` for the weigh-in scale), `transition` (cut / fade / stinger /
dve), `follow`. The last cue is always `EVT.TEST` — every screen's own test pattern (all three packs; custom cues are
inserted before it). Once a composition is built, cue numbers are pinned (`doc.build.cueNumbers`) — a later sheet change
never repoints published columns; new cues take the next free ones.

**Packs** derive cues from `data`: `boxing-fightnight` (holds, up-next, walkouts, tale, rounds, winner, flags, VTs),
`boxing-fightweek` (press conference: LED tables carry one fighter each; weigh-in: scale surface plays to a marker).
Numbering per pack is fixed and documented in each file's header.

## 5. How the systems work

### Parsers — `core/parse/`
`pdftotext -layout` text in, `ShowDoc` out. `detectKind` picks timing sheet / bout sheet / TV rundown. Timing sheets
give walk / first bell / final bell per bout and the corner side from the column header; bout sheets list the main
event first (running order reversed, flagged); rundowns are sliced by page geometry and their VT / GFX rows become
custom cue candidates. `geo.ts` turns hometowns into ISO countries with confidence. `mergeSheets` merges a later
version by fighter name / red-blue pair, keeps fighter ids, and returns the human diff kept in `doc.versions`.

### Media intake — `core/intake/`
Files → slots, never the other way round.
- `tokens.ts`: every path level is evidence — kind words, bout + side (`3a`), round numbers, screen words, written
  resolutions, fighter names; `_Updates` wins, archive folders are ignored.
- `scheme.ts`: resolves the promoter's numbering for the whole delivery (1 = opener or main; a = red or blue) from
  files that name a fighter; unknown → operator confirms.
- `match.ts`: a screen is assigned from exact pixels, a known screen word, or the same aspect within 1 % (promoters
  render bigger than asked) — never guessed; identical screens all take the one file; event-wide round cards fill every
  bout; one per-fighter graphic fills both walkout and fighter card.
- `ocr.ts`: optional — ffmpeg samples 4 frames, tesseract reads them, words fold into the evidence.
- `transcode.ts` + `execute.ts`: ffmpeg plans as data, then executed: DXV for Resolume (needs ffmpeg ≥ 7.1, else HAP Q),
  HAP for disguise, PNG stays; scale/letterbox to the slot; tile rasters wider than 16384; strip audio except walkouts
  and VTs; write `.part`, verify by decoding, then rename; `_manifest.json` makes re-runs skip; originals deleted only
  when asked and only after verification.
- `loudness.ts`: EBU R128 measure (`ebur128=peak=true`) → one static gain to the show standard, capped by the true-peak
  ceiling, baked with `-af volume`. Deliberately not dynamic.
- Server: `POST /api/prepare {dir}` = intake + OCR + transcode in one go; progress over Socket.IO; `absorbManifest`
  writes `doc.media` and pre-warms preview proxies.

### Screens from PixelGrid — `core/integrations/pixelmapper.ts`
Two ways in. (a) Through the hub: `GET /api/hub/pixelgrid` lists the account's PixelGrid projects,
`POST /api/import/pixelmapper/hub {id}` pulls the project (`ProjectFile {metadata, data:{screens, screenGroups,
canvases, scene3d}}`), makes screens/surfaces/screen words, positions for the Venue view, `outputs` from its canvases,
and adopts the cached native renders as test patterns. (b) From exported screen-map PNGs
(`{Project}_{Screen}_{layout}_{W}x{H}.png`) dropped on the board or `POST /api/import/screenmaps {dir|files}`.

### Cue derivation and resolution — `core/index.ts`, `core/resolve.ts`
`deriveCues(doc, packId)` runs the pack, applies `doc.media`, and fills engine addresses: Resolume column + groups
(`resolumeAddress` honours the layout), disguise tags + transports, Companion page/row/col.

### Generators — `core/gen/`
Pure: `resolumePlan` (operation list `ResolumeOp[]` — groups, columns, clips, stinger columns), `disguiseCueTables`
(TSV per track; SHOW/ROUNDS in together mode), `companion` (page files v12 with `connectColumn` /
`connectLayerGroupColumn` actions, `generic-http` for Bridge mode), `cuesheet` (xlsx). `POST /api/bundle` writes them
all to a folder; `GET /api/board/request` writes the promoter request (what is missing, at what size).

### Runner and adapters — `core/engine/`
`Runner` is the show-time state machine: per-surface BASE/OVERLAY/FULL, scoped fire, timed reverts, follow-ons, panic
(clears OVERLAY + FULL, keeps BASE), Companion variables. Adapters implement `EngineAdapter`: `MockAdapter`,
`ResolumeAdapter` (REST connect of a column composition-wide or per layer group; `build(plan)` executes a
`resolumePlan` live), `DisguiseAdapter` (REST `gototag` per transport, OSC fallback), `CompanionAdapter` (pushes
variables). Engines are chosen and tested in the Engines drawer (`GET/PUT /api/engines`, `POST /api/engines/test`),
adapters swap live, settings persist to `surface.config.json`.

### Server — `server/`
Express + Socket.IO in one process (`server/index.ts`), started by Electron with `--data <userData>`.
- Show + cues: `GET /api/show|doc|cues|state|variables|health`, `PUT /api/doc`, `POST /api/review/approve`.
- Board: `GET /api/board` (`server/board.ts` builds rows/cells/slots with ready / convert / missing), `GET /api/thumb`.
- Sheets: `POST /api/sheet` (first sheet or merge), `GET /api/versions`.
- Media: `POST /api/prepare`, `POST /api/intake`, `POST /api/transcode`, `GET /api/manifest|media|proxy`.
- Screens/outputs: `POST /api/import/screenmaps`, `/api/import/pixelmapper[/hub]`, `GET /api/hub/pixelgrid`,
  `GET/PUT /api/outputs`, `GET /api/outputs/:id`, `POST /api/outputs/signal`, `GET /api/venue`.
- Engines/build: `GET/PUT /api/engines`, `POST /api/engines/test`, `POST /api/build/resolume`, `POST /api/bundle`.
- Run (also the Bridge API Companion's generic-http buttons call): `POST /api/cue/:n/go`, `/api/next`, `/api/prev`,
  `/api/panic`, `/api/text/:key`, `/api/media/ended`; `GET /api/clock` = the clip clock (remaining time of every
  non-looping clip on the walls; `clock.html` renders it — its own window from the Run bar, or a laptop on the venue
  network when the server runs with `--bind 0.0.0.0`). Socket events: `state`, `fired`, `revert`, `error`, `show`,
  `transcode`, `proxy`, `build`, `output`.
- Projects + hub: `server/projects.ts` (`ProjectStore`), `GET /api/hub/status`, `POST /api/hub/token|signout`,
  `GET/POST /api/projects`, `/api/projects/import|sample|sync`, `/api/projects/:id/open`, `DELETE /api/projects/:id`.
- `server/proxy.ts`: browsers cannot play HAP/DXV/NotchLC/ProRes, so previews are cached H.264 ≤960 px proxies (VP9
  webm with alpha); 202 while building, `building:` URL prefix in the UI. Note Playwright's Chromium has no H.264 —
  proxy playback only verifies in Electron.

### Hub + projects — `docs/HUB.md`
Offline-first. Projects live under the data dir; the open project is the live show. Sign-in opens mantaglow.com in an
Electron window, the main process reads the Better Auth cookie (token = part before the dot), hands it to the server
which verifies it and keeps it in `hub.json`; requests carry `x-hub-session-token`. Data API is
`/api/data/<app-slug>/<key>` (`surface` for projects, `pixel` for PixelGrid). Sync is explicit, last-write-wins on
`updatedAt`, conflicts saved beside the project; never syncs during a show. The hub must seed Surface as an app
(`hasOffline: true`) — snippet in `docs/HUB.md`; `D:\AI\web` already has the seed entry and marketing page, and
`darian-infra` deploys it.

### UI — `src/`
React + Vite + zustand, plain CSS tokens (`src/styles.css`). `App.tsx` = header (brand · show name → Projects ·
Prepare | Run · "N to confirm" · engine pill · Setup ▾) and one drawer at a time over the Board. `Board.tsx` = the
app: start panel on an empty card, checklist rail, drop zone, cells, rounds, run bar (Test patterns, Venue off / side /
bigger). Drawers: Projects (`Hub.tsx`), Card (`Review.tsx`), Screens & routing (`Screens.tsx`), Outputs (`Outputs.tsx`),
Engines (`Engines.tsx`), Cue list, Media tools. `Venue.tsx` mirrors what every screen shows on the LED map, Plan (2D,
metres) or 3D (three.js). `output.tsx` is a second Vite entry for the output windows. No lingering popups anywhere —
selection goes to the rail, Esc clears.

### Desktop shell — `electron/`
`main.cjs` starts the server in-process (`ELECTRON_RUN_AS_NODE`), serves `dist/`, owns hub sign-in (cookie access),
PDF reading (`pdftotext`), folder picking, and the output windows: `list-displays`, `open-output` (frameless kiosk on a
display, `force-device-scale-factor=1`, no background throttling), `close-output`. `preload.cjs` exposes
`window.surface.*`. Packaging: electron-builder → `release/`, GitHub Actions `release.yml` on `v*` tags,
`surface.mantaglow.com/download/win|mac` redirects to the installers.

### Player — `player/`, `docs/PLAYER.md`
The GPU-native path for Play mode: `Movie` reads only a MOV's index (mp4box) and fetches samples by byte range;
`decodeHapFrame` turns a HAP sample (Hap / Alpha / Q / Q Alpha / R; none / snappy / chunked) into DXT block buffers for
`compressedTexImage2D`. Tested against ffmpeg's own decode. Not yet wired into the output windows.

## 6. Conventions that matter

- Core is pure TypeScript (data in, data out); I/O only in `core/intake` (ffmpeg/ffprobe/tesseract), `core/gen/cuesheet`
  (exceljs), `core/index.ts` `buildBundle`, the network adapters/hub client (injectable fetch), and `server/`.
  Everything is unit-testable and shared by CLI, desktop and hub.
- Generators emit operation lists; adapters execute or serialise them, so a card change is a diff.
- Cue numbers and screen ids are stable once published. Fighter ids never change across sheet versions.
- Every inference is a flag. Confirmations are cheap; wrong graphics on a wall are not.
- UI copy is the operator's language (walkout, tale, holds), not the system's (slot, adapter).
- Verify engine behaviour against module source or docs before adding an action or endpoint; record it under
  "Engine facts" in `CLAUDE.md`.
- Sessions now work directly in `D:\AI\surface` on the PC (the old tarball sync ritual is retired). Tell Darian when
  `package.json` changed so he runs `npm install` on Windows.

## 7. Status and what is next (Sep 2026)

Done: parsers + merge; intake/matching/OCR/transcode with level matching; fight-night and fight-week packs; Resolume /
disguise / Companion generators and adapters in both layouts; Bridge server; Card Board with Prepare/Run, checklist,
Screens drawer (PixelGrid + screen maps, test patterns, routing tiles), Engines drawer, Venue view (2D/3D), preview
proxies, Outputs drawer + kiosk output windows with Identify; hub account + project sync; Electron packaging + CI;
HAP decoder + MOV demux; ~80 tests green.

Waiting on Darian: `npm install; npm run build; npm run app` on the PC; create the GitHub repo and tag `v0.1.0`; push
`web` and `darian-infra`; DNS for `surface.mantaglow.com`; a real Resolume box for the live build test; the promised
Resolume fight-night example.

Next (see `docs/PLAYER.md`): WebGL HAP renderer in the output page, `PlayerAdapter` + master clock, Play-mode HAP
conversion target, Web Audio chain with meters, Stream Deck direct, MIDI fader bank → console. Smaller: level-match
controls in the UI, generic winner graphic shared across bouts, 1920 sponsor loop → IMAG holds.
