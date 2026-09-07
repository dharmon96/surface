/**
 * Engine adapters: the console talks in cue-level ops; adapters translate to Resolume / disguise / Companion / mock.
 * Every op is fire-and-forget with a promise for health; the runner never blocks the GO on an adapter.
 */
import type { Cue, LayerId, ShowDoc } from "../types.js";

export interface EngineOp {
  kind: "fireCue" | "clearLayer" | "setText" | "openClip" | "panic" | "revertBase" | "stinger";
  stinger?: import("../types.js").Stinger; surfaces?: string[];
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

export const resolumeLayout = (doc: ShowDoc) => doc.build?.resolumeLayout ?? "per-screen";
/**
 * Resolume addresses (1-based) for a surface + layer under the doc's layout:
 *   per-screen  group = surface index, layers BASE/OVERLAY/FULL inside it (3 per group)
 *   together    group 1 "SHOW" has one layer per surface (BASE and FULL share it), group 2 "ROUNDS" one overlay layer per surface
 */
export function resolumeAddress(doc: ShowDoc, surface: string, layer: LayerId) {
  const gi = doc.surfaces.findIndex((s) => s.id === surface); const li = ["BASE", "OVERLAY", "FULL"].indexOf(layer);
  if (resolumeLayout(doc) === "together") return layer === "OVERLAY" ? { group: 2, layer: doc.surfaces.length + gi + 1 } : { group: 1, layer: gi + 1 };
  return { group: gi + 1, layer: gi * 3 + li + 1 };
}
/** Which layer groups a cue connects: composition-wide when it can be, else one per group it touches. */
export function resolumeGroupsFor(doc: ShowDoc, cue: { resolume?: { groups: string[] | "ALL" }; targets: { surface: string; actions: { layer: LayerId }[] }[] }): number[] | "ALL" {
  if (!cue.resolume) return "ALL";
  if (resolumeLayout(doc) === "together") return "ALL"; // every column is complete in itself; empty slots leave layers alone
  return cue.resolume.groups === "ALL" ? "ALL" : [...new Set(cue.resolume.groups.map((s) => resolumeAddress(doc, s, "BASE").group))];
}
