/**
 * The questions a delivery leaves open, as confirm cards: numbering direction, a/b sides, files naming both fighters,
 * hold loops with no clear variant, graphics matched by shape only. Pure — the server adds thumbnail/proxy URLs.
 * Every item is `source: "delivery"` and every `text` starts with "Delivery: " (the server replaces them per run).
 */
import type { ShowDoc, ConfirmItem, ConfirmOption } from "../types.js";
import type { IntakeResult, IntakeOptions } from "./match.js";
import type { FileEvidence } from "./tokens.js";
import { fightersNamed, sheetBout } from "./scheme.js";

const WALKISH = (f: FileEvidence) => f.kind === "WALKOUT" || f.kind === "FIGHTER";
const ocrWords = (ev: FileEvidence | undefined) => (ev as any)?.ocr?.words?.slice(0, 6) as string[] | undefined;

export function deliveryItems(r: IntakeResult, doc: ShowDoc, opts: IntakeOptions, unreadable: { file: string; why: string }[]): { items: ConfirmItem[]; flags: string[] } {
  const items: ConfirmItem[] = [];
  const bouts: any[] = [...(doc.data.bouts ?? [])].sort((a, b) => a.order - b.order); const N = bouts.length; const F = doc.data.fighters ?? {};
  const boutAt = (n: number) => bouts.find((b) => b.order === n);
  const name = (fid: string) => F[fid]?.name ?? fid;
  const vs = (b: any) => b ? `${name(b.red)} v ${name(b.blue)}` : "?";
  const numbered = r.files.filter((f) => !f.ignored && f.bout !== undefined);
  const sc = r.scheme; const N1 = (k: number) => N + 1 - k;

  // (1) numbering: does 1 mean the opener or the main event?
  if (numbered.length && !opts.override?.direction) {
    const vote = sc.votes[0];
    const sample = vote ? { file: vote.file, base: vote.base, bout: vote.promoterBout, side: vote.promoterSide }
      : (() => { const f = numbered.find((x) => WALKISH(x) && x.bout !== N1(x.bout!)) ?? numbered[0]; return { file: f.file, base: f.base, bout: f.bout!, side: f.side }; })();
    const k = sample.bout; const bO = boutAt(k), bM = boutAt(N1(k)); const dir = sc.direction;
    const ev = r.files.find((f) => f.file === sample.file);
    items.push({
      key: "numbering", kind: "numbering", source: "delivery",
      question: vote ? `'${vote.base}' names ${name(vote.fighter)}, bout ${vote.sheetBout} on the sheet — so 1 = ${vote.reading === "opener-first" ? "the opener" : "the main event"}?`
        : `'${sample.base}' — is bout ${k} ${vs(bO)} (1 = the opener) or ${vs(bM)} (1 = the main event)?`,
      detail: `Files are numbered 1..${N}; the sheet has ${N} bouts.`,
      options: [{ id: "opener-first", label: `Bout ${k} = ${vs(bO)} · 1 is the opener`, suggested: dir === "opener-first" }, { id: "main-first", label: `Bout ${k} = ${vs(bM)} · 1 is the main event`, suggested: dir === "main-first" }],
      evidence: { files: [sample.file], ocr: ocrWords(ev) }, data: { sample: { file: sample.file, bout: k, side: sample.side } },
      text: dir !== "unknown" ? `Delivery: numbering read from filenames — 1 = ${dir === "opener-first" ? "the opener" : "the main event"} (confidence ${Math.round(sc.confidence * 100)}%); confirm` : "Delivery: numbering could not be read from filenames — 1 = the opener or the main event? confirm",
    });
  }
  // (2) sides: is a red or blue? Two thumbnails from one bout, the operator picks the red fighter's
  const ab = numbered.filter((f) => f.side === "a" || f.side === "b");
  if (sc.direction !== "unknown" && !opts.override?.aIs && ab.length) {
    const sb = (f: FileEvidence) => sheetBout(f.bout!, sc, N);
    const byBout = new Map<number, FileEvidence[]>(); for (const f of ab) { const k = sb(f); if (k !== null && k >= 1 && k <= N) (byBout.get(k) ?? byBout.set(k, []).get(k)!).push(f); }
    const has = (k: number, s: "a" | "b", walk = true) => byBout.get(k)?.some((f) => f.side === s && (!walk || WALKISH(f)));
    const both = [...byBout.keys()].filter((k) => has(k, "a") && has(k, "b")).sort((a, b) => a - b);
    const voteBout = sc.votes[0]?.sheetBout;
    const k = voteBout !== undefined && both.includes(voteBout) ? voteBout : both[0] ?? [...byBout.keys()].sort((a, b) => a - b)[0];
    if (k !== undefined) {
      const files = byBout.get(k)!; const walk = files.filter(WALKISH); const pool = walk.length ? walk : files;
      const a = pool.find((f) => f.side === "a"); const bMatch = a ? pool.find((f) => f.side === "b" && f.screenWords.join(" ") === a.screenWords.join(" ")) : undefined; const b = bMatch ?? pool.find((f) => f.side === "b");
      const bk = boutAt(k);
      items.push({
        key: "sides", kind: "sides", source: "delivery",
        question: `Bout ${k} is ${name(bk.red)} (RED) v ${name(bk.blue)} (BLUE). Which of these is ${name(bk.red)}?`, detail: "The files say a/b, not red/blue.",
        options: [a && { id: "red", label: `This one — '${a.base}' (a = red)`, file: a.file, tone: "red" as const, suggested: sc.aIs === "red" }, b && { id: "blue", label: `This one — '${b.base}' (a = blue)`, file: b.file, tone: "blue" as const, suggested: sc.aIs === "blue" }].filter(Boolean) as ConfirmOption[],
        anchor: { fighters: [bk.red, bk.blue] }, data: { bout: k, a: a?.file, b: b?.file },
        text: sc.aIs !== "unknown" ? `Delivery: sides read from filenames — a = ${sc.aIs}; confirm` : "Delivery: a/b sides could not be tied to red/blue — confirm which file is the red corner",
      });
    }
  }
  // (3) a corner file naming both fighters / with an unresolved a/b: whose is it?
  for (const u of r.unmatched) {
    if (!/corner unclear/.test(u.why)) continue;
    const ev = u.evidence; const named = fightersNamed(ev, doc).filter((h) => h.strength >= 0.8);
    const order = named[0]?.bout ?? (ev.bout !== undefined ? sheetBout(ev.bout, sc, N) : null);
    const b = order ? boutAt(order) : undefined; if (!b) continue;
    const kindWord = ev.kind === "WINNER" ? "winner" : ev.kind === "WALKOUT" ? "walkout" : "intro";
    items.push({
      key: `assign:${u.file}`, kind: "file-side", source: "delivery", question: `'${ev.base}' names both fighters — whose ${kindWord} is it?`,
      options: [{ id: b.red, label: `${name(b.red)} — RED`, tone: "red" }, { id: b.blue, label: `${name(b.blue)} — BLUE`, tone: "blue" }, { id: "skip", label: "Leave it out" }],
      evidence: { files: [u.file], ocr: ocrWords(ev) }, anchor: { fighters: [b.red, b.blue], cell: ev.kind === "WINNER" ? "WINNER" : undefined },
      data: { fighters: [b.red, b.blue], graphic: ev.kind }, text: `Delivery: '${ev.base}' names both fighters of bout ${b.order} — which corner? confirm`,
    });
  }
  // (4) a hold loop with no clear variant
  const main = bouts.find((b) => b.isMain) ?? bouts[bouts.length - 1]; const comain = bouts.find((b) => b.isCoMain && b !== main);
  for (const u of r.unmatched) {
    if (!/hold variant unclear/.test(u.why)) continue; const ev = u.evidence;
    items.push({
      key: `assign:${u.file}`, kind: "hold-variant", source: "delivery", question: `'${ev.base}' — which hold is this?`, detail: "It loops on the walls between fights.",
      options: [{ id: "MAIN", label: `Main-event hold · ${vs(main)}` }, comain ? { id: "COMAIN", label: `Co-main hold · ${vs(comain)}` } : null, { id: "SPONSOR", label: "Sponsor loop" }, { id: "skip", label: "Leave it out" }].filter(Boolean) as ConfirmOption[],
      evidence: { files: [u.file] }, anchor: { cell: "EVT.HOLD_MAIN" }, text: `Delivery: '${ev.base}' is a hold loop — main, co-main or sponsor? confirm`,
    });
  }
  // (5) matched by shape only: one card per file, all sharing today's aggregate sentence
  const byAspect = r.assignments.filter((a) => a.reasons.some((x) => x.startsWith("same shape as")));
  if (byAspect.length) {
    const text = `Delivery: ${byAspect.length} graphic(s) matched a screen by shape only, not exact pixels — check their thumbnails on the board`;
    const slotParts = (slot: string) => { for (const s of doc.screens) { const tail = `_${s.id}_${s.w}x${s.h}`; if (slot.endsWith(tail)) { const head = slot.slice(0, -tail.length); const i = head.indexOf("_"); return { screen: s, group: head.slice(0, i), rest: head.slice(i + 1) }; } } return null; };
    const cellOf = (rest: string) => rest === "WALKOUT_RED" ? "WALK_RED" : rest === "WALKOUT_BLUE" ? "WALK_BLUE" : rest === "TALE" ? "TALE" : rest.startsWith("UP_NEXT") ? "UP_NEXT" : rest.startsWith("WINNER") ? "WINNER" : undefined;
    const seen = new Set<string>();
    for (const a of byAspect) {
      if (seen.has(a.file)) continue; seen.add(a.file);
      const mine = byAspect.filter((x) => x.file === a.file); const parts = mine.map((x) => slotParts(x.slot)).filter(Boolean) as NonNullable<ReturnType<typeof slotParts>>[];
      const ev = r.files.find((f) => f.file === a.file); const w = ev?.probe?.w ?? 0, h = ev?.probe?.h ?? 0;
      const screens = [...new Map(parts.map((p) => [p.screen.id, p.screen])).values()]; const first = screens[0];
      const p0 = parts[0]; const bout = p0 && p0.group !== "EVT" ? bouts.find((b) => b.id === p0.group) : undefined;
      items.push({
        key: `assign:${a.file}`, kind: "aspect", source: "delivery",
        question: `'${ev?.base ?? a.file}' is ${w}×${h} — use it on ${screens.map((s) => s.name).join(", ") || "that screen"}${first ? ` (${first.w}×${first.h})` : ""}, scaled?`, detail: "Same shape within 1 %, not the exact pixels.",
        options: [{ id: "ok", label: "Yes, scale it", suggested: true }, { id: "skip", label: "Leave it out" }],
        evidence: { files: [a.file] }, anchor: { fighters: bout ? [bout.red, bout.blue] : undefined, cell: p0 ? cellOf(p0.rest) : undefined },
        data: { slot: a.slot, w, h, screens: screens.map((s) => s.id) }, text,
      });
    }
  }
  // (6) files ffprobe could not open — a plain sentence (a "Seen it" card)
  const flags = [...new Set(items.map((i) => i.text))];
  if (unreadable.length) flags.push(`Delivery: ${unreadable.length} file(s) could not be read at all — see the Media list`);
  return { items, flags };
}
