#!/usr/bin/env tsx
/**
 * surface parse <sheet.pdf|.txt> [out.json]                  parse a timing sheet / bout sheet / running order
 * surface merge <base.json> <sheet.pdf|.txt> [out.json]      merge a later sheet version into an existing show doc, print the diff
 * surface cues  <show.json>                                  print the derived cue list
 * surface build <show.json> [outDir] [--mode bridge|direct] [--host 127.0.0.1:8090]
 *
 * PDFs are read with `pdftotext -layout` when available (poppler); otherwise pass the .txt yourself.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { buildBundle, deriveCues, loadShowDoc } from "../core/index.js";
import { parseSheet, mergeSheets, rundownToCustomCues } from "../core/parse/index.js";

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
} else usage();
