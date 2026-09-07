# Surface Player — architecture and roadmap

Surface started as the thing that *prepares* a fight night for Resolume or disguise. This document is the plan for the
other half: Surface playing the show itself, straight onto the PC's outputs, the way Resolume's Advanced Output does —
minus the mapping step, because PixelGrid already knows where every screen sits in every processor canvas.

The two roles share one show document, one card board, one cue list, one media folder. The operator never chooses a
"mode"; they choose an engine. **Feed** = an external engine is the playback (Surface builds it, previews with proxies).
**Play** = Surface is the playback (its own renderer on the PC's displays). A venue can run both at once — Play for the
ribbon and IMAGs, Feed for a disguise-driven main wall — because every cue is scoped by surface.

## What ships today (Feed)

| piece | where | status |
|---|---|---|
| Media intake, matching, conversion to DXV / HAP / PNG | `core/intake/` | done |
| Level matching (EBU R128 measure → one static gain per clip) | `core/intake/loudness.ts`, `execute.ts` | done |
| Resolume build over REST, both layouts (per-screen / together) | `core/engine/adapters.ts`, `core/gen/engines.ts` | done, needs a live box |
| Companion actions, disguise cue tables | `core/gen/` | done |
| Browser preview proxies (H.264 / VP9-alpha) for the board and the Venue mirror | `server/proxy.ts` | done |
| Outputs: canvases → displays, kiosk windows, Identify | `server/index.ts` `/api/outputs`, `electron/main.cjs`, `src/output.tsx` | done — proxies interim |
| HAP demux + frame decode to DXT (GPU-native) | `player/mov.ts`, `player/hap.ts` | done, tested against ffmpeg |

Today an output window renders the same proxies the venue view uses. That is enough to line up processors, check
Identify, and rehearse; it is not show-quality (proxies are ≤960 px, H.264). The renderer below replaces the `<video>`
elements without changing anything around them.

## Outputs = PixelGrid canvases

An `OutputCanvas` is a processor input: `w×h` pixels, screens at canvas positions, optionally rotated. PixelGrid's
canvases map onto it directly (`fromPixelMapper` → `outputs`); without a PixelGrid project every screen becomes its own
canvas. Each canvas is assigned to a display and a fit rule:

- `1:1` — canvas pixels are display pixels, top-left. The LED case. Surface warns when the display's mode differs.
- `scale` / `letterbox` — uniform scale to fit (top-left / centred), for a monitor that is not the canvas size.
- `stretch` — fill the display, for a screen that wants a standard 1920×1080 no matter what its pixel count is.

Electron opens one frameless kiosk window per canvas on the chosen display with `force-device-scale-factor=1`, background
throttling off, no menu, no cursor. The window loads `output.html?id=<canvas>` and subscribes to the runner over
Socket.IO, so it renders exactly the layer state the console shows. Closing the console closes every output.

Identify paints every screen's id, size and canvas offset onto the outputs — the first thing to do after patching a
processor. The Test patterns cue (EVT.TEST) puts each screen's own PixelGrid pattern on its BASE layer, on every engine.

## The renderer (Play)

The rule that makes this cheap enough to run on a laptop: **never decode pixels on the CPU at show time.**

1. **HAP native.** `Movie` reads only the index and fetches samples by byte range; `decodeHapFrame` turns a sample into
   DXT block buffers (Snappy-decompressed, chunks concatenated). The output page uploads them with
   `compressedTexImage2D` (`WEBGL_compressed_texture_s3tc`, `EXT_texture_compression_rgtc`). Hap Q's YCoCg is undone in
   the fragment shader; Hap Q Alpha binds two textures (colour + RGTC1 alpha). A 3840×1080 Hap Q frame is ~4 MB of
   texture upload — trivial.
2. **Demux off the main thread.** A worker owns the file handles, decodes HAP sections (Snappy is the only CPU work) and
   posts transferable ArrayBuffers a couple of frames ahead. The render thread only uploads and draws.
3. **Other codecs become HAP at intake.** DXV and NotchLC decode fine through ffmpeg but not in a browser, so in Play the
   converter targets HAP (Hap Q for quality, Hap Alpha for overlays). ProRes and H.264 deliveries convert the same way.
   PNG stills upload once. This keeps one code path and one codec on disk.
4. **Compositing.** Per screen: BASE, OVERLAY, FULL quads drawn in order into the canvas framebuffer at the screen's
   canvas position, with per-layer opacity and the runner's fades. Rotated screens are just a rotated quad.
5. **Clock.** One master clock per process (`performance.now()` on the console, published to outputs over the socket with
   an offset). Each output window renders in its own `requestAnimationFrame` but picks the frame index from the master
   clock, so IMAG L and R on two displays never drift by more than a frame. Genlock is out of scope — LED processors
   frame-sync themselves.
6. **Runner integration.** `PlayerAdapter implements EngineAdapter`: fireCue → sets slots on the output windows, reverts
   and panic clear layers, `media/ended` comes back from the clip itself (walkout finished → follow-on). The runner does
   not know whether it is talking to Resolume or to itself.

Performance targets: 4 canvases, 12 screens, ~30 Mpx total at 60 fps on a mid-range GPU; RAM bounded by the
frames-ahead buffer, not clip size.

## Audio

Level matching is settled: measure each clip's integrated loudness once at conversion, apply a single gain to hit the
show standard (−18 LUFS, true-peak ceiling −1 dBTP), bake it into the converted file. No compression, no limiting —
a loud clip is turned down, a quiet one turned up, their dynamics untouched. The board shows the gain in the cell note.

At playback (Play): Web Audio graph per output, `MediaElementSource`/`AudioBufferSource` per clip → clip gain (the
operator's trim, default 0 dB) → master gain (`doc.audio.masterDb`) → meter (analyser, −∞…0 dBTP, drawn in the run bar)
→ the chosen device (`setSinkId`, so a Dante Virtual Soundcard or a USB interface can be the show output). Walkouts and
VTs carry audio; everything else is stripped at intake.

Feed: Resolume exposes clip volume over REST (`/composition/layers/{l}/clips/{c}/audio/volume`) — unverified on a
live box; the level match already lands the files at the right level, so this is a trim, not a necessity.

## Stream Decks without Companion

`@elgato-stream-deck/node` talks HID directly. Surface lays the card out across any number of decks: one page per bout
(walk red / walk blue / tale / rounds), holds and panic pinned on every page, live feedback from the runner (current cue
lit, next cue pulsing). Companion export stays for venues that already run it.

## A console

The lighting-desk intuition is: physical things for the things you touch every minute, screen for the rest.

- A **GO** section (GO / back / panic) with big keys and a shuttle wheel for scrubbing a held VT.
- **Per-surface faders** — one motorized fader per LED surface for output level, with a key above it to black that
  surface; audio master + a walkout trim as two more.
- **A cue rail** of 8–16 keys with small displays (Stream Deck XL or a custom key matrix) that follow the board: bout
  pages, round numbers, holds.
- A small touch screen for the board itself; the console is a USB HID + MIDI device, which means the first version is a
  Stream Deck + a MIDI fader bank (X-Touch Mini / Faderport) mapped through Web MIDI, and the housing comes later.

## Order of work

1. WebGL HAP renderer in `output.html` (DXT upload, YCoCg shader, alpha), fed from a worker; proxies stay as fallback.
2. `PlayerAdapter` + master clock; outputs get cue state from the runner, not by polling.
3. Play-mode conversion target (HAP), and a Play/Feed switch per surface in Engines.
4. Web Audio chain with meters and device pick; walkout trim on the board.
5. Stream Deck direct.
6. MIDI fader bank → per-surface levels; then the console.
