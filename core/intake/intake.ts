/**
 * Media intake: probe a folder of supplied graphics (promoter/designer files) and match them to the slots the show expects.
 * Matching is fuzzy on purpose — promoter naming is never ours. Confident matches auto-map; the rest go to the mapping UI.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdirSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { ShowDoc } from "../types.js";
import type { mediaManifest } from "../gen/engines.js";

const run = promisify(execFile);
export interface Probe { file: string; w: number; h: number; durationSec: number; fps: number; hasAlpha: boolean; still: boolean; bytes: number }

export async function probe(file: string): Promise<Probe> {
  const { stdout } = await run("ffprobe", ["-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", file]);
  const j = JSON.parse(stdout); const v = (j.streams ?? []).find((s: any) => s.codec_type === "video") ?? {};
  const pix: string = v.pix_fmt ?? ""; const still = /^(png|jpe?g|tiff?|webp)$/i.test(extname(file).slice(1)) || Number(v.nb_frames) === 1;
  const fps = v.r_frame_rate ? (([a, b]) => Number(a) / Number(b || 1))(v.r_frame_rate.split("/")) : 0;
  return { file, w: Number(v.width ?? 0), h: Number(v.height ?? 0), durationSec: still ? 0 : Number(j.format?.duration ?? 0), fps, hasAlpha: /a$|rgba|argb|bgra|ya|gbrap|yuva/.test(pix) || extname(file).toLowerCase() === ".png", still, bytes: Number(j.format?.size ?? 0) };
}

export async function probeFolder(dir: string): Promise<Probe[]> {
  const files = readdirSync(dir).filter((f) => /\.(mov|mp4|mxf|avi|png|jpe?g|tif|webp|gif)$/i.test(f)).map((f) => join(dir, f)).filter((f) => statSync(f).isFile());
  return Promise.all(files.map(probe));
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const tokens = (s: string) => new Set(norm(s).split(" ").filter(Boolean));

/** Vocabulary the matcher understands; packs can extend it. */
export const GRAPHIC_SYNONYMS: Record<string, string[]> = {
  ROUND: ["round", "rd", "r"], WALKOUT: ["walkout", "walk", "entrance", "intro"], FIGHTER: ["fighter", "name", "intro"],
  TALE: ["vs", "v", "tale", "matchup", "fight", "faceoff"], UP_NEXT: ["upnext", "up next", "next"], WINNER: ["winner", "win", "wins", "victory"],
  HOLD: ["hold", "holding", "loop", "sponsor", "logo"], FLAG: ["flag", "anthem"], VT: ["vt", "ad", "promo", "spot", "commercial"],
};

export interface Match { slot: string; file: string | null; confidence: number; reasons: string[] }

/** Score every (slot, file) pair; return best file per slot with confidence 0..1. */
export function matchSlots(doc: ShowDoc, manifest: ReturnType<typeof mediaManifest>, probes: Probe[]): Match[] {
  const fighters: Record<string, any> = doc.data.fighters ?? {};
  const bouts: any[] = doc.data.bouts ?? [];
  return manifest.map((m) => {
    const [group, graphic, ...rest] = m.slot.split("_"); const variant = rest.slice(0, rest.length - 2).join("_"); // strip SCREEN and WxH
    const bout = bouts.find((b) => b.id === group);
    const names = new Set<string>();
    if (bout) { for (const side of ["red", "blue"] as const) { const f = fighters[bout[side]]; if (f && (variant === side.toUpperCase() || !/^(RED|BLUE)$/.test(variant))) for (const t of tokens(f.name)) names.add(t); } }
    let best: Match = { slot: m.slot, file: null, confidence: 0, reasons: [] };
    for (const p of probes) {
      const ft = tokens(basename(p.file, extname(p.file))); const reasons: string[] = []; let score = 0;
      if ((GRAPHIC_SYNONYMS[graphic] ?? []).some((s) => ft.has(s))) { score += 0.35; reasons.push(`type:${graphic}`); }
      const nameHits = [...names].filter((t) => t.length > 2 && ft.has(t)).length; if (nameHits) { score += Math.min(0.35, 0.2 * nameHits); reasons.push(`name×${nameHits}`); }
      if (graphic === "ROUND") { const r = Number(variant); if ([...ft].some((t) => t === String(r) || t === `r${r}` || t === `rd${r}` || t === `round${r}` || t === String(r).padStart(2, "0"))) { score += 0.3; reasons.push(`round ${r}`); } else score -= 0.5; }
      if (/^(RED|BLUE)$/.test(variant) && ft.has(variant.toLowerCase())) { score += 0.1; reasons.push(variant.toLowerCase()); }
      if (graphic === "FLAG" && ft.has(variant.toLowerCase())) { score += 0.4; reasons.push(`country ${variant}`); }
      if (p.w === m.w && p.h === m.h) { score += 0.2; reasons.push("exact res"); } else if (Math.abs(p.w / p.h - m.w / m.h) < 0.02) { score += 0.08; reasons.push("same aspect"); } else score -= 0.15;
      // behaviour hints from the probe itself
      if (m.behaviour === "playHold" && p.durationSec > 8 && !p.hasAlpha) { score += 0.05; reasons.push("looks like a VT/sting"); }
      if (m.layer === "OVERLAY" && p.hasAlpha) { score += 0.05; reasons.push("alpha overlay"); }
      if (score > best.confidence) best = { slot: m.slot, file: p.file, confidence: Math.min(1, score), reasons };
    }
    if (best.confidence < 0.45) best = { ...best, file: null, reasons: [...best.reasons, "below auto-map threshold — needs manual mapping"] };
    return best;
  });
}
