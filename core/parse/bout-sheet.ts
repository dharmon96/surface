/**
 * Bout sheet / card list (pdftotext -layout) -> ShowDoc.
 * Blocks of 3-4 lines: "[NETWORK - ] [TITLE - ] WEIGHT CLASS - N ROUNDS", "First LAST   vs   First LAST", hometowns, records.
 * Which column is RED vs BLUE comes ONLY from the header line — promoters flip it.
 * Every inference is a sentence in review.flags; the ones with a typed answer are also a ConfirmItem (same sentence).
 */
import type { ShowDoc, ConfirmItem } from "../types.js";
import { countryFromHometown, parseRecord, countryName, type Geo } from "./geo.js";
import { DEFAULT_ROUTING, PLACEHOLDER_SCREENS } from "./timing-sheet.js";
import { raise, pairKey } from "../review.js";

const cols = (l: string) => l.trim().split(/\s{3,}|\s+vs\.?\s+/i).map((s) => s.trim()).filter((s) => s && !/^vs\.?$/i.test(s));
const fixCase = (s: string) => s.split(/\s+/).map((w) => (w === w.toUpperCase() && w.length > 1 ? w[0] + w.slice(1).toLowerCase() : w)).join(" ");

export function parseBoutSheet(text: string, sourceFile = "bout-sheet.pdf"): ShowDoc {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+$/, ""));
  const review: ShowDoc["review"] = { status: "draft", flags: [], items: [] };
  const flags = review.flags;
  const header = lines.find((l) => /CORNER/i.test(l)) ?? "";
  const H = header.toUpperCase();
  const hasRed = /RED\s+CORNER/.test(H), hasBlue = /BLUE\s+CORNER/.test(H);
  const redLeft = hasRed && hasBlue ? H.indexOf("RED") < H.indexOf("BLUE") : true;
  // typed questions are captured here and raised after the running order is final (bout ids change at the reversal)
  let cornerText: string | undefined;
  if (!hasRed || !hasBlue) cornerText = header
    ? `Corner header names only the ${hasRed ? "RED" : hasBlue ? "BLUE" : "??"} corner — assumed RED left, BLUE right; confirm corners`
    : "No RED/BLUE CORNER header — assumed RED left, BLUE right; confirm corners";
  const updated = text.match(/Last Updated:\s*([^\n]+)|(\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d{1,2}:\d{2}(?::\d{2})?\s*[AP]M)/i);
  const fighters: Record<string, any> = {}; const bouts: any[] = []; let fi = 0;
  const geoNotes: { id: string; name: string; home: string; geo: Geo; text: string }[] = [];
  const roundsNotes: { b: any; alt: number; text: string }[] = [];
  const anthemNotes: { b: any; cs: string[]; text: string }[] = [];
  const pairs: { left: string; right: string }[] = []; const nameLines: string[] = [];
  const heading = /^(.*?)\b(\d{1,2})(?:\/(\d{1,2}))?\s*ROUNDS?\b/i;
  for (let i = 0; i < lines.length; i++) {
    const hm = lines[i].trim().match(heading); if (!hm) continue;
    const names = cols(lines[i + 1] ?? ""), homes = cols(lines[i + 2] ?? ""), recs = cols(lines[i + 3] ?? "");
    if (names.length !== 2) { flags.push(`Heading '${lines[i].trim()}' not followed by two fighter names`); continue; }
    const rounds = +hm[2]; const altRounds = hm[3] ? +hm[3] : undefined;
    const pre = hm[1].replace(/[-–]\s*$/, "").trim();               // e.g. "DAZN - MAIN EVENT – NABO & NABF WELTERWEIGHT TITLES"
    const segs = pre.split(/\s+[-–]\s+/).map((s) => s.trim()).filter(Boolean);
    const wcSeg = segs.find((s) => /WEIGHT/i.test(s)) ?? segs[segs.length - 1] ?? "";
    const wc = wcSeg.match(/((?:SUPER |LIGHT |JUNIOR )?(?:MINIMUM|FLY|BANTAM|FEATHER|LIGHT|WELTER|MIDDLE|CRUISER|HEAVY)WEIGHT)/i)?.[1];
    const isTitle = /TITLE|CHAMPIONSHIP|BELT/i.test(pre);
    const network = pre.match(/^(DAZN|ESPN|PBC|SHOWTIME|AMAZON|NETFLIX|TNT)\b/i)?.[1]?.toUpperCase();
    const isMain = /MAIN EVENT/i.test(pre) && !/CO-?MAIN/i.test(pre); const isCoMain = /CO-?MAIN/i.test(pre);
    if (!wc) flags.push(`Bout heading '${lines[i].trim()}' has no weight class`);
    const mk = (idx: number) => {
      const id = `F${String(++fi).padStart(2, "0")}`;
      const home = homes[idx] ?? ""; const geo = countryFromHometown(home);
      if (geo.confidence < 0.9) geoNotes.push({ id, name: fixCase(names[idx]), home, geo, text: `${names[idx]}: country ${geo.country ?? "unknown"} — ${geo.note}` });
      const rec = parseRecord(recs[idx] ?? ""); if (!rec) flags.push(`${names[idx]}: could not parse record '${recs[idx]}'`);
      fighters[id] = { name: fixCase(names[idx]), nick: null, country: geo.country ?? "??", hometown: home, record: rec ?? { w: 0, l: 0, d: 0, ko: 0 }, weightLbs: null, height: null, flags: [] };
      return id;
    };
    const left = mk(0), right = mk(1);
    pairs.push({ left, right }); if (nameLines.length < 3) nameLines.push(lines[i + 1] ?? "");
    const order = bouts.length + 1;
    bouts.push({ id: `B${String(order).padStart(2, "0")}`, order, red: redLeft ? left : right, blue: redLeft ? right : left, rounds, title: isTitle ? pre.replace(/^(DAZN|ESPN|PBC)\s*[-–]\s*/i, "") : null, weightClass: wc ? fixCase(wc) : "Unknown", female: /FEMALE|WOMEN/i.test(pre), isMain, isCoMain, broadcast: !!network, network, timing: {}, anthems: [] });
    if (altRounds) roundsNotes.push({ b: bouts[bouts.length - 1], alt: altRounds, text: `Bout ${order}: rounds undecided on sheet (${rounds}/${altRounds}) — using ${rounds}` });
    i += 3;
  }
  if (!bouts.length) flags.push("No bouts recognised — is this a bout sheet?");
  // Sheets list main event FIRST; running order is the reverse unless the sheet says otherwise. Keep sheet order as 'listed' and
  // assign running order bottom-up so B01 is the opener.
  const listedOrder = [...bouts];
  const hasMainMarker = bouts.some((b) => b.isMain);
  const listedMainFirst = bouts[0]?.isMain || (!hasMainMarker && (bouts[0]?.rounds ?? 0) >= (bouts[bouts.length - 1]?.rounds ?? 0));
  let orderText: string | undefined; let orderAssumed: "main" | "opener" = "opener";
  if (listedMainFirst) { bouts.reverse(); bouts.forEach((b, i) => { b.order = i + 1; b.id = `B${String(i + 1).padStart(2, "0")}`; }); orderText = "Sheet lists the main event first — running order reversed so B01 is the opener; confirm"; orderAssumed = "main"; }
  else if (!hasMainMarker && bouts.length > 1) { orderText = "No MAIN EVENT marker — kept sheet order (first listed = opener) from round counts; confirm running order"; orderAssumed = "opener"; }
  let mainText: string | undefined, comainText: string | undefined;
  if (!hasMainMarker && bouts.length) { bouts[bouts.length - 1].isMain = true; mainText = "No MAIN EVENT marker — last in running order assumed the main event; confirm"; }
  if (!bouts.some((b) => b.isCoMain) && bouts.length > 1) { bouts[bouts.length - 2].isCoMain = true; comainText = "No CO-MAIN marker — second-to-last in running order assumed the co-main; confirm"; }
  for (const b of bouts) if (b.title) { const cs = [...new Set([fighters[b.red].country, fighters[b.blue].country])].filter((c) => c !== "??"); if (cs.length > 1 || (cs.length === 1 && cs[0] !== "US")) { b.anthems = cs; anthemNotes.push({ b, cs, text: `Bout ${b.order}: anthems suggested ${cs.join("/")} — confirm` }); } }
  flags.push("Bout sheet has no timings, weights or ring names — merge a timing sheet when it arrives");
  flags.push("Screens are placeholders until the venue screen list (PixelMapper) is supplied");
  const main = bouts[bouts.length - 1];
  const network = bouts.find((b) => b.network)?.network;
  // ── the typed questions (each pushes its sentence to flags as it is raised)
  const vs = (b: any) => `${fighters[b.red].name} v ${fighters[b.blue].name}`; const pk = (b: any) => pairKey(b.red, b.blue);
  if (cornerText) raise(review, {
    key: "corners:left", kind: "corners", source: "sheet", question: "Which corner is the LEFT column on the sheet?",
    detail: header ? `The header names only the ${hasRed ? "RED" : "BLUE"} corner: "${header.trim()}" — read as RED left.` : "No RED / BLUE CORNER header on the sheet — read as RED left.",
    evidence: { sheet: [header.trim(), ...nameLines].filter(Boolean) },
    options: [{ id: "red", label: "Left = RED · right = BLUE", tone: "red", suggested: true }, { id: "blue", label: "Left = BLUE · right = RED — swap every bout", tone: "blue" }],
    data: { assumed: "red", pairs }, text: cornerText,
  });
  if (orderText && listedOrder.length) raise(review, {
    key: "running-order", kind: "running-order", source: "sheet",
    question: `The sheet lists ${vs(listedOrder[0])} first. Do they fight last (main event) or first (opener)?`,
    detail: orderAssumed === "main" ? "Read as: listed top = the main event, so the running order is the reverse." : "No MAIN EVENT marker — kept the sheet's order from round counts.",
    options: [{ id: "main", label: "They fight last — the card runs bottom-up", suggested: orderAssumed === "main" }, { id: "opener", label: "They fight first — the sheet is already in running order", suggested: orderAssumed === "opener" }],
    data: { assumed: orderAssumed, listed: listedOrder.map(pk) }, text: orderText,
  });
  if (mainText && main) raise(review, {
    key: "main", kind: "main", source: "sheet", question: `Main event: ${vs(main)}?`,
    detail: "No MAIN EVENT marker — assumed the last fight in running order (the co-main is the one before it).",
    options: [...bouts].reverse().map((b) => ({ id: pk(b), label: `${vs(b)} · ${b.rounds} rds`, suggested: !!b.isMain })),
    anchor: { fighters: [main.red, main.blue] }, data: { assumed: pk(main), candidates: bouts.map(pk) }, text: mainText, covers: comainText ? [comainText] : [],
  });
  if (comainText) flags.push(comainText);
  for (const g of geoNotes) {
    const alts = g.geo.alternatives;
    raise(review, {
      key: `country:${g.id}`, kind: "country", source: "sheet",
      question: `${g.name} — "${g.home || "no hometown"}": ${alts.length > 1 ? "which country?" : "is this right?"}`, detail: g.geo.note,
      options: [...alts.map((c) => ({ id: c, label: `${countryName(c)} (${c})`, suggested: c === g.geo.country })), ...(alts.length ? [] : [{ id: "US", label: "United States (US)" }]), { id: "other", label: "Another country…", input: "text" as const }, { id: "??", label: "Unknown — no flag", suggested: !g.geo.country }],
      anchor: { fighters: [g.id] }, data: { hometown: g.home, assumed: g.geo.country ?? "??" }, text: g.text,
    } satisfies ConfirmItem);
  }
  for (const { b, alt, text } of roundsNotes) raise(review, {
    key: `rounds:${pk(b)}`, kind: "rounds", source: "sheet", question: `${vs(b)} — ${b.rounds} or ${alt} rounds?`, detail: "The sheet gives both.",
    options: [{ id: String(b.rounds), label: `${b.rounds} rounds`, suggested: true }, { id: String(alt), label: `${alt} rounds` }],
    anchor: { fighters: [b.red, b.blue], cell: "ROUNDS" }, data: { assumed: b.rounds, alt }, text,
  });
  for (const { b, cs, text } of anthemNotes) raise(review, {
    key: `anthems:${pk(b)}`, kind: "anthems", source: "sheet", question: `Anthems for ${vs(b)}: ${cs.map(countryName).join(" and ")}?`,
    options: [{ id: cs.join(","), label: cs.length > 1 ? "Both" : countryName(cs[0]), suggested: true }, ...(cs.length > 1 ? cs.map((c) => ({ id: c, label: `${countryName(c)} only` })) : []), { id: "", label: "No anthems" }],
    anchor: { fighters: [b.red, b.blue] }, data: { assumed: cs }, text,
  });
  return {
    schema: "surface/2.0", source: { file: sourceFile, kind: "bout_sheet", version: updated?.[1] ?? updated?.[2], parsedAt: new Date().toISOString().slice(0, 10) },
    event: { id: `card-${(main ? `${fighters[main.red].name}-${fighters[main.blue].name}` : "event").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, name: main ? `${fighters[main.red].name} v ${fighters[main.blue].name}` : "Card", broadcast: network ? { network } : undefined, walkOrder: ["red", "blue"], introOrder: ["red", "blue"] },
    screens: PLACEHOLDER_SCREENS, surfaces: PLACEHOLDER_SCREENS.map((s) => ({ id: s.id, name: s.name, screens: [s.id] })),
    data: { fighters, bouts, vts: [] }, routing: DEFAULT_ROUTING, customCues: [], review,
  };
}
