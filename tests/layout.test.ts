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
