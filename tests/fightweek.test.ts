import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { deriveCues, loadShowDoc, companionPage } from "../core/index.js";

const base = loadShowDoc(JSON.parse(readFileSync(new URL("../fixtures/2026-06-13-glendale.bout.json", import.meta.url), "utf8")));
const pc = JSON.parse(JSON.stringify(base)); pc.screens = [{ id: "WALL", name: "Main wall", w: 3840, h: 1080 }, { id: "TABLE_1", name: "Table 1", w: 1920, h: 384 }, { id: "TABLE_2", name: "Table 2", w: 1920, h: 384 }];
pc.surfaces = [{ id: "WALL", name: "Main wall", screens: ["WALL"] }, { id: "TABLE_1", name: "Table 1", screens: ["TABLE_1"], independent: true }, { id: "TABLE_2", name: "Table 2", screens: ["TABLE_2"], independent: true }];
const wi = JSON.parse(JSON.stringify(base)); wi.screens = [{ id: "WALL", name: "Main wall", w: 3840, h: 1080 }, { id: "SCALE", name: "Scale panels", w: 384, h: 1152 }];
wi.surfaces = [{ id: "WALL", name: "Main wall", screens: ["WALL"] }, { id: "SCALE", name: "Scale panels", screens: ["SCALE"], independent: true }];

describe("fight-week packs share the bout data", () => {
  it("press conference: walls hold, tables carry one fighter each, intros are brief timed flashes", () => {
    const cues = deriveCues(pc, "boxing.pressconf");
    expect(cues.find((c) => c.id === "PC.HOLD_STEP")).toBeTruthy();
    const t1 = cues.find((c) => c.id === "B08.PC_TABLE_TABLE_1")!; expect(t1.scope).toEqual(["TABLE_1"]); expect(t1.targets[0].actions[0]).toMatchObject({ layer: "BASE", op: "show" });
    const intro = cues.find((c) => c.id === "B08.PC_INTRO_RED")!; const a = intro.targets[0].actions[0]; expect(a.op === "show" && a.media.behaviour).toEqual({ kind: "timed", holdSec: 8, then: "clear" });
    expect(cues.every((c) => !c.targets.some((t) => t.surface.startsWith("TABLE") && c.id.includes("HOLD")))).toBe(true); // ALL never touches independent tables
    expect(cues.find((c) => c.id === "B08.PC_FACEOFF")!.d3?.tag).toBe("108.1");
  });
  it("weigh-in: walk → scale plays to marker and pauses on the scale panels → face-off → step-and-repeat", () => {
    const cues = deriveCues(wi, "boxing.weighin"); const ids = cues.filter((c) => c.group === "B08").map((c) => c.id.split(".")[1]);
    expect(ids).toEqual(["WI_MATCHUP", "WI_WALK_RED", "WI_SCALE_RED", "WI_WALK_BLUE", "WI_SCALE_BLUE", "WI_FACEOFF", "WI_STEP"]);
    const sc = cues.find((c) => c.id === "B08.WI_SCALE_RED")!; expect(sc.scope).toEqual(["SCALE"]); const a = sc.targets[0].actions[0]; expect(a.op === "show" && a.media.behaviour).toEqual({ kind: "playToMarker", markerSec: 4 });
    expect(a.op === "show" && a.media.slot).toBe("B08_SCALE_RED_SCALE_384x1152");
    expect(cues.find((c) => c.id === "B08.WI_WALK_RED")!.scope).toEqual(["WALL"]);
  });
  it("the three packs never collide on disguise tags", () => {
    const tags = new Set([...deriveCues(base), ...deriveCues(pc, "boxing.pressconf"), ...deriveCues(wi, "boxing.weighin")].map((c) => c.d3?.tag));
    expect([...tags].filter((t) => t?.startsWith("108.")).length).toBeGreaterThan(0); expect([...tags].some((t) => t === "8.1")).toBe(true); expect([...tags].some((t) => t === "208.1")).toBe(true);
  });
  it("both fight-week packs end on EVT.TEST like fight night", () => {
    expect(deriveCues(pc, "boxing.pressconf").at(-1)!.id).toBe("EVT.TEST");
    expect(deriveCues(wi, "boxing.weighin").at(-1)!.id).toBe("EVT.TEST");
  });
  it("companion pages survive fight-week cues (no walkouts, no rounds) instead of crashing the bundle", () => {
    const cues = deriveCues(wi, "boxing.weighin");
    const page = companionPage(wi, cues, wi.data.bouts[0].id, 2, { mode: "bridge" });
    expect(page.version).toBe(12); expect(page.type).toBe("page");
  });
  it("an empty card derives holds only, without crashing", () => {
    const empty = JSON.parse(JSON.stringify(wi)); empty.data.bouts = []; empty.data.fighters = {};
    expect(() => deriveCues(empty, "boxing.weighin")).not.toThrow();
    expect(() => deriveCues(empty, "boxing.pressconf")).not.toThrow();
  });
});
