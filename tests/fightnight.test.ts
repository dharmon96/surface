import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { deriveCues, loadShowDoc, resolumePlan, disguiseCueTables, companionPage, mediaManifest } from "../core/index.js";

const doc = loadShowDoc(JSON.parse(readFileSync(new URL("../fixtures/2026-06-13-glendale.bout.json", import.meta.url), "utf8")));
const cues = deriveCues(doc);

describe("Boxing Fight Night pack on the June 13 Glendale sheet", () => {
  it("derives a deterministic cue list", () => {
    expect(cues.length).toBe(deriveCues(doc).length);
    expect(cues.map((c) => c.n)).toEqual(cues.map((_, i) => i + 1));
    expect(new Set(cues.map((c) => c.id)).size).toBe(cues.length);
  });
  it("uses the fixed numbering: main event rounds are 8.11..8.22, winners 8.90/91/92", () => {
    const r1 = cues.find((c) => c.id === "B08.R01")!; const r12 = cues.find((c) => c.id === "B08.R12")!;
    expect(r1.d3?.tag).toBe("8.11"); expect(r12.d3?.tag).toBe("8.22");
    expect(cues.find((c) => c.id === "B08.WIN_DRAW")!.d3?.tag).toBe("8.92");
    expect(cues.filter((c) => c.id.startsWith("B02.R")).length).toBe(6); // 6-rounder
  });
  it("puts the fight base on BASE and rounds on OVERLAY with a timed revert", () => {
    const tale = cues.find((c) => c.id === "B08.TALE")!;
    expect(tale.targets.every((t) => t.actions.some((a) => a.layer === "BASE" && a.op === "show"))).toBe(true);
    expect(tale.targets.every((t) => t.actions.some((a) => a.layer === "FULL" && a.op === "clear"))).toBe(true);
    const r3 = cues.find((c) => c.id === "B08.R03")!;
    const show = r3.targets[0].actions.find((a) => a.op === "show")!;
    expect(show.layer).toBe("OVERLAY");
    expect(show.op === "show" && show.media.behaviour).toEqual({ kind: "timed", holdSec: 10, then: "revertBase" });
  });
  it("resolves scope: rounds only hit LED surfaces, walkouts skip the ribbon, winners are ALL", () => {
    const r = cues.find((c) => c.id === "B08.R01")!; expect(r.resolume?.groups).toEqual(["MAIN", "RIBBON"]);
    const w = cues.find((c) => c.id === "B08.WALK_RED")!; expect(w.resolume?.groups).toEqual(["MAIN", "IMAG_L", "IMAG_R"]);
    expect(cues.find((c) => c.id === "B08.WIN_RED")!.resolume?.groups).toBe("ALL");
  });
  it("names slots deterministically with screen resolution", () => {
    const m = mediaManifest(doc, cues);
    expect(m.find((x) => x.slot === "B08_ROUND_07_MAIN_3840x1080")).toBeTruthy();
    expect(m.find((x) => x.slot === "B08_ROUND_07_RIBBON_7680x216")?.behaviour).toBe("timed");
    expect(m.find((x) => x.slot === "B08_WINNER_RED_IMAG_L_1920x1080")?.behaviour).toBe("playHold");
  });
  it("builds a Resolume plan with one group per surface and three layers each", () => {
    const plan = resolumePlan(doc, cues, "C:/m", "C:/s.avc");
    expect(plan.filter((o) => o.op === "addGroup").map((o: any) => o.name)).toEqual(["MAIN", "RIBBON", "IMAG_L", "IMAG_R"]);
    expect((plan[0] as any).layers).toBe(12);
    expect(plan.filter((o) => o.op === "renameColumn").length).toBe(cues.length);
  });
  it("emits disguise cue tables per surface track", () => {
    const t = disguiseCueTables(doc, cues);
    expect(Object.keys(t)).toContain("B08_RIBBON_cue_table.txt");
    expect(t["B08_MAIN_cue_table.txt"].split("\n")[1]).toBe("Beat\tTag\tNote\tTrack Time\tTimecode Time\tSection Break");
  });
  it("lays out a Companion page with corner logic and 12 round keys", () => {
    const p = companionPage(doc, cues, "B08", 9, { mode: "bridge" });
    expect(p.page.controls["1"]["0"].style.text).toBe("R 1");
    expect(p.page.controls["0"]["1"].style.text).toBe("WALK\\nRED");
    expect(p.page.controls["0"]["6"].style.text).toBe("WALK\\nBLUE");
    expect(p.page.controls["3"]["7"].style.text).toBe("PANIC\\nBLACK");
    expect(cues.find((c) => c.id === "B08.R01")!.companion).toEqual({ page: 9, row: 1, col: 0 });
  });
});
