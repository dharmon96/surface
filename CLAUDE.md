# BoutKit — Show-Control Console for Live-Event Graphics

Takes a show's data (first pack: a boxing bout sheet) and produces a screen-aware cue list, then builds Resolume Arena
compositions, disguise tracks and Bitfocus Companion pages from it — or runs the cues itself. Independent desktop app;
links to ShowCall (run of show) and PixelMapper (screens) but does not depend on MantaGlow to run.

Plan and research: see the "BoutKit Build Plan" artifact (Claude) — v3, 7 Sep 2026.

## Tech Stack (matches ShowCall / PixelMapper conventions)

- **Core**: pure TypeScript in `core/` — no I/O except `core/gen/cuesheet.ts` (exceljs) and `core/intake` (ffprobe). Everything else is data in / data out so it can be unit-tested and reused by the CLI, the desktop app and MantaGlow.
- **CLI**: `cli/boutkit.ts` via tsx. **Tests**: vitest (`npm test`). **Typecheck**: `npm run typecheck`.
- Planned: `src/` React + Vite + TS UI (Radix, Tailwind, zustand), `server/` Express + Socket.IO for engine adapters and the Bridge API, Electron shell. Same single-package layout as ShowCall.

## Core model (`core/types.ts`)

- **Screen** (id, w, h) ← PixelMapper `Screen` (pixel size = panelsX·panel.w × panelsY·panel.h). **Surface** = screens that always show the same content; `independent: true` surfaces (host booth, LED tables, scale panels) are never hit by scope `ALL`.
- **Layers per surface**: `BASE` (loops underneath), `OVERLAY` (over the base, *cleared* not re-cued), `FULL` (covers all while it runs).
- **Behaviour** on media: `loop` · `playHold` (VTs, winner stings) · `playToMarker` (weigh-in scale) · `timed` (round card: N s then revert to base).
- **Cue**: `n` (== Resolume column, stable once published), `id` like `B08.R01`, `scope` (surfaces or `ALL`), per-surface `targets` of layer actions, optional `transition` (`cut|fade|stinger|dve`), `follow`, engine addresses filled by `core/resolve.ts`.
- **Pack**: derives cues from `doc.data`. `core/packs/boxing-fightnight.ts` is the first. Numbering there is FIXED — see the header comment; never renumber published cues.
- **Slot/asset name**: `{GROUP}_{GRAPHIC}[_{VARIANT}]_{SCREEN}_{W}x{H}`.

## Engine facts (verified Sep 2026)

- Resolume Arena 7.8+ REST/WebSocket on :8080 (`/api/v1`): `layergroups/add`, `columns/add`, `grow-to`, rename via `PUT {"name":{"value":..}}`, `clips/{n}/open` with `file:///` or `source:///video/Text Block`, `composition/save`. Active deck only; cannot set Advanced Output (venue template). Scoped cue = `POST /composition/layergroups/{g}/columns/{n}/connect`.
- disguise: REST transport API r23.2+ (`gototag`, `gotosection`), Python execute `POST /api/session/python/execute` r30.7+ Pro, cue-table TSV import in Track Editor everywhere, OSC `/d3/showcontrol/cue`. One transport per surface for scoped cues.
- Companion 5.0.4: no page-creation API — import generated `version: 12` page files via Buttons tab; `POST /api/location/{p}/{r}/{c}/style` restyles legacy buttons. Modules: `resolume-arena` (`connectColumn`), `disguise-osc` (`cue` int), `generic-http` for Bridge mode.

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
- `transcode.ts`: matched file → engine media under the slot name as ffmpeg argv (data). DXV for Resolume, HAP for disguise, PNG stays; scale/letterbox to the slot; tile rasters wider than 16384 px; strip stray audio except walkouts/VTs; originals deleted only after verification (flag).
- Real deliveries surveyed in `fixtures/examples-survey/` (`tests/fixtures-deliveries.ts` rebuilds both packages); the media itself lives in `examples/` (git-ignored, 103 GB).

## Conventions

- Never make a generator read a source document; parsers write `ShowDoc`, humans approve (`review.status`), generators read.
- Generators emit operation lists (`ResolumeOp[]`) — adapters execute or serialise them. Keep them pure so a card change is a diff.
- Promoter-supplied media is the norm; templates are the fallback. Intake maps files to slots (`core/intake`), never the other way round.
