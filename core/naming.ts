import type { Screen, ShowDoc } from "./types.js";

export function pad(n: number, w = 3): string { return String(n).padStart(w, "0"); }

/** Deterministic asset/slot name: {GROUP}_{GRAPHIC}[_{VARIANT}]_{SCREEN}_{W}x{H} */
export function slotName(group: string, graphic: string, variant: string | null, screen: Screen): string {
  const v = variant ? `_${variant}` : "";
  return `${group}_${graphic}${v}_${screen.id}_${screen.w}x${screen.h}`;
}

export function screensOf(doc: ShowDoc, surfaceId: string): Screen[] {
  const s = doc.surfaces.find((x) => x.id === surfaceId);
  if (!s) throw new Error(`unknown surface ${surfaceId}`);
  return s.screens.map((id) => {
    const sc = doc.screens.find((x) => x.id === id);
    if (!sc) throw new Error(`surface ${surfaceId} references unknown screen ${id}`);
    return sc;
  });
}

/** Expand "ALL" to every non-independent surface */
export function expandScope(doc: ShowDoc, scope: string[]): string[] {
  if (scope.includes("ALL")) return doc.surfaces.filter((s) => !s.independent).map((s) => s.id);
  return scope;
}

export function record(f: { record: { w: number; l: number; d?: number; ko: number } }): string {
  const r = f.record;
  let s = `${r.w}-${r.l}`;
  if (r.d) s += `-${r.d}`;
  return `${s} (${r.ko} KO${r.ko === 1 ? "" : "s"})`;
}
