/**
 * MOV/MP4 demux for the player: reads only the index (ftyp + moov, wherever ffmpeg put it), then fetches samples by byte
 * range on demand — a 2 GB HAP walkout never has to sit in memory. mp4box parses the sample tables; we do the file I/O.
 */
import { openSync, readSync, closeSync, fstatSync } from "node:fs";
import * as MP4 from "mp4box";
import { HAP_CODECS, type HapTexture } from "./hap.js";

export interface MovieInfo { path: string; codec: string; kind: "hap" | "other"; textures: HapTexture[]; w: number; h: number; fps: number; frames: number; durationSec: number; timescale: number; audio: boolean }
export interface SampleRef { offset: number; size: number; dts: number; cts: number; duration: number; isSync: boolean }

/** top-level boxes: [type, offset, size] — enough to find moov without reading the mdat */
function topLevelBoxes(fd: number, fileSize: number): { type: string; offset: number; size: number; headerSize: number }[] {
  const out = []; let o = 0; const hdr = Buffer.alloc(16);
  while (o + 8 <= fileSize) {
    readSync(fd, hdr, 0, 16, o); let size = hdr.readUInt32BE(0); const type = hdr.toString("latin1", 4, 8); let hs = 8;
    if (size === 1) { size = Number(hdr.readBigUInt64BE(8)); hs = 16; } else if (size === 0) size = fileSize - o;
    out.push({ type, offset: o, size, headerSize: hs }); if (size < 8) break; o += size;
  }
  return out;
}

export class Movie {
  private fd: number; private samples: SampleRef[] = []; readonly info: MovieInfo;
  constructor(path: string) {
    this.fd = openSync(path, "r"); const size = fstatSync(this.fd).size;
    const boxes = topLevelBoxes(this.fd, size); const file = MP4.createFile();
    let ready: any = null; file.onReady = (i: any) => { ready = i; }; file.onError = () => {};
    // feed every box except the media data as one contiguous buffer: sample offsets come from the tables (stco/co64), so
    // they stay absolute to the real file no matter where the moov sat
    const parts = boxes.filter((b) => b.type !== "mdat").map((b) => { const buf = Buffer.alloc(b.size); readSync(this.fd, buf, 0, b.size, b.offset); return buf; });
    const all = Buffer.concat(parts); const ab = all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength) as ArrayBuffer & { fileStart: number }; ab.fileStart = 0; file.appendBuffer(ab); file.flush(); if (!ready) { closeSync(this.fd); throw new Error(`${path}: no movie index (moov) found`); }
    const tracks: any[] = ready.tracks ?? []; const audio = tracks.some((t) => t.type === "audio" || t.audio);
    const vt = tracks.find((t) => HAP_CODECS[t.codec?.slice(0, 4)]) ?? tracks.find((t) => t.type === "video" || t.video || (t.track_width > 0));
    if (!vt) { closeSync(this.fd); throw new Error(`${path}: no video track`); }
    const codec = String(vt.codec ?? "").slice(0, 4); const hap = HAP_CODECS[codec];
    const tsi: any[] = file.getTrackSamplesInfo(vt.id) ?? [];
    this.samples = tsi.map((s) => ({ offset: s.offset, size: s.size, dts: s.dts, cts: s.cts, duration: s.duration, isSync: s.is_sync !== false }));
    const timescale = vt.timescale || 600; const frames = this.samples.length; const durationSec = (vt.duration || 0) / timescale;
    const fps = frames > 1 && durationSec > 0 ? frames / durationSec : (this.samples[0]?.duration ? timescale / this.samples[0].duration : 30);
    this.info = { path, codec, kind: hap ? "hap" : "other", textures: hap?.textures ?? [], w: vt.track_width || vt.video?.width || 0, h: vt.track_height || vt.video?.height || 0, fps: Math.round(fps * 1000) / 1000, frames, durationSec, timescale, audio };
  }
  get frameCount() { return this.samples.length; }
  sampleAt(i: number): SampleRef { return this.samples[Math.max(0, Math.min(this.samples.length - 1, i))]; }
  /** raw sample bytes (for HAP: the frame to hand to decodeHapFrame) */
  read(i: number): Uint8Array { const s = this.sampleAt(i); const buf = Buffer.alloc(s.size); readSync(this.fd, buf, 0, s.size, s.offset); return new Uint8Array(buf.buffer, buf.byteOffset, s.size); }
  /** frame index for a time in seconds (loops when asked) */
  frameFor(t: number, loop = true): number { const n = this.samples.length; if (!n) return 0; let i = Math.floor(t * this.info.fps); if (loop) i = ((i % n) + n) % n; return Math.max(0, Math.min(n - 1, i)); }
  close() { closeSync(this.fd); }
}
