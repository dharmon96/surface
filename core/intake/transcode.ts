/**
 * Transcode planner: matched file -> engine-ready media under the slot name. Emits ffmpeg argument lists (data, not shell),
 * so the plan can be reviewed, diffed and executed by the desktop app or a CLI. Nothing here touches disk.
 *
 * Rules (from the survey of real deliveries):
 *  - engines want GPU codecs: Resolume DXV3 (`-c:v dxv`), disguise/others HAP (`-c:v hap`); H.264/ProRes get re-encoded.
 *  - stills stay PNG, resized only when the slot resolution differs.
 *  - rasters wider than MAX_TEX (16384) are tiled into N equal slices (fascia at 28576x64 -> 2 x 14288x64).
 *  - stray audio is stripped unless the slot's behaviour says the audio is the point (walkout music).
 *  - originals are deleted only after the output verifies (frame count within 1, decodes) — `deleteOriginal` is a plan flag.
 */
import type { Assignment } from "./match.js";
import type { Probe } from "./intake.js";
import type { mediaManifest } from "../gen/engines.js";

export type Engine = "resolume" | "disguise" | "generic";
export const MAX_TEX = 16384;
export interface TranscodeJob {
  slot: string; src: string; out: string[];                  // one output, or N tiles
  action: "copy" | "resize" | "encode" | "encode+tile" | "resize+tile";
  codec: "png" | "dxv" | "hap" | "hap_alpha" | "h264";
  args: string[][];                                          // ffmpeg argv per output
  keepAudio: boolean; fit: "exact" | "scale" | "letterbox";
  notes: string[]; deleteOriginal: boolean;
}

const gcdAspectClose = (a: number, b: number) => Math.abs(a - b) < 0.02;

export function planTranscodes(assignments: Assignment[], probes: Probe[], manifest: ReturnType<typeof mediaManifest>, opts: { engine: Engine; outDir: string; deleteOriginals?: boolean; keepAudioFor?: string[] }): TranscodeJob[] {
  const P = new Map(probes.map((p) => [p.file, p])); const M = new Map(manifest.map((m) => [m.slot, m]));
  const keepAudioFor = opts.keepAudioFor ?? ["WALKOUT", "VT"];
  const jobs: TranscodeJob[] = [];
  for (const a of assignments) {
    const p = P.get(a.file); const m = M.get(a.slot); if (!p || !m) continue;
    const notes: string[] = []; const graphic = a.slot.split("_")[1] === "UP" ? "UP_NEXT" : a.slot.split("_")[1];
    const keepAudio = !!p.audio && keepAudioFor.includes(graphic); if (p.audio && !keepAudio) notes.push(`audio track (${p.audio}) stripped`);
    const fit: TranscodeJob["fit"] = p.w === m.w && p.h === m.h ? "exact" : gcdAspectClose(p.w / p.h, m.w / m.h) ? "scale" : "letterbox";
    if (fit !== "exact") notes.push(`${p.w}x${p.h} → ${m.w}x${m.h} (${fit})`);
    const tiles = m.w > MAX_TEX ? Math.ceil(m.w / MAX_TEX) : 1;
    // GPU codecs (HAP/DXV) need dimensions in multiples of 4: tiles are cut at a 4-aligned width and the raster is padded (right edge, off-screen) to fit
    const tileW = tiles > 1 ? Math.ceil(m.w / tiles / 4) * 4 : m.w; const padW = tileW * tiles; const padH = Math.ceil(m.h / 4) * 4;
    if (tiles > 1) notes.push(`${m.w}px wide exceeds ${MAX_TEX} — ${tiles} tiles of ${tileW}px${padW !== m.w ? ` (raster padded to ${padW}px)` : ""}`);
    if (padH !== m.h || (tiles === 1 && padW !== m.w)) notes.push(`padded to ${padW}x${padH} for 4-pixel codec alignment`);
    const vf = fit === "exact" ? [] : fit === "scale" ? [`scale=${m.w}:${m.h}:flags=lanczos`] : [`scale=${m.w}:${m.h}:force_original_aspect_ratio=decrease:flags=lanczos`, `pad=${m.w}:${m.h}:(ow-iw)/2:(oh-ih)/2:black`];
    if (!p.still && (padW !== m.w || padH !== m.h)) vf.push(`pad=${padW}:${padH}:0:0:black`);
    const alpha = /a$|rgba|argb|bgra|yuva|gbrap/.test(p.pix ?? "") && !p.still;
    let codec: TranscodeJob["codec"]; let action: TranscodeJob["action"];
    if (p.still) { codec = "png"; action = fit === "exact" && tiles === 1 ? "copy" : tiles > 1 ? "resize+tile" : "resize"; }
    else { codec = opts.engine === "resolume" ? "dxv" : opts.engine === "disguise" ? (alpha ? "hap_alpha" : "hap") : "h264"; action = tiles > 1 ? "encode+tile" : "encode"; if (["dxv", "hap", "hap_alpha", "h264"].includes(p.codec ?? "") && p.codec === (codec === "hap_alpha" ? "hap" : codec) && fit === "exact" && tiles === 1) { action = "copy"; } }
    const outs: string[] = []; const args: string[][] = [];
    for (let t = 0; t < tiles; t++) {
      const out = `${opts.outDir}/${a.slot}${tiles > 1 ? `_T${t + 1}of${tiles}` : ""}.${codec === "png" ? "png" : "mov"}`; outs.push(out);
      if (action === "copy") { args.push(["-y", "-i", a.file, "-c", "copy", ...(keepAudio ? [] : ["-an"]), out]); continue; }
      const crop = tiles > 1 ? [`crop=${tileW}:${padH}:${tileW * t}:0`] : [];
      const filters = [...vf, ...crop]; const v = filters.length ? ["-vf", filters.join(",")] : [];
      const enc = codec === "png" ? ["-frames:v", "1"] : codec === "dxv" ? ["-c:v", "dxv"] : codec === "hap" ? ["-c:v", "hap", "-format", "hap_q"] : codec === "hap_alpha" ? ["-c:v", "hap", "-format", "hap_alpha"] : ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16"];
      args.push(["-y", "-i", a.file, ...v, ...enc, ...(keepAudio ? ["-c:a", "aac", "-b:a", "192k"] : ["-an"]), "-movflags", "+faststart", out]);
    }
    jobs.push({ slot: a.slot, src: a.file, out: outs, action, codec, args, keepAudio, fit, notes, deleteOriginal: !!opts.deleteOriginals });
  }
  return jobs;
}

/** Human summary for the pre-show report. */
export function transcodeSummary(jobs: TranscodeJob[]): string {
  const by = (k: keyof TranscodeJob) => Object.entries(jobs.reduce((o: Record<string, number>, j) => ((o[String(j[k])] = (o[String(j[k])] ?? 0) + 1), o), {})).map(([a, b]) => `${a}: ${b}`).join(", ");
  return `${jobs.length} files → action { ${by("action")} } · codec { ${by("codec")} } · fit { ${by("fit")} } · audio kept: ${jobs.filter((j) => j.keepAudio).length}`;
}
