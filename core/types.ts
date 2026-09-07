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
  | { kind: "stinger"; media: MediaRef; coverFrameSec: number }      // play stinger on FULL, swap BASE at cover frame
  | { kind: "dve"; preset: string; sec: number };                     // squeeze / fly, executed by adapter (Resolume transform, ATEM DVE)

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
  schema: "boutkit/2.0";
  source?: { file: string; kind: string; version?: string; parsedAt?: string };
  event: Record<string, any> & { id: string; name: string; date?: string };
  screens: Screen[];
  surfaces: Surface[];
  /** pack-specific data (fighters, bouts, ...) */
  data: Record<string, any>;
  /** graphic type -> default surfaces (pack defaults, user overrides) */
  routing: Record<string, string[]>;
  customCues?: Partial<Cue>[];
  review: { status: "draft" | "approved"; flags: string[] };
}

export interface Pack {
  id: string;                                  // "boxing.fightnight"
  name: string;
  deriveCues(doc: ShowDoc): Cue[];
}
