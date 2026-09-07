/**
 * Delivery -> slot assignments. Path evidence + probe truth + the resolved numbering scheme, scored per file, with every
 * disagreement surfaced. Updates (_Updates/…) override originals for the same slot.
 */
import type { ShowDoc } from "../types.js";
import type { mediaManifest } from "../gen/engines.js";
import type { Probe } from "./intake.js";
import { tokenise, screenFromEvidence, type FileEvidence, type ScreenSynonyms, type GraphicKind } from "./tokens.js";
import { resolveScheme, sheetBout, sheetSide, fightersNamed, type Scheme } from "./scheme.js";
import { applyOcr, type OcrResult } from "./ocr.js";

export interface Assignment { slot: string; file: string; confidence: number; reasons: string[]; issues: string[]; update?: boolean }
export interface IntakeResult {
  scheme: Scheme;
  assignments: Assignment[];                     // one per filled slot (best file wins)
  unmatched: { file: string; evidence: FileEvidence; why: string; candidates: string[] }[];
  ignored: { file: string; why: string }[];
  unfilled: string[];                            // manifest slots with no file
  issues: string[];                              // delivery-level problems (folder/file disagreements, count mismatches)
}

type Slot = ReturnType<typeof mediaManifest>[number];
const KIND_TO_GRAPHIC: Record<GraphicKind, string | null> = { WALKOUT: "WALKOUT", ROUND: "ROUND", WINNER: "WINNER", UP_NEXT: "UP_NEXT", TALE: "TALE", HOLD: "HOLD", FIGHTER: "FIGHTER", FLAG: "FLAG", VT: "VT", UNKNOWN: null };

function slotParts(slot: Slot) {
  // {GROUP}_{GRAPHIC}[_{VARIANT}]_{SCREEN}_{W}x{H} — screen and size are known from the manifest entry, so anchor on them
  const tail = `_${slot.screen}_${slot.w}x${slot.h}`;
  if (!slot.slot.endsWith(tail)) return null;
  const head = slot.slot.slice(0, -tail.length);
  for (const g of ["UP_NEXT", "WALKOUT", "WINNER", "ROUND", "TALE", "HOLD", "FIGHTER", "FLAG", "VT"]) {
    const m = head.match(new RegExp(`^([A-Z0-9]+)_${g}(?:_(.+))?$`));
    if (m) return { group: m[1], graphic: g, variant: m[2] ?? "", screen: slot.screen };
  }
  return null;
}

export interface IntakeOptions { override?: Partial<Pick<Scheme, "direction" | "aIs">>; ocr?: Record<string, OcrResult> }

export function intake(doc: ShowDoc, manifest: Slot[], probes: Probe[], syn: ScreenSynonyms, opts: IntakeOptions = {}): IntakeResult {
  const byPath = new Map(probes.map((p) => [p.file, p]));
  const files = probes.map((p) => { const ev = tokenise(p.file, byPath.get(p.file)); const o = opts.ocr?.[p.file]; return o ? applyOcr(ev, o) : ev; });
  const scheme = resolveScheme(files, doc);
  if (opts.override?.direction) { scheme.direction = opts.override.direction; scheme.evidence.push(`direction set by operator: ${scheme.direction}`); }
  if (opts.override?.aIs) { scheme.aIs = opts.override.aIs; scheme.evidence.push(`a = ${scheme.aIs} set by operator`); }
  const N = doc.data.bouts.length; const bouts = [...doc.data.bouts].sort((a: any, b: any) => a.order - b.order);
  const parsed = manifest.map((s) => ({ s, p: slotParts(s) })).filter((x) => x.p);
  const result: IntakeResult = { scheme, assignments: [], unmatched: [], ignored: [], unfilled: [], issues: [] };
  if (scheme.boutCountMatches === false) result.issues.push(scheme.evidence.find((e) => /but sheet has/.test(e))!);
  const best = new Map<string, Assignment>();

  for (const ev of files) {
    if (ev.ignored) { result.ignored.push({ file: ev.file, why: ev.ignored }); continue; }
    const reasons: string[] = []; const issues: string[] = [...ev.conflicts];
    const graphic = KIND_TO_GRAPHIC[ev.kind];
    const scr = screenFromEvidence(ev, syn);
    if (scr.surface) reasons.push(`screen ${scr.surface} by ${scr.by}`);
    if ((ev as any).ocr?.words?.length) reasons.push(`ocr: ${(ev as any).ocr.words.slice(0, 4).join(" ")}`);
    // which bout / side does this file belong to?
    let boutOrder: number | null = null; let side: "red" | "blue" | null = null; let strength = 0;
    const named = fightersNamed(ev, doc);
    if (named.length && named[0].strength >= 0.8) {
      boutOrder = named[0].bout; side = named[0].side; strength = named[0].strength; reasons.push(`names ${named[0].id}`);
      if (ev.bout !== undefined) { const sb = sheetBout(ev.bout, scheme, N); if (sb !== null && sb !== boutOrder) issues.push(`filename bout ${ev.bout} maps to sheet bout ${sb} but the name belongs to bout ${boutOrder} — sheet wins`); }
      if (named.length > 1 && named[1].strength >= 0.8 && named[1].bout === named[0].bout && graphic !== "TALE" && graphic !== "UP_NEXT") { side = null; } // both fighters named -> matchup
    } else if (ev.bout !== undefined) {
      boutOrder = sheetBout(ev.bout, scheme, N); side = sheetSide(ev.side, scheme); strength = boutOrder ? 0.6 : 0;
      if (boutOrder === null) issues.push("numbering direction unresolved"); else reasons.push(`bout ${ev.bout} → sheet bout ${boutOrder} (${scheme.direction})`);
      if ((ev.side === "a" || ev.side === "b") && !side) issues.push("a/b side unresolved");
    }
    const bout = boutOrder ? bouts.find((b: any) => b.order === boutOrder) : null;
    // candidate slots
    const cands = parsed.filter(({ p }) => {
      if (!graphic || p!.graphic !== graphic) return false;
      if (!scr.surface || p!.screen !== scr.surface) return false;   // never guess a screen: pixels or a known screen word must say which
      if (graphic === "ROUND" && !bout) return ev.round !== undefined && p!.variant === String(ev.round).padStart(2, "0"); // generic round card set shared by every bout
      if (graphic === "HOLD" || graphic === "FLAG" || graphic === "VT") return p!.group === "EVT" || (bout && p!.group === bout.id);
      if (!bout) return false;
      if (graphic === "UP_NEXT") { const prev = bouts.find((b: any) => b.order === bout.order - 1); return p!.variant === bout.id && (prev ? p!.group === prev.id : p!.group === "EVT"); }
      if (p!.group !== bout.id) return false;
      if (graphic === "ROUND") return ev.round !== undefined && p!.variant === String(ev.round).padStart(2, "0");
      if (graphic === "TALE") return true;
      if (graphic === "WALKOUT" || graphic === "FIGHTER" || graphic === "WINNER") return side ? p!.variant === side.toUpperCase() : /^(RED|BLUE)$/.test(p!.variant);
      return false;
    });
    if (graphic === "HOLD" && cands.length > 1) { const pick = ev.names.some((n) => /sponsor|logo/.test(n)) ? "SPONSOR" : ev.names.some((n) => /co\s?main|comain/.test(n)) ? "COMAIN" : "MAIN"; const c2 = cands.filter((c) => c.p!.variant === pick); if (c2.length) { cands.length = 0; cands.push(...c2); reasons.push(`hold variant ${pick}`); } }
    if (!cands.length) { result.unmatched.push({ file: ev.file, evidence: ev, why: !graphic ? "graphic type not recognised" : !scr.surface && scr.candidates.length !== 1 ? `screen ambiguous (${scr.candidates.join(", ") || "none"}) at ${ev.probe?.w}x${ev.probe?.h}` : !bout && graphic !== "HOLD" && graphic !== "VT" && graphic !== "FLAG" ? "bout could not be determined" : "no slot for this combination", candidates: scr.candidates }); continue; }
    let conf = 0.3 + 0.3 * strength; if (scr.by === "both") conf += 0.25; else if (scr.by === "res") conf += 0.2; else if (scr.by === "word") conf += 0.1;
    if (ev.probe && cands[0].s.w === ev.probe.w && cands[0].s.h === ev.probe.h) conf += 0.1; else if (ev.probe) { conf -= 0.1; issues.push(`file is ${ev.probe.w}x${ev.probe.h}, slot wants ${cands[0].s.w}x${cands[0].s.h} — will scale`); }
    if (issues.some((i) => /sheet wins|folder/.test(i))) conf -= 0.15;
    conf = Math.max(0, Math.min(1, conf));
    const shared = graphic === "ROUND" && !bout; if (shared) reasons.push(`shared round card → ${cands.length} bouts`);
    for (const c of shared ? cands : cands.slice(0, 1)) { // one file fills one slot, except event-wide round cards which fill every bout's slot
      const a: Assignment = { slot: c.s.slot, file: ev.file, confidence: conf, reasons, issues, update: ev.update };
      const cur = best.get(a.slot);
      if (!cur || (a.update && !cur.update) || (a.update === cur.update && a.confidence > cur.confidence)) { if (cur) result.issues.push(`${a.slot}: '${cur.file}' replaced by '${a.file}' (${a.update ? "update folder" : "higher confidence"})`); best.set(a.slot, a); }
      else result.issues.push(`${a.slot}: duplicate candidate '${a.file}' kept out (existing '${cur.file}')`);
    }
  }
  // fight night usually has ONE per-fighter graphic used for both the walkout and the intro; fill whichever the promoter didn't name
  for (const { s: slot, p } of parsed) {
    if (best.has(slot.slot) || !p || (p.graphic !== "WALKOUT" && p.graphic !== "FIGHTER")) continue;
    const other = p.graphic === "WALKOUT" ? "FIGHTER" : "WALKOUT";
    const twin = parsed.find((x) => x.p!.group === p.group && x.p!.graphic === other && x.p!.variant === p.variant && x.p!.screen === p.screen);
    const src = twin && best.get(twin.s.slot);
    if (src) best.set(slot.slot, { slot: slot.slot, file: src.file, confidence: Math.min(src.confidence, 0.7), reasons: [...src.reasons, `${other.toLowerCase()} graphic reused for ${p.graphic.toLowerCase()}`], issues: [...src.issues], update: src.update });
  }
  result.assignments = [...best.values()].sort((a, b) => a.slot.localeCompare(b.slot));
  result.unfilled = parsed.map((x) => x.s.slot).filter((s) => !best.has(s));
  for (const a of result.assignments) for (const i of a.issues) if (/sheet wins|folder/.test(i)) result.issues.push(`${a.slot}: ${i}`);
  return result;
}
