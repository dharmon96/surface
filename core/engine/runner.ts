/**
 * Cue runner: the console's show-time state machine. Knows what is on every surface's BASE / OVERLAY / FULL, fires cues
 * through adapters with the right scope, runs timed reverts and follow-ons, and exposes state for the GO panel,
 * Companion variables and the health view. Pure logic over injected timers so it is unit-testable.
 */
import type { Cue, ShowDoc, LayerId } from "../types.js";
import type { EngineAdapter, EngineOp } from "./adapter.js";

export interface LayerState { slot: string | null; since: number; cueN: number | null }
export interface SurfaceState { BASE: LayerState; OVERLAY: LayerState; FULL: LayerState }
export interface RunnerState { current: number | null; next: number | null; surfaces: Record<string, SurfaceState>; round: number | null; bout: string | null; firedAt: number | null; timers: number }
export type RunnerEvent = { type: "state"; state: RunnerState } | { type: "fired"; cue: Cue; ops: EngineOp[] } | { type: "stinger"; cue: Cue; stinger: import("../types.js").Stinger } | { type: "revert"; surface: string; layer: LayerId; cueN: number } | { type: "error"; adapter: string; error: string };

export interface RunnerOpts { now?: () => number; setTimeout?: (fn: () => void, ms: number) => any; clearTimeout?: (h: any) => void }

export class Runner {
  private state: RunnerState;
  private timers = new Map<string, any>();
  private seq = 0;
  private listeners: ((e: RunnerEvent) => void)[] = [];
  private now: () => number; private setT: RunnerOpts["setTimeout"]; private clearT: RunnerOpts["clearTimeout"];
  constructor(public doc: ShowDoc, public cues: Cue[], public adapters: EngineAdapter[], opts: RunnerOpts = {}) {
    this.now = opts.now ?? (() => Date.now()); this.setT = opts.setTimeout ?? ((f, ms) => setTimeout(f, ms)); this.clearT = opts.clearTimeout ?? ((h) => clearTimeout(h));
    const empty = (): LayerState => ({ slot: null, since: 0, cueN: null });
    this.state = { current: null, next: cues[0]?.n ?? null, surfaces: Object.fromEntries(doc.surfaces.map((s) => [s.id, { BASE: empty(), OVERLAY: empty(), FULL: empty() }])), round: null, bout: null, firedAt: null, timers: 0 };
  }
  on(fn: (e: RunnerEvent) => void) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter((l) => l !== fn); }; }
  private emit(e: RunnerEvent) { for (const l of this.listeners) l(e); }
  getState(): RunnerState { return JSON.parse(JSON.stringify({ ...this.state, timers: this.timers.size })); }
  cue(n: number) { return this.cues.find((c) => c.n === n); }

  /** Fire a cue: apply its per-surface actions to state, dispatch to adapters, arm timed reverts / follow-ons. */
  async go(n: number): Promise<Cue | undefined> {
    const c = this.cue(n); if (!c) return undefined;
    // stinger transition: fire the alpha animation over FULL on the in-scope surfaces now, land the cue itself at the cover frame
    if (c.transition?.kind === "stinger") {
      const st = this.doc.stingers?.find((x) => x.id === (c.transition as any).stinger);
      if (st) {
        const surfaces = st.surfaces ?? this.expand(c.scope);
        await this.dispatch([{ kind: "stinger", stinger: st, surfaces, cue: c }]);
        this.emit({ type: "stinger", cue: c, stinger: st } as any);
        // unique key per GO: a second press during the cover must not orphan this promise's resolver
        await new Promise<void>((r) => this.arm(`stinger:${n}:${++this.seq}`, st.coverSec * 1000, r));
      }
    }
    return this.land(c);
  }
  private expand(scope: string[]) { return scope.includes("ALL") ? this.doc.surfaces.filter((s) => !s.independent).map((s) => s.id) : scope; }
  private async land(c: Cue): Promise<Cue> {
    const n = c.n; const t = this.now(); const ops: EngineOp[] = [{ kind: "fireCue", cue: c }];
    for (const k of [...this.timers.keys()]) if (k.startsWith("follow:")) this.cancel(k); // a manual GO outruns any pending follow-on
    for (const target of c.targets) {
      const S = this.state.surfaces[target.surface]; if (!S) continue;
      for (const a of target.actions) {
        if (a.op === "show") {
          S[a.layer] = { slot: a.media.slot, since: t, cueN: n };
          this.cancel(`${target.surface}:${a.layer}`);
          if (a.media.behaviour.kind === "timed") this.arm(`${target.surface}:${a.layer}`, a.media.behaviour.holdSec * 1000, () => this.revert(target.surface, a.layer, n, a.media.behaviour.kind === "timed" && a.media.behaviour.then === "clear"));
        } else if (a.op === "clear") { S[a.layer] = { slot: null, since: t, cueN: n }; this.cancel(`${target.surface}:${a.layer}`); ops.push({ kind: "clearLayer", surface: target.surface, layer: a.layer, cue: c }); }
        else if (a.op === "text") ops.push({ kind: "setText", surface: target.surface, layer: a.layer, key: a.key, value: a.value, cue: c });
      }
    }
    const round = c.id.match(/\.R(\d\d)$/); if (round) this.state.round = Number(round[1]); if (/\.(WALK|INTRO|TALE|UP_NEXT|HOLD)/.test(c.id) && c.group !== "EVT") this.state.round = null;
    if (c.group !== "EVT" && c.group !== "CUSTOM" && c.group !== "RUNDOWN") this.state.bout = c.group;
    this.state.current = n; this.state.firedAt = t;
    const i = this.cues.findIndex((x) => x.n === n); this.state.next = this.cues[i + 1]?.n ?? null; // list order, not numeric — pinned numbers may not be monotonic
    if (c.follow?.afterSec && typeof c.follow.next === "number") { const nx = c.follow.next; this.arm(`follow:${n}`, c.follow.afterSec * 1000, () => void this.go(nx)); }
    await this.dispatch(ops);
    this.emit({ type: "fired", cue: c, ops }); this.emit({ type: "state", state: this.getState() });
    return c;
  }
  async next() { return this.state.next != null ? this.go(this.state.next) : undefined; }
  async prev() { const i = this.cues.findIndex((c) => c.n === this.state.current); return i > 0 ? this.go(this.cues[i - 1].n) : undefined; }
  /** Called when an adapter reports media end for a slot (VT finished) — honours follow.onMediaEnd */
  async mediaEnded(slot: string) { const c = this.state.current != null ? this.cue(this.state.current) : undefined; if (c?.follow?.onMediaEnd && c.targets.some((t) => t.actions.some((a) => a.op === "show" && a.media.slot === slot))) { if (c.follow.next === "revertBase") for (const t of c.targets) await this.revert(t.surface, "FULL", c.n, true); else if (typeof c.follow.next === "number") await this.go(c.follow.next); } }
  /** Clear FULL and OVERLAY everywhere — the base stays. Then blackout if adapters support it. */
  async panic() {
    const t = this.now(); for (const [sid, S] of Object.entries(this.state.surfaces)) { S.OVERLAY = { slot: null, since: t, cueN: null }; S.FULL = { slot: null, since: t, cueN: null }; this.cancel(`${sid}:OVERLAY`); this.cancel(`${sid}:FULL`); }
    for (const k of [...this.timers.keys()]) this.cancel(k);
    await this.dispatch([{ kind: "panic" }]); this.emit({ type: "state", state: this.getState() });
  }
  private async revert(surface: string, layer: LayerId, cueN: number, clearOnly: boolean) {
    const S = this.state.surfaces[surface]; if (!S || S[layer].cueN !== cueN) return; // something newer landed on that layer
    S[layer] = { slot: null, since: this.now(), cueN }; this.timers.delete(`${surface}:${layer}`);
    await this.dispatch([{ kind: clearOnly ? "clearLayer" : "revertBase", surface, layer }]);
    this.emit({ type: "revert", surface, layer, cueN }); this.emit({ type: "state", state: this.getState() });
  }
  private arm(key: string, ms: number, fn: () => void) { this.cancel(key); this.timers.set(key, this.setT!(() => { this.timers.delete(key); fn(); }, ms)); }
  private cancel(key: string) { const h = this.timers.get(key); if (h !== undefined) { this.clearT!(h); this.timers.delete(key); } }
  private async dispatch(ops: EngineOp[]) { await Promise.all(this.adapters.map(async (ad) => { for (const op of ops) { try { await ad.apply(op); } catch (e: any) { this.emit({ type: "error", adapter: ad.id, error: String(e?.message ?? e) }); } } })); }
  /** Variables for Companion / disguise text: round, bout, names, now-showing per surface */
  variables(): Record<string, string> {
    const v: Record<string, string> = { round: this.state.round ? String(this.state.round) : "", bout: this.state.bout ?? "", cue: this.state.current != null ? String(this.state.current) : "", next: this.state.next != null ? String(this.state.next) : "" };
    const b = this.doc.data.bouts?.find((x: any) => x.id === this.state.bout); if (b) { const r = this.doc.data.fighters[b.red], bl = this.doc.data.fighters[b.blue]; v.red_name = r?.name ?? ""; v.blue_name = bl?.name ?? ""; v.rounds = String(b.rounds); }
    for (const [sid, S] of Object.entries(this.state.surfaces)) v[`showing_${sid}`] = S.FULL.slot ?? S.OVERLAY.slot ?? S.BASE.slot ?? "";
    const nx = this.state.next != null ? this.cue(this.state.next) : undefined; v.next_name = nx?.name ?? "";
    return v;
  }
}
