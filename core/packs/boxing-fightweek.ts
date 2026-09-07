/**
 * Packs: Boxing — Press Conference and Weigh-in. Same bout data as Fight Night, different surfaces and cue shapes.
 *
 * Press Conference (from how Darian runs them):
 *   walls  : BASE holds — main matchup, co-main matchup, step-and-repeat (used during/after face-off); faceoff matchup per bout
 *   tables : each LED table is its own surface (independent) holding ONE fighter's name/photo; changes a few times per session
 *   fighter: single-fighter graphic flashed briefly for an intro (FULL, timed 8 s → base)
 * Weigh-in:
 *   per fighter: walk (fighter or matchup graphic) → SCALE file plays to marker and PAUSES to reveal weight → (both) faceoff → step-and-repeat
 *   scale panels: surface "SCALE" (independent) gets the scale animation while the wall may not
 *
 * Numbering: PC = 100+N.x ; WI = 200+N.x so the three packs never collide on d3 CUE tags.
 */
import type { Cue, Pack, ShowDoc, Action, Behaviour, SurfaceActions, MediaRef } from "../types.js";
import { expandScope, record, screensOf, slotName } from "../naming.js";

const LOOP: Behaviour = { kind: "loop" };
const media = (doc: ShowDoc, surface: string, group: string, graphic: string, variant: string | null, behaviour: Behaviour, text: string): MediaRef[] =>
  screensOf(doc, surface).map((sc) => ({ slot: slotName(group, graphic, variant, sc), file: null, behaviour, fallbackText: text }));
function targets(doc: ShowDoc, graphic: string, group: string, variant: string | null, layer: "BASE" | "OVERLAY" | "FULL", behaviour: Behaviour, text: string, surfaces?: string[], extra: Action[] = []): { scope: string[]; targets: SurfaceActions[] } {
  const scope = expandScope(doc, surfaces ?? doc.routing[graphic] ?? ["ALL"]);
  return { scope, targets: scope.map((surface) => ({ surface, actions: [...media(doc, surface, group, graphic, variant, behaviour, text).map((m) => ({ layer, op: "show", media: m } as Action)), ...extra] })) };
}
const clear = (l: "FULL" | "OVERLAY"): Action => ({ layer: l, op: "clear" });

/** Line-up cue shared by every pack: every screen's own test pattern, independent surfaces included. */
function addTestCue(doc: ShowDoc, add: (c: Omit<Cue, "n">) => void, tag: string) {
  const all = doc.surfaces.map((s) => s.id);
  const t: SurfaceActions[] = all.map((surface) => ({ surface, actions: [clear("FULL"), clear("OVERLAY"), ...media(doc, surface, "EVT", "TEST", null, LOOP, "TEST").map((m) => ({ layer: "BASE" as const, op: "show" as const, media: m }))] }));
  add({ id: "EVT.TEST", group: "EVT", name: "Screen test patterns", origin: "pack", scope: all, targets: t, trigger: "Line-up / focus / any time you need to see the screens", d3: { tag, transports: all } });
}

export const boxingPressConference: Pack = {
  id: "boxing.pressconf", name: "Boxing — Press Conference",
  deriveCues(doc) {
    const F = doc.data.fighters; const bouts = [...doc.data.bouts].sort((a: any, b: any) => a.order - b.order);
    const tables = doc.surfaces.filter((s) => /TABLE/i.test(s.id)); const walls = doc.surfaces.filter((s) => !s.independent).map((s) => s.id);
    const cues: Cue[] = []; let n = 0; const add = (c: Omit<Cue, "n">) => cues.push({ n: ++n, ...c });
    const main = bouts.find((b: any) => b.isMain) ?? bouts.at(-1); const co = bouts.find((b: any) => b.isCoMain);
    const holds: [string, string][] = main ? [["MAIN", `${F[main.red].name} v ${F[main.blue].name}`]] : []; if (co) holds.push(["COMAIN", `${F[co.red].name} v ${F[co.blue].name}`]); holds.push(["STEP", "Step and repeat"]);
    holds.forEach(([v, label], i) => { const t = targets(doc, "HOLD", "PC", v, "BASE", LOOP, label, walls, [clear("FULL"), clear("OVERLAY")]); add({ id: `PC.HOLD_${v}`, group: "PC", name: `Hold — ${label}`, origin: "pack", ...t, trigger: v === "STEP" ? "Face-off / photos" : "Before and between sessions", d3: { tag: `100.${i + 1}`, transports: t.scope } }); });
    for (const b of bouts) {
      const N = 100 + b.order; const red = F[b.red], blue = F[b.blue];
      const face = targets(doc, "TALE", b.id, null, "BASE", LOOP, `${red.name} v ${blue.name}`, walls, [clear("FULL")]);
      add({ id: `${b.id}.PC_FACEOFF`, group: b.id, name: `Face-off — ${red.name} v ${blue.name}`, origin: "pack", ...face, trigger: "Fighters called to stage", d3: { tag: `${N}.1`, transports: face.scope } });
      for (const side of ["red", "blue"] as const) {
        const f = side === "red" ? red : blue;
        const intro = targets(doc, "FIGHTER", b.id, side.toUpperCase(), "FULL", { kind: "timed", holdSec: 8, then: "clear" }, `${f.name} ${record(f)}`, walls);
        add({ id: `${b.id}.PC_INTRO_${side.toUpperCase()}`, group: b.id, name: `Intro — ${f.name}`, origin: "pack", ...intro, trigger: "MC introduces (brief, light animation)", d3: { tag: `${N}.${side === "red" ? 2 : 3}`, transports: intro.scope } });
      }
      // table cards: one fighter per table surface; assign red to odd tables, blue to even, per bout
      tables.forEach((tbl, i) => {
        const side = i % 2 === 0 ? "red" : "blue"; const f = side === "red" ? red : blue;
        const t = targets(doc, "FIGHTER", b.id, side.toUpperCase(), "BASE", LOOP, `${f.name}`, [tbl.id]);
        add({ id: `${b.id}.PC_TABLE_${tbl.id}`, group: b.id, name: `Table ${tbl.name} — ${f.name}`, origin: "pack", ...t, trigger: "Fighters seated", d3: { tag: `${N}.${10 + i}`, transports: t.scope } });
      });
      const step = targets(doc, "HOLD", "PC", "STEP", "BASE", LOOP, "Step and repeat", walls, [clear("FULL")]);
      add({ id: `${b.id}.PC_STEP`, group: b.id, name: "Step and repeat (photos)", origin: "pack", ...step, trigger: "Face-off photos", d3: { tag: `${N}.9`, transports: step.scope } });
    }
    addTestCue(doc, add, "100.99");
    return cues;
  },
};

export const boxingWeighIn: Pack = {
  id: "boxing.weighin", name: "Boxing — Weigh-in",
  deriveCues(doc) {
    const F = doc.data.fighters; const bouts = [...doc.data.bouts].sort((a: any, b: any) => a.order - b.order);
    const scale = doc.surfaces.filter((s) => /SCALE/i.test(s.id)).map((s) => s.id); const walls = doc.surfaces.filter((s) => !s.independent).map((s) => s.id);
    const scaleTargets = doc.routing.SCALE ?? (scale.length ? scale : walls);           // scale panels if the venue has them, else the wall behind the prop
    const marker = Number(doc.routing.SCALE_MARKER_SEC?.[0] ?? 4);
    const cues: Cue[] = []; let n = 0; const add = (c: Omit<Cue, "n">) => cues.push({ n: ++n, ...c });
    const main = bouts.find((b: any) => b.isMain) ?? bouts.at(-1);
    if (main) {
      const hold = targets(doc, "HOLD", "WI", "MAIN", "BASE", LOOP, `${F[main.red].name} v ${F[main.blue].name}`, walls, [clear("FULL")]);
      add({ id: "WI.HOLD_MAIN", group: "WI", name: "Hold — main event", origin: "pack", ...hold, trigger: "Before / between weigh-ins", d3: { tag: "200.1", transports: hold.scope } });
    }
    const step = targets(doc, "HOLD", "WI", "STEP", "BASE", LOOP, "Step and repeat", walls, [clear("FULL")]);
    add({ id: "WI.HOLD_STEP", group: "WI", name: "Step and repeat", origin: "pack", ...step, trigger: "Photos", d3: { tag: "200.2", transports: step.scope } });
    for (const b of bouts) {
      const N = 200 + b.order; const red = F[b.red], blue = F[b.blue];
      const face = targets(doc, "TALE", b.id, null, "BASE", LOOP, `${red.name} v ${blue.name}`, walls, [clear("FULL")]);
      add({ id: `${b.id}.WI_MATCHUP`, group: b.id, name: `Matchup — ${red.name} v ${blue.name}`, origin: "pack", ...face, trigger: "Bout called", d3: { tag: `${N}.1`, transports: face.scope } });
      (["red", "blue"] as const).forEach((side, k) => {
        const f = side === "red" ? red : blue; const S = side.toUpperCase();
        const walk = targets(doc, "FIGHTER", b.id, S, "FULL", LOOP, `${f.name} ${record(f)}`, walls);
        add({ id: `${b.id}.WI_WALK_${S}`, group: b.id, name: `Walk — ${f.name}`, origin: "pack", ...walk, trigger: `${f.name} to the scale`, d3: { tag: `${N}.${2 + k * 2}`, transports: walk.scope } });
        const sc = targets(doc, "SCALE", b.id, S, "FULL", { kind: "playToMarker", markerSec: marker }, `${f.name} — weight`, scaleTargets);
        add({ id: `${b.id}.WI_SCALE_${S}`, group: b.id, name: `Scale reveal — ${f.name}`, origin: "pack", ...sc, trigger: "Fighter steps on; plays to the reveal and pauses (operator releases)", d3: { tag: `${N}.${3 + k * 2}`, transports: sc.scope }, notes: "Separate scale file per fighter; weight text updated live via /api/text/weight_" + side });
      });
      const off = targets(doc, "TALE", b.id, null, "BASE", LOOP, `${red.name} v ${blue.name}`, walls, [clear("FULL")]);
      add({ id: `${b.id}.WI_FACEOFF`, group: b.id, name: `Face-off — ${red.name} v ${blue.name}`, origin: "pack", ...off, trigger: "Both weighed", d3: { tag: `${N}.7`, transports: off.scope } });
      add({ id: `${b.id}.WI_STEP`, group: b.id, name: "Step and repeat (photos)", origin: "pack", ...targets(doc, "HOLD", "WI", "STEP", "BASE", LOOP, "Step and repeat", walls, [clear("FULL")]), trigger: "Photos", d3: { tag: `${N}.9`, transports: walls } });
    }
    addTestCue(doc, add, "200.99");
    return cues;
  },
};
