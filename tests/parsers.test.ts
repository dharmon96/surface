import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { detectKind, parseTimingSheet, parseBoutSheet, parseRundown, rundownToCustomCues, mergeSheets } from "../core/parse/index.js";
import { deriveCues } from "../core/index.js";

const txt = (n: string) => readFileSync(new URL(`../fixtures/text/${n}`, import.meta.url), "utf8");
const glendale = txt("2026-06-13-glendale-timing.txt"), vegas = txt("2026-04-25-lasvegas-timing.txt");
const romero = txt("2026-08-22-romero-lopez-boutsheet.txt"), rocha = txt("rocha-curiel-boutsheet.txt"), ro = txt("2026-08-22-prelims-rundown.txt");

describe("detectKind", () => {
  it("tells the three sheet types apart", () => {
    expect(detectKind(glendale)).toBe("timing_sheet"); expect(detectKind(vegas)).toBe("timing_sheet");
    expect(detectKind(romero)).toBe("bout_sheet"); expect(detectKind(rocha)).toBe("bout_sheet");
    expect(detectKind(ro)).toBe("rundown");
  });
});

describe("timing sheet parser", () => {
  const d = parseTimingSheet(glendale, "glendale.pdf");
  it("reads the header", () => { expect(d.event.date).toBe("2026-06-13"); expect(d.event.venue).toBe("DESERT DIAMOND ARENA"); expect(d.event.doors).toBe("14:00"); expect(d.event.timezone).toBe("MST"); expect(d.event.walkOrder).toEqual(["red", "blue"]); });
  it("reads 8 bouts / 16 fighters with corners from the header", () => {
    expect(d.data.bouts.length).toBe(8); expect(Object.keys(d.data.fighters).length).toBe(16);
    const main = d.data.bouts[7]; expect(main.rounds).toBe(12); expect(main.isMain).toBe(true);
    expect(d.data.fighters[main.blue].name).toBe("Jesse Rodriguez"); expect(d.data.fighters[main.blue].nick).toBe("Bam");
    expect(d.data.fighters[main.red].name).toBe("Antonio Vargas"); expect(d.data.fighters[main.red].record).toEqual({ w: 19, l: 1, d: 1, ko: 11 });
  });
  it("reads timings, titles, countries and the broadcast feed marker", () => {
    expect(d.data.bouts[0].timing).toEqual({ walk: "14:15", firstBell: "14:20", finalBell: "14:51", walkOut: "14:56", readyBy: "14:15" });
    expect(d.data.bouts[5].title).toMatch(/IBF FEMALE WORLD LIGHTWEIGHT/); expect(d.data.bouts[5].female).toBe(true);
    expect(d.data.fighters[d.data.bouts[0].red].country).toBe("RS"); expect(d.data.fighters[d.data.bouts[5].blue].country).toBe("TR");
    expect(d.event.broadcast).toEqual({ network: "TBD", feedStart: "17:00", firstBroadcastBout: "B05" });
  });
  it("flags what it guessed", () => { expect(d.review.status).toBe("draft"); expect(d.review.flags.some((f) => /weight class .* inferred/.test(f))).toBe(true); expect(d.review.flags.some((f) => /anthems suggested US\/TR/.test(f))).toBe(true); });
  it("handles the other promoter's layout (single-dash header, HVY weights, ordinal date)", () => {
    const v = parseTimingSheet(vegas); expect(v.event.date).toBe("2026-04-25"); expect(v.event.venue).toBe("BLEAU LIVE ARENA"); expect(v.data.bouts.length).toBe(6);
    expect(v.data.fighters[v.data.bouts[5].blue].name).toBe("Jarrell Miller"); expect(v.data.fighters[v.data.bouts[5].blue].weightLbs).toBeNull();
    expect(v.review.flags.some((f) => /HVY/.test(f))).toBe(true);
  });
  it("feeds the Fight Night pack directly", () => { expect(deriveCues(d).length).toBe(159); }); // 157 + 2 anthem cues the parser suggested for bout 7
});

describe("bout sheet parser", () => {
  it("reads corners from the header (BLUE left on this promoter's sheet) and reverses to running order", () => {
    const d = parseBoutSheet(romero); expect(d.data.bouts.length).toBe(8);
    const main = d.data.bouts[7]; expect(main.isMain).toBe(true); expect(main.rounds).toBe(12);
    expect(d.data.fighters[main.blue].name).toBe("Rolando Romero"); expect(d.data.fighters[main.red].name).toBe("Teofimo Lopez");
    expect(d.data.bouts[0].rounds).toBe(6); expect(d.data.fighters[d.data.bouts[0].red].country).toBe("EC");
    expect(d.review.flags.some((f) => /rounds undecided .*4\/6/.test(f))).toBe(true);
  });
  it("reads RED-left sheets with network, main and co-main markers", () => {
    const d = parseBoutSheet(rocha); expect(d.data.bouts.length).toBe(10);
    const main = d.data.bouts[9]; expect(d.data.fighters[main.red].name).toBe("Alexis Rocha"); expect(main.title).toMatch(/NABO & NABF/);
    expect(d.data.bouts[8].isCoMain).toBe(true); expect(d.event.broadcast?.network).toBe("DAZN");
    expect(d.data.fighters[d.data.bouts[6].red].country).toBe("UZ");
  });
});

describe("running order parser", () => {
  const r = parseRundown(ro);
  it("reads header facts and the prelim card", () => { expect(r.title).toBe("ROLLY ROMERO VS. TEOFIMO LOPEZ"); expect(r.venue).toMatch(/T-Mobile Arena/); expect(r.onAir).toBe("15:00"); expect(r.card.length).toBe(3); expect(r.card[0]).toMatchObject({ n: 1, rounds: 4, a: "ALDO BLANCAS", b: "RICKY MAMONE" }); });
  it("slices columns from the page geometry", () => {
    const one = r.rows.find((x) => x.no === "1")!; expect(one.time).toBe("15:00:00"); expect(one.source).toBe("EVS"); expect(one.kind).toBe("vt"); expect(one.durSec).toBe(30); expect(one.description).toMatch(/TITLES SFN/);
    const seven = r.rows.find((x) => x.no === "7")!; expect(seven.kind).toBe("gfx"); expect(seven.gfx).toMatch(/FF GFX: PPV FIGHT CARD/); expect(seven.durSec).toBe(20);
    const ten = r.rows.find((x) => x.no === "10")!; expect(ten.kind).toBe("mc"); expect(ten.description).toMatch(/RED CORNER WALK/);
  });
  it("turns VTs, full-frame GFX and MC beats into custom cue candidates", () => { const c = rundownToCustomCues(r); expect(c.length).toBeGreaterThan(15); expect(c[0].name).toMatch(/^VT: TITLES SFN/); expect(c.every((x) => x.origin === "rundown")).toBe(true); });
});

describe("merge later sheet versions", () => {
  it("reports changed rounds, records and removed bouts without renumbering fighters", () => {
    const a = parseTimingSheet(glendale); const b = JSON.parse(JSON.stringify(a));
    b.data.bouts[7].rounds = 10; b.data.fighters.F16.record.w = 24; b.data.bouts.splice(0, 1);
    const { doc, diff } = mergeSheets(a, b);
    expect(diff).toContain("Antonio Vargas v Jesse Rodriguez: rounds 12 → 10");
    expect(diff.some((d) => /Jesse Rodriguez: record/.test(d))).toBe(true);
    expect(diff.some((d) => /REMOVED bout Filip Stankovic/.test(d))).toBe(true);
    expect(doc.data.bouts.length).toBe(7); expect(doc.data.bouts[0].id).toBe("B01"); expect(doc.review.status).toBe("draft");
  });
  it("merges a timing sheet onto a bout-sheet card by fighter name", () => {
    const card = parseBoutSheet(rocha); const later = JSON.parse(JSON.stringify(card)); later.data.bouts[9].timing = { walk: "19:30" }; later.data.fighters[later.data.bouts[9].red].nick = "Lex";
    const { diff, doc } = mergeSheets(card, later); expect(doc.data.bouts[9].timing.walk).toBe("19:30"); expect(diff.length).toBe(0); // first-time timing/nick fills are not "changes"
  });
});
