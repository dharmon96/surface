import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { deriveCues, loadShowDoc } from "../core/index.js";
import { toShowCall, fromShowCall } from "../core/integrations/showcall.js";
import { fromPixelMapper, contentGuideRows } from "../core/integrations/pixelmapper.js";

const doc = loadShowDoc(JSON.parse(readFileSync(new URL("../fixtures/2026-06-13-glendale.bout.json", import.meta.url), "utf8")));
const cues = deriveCues(doc);

describe("ShowCall bridge", () => {
  it("exports cues with section headers per bout and a Video department instruction, numbered like Surface", () => {
    const sc = toShowCall(doc, cues);
    const hdrs = sc.cues.filter((c: any) => c.cue_type === "section-header"); expect(hdrs.length).toBe(8); expect(hdrs[7].color).toBe("#d4a63a");
    const r7 = sc.cues.find((c: any) => c.title === "Round 7" && c.cue_number === String(cues.find((x) => x.id === "B08.R07")!.n).padStart(3, "0"));
    expect(r7.departments[0].department_name).toBe("Video"); expect(r7.departments[0].instructions).toMatch(/Resolume col \d+ \(MAIN,RIBBON\)/); expect(r7.departments[0].instructions).toMatch(/Main LED → OVERLAY: B08_ROUND_07_MAIN_3840x1080/);
  });
  it("imports ShowCall-only cues as custom candidates and ignores the ones Surface authored", () => {
    const extra = fromShowCall(cues, [{ cue_number: "001", title: "already ours" }, { cue_number: "A12", title: "Sponsor read — Toyota", description: "MC reads", duration_seconds: 45, departments: [{ department_name: "Audio", instructions: "sting under" }] }, { cue_number: "B01", title: "hdr", cue_type: "section-header" }]);
    expect(extra.length).toBe(1); expect(extra[0]).toMatchObject({ id: "SC.A12", origin: "rundown", scope: ["ALL"], follow: { afterSec: 45 } });
  });
});

describe("PixelMapper bridge", () => {
  const project = { screens: [
    { id: "screen_1", name: "Centerhung", panel: { pixelsW: 128, pixelsH: 128 }, panelsX: 30, panelsY: 8, rotation: 0 as const, canvasId: "c1" },
    { id: "screen_2", name: "Ribbon East", panel: { pixelsW: 128, pixelsH: 64 }, panelsX: 60, panelsY: 1, rotation: 0 as const },
    { id: "screen_3", name: "Ribbon West", panel: { pixelsW: 128, pixelsH: 64 }, panelsX: 60, panelsY: 1, rotation: 0 as const },
    { id: "screen_4", name: "Host Booth", panel: { pixelsW: 104, pixelsH: 104 }, panelsX: 4, panelsY: 8, rotation: 90 as const },
    { id: "screen_5", name: "Hidden test", panel: { pixelsW: 128, pixelsH: 128 }, panelsX: 1, panelsY: 1, visible: false },
  ], screenGroups: [{ id: "g1", name: "Ribbons", screenIds: ["screen_2", "screen_3"] }] };
  it("derives pixel sizes, groups into surfaces, marks independent ones, and seeds screen words", () => {
    const r = fromPixelMapper(project);
    expect(r.screens.map((s) => [s.id, s.w, s.h])).toEqual([["CENTERHUNG", 3840, 1024], ["RIBBON_EAST", 7680, 64], ["RIBBON_WEST", 7680, 64], ["HOST_BOOTH", 832, 416]]); // booth rotated 90°
    expect(r.surfaces.find((s) => s.id === "RIBBONS")!.screens).toEqual(["RIBBON_EAST", "RIBBON_WEST"]);
    expect(r.surfaces.find((s) => s.id === "HOST_BOOTH")!.independent).toBe(true);
    expect(r.screenWords.CENTERHUNG).toContain("centerhung"); expect(r.flags).toEqual([]);
  });
  it("produces content-guide rows a promoter can follow", () => {
    const r = fromPixelMapper(project); const rows = contentGuideRows(r.screens, r.surfaces);
    expect(rows.find((x) => x.surface === "Centerhung")).toMatchObject({ pixels: "3840 × 1024", aspect: "15:4", naming: "{Bout}_{Graphic}_{Variant}_CENTERHUNG_3840x1024" });
  });
});
