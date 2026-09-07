import type { ShowDoc } from "../types.js";
import { parseTimingSheet } from "./timing-sheet.js";
import { parseBoutSheet } from "./bout-sheet.js";
import { parseRundown, rundownToCustomCues } from "./rundown.js";
import { applyDecisions, rekeyDecisions, rekeyItem } from "../review.js";

export { parseTimingSheet, parseBoutSheet, parseRundown, rundownToCustomCues };
export type SheetKind = "timing_sheet" | "bout_sheet" | "rundown" | "unknown";

export function detectKind(text: string): SheetKind {
  if (/First Bell|Final Bell|READY BY/i.test(text) && /CORNER/i.test(text)) return "timing_sheet";
  if (/RUNNING ORDER|ON AIR:|\bNO\.\s+TIME\s+SOURCE/i.test(text)) return "rundown";
  if (/\bROUNDS?\b/i.test(text) && /\bvs\.?\b/i.test(text) && /CORNER/i.test(text)) return "bout_sheet";
  if (/\bROUNDS?\b/i.test(text) && /\bvs\.?\b/i.test(text)) return "bout_sheet";
  return "unknown";
}

export function parseSheet(text: string, sourceFile: string): ShowDoc | { kind: "rundown"; rundown: ReturnType<typeof parseRundown> } {
  const kind = detectKind(text);
  if (kind === "timing_sheet") return parseTimingSheet(text, sourceFile);
  if (kind === "bout_sheet") return parseBoutSheet(text, sourceFile);
  if (kind === "rundown") return { kind, rundown: parseRundown(text) };
  throw new Error(`could not recognise ${sourceFile} as a timing sheet, bout sheet or running order`);
}

/**
 * Merge a later sheet into an approved doc without losing review work: fighters matched by normalised name,
 * bouts by red/blue pair. Returns the merged doc plus a human-readable diff for the review screen.
 */
export function mergeSheets(base: ShowDoc, incoming: ShowDoc): { doc: ShowDoc; diff: string[] } {
  const diff: string[] = [];
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  const byName = new Map(Object.entries(base.data.fighters).map(([id, f]: any) => [norm(f.name), id]));
  // pass 1: incoming id → base id (new fighters take the next free ids, in sheet order)
  const idMap: Record<string, string> = {}; let nextId = Object.keys(base.data.fighters).length;
  for (const [iid, f] of Object.entries<any>(incoming.data.fighters)) { const bid = byName.get(norm(f.name)); idMap[iid] = bid ?? `F${String(++nextId).padStart(2, "0")}`; }
  // the operator's answers, replayed onto the new parse wherever it raises the same question — a sheet that states the
  // fact raises no question, so the sheet wins. Work on a copy: the caller's parse stays untouched.
  const inv = Object.fromEntries(Object.entries(idMap).map(([i, b]) => [b, i]));
  const inc: ShowDoc = { ...incoming, event: { ...incoming.event }, data: { ...incoming.data, fighters: Object.fromEntries(Object.entries<any>(incoming.data.fighters).map(([k, v]) => [k, { ...v }])), bouts: incoming.data.bouts.map((b: any) => ({ ...b })) }, review: { ...incoming.review, items: [...(incoming.review.items ?? [])] }, decisions: rekeyDecisions(base.decisions ?? {}, inv) };
  applyDecisions(inc);
  const fighters = { ...base.data.fighters };
  for (const [iid, f] of Object.entries<any>(inc.data.fighters)) {
    const bid = byName.get(norm(f.name));
    if (bid) { const b = fighters[bid]; for (const k of ["nick", "weightLbs", "height", "hometown", "record"] as const) { const nv = (f as any)[k]; if (nv != null && nv !== "" && JSON.stringify(nv) !== JSON.stringify(b[k])) { if (b[k] != null && b[k] !== "") diff.push(`${b.name}: ${k} ${JSON.stringify(b[k])} → ${JSON.stringify(nv)}`); b[k] = nv; } } if (f.country !== "??" && f.country !== b.country) { diff.push(`${b.name}: country ${b.country} → ${f.country}`); b.country = f.country; } }
    else { fighters[idMap[iid]] = f; diff.push(`NEW fighter ${f.name}`); }
  }
  const bouts = base.data.bouts.map((b: any) => ({ ...b }));
  const key = (b: any, m: Record<string, string> = {}) => `${m[b.red] ?? b.red}|${m[b.blue] ?? b.blue}`;
  const seen = new Set<string>();
  for (const ib of inc.data.bouts) {
    const k = key(ib, idMap); seen.add(k);
    const bb = bouts.find((b: any) => key(b) === k || key(b) === k.split("|").reverse().join("|"));
    if (!bb) { bouts.push({ ...ib, red: idMap[ib.red], blue: idMap[ib.blue] }); diff.push(`NEW bout ${fighters[idMap[ib.red]].name} v ${fighters[idMap[ib.blue]].name}`); continue; }
    if (key(bb) !== k) { diff.push(`${fighters[bb.red].name} v ${fighters[bb.blue].name}: corners SWAPPED`); [bb.red, bb.blue] = [idMap[ib.red], idMap[ib.blue]]; }
    if (ib.rounds !== bb.rounds) { diff.push(`${fighters[bb.red].name} v ${fighters[bb.blue].name}: rounds ${bb.rounds} → ${ib.rounds}`); bb.rounds = ib.rounds; }
    if (ib.title && ib.title !== bb.title) { diff.push(`${fighters[bb.red].name} v ${fighters[bb.blue].name}: title → ${ib.title}`); bb.title = ib.title; }
    if (ib.timing && Object.keys(ib.timing).length) { for (const [tk, tv] of Object.entries(ib.timing)) if (bb.timing?.[tk] !== tv) { if (bb.timing?.[tk]) diff.push(`${fighters[bb.red].name} v ${fighters[bb.blue].name}: ${tk} ${bb.timing[tk]} → ${tv}`); bb.timing = { ...bb.timing, [tk]: tv }; } }
    if (ib.order !== bb.order) diff.push(`${fighters[bb.red].name} v ${fighters[bb.blue].name}: order ${bb.order} → ${ib.order}`);
    bb.order = ib.order;
  }
  for (const b of bouts) if (!seen.has(key(b)) && !seen.has(key(b).split("|").reverse().join("|"))) { diff.push(`REMOVED bout ${fighters[b.red].name} v ${fighters[b.blue].name} (not on the new sheet)`); b.removed = true; }
  const kept = bouts.filter((b: any) => !b.removed).sort((a: any, b: any) => a.order - b.order);
  kept.forEach((b: any, i: number) => { b.order = i + 1; b.id = `B${String(i + 1).padStart(2, "0")}`; });
  const event = { ...base.event, ...Object.fromEntries(Object.entries(inc.event).filter(([, v]) => v != null && v !== "")) };
  return { doc: { ...base, event, data: { ...base.data, fighters, bouts: kept }, source: inc.source, review: { status: "draft", flags: [...inc.review.flags, ...diff.map((d) => `CHANGED: ${d}`)], items: (inc.review.items ?? []).map((i) => rekeyItem(i, idMap)) }, decisions: base.decisions ?? {}, delivery: base.delivery }, diff };
}
