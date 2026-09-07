/**
 * Where does this file go when the operator drops it on a graphic?
 * Pure: the UI asks before it drags (to light the cells that fit) and after it drops (to place, or to ask the one
 * question the pixels cannot answer). Same screen rule as matching: exact pixels, else the same shape within 1 %,
 * else the only screen there is — never a guess between two screens of different shapes.
 */
export interface PlaceSlot { slot: string; screen: string; w: number; h: number; cue: string }
export type Placing =
  | { ready: { slot: string; fit: "exact" | "scale" | "letterbox" }[] }
  | { ask: "variant"; options: { cue: string; slots: PlaceSlot[] }[] }        // one cell, several cues (who won?)
  | { ask: "screen"; options: { screen: string; slots: PlaceSlot[]; note: string }[] };

export function placeFile(slots: PlaceSlot[], file: { w: number; h: number }, o: { cue?: string; screen?: string } = {}): Placing {
  let S = slots;
  if (o.screen) S = S.filter((s) => s.screen === o.screen);
  const cues = [...new Set(S.map((s) => s.cue))];
  if (cues.length > 1) {
    if (!o.cue || !cues.includes(o.cue)) return { ask: "variant", options: cues.map((cue) => ({ cue, slots: S.filter((s) => s.cue === cue) })) };
    S = S.filter((s) => s.cue === o.cue);
  }
  if (!S.length) return { ready: [] };
  const exact = S.filter((s) => s.w === file.w && s.h === file.h);
  if (exact.length) return { ready: exact.map((s) => ({ slot: s.slot, fit: "exact" as const })) };   // identical screens (IMAG L + R) both take it
  const shape = S.filter((s) => s.w && s.h && Math.abs(file.w / file.h - s.w / s.h) / (s.w / s.h) < 0.01);
  if (shape.length) return { ready: shape.map((s) => ({ slot: s.slot, fit: "scale" as const })) };
  if (S.length === 1) return { ready: [{ slot: S[0].slot, fit: "letterbox" as const }] };            // the only screen, or the square they chose
  return { ask: "screen", options: S.map((s) => ({ screen: s.screen, slots: [s], note: `${file.w}×${file.h} will letterbox into ${s.w}×${s.h}` })) };
}
