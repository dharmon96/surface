/**
 * Resolve the promoter's numbering scheme for a whole delivery, using the sheet as the authority and the files as evidence.
 *   direction : does "1" mean the opener or the main event?
 *   side      : is "a" red or blue?
 * One good filename disambiguates the bad ones; contradictions become review items, never silent guesses.
 */
import type { ShowDoc } from "../types.js";
import type { FileEvidence } from "./tokens.js";

export interface Scheme {
  direction: "opener-first" | "main-first" | "unknown";
  aIs: "red" | "blue" | "unknown";
  evidence: string[];
  confidence: number;                     // 0..1
  boutCountMatches: boolean | null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
function fighterTokens(doc: ShowDoc) {
  const out: { id: string; bout: number; side: "red" | "blue"; tokens: string[] }[] = [];
  for (const b of doc.data.bouts) for (const side of ["red", "blue"] as const) {
    const f = doc.data.fighters[b[side]]; if (!f) continue;
    const toks = String(f.name).split(/\s+/).map(norm).filter((t) => t.length > 2 && !/^(jr|sr|ii|iii)$/.test(t));
    if (f.nick) toks.push(...String(f.nick).split(/\s+/).map(norm).filter((t) => t.length > 3));
    out.push({ id: b[side], bout: b.order, side, tokens: toks });
  }
  return out;
}

/** Which fighter does this file name? Surname match beats first-name match; ambiguous surnames need a first name too. */
export function fightersNamed(ev: FileEvidence, doc: ShowDoc): { id: string; bout: number; side: "red" | "blue"; strength: number }[] {
  const F = fighterTokens(doc); const names = ev.names.map(norm);
  const hits: { id: string; bout: number; side: "red" | "blue"; strength: number }[] = [];
  for (const f of F) {
    const surname = f.tokens[f.tokens.length - 1]; const first = f.tokens[0];
    const sHit = names.includes(surname); const fHit = f.tokens.length > 1 && names.includes(first);
    if (!sHit && !fHit) continue;
    const shared = F.filter((g) => g !== f && g.tokens[g.tokens.length - 1] === surname).length; // duplicate surnames on the card
    let strength = sHit ? (shared ? 0.35 : 0.8) : 0.3; if (sHit && fHit) strength = 1;
    hits.push({ id: f.id, bout: f.bout, side: f.side, strength });
  }
  return hits.sort((a, b) => b.strength - a.strength);
}

export function resolveScheme(files: FileEvidence[], doc: ShowDoc): Scheme {
  const N = doc.data.bouts.length; const evidence: string[] = [];
  const numbered = files.filter((f) => !f.ignored && f.bout !== undefined);
  const maxBout = Math.max(0, ...numbered.map((f) => f.bout!));
  const boutCountMatches = numbered.length ? maxBout === N : null;
  if (numbered.length) evidence.push(boutCountMatches ? `files number bouts 1..${maxBout}, sheet has ${N} bouts` : `files number bouts up to ${maxBout} but sheet has ${N} bouts`);
  let opener = 0, main = 0, aRed = 0, aBlue = 0;
  for (const f of numbered) {
    const named = fightersNamed(f, doc).filter((h) => h.strength >= 0.8);
    for (const h of named) {
      if (h.bout === f.bout) opener += 1; else if (h.bout === N + 1 - f.bout!) main += 1; else continue;
      const dir = h.bout === f.bout ? "opener-first" : "main-first";
      evidence.push(`'${f.base}' names ${h.id} (sheet bout ${h.bout} ${h.side}) → ${dir}`);
      if (f.side === "a" || f.side === "b") { if ((f.side === "a") === (h.side === "red")) aRed += 1; else aBlue += 1; }
    }
  }
  // fallback: rounds-count evidence — a bout folder with 12 round files must be the 12-rounder
  const direction = opener > main ? "opener-first" : main > opener ? "main-first" : "unknown";
  const aIs = aRed > aBlue ? "red" : aBlue > aRed ? "blue" : "unknown";
  if (direction === "unknown" && numbered.length) evidence.push("no filename names a fighter — numbering direction must be confirmed (1 = opener or main?)");
  if (aIs === "unknown" && numbered.some((f) => f.side === "a" || f.side === "b")) evidence.push("a/b side could not be tied to red/blue from filenames — confirm");
  const votes = opener + main; const agree = Math.max(opener, main);
  const confidence = votes ? (agree / votes) * Math.min(1, votes / 3) : 0;
  return { direction, aIs, evidence, confidence, boutCountMatches };
}

/** Map a promoter bout number to the sheet's bout order under a scheme. */
export function sheetBout(promoterBout: number, scheme: Scheme, N: number): number | null {
  if (scheme.direction === "opener-first") return promoterBout;
  if (scheme.direction === "main-first") return N + 1 - promoterBout;
  return null;
}
export function sheetSide(side: FileEvidence["side"], scheme: Scheme): "red" | "blue" | null {
  if (side === "red" || side === "blue") return side;
  if (side === "a") return scheme.aIs === "unknown" ? null : scheme.aIs;
  if (side === "b") return scheme.aIs === "unknown" ? null : scheme.aIs === "red" ? "blue" : "red";
  return null;
}
