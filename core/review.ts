/**
 * The confirm flow: the questions a parse or a delivery leaves open, and the operator's answers.
 *
 * Every inference still lands in review.flags as a sentence (the legend, the CLI and the chip count read those).
 * A typed ConfirmItem sits beside it in review.items with `text` = that exact sentence; a sentence with no typed
 * form becomes a "Seen it" note card. Answers live in doc.decisions by item key (fighter ids / pair keys — what
 * mergeSheets already maps) and are re-applied by applyDecision: always "set to", never "toggle", so replaying is
 * idempotent. Pure: no node imports — the UI imports this module too.
 */
import type { ShowDoc, ConfirmItem, ConfirmKind, Decision } from "./types.js";
import type { Scheme } from "./intake/scheme.js";
import type { IntakeOptions } from "./intake/match.js";

/** flags that describe the doc's state, not an inference — never a card, never counted */
export const STATE_FLAG = /placeholder|no bouts yet|no screens yet/i;
export const DECK_ORDER: ConfirmKind[] = ["corners", "numbering", "sides", "running-order", "main", "walk-order", "file-side", "hold-variant", "aspect", "country", "rounds", "weight-class", "anthems", "note"];
const DOC_KINDS: ConfirmKind[] = ["corners", "running-order", "main", "walk-order", "country", "rounds", "weight-class", "anthems"];

export const pairKey = (a: string, b: string) => [a, b].sort().join("|");
/** "note:" + djb2 of the sentence, base36 — stable across restarts, no node crypto */
export const noteKey = (text: string) => { let h = 5381; for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0; return `note:${h.toString(36)}`; };

/** record a typed question: the sentence goes to flags (as today), the card beside it */
export function raise(review: ShowDoc["review"], item: ConfirmItem): void { review.flags.push(item.text); (review.items ??= []).push(item); }

export function boutOfPair(doc: ShowDoc, pk: string): any | undefined { return (doc.data.bouts ?? []).find((b: any) => pairKey(b.red, b.blue) === pk); }
export function fighterSide(doc: ShowDoc, fid: string): { order: number; side: "red" | "blue" } | null {
  const b = (doc.data.bouts ?? []).find((x: any) => x.red === fid || x.blue === fid);
  return b ? { order: b.order, side: b.red === fid ? "red" : "blue" } : null;
}

/** the open questions, in the order the operator should meet them */
export function deck(doc: ShowDoc): ConfirmItem[] {
  const answered = new Set(Object.keys(doc.decisions ?? {}));
  const all = doc.review.items ?? [];
  const items = all.filter((i) => !answered.has(i.key));
  // an answered card's sentence must not come back as a note — cover with ALL items, answered or not
  const covered = new Set(all.flatMap((i) => [i.text, ...(i.covers ?? [])]));
  const notes: ConfirmItem[] = (doc.review.flags ?? []).filter((f) => !covered.has(f) && !STATE_FLAG.test(f))
    .map((f) => ({ key: noteKey(f), kind: "note" as const, source: "sheet" as const, question: f, options: [{ id: "seen", label: "Seen it", suggested: true }], text: f }))
    .filter((n) => !answered.has(n.key));
  const seen = new Set<string>(); const out: { i: ConfirmItem; idx: number }[] = [];
  [...items, ...notes].forEach((i, idx) => { if (seen.has(i.key)) return; seen.add(i.key); out.push({ i, idx }); });
  out.sort((a, b) => DECK_ORDER.indexOf(a.i.kind) - DECK_ORDER.indexOf(b.i.kind) || a.idx - b.idx);
  return out.map((x) => x.i);
}
export const confirmCount = (doc: ShowDoc) => deck(doc).length;

const rename = (bouts: any[]) => bouts.forEach((b, i) => { b.order = i + 1; b.id = `B${String(i + 1).padStart(2, "0")}`; });
const vsOf = (doc: ShowDoc, b: any) => `${doc.data.fighters?.[b.red]?.name ?? b.red} v ${doc.data.fighters?.[b.blue]?.name ?? b.blue}`;

/** apply one answer to the doc (mutates doc.data / doc.event). Returns what changed and whether the delivery must be re-matched. */
export function applyDecision(doc: ShowDoc, item: ConfirmItem, value: any): { changed: string[]; rematch: boolean } {
  const bouts: any[] = doc.data.bouts ?? []; const F = doc.data.fighters ?? {}; const d = item.data ?? {};
  const changed: string[] = [];
  switch (item.kind) {
    case "corners": {
      let n = 0;
      for (const p of (d.pairs ?? []) as { left: string; right: string }[]) {
        const b = bouts.find((x) => (x.red === p.left || x.blue === p.left) && (x.red === p.right || x.blue === p.right)); if (!b) continue;
        b.red = value === "red" ? p.left : p.right; b.blue = value === "red" ? p.right : p.left; n++;
      }
      // the a/b thumbnails were judged against the old corners — that answer no longer holds
      if (doc.decisions?.sides) delete doc.decisions.sides;
      changed.push(`Corners set on ${n} bout${n === 1 ? "" : "s"}`); return { changed, rematch: true };
    }
    case "running-order": {
      const listed: string[] = d.listed ?? []; const idx = (b: any) => listed.indexOf(pairKey(b.red, b.blue));
      const known = bouts.filter((b) => idx(b) >= 0).sort((a, b) => idx(a) - idx(b)); const extra = bouts.filter((b) => idx(b) < 0);
      if (value === "main") known.reverse();
      const next = [...known, ...extra]; rename(next);
      next.forEach((b, i) => { b.isMain = i === next.length - 1; b.isCoMain = next.length > 1 && i === next.length - 2; });
      doc.data.bouts = next;
      if (next.length) changed.push(`Running order: ${vsOf(doc, next[0])} opens, ${vsOf(doc, next[next.length - 1])} closes`);
      return { changed, rematch: true };
    }
    case "main": {
      const main = boutOfPair(doc, String(value)); if (!main) return { changed, rematch: false };
      for (const b of bouts) { b.isMain = b === main; b.isCoMain = b.order === main.order - 1; }
      changed.push(`Main event: ${vsOf(doc, main)}`); return { changed, rematch: true };
    }
    case "walk-order": {
      const first = value === "blue" ? "blue" : "red"; const order = [first, first === "red" ? "blue" : "red"];
      doc.event.walkOrder = [...order]; doc.event.introOrder = [...order];
      changed.push(`${first === "red" ? "Red" : "Blue"} walks first`); return { changed, rematch: false };
    }
    case "country": {
      const fid = item.key.slice("country:".length); const f = F[fid]; if (!f) return { changed, rematch: false };
      f.country = String(value).toUpperCase(); changed.push(`${f.name}: country ${f.country}`); return { changed, rematch: false };
    }
    case "rounds": case "weight-class": case "anthems": {
      const b = boutOfPair(doc, item.key.slice(item.key.indexOf(":") + 1)); if (!b) return { changed, rematch: false };
      if (item.kind === "rounds") { b.rounds = Number(value); changed.push(`${vsOf(doc, b)}: ${b.rounds} rounds`); }
      else if (item.kind === "weight-class") { b.weightClass = String(value); changed.push(`${vsOf(doc, b)}: ${b.weightClass}`); }
      else { b.anthems = Array.isArray(value) ? value : []; changed.push(`${vsOf(doc, b)}: anthems ${b.anthems.join(", ") || "none"}`); }
      return { changed, rematch: false };
    }
    case "numbering": case "sides": case "file-side": case "hold-variant": case "aspect": return { changed, rematch: true };
    default: return { changed, rematch: false };
  }
}

/** re-apply every recorded answer whose question is currently raised (an item exists), in deck order */
export function applyDecisions(doc: ShowDoc): { changed: string[]; rematch: boolean } {
  const changed: string[] = []; let rematch = false;
  const sides = doc.decisions?.sides; // a replayed corners answer is the same corners the a/b answer was judged against
  const items = [...(doc.review.items ?? [])].map((i, idx) => ({ i, idx })).sort((a, b) => DECK_ORDER.indexOf(a.i.kind) - DECK_ORDER.indexOf(b.i.kind) || a.idx - b.idx);
  for (const { i } of items) { const dec = doc.decisions?.[i.key]; if (!dec) continue; const r = applyDecision(doc, i, dec.value); changed.push(...r.changed); rematch ||= r.rematch; }
  if (sides && doc.decisions && !doc.decisions.sides) doc.decisions.sides = sides;
  return { changed, rematch };
}

const PAIR_PREFIX = /^(rounds|weightclass|anthems):(.+)$/;
const rekeyKey = (key: string, m: (id: string) => string) => {
  if (key.startsWith("country:")) return `country:${m(key.slice(8))}`;
  const pm = key.match(PAIR_PREFIX); if (pm) { const [a, b] = pm[2].split("|"); return `${pm[1]}:${pairKey(m(a), m(b ?? a))}`; }
  return key;
};
const rekeyPair = (pk: string, m: (id: string) => string) => { const [a, b] = pk.split("|"); return b === undefined ? m(a) : pairKey(m(a), m(b)); };

/** fighter ids in an item after a merge mapped incoming ids onto the base card */
export function rekeyItem(item: ConfirmItem, idMap: Record<string, string>): ConfirmItem {
  const m = (id: string) => idMap[id] ?? id;
  const out: ConfirmItem = { ...item, key: rekeyKey(item.key, m) };
  if (item.anchor?.fighters) out.anchor = { ...item.anchor, fighters: item.anchor.fighters.map(m) };
  if (item.data) {
    const d = { ...item.data };
    if (Array.isArray(d.pairs)) d.pairs = d.pairs.map((p: any) => ({ ...p, left: m(p.left), right: m(p.right) }));
    if (Array.isArray(d.listed)) d.listed = d.listed.map((pk: string) => rekeyPair(pk, m));
    if (Array.isArray(d.candidates)) d.candidates = d.candidates.map((pk: string) => rekeyPair(pk, m));
    if (Array.isArray(d.fighters)) d.fighters = d.fighters.map(m);
    if (item.kind === "main" && typeof d.assumed === "string") d.assumed = rekeyPair(d.assumed, m);
    out.data = d;
  }
  if (item.kind === "main") out.options = item.options.map((o) => ({ ...o, id: rekeyPair(o.id, m) }));
  if (item.kind === "file-side") out.options = item.options.map((o) => (o.id === "skip" ? o : { ...o, id: m(o.id) }));
  return out;
}
export function rekeyDecisions(d: Record<string, Decision>, idMap: Record<string, string>): Record<string, Decision> {
  const m = (id: string) => idMap[id] ?? id; const out: Record<string, Decision> = {};
  for (const [key, dec] of Object.entries(d)) {
    let value = dec.value;
    if (dec.kind === "main" && typeof value === "string") value = rekeyPair(value, m);
    if (dec.kind === "file-side" && value && typeof value === "object" && value.fighter) value = { ...value, fighter: m(value.fighter) };
    out[rekeyKey(key, m)] = { ...dec, value };
  }
  return out;
}

/** what the recorded answers mean for the next intake run */
export function intakeOptionsFrom(doc: ShowDoc): { override: { direction?: Scheme["direction"]; aIs?: Scheme["aIs"] }; assign: NonNullable<IntakeOptions["assign"]> } {
  const d = doc.decisions ?? {}; const assign: NonNullable<IntakeOptions["assign"]> = {};
  for (const [k, v] of Object.entries(d)) if (k.startsWith("assign:") && v.value && typeof v.value === "object") assign[k.slice(7)] = v.value;
  const dir = d.numbering?.value, aIs = d.sides?.value;
  return { override: { direction: dir === "opener-first" || dir === "main-first" ? dir : undefined, aIs: aIs === "red" || aIs === "blue" ? aIs : undefined }, assign };
}

/** the human line for an answer: the option's label when there is one */
export function decisionText(item: ConfirmItem, value: any): string {
  const id = value && typeof value === "object" && !Array.isArray(value) ? (value.fighter ?? value.variant ?? (value.skip ? "skip" : "ok")) : Array.isArray(value) ? value.join(",") : String(value);
  const opt = item.options.find((o) => o.id === id);
  if (opt) return opt.label;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export const isDocKind = (k: ConfirmKind) => DOC_KINDS.includes(k);
