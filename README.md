# Surface

Show-control console for live-event graphics, part of the [MantaGlow](https://mantaglow.com) suite. The promoter's
bout sheet goes in; a screen-aware cue list comes out — built into Resolume Arena, disguise and Bitfocus Companion,
or run by Surface itself. The operator's view is one screen: the **Card Board** — rows are the bouts in running
order, columns are the graphics each bout needs, every cell a thumbnail of the real delivered file with one square
per screen (ready / will convert / missing). In Prepare mode the board is a checklist; in Run mode every cell is a
GO button.

New to the repo? **Read `docs/BRIEF.md` first** — the story, the goals and how the systems fit. `CLAUDE.md` is the
dense reference (model, engine facts, conventions). `docs/HUB.md` covers the MantaGlow account + project sync;
`docs/PLAYER.md` is the playback roadmap.

## Run it

```bash
npm install        # on the OS you run on — a Linux-VM install breaks Windows
npm run build && npm run app          # the desktop app (Electron, server in-process)
npm run server -- --data ~/.surface   # dev: server on :8090…
npm run dev                           # …+ Vite on :3009 (proxies /api)
```

Tests: `npm test` (vitest, needs ffmpeg on PATH; tesseract optional). Typecheck: `npm run typecheck` and
`npm run typecheck:ui`.

## CLI

```bash
npm run cli -- parse fixtures/text/2026-06-13-glendale-timing.txt show.json
npm run cli -- cues  show.json
npm run cli -- build fixtures/2026-06-13-glendale.bout.json out --mode bridge
npm run cli -- intake show.json "path/to/delivery" --direction opener-first --a red
```

Fixture card: `fixtures/2026-06-13-glendale.bout.json` (Bam Rodriguez v Antonio Vargas, Desert Diamond Arena).
