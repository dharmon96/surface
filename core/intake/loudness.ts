/**
 * Level matching for clips with sound (VTs, walkouts). One measurement per clip (EBU R128 integrated loudness + true
 * peak, via ffmpeg's ebur128), one static gain to bring the whole clip to the show's standard. No compression, no
 * limiting, no per-moment riding: a quiet VT gets louder as a whole, a hot one gets quieter as a whole, and the gain
 * is capped so the true peak never crosses the ceiling.
 */
import { execFile } from "node:child_process";

export interface Loudness { integratedLufs: number; truePeakDb: number; lra?: number }
export interface LevelMatch extends Loudness { targetLufs: number; gainDb: number; capped: boolean }

export function measureLoudness(file: string, ffmpeg = "ffmpeg"): Promise<Loudness | null> {
  return new Promise((resolve) => {
    execFile(ffmpeg, ["-hide_banner", "-nostats", "-i", file, "-map", "0:a:0", "-af", "ebur128=peak=true", "-f", "null", "-"], { maxBuffer: 64 << 20 }, (err, _out, stderr) => {
      const s = String(stderr ?? ""); const i = s.lastIndexOf("Summary:"); if (i < 0) return resolve(null);
      const tail = s.slice(i); const num = (re: RegExp) => { const m = tail.match(re); return m ? Number(m[1]) : NaN; };
      const integrated = num(/I:\s*(-?[\d.]+)\s*LUFS/), peak = num(/Peak:\s*(-?[\d.]+)\s*dBFS/), lra = num(/LRA:\s*(-?[\d.]+)\s*LU/);
      if (!Number.isFinite(integrated) || integrated < -60) return resolve(null); // silence / no usable programme
      resolve({ integratedLufs: integrated, truePeakDb: Number.isFinite(peak) ? peak : NaN, lra: Number.isFinite(lra) ? lra : undefined }); // NaN = peak unknown, never a fake 0 dBFS
    });
  });
}

/** the one number: gain that lands the clip on the target, held back so true peak stays under the ceiling */
export function levelMatch(l: Loudness, targetLufs = -18, ceilingDbTp = -1): LevelMatch {
  let gain = targetLufs - l.integratedLufs; let capped = false;
  // an unknown peak means "don't cap", never "cap as if the peak were 0 dBFS"
  if (Number.isFinite(l.truePeakDb) && l.truePeakDb + gain > ceilingDbTp) { gain = ceilingDbTp - l.truePeakDb; capped = true; }
  return { ...l, targetLufs, gainDb: Math.round(gain * 10) / 10, capped };
}
export const linearGain = (db: number) => Math.pow(10, db / 20);
