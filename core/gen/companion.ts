/**
 * Bitfocus Companion page files (.companionconfig, type "page", version 12 -> imports into v4.3 and v5.0).
 * Two targets:
 *   "bridge"  : every GO button calls Surface's HTTP API (generic-http module) — Surface resolves scope.
 *   "direct"  : buttons call resolume-arena (connectColumn) and disguise-osc (cue) modules themselves.
 */
import { createHash } from "node:crypto";
import type { Cue, ShowDoc } from "../types.js";
import { record } from "../naming.js";

const WHITE = 16777215;
const C = { RED: 0x8a2a1a, BLUE: 0x1f4a96, GOLD: 0x6b5314, GREY: 0x2e3340, DARK: 0x1c1f26, GREEN: 0x2c6b45, OFF: 0x111318, PANIC: 0xb00000 };
const id = (s: string) => createHash("md5").update(s).digest("hex").slice(0, 12);
const opt = (v: unknown) => ({ isExpression: false, value: String(v) });

export type CompanionMode = "bridge" | "direct";
export interface CompanionOpts { mode: CompanionMode; surfaceHost?: string; resolumeHost?: string; d3Host?: string }

function button(text: string, bg: number, actions: any[] = [], extra: Partial<{ size: string | number; color: number; feedbacks: any[] }> = {}) {
  return {
    type: "button", options: { stepProgression: "auto", rotaryActions: false },
    style: { text, textExpression: false, size: extra.size ?? "auto", alignment: "center:center", pngalignment: "center:center", color: extra.color ?? WHITE, bgcolor: bg, show_topbar: "default", png64: null },
    feedbacks: extra.feedbacks ?? [], localVariables: [],
    steps: { "0": { options: { runWhileHeld: [] }, action_sets: { down: actions, up: [] } } },
  };
}
const action = (conn: string, def: string, options: Record<string, unknown>, salt: string) =>
  ({ type: "action", id: id(salt), connectionId: conn, definitionId: def, upgradeIndex: null, options: Object.fromEntries(Object.entries(options).map(([k, v]) => [k, opt(v)])) });

function goActions(c: Cue, o: CompanionOpts): any[] {
  if (o.mode === "bridge") return [action("surface", "post", { url: `http://${o.surfaceHost ?? "127.0.0.1:8090"}/api/cue/${c.n}/go`, body: "", contenttype: "application/json" }, `sf${c.n}`)];
  const a: any[] = [];
  if (c.resolume) a.push(action("arena", "connectColumn", { column: c.resolume.column }, `arena${c.n}`));
  if (c.d3) { const [maj, min] = c.d3.tag.split("."); a.push(action("d3", "cue", { int: Number(maj) * 100 + Number(min) }, `d3${c.n}`)); }
  const round = c.id.match(/\.R(\d\d)$/); if (round) a.push(action("internal", "custom_variable_set_value", { name: "round", value: Number(round[1]) }, `rv${c.n}`));
  return a;
}
const roundFeedback = (r: number) => [{ type: "feedback", id: id(`fb${r}`), connectionId: "internal", definitionId: "variable_value", upgradeIndex: null, isInverted: false, options: { variable: opt("custom:round"), op: opt("eq"), value: opt(String(r)) }, style: { bgcolor: C.GREEN } }];

export function companionPage(doc: ShowDoc, cues: Cue[], boutId: string, page: number, o: CompanionOpts) {
  const b = doc.data.bouts.find((x: any) => x.id === boutId); const red = doc.data.fighters[b.red]; const blue = doc.data.fighters[b.blue];
  const K: Record<string, Cue> = {}; for (const c of cues) if (c.group === boutId) K[c.id.split(".")[1]] = c;
  const G: Record<string, Record<string, any>> = {};
  const put = (r: number, col: number, btn: any, cue?: Cue) => { (G[r] ??= {})[col] = btn; if (cue) cue.companion = { page, row: r, col }; };
  const last = (f: any) => String(f.name).split(" ").pop()!.toUpperCase();
  put(0, 0, button(`${last(red)}\\n${record(red)}`, C.RED, [], { size: "small" }));
  put(0, 1, button("WALK\\nRED", C.RED, goActions(K.WALK_RED, o)), K.WALK_RED);
  put(0, 2, button("INTRO\\nRED", C.RED, goActions(K.INTRO_RED, o)), K.INTRO_RED);
  Object.entries(K).filter(([k]) => k.startsWith("FLAG_")).slice(0, 2).forEach(([k, c], i) => put(0, 3 + i, button(`FLAG\\n${k.slice(5)}`, C.GOLD, goActions(c, o)), c));
  put(0, 5, button("INTRO\\nBLUE", C.BLUE, goActions(K.INTRO_BLUE, o)), K.INTRO_BLUE);
  put(0, 6, button("WALK\\nBLUE", C.BLUE, goActions(K.WALK_BLUE, o)), K.WALK_BLUE);
  put(0, 7, button(`${last(blue)}\\n${record(blue)}`, C.BLUE, [], { size: "small" }));
  for (let r = 1; r <= 12; r++) {
    const [row, col] = r <= 8 ? [1, r - 1] : [2, r - 9];
    const c = K[`R${String(r).padStart(2, "0")}`];
    put(row, col, c ? button(`R ${r}`, C.GREY, goActions(c, o), { feedbacks: roundFeedback(r) }) : button(`R ${r}`, C.OFF, [], { color: 0x6b7079 }), c);
  }
  put(2, 4, button("FIGHT\\nBASE", C.DARK, goActions(K.TALE, o)), K.TALE);
  put(2, 5, button("WIN\\nRED", C.RED, goActions(K.WIN_RED, o)), K.WIN_RED);
  put(2, 6, button("WIN\\nBLUE", C.BLUE, goActions(K.WIN_BLUE, o)), K.WIN_BLUE);
  put(2, 7, button("DRAW", C.GOLD, goActions(K.WIN_DRAW, o)), K.WIN_DRAW);
  const holds = cues.filter((c) => c.group === "EVT" && c.id.startsWith("EVT.HOLD_"));
  holds.slice(0, 3).forEach((c, i) => put(3, i, button(`HOLD\\n${c.id.slice(9)}`, C.DARK, goActions(c, o)), c));
  put(3, 4, b.order > 1 ? button(`◀ BOUT ${b.order - 1}`, C.DARK, [action("internal", "set_page", { page: page - 1 }, `pg${page}-`)]) : button("", C.OFF));
  put(3, 5, K.UP_NEXT ? button("UP NEXT", C.GREEN, goActions(K.UP_NEXT, o)) : button("", C.OFF), K.UP_NEXT);
  put(3, 6, K.UP_NEXT ? button(`BOUT ${b.order + 1} ▶`, C.DARK, [action("internal", "set_page", { page: page + 1 }, `pg${page}+`)]) : button("", C.OFF));
  put(3, 7, button("PANIC\\nBLACK", C.PANIC, o.mode === "bridge" ? [action("surface", "post", { url: `http://${o.surfaceHost ?? "127.0.0.1:8090"}/api/panic`, body: "", contenttype: "application/json" }, "panic")] : [action("arena", "compDisconnectAll", {}, "panic")]));
  const instances: Record<string, any> = o.mode === "bridge"
    ? { surface: { label: "surface", moduleId: "generic-http", enabled: true, isFirstInit: false, lastUpgradeIndex: -1, sortOrder: 0, config: { prefix: "" } } }
    : {
      arena: { label: "arena", moduleId: "resolume-arena", enabled: true, isFirstInit: false, lastUpgradeIndex: -1, sortOrder: 0, config: { host: o.resolumeHost ?? "127.0.0.1", useRest: true, webapiPort: 8080, port: 7000 } },
      d3: { label: "d3", moduleId: "disguise-osc", enabled: true, isFirstInit: false, lastUpgradeIndex: -1, sortOrder: 1, config: { host: o.d3Host ?? "10.0.0.10", send_port: 7401, recieve_port: 7400 } },
    };
  return {
    version: 12, type: "page", companionBuild: "surface-0.1", oldPageNumber: page, connectionCollections: [], instances,
    page: { name: `B${String(b.order).padStart(2, "0")} ${last(red)} v ${last(blue)}`, gridSize: { minColumn: 0, maxColumn: 7, minRow: 0, maxRow: 3 }, controls: G },
  };
}
