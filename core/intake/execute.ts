/**
 * Transcode executor: runs TranscodeJobs with ffmpeg, verifies every output, and only then (optionally) removes the original.
 * Idempotent: a job is skipped when the output exists and the manifest says it came from the same source (size+mtime hash).
 *
 * Encoder fallbacks are checked once at start (`ffmpeg -encoders`): no `dxv` → HAP Q (Resolume plays HAP natively);
 * no `hap` → H.264. The fallback is recorded in the manifest so the pre-show report is honest about what was produced.
 */
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import type { TranscodeJob } from "./transcode.js";
import { probe } from "./intake.js";

const run = promisify(execFile);
export interface ExecOpts { ffmpeg?: string; concurrency?: number; deleteOriginals?: boolean; srcRoot: string; onProgress?: (e: ExecEvent) => void; dryRun?: boolean }
export type ExecEvent = { job: string; phase: "start" | "encode" | "verify" | "done" | "skipped" | "failed" | "deleted"; detail?: string; pct?: number };
export interface ManifestEntry { slot: string; src: string; srcHash: string; outputs: string[]; codec: string; action: string; verifiedAt: string; fallback?: string; durationSec?: number; notes: string[] }

export async function availableEncoders(ffmpeg = "ffmpeg"): Promise<Set<string>> {
  try { const { stdout } = await run(ffmpeg, ["-hide_banner", "-encoders"]); return new Set([...stdout.matchAll(/^\s*[VASFXBD.]{6}\s+(\S+)/gm)].map((m) => m[1])); } catch { return new Set(); }
}
export function srcHash(path: string): string { const s = statSync(path); return createHash("sha1").update(`${s.size}:${Math.round(s.mtimeMs)}`).digest("hex").slice(0, 16); }

function rewriteEncoder(args: string[], from: string, to: "hap" | "libx264"): string[] {
  const a = [...args]; const i = a.indexOf("-c:v"); if (i < 0 || a[i + 1] !== from) return a;
  if (to === "hap") { a.splice(i, 2, "-c:v", "hap", "-format", "hap_q"); } else { a.splice(i, 2, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16"); const f = a.indexOf("-format"); if (f >= 0) a.splice(f, 2); }
  return a;
}

function ffmpegRun(ffmpeg: string, args: string[], onPct?: (p: number) => void, totalSec?: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, ["-hide_banner", "-nostats", "-progress", "pipe:2", ...args]); let err = "";
    p.stderr.on("data", (d) => { const s = String(d); err += s; const m = s.match(/out_time_ms=(\d+)/); if (m && totalSec && onPct) onPct(Math.min(99, Math.round((Number(m[1]) / 1e6 / totalSec) * 100))); if (err.length > 20000) err = err.slice(-10000); });
    p.on("error", reject); p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${err.split("\n").filter((l) => /error|invalid|failed|unknown/i.test(l)).slice(-3).join(" | ") || err.slice(-300)}`))));
  });
}

/** Output must decode and match the source duration within one frame (stills: exist and match the slot size). */
async function verify(out: string, expectSec: number, still: boolean): Promise<{ ok: boolean; why?: string; durationSec?: number }> {
  if (!existsSync(out) || statSync(out).size === 0) return { ok: false, why: "output missing or empty" };
  try { const p = await probe(out); if (still) return { ok: p.w > 0 && p.h > 0, why: p.w ? undefined : "unreadable image" }; const d = Math.abs(p.durationSec - expectSec); return d <= 0.07 ? { ok: true, durationSec: p.durationSec } : { ok: false, why: `duration ${p.durationSec.toFixed(2)}s vs source ${expectSec.toFixed(2)}s`, durationSec: p.durationSec }; }
  catch (e: any) { return { ok: false, why: `probe failed: ${e.message}` }; }
}

export async function executeTranscodes(jobs: TranscodeJob[], opts: ExecOpts): Promise<{ manifest: ManifestEntry[]; failed: { slot: string; error: string }[]; skipped: number; fallback?: string }> {
  const ffmpeg = opts.ffmpeg ?? "ffmpeg"; const enc = await availableEncoders(ffmpeg);
  const fallback = !enc.has("dxv") && jobs.some((j) => j.codec === "dxv") ? (enc.has("hap") ? "dxv→hap" : "dxv→h264") : !enc.has("hap") && jobs.some((j) => j.codec.startsWith("hap")) ? "hap→h264" : undefined;
  const outDir = jobs[0] ? dirname(jobs[0].out[0]) : "."; mkdirSync(outDir, { recursive: true });
  const manPath = join(outDir, "_manifest.json"); const manifest: ManifestEntry[] = existsSync(manPath) ? JSON.parse(readFileSync(manPath, "utf8")) : [];
  const failed: { slot: string; error: string }[] = []; let skipped = 0;
  const emit = (e: ExecEvent) => opts.onProgress?.(e);
  const queue = [...jobs]; const workers = Math.max(1, Math.min(opts.concurrency ?? 2, queue.length));
  await Promise.all(Array.from({ length: workers }, async () => {
    for (let j = queue.shift(); j; j = queue.shift()) {
      const src = join(opts.srcRoot, j.src);
      if (!existsSync(src)) { failed.push({ slot: j.slot, error: `source missing: ${src}` }); emit({ job: j.slot, phase: "failed", detail: "source missing" }); continue; }
      const hash = srcHash(src); const prev = manifest.find((m) => m.slot === j.slot);
      if (prev && prev.srcHash === hash && prev.outputs.every((o) => existsSync(o))) { skipped++; emit({ job: j.slot, phase: "skipped", detail: "already produced from this source" }); continue; }
      emit({ job: j.slot, phase: "start", detail: `${j.action} ${j.codec}${fallback ? ` (${fallback})` : ""}` });
      if (opts.dryRun) { emit({ job: j.slot, phase: "done", detail: "dry run" }); continue; }
      try {
        const srcProbe = await probe(src); const outputs: string[] = [];
        for (let k = 0; k < j.args.length; k++) {
          let args = j.args[k].map((a) => (a === j.src ? src : a)); const out = args[args.length - 1]; const tmp = out.replace(/(\.[a-z0-9]+)$/i, ".part$1");
          if (fallback?.startsWith("dxv")) args = rewriteEncoder(args, "dxv", fallback.endsWith("hap") ? "hap" : "libx264"); if (fallback === "hap→h264") args = rewriteEncoder(args, "hap", "libx264");
          args[args.length - 1] = tmp; mkdirSync(dirname(out), { recursive: true });
          emit({ job: j.slot, phase: "encode", detail: out, pct: 0 });
          await ffmpegRun(ffmpeg, args, (pct) => emit({ job: j.slot, phase: "encode", detail: out, pct }), srcProbe.durationSec);
          emit({ job: j.slot, phase: "verify", detail: out });
          const v = await verify(tmp, srcProbe.durationSec, srcProbe.still); if (!v.ok) { try { unlinkSync(tmp); } catch {} throw new Error(`verify failed for ${out}: ${v.why}`); }
          renameSync(tmp, out); outputs.push(out);
        }
        const entry: ManifestEntry = { slot: j.slot, src: j.src, srcHash: hash, outputs, codec: fallback ? fallback.split("→")[1] : j.codec, action: j.action, verifiedAt: new Date().toISOString(), fallback, durationSec: srcProbe.durationSec, notes: j.notes };
        const idx = manifest.findIndex((m) => m.slot === j.slot); if (idx >= 0) manifest[idx] = entry; else manifest.push(entry);
        writeFileSync(manPath, JSON.stringify(manifest, null, 1));
        emit({ job: j.slot, phase: "done", detail: outputs.join(", ") });
        if (opts.deleteOriginals && j.deleteOriginal !== false) { const stillReferenced = jobs.some((o) => o !== j && o.src === j.src && !manifest.some((m) => m.slot === o.slot && m.srcHash === hash)); if (!stillReferenced) { unlinkSync(src); emit({ job: j.slot, phase: "deleted", detail: src }); } }
      } catch (e: any) { failed.push({ slot: j.slot, error: e.message }); emit({ job: j.slot, phase: "failed", detail: e.message }); }
    }
  }));
  return { manifest, failed, skipped, fallback };
}
