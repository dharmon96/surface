/**
 * The Card Board: the whole show as one grid the operator can read at a glance.
 *   rows    = EVENT (holds, flags, VTs, first up-next) then bouts in running order
 *   columns = the graphics a bout needs (walkouts, fighter v fighter, up next, rounds, winner)
 *   cell    = the cue(s) behind that graphic + one entry per screen slot with its readiness:
 *             ready   converted output verified (or a PNG/copy that needs nothing)
 *             convert file found, not yet converted (will be scaled / letterboxed / encoded)
 *             missing no file for this slot
 * Pure assembly over things the server already knows (doc, cues, last intake, transcode manifest); no I/O except reading
 * the transcode manifest. Thumbnails are URLs the UI fetches lazily.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ShowDoc, Cue, ConfirmItem } from "../core/types.js";
import type { ManifestEntry } from "../core/intake/execute.js";

export type SlotStatus = "ready" | "convert" | "missing";
export interface BoardSlot { slot: string; screen: string; w: number; h: number; status: SlotStatus; file?: string; out?: string; thumb?: string; note?: string; confidence?: number; audio?: { integratedLufs: number; gainDb: number; targetLufs: number; capped: boolean } }
export interface BoardCell { key: string; label: string; cues: { n: number; id: string; name: string }[]; slots: BoardSlot[]; status: SlotStatus | "none"; thumb?: string; behaviour?: string }
export interface BoardRow { id: string; kind: "event" | "bout"; order: number; title: string; red?: { id: string; name: string; country?: string }; blue?: { id: string; name: string; country?: string }; meta: { rounds?: number; weightClass?: string; title?: string; isMain?: boolean; isCoMain?: boolean }; flags: string[]; cells: Record<string, BoardCell>; rounds?: { n: number; cue: number; status: SlotStatus | "none"; slots: BoardSlot[] }[]; /** open questions about this row — click one to open the deck there */ asks: { key: string; question: string }[] }
export interface Board {
  columns: { key: string; label: string; sub?: string }[];
  rows: BoardRow[];
  screens: { id: string; name: string; w: number; h: number; ready: number; total: number }[];
  missing: { row: string; label: string; screens: string[]; kind: SlotStatus }[];
  totals: { slots: number; ready: number; convert: number; missing: number; files: number; unmatched: number };
  delivery?: { dir: string; files: number; scheme: any; ocrRan?: number };
}

export const COLUMNS: Board["columns"] = [
  { key: "WALK_RED", label: "Walkout", sub: "red" }, { key: "WALK_BLUE", label: "Walkout", sub: "blue" },
  { key: "TALE", label: "Fighter v Fighter" }, { key: "UP_NEXT", label: "Up next" }, { key: "ROUNDS", label: "Rounds" }, { key: "WINNER", label: "Winner" },
];

export interface BoardInputs { doc: ShowDoc; cues: Cue[]; intake: { dir: string; probes: number; assignments: { slot: string; file: string; confidence: number; issues: string[] }[]; unmatched: any[]; scheme: any; ocrRan?: number; jobs: { slot: string; action: string; codec: string; out: string[]; notes: string[] }[] } | null; mediaDir?: string; thumbUrl: (absPath: string) => string; /** the open confirm questions, so each row can show its own */ deck?: ConfirmItem[] }

export function buildBoard(i: BoardInputs): Board {
  const { doc, cues } = i;
  const F = doc.data.fighters ?? {};
  const manifest: ManifestEntry[] = i.mediaDir && existsSync(join(i.mediaDir, "_manifest.json")) ? JSON.parse(readFileSync(join(i.mediaDir, "_manifest.json"), "utf8")) : [];
  const verified = new Map(manifest.map((m) => [m.slot, m]));
  const assigned = new Map((i.intake?.assignments ?? []).map((a) => [a.slot, a]));
  const jobs = new Map((i.intake?.jobs ?? []).map((j) => [j.slot, j]));
  const screenOf = (id: string) => doc.screens.find((s) => s.id === id)!;

  const slotsOf = (cs: Cue[]): BoardSlot[] => {
    const out = new Map<string, BoardSlot>();
    for (const c of cs) for (const t of c.targets) for (const a of t.actions) if (a.op === "show" && !out.has(a.media.slot)) {
      const slot = a.media.slot; const sc = doc.screens.find((s) => slot.includes(`_${s.id}_`)) ?? screenOf(t.surface);
      const v = verified.get(slot), as = assigned.get(slot), job = jobs.get(slot); const known = doc.media?.[slot] && i.mediaDir ? join(i.mediaDir, doc.media[slot]) : null;
      let s: BoardSlot;
      if (known && existsSync(known)) s = { slot, screen: sc.id, w: sc.w, h: sc.h, status: "ready", file: as?.file ?? doc.media![slot], out: known, thumb: i.thumbUrl(known), note: [v?.fallback ? `encoded as ${v.codec} (${v.fallback})` : "", v?.audio && Math.abs(v.audio.gainDb) >= 0.5 ? `audio ${v.audio.gainDb > 0 ? "+" : ""}${v.audio.gainDb} dB → ${v.audio.targetLufs} LUFS` : ""].filter(Boolean).join("; ") || undefined, confidence: as?.confidence, audio: v?.audio ? { integratedLufs: v.audio.integratedLufs, gainDb: v.audio.gainDb, targetLufs: v.audio.targetLufs, capped: v.audio.capped } : undefined };
      else if (v) s = { slot, screen: sc.id, w: sc.w, h: sc.h, status: "ready", file: as?.file ?? v.src, out: v.outputs[0], thumb: i.thumbUrl(v.outputs[0]), note: v.fallback ? `encoded as ${v.codec} (${v.fallback})` : undefined, confidence: as?.confidence };
      else if (as) { const needs = job ? job.action !== "copy" : false; s = { slot, screen: sc.id, w: sc.w, h: sc.h, status: needs ? "convert" : "ready", file: as.file, thumb: i.intake ? i.thumbUrl(join(i.intake.dir, as.file)) : undefined, note: [...(job?.notes ?? []), ...as.issues].join("; ") || undefined, confidence: as.confidence }; }
      else s = { slot, screen: sc.id, w: sc.w, h: sc.h, status: "missing" };
      out.set(slot, s);
    }
    return [...out.values()];
  };
  const worst = (slots: BoardSlot[]): BoardCell["status"] => !slots.length ? "none" : slots.some((s) => s.status === "missing") ? "missing" : slots.some((s) => s.status === "convert") ? "convert" : "ready";
  const cell = (key: string, label: string, cs: Cue[]): BoardCell => { const slots = slotsOf(cs); const best = slots.find((s) => s.thumb && s.screen === "MAIN") ?? slots.find((s) => s.thumb); return { key, label, cues: cs.map((c) => ({ n: c.n, id: c.id, name: c.name })), slots, status: worst(slots), thumb: best?.thumb, behaviour: cs[0]?.targets[0]?.actions.find((a) => a.op === "show")?.media.behaviour.kind }; };

  const rows: BoardRow[] = [];
  const byGroup = new Map<string, Cue[]>(); for (const c of cues) (byGroup.get(c.group) ?? byGroup.set(c.group, []).get(c.group)!).push(c);
  // event row
  const evt = byGroup.get("EVT") ?? []; const ev: Record<string, BoardCell> = {};
  for (const c of evt.filter((c) => c.id.startsWith("EVT.HOLD_"))) ev[c.id] = cell(c.id, c.name.replace(/^Hold — /, "Holding — "), [c]);
  const flags = evt.filter((c) => c.id.startsWith("EVT.FLAG_")); if (flags.length) ev.FLAGS = cell("FLAGS", `Anthem flags ×${flags.length}`, flags);
  const vts = cues.filter((c) => /^VT\./.test(c.id) || c.group === "VT"); if (vts.length) ev.VTS = cell("VTS", `VT ×${vts.length}`, vts);
  const first = evt.find((c) => c.id.startsWith("EVT.UP_NEXT_")); if (first) ev.UP_NEXT = cell("UP_NEXT", "Up next (pre-show)", [first]);
  const test = evt.find((c) => c.id === "EVT.TEST"); if (test) ev.TEST = cell("TEST", "Test patterns", [test]);
  // questions with no fighter of their own (numbering, sides, a hold) belong to the event row
  const evtAsks = (i.deck ?? []).filter((c) => c.anchor?.cell?.startsWith("EVT.") || (c.source === "delivery" && !c.anchor?.fighters?.length)).map((c) => ({ key: c.key, question: c.question }));
  rows.push({ id: "EVT", kind: "event", order: 0, title: "Holds · flags · VTs", meta: {}, flags: [], cells: ev, asks: evtAsks });
  // bouts
  const bouts = [...(doc.data.bouts ?? [])].sort((a: any, b: any) => a.order - b.order);
  let anyOpen = false;
  for (const b of bouts) {
    const cs = byGroup.get(b.id) ?? []; const find = (re: RegExp) => cs.filter((c) => re.test(c.id));
    const open = find(/\.VT_OPEN$/); if (open.length) anyOpen = true;
    const cells: Record<string, BoardCell> = {
      ...(open.length ? { OPEN: cell("OPEN", "Fight open", open) } : {}),
      WALK_RED: cell("WALK_RED", `${F[b.red]?.name ?? "red"} walkout`, find(/\.WALK_RED$/)),
      WALK_BLUE: cell("WALK_BLUE", `${F[b.blue]?.name ?? "blue"} walkout`, find(/\.WALK_BLUE$/)),
      TALE: cell("TALE", "Fighter v Fighter", find(/\.TALE$/)),
      UP_NEXT: cell("UP_NEXT", "Up next", find(/\.UP_NEXT$/)),
      WINNER: cell("WINNER", "Winner", find(/\.WIN_/)),
    };
    const rounds = find(/\.R\d\d$/).map((c) => { const slots = slotsOf([c]); return { n: Number(c.id.slice(-2)), cue: c.n, status: worst(slots), slots }; });
    const flagsForRow = (doc.review.flags ?? []).filter((f) => new RegExp(`^Bout ${b.order}\\b|\\b${b.id}\\b`).test(f));
    const asks = (i.deck ?? []).filter((c) => c.anchor?.fighters?.length && c.anchor.fighters.every((f) => f === b.red || f === b.blue)).map((c) => ({ key: c.key, question: c.question }));
    rows.push({ id: b.id, kind: "bout", order: b.order, title: `${F[b.red]?.name ?? "?"} v ${F[b.blue]?.name ?? "?"}`, red: { id: b.red, name: F[b.red]?.name ?? "?", country: F[b.red]?.country }, blue: { id: b.blue, name: F[b.blue]?.name ?? "?", country: F[b.blue]?.country }, meta: { rounds: b.rounds, weightClass: b.weightClass, title: b.title, isMain: b.isMain, isCoMain: b.isCoMain }, flags: flagsForRow, cells, rounds, asks });
  }

  // per-screen coverage, missing list, totals
  const all: { row: BoardRow; label: string; slots: BoardSlot[] }[] = [];
  for (const r of rows) { for (const c of Object.values(r.cells)) { if (c.key === "TEST") continue; /* test patterns are ours, not the promoter's */ all.push({ row: r, label: c.label, slots: c.slots }); } if (r.rounds) { const rs = r.rounds.flatMap((x) => x.slots); if (rs.length) all.push({ row: r, label: `Rounds 1–${r.rounds.length}`, slots: rs }); } }
  const screens = doc.screens.map((s) => { const mine = all.flatMap((x) => x.slots).filter((x) => x.screen === s.id); return { id: s.id, name: s.name, w: s.w, h: s.h, ready: mine.filter((x) => x.status === "ready").length, total: mine.length }; });
  const missing: Board["missing"] = [];
  for (const x of all) { const m = x.slots.filter((s) => s.status === "missing"); if (m.length) missing.push({ row: x.row.id, label: x.label, screens: [...new Set(m.map((s) => s.screen))], kind: "missing" }); const cv = x.slots.filter((s) => s.status === "convert" && /letterbox|scale|tile/i.test(s.note ?? "")); if (cv.length && !m.length) missing.push({ row: x.row.id, label: `${x.label} — ${cv[0].note}`, screens: [...new Set(cv.map((s) => s.screen))], kind: "convert" }); }
  const flat = all.flatMap((x) => x.slots); const dedup = new Map(flat.map((s) => [s.slot, s])); const S = [...dedup.values()];
  const columns = anyOpen ? [{ key: "OPEN", label: "Fight open", sub: "video" }, ...COLUMNS] : COLUMNS;
  return {
    columns, rows, screens, missing,
    totals: { slots: S.length, ready: S.filter((s) => s.status === "ready").length, convert: S.filter((s) => s.status === "convert").length, missing: S.filter((s) => s.status === "missing").length, files: i.intake?.probes ?? 0, unmatched: i.intake?.unmatched.length ?? 0 },
    delivery: i.intake ? { dir: i.intake.dir, files: i.intake.probes, scheme: i.intake.scheme, ocrRan: i.intake.ocrRan } : undefined,
  };
}

/** The list you send back to the promoter, in their words, not ours. */
export function promoterRequest(board: Board, doc: ShowDoc): string {
  const rows = new Map(board.rows.map((r) => [r.id, r])); const sz = (id: string) => { const s = doc.screens.find((x) => x.id === id); return s ? `${s.name} ${s.w}×${s.h}` : id; };
  const lines = [`${doc.event.name} — ${doc.event.date ?? ""} — graphics still needed`, ""];
  for (const m of board.missing.filter((m) => m.kind === "missing")) { const r = rows.get(m.row)!; lines.push(`${r.kind === "bout" ? `Bout ${r.order} (${r.title})` : "Event"}: ${m.label} — ${m.screens.map(sz).join(", ")}`); }
  const warn = board.missing.filter((m) => m.kind === "convert"); if (warn.length) { lines.push("", "Delivered but not at the screen's size (we will scale them unless you can re-render):"); for (const m of warn) { const r = rows.get(m.row)!; lines.push(`${r.kind === "bout" ? `Bout ${r.order} (${r.title})` : "Event"}: ${m.label}`); } }
  return lines.join("\n");
}
