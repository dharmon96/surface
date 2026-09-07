# Surface — Show-Control Console for Live-Event Graphics

Takes a show's data (first pack: a boxing bout sheet) and produces a screen-aware cue list, then builds Resolume Arena
compositions, disguise tracks and Bitfocus Companion pages from it — or runs the cues itself. Independent desktop app;
links to ShowCall (run of show) and PixelMapper (screens) but does not depend on MantaGlow to run.

Plan and research: see the "BoutKit Build Plan" artifact in Claude (written before the rename) — v3, 7 Sep 2026.

## Tech Stack (matches ShowCall / PixelMapper conventions)

- **Core**: pure TypeScript in `core/` — no I/O except `core/gen/cuesheet.ts` (exceljs) and `core/intake` (ffprobe). Everything else is data in / data out so it can be unit-tested and reused by the CLI, the desktop app and MantaGlow.
- **CLI**: `cli/surface.ts` via tsx. **Tests**: vitest (`npm test`). **Typecheck**: `npm run typecheck`.
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
npm run cli -- cues  fixtures/2026-06-13-glendale.bout.json
npm run cli -- build fixtures/2026-06-13-glendale.bout.json out --mode bridge
```

## Conventions

- Never make a generator read a source document; parsers write `ShowDoc`, humans approve (`review.status`), generators read.
- Generators emit operation lists (`ResolumeOp[]`) — adapters execute or serialise them. Keep them pure so a card change is a diff.
- Promoter-supplied media is the norm; templates are the fallback. Intake maps files to slots (`core/intake`), never the other way round.
