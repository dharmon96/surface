/**
 * Preview proxies. Engine codecs (HAP, DXV, NotchLC, ProRes) decode fine in ffmpeg but no browser plays them, so the Venue
 * view and any in-app playback use a small H.264 proxy (VP9 with alpha when the source has an alpha channel — round cards,
 * lower thirds). Built lazily on first request or ahead of time after a conversion run; cached by path+size+mtime.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, renameSync, statSync, rmSync } from "node:fs";
import { join, extname } from "node:path";
import { createHash } from "node:crypto";
import { probe } from "../core/intake/intake.js";

export class ProxyStore {
  private building = new Map<string, Promise<string | null>>();
  constructor(private dir: string, private maxWidth = 960) { mkdirSync(dir, { recursive: true }); }
  /** the proxy path for a source (whether or not it exists yet) */
  key(src: string) { const st = statSync(src); return createHash("sha1").update(`${src}|${st.size}|${st.mtimeMs}`).digest("hex"); }
  isStill(src: string) { return /\.(png|jpe?g|webp|tif)$/i.test(src); }
  /** stills need no proxy: the browser draws them as they are */
  pathFor(src: string): { path: string; ready: boolean; still: boolean } {
    if (this.isStill(src)) return { path: src, ready: true, still: true };
    const k = this.key(src); const mp4 = join(this.dir, `${k}.mp4`), webm = join(this.dir, `${k}.webm`);
    if (existsSync(webm)) return { path: webm, ready: true, still: false }; if (existsSync(mp4)) return { path: mp4, ready: true, still: false };
    return { path: mp4, ready: false, still: false };
  }
  /** build (deduped); resolves to the proxy path or null on failure */
  build(src: string): Promise<string | null> {
    const k = this.key(src); const cur = this.building.get(k); if (cur) return cur;
    const p = (async () => {
      try {
        const pr = await probe(src); const alpha = pr.hasAlpha && !this.isStill(src);
        const out = join(this.dir, `${k}.${alpha ? "webm" : "mp4"}`); if (existsSync(out)) return out; const part = `${out}.part${extname(out)}`;
        const vf = `scale='min(${this.maxWidth},iw)':-2:flags=area${alpha ? ",format=yuva420p" : ",format=yuv420p"}`;
        const args = ["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-an", "-vf", vf, "-r", String(Math.min(30, Math.round(pr.fps || 30))),
          ...(alpha ? ["-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "32", "-deadline", "realtime", "-cpu-used", "6", "-auto-alt-ref", "0"] : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p", "-movflags", "+faststart"]), part];
        await new Promise<void>((res, rej) => execFile("ffmpeg", args, (e) => (e ? rej(e) : res())));
        renameSync(part, out); return out;
      } catch { return null; } finally { this.building.delete(k); }
    })();
    this.building.set(k, p); return p;
  }
  /** background pre-build, one at a time, so show time never waits */
  async warm(files: string[], onDone?: (src: string, out: string | null) => void) { for (const f of files) { if (!existsSync(f) || this.isStill(f) || this.pathFor(f).ready) continue; const out = await this.build(f); onDone?.(f, out); } }
  clear() { rmSync(this.dir, { recursive: true, force: true }); mkdirSync(this.dir, { recursive: true }); }
}
