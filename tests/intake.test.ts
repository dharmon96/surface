import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { intake } from "../core/intake/match.js";
import { tokenise } from "../core/intake/tokens.js";
import { planTranscodes, MAX_TEX } from "../core/intake/transcode.js";

import { numbered, matchroom } from "./fixtures-deliveries.js";

describe("tokeniser on real promoter paths", () => {
  it("reads kind, bout, side, screen words and written resolutions from any path level", () => {
    const e = tokenise("Fight Night/Walkouts/3b/Full Barge 1792 x 504_3b.mov");
    expect(e.kind).toBe("WALKOUT"); expect(e.bout).toBe(3); expect(e.side).toBe("b"); expect(e.screenWords).toContain("full barge"); expect(e.namedRes).toEqual({ w: 1792, h: 504 });
  });
  it("catches the 7a/8a folder-vs-file swap", () => { const e = tokenise("Fight Night/Walkouts/7a/8a_Tunnel_1.mov"); expect(e.bout).toBe(8); expect(e.conflicts.length).toBeGreaterThan(0); });
  it("ignores archive and layered-source folders", () => { expect(tokenise("Fight Night/Archieve(DONT USE)/Ribbons (Dont Use)/x.mov").ignored).toBeTruthy(); expect(tokenise("A/CEREMONY LAYERED FILES/x.png").ignored).toBeTruthy(); expect(tokenise("Fight Night/_Updates/Main Board/Winners/1a.mov").update).toBe(true); });
  it("reads full names and screen prefixes from the Matchroom layout", () => { const e = tokenise("VENUE SCREENS/WINNER/WINNER RUIZ/HUNG_WINNER RUIZ.mp4"); expect(e.kind).toBe("WINNER"); expect(e.names).toContain("ruiz"); expect(e.screenWords).toContain("hung"); });
});

describe("numbered delivery (1a/1b) against an 8-bout sheet", () => {
  it("cannot resolve direction or a/b without a named file, and says so", () => {
    const r = intake(numbered.doc, numbered.manifest, numbered.probes, numbered.syn);
    expect(r.scheme.direction).toBe("unknown"); expect(r.scheme.aIs).toBe("unknown"); expect(r.scheme.boutCountMatches).toBe(true);
    expect(r.assignments.filter((a) => /WALKOUT|WINNER/.test(a.slot)).length).toBe(0);
    expect(r.scheme.evidence.some((e) => /must be confirmed/.test(e))).toBe(true);
  });
  it("maps the whole package once the operator confirms the scheme", () => {
    const r = intake(numbered.doc, numbered.manifest, numbered.probes, numbered.syn, { override: { direction: "opener-first", aIs: "red" } });
    expect(r.assignments.length).toBeGreaterThan(280);
    const w = r.assignments.find((a) => a.slot === "B03_WALKOUT_BLUE_BARGE_1792x504")!; expect(w.file).toMatch(/Walkouts\/3b\/Full Barge/); expect(w.confidence).toBeGreaterThan(0.8);
    expect(r.assignments.find((a) => a.slot === "B08_ROUND_07_MAIN_1920x1080")!.file).toBe("Fight Night/Rounds/1080 x 1920/7.mov"); // folder lies about size; pixels win
    expect(r.assignments.find((a) => a.slot === "B04_UP_NEXT_B05_BARGE_1792x504")!.file).toMatch(/Upnext\/5\.mov/);
    expect(r.assignments.find((a) => a.slot === "B05_TALE_MAIN_1920x1080")!.file).toMatch(/Midfights\/5\.mov/);
    expect(r.ignored.length).toBe(6);
  });
  it("prefers _Updates files and reports the replacement", () => {
    const r = intake(numbered.doc, numbered.manifest, numbered.probes, numbered.syn, { override: { direction: "opener-first", aIs: "red" } });
    expect(r.assignments.find((a) => a.slot === "B01_WINNER_BLUE_MAIN_1920x1080")!.file).toMatch(/_Updates/);
    expect(r.issues.some((i) => /replaced by .*_Updates/.test(i))).toBe(true);
  });
  it("surfaces the 7a/8a swap instead of silently trusting either", () => {
    const r = intake(numbered.doc, numbered.manifest, numbered.probes, numbered.syn, { override: { direction: "opener-first", aIs: "red" } });
    const swapped = r.assignments.filter((a) => a.issues.some((i) => /folder '7a' but file says '8a'|folder '8a' but file says '7a'/.test(i)));
    expect(swapped.length).toBeGreaterThan(0); expect(swapped.every((a) => a.confidence < 0.8)).toBe(true);
  });
  it("never guesses a screen: 28k-wide ribbon files stay unmatched when the venue has no fascia", () => {
    const r = intake(numbered.doc, numbered.manifest, numbered.probes, numbered.syn, { override: { direction: "opener-first", aIs: "red" } });
    expect(r.assignments.some((a) => /Ribbons/.test(a.file))).toBe(false);
    expect(r.unmatched.some((u) => /Ribbons/.test(u.file) && /screen ambiguous/.test(u.why))).toBe(true);
  });
});

describe("Matchroom delivery (names in paths, fascia rasters)", () => {
  const r = intake(matchroom.doc, matchroom.manifest, matchroom.probes, matchroom.syn);
  it("maps fighter files by name without needing a numbering scheme", () => {
    expect(r.assignments.find((a) => a.slot === "B08_WINNER_RED_HUNG_1920x1080")!.file).toBe("VENUE SCREENS/WINNER/WINNER RUIZ/HUNG_WINNER RUIZ.mp4");
    expect(r.assignments.find((a) => a.slot === "B08_FIGHTER_BLUE_FASCIA_LO_28576x64")!.file).toMatch(/LOWER_LED_FASCIA_DAMIAN KNYBA/);
    expect(r.assignments.find((a) => a.slot === "B07_FIGHTER_RED_TRUSS_1728x384")!.file).toMatch(/TRUSS_VITO MIELNICKI JR/);
  });
  it("maps matchups to the fight base and shares generic round cards across bouts", () => {
    expect(r.assignments.find((a) => a.slot === "B08_TALE_HUNG_1920x1080")!.file).toMatch(/HUNG_RUIZ VS KNYBA/);
    expect(r.assignments.find((a) => a.slot === "B01_ROUND_07_TRUSS_1728x384")!.file).toMatch(/TRUSS_ROUND 7/);
    expect(r.assignments.find((a) => a.slot === "B08_ROUND_12_FASCIA_UP_27808x64")!.file).toMatch(/UPPER_LED_FASCIA_ROUND 12/);
  });
  it("follows the filename, not the mislabeled folder, for CHAVES VS GARCIA", () => {
    const a = r.assignments.find((x) => x.slot === "B05_TALE_HUNG_1920x1080")!; expect(a.file).toMatch(/CHAVES VS GARCIA/);
  });
  it("plans tiling for rasters wider than the GPU texture limit and strips stray audio", () => {
    const jobs = planTranscodes(r.assignments, matchroom.probes, matchroom.manifest, { engine: "resolume", outDir: "M" });
    const fascia = jobs.find((j) => /FASCIA_LO/.test(j.slot))!; expect(fascia.out.length).toBe(Math.ceil(28576 / MAX_TEX)); expect(fascia.action).toBe("encode+tile"); expect(fascia.args[1].join(" ")).toMatch(/crop=14288:64:14288:0/); // 28576/2 = 14288, already 4-aligned
    const winner = jobs.find((j) => /B08_WINNER_RED_HUNG/.test(j.slot))!; expect(winner.keepAudio).toBe(false); expect(winner.args[0]).toContain("-an"); expect(winner.codec).toBe("dxv");
    expect(jobs.every((j) => j.deleteOriginal === false)).toBe(true);
  });
});
