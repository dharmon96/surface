import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { probe } from "../core/intake/intake.js";
import { ocrAvailable, ocrFile, applyOcr } from "../core/intake/ocr.js";
import { tokenise } from "../core/intake/tokens.js";
import { intake } from "../core/intake/match.js";
import { numbered } from "./fixtures-deliveries.js";

const root = join(tmpdir(), `surface-ocr-${process.pid}`);
// Windows ffmpeg builds often ship without a usable fontconfig, so drawtext needs an explicit fontfile
const font = process.platform === "win32" ? "fontfile='C\\:/Windows/Fonts/arialbd.ttf':" : "";
beforeAll(() => { rmSync(root, { recursive: true, force: true }); mkdirSync(root, { recursive: true });
  // a "badly named" round card: 2 s video, big white ROUND 7 text revealed after 0.4 s; and a fighter card with a surname
  execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=0x101830:size=1920x1080:rate=30", "-t", "2", "-vf", `drawtext=${font}text='ROUND 7':fontsize=220:fontcolor=white:x=(w-tw)/2:y=(h-th)/2:enable='gte(t,0.4)'`, "-c:v", "libx264", "-pix_fmt", "yuv420p", join(root, "final_v3 (2).mov")], { stdio: "ignore" });
  execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=black:size=1920x1080", "-frames:v", "1", "-vf", `drawtext=${font}text='ANTONIO VARGAS':fontsize=160:fontcolor=white:x=(w-tw)/2:y=(h-th)/2`, join(root, "IMG_0042.png")], { stdio: "ignore" });
});

describe("frame-sampling OCR", () => {
  it("maps spelled-out round numbers (SEVEN) the way a real promoter's cards read", () => {
    const ev = applyOcr(tokenise("Rounds/1792 x 504/7.mov"), { file: "7.mov", text: "SEVEN\nSEVEN\nSEVEN", words: ["seven"], numbers: [], frames: 3 });
    expect(ev.round).toBe(7); expect(ev.kind).toBe("ROUND");
  });
  it("reads text that only appears mid-animation and turns it into evidence", async () => {
    if (!(await ocrAvailable())) return;
    const p = { ...(await probe(join(root, "final_v3 (2).mov"))), file: "final_v3 (2).mov" };
    const o = await ocrFile(join(root, "final_v3 (2).mov"), p); expect(o.frames).toBe(4); expect(o.text).toMatch(/ROUND\s*7/i);
    const ev = applyOcr(tokenise("dump/final_v3 (2).mov", p), o); expect(ev.kind).toBe("ROUND"); expect(ev.round).toBe(7);
  }, 60_000);
  it("places an unnamed fighter still by the surname it reads", async () => {
    if (!(await ocrAvailable())) return;
    const path = join(root, "IMG_0042.png"); const p = { ...(await probe(path)), file: "IMG_0042.png" };
    const o = await ocrFile(path, p); expect(o.words).toContain("vargas");
    // fold into the numbered delivery fixture: a 1920x1080 still that names Vargas (bout 8 red) → a fighter slot when the kind is known from OCR/word
    const ev = applyOcr(tokenise("IMG_0042.png", p), o); expect(ev.names).toContain("vargas");
    const r = intake(numbered.doc, numbered.manifest, [p], numbered.syn, { ocr: { "IMG_0042.png": o }, override: { direction: "opener-first", aIs: "red" } });
    // kind is UNKNOWN for a bare still with a name — it must NOT be guessed into a slot; it shows up unmatched with the OCR words as a hint
    expect(r.unmatched[0].why).toMatch(/graphic type not recognised/); expect(r.unmatched[0].evidence.names).toContain("vargas");
  }, 60_000);
});
