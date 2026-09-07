#!/usr/bin/env tsx
/**
 * surface parse <sheet.pdf|.txt> [out.json]                  parse a timing sheet / bout sheet / running order
 * surface merge <base.json> <sheet.pdf|.txt> [out.json]      merge a later sheet version into an existing show doc, print the diff
 * surface cues  <show.json>                                  print the derived cue list
 * surface build <show.json> [outDir] [--mode bridge|direct] [--host 127.0.0.1:8090]
 * surface intake <show.json> <deliveryDir> [--engine resolume|disguise] [--direction opener-first|main-first] [--a red|blue] [--out media/]
 *                probes every media file under deliveryDir (recursive, archive folders skipped), matches to slots, prints the
 *                scheme it inferred, the mapping, the gaps, and the transcode plan. Read-only: nothing is converted or deleted.
 *
 * PDFs are read with `pdftotext -layout` when available (poppler); otherwise pass the .txt yourself.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { buildBundle, deriveCues, loadShowDoc } from "../core/index.js";
import { parseSheet, mergeSheets, rundownToCustomCues } from "../core/parse/index.js";
import { mediaManifest } from "../core/gen/engines.js";
import { probe } from "../core/intake/intake.js";
import { intake } from "../core/intake/match.js";
import { planTranscodes, transcodeSummary } from "../core/intake/transcode.js";
import type { ScreenSynonyms } from "../core/intake/tokens.js";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const [cmd, ...args] = process.argv.slice(2);
const pos = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
const flag = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const usage = () => { console.error("usage: surface parse|merge|cues|build … (see header of cli/surface.ts)"); process.exit(1); };

function sheetText(file: string): string {
  if (/\.pdf$/i.test(file)) { try { return execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" }); } catch { console.error("pdftotext not found — install poppler or pass a .txt export"); process.exit(2); } }
  return readFileSync(file, "utf8");
}
function report(doc: any) { console.log(`${doc.event.name} — ${doc.data.bouts.length} bouts, ${Object.keys(doc.data.fighters).length} fighters (${doc.source.kind})`); if (doc.review.flags.length) console.log(`⚠ ${doc.review.flags.length} review flag(s):\n  - ${doc.review.flags.join("\n  - ")}`); }

if (!cmd) usage();
if (cmd === "parse") {
  const [file, out] = pos; if (!file) usage();
  const r = parseSheet(sheetText(file), file);
  if ("rundown" in r) { const cues = rundownToCustomCues(r.rundown); console.log(`Running order: ${r.rundown.title ?? ""} — ${r.rundown.rows.length} rows, ${cues.length} screen-relevant cues`); for (const c of cues) console.log(`  ${c.id.padEnd(6)} ${c.name}${c.notes ? "  [" + c.notes + "]" : ""}`); if (out) writeFileSync(out, JSON.stringify({ rundown: r.rundown, customCues: cues }, null, 1)); }
  else { report(r); if (out) writeFileSync(out, JSON.stringify(r, null, 1)); }
} else if (cmd === "merge") {
  const [base, file, out] = pos; if (!base || !file) usage();
  const doc = loadShowDoc(JSON.parse(readFileSync(base, "utf8"))); const inc = parseSheet(sheetText(file), file);
  if ("rundown" in inc) { doc.customCues = [...(doc.customCues ?? []), ...rundownToCustomCues(inc.rundown)]; console.log(`added ${inc.rundown.rows.length} rundown rows as custom cue candidates`); if (out) writeFileSync(out, JSON.stringify(doc, null, 1)); }
  else { const { doc: merged, diff } = mergeSheets(doc, inc); console.log(diff.length ? `Changes:\n  - ${diff.join("\n  - ")}` : "No changes"); report(merged); if (out) writeFileSync(out, JSON.stringify(merged, null, 1)); }
} else if (cmd === "cues") {
  const doc = loadShowDoc(JSON.parse(readFileSync(pos[0], "utf8")));
  for (const c of deriveCues(doc)) console.log(String(c.n).padStart(3, "0"), c.id.padEnd(18), c.name.padEnd(52), (c.d3?.tag ?? "").padEnd(6), c.resolume?.groups === "ALL" ? "ALL" : (c.resolume?.groups as string[]).join(","));
} else if (cmd === "build") {
  const doc = loadShowDoc(JSON.parse(readFileSync(pos[0], "utf8"))); const cues = deriveCues(doc);
  const files = await buildBundle(doc, cues, { outDir: pos[1] ?? "out", companion: { mode: flag("mode", "bridge") as any, surfaceHost: flag("host", "127.0.0.1:8090") } });
  console.log(`${cues.length} cues → ${pos[1] ?? "out"}/`); files.forEach((f) => console.log("  " + f));
  if (doc.review.status !== "approved") console.warn(`\n⚠ review.status is '${doc.review.status}' — ${doc.review.flags.length} flag(s) unresolved`);
} else if (cmd === "intake") {
  const [showFile, dir] = pos; if (!showFile || !dir) usage();
  const doc = loadShowDoc(JSON.parse(readFileSync(showFile, "utf8"))); const cues = deriveCues(doc); const man = mediaManifest(doc, cues);
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.(mov|mp4|mxf|avi|png|jpe?g|tif|webp)$/i.test(f) ? [p] : []; });
  const files = walk(dir); console.log(`probing ${files.length} files…`);
  const probes = []; for (const f of files) { try { const p = await probe(f); p.file = relative(dir, f).replace(/\\/g, "/"); probes.push(p); } catch { console.warn("  ffprobe failed:", f); } }
  // synonyms: seed from the doc's screens (id + name) — venues extend this in the app
  const syn: ScreenSynonyms = Object.fromEntries(doc.screens.map((s) => [s.id, { words: [s.id.toLowerCase().replace(/_/g, " "), s.name.toLowerCase(), ...((doc as any).screenWords?.[s.id] ?? [])], w: s.w, h: s.h }]));
  const r = intake(doc, man, probes, syn, { override: { direction: flag("direction", "") as any || undefined, aIs: flag("a", "") as any || undefined } });
  console.log(`\nScheme: ${r.scheme.direction} · a=${r.scheme.aIs} · confidence ${r.scheme.confidence.toFixed(2)}\n  ${r.scheme.evidence.slice(0, 6).join("\n  ")}`);
  console.log(`\nMapped ${new Set(r.assignments.map((a) => a.slot)).size}/${man.length} slots · ${r.unmatched.length} files unmatched · ${r.ignored.length} ignored · ${r.unfilled.length} slots still empty`);
  for (const a of r.assignments.filter((a) => a.confidence < 0.7).slice(0, 15)) console.log(`  ? ${a.slot.padEnd(42)} ← ${a.file}  (${a.confidence.toFixed(2)}) ${a.issues.join("; ")}`);
  for (const u of r.unmatched.slice(0, 15)) console.log(`  ✗ ${u.file}  — ${u.why}`);
  if (r.issues.length) console.log(`\nIssues:\n  - ${r.issues.slice(0, 20).join("\n  - ")}`);
  const jobs = planTranscodes(r.assignments, probes, man, { engine: flag("engine", "resolume") as any, outDir: flag("out", "media") });
  console.log(`\nTranscode plan: ${transcodeSummary(jobs)}`);
  const out = pos[2]; if (out) writeFileSync(out, JSON.stringify({ scheme: r.scheme, assignments: r.assignments, unmatched: r.unmatched.map((u) => ({ file: u.file, why: u.why })), unfilled: r.unfilled, issues: r.issues, jobs }, null, 1));
} else usage();
