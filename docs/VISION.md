# Surface — where it goes next

The measure stays the same: does the operator have less to organise? This is the plan for making Surface feel
inevitable to use, show-agnostic underneath, and — eventually — a physical console as intuitive as a lighting or
audio desk. Companion for `docs/PLAYER.md` (the playback half); this is the control + workflow half.

## Horizon 1 — Seamless (the current workflow, made inevitable)

1. **Confirm flow: questions, not flags.** `review.flags` are sentences today; the operator deserves questions.
   Each inference becomes a card with its evidence and one-tap answers: corner assignment shows the two walkout
   thumbnails beside the sheet's names ("Which is Perez?" RED / BLUE); numbering direction shows one real filename
   and both readings ("`4a` = Stankovic, the opener — or Rodriguez, the main?"); a hold variant shows the loop
   playing. Answer → operator override recorded → board updates → next card. The "N to confirm" chip becomes the
   whole review UX. Structural change: flags grow from strings to typed objects
   `{ id, kind, question, options[], evidence: { thumbs, files, sheetFacts } }` with strings kept as the fallback.
2. **Drag-to-map on the board.** Unmatched files sit in a tray at the strip's edge; drag one onto a cell to assign
   it (origin `operator`, beats any inference, persisted in the doc so re-runs keep it). Click a cell → the rail
   offers "swap file" with a thumbnail browser of the delivery. The board stops being a report and becomes the
   mapping surface.
3. **Line check.** One button before doors: every cue's file exists and decodes, sizes match slots, engines answer,
   columns match the published pinning (`doc.build.cueNumbers`), test patterns present, audio measured. Green board
   = show-ready; every red line says the fix. The checklist grows from onboarding aid to operational guarantee.
4. **Hover scrub + always-on venue strip.** Hovering a cell scrubs its preview proxy; Run mode keeps a thin live
   venue strip in the run bar even when the full Venue view is off.
5. **Show clock.** The timing sheet knows walk 14:15, first bell 14:20; the runner knows what actually happened.
   Ahead/behind lives in the run bar, and READY BY alerts fire from real drift — the number broadcast lives by.
6. **Rehearsal + shadow mode.** Rehearse the whole show against the Venue view with no engine (mock adapter already
   records everything); record cue timings for the caller. Shadow mode runs beside a live engine showing what
   Surface *would* fire — the trust-building step before it drives the walls alone.

## Horizon 2 — Show-agnostic (packs as data, not code)

The cue/slot/surface/routing model is already show-agnostic; three places are still boxing-shaped: the packs
(TypeScript with fixed numbering), the board's columns (`server/board.ts` hard-codes WALK_RED…WINNER), and the
Companion page layout. The move: a **pack manifest** — declarative JSON describing

- entities and their fields (bout: red/blue/rounds/titles; speaker; award category; song),
- graphic types with variants, layers, behaviours (`WALKOUT` red|blue → FULL playHold; `LOWER_THIRD` → OVERLAY),
- cue templates + the numbering scheme (the fixed-tag rules the current pack headers document in prose),
- board columns and the control-surface layout (which buttons a bout page carries),
- intake vocabulary (kind words + slot grammar extensions for `core/intake/tokens.ts`).

Boxing fight-night becomes the reference manifest; press conference and weigh-in prove the reuse; then a corporate
keynote, an awards night, a halftime show are *authored*, not coded. Parsers stay plugins (`detectKind` + one
module per paper format — every produced show has a rundown, so `rundown.ts` generalises first).

## Horizon 3 — The console ("a massive Stream Deck, but better")

The "better" is precise: a Companion rig is **programmed** per show; Surface's control surface is **derived** from
the show document. Drop a new sheet and the buttons re-derive; the runner's state is the feedback bus (round lit
green, next cue breathing, walls' now-showing on the button faces). Nobody programs buttons on fight day.

- **Step 1 — Stream Deck direct** (`@elgato-stream-deck/node`, HID). Surface renders button faces itself from the
  board: bout pages in running order, rounds with live state, PANIC / holds / test patterns pinned on every page,
  page auto-follows the live bout, spans any number of decks (XL + plus). The Companion generator stays as the
  fallback for venues that already run Companion.
- **Step 2 — a `ConsoleSurface` abstraction.** Controls = keys-with-images, faders, encoders, transport, text
  strips; bindings generated per pack. Backends: Stream Deck (HID), **MIDI fader banks** (X-Touch: motorised
  faders = per-surface masters + a grand master that recalls per cue; scribble strips name the surfaces), and a
  **web touch surface** — a tablet page speaking the existing Bridge API, which is free hardware for every venue.
- **Step 3 — the desk.** v0 is commodity in a road case: 2× Stream Deck XL, one motorised fader bank, a
  touchscreen on the Bridge API. What lighting and audio desks teach: a transport cluster (GO · back · hold), a
  T-bar for manual stinger/fade takeovers, per-surface intensity faders, and a grand master that fades to *base*,
  never to black (panic with cover). v1 is custom panels (LCD keys, motorised faders, a real GO button) only after
  the interaction model has run real shows on commodity gear.
- **Convergence with Play mode** (`docs/PLAYER.md`): when Surface renders the show itself, console + player is a
  video desk — the physical faders map to the Web Audio chain and real layer opacity, not to another app's API.

## Sequencing

| when | what | why first |
|---|---|---|
| now (weeks) | confirm-flow cards · drag-to-map · line check · Stream Deck direct v1 | biggest operator wins on existing structures |
| next | pack manifest extraction · show clock · web touch surface · MIDI faders | unlocks other event types + the console model |
| later | rehearsal/shadow mode · custom hardware · Play-mode convergence | needs the trust and the interaction model proven |

Gate for the engine-facing work: the live-Arena verification list in `CLAUDE.md` → "Assumed, NOT yet verified"
(empty-column behaviour on independent groups, panic clears, stinger groups, disguise OSC arg) — verify on the
real box, then promote to Engine facts.
