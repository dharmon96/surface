/**
 * Frame-sampling OCR: read the text baked into a graphic (names, "ROUND 7", "UP NEXT", sponsor marks) so a badly named file
 * can still be placed. ffmpeg pulls a few frames (animated graphics haven't revealed their text at frame 0), downscaled and
 * composited over black; tesseract reads them. Fully offline, ~0.5–1 s per file; optional — intake works without it.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Probe } from "./intake.js";

const run = promisify(execFile);
export interface OcrResult { file: string; text: string; words: string[]; numbers: number[]; frames: number }

export async function ocrAvailable(tesseract = "tesseract"): Promise<boolean> { try { await run(tesseract, ["--version"]); return true; } catch { return false; } }

/** Sample frames at 30 / 55 / 80 % and the last frame (stills: once), OCR each, merge the words. */
export async function ocrFile(path: string, p: Probe, opts: { ffmpeg?: string; tesseract?: string; width?: number } = {}): Promise<OcrResult> {
  const ffmpeg = opts.ffmpeg ?? "ffmpeg", tess = opts.tesseract ?? "tesseract", width = opts.width ?? 1280;
  const dir = mkdtempSync(join(tmpdir(), "surface-ocr-"));
  try {
    const times = p.still || p.durationSec <= 0 ? [0] : [0.3, 0.55, 0.8, 0.97].map((f) => Math.max(0, p.durationSec * f));
    // ultra-wide rasters (fascia) are cut into readable chunks instead of squashed to 1280 wide
    const chunks = p.w / Math.max(1, p.h) > 8 ? Math.min(6, Math.ceil(p.w / (p.h * 8))) : 1;
    let k = 0;
    for (const t of times) for (let c = 0; c < chunks; c++) {
      const crop = chunks > 1 ? `crop=${Math.floor(p.w / chunks)}:${p.h}:${Math.floor(p.w / chunks) * c}:0,` : "";
      // alpha is flattened by format=gray (transparent → black); scale keeps text legible without huge frames
      const filt = `${crop}scale=${chunks > 1 ? Math.min(width, Math.floor(p.w / chunks)) : Math.min(width, p.w)}:-2:flags=lanczos,format=gray,eq=contrast=1.4`;
      await run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...(p.still ? [] : ["-ss", t.toFixed(2)]), "-i", path, "-frames:v", "1", "-vf", filt, join(dir, `f${k++}.png`)]).catch(() => {});
    }
    const frames = readdirSync(dir).filter((f) => f.endsWith(".png"));
    const texts = await Promise.all(frames.map(async (f) => { try { const { stdout } = await run(tess, [join(dir, f), "stdout", "--psm", "11", "-l", "eng"]); return stdout; } catch { return ""; } }));
    const text = texts.join("\n").replace(/[^\S\n]+/g, " ").trim();
    const words = [...new Set(text.toLowerCase().match(/[a-zà-ÿ]{3,}/g) ?? [])];
    const numbers = [...new Set((text.match(/\b\d{1,2}\b/g) ?? []).map(Number))];
    return { file: p.file, text, words, numbers, frames: frames.length };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Fold OCR words into the tokeniser's evidence: names it read, a round number it saw, kind words. */
export function applyOcr<T extends { names: string[]; round?: number; kind: string; kindFrom: string }>(ev: T, o: OcrResult): T & { ocr: OcrResult } {
  const names = [...new Set([...ev.names, ...o.words.filter((w) => !/^(round|next|winner|vs|the|and|presents|live|tonight|main|event)$/.test(w))])];
  // real round cards often spell the number ("SEVEN", "ROUND TWELVE") — seen on a promoter's 1792x504 cards
  const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
  let round = ev.round; const rm = o.text.match(/\bR(?:OUND|D)?\.?\s*(\d{1,2})\b/i); if (round === undefined && rm) round = Number(rm[1]);
  if (round === undefined) { const w = o.words.find((x) => x in WORDS); const hits = o.words.filter((x) => x in WORDS); if (w && new Set(hits).size === 1) round = WORDS[w]; }
  let kind = ev.kind, kindFrom = ev.kindFrom;
  if (kind === "UNKNOWN") { if (/\bROUND\b/i.test(o.text) || (round !== undefined && o.words.length <= 3)) { kind = "ROUND"; kindFrom = "ocr" as any; } else if (/\bUP\s*NEXT\b/i.test(o.text)) { kind = "UP_NEXT"; kindFrom = "ocr" as any; } else if (/\bWINNER\b/i.test(o.text)) { kind = "WINNER"; kindFrom = "ocr" as any; } else if (/\bVS\.?\b/i.test(o.text)) { kind = "TALE"; kindFrom = "ocr" as any; } }
  return { ...ev, names, round, kind, kindFrom, ocr: o };
}
