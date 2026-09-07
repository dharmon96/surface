/**
 * TV running order (pdftotext -layout) -> rows + header facts.
 * Columns are sliced by the character offsets of the "NO. TIME SOURCE SOUND GFX DESCRIPTION DUR" header on each page, which
 * survives the interleaving that whitespace-splitting cannot. We harvest what venue screens need: VTs, full-frame GFX, MC beats.
 */
export interface RundownRow { no: string; time?: string; source?: string; sound?: string; gfx?: string; description: string; durSec?: number; kind: "vt" | "gfx" | "mc" | "talk" | "other" }
export interface RundownDoc { title?: string; date?: string; venue?: string; onAir?: string; offAir?: string; card: { n: number; rounds?: number; weightClass?: string; a: string; b: string }[]; rows: RundownRow[]; flags: string[] }

const COLS = ["NO", "TIME", "SOURCE", "SOUND", "GFX", "DESCRIPTION", "DUR"] as const;
type Col = (typeof COLS)[number];
const dur = (s?: string) => { const m = s?.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/); if (!m) return undefined; return m[3] ? +m[1] * 3600 + +m[2] * 60 + +m[3] : +m[1] * 60 + +m[2]; };
const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Column geometry from the data itself: positions that are blank in (nearly) every line of a page are gutters; the spans
 * between gutters are columns; each header word claims the span it sits in, and header-less spans merge leftwards.
 */
function columnSpans(header: string, body: string[]): Array<{ col: Col; a: number; b: number }> | null {
  const u = header.toUpperCase(); const hpos: number[] = [];
  for (const c of COLS) { const i = u.indexOf(c); if (i < 0) return null; hpos.push(i); }
  const width = Math.max(header.length, ...body.map((l) => l.length)) + 1;
  // a cut between columns b-1 and b is a gutter if no word in any line crosses it (allow 1 stray line)
  const crossings = new Array(width + 1).fill(0);
  for (const l of body) for (let i = 1; i < l.length; i++) if (l[i - 1] !== " " && l[i] !== " ") crossings[i]++;
  const isGutter = (i: number) => i >= width || crossings[i] <= 1;
  // boundary between adjacent headers = the gutter column nearest the midpoint between them
  const bounds: number[] = [0];
  for (let k = 1; k < hpos.length; k++) {
    const mid = Math.round((hpos[k - 1] + hpos[k]) / 2); let best = mid;
    for (let d = 0; d <= 24; d++) { if (isGutter(mid - d) && mid - d > hpos[k - 1]) { best = mid - d; break; } if (isGutter(mid + d) && mid + d <= hpos[k]) { best = mid + d; break; } }
    bounds.push(best);
  }
  return COLS.map((col, i) => ({ col, a: bounds[i], b: i + 1 < COLS.length ? bounds[i + 1] : Number.MAX_SAFE_INTEGER }));
}
function sliceRow(l: string, spans: Array<{ col: Col; a: number; b: number }>): Record<Col, string> {
  const out: any = { NO: "", TIME: "", SOURCE: "", SOUND: "", GFX: "", DESCRIPTION: "", DUR: "" };
  for (const s of spans) out[s.col] += (out[s.col] ? " " : "") + l.slice(s.a, s.b === Number.MAX_SAFE_INTEGER ? undefined : s.b);
  return out;
}

export function parseRundown(text: string): RundownDoc {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+$/, "")); const flags: string[] = [];
  const title = lines.map((l) => l.trim()).find((l) => /\bVS\.?\b/i.test(l) && l === l.toUpperCase() && l.length < 60);
  const dateIdx = lines.findIndex((l) => /\b\d{1,2}(?:st|nd|rd|th)?\s+[A-Z][a-z]+\s+\d{4}\b|\b[A-Z][a-z]+\s+\d{1,2},?\s+\d{4}\b/.test(l));
  const date = dateIdx >= 0 ? lines[dateIdx].trim() : undefined; const venue = dateIdx >= 0 ? lines[dateIdx + 1]?.trim() || undefined : undefined;
  const onAir = text.match(/ON AIR:\s*([0-9:]+)/i)?.[1]; const offAir = text.match(/OFF AIR:\s*([0-9:]+)/i)?.[1];
  const card: RundownDoc["card"] = [];
  for (const l of lines) { const m = l.match(/(\d+)(?:st|nd|rd|th)\s+Fight\s*\((\d+)\s*Rnds?\)\s*([A-Za-z ]+?)\s{2,}(.+?)\s+VS\.?\s+(.+)$/i); if (m) card.push({ n: +m[1], rounds: +m[2], weightClass: m[3].trim(), a: m[4].trim(), b: m[5].trim() }); }

  const rows: RundownRow[] = [];
  // split into pages at each header line; compute column spans per page from that page's body
  const pages: { header: string; body: string[] }[] = [];
  for (const l of lines) { if (/\bNO\.?\s+TIME\s+SOURCE/i.test(l)) pages.push({ header: l, body: [] }); else if (pages.length) pages[pages.length - 1].body.push(l); }
  let cur: (Record<Col, string[]> & { no: string; raw: string }) | null = null;
  const flush = () => {
    if (!cur) return;
    const j = (c: Col) => clean(cur![c].join(" "));
    const src = j("SOURCE"), gfx = j("GFX"), desc = j("DESCRIPTION"), sound = j("SOUND");
    const kind: RundownRow["kind"] = /^EVS\b/i.test(src) && !/CAMS/i.test(src) || /^EVS:/i.test(desc) ? "vt" : /^FF\b/i.test(gfx) ? "gfx" : /\bMC\b|RING ANNOUNCER|RINGWALK|INTRODUCTIONS|CORNER WALK/i.test(desc) ? "mc" : gfx ? "talk" : "other";
    const durSec = dur(j("DUR")) ?? dur(cur.raw.match(/(\d{1,2}:\d{2}(?::\d{2})?)\s*$/)?.[1]);
    const description = durSec !== undefined && !j("DUR") ? desc.replace(/\s*\b\d{1,2}:\d{2}(?::\d{2})?\b(?=\s|$)/, "") : desc;
    rows.push({ no: cur.no, time: j("TIME") || undefined, source: src || undefined, sound: sound || undefined, gfx: gfx || undefined, description, durSec, kind });
    cur = null;
  };
  for (const pg of pages) {
    const body = pg.body.filter((l) => l.trim() && !/^\s*Page \d+\s*$/.test(l) && !/^\s*\d+\s*$/.test(l));
    const spans = columnSpans(pg.header, body); if (!spans) continue;
    for (const l of body) {
      if (/^\s*PART \w+ - ON AIR/i.test(l.trim())) { flush(); continue; }
      const cells = sliceRow(l, spans); const no = cells.NO.trim();
      if (/^(\d{1,3}|[A-Z])$/.test(no) && (cells.TIME.trim() || /^[A-Z]$/.test(no) || cells.SOURCE.trim())) { flush(); cur = { no, raw: l, NO: [], TIME: [], SOURCE: [], SOUND: [], GFX: [], DESCRIPTION: [], DUR: [] }; }
      if (!cur) continue;
      for (const c of COLS) if (c !== "NO" && cells[c].trim()) cur[c].push(cells[c].trim());
    }
    flush();
  }
  flush();
  if (!rows.length) flags.push("No rundown rows recognised (expected a NO. / TIME / SOURCE / SOUND / GFX / DESCRIPTION / DUR header)");
  return { title, date, venue, onAir, offAir, card, rows, flags };
}

/** Rundown rows -> custom cue candidates the pack does not derive itself (VTs, full-frame GFX, MC beats). */
export function rundownToCustomCues(r: RundownDoc, vtSurfaces = ["MAIN", "IMAG_L", "IMAG_R"]) {
  return r.rows.filter((x) => x.kind === "vt" || x.kind === "gfx" || x.kind === "mc").map((x) => ({
    id: `RO.${x.no}`, group: "RUNDOWN", origin: "rundown" as const,
    name: `${x.kind.toUpperCase()}: ${(x.kind === "vt" ? (x.description.match(/EVS:\s*([^|(]+)/i)?.[1] ?? x.description) : x.kind === "gfx" ? x.gfx ?? x.description : x.description).trim().slice(0, 70)}`,
    scope: x.kind === "vt" ? vtSurfaces : ["ALL"], targets: [], trigger: x.time ? `RO ${x.no} @ ${x.time}` : `RO ${x.no}`, timing: x.time,
    notes: [x.source, x.gfx ? `GFX: ${x.gfx}` : null, x.durSec ? `${x.durSec}s` : null].filter(Boolean).join(" · "),
  }));
}
