# Surface

Show-control console for live-event graphics. Bout sheet in → screen-aware cue list → Resolume Arena, disguise, Bitfocus Companion and a caller's cue sheet out. Run mode fires the engines directly; Bridge mode sits between Companion and the engines; Author-only mode just writes the bundle.

See `CLAUDE.md` for the model and conventions. Fixture: `fixtures/2026-06-13-glendale.bout.json` (Bam Rodriguez v Antonio Vargas card, Desert Diamond Arena).

```bash
npm install && npm test
npm run cli -- build fixtures/2026-06-13-glendale.bout.json out
```
