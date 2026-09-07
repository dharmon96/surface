/**
 * HAP frame decoder — the GPU-native path of the Surface Player.
 * HAP stores DXT (S3TC) texture data, optionally Snappy-compressed, optionally split into chunks (the "complex" layout, one
 * chunk per thread). We never decode pixels: the output is the DXT block buffer the GPU uploads as a compressed texture
 * (WEBGL_compressed_texture_s3tc), which is why HAP plays cheaply. Hap Q (YCoCg DXT5) is turned into RGB by the shader.
 *
 * Frame = section(s). Section header: 3-byte little-endian size + 1 type byte; a zero size means a 4-byte size follows.
 * Type byte: high nibble = compressor (0xA none, 0xB snappy, 0xC complex), low nibble = texture format
 * (0xB RGB DXT1, 0xE RGBA DXT5, 0xF YCoCg DXT5, 0x1 A RGTC1). 0x0D = "multiple images" container (Hap Q Alpha).
 * Complex payload = a Decode Instructions container (0x01) holding a per-chunk compressor table (0x02), chunk size
 * table (0x03) and optional offset table (0x04), followed by the chunk data.
 */
import { uncompress } from "snappyjs";

export type HapTexture = "DXT1" | "DXT5" | "YCoCgDXT5" | "RGTC1";
export interface HapFrame { textures: { format: HapTexture; data: Uint8Array }[] }

const FORMAT: Record<number, HapTexture> = { 0xb: "DXT1", 0xe: "DXT5", 0xf: "YCoCgDXT5", 0x1: "RGTC1" };
/** bytes per 4×4 block */
export const blockBytes = (f: HapTexture) => (f === "DXT1" || f === "RGTC1" ? 8 : 16);
/** the DXT buffer size for a texture of w×h pixels */
export const textureBytes = (f: HapTexture, w: number, h: number) => Math.ceil(w / 4) * Math.ceil(h / 4) * blockBytes(f);
/** the WebGL enum for compressedTexImage2D (WEBGL_compressed_texture_s3tc / EXT_texture_compression_rgtc) */
export const glFormat = (f: HapTexture) => (f === "DXT1" ? 0x83f0 : f === "RGTC1" ? 0x8dbb : 0x83f3); // COMPRESSED_RGB_S3TC_DXT1_EXT · COMPRESSED_RED_RGTC1_EXT · COMPRESSED_RGBA_S3TC_DXT5_EXT

function header(b: Uint8Array, o: number): { size: number; type: number; next: number } {
  let size = b[o] | (b[o + 1] << 8) | (b[o + 2] << 16); const type = b[o + 3]; let next = o + 4;
  if (size === 0) { size = (b[o + 4] | (b[o + 5] << 8) | (b[o + 6] << 16) | (b[o + 7] << 24)) >>> 0; next = o + 8; }
  return { size, type, next };
}

function decodeTexture(b: Uint8Array, o: number, end: number, type: number): { format: HapTexture; data: Uint8Array } {
  const compressor = type >> 4, format = FORMAT[type & 0xf]; if (!format) throw new Error(`HAP: unknown texture format 0x${(type & 0xf).toString(16)}`);
  const payload = b.subarray(o, end);
  if (compressor === 0xa) return { format, data: payload };
  if (compressor === 0xb) return { format, data: uncompress(payload) };
  if (compressor !== 0xc) throw new Error(`HAP: unknown compressor 0x${compressor.toString(16)}`);
  // complex: decode instructions, then chunks
  const h = header(b, o); if (h.type !== 0x01) throw new Error("HAP: complex section without decode instructions");
  let p = h.next; const iEnd = h.next + h.size; let comps: Uint8Array | null = null, sizes: number[] = [], offsets: number[] | null = null;
  while (p < iEnd) { const s = header(b, p); const body = b.subarray(s.next, s.next + s.size);
    if (s.type === 0x02) comps = body; else if (s.type === 0x03) { sizes = []; for (let i = 0; i + 3 < body.length; i += 4) sizes.push((body[i] | (body[i + 1] << 8) | (body[i + 2] << 16) | (body[i + 3] << 24)) >>> 0); }
    else if (s.type === 0x04) { offsets = []; for (let i = 0; i + 3 < body.length; i += 4) offsets.push((body[i] | (body[i + 1] << 8) | (body[i + 2] << 16) | (body[i + 3] << 24)) >>> 0); }
    p = s.next + s.size; }
  if (!comps || !sizes.length) throw new Error("HAP: complex section missing chunk tables");
  const dataStart = iEnd; const parts: Uint8Array[] = []; let cursor = 0;
  for (let i = 0; i < sizes.length; i++) { const start = dataStart + (offsets ? offsets[i] : cursor); const chunk = b.subarray(start, start + sizes[i]); cursor += sizes[i]; parts.push(comps[i] === 0xb ? uncompress(chunk) : chunk); }
  const total = parts.reduce((n, x) => n + x.length, 0); const out = new Uint8Array(total); let w = 0; for (const x of parts) { out.set(x, w); w += x.length; }
  return { format, data: out };
}

/** Decode one HAP sample (as stored in the MOV) to its texture(s). Hap Q Alpha yields two: YCoCg DXT5 colour + RGTC1 alpha. */
export function decodeHapFrame(sample: Uint8Array): HapFrame {
  const h = header(sample, 0);
  if (h.type === 0x0d) { // multiple images
    const textures = []; let p = h.next; const end = h.next + h.size;
    while (p < end) { const s = header(sample, p); textures.push(decodeTexture(sample, s.next, s.next + s.size, s.type)); p = s.next + s.size; }
    return { textures };
  }
  return { textures: [decodeTexture(sample, h.next, h.next + h.size, h.type)] };
}

/** MOV/MP4 sample entry four-cc → what the frames hold (Hap1 DXT1 · Hap5 DXT5 · HapY YCoCg · HapM YCoCg+alpha · HapA alpha only) */
export const HAP_CODECS: Record<string, { name: string; textures: HapTexture[] }> = {
  Hap1: { name: "Hap", textures: ["DXT1"] }, Hap5: { name: "Hap Alpha", textures: ["DXT5"] }, HapY: { name: "Hap Q", textures: ["YCoCgDXT5"] },
  HapM: { name: "Hap Q Alpha", textures: ["YCoCgDXT5", "RGTC1"] }, HapA: { name: "Hap Alpha-Only", textures: ["RGTC1"] }, Hap7: { name: "Hap R", textures: ["RGTC1"] },
};

// ── software DXT1 decode of one block (tests + thumbnails; never used at show time)
export function decodeDxt1Block(d: Uint8Array, o: number, out: Uint8Array, ox: number, oy: number, stride: number) {
  const c0 = d[o] | (d[o + 1] << 8), c1 = d[o + 2] | (d[o + 3] << 8);
  const rgb = (c: number) => [((c >> 11) & 31) * 255 / 31, ((c >> 5) & 63) * 255 / 63, (c & 31) * 255 / 31];
  const p0 = rgb(c0), p1 = rgb(c1); const pal = [p0, p1, c0 > c1 ? p0.map((v, i) => (2 * v + p1[i]) / 3) : p0.map((v, i) => (v + p1[i]) / 2), c0 > c1 ? p1.map((v, i) => (2 * v + p0[i]) / 3) : [0, 0, 0]];
  for (let y = 0; y < 4; y++) { const row = d[o + 4 + y]; for (let x = 0; x < 4; x++) { const c = pal[(row >> (x * 2)) & 3]; const i = ((oy + y) * stride + ox + x) * 3; out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; } }
}
export function decodeDxt1(data: Uint8Array, w: number, h: number): Uint8Array {
  const bw = Math.ceil(w / 4), bh = Math.ceil(h / 4), stride = bw * 4; const out = new Uint8Array(stride * bh * 4 * 3);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) decodeDxt1Block(data, (by * bw + bx) * 8, out, bx * 4, by * 4, stride);
  return out; // stride*4 wide, bh*4 tall, RGB
}
