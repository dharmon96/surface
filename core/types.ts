/**
 * Surface core model — show-agnostic.
 *
 * Surfaces  : a screen or group of screens that always receives the same content.
 * Layers    : fixed stack per surface — BASE (loops underneath), OVERLAY (over the base, cleared not re-cued), FULL (covers all while it runs).
 * Media     : files or templates with a playback behaviour (loop / play-hold / play-to-marker / timed).
 * Cues      : numbered steps; each carries per-surface layer actions plus optional transition and follow-on.
 * Packs     : derive cues from a data source (a bout sheet, a setlist, a rundown).
 */

// ───────────────────────────────────────────── screens & surfaces
export interface Screen {
  id: string;            // "MAIN", "RIBBON", "IMAG_L" — stable, used in asset names
  name: string;
  w: number;
  h: number;
  /** the screen's test pattern / line-up image (PixelGrid native export), relative to doc.mediaRoot */
  testPattern?: string;
  /** where the screen stands in the venue, metres: x right, y up, z towards the audience; rotation radians (PixelGrid 3D or auto-layout) */
  venue?: { x: number; y: number; z: number; wM: number; hM: number; rot?: [number, number, number]; source: "pixelgrid-3d" | "pixelgrid-2d" | "auto" };
  /** Optional link back to PixelMapper (Screen.id / canvasId) */
  pixelMapper?: { screenId?: string; canvasId?: string };
}

export interface Surface {
  id: string;            // "ARENA", "RIBBON", "IMAG", "HOST_BOOTH", "TABLE_1", "SCALE"
  name: string;
  screens: string[];     // Screen ids that always receive the same content
  /** Independent surfaces are never touched by scope "ALL" (host booth, LED tables, scale panels) */
  independent?: boolean;
}

export type LayerId = "BASE" | "OVERLAY" | "FULL";

// ───────────────────────────────────────────── media & behaviours
export type Behaviour =
  | { kind: "loop" }
  | { kind: "playHold" }                                  // VTs, winner stings: play once, hold last frame
  | { kind: "playToMarker"; markerSec: number }           // weigh-in scale: play to marker and pause
  | { kind: "timed"; holdSec: number; then: "clear" | "revertBase" }; // round card: out after N seconds

export interface MediaRef {
  /** Deterministic slot name: {SCOPE}_{GRAPHIC}[_{VARIANT}]_{SCREEN}_{W}x{H} */
  slot: string;
  /** Supplied file after intake mapping, or null when missing (text fallback applies) */
  file: string | null;
  behaviour: Behaviour;
  /** Text shown by the fallback template/Text Block when file is null */
  fallbackText?: string;
}

// ───────────────────────────────────────────── cues
export type Action =
  | { layer: LayerId; op: "show"; media: MediaRef }
  | { layer: LayerId; op: "clear" }
  | { layer: "OVERLAY" | "FULL"; op: "text"; key: string; value: string }; // live text update (round, names)

export interface SurfaceActions {
  surface: string;
  actions: Action[];
}

export type Transition =
  | { kind: "cut" }
  | { kind: "fade"; sec: number }
  | { kind: "stinger"; stinger: string }                              // id into doc.stingers: alpha animation over FULL; the cue lands at its cover frame
  | { kind: "dve"; preset: string; sec: number };                     // squeeze / fly, executed by adapter (Resolume transform, ATEM DVE)

/** A stinger is broadcast's wipe: an alpha animation that fully covers the picture at `coverSec`; the real change is a hard cut hidden under it. */
export interface Stinger { id: string; name: string; file: string | null; durationSec: number; coverSec: number; surfaces?: string[] /* default: the cue's scope */ }

export interface Cue {
  n: number;                 // cue number == Resolume column number; stable once published
  id: string;                // "B08.R01", "EVT.HOLD_1", "EVT.VT_TITLES"
  group: string;             // "EVT" | bout id | "CUSTOM"
  name: string;
  origin: "pack" | "rundown" | "custom";
  /** Surface ids addressed. "ALL" expands to every non-independent surface. */
  scope: string[];
  targets: SurfaceActions[];
  transition?: Transition;
  trigger?: string;          // caller's cue line
  timing?: string;           // estimated clock time from the sheet
  follow?: { afterSec?: number; onMediaEnd?: boolean; next?: number | "revertBase" };
  /** Engine-specific addresses, filled by the resolver */
  d3?: { tag: string; transports: string[] };
  resolume?: { column: number; groups: string[] | "ALL" };
  companion?: { page: number; row: number; col: number };
  showcall?: { cueNumber: string };
  notes?: string;
}

// ───────────────────────────────────────────── show document
export interface ShowDoc {
  schema: "surface/2.0";
  source?: { file: string; kind: string; version?: string; parsedAt?: string };
  event: Record<string, any> & { id: string; name: string; date?: string };
  screens: Screen[];
  surfaces: Surface[];
  /** pack-specific data (fighters, bouts, ...) */
  data: Record<string, any>;
  /** graphic type -> default surfaces (pack defaults, user overrides) */
  routing: Record<string, string[]>;
  customCues?: Partial<Cue>[];
  stingers?: Stinger[];
  /** default transition per graphic type, e.g. { WINNER: "stinger:whoosh", UP_NEXT: "stinger:whoosh" } */
  transitions?: Record<string, string>;
  review: { status: "draft" | "approved"; flags: string[] };
  /** every sheet version merged in, newest last, with the human diff */
  versions?: { file: string; at: string; diff: string[] }[];
  /** how the engine composition is laid out — see core/engine/adapter.ts.
   *  cueNumbers: cue id → column, written when a composition is built ("published") — from then on those numbers are
   *  pinned and later derivations keep them, giving new cues the next free columns instead of renumbering. */
  build?: { resolumeLayout?: ResolumeLayout; disguiseLayout?: ResolumeLayout; cueNumbers?: Record<string, number> };
  /** physical outputs (Play mode): each = one raster the PC sends to a display port / LED processor input, with screens placed in it
   *  1:1 — PixelGrid's canvases. `fit` handles the odd output that must be a standard size (1920x1080 monitor): scale or letterbox. */
  outputs?: OutputCanvas[];
  /** sound: the show's level standard for clips with audio (VTs, walkouts); matched per clip as one static gain at conversion */
  audio?: { targetLufs: number; ceilingDbTp?: number; levelMatch: boolean; masterDb?: number };
  /** where converted media lives (absolute); slot → file relative to it, filled by transcode / test-pattern import */
  mediaRoot?: string;
  media?: Record<string, string>;
}

/**
 * "per-screen": one layer group (disguise: track) per surface with BASE/OVERLAY/FULL layers; a cue that only touches some
 *               screens connects the column in just those groups (Companion fires one action per group).
 * "together":   one group "SHOW" with a single layer per surface — everything a cue does lands in the same column and
 *               plays at once — plus a "ROUNDS" group holding the overlays so a round card never re-fires the walls.
 */
export type ResolumeLayout = "per-screen" | "together";

export interface OutputCanvas {
  id: string; name: string; w: number; h: number;
  screens: { id: string; x: number; y: number; w?: number; h?: number; rotation?: 0 | 90 | 180 | 270 }[];
  /** which display shows it (Electron display id / label), and how the canvas meets a display of another size */
  display?: { id?: number; label?: string; w?: number; h?: number };
  fit?: "1:1" | "scale" | "letterbox" | "stretch";
  pixelMapper?: { canvasId?: string; processor?: string };
}

export interface Pack {
  id: string;                                  // "boxing.fightnight"
  name: string;
  deriveCues(doc: ShowDoc): Cue[];
}
