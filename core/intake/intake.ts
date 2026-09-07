/**
 * Media probing: ffprobe one delivered file into the facts the rest of intake reasons over.
 * The actual matching lives in tokens.ts / scheme.ts / match.ts — files → slots, never the other way round.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { extname } from "node:path";

const run = promisify(execFile);
export interface Probe { file: string; w: number; h: number; durationSec: number; fps: number; hasAlpha: boolean; still: boolean; bytes: number; codec?: string; pix?: string; audio?: string | null }

export async function probe(file: string): Promise<Probe> {
  const { stdout } = await run("ffprobe", ["-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", file]);
  const j = JSON.parse(stdout); const v = (j.streams ?? []).find((s: any) => s.codec_type === "video") ?? {};
  const pix: string = v.pix_fmt ?? ""; const still = /^(png|jpe?g|tiff?|webp)$/i.test(extname(file).slice(1)) || Number(v.nb_frames) === 1;
  const fps = v.r_frame_rate ? (([a, b]) => Number(a) / Number(b || 1))(v.r_frame_rate.split("/")) : 0;
  const a = (j.streams ?? []).find((s: any) => s.codec_type === "audio");
  return { file, w: Number(v.width ?? 0), h: Number(v.height ?? 0), durationSec: still ? 0 : Number(j.format?.duration ?? 0), fps, hasAlpha: /a$|rgba|argb|bgra|ya|gbrap|yuva/.test(pix) || extname(file).toLowerCase() === ".png", still, bytes: Number(j.format?.size ?? 0), codec: v.codec_name, pix, audio: a?.codec_name ?? null };
}
