import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { loadShowDoc, deriveCues, resolumePlan, companionPage, disguiseCueTables } from "../core/index.js";
import { resolumeAddress, resolumeGroupsFor } from "../core/engine/adapter.js";

const base = loadShowDoc(JSON.parse(readFileSync(new URL("../fixtures/2026-06-13-glendale.bout.json", import.meta.url), "utf8")));
const withLayout = (l: "per-screen" | "together") => ({ ...base, build: { resolumeLayout: l } });

describe("composition layouts", () => {
  it("per-screen: a group per surface, rounds connect only the groups they touch, Companion fires one action per group", () => {
    const doc = withLayout("per-screen"); const cues = deriveCues(doc);
    const plan = resolumePlan(doc, cues, "D:/media", "D:/show.avc");
    expect(plan.filter((o) => o.op === "addGroup").map((o: any) => o.name)).toEqual(doc.surfaces.map((s) => s.id));
    const r7 = cues.find((c) => c.id === "B08.R07")!; expect(resolumeGroupsFor(doc, r7)).toEqual([1, 2]); // MAIN + RIBBON
    const walk = cues.find((c) => c.id === "B08.WALK_RED")!; expect(resolumeGroupsFor(doc, walk)).toEqual([1, 3, 4]); // MAIN + IMAG L/R, never the ribbon
    expect(resolumeGroupsFor(doc, cues.find((c) => c.id === "B08.WIN_RED")!)).toBe("ALL");
    const page = companionPage(doc, cues, "B08", 9, { mode: "direct" });
    const btn = JSON.stringify(page).match(/"definitionId":"connectLayerGroupColumn"/g) ?? []; expect(btn.length).toBeGreaterThanOrEqual(24); // 12 rounds × 2 groups
    expect(JSON.stringify(page)).toMatch(/"connectColumn".*"lookupMode":\{"isExpression":false,"value":"byIndex"\}/);
  });
  it("together: SHOW + ROUNDS groups, one layer per surface each, every cue is a composition-wide column", () => {
    const doc = withLayout("together"); const cues = deriveCues(doc);
    const plan = resolumePlan(doc, cues, "D:/media", "D:/show.avc");
    expect(plan.filter((o) => o.op === "addGroup").map((o: any) => o.name)).toEqual(["SHOW", "ROUNDS"]);
    expect((plan[0] as any).layers).toBe(doc.surfaces.length * 2);
    expect(resolumeAddress(doc, "RIBBON", "OVERLAY")).toEqual({ group: 2, layer: doc.surfaces.length + 2 });
    const r7 = cues.find((c) => c.id === "B08.R07")!; expect(resolumeGroupsFor(doc, r7)).toBe("ALL");
    const roundClips = plan.filter((o: any) => o.op === "openClip" && o.column === r7.n); expect(roundClips.every((o: any) => o.layer > doc.surfaces.length)).toBe(true); // rounds only in the ROUNDS group
    const walk = cues.find((c) => c.id === "B08.WALK_RED")!; const walkClips = plan.filter((o: any) => o.op === "openClip" && o.column === walk.n); expect(walkClips.every((o: any) => o.layer <= doc.surfaces.length)).toBe(true);
    const tables = disguiseCueTables(doc, cues); expect(Object.keys(tables).sort()).toEqual(["ROUNDS_cue_table.txt", "SHOW_cue_table.txt"]);
    const page = companionPage(doc, cues, "B08", 9, { mode: "direct" }); expect(JSON.stringify(page)).not.toMatch(/connectLayerGroupColumn/);
  });
});

describe("screen detection from shape", () => {
  it("accepts a bigger render of the same aspect, and one file serves identical screens", async () => {
    const { screenFromEvidence, tokenise } = await import("../core/intake/tokens.js");
    const syn = { MAIN: { words: ["main"], w: 3840, h: 1080 }, IMAG_L: { words: ["imag left"], w: 1920, h: 1080 }, IMAG_R: { words: ["imag right"], w: 1920, h: 1080 }, RIBBON: { words: ["ribbon"], w: 7680, h: 216 } };
    const ev = (w: number, h: number, name = "x/1A_Walkout.mp4") => tokenise(name, { file: name, w, h, durationSec: 5, fps: 30, still: false, codec: "h264", pix: "yuv420p", audio: false } as any);
    expect(screenFromEvidence(ev(7680, 2160), syn)).toMatchObject({ by: "aspect", all: ["MAIN"] });          // 4K render of the 32:9 wall
    expect(screenFromEvidence(ev(3840, 2160), syn)).toMatchObject({ by: "aspect", all: ["IMAG_L", "IMAG_R"] }); // UHD 16:9 → both IMAGs
    expect(screenFromEvidence(ev(1920, 1080), syn)).toMatchObject({ by: "res", all: ["IMAG_L", "IMAG_R"] });
    expect(screenFromEvidence(ev(1000, 1000), syn).surface).toBeNull();
  });
  it("the screen-map file names become screens, common project prefix stripped, layout render preferred", async () => {
    const { screensFromMapFiles } = await import("../core/index.js");
    const r = screensFromMapFiles([{ name: "Glendale_Main_LED_layout_3840x1080.png", w: 3840, h: 1080 }, { name: "Glendale_Main_LED_wiring-diagram_3840x1080.png", w: 3840, h: 1080 }, { name: "Glendale_Ringside_Ribbon_layout_7680x216.png", w: 7680, h: 216 }, { name: "random.png", w: 1920, h: 1080 }]);
    expect(r.project).toBe("Glendale"); expect(r.screens.map((s) => s.id)).toEqual(["MAIN_LED", "RINGSIDE_RIBBON", "RANDOM"]); expect(r.screens[0].file).toMatch(/_layout_/);
  });
});
