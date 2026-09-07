/**
 * Engine adapters: the console talks in cue-level ops; adapters translate to Resolume / disguise / Companion / mock.
 * Every op is fire-and-forget with a promise for health; the runner never blocks the GO on an adapter.
 */
import type { Cue, LayerId, ShowDoc } from "../types.js";

export interface EngineOp {
  kind: "fireCue" | "clearLayer" | "setText" | "openClip" | "panic" | "revertBase";
  cue?: Cue;
  surface?: string; layer?: LayerId; key?: string; value?: string; slot?: string; file?: string;
}
export interface AdapterStatus { id: string; connected: boolean; detail?: string; latencyMs?: number; lastError?: string }

export interface EngineAdapter {
  id: string;
  init(doc: ShowDoc, cues: Cue[]): Promise<void>;
  apply(op: EngineOp): Promise<void>;
  status(): AdapterStatus;
  close(): Promise<void>;
}

/** Resolume: one layer group per surface (doc.surfaces order), 3 layers per group (BASE, OVERLAY, FULL), column == cue.n */
export function resolumeAddress(doc: ShowDoc, surface: string, layer: LayerId) {
  const gi = doc.surfaces.findIndex((s) => s.id === surface); const li = ["BASE", "OVERLAY", "FULL"].indexOf(layer);
  return { group: gi + 1, layer: gi * 3 + li + 1 };
}
