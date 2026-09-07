import { readFileSync } from "node:fs";
import { parseTimingSheet } from "../core/parse/index.js";
import { deriveCues, mediaManifest, type ShowDoc } from "../core/index.js";
import { type ScreenSynonyms } from "../core/intake/tokens.js";
import { DEFAULT_ROUTING } from "../core/parse/timing-sheet.js";
import type { Probe } from "../core/intake/intake.js";

const rows = readFileSync(new URL("../fixtures/examples-survey/probes.jsonl", import.meta.url), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const toProbe = (r: any): Probe => ({ file: r.f, w: r.w, h: r.h, durationSec: r.dur, fps: 29.97, hasAlpha: /a$|rgba/.test(r.pix || ""), still: r.codec === "png", bytes: r.mb * 1048576, codec: r.codec, pix: r.pix, audio: r.audio });

// ── Package 1: numbered delivery ("1a/1b", screen names in filenames). Stand-in sheet: Glendale (8 bouts, like the package).
export const numbered = (() => {
  const doc = parseTimingSheet(readFileSync(new URL("../fixtures/text/2026-06-13-glendale-timing.txt", import.meta.url), "utf8"));
  doc.screens = [{ id: "MAIN", name: "Main Video Board", w: 1920, h: 1080 }, { id: "BARGE", name: "Full Barge", w: 1792, h: 504 }, { id: "CORNER", name: "Corner Boards", w: 576, h: 648 }, { id: "WEDGE", name: "Wedge", w: 504, h: 2016 }, { id: "TUNNEL", name: "Tunnel", w: 1536, h: 1152 }];
  doc.surfaces = doc.screens.map((s) => ({ id: s.id, name: s.name, screens: [s.id] }));
  doc.routing = { HOLD: ["ALL"], FLAG: ["MAIN"], WALKOUT: ["ALL"], FIGHTER: ["MAIN", "BARGE"], TALE: ["MAIN", "BARGE"], ROUND: ["MAIN", "BARGE"], ROUND_STAY: ["BARGE"], WINNER: ["MAIN", "BARGE", "CORNER", "TUNNEL"], UP_NEXT: ["MAIN", "BARGE"], VT: ["MAIN"] };
  const syn: ScreenSynonyms = { MAIN: { words: ["main video board", "main board", "main video", "hung", "main videoboard", "main video booard"], w: 1920, h: 1080 }, BARGE: { words: ["full barge", "barge", "scoreboard", "fullbarge", "full burge"], w: 1792, h: 504 }, CORNER: { words: ["corner boards", "corner board", "corner post", "corner", "cornerboards"], w: 576, h: 648 }, WEDGE: { words: ["wedge"], w: 504, h: 2016 }, TUNNEL: { words: ["tunnel"], w: 1536, h: 1152 } };
  const probes = rows.filter((r: any) => r.f.startsWith("Fight Night/")).map(toProbe);
  return { doc, syn, probes, manifest: mediaManifest(doc, deriveCues(doc)) };
})();

// ── Package 2: Matchroom Ruiz–Knyba (fighter names in paths, screen tokens as prefixes, 28k-wide fascia). Sheet rebuilt from the card.
export const matchroom = (() => {
  const pairs = [["THOMPSON", "CASILLAS"], ["SIMPSON", "MCDONALD"], ["MULLEN", "MILLER"], ["ELLIOT", "VALENCIA"], ["CHAVES", "GARCIA"], ["MOSES", "CONTRERAS"], ["MIELNICKI JR", "WILLIAMS"], ["RUIZ", "KNYBA"]];
  const first: Record<string, string> = { THOMPSON: "Dennis", CASILLAS: "Jose", SIMPSON: "Jordan", MCDONALD: "Michael", MULLEN: "Brooke", MILLER: "Bria", ELLIOT: "Kahshad", VALENCIA: "Jean Pierre", CHAVES: "Alan", GARCIA: "Eridson", MOSES: "Zaquin", CONTRERAS: "Angel Antonio", "MIELNICKI JR": "Vito", WILLIAMS: "Austin", RUIZ: "Andy", KNYBA: "Damian" };
  const fighters: any = {}; const bouts: any[] = []; let i = 0;
  pairs.forEach(([a, b], k) => { const ra = `F${String(++i).padStart(2, "0")}`, rb = `F${String(++i).padStart(2, "0")}`; fighters[ra] = { name: `${first[a]} ${a.split(" ").map((w) => w[0] + w.slice(1).toLowerCase()).join(" ")}`, country: "US", record: { w: 0, l: 0, d: 0, ko: 0 } }; fighters[rb] = { name: `${first[b]} ${b[0] + b.slice(1).toLowerCase()}`, country: "US", record: { w: 0, l: 0, d: 0, ko: 0 } }; bouts.push({ id: `B${String(k + 1).padStart(2, "0")}`, order: k + 1, red: ra, blue: rb, rounds: k === 7 ? 12 : 8, isMain: k === 7, isCoMain: k === 6, timing: {} }); });
  const screens = [{ id: "HUNG", name: "Centerhung", w: 1920, h: 1080 }, { id: "BARGE", name: "Full Barge", w: 1792, h: 504 }, { id: "CORNER", name: "Corner Boards", w: 576, h: 648 }, { id: "WEDGE", name: "Wedge", w: 504, h: 2016 }, { id: "TRUSS", name: "Truss", w: 1728, h: 384 }, { id: "FASCIA_UP", name: "Upper fascia", w: 27808, h: 64 }, { id: "FASCIA_LO", name: "Lower fascia", w: 28576, h: 64 }];
  const doc: ShowDoc = { schema: "surface/2.0", event: { id: "2026-09-04-prudential", name: "Ruiz v Knyba", walkOrder: ["red", "blue"], introOrder: ["red", "blue"] }, screens, surfaces: screens.map((s) => ({ id: s.id, name: s.name, screens: [s.id] })), data: { fighters, bouts, vts: [] }, routing: { ...DEFAULT_ROUTING, HOLD: ["ALL"], WALKOUT: ["ALL"], FIGHTER: ["ALL"], TALE: ["ALL"], ROUND: ["ALL"], ROUND_STAY: ["TRUSS", "FASCIA_UP", "FASCIA_LO"], WINNER: ["ALL"], UP_NEXT: ["HUNG", "BARGE"], FLAG: ["HUNG"] }, customCues: [], review: { status: "draft", flags: [] } };
  const syn: ScreenSynonyms = { HUNG: { words: ["hung", "centerhung", "main board"], w: 1920, h: 1080 }, BARGE: { words: ["fullbarge", "full barge", "barge"], w: 1792, h: 504 }, CORNER: { words: ["corner board", "corner boards", "corner"], w: 576, h: 648 }, WEDGE: { words: ["wedge", "wedge signage"], w: 504, h: 2016 }, TRUSS: { words: ["truss"], w: 1728, h: 384 }, FASCIA_UP: { words: ["upper led fascia", "upper fascia"], w: 27808, h: 64 }, FASCIA_LO: { words: ["lower led fascia", "lower fascia"], w: 28576, h: 64 } };
  const probes = rows.filter((r: any) => r.f.startsWith("VENUE SCREENS/")).map(toProbe);
  return { doc, syn, probes, manifest: mediaManifest(doc, deriveCues(doc)) };
})();

