import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { placeFile, type PlaceSlot } from "../core/intake/place.js";
import { intake, placementsOf } from "../core/intake/match.js";
import { planTranscodes } from "../core/intake/transcode.js";
import { deriveCues, loadShowDoc, mediaManifest } from "../core/index.js";
import { buildBoard } from "../server/board.js";
import { numbered } from "./fixtures-deliveries.js";
import type { ShowDoc } from "../core/types.js";

const doc = loadShowDoc(JSON.parse(readFileSync(new URL("../fixtures/2026-06-13-glendale.bout.json", import.meta.url), "utf8")));
const board = buildBoard({ doc, cues: deriveCues(doc), intake: null, thumbUrl: (p) => p });
const rows = Object.fromEntries(board.rows.map((r) => [r.id, r]));
const slotsOf = (row: string, cell: string): PlaceSlot[] => rows[row].cells[cell].slots.map((s) => ({ slot: s.slot, screen: s.screen, w: s.w, h: s.h, cue: s.slot.startsWith("B08_WINNER_RED") ? "B08.WIN_RED" : s.slot.startsWith("B08_WINNER_BLUE") ? "B08.WIN_BLUE" : s.slot.startsWith("B08_WINNER_DRAW") ? "B08.WIN_DRAW" : rows[row].cells[cell].cues[0]?.id ?? "" }));

describe("where a dropped file goes", () => {
  it("lands on every screen whose pixels match exactly — both IMAGs take one 1920x1080 file", () => {
    const p = placeFile(slotsOf("B08", "WALK_RED"), { w: 1920, h: 1080 });
    expect("ready" in p).toBe(true);
    const ready = (p as any).ready;
    expect(ready.map((r: any) => r.slot).sort()).toEqual(["B08_WALKOUT_RED_IMAG_L_1920x1080", "B08_WALKOUT_RED_IMAG_R_1920x1080"]);
    expect(ready.every((r: any) => r.fit === "exact")).toBe(true);
  });
  it("a bigger render of the same shape scales onto the wall it fits", () => {
    const p = placeFile(slotsOf("B08", "WALK_RED"), { w: 7680, h: 2160 }) as any;   // 3840x1080 shape
    expect(p.ready.map((r: any) => r.slot)).toEqual(["B08_WALKOUT_RED_MAIN_3840x1080"]);
    expect(p.ready[0].fit).toBe("scale");
  });
  it("choosing one screen square overrides the pixels and letterboxes", () => {
    const p = placeFile(slotsOf("B08", "WALK_RED"), { w: 1000, h: 1000 }, { screen: "IMAG_L" }) as any;
    expect(p.ready).toEqual([{ slot: "B08_WALKOUT_RED_IMAG_L_1920x1080", fit: "letterbox" }]);
  });
  it("a shape that fits nothing asks which screen, and never guesses between two", () => {
    const p = placeFile(slotsOf("B08", "WALK_RED"), { w: 1000, h: 1000 }) as any;
    expect(p.ask).toBe("screen");
    expect(p.options.length).toBeGreaterThan(1);
    expect(p.options.every((o: any) => /will letterbox into/.test(o.note))).toBe(true);
  });
  it("a winner cell asks who won first, then places", () => {
    const slots = slotsOf("B08", "WINNER");
    const ask = placeFile(slots, { w: 3840, h: 1080 }) as any;
    expect(ask.ask).toBe("variant");
    expect(ask.options.map((o: any) => o.cue).sort()).toEqual(["B08.WIN_BLUE", "B08.WIN_DRAW", "B08.WIN_RED"]);
    const done = placeFile(slots, { w: 3840, h: 1080 }, { cue: "B08.WIN_BLUE" }) as any;
    expect(done.ready.map((r: any) => r.slot)).toEqual(["B08_WINNER_BLUE_MAIN_3840x1080"]);
  });
});

describe("a placed file beats the inference", () => {
  const manifest = numbered.manifest; const override = { direction: "opener-first" as const, aIs: "red" as const };
  const baseline = intake(numbered.doc, manifest, numbered.probes, numbered.syn, { override });
  const withPlacement = (placements: Record<string, string>) => intake(numbered.doc, manifest, numbered.probes, numbered.syn, { override, placements });

  it("is honoured before matching, at full confidence, and leaves the unplaced list", () => {
    const file = "Fight Night/_Updates/Main Board/Holding/Main Board_1920 x 1080.mov";
    expect(baseline.unmatched.some((u) => u.file === file)).toBe(true);            // today it is a question
    const r = withPlacement({ EVT_HOLD_SPONSOR_MAIN_1920x1080: file });
    const a = r.assignments.find((x) => x.slot === "EVT_HOLD_SPONSOR_MAIN_1920x1080")!;
    expect(a).toMatchObject({ file, confidence: 1, origin: "operator" });
    expect(a.reasons).toContain("placed by you");
    expect(r.unmatched.some((u) => u.file === file)).toBe(false);
    expect(r.lost).toEqual([]);
  });
  it("takes that file out of the running everywhere else, and says so", () => {
    const file = "Fight Night/Walkouts/3b/Full Barge 1792 x 504_3b.mov";
    const r = withPlacement({ B04_WALKOUT_RED_BARGE_1792x504: file });
    expect(r.assignments.find((a) => a.slot === "B04_WALKOUT_RED_BARGE_1792x504")!.origin).toBe("operator");
    expect(r.assignments.find((a) => a.slot === "B03_WALKOUT_BLUE_BARGE_1792x504")?.file).not.toBe(file);
    const displaced = r.unmatched.find((u) => /Walkouts\/4a\/Full Barge/.test(u.file));
    if (displaced) expect(displaced.why).toMatch(/taken by a file you placed/);
  });
  it("an event-wide round card placed on one bout still serves the others", () => {
    const file = "Fight Night/Rounds/1080 x 1920/7.mov";
    const r = withPlacement({ B05_ROUND_07_MAIN_1920x1080: file });
    expect(r.assignments.find((a) => a.slot === "B05_ROUND_07_MAIN_1920x1080")!.origin).toBe("operator");
    expect(r.assignments.find((a) => a.slot === "B01_ROUND_07_MAIN_1920x1080")!.file).toBe(file);
    expect(r.assignments.find((a) => a.slot === "B08_ROUND_07_MAIN_1920x1080")!.file).toBe(file);
  });
  it("a placement whose file or graphic is gone is reported, never dropped in silence", () => {
    const r = withPlacement({ B03_TALE_MAIN_1920x1080: "nope/gone.mov", B99_TALE_MAIN_1920x1080: "Fight Night/_Updates/Main Board/Midfights/5.mov" });
    expect(r.lost).toEqual([
      { slot: "B03_TALE_MAIN_1920x1080", file: "nope/gone.mov", why: "file gone" },
      { slot: "B99_TALE_MAIN_1920x1080", file: "Fight Night/_Updates/Main Board/Midfights/5.mov", why: "slot gone" },
    ]);
    expect(r.issues.filter((i) => /you placed/.test(i)).length).toBe(2);
    expect(r.assignments.find((a) => a.slot === "B03_TALE_MAIN_1920x1080")!.file).toMatch(/Midfights\/3\.mov/); // a lost placement blocks nothing
  });
  it("reaches slots outside the pack's own grammar, and the conversion plan", () => {
    const file = "Fight Night/_Updates/Main Board/Midfights/5.mov";
    const r = withPlacement({ EVT_TEST_MAIN_1920x1080: file });                     // a test-pattern slot: in the manifest, never auto-matched
    expect(r.assignments.find((a) => a.slot === "EVT_TEST_MAIN_1920x1080")!.origin).toBe("operator");
    const jobs = planTranscodes(r.assignments, numbered.probes, manifest, { engine: "resolume", outDir: "M" });
    const j = jobs.find((x) => x.slot === "EVT_TEST_MAIN_1920x1080")!;
    expect(j.src).toBe(file); expect(j.out).toEqual(["M/EVT_TEST_MAIN_1920x1080.mov"]);
  });
  it("comes from the doc without being asked for, and {} ignores it", () => {
    const d: ShowDoc = { ...numbered.doc, placements: { EVT_HOLD_MAIN_BARGE_1792x504: { file: "Fight Night/_Updates/Ribbons/Lower/Holding/Lower_Holding_V2.mov", origin: "operator", at: "2026-09-07T00:00:00Z" } } };
    expect(placementsOf(d)).toEqual({ EVT_HOLD_MAIN_BARGE_1792x504: "Fight Night/_Updates/Ribbons/Lower/Holding/Lower_Holding_V2.mov" });
    const r = intake(d, manifest, numbered.probes, numbered.syn, { override });
    const a = r.assignments.find((x) => x.slot === "EVT_HOLD_MAIN_BARGE_1792x504")!;
    expect(a.origin).toBe("operator");
    expect(a.issues[0]).toMatch(/will scale/);
    const ignored = intake(d, manifest, numbered.probes, numbered.syn, { override, placements: {} });
    expect(ignored.assignments.length).toBe(baseline.assignments.length);
  });
});
