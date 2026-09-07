/**
 * Pack: Boxing — Fight Night.
 * Derives the cue list from a parsed bout sheet (doc.data.fighters / doc.data.bouts).
 *
 * Numbering is FIXED and must not change once a bundle has been handed out:
 *   event : HOLD_1..n (0.1..), FLAG_<CC> (0.10+), VT_* (0.20+)
 *   bout N: WALK (N.1, N.2) · anthems (N.3, N.4) · INTRO (N.5, N.6) · TALE (N.7)
 *           ROUND r (N.(10+r)) · WINNER RED/BLUE/DRAW (N.90/91/92) · UP_NEXT (N.95) · HOLD (N.99)
 *
 * Layer semantics (from how Darian runs them):
 *   HOLD / UP_NEXT / TALE  -> BASE, loop (TALE is the fight's base; things happen OVER it)
 *   WALKOUT / INTRO / FLAG -> FULL, loop, cleared by the next BASE cue
 *   ROUND                  -> OVERLAY, timed (10 s then revert to base); surfaces in routing.ROUND_STAY keep it
 *   WINNER / VT            -> FULL, play and hold last frame
 */
import type { Cue, MediaRef, Pack, ShowDoc, Action, Behaviour, SurfaceActions } from "../types.js";
import { expandScope, record, screensOf, slotName } from "../naming.js";

type Fighter = { name: string; nick?: string | null; country: string; record: { w: number; l: number; d?: number; ko: number } };
type Bout = { id: string; order: number; red: string; blue: string; rounds: number; title?: string | null; isMain?: boolean; isCoMain?: boolean; anthems?: string[]; timing?: Record<string, string> };

const LOOP: Behaviour = { kind: "loop" };
const HOLD_LAST: Behaviour = { kind: "playHold" };

function media(doc: ShowDoc, surface: string, group: string, graphic: string, variant: string | null, behaviour: Behaviour, fallbackText: string): MediaRef[] {
  return screensOf(doc, surface).map((sc) => ({ slot: slotName(group, graphic, variant, sc), file: null, behaviour, fallbackText }));
}

/** Build per-surface actions for a graphic on a layer, honouring routing */
function targets(doc: ShowDoc, graphic: string, group: string, variant: string | null, layer: "BASE" | "OVERLAY" | "FULL", behaviour: Behaviour, text: string, extra: (s: string) => Action[] = () => []): { scope: string[]; targets: SurfaceActions[] } {
  const scope = expandScope(doc, doc.routing[graphic] ?? ["ALL"]);
  const t: SurfaceActions[] = scope.map((surface) => {
    const perSurfaceBehaviour = graphic === "ROUND" && (doc.routing.ROUND_STAY ?? []).includes(surface) ? LOOP : behaviour;
    const actions: Action[] = media(doc, surface, group, graphic, variant, perSurfaceBehaviour, text).map((m) => ({ layer, op: "show", media: m } as Action));
    return { surface, actions: [...actions, ...extra(surface)] };
  });
  return { scope, targets: t };
}

export const boxingFightNight: Pack = {
  id: "boxing.fightnight",
  name: "Boxing — Fight Night",
  deriveCues(doc: ShowDoc): Cue[] {
    const fighters: Record<string, Fighter> = doc.data.fighters;
    const bouts: Bout[] = [...doc.data.bouts].sort((a, b) => a.order - b.order);
    const walkOrder: ("red" | "blue")[] = doc.event.walkOrder ?? ["red", "blue"];
    const introOrder: ("red" | "blue")[] = doc.event.introOrder ?? ["red", "blue"];
    const cues: Cue[] = [];
    let n = 0;
    const add = (c: Omit<Cue, "n">) => { cues.push({ n: ++n, ...c }); };
    const clearFull = (): Action[] => [{ layer: "FULL", op: "clear" }];
    const clearOverlay = (): Action[] => [{ layer: "OVERLAY", op: "clear" }];

    // ── event-level holds: main, co-main, sponsor
    const main = bouts.find((b) => b.isMain) ?? bouts[bouts.length - 1];
    const coMain = bouts.find((b) => b.isCoMain) ?? bouts[bouts.length - 2];
    // an empty card (new project) still gets the event holds so the operator has something to fire
    const holds: [string, string][] = [["MAIN", main ? `${fighters[main.red].name} v ${fighters[main.blue].name}` : "Main event"]];
    if (coMain) holds.push(["COMAIN", `${fighters[coMain.red].name} v ${fighters[coMain.blue].name}`]);
    holds.push(["SPONSOR", "Sponsor loop"]);
    holds.forEach(([v, label], i) => {
      const t = targets(doc, "HOLD", "EVT", v, "BASE", LOOP, label, () => [...clearFull(), ...clearOverlay()]);
      add({ id: `EVT.HOLD_${v}`, group: "EVT", name: `Hold — ${label}`, origin: "pack", ...t, trigger: "Doors / breaks", d3: { tag: `0.${i + 1}`, transports: t.scope } });
    });
    // ── anthem flags used anywhere on the card
    const countries = [...new Set(bouts.flatMap((b) => b.anthems ?? []))].sort();
    countries.forEach((cc, i) => {
      const t = targets(doc, "FLAG", "EVT", cc, "FULL", LOOP, `${cc} flag`);
      add({ id: `EVT.FLAG_${cc}`, group: "EVT", name: `Anthem flag ${cc}`, origin: "pack", ...t, trigger: `'Please rise' — ${cc} anthem`, d3: { tag: `0.${10 + i}`, transports: t.scope } });
    });
    // ── pre-show "up next": the first fight, shown before the card starts
    if (bouts.length) {
      const b1 = bouts[0]; const t = targets(doc, "UP_NEXT", "EVT", b1.id, "BASE", LOOP, `UP NEXT — ${fighters[b1.red].name} v ${fighters[b1.blue].name}`, () => [...clearFull(), ...clearOverlay()]);
      add({ id: `EVT.UP_NEXT_${b1.id}`, group: "EVT", name: `Up next — ${fighters[b1.red].name} v ${fighters[b1.blue].name}`, origin: "pack", ...t, trigger: "Pre-show, before first walk", d3: { tag: "0.9", transports: t.scope } });
    }
    // ── VTs / ads declared in data.vts
    (doc.data.vts ?? []).forEach((vt: { id: string; name: string; durationSec?: number }, i: number) => {
      const t = targets(doc, "VT", "EVT", vt.id, "FULL", HOLD_LAST, vt.name);
      add({ id: `EVT.VT_${vt.id}`, group: "EVT", name: `VT — ${vt.name}`, origin: "pack", ...t, trigger: "Between bouts", follow: { onMediaEnd: true, next: "revertBase" }, d3: { tag: `0.${20 + i}`, transports: t.scope }, notes: vt.durationSec ? `${vt.durationSec}s, holds last frame` : "holds last frame" });
    });

    // ── per bout
    for (const b of bouts) {
      const N = b.order; const red = fighters[b.red]; const blue = fighters[b.blue];
      const F = (side: "red" | "blue") => (side === "red" ? red : blue);
      const bt = (k: string, extra?: Partial<Cue>) => ({ group: b.id, origin: "pack" as const, timing: b.timing?.[k], ...extra });

      walkOrder.forEach((side, k) => {
        const f = F(side);
        const t = targets(doc, "WALKOUT", b.id, side.toUpperCase(), "FULL", LOOP, f.name);
        add({ id: `${b.id}.WALK_${side.toUpperCase()}`, name: `Walkout ${side.toUpperCase()} — ${f.name}`, ...bt("walk"), ...t, trigger: `${f.name} music starts`, d3: { tag: `${N}.${k + 1}`, transports: t.scope } });
      });
      (b.anthems ?? []).forEach((cc, k) => {
        const t = targets(doc, "FLAG", "EVT", cc, "FULL", LOOP, `${cc} flag`);
        add({ id: `${b.id}.FLAG_${cc}`, name: `Anthem ${cc}`, ...bt("anthem"), ...t, trigger: "Announcer: 'please rise'", d3: { tag: `${N}.${3 + k}`, transports: t.scope } });
      });
      introOrder.forEach((side, k) => {
        const f = F(side);
        const t = targets(doc, "FIGHTER", b.id, side.toUpperCase(), "FULL", LOOP, `${f.name} ${record(f)}`);
        add({ id: `${b.id}.INTRO_${side.toUpperCase()}`, name: `Intro ${side.toUpperCase()} — ${f.name} ${record(f)}`, ...bt("intro"), ...t, trigger: `'In the ${side} corner…'`, d3: { tag: `${N}.${5 + k}`, transports: t.scope } });
      });
      {
        const t = targets(doc, "TALE", b.id, null, "BASE", LOOP, `${red.name} v ${blue.name}`, () => clearFull());
        add({ id: `${b.id}.TALE`, name: `Fighter v Fighter — ${red.name} v ${blue.name}`, ...bt("firstBell"), ...t, trigger: "Referee instructions (becomes the base for the fight)", d3: { tag: `${N}.7`, transports: t.scope } });
      }
      for (let r = 1; r <= b.rounds; r++) {
        const t = targets(doc, "ROUND", b.id, String(r).padStart(2, "0"), "OVERLAY", { kind: "timed", holdSec: doc.routing.ROUND_HOLD_SEC ? Number(doc.routing.ROUND_HOLD_SEC[0]) : 10, then: "revertBase" }, `ROUND ${r}`);
        add({ id: `${b.id}.R${String(r).padStart(2, "0")}`, name: `Round ${r}`, ...bt("round"), ...t, trigger: r === 1 ? "Bell" : "Bell (round card over the fight base)", d3: { tag: `${N}.${10 + r}`, transports: t.scope } });
      }
      ([["RED", 90, red.name], ["BLUE", 91, blue.name], ["DRAW", 92, "Draw"]] as const).forEach(([v, tag, who]) => {
        const t = targets(doc, "WINNER", b.id, v, "FULL", HOLD_LAST, `WINNER — ${who}`, () => clearOverlay());
        add({ id: `${b.id}.WIN_${v}`, name: `Winner ${v} — ${who}`, ...bt("finalBell"), ...t, trigger: "Decision read (fire ONE of three)", d3: { tag: `${N}.${tag}`, transports: t.scope } });
      });
      const nxt = bouts.find((x) => x.order === N + 1);
      if (nxt) {
        const nr = fighters[nxt.red], nb = fighters[nxt.blue];
        const t = targets(doc, "UP_NEXT", b.id, nxt.id, "BASE", LOOP, `UP NEXT — ${nr.name} v ${nb.name}`, () => [...clearFull(), ...clearOverlay()]);
        add({ id: `${b.id}.UP_NEXT`, name: `Up next — ${nr.name} v ${nb.name}`, ...bt("walkOut"), ...t, trigger: "Ring clears", d3: { tag: `${N}.95`, transports: t.scope } });
      }
      {
        const t = targets(doc, "HOLD", b.id, "MAIN", "BASE", LOOP, holds[0][1], () => [...clearFull(), ...clearOverlay()]);
        add({ id: `${b.id}.HOLD`, name: "Hold (main-event matchup)", ...bt("walkOut"), ...t, trigger: "Break / VT block", d3: { tag: `${N}.99`, transports: t.scope } });
      }
    }
    // ── line-up: every screen's own test pattern (PixelGrid export), independent surfaces included — the cue you can always go back to
    { const all = doc.surfaces.map((s) => s.id); const t: SurfaceActions[] = all.map((surface) => ({ surface, actions: [{ layer: "FULL", op: "clear" }, { layer: "OVERLAY", op: "clear" }, ...media(doc, surface, "EVT", "TEST", null, LOOP, "TEST").map((m) => ({ layer: "BASE" as const, op: "show" as const, media: m }))] }));
      add({ id: "EVT.TEST", group: "EVT", name: "Screen test patterns", origin: "pack", scope: all, targets: t, trigger: "Line-up / focus / any time you need to see the screens", d3: { tag: "0.99", transports: all } }); }
    return cues;
  },
};
