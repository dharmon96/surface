import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Movie } from "../player/mov.js";
import { decodeHapFrame, decodeDxt1, textureBytes } from "../player/hap.js";

const dir = mkdtempSync(join(tmpdir(), "surface-hap-"));
const mk = (name: string, fmt: string, extra: string[] = [], src = "testsrc2=s=256x128:d=1:r=10") => { const p = join(dir, name); execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", src, "-c:v", "hap", "-format", fmt, ...extra, p]); return p; };
/** what ffmpeg itself decodes the first frame to (RGB, averaged) — the reference our GPU path must match */
const refAvg = (p: string) => { const raw = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", p, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]); let r = 0, g = 0, b = 0; for (let i = 0; i < raw.length; i += 3) { r += raw[i]; g += raw[i + 1]; b += raw[i + 2]; } const n = raw.length / 3; return [r / n, g / n, b / n]; };
const avg = (rgb: Uint8Array, w: number, h: number, stride: number) => { let r = 0, g = 0, b = 0; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * stride + x) * 3; r += rgb[i]; g += rgb[i + 1]; b += rgb[i + 2]; } const n = w * h; return [r / n, g / n, b / n]; };

let files: Record<string, string> = {};
beforeAll(() => { files = { hap: mk("hap.mov", "hap"), chunked: mk("hap4.mov", "hap", ["-chunks", "4"]), none: mk("hapn.mov", "hap", ["-compressor", "none"]), alpha: mk("hapa.mov", "hap_alpha", [], "testsrc2=s=256x128:d=1:r=10,format=rgba"), q: mk("hapq.mov", "hap_q"), faststart: mk("hapf.mov", "hap", ["-movflags", "+faststart"]) }; });

describe("HAP player path", () => {
  it("reads the movie index without loading the media, moov at either end", () => {
    for (const p of [files.hap, files.faststart]) { const m = new Movie(p); expect(m.info).toMatchObject({ codec: "Hap1", kind: "hap", w: 256, h: 128, frames: 10, textures: ["DXT1"] }); expect(m.info.fps).toBe(10); expect(m.sampleAt(3).offset).toBeGreaterThan(0); m.close(); }
  });
  it("decodes Snappy, chunked and uncompressed Hap frames to identical DXT1 data that matches ffmpeg's pixels", () => {
    const ref = refAvg(files.hap); let first: Uint8Array | null = null;
    for (const key of ["hap", "chunked", "none"] as const) {
      const m = new Movie(files[key]); const f = decodeHapFrame(m.read(0)); m.close();
      expect(f.textures[0].format).toBe("DXT1"); expect(f.textures[0].data.length).toBe(textureBytes("DXT1", 256, 128));
      if (first) expect(Buffer.compare(Buffer.from(f.textures[0].data), Buffer.from(first))).toBe(0); else first = f.textures[0].data;
      const rgb = decodeDxt1(f.textures[0].data, 256, 128); const a = avg(rgb, 256, 128, 256);
      for (let c = 0; c < 3; c++) expect(Math.abs(a[c] - ref[c])).toBeLessThan(2.5);
    }
  });
  it("knows Hap Alpha and Hap Q layouts", () => {
    const a = new Movie(files.alpha); expect(a.info.codec).toBe("Hap5"); const fa = decodeHapFrame(a.read(0)); expect(fa.textures[0].format).toBe("DXT5"); expect(fa.textures[0].data.length).toBe(textureBytes("DXT5", 256, 128)); a.close();
    const q = new Movie(files.q); expect(q.info.codec).toBe("HapY"); const fq = decodeHapFrame(q.read(5)); expect(fq.textures[0].format).toBe("YCoCgDXT5"); expect(fq.textures[0].data.length).toBe(256 * 128); q.close();
  });
  it("maps time to frames and loops", () => { const m = new Movie(files.hap); expect(m.frameFor(0.35)).toBe(3); expect(m.frameFor(1.25)).toBe(2); expect(m.frameFor(0.95, false)).toBe(9); expect(m.frameFor(3, false)).toBe(9); m.close(); });
});
