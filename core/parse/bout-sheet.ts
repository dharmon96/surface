/**
 * Bout sheet / card list (pdftotext -layout) -> ShowDoc.
 * Blocks of 3-4 lines: "[NETWORK - ] [TITLE - ] WEIGHT CLASS - N ROUNDS", "First LAST   vs   First LAST", hometowns, records.
 * Which column is RED vs BLUE comes ONLY from the header line — promoters flip it.
 */
import type { ShowDoc } from "../types.js";
import { countryFromHometown, parseRecord } from "./geo.js";
import { DEFAULT_ROUTING, PLACEHOLDER_SCREENS } from "./timing-sheet.js";

const cols = (l: string) => l.trim().split(/\s{3,}|\s+vs\.?\s+/i).map((s) => s.trim()).filter((s) => s && !/^vs\.?$/i.test(s));
const fixCase = (s: string) => s.split(/\s+/).map((w) => (w === w.toUpperCase() && w.length > 1 ? w[0] + w.slice(1).toLowerCase() : w)).join(" ");

export function parseBoutSheet(text: string, sourceFile = "bout-sheet.pdf"): ShowDoc {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+$/, ""));
  const flags: string[] = [];
  const header = lines.find((l) => /CORNER/i.test(l)) ?? "";
  const redLeft = header.toUpperCase().indexOf("RED") >= 0 && header.toUpperCase().indexOf("RED") < header.toUpperCase().indexOf("BLUE");
  if (!header) flags.push("No RED/BLUE CORNER header — assumed RED left, BLUE right");
  const updated = text.match(/Last Updated:\s*([^\n]+)|(\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d{1,2}:\d{2}(?::\d{2})?\s*[AP]M)/i);
  const fighters: Record<string, any> = {}; const bouts: any[] = []; let fi = 0;
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
    const mk = (idx: number) => {
      const id = `F${String(++fi).padStart(2, "0")}`;
      const home = homes[idx] ?? ""; const geo = countryFromHometown(home);
      if (geo.confidence < 0.9) flags.push(`${names[idx]}: country ${geo.country ?? "unknown"} — ${geo.note}`);
      const rec = parseRecord(recs[idx] ?? ""); if (!rec) flags.push(`${names[idx]}: could not parse record '${recs[idx]}'`);
      fighters[id] = { name: fixCase(names[idx]), nick: null, country: geo.country ?? "??", hometown: home, record: rec ?? { w: 0, l: 0, d: 0, ko: 0 }, weightLbs: null, height: null, flags: [] };
      return id;
    };
    const left = mk(0), right = mk(1);
    const order = bouts.length + 1;
    if (altRounds) flags.push(`Bout ${order}: rounds undecided on sheet (${rounds}/${altRounds}) — using ${rounds}`);
    bouts.push({ id: `B${String(order).padStart(2, "0")}`, order, red: redLeft ? left : right, blue: redLeft ? right : left, rounds, title: isTitle ? pre.replace(/^(DAZN|ESPN|PBC)\s*[-–]\s*/i, "") : null, weightClass: wc ? fixCase(wc) : "Unknown", female: /FEMALE|WOMEN/i.test(pre), isMain, isCoMain, broadcast: !!network, network, timing: {}, anthems: [] });
    i += 3;
  }
  if (!bouts.length) flags.push("No bouts recognised — is this a bout sheet?");
  // Sheets list main event FIRST; running order is the reverse unless the sheet says otherwise. Keep sheet order as 'listed' and
  // assign running order bottom-up so B01 is the opener.
  const listedMainFirst = bouts[0]?.isMain || (!bouts.some((b) => b.isMain) && (bouts[0]?.rounds ?? 0) >= (bouts[bouts.length - 1]?.rounds ?? 0));
  if (listedMainFirst) { bouts.reverse(); bouts.forEach((b, i) => { b.order = i + 1; b.id = `B${String(i + 1).padStart(2, "0")}`; }); flags.push("Sheet lists the main event first — running order reversed so B01 is the opener; confirm"); }
  if (!bouts.some((b) => b.isMain) && bouts.length) bouts[bouts.length - 1].isMain = true;
  if (!bouts.some((b) => b.isCoMain) && bouts.length > 1) bouts[bouts.length - 2].isCoMain = true;
  for (const b of bouts) if (b.title) { const cs = [...new Set([fighters[b.red].country, fighters[b.blue].country])].filter((c) => c !== "??"); if (cs.length > 1 || (cs.length === 1 && cs[0] !== "US")) { b.anthems = cs; flags.push(`Bout ${b.order}: anthems suggested ${cs.join("/")} — confirm`); } }
  flags.push("Bout sheet has no timings, weights or ring names — merge a timing sheet when it arrives");
  flags.push("Screens are placeholders until the venue screen list (PixelMapper) is supplied");
  const main = bouts[bouts.length - 1];
  const network = bouts.find((b) => b.network)?.network;
  return {
    schema: "surface/2.0", source: { file: sourceFile, kind: "bout_sheet", version: updated?.[1] ?? updated?.[2], parsedAt: new Date().toISOString().slice(0, 10) },
    event: { id: `card-${(main ? `${fighters[main.red].name}-${fighters[main.blue].name}` : "event").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, name: main ? `${fighters[main.red].name} v ${fighters[main.blue].name}` : "Card", broadcast: network ? { network } : undefined, walkOrder: ["red", "blue"], introOrder: ["red", "blue"] },
    screens: PLACEHOLDER_SCREENS, surfaces: PLACEHOLDER_SCREENS.map((s) => ({ id: s.id, name: s.name, screens: [s.id] })),
    data: { fighters, bouts, vts: [] }, routing: DEFAULT_ROUTING, customCues: [], review: { status: "draft", flags },
  };
}
