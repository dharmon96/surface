import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { probe } from "../core/intake/intake.js";
import { planTranscodes } from "../core/intake/transcode.js";
import { executeTranscodes, availableEncoders } from "../core/intake/execute.js";

const root = join(tmpdir(), `surface-exec-${process.pid}`); const src = join(root, "delivery"); const out = join(root, "media");
const manifest = [
  { slot: "B01_ROUND_01_BARGE_1792x504", screen: "BARGE", w: 1792, h: 504, layer: "OVERLAY", behaviour: "timed", usedBy: ["B01.R01"] },
  { slot: "B01_WALKOUT_RED_MAIN_640x360", screen: "MAIN", w: 640, h: 360, layer: "FULL", behaviour: "loop", usedBy: ["B01.WALK_RED"] },
  { slot: "EVT_HOLD_MAIN_WIDE_40000x64", screen: "WIDE", w: 40000, h: 64, layer: "BASE", behaviour: "loop", usedBy: ["EVT.HOLD_MAIN"] },
] as any;

beforeAll(() => {
  rmSync(root, { recursive: true, force: true }); mkdirSync(src, { recursive: true });
  // 2-second synthetic sources: a 1792x504 h264 with a stray audio track, a 640x360 mov, a 40000x64 "fascia" (tiny to keep it fast: 4000x64 scaled by the plan)
  execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "testsrc=size=1792x504:rate=30", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", join(src, "round 1.mp4")], { stdio: "ignore" });
  execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=30", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", join(src, "walk 1a.mov")], { stdio: "ignore" });
  execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=blue:size=4000x64:rate=30", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", join(src, "fascia hold.mov")], { stdio: "ignore" });
});

describe("transcode executor", () => {
  it("encodes, verifies, tiles ultra-wide rasters, strips stray audio, writes a manifest, and is idempotent", async () => {
    const probes = await Promise.all(["round 1.mp4", "walk 1a.mov", "fascia hold.mov"].map(async (f) => ({ ...(await probe(join(src, f))), file: f })));
    const assignments = [{ slot: manifest[0].slot, file: "round 1.mp4", confidence: 1, reasons: [], issues: [] }, { slot: manifest[1].slot, file: "walk 1a.mov", confidence: 1, reasons: [], issues: [] }, { slot: manifest[2].slot, file: "fascia hold.mov", confidence: 1, reasons: [], issues: [] }];
    const jobs = planTranscodes(assignments, probes, manifest, { engine: "disguise", outDir: out });
    expect(jobs.find((j) => j.slot.startsWith("EVT_HOLD"))!.out.length).toBe(3); // 40000 / 16384 → 3 tiles
    const events: string[] = [];
    const r = await executeTranscodes(jobs, { srcRoot: src, concurrency: 2, onProgress: (e) => events.push(`${e.phase}:${e.job}`) });
    expect(r.failed).toEqual([]); expect(r.manifest.length).toBe(3);
    const enc = await availableEncoders(); if (!enc.has("hap")) expect(r.fallback).toBe("hap→h264"); else expect(r.fallback).toBeUndefined();
    const round = await probe(join(out, "B01_ROUND_01_BARGE_1792x504.mov")); expect(round.audio).toBeNull(); expect(round.w).toBe(1792); expect(Math.abs(round.durationSec - 2)).toBeLessThan(0.1);
    const tile = await probe(join(out, "EVT_HOLD_MAIN_WIDE_40000x64_T2of3.mov")); expect(tile.w).toBe(13336); expect(tile.h).toBe(64); // 40000/3 → 13333.3 → 4-aligned 13336
    expect(existsSync(join(out, "_manifest.json"))).toBe(true); expect(existsSync(join(src, "round 1.mp4"))).toBe(true); // no delete by default
    expect(events.filter((e) => e.startsWith("verify")).length).toBe(5);
    const again = await executeTranscodes(jobs, { srcRoot: src }); expect(again.skipped).toBe(3);
  }, 120_000);
  it("deletes originals only after a verified output, and only when asked", async () => {
    const probes = [{ ...(await probe(join(src, "walk 1a.mov"))), file: "walk 1a.mov" }];
    const jobs = planTranscodes([{ slot: manifest[1].slot, file: "walk 1a.mov", confidence: 1, reasons: [], issues: [] }], probes, manifest, { engine: "generic", outDir: join(root, "media2"), deleteOriginals: true });
    const r = await executeTranscodes(jobs, { srcRoot: src, deleteOriginals: true }); expect(r.failed).toEqual([]); expect(existsSync(join(src, "walk 1a.mov"))).toBe(false);
  }, 60_000);
  it("reports a failure and leaves no partial output when the source is broken", async () => {
    writeFileSync(join(src, "broken.mov"), "not a movie");
    const jobs = planTranscodes([{ slot: manifest[1].slot, file: "broken.mov", confidence: 1, reasons: [], issues: [] }], [{ file: "broken.mov", w: 640, h: 360, durationSec: 2, fps: 30, hasAlpha: false, still: false, bytes: 11, codec: "h264", pix: "yuv420p", audio: null }], manifest, { engine: "generic", outDir: join(root, "media3") });
    const r = await executeTranscodes(jobs, { srcRoot: src }); expect(r.failed.length).toBe(1); expect(existsSync(join(root, "media3", "B01_WALKOUT_RED_MAIN_640x360.mov"))).toBe(false); expect(existsSync(join(root, "media3", "B01_WALKOUT_RED_MAIN_640x360.part.mov"))).toBe(false);
  }, 60_000);
});
