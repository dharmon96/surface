/**
 * Promoter timing sheet (pdftotext -layout text) -> ShowDoc.
 * Layout seen on two promoters' sheets: header line with venue/date, OPEN DOORS, a column header naming which corner is
 * left/right and the walk/intro order, then one block per bout with Walk / First Bell / Final Bell / Walk Out / READY BY,
 * a stacked TITLE column, and both corners (Name, Ringname, Record, Weight, Height, Hometown).
 * Every inference is a sentence in review.flags; the ones with a typed answer are also a ConfirmItem (same sentence).
 */
import type { ShowDoc, Screen, Surface } from "../types.js";
import { countryFromHometown, parseRecord, weightClassFromLbs, weightClassNeighbours, countryName, type Geo } from "./geo.js";
import { raise, pairKey } from "../review.js";

const LABELS = ["Name", "Ringname", "Record", "Weight", "Height", "Hometown"] as const;
const TIMING = { Walk: "walk", "First Bell": "firstBell", "Final Bell": "finalBell", "Walk Out": "walkOut", "READY BY": "readyBy" } as const;

export const PLACEHOLDER_SCREENS: Screen[] = [
  { id: "MAIN", name: "Main LED", w: 3840, h: 1080 }, { id: "RIBBON", name: "Ringside ribbon", w: 7680, h: 216 },
  { id: "IMAG_L", name: "IMAG left", w: 1920, h: 1080 }, { id: "IMAG_R", name: "IMAG right", w: 1920, h: 1080 },
];
export const DEFAULT_ROUTING: Record<string, string[]> = {
  HOLD: ["ALL"], FLAG: ["MAIN"], WALKOUT: ["MAIN", "IMAG_L", "IMAG_R"], FIGHTER: ["MAIN", "RIBBON"], TALE: ["MAIN", "IMAG_L", "IMAG_R"],
  ROUND: ["MAIN", "RIBBON"], ROUND_STAY: ["RIBBON"], WINNER: ["ALL"], UP_NEXT: ["MAIN", "IMAG_L", "IMAG_R"], VT: ["MAIN", "IMAG_L", "IMAG_R"],
};

function to24h(t: string): string { const m = t.match(/(\d{1,2}):(\d{2})\s*([AP])M/i); if (!m) return t; let h = +m[1] % 12; if (m[3].toUpperCase() === "P") h += 12; return `${String(h).padStart(2, "0")}:${m[2]}`; }
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const title = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bJr\b\.?/i, "Jr.").replace(/\bIi\b/, "II").replace(/\bIii\b/, "III");

export function parseTimingSheet(text: string, sourceFile = "timing-sheet.pdf"): ShowDoc {
  const lines = text.split(/\r?\n/);
  const review: ShowDoc["review"] = { status: "draft", flags: [], items: [] };
  const flags = review.flags;
  // ── header
  const head = lines.find((l) => /\b(20\d\d)\b/.test(l) && /-/.test(l)) ?? "";
  const dm = head.match(/([A-Z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/i);
  const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const date = dm ? `${dm[3]}-${String(MONTHS.indexOf(dm[1].toLowerCase()) + 1).padStart(2, "0")}-${dm[2].padStart(2, "0")}` : "";
  const rest = dm ? head.slice(head.indexOf(dm[0]) + dm[0].length) : head; // "- VENUE - CITY, STATE" or "- VENUE, CITY, STATE"
  const segs = rest.split(/\s+-\s+/).map((s) => s.trim()).filter(Boolean);
  let venue = segs[0] ?? "", city = segs.slice(1).join(", ");
  if (!city && venue.includes(",")) { const parts = venue.split(","); venue = parts[0].trim(); city = parts.slice(1).join(",").trim(); }
  if (!date) flags.push("Could not read event date from header");
  const doors = (lines.find((l) => /OPEN DOORS/i.test(l)) ?? "").match(/(\d{1,2}:\d{2}\s*[AP]M)/i)?.[1];
  const tz = (lines.find((l) => /OPEN DOORS/i.test(l)) ?? "").match(/[AP]M\s+([A-Z]{2,4})\b/)?.[1];
  const colHead = lines.find((l) => /CORNER/.test(l) && /RDS|BOUT/.test(l)) ?? "";
  const hasBlueCol = /BLUE\s+CORNER/i.test(colHead), hasRedCol = /RED\s+CORNER/i.test(colHead);
  const blueFirst = hasBlueCol && hasRedCol ? colHead.toUpperCase().indexOf("BLUE") < colHead.toUpperCase().indexOf("RED") : true;
  let cornerText: string | undefined;
  if (!hasBlueCol || !hasRedCol) cornerText = colHead
    ? `Corner column header names only the ${hasRedCol ? "RED" : "BLUE"} corner — assumed BLUE left, RED right; confirm corners`
    : "No corner column header found — assumed BLUE left, RED right; confirm corners";
  // walk/intro order from the header parens, each on its own: "(Walk, Intro 1st)" annotates both, "(Walk 2nd, Intro 1st)" splits them
  const paren = (c: string) => colHead.match(new RegExp(`${c}\\s+CORNER\\s*\\(([^)]*)\\)`, "i"))?.[1] ?? "";
  const ordinal = (p: string, kind: string) => p.match(new RegExp(`${kind}s?[^,)]*?(1st|2nd)`, "i"))?.[1] ?? p.match(/(1st|2nd)\s*$/)?.[1] ?? null;
  const orderFor = (kind: string): ("red" | "blue")[] | null => {
    const r = ordinal(paren("RED"), kind), b = ordinal(paren("BLUE"), kind);
    if (r === "1st" || b === "2nd") return ["red", "blue"];
    if (b === "1st" || r === "2nd") return ["blue", "red"];
    return null;
  };
  const walkOrder = orderFor("walk") ?? ["red", "blue"], introOrder = orderFor("intro") ?? ["red", "blue"];
  if (!orderFor("walk") || !orderFor("intro")) raise(review, {
    key: "walk-order", kind: "walk-order", source: "sheet", question: "Who walks (and is introduced) first?",
    detail: "The corner header has no (Walk, Intro 1st) note — read as red first.",
    options: [{ id: "red", label: "Red walks first", tone: "red", suggested: true }, { id: "blue", label: "Blue walks first", tone: "blue" }],
    data: { assumed: "red" }, text: "Walk/intro order not annotated in the corner header — assumed red first; confirm",
  });
  // ── bout blocks
  const startIdx = lines.indexOf(colHead) + 1;
  const blocks: { bout: number; rounds: number; lines: string[]; feedBefore?: string }[] = [];
  let pendingFeed: string | undefined;
  for (const l of lines.slice(startIdx)) {
    const fm = l.match(/FEED:\s*(\d{1,2}:\d{2}\s*[AP]M)/i); if (fm) { pendingFeed = fm[1]; continue; }
    const bm = l.match(/^\s{0,4}(\d{1,2})\s+(\d{1,2})\s+(.*)$/);
    if (bm) { blocks.push({ bout: +bm[1], rounds: +bm[2], lines: [bm[3]], feedBefore: pendingFeed }); pendingFeed = undefined; continue; }
    if (blocks.length && l.trim() && !/SUBJECT TO CHANGE/i.test(l)) blocks[blocks.length - 1].lines.push(l);
  }
  if (!blocks.length) flags.push("No bout blocks recognised — is this a timing sheet?");
  const fighters: Record<string, any> = {}; const bouts: any[] = []; let fi = 0; let feedStart: string | undefined; let firstBroadcast: string | undefined;
  const pairs: { left: string; right: string }[] = []; let firstNameLine: string | undefined;
  const vs = (b: any) => `${fighters[b.red].name} v ${fighters[b.blue].name}`; const pk = (b: any) => pairKey(b.red, b.blue);
  for (const b of blocks) {
    const red: any = {}, blue: any = {}; const timing: Record<string, string> = {}; const titleParts: string[] = [];
    for (const raw of b.lines) {
      let line = raw;
      // corner labels: "<blue value>   Label:   <red value>"
      const lm = line.match(new RegExp(`^(.*?)\\s{2,}(${LABELS.join("|")}):\\s*(.*)$`)) ?? line.match(new RegExp(`^(.*?)\\s*(${LABELS.join("|")}):\\s*(.*)$`));
      if (lm) {
        const label = lm[2] as (typeof LABELS)[number]; const right = lm[3].trim(); let left = lm[1];
        if (label === "Name" && !firstNameLine) firstNameLine = raw;
        // strip timing from the left part
        const tm = left.match(/(Walk Out|First Bell|Final Bell|Walk|READY BY):\s*(\d{1,2}:\d{2}\s*[AP]M)/i);
        if (tm) { timing[TIMING[tm[1] as keyof typeof TIMING] ?? tm[1]] = to24h(tm[2]); titleParts.push(left.slice(0, tm.index).trim()); left = left.slice(tm.index! + tm[0].length); }
        else titleParts.push("");
        const leftVal = left.trim().replace(/\s{2,}/g, " ");
        (blueFirst ? blue : red)[label] = leftVal; (blueFirst ? red : blue)[label] = right;
        continue;
      }
      const tm = line.match(/^(.*?)(Walk Out|First Bell|Final Bell|Walk|READY BY):\s*(\d{1,2}:\d{2}\s*[AP]M)\s*(.*)$/i);
      if (tm) { timing[TIMING[tm[2] as keyof typeof TIMING] ?? tm[2]] = to24h(tm[3]); titleParts.push(tm[1].trim()); if (tm[4].trim()) titleParts.push(tm[4].trim()); continue; }
      if (line.trim()) titleParts.push(line.trim());
    }
    const titleText = titleParts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim() || null;
    const geoNotes: { id: string; name: string; home: string; geo: Geo; text: string }[] = [];
    const mk = (c: any, side: string) => {
      const id = `F${String(++fi).padStart(2, "0")}`;
      const homet = (c.Hometown ?? "").trim(); const geo = countryFromHometown(homet);
      if (geo.confidence < 0.9) geoNotes.push({ id, name: title((c.Name ?? "").trim()), home: homet, geo, text: `Bout ${b.bout} ${side}: country ${geo.country ?? "unknown"} — ${geo.note}` });
      const rec = parseRecord(c.Record ?? ""); if (!rec) flags.push(`Bout ${b.bout} ${side}: could not parse record '${c.Record}'`);
      const wm = (c.Weight ?? "").match(/([\d.]+)/); const lbs = wm ? +wm[1] : null; if (!lbs) flags.push(`Bout ${b.bout} ${side}: weight '${c.Weight}' not numeric (HVY?)`);
      fighters[id] = { name: title((c.Name ?? "").trim()), nick: (c.Ringname ?? "").trim() || null, country: geo.country ?? "??", hometown: homet, record: rec ?? { w: 0, l: 0, d: 0, ko: 0 }, weightLbs: lbs, height: (c.Height ?? "").trim() || null, flags: [] };
      return id;
    };
    const redId = mk(red, "RED"), blueId = mk(blue, "BLUE");
    pairs.push({ left: blueFirst ? blueId : redId, right: blueFirst ? redId : blueId });
    for (const g of geoNotes) {
      const alts = g.geo.alternatives;
      raise(review, {
        key: `country:${g.id}`, kind: "country", source: "sheet",
        question: `${g.name} — "${g.home || "no hometown"}": ${alts.length > 1 ? "which country?" : "is this right?"}`, detail: g.geo.note,
        options: [...alts.map((c) => ({ id: c, label: `${countryName(c)} (${c})`, suggested: c === g.geo.country })), ...(alts.length ? [] : [{ id: "US", label: "United States (US)" }]), { id: "other", label: "Another country…", input: "text" as const }, { id: "??", label: "Unknown — no flag", suggested: !g.geo.country }],
        anchor: { fighters: [g.id] }, data: { hometown: g.home, assumed: g.geo.country ?? "??" }, text: g.text,
      });
    }
    const female = /FEMALE|WOMEN/i.test(titleText ?? "");
    const lbs = fighters[redId].weightLbs ?? fighters[blueId].weightLbs;
    const wcFromTitle = titleText?.match(/\b((?:SUPER |LIGHT |JUNIOR )?(?:MINIMUM|FLY|BANTAM|FEATHER|LIGHT|WELTER|MIDDLE|CRUISER|HEAVY)WEIGHT)\b/i)?.[1];
    const weightClass = wcFromTitle ? title(wcFromTitle) : lbs ? weightClassFromLbs(lbs) : "Heavyweight";
    if (b.feedBefore) { feedStart = to24h(b.feedBefore); firstBroadcast = `B${String(b.bout).padStart(2, "0")}`; }
    const bout = { id: `B${String(b.bout).padStart(2, "0")}`, order: b.bout, red: redId, blue: blueId, rounds: b.rounds, title: titleText, weightClass, female, isMain: false, broadcast: !!feedStart, timing, anthems: [] as string[] };
    bouts.push(bout);
    if (!wcFromTitle) raise(review, {
      key: `weightclass:${pk(bout)}`, kind: "weight-class", source: "sheet", question: `${vs(bout)}: ${weightClass}?`,
      detail: lbs ? `Not in the title — read from ${lbs} lbs.` : "No weight on the sheet.",
      options: [{ id: weightClass, label: weightClass, suggested: true }, ...weightClassNeighbours(weightClass).map((c) => ({ id: c, label: c })), { id: "other", label: "Type it…", input: "text" as const }],
      anchor: { fighters: [redId, blueId] }, data: { assumed: weightClass, lbs }, text: `Bout ${b.bout}: weight class '${weightClass}' inferred from ${lbs ? lbs + " lbs" : "no weight"} — confirm`,
    });
  }
  if (cornerText) raise(review, {
    key: "corners:left", kind: "corners", source: "sheet", question: "Which corner is the LEFT column on the sheet?",
    detail: colHead ? `The header names only the ${hasRedCol ? "RED" : "BLUE"} corner: "${colHead.trim()}" — read as BLUE left.` : "No corner column header found — read as BLUE left.",
    evidence: { sheet: [colHead.trim(), firstNameLine ?? ""].filter(Boolean) },
    options: [{ id: "blue", label: "Left = BLUE · right = RED", tone: "blue", suggested: true }, { id: "red", label: "Left = RED · right = BLUE — swap every bout", tone: "red" }],
    data: { assumed: "blue", pairs }, text: cornerText,
  });
  if (bouts.length) {
    bouts[bouts.length - 1].isMain = true; if (bouts.length > 1) bouts[bouts.length - 2].isCoMain = true;
    const last = bouts[bouts.length - 1];
    raise(review, {
      key: "main", kind: "main", source: "sheet", question: `Main event: ${vs(last)}?`, detail: "Read as the last fight on the sheet; the co-main is the one before it.",
      options: [...bouts].reverse().slice(0, 3).map((b) => ({ id: pk(b), label: `${vs(b)} · ${b.rounds} rds`, suggested: !!b.isMain })),
      anchor: { fighters: [last.red, last.blue] }, data: { assumed: pk(last), candidates: bouts.map(pk) },
      text: `Main = bout ${bouts[bouts.length - 1].order}${bouts.length > 1 ? `, co-main = bout ${bouts[bouts.length - 2].order}` : ""} (last on the sheet) — confirm`,
    });
  }
  // anthem suggestions: title bouts with a non-US fighter
  for (const b of bouts) if (b.title) { const cs = [...new Set([fighters[b.red].country, fighters[b.blue].country])].filter((c) => c !== "??"); if (cs.length > 1 || (cs.length === 1 && cs[0] !== "US")) { b.anthems = cs; raise(review, {
    key: `anthems:${pk(b)}`, kind: "anthems", source: "sheet", question: `Anthems for ${vs(b)}: ${cs.map(countryName).join(" and ")}?`,
    options: [{ id: cs.join(","), label: cs.length > 1 ? "Both" : countryName(cs[0]), suggested: true }, ...(cs.length > 1 ? cs.map((c) => ({ id: c, label: `${countryName(c)} only` })) : []), { id: "", label: "No anthems" }],
    anchor: { fighters: [b.red, b.blue] }, data: { assumed: cs }, text: `Bout ${b.order}: anthems suggested ${cs.join("/")} from fighter countries — confirm with promoter`,
  }); } }
  flags.push("Screens are placeholders until the venue screen list (PixelMapper) is supplied");
  const surfaces: Surface[] = PLACEHOLDER_SCREENS.map((s) => ({ id: s.id, name: s.name, screens: [s.id] }));
  const main = bouts[bouts.length - 1];
  return {
    schema: "surface/2.0", source: { file: sourceFile, kind: "timing_sheet", parsedAt: new Date().toISOString().slice(0, 10) },
    event: { id: `${date || "undated"}-${slug(venue || city || "event")}`, name: main ? `${fighters[main.red].name} v ${fighters[main.blue].name}` : venue, date, timezone: tz, venue, city, doors: doors ? to24h(doors) : undefined, broadcast: feedStart ? { network: "TBD", feedStart, firstBroadcastBout: firstBroadcast } : undefined, walkOrder, introOrder },
    screens: PLACEHOLDER_SCREENS, surfaces, data: { fighters, bouts, vts: [] }, routing: DEFAULT_ROUTING, customCues: [], review,
  };
}
