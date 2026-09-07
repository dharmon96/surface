/**
 * Turn a delivered file's path + probe into evidence. Meaning lives in folder names, filename fragments and pixels —
 * never in one place — so every level contributes tokens and the resolver weighs them.
 */
import type { Probe } from "./intake.js";

export type GraphicKind = "WALKOUT" | "ROUND" | "WINNER" | "UP_NEXT" | "TALE" | "HOLD" | "FIGHTER" | "FLAG" | "VT" | "UNKNOWN";

export interface FileEvidence {
  file: string;
  dir: string[];                     // folder segments (lowercased)
  base: string;                      // filename without extension
  ignored?: string;                  // reason this file is skipped (archive, layered source, sidecar)
  update?: boolean;                  // lives under an _Updates / revised folder -> wins over the original
  kind: GraphicKind; kindFrom: "file" | "dir" | "none";
  bout?: number; boutFrom?: "file" | "dir";           // promoter's bout number as written
  side?: "a" | "b" | "red" | "blue"; sideFrom?: "file" | "dir";
  round?: number;
  names: string[];                   // name-like tokens (not screen words, not kind words)
  screenWords: string[];             // tokens that look like screen names
  namedRes?: { w: number; h: number };   // resolution written in the path
  probe?: Probe;
  conflicts: string[];               // folder vs filename disagreements
}

const KIND_WORDS: Record<GraphicKind, RegExp> = {
  WALKOUT: /\b(walk\s?outs?|walkouts?|entrance|wo)\b/i,
  ROUND: /\b(rounds?|rd|rnd)\b/i,
  WINNER: /\b(winners?|win|victory)\b/i,
  UP_NEXT: /\b(up\s?next|upnext|next\s?up|coming\s?up)\b/i,
  TALE: /\b(mid\s?fights?|midfights?|tale|matchup|fighter\s*v\s*fighter|fvf|\w+\s+vs?\.?\s+\w+)\b/i,
  HOLD: /\b(holds?|holding|loop|sponsors?|logo|idle)\b/i,
  FIGHTER: /\b(fighter\s*names?|fighter|names?|intro)\b/i,
  FLAG: /\b(flags?|anthem)\b/i,
  VT: /\b(vt|vts|ads?|promo|spot|commercial|sizzle)\b/i,
  UNKNOWN: /$^/,
};
const KIND_ORDER: GraphicKind[] = ["UP_NEXT", "WALKOUT", "WINNER", "ROUND", "TALE", "HOLD", "FLAG", "VT", "FIGHTER"]; // specific before generic

export const SCREEN_WORDS = /\b(hung|centerhung|center\s?hung|main\s?(video)?\s?boo?ards?|main\s?video|main\s?board|scoreboard|full\s?bu?arge|barge|ribbons?|fascia|upper|lower|led|truss|wedge|signage|corner\s?(boards?|posts?)?|tunnel|imag|screens?|render|board|post|video)\b/gi;
const IGNORE_DIR = /(archi?e?ve|dont\s*use|do\s*not\s*use|old|layered|links|source|psd|ai files)/i;
const UPDATE_DIR = /(_?updates?|revis(ed|ions?)|v\d+|new|final)/i;

const norm = (s: string) => s.replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim();

export function tokenise(path: string, probe?: Probe): FileEvidence {
  const parts = path.split(/[\\/]/).filter(Boolean);
  const file = parts[parts.length - 1]; const dirs = parts.slice(0, -1);
  const base = file.replace(/\.[a-z0-9]+$/i, "");
  const ev: FileEvidence = { file: path, dir: dirs.map((d) => d.toLowerCase()), base, kind: "UNKNOWN", kindFrom: "none", names: [], screenWords: [], probe, conflicts: [] };
  if (dirs.some((d) => IGNORE_DIR.test(d))) ev.ignored = `folder '${dirs.find((d) => IGNORE_DIR.test(d))}' looks like archive/source material`;
  if (/\.(ai|psd|txt|aep|prproj|zip)$/i.test(file)) ev.ignored = "not a deliverable media file";
  if (dirs.some((d) => UPDATE_DIR.test(d))) ev.update = true;

  const scan = (text: string, from: "file" | "dir") => {
    const t = norm(text);
    // resolution written in the name
    const rm = t.match(/(\d{3,5})\s*[x×]\s*(\d{2,5})/i); if (rm && !ev.namedRes) ev.namedRes = { w: +rm[1], h: +rm[2] };
    const noRes = t.replace(/(\d{3,5})\s*[x×]\s*(\d{2,5})/gi, " ");
    // bout+side: "3a", "3 b", "bout 3 red", "fight 3"
    const bs = noRes.match(/\b(?:bout|fight)?\s*(\d{1,2})\s*([ab])\b/i) ?? noRes.match(/\b(\d{1,2})([ab])\b/i);
    if (bs) { const b = +bs[1], s = bs[2].toLowerCase() as "a" | "b"; if (ev.bout !== undefined && ev.bout !== b && ev.boutFrom !== from) ev.conflicts.push(`${from} says bout ${b}${s}, ${ev.boutFrom} says bout ${ev.bout}${ev.side ?? ""}`); if (ev.bout === undefined || from === "file") { ev.bout = b; ev.boutFrom = from; ev.side = s; ev.sideFrom = from; } }
    const rb = noRes.match(/\b(red|blue)\b/i); if (rb && !ev.side) { ev.side = rb[1].toLowerCase() as any; ev.sideFrom = from; }
    // kind
    for (const k of KIND_ORDER) if (KIND_WORDS[k].test(noRes)) { if (ev.kind === "UNKNOWN" || from === "file" && ev.kindFrom === "dir" && k !== "FIGHTER") { ev.kind = k; ev.kindFrom = from; } break; }
    // round number: "round 7", "r7", "rd 7", or a bare number inside a Rounds folder
    const rn = noRes.match(/\b(?:round|rnd|rd|r)\s*(\d{1,2})\b/i); if (rn) ev.round = +rn[1];
    // screen words
    for (const m of noRes.matchAll(SCREEN_WORDS)) ev.screenWords.push(m[0].toLowerCase().replace(/\s+/g, " "));
    // name-like tokens: alphabetic words >2 chars that are not kind/screen/noise words
    const noise = /^(the|and|for|with|final|render|copy|new|v\d+|mov|mp4|png|full|main|video|led|vs|v|jr|sr|ii|iii|dont|use|files|folder|approved|digital|screen|screens|pngs|loop|match|duo)$/i;
    for (const w of noRes.replace(SCREEN_WORDS, " ").split(/[^a-zÀ-ɏ']+/i)) if (w.length > 2 && !noise.test(w) && !KIND_ORDER.some((k) => KIND_WORDS[k].test(w))) ev.names.push(w.toLowerCase());
  };
  for (const d of dirs) scan(d, "dir");
  scan(base, "file");
  // bare number in a Rounds folder / Up Next folder / Midfights folder = round or bout number
  const bare = norm(base).match(/^(\d{1,2})$/);
  if (bare) { if (ev.kind === "ROUND") ev.round = +bare[1]; else if (ev.kind === "UP_NEXT" || ev.kind === "TALE" || ev.kind === "HOLD") { ev.bout = +bare[1]; ev.boutFrom = "file"; } }
  // a folder-vs-file bout disagreement is the promoter's mistake we most want to surface
  const dirBout = dirs.map((d) => norm(d).match(/^(\d{1,2})([ab])$/i)).find(Boolean);
  if (dirBout && ev.boutFrom === "file" && (+dirBout[1] !== ev.bout || dirBout[2].toLowerCase() !== ev.side)) ev.conflicts.push(`folder '${dirBout[0]}' but file says '${ev.bout}${ev.side}'`);
  ev.names = [...new Set(ev.names)];
  return ev;
}

/** Venue screen synonym table: promoter words -> surface id. Seeded per venue (PixelMapper), grown as promoters invent spellings. */
export interface ScreenSynonyms { [surfaceId: string]: { words: string[]; w: number; h: number } }

export function screenFromEvidence(ev: FileEvidence, syn: ScreenSynonyms): { surface: string | null; by: "res" | "word" | "both" | "aspect" | null; candidates: string[]; all?: string[] } {
  const byRes = new Set<string>(); const byWord = new Set<string>(); const byAspect = new Set<string>();
  const w = ev.probe?.w, h = ev.probe?.h;
  for (const [id, s] of Object.entries(syn)) {
    if (w && h && w === s.w && h === s.h) byRes.add(id);
    // promoters often render bigger than asked (4K for a 1080 wall) — same aspect within 1 % counts, pixels get scaled later
    else if (w && h && s.w && s.h && Math.abs(w / h - s.w / s.h) / (s.w / s.h) < 0.01) byAspect.add(id);
    if (ev.screenWords.some((sw) => s.words.some((x) => sw.replace(/\s/g, "") === x.replace(/\s/g, "")))) byWord.add(id);
    if (ev.namedRes && ev.namedRes.w === s.w && ev.namedRes.h === s.h && !byRes.size) byWord.add(id); // named res counts as a word, pixels count as truth
  }
  const both = [...byRes].filter((x) => byWord.has(x));
  if (both.length === 1) return { surface: both[0], by: "both", candidates: both };
  if (byRes.size === 1) return { surface: [...byRes][0], by: "res", candidates: [...byRes] };
  if (byRes.size > 1) { const same = [...byRes]; return { surface: same[0], by: "res", candidates: same, all: same }; } // identical screens (IMAG L + R): one file serves both
  const wordAspect = [...byWord].filter((x) => byAspect.has(x));
  if (wordAspect.length === 1) return { surface: wordAspect[0], by: "both", candidates: wordAspect };
  if (byWord.size === 1) return { surface: [...byWord][0], by: "word", candidates: [...byWord] };
  if (!byWord.size && byAspect.size) { const a = [...byAspect]; return { surface: a[0], by: "aspect", candidates: a, all: a }; } // every screen of that shape gets it
  return { surface: null, by: null, candidates: [...new Set([...byRes, ...byWord, ...byAspect])] };
}
