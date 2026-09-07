#!/usr/bin/env tsx
/**
 * boutkit build <show.json> [outDir] [--mode bridge|direct] [--host 127.0.0.1:8090]
 * boutkit cues  <show.json>            print the derived cue list
 */
import { readFileSync } from "node:fs";
import { buildBundle, deriveCues, loadShowDoc } from "../core/index.js";

const [cmd, file, ...rest] = process.argv.slice(2);
const flag = (k: string, d: string) => { const i = rest.indexOf(`--${k}`); return i >= 0 ? rest[i + 1] : d; };
if (!cmd || !file) { console.error("usage: surface build|cues <show.json> [outDir] [--mode bridge|direct]"); process.exit(1); }
const doc = loadShowDoc(JSON.parse(readFileSync(file, "utf8")));
const cues = deriveCues(doc);
if (cmd === "cues") {
  for (const c of cues) console.log(String(c.n).padStart(3, "0"), c.id.padEnd(18), c.name.padEnd(48), (c.d3?.tag ?? "").padEnd(6), c.resolume?.groups === "ALL" ? "ALL" : (c.resolume?.groups as string[]).join(","));
} else if (cmd === "build") {
  const outDir = rest.find((r) => !r.startsWith("--") && r !== flag("mode", "") && r !== flag("host", "")) ?? "out";
  const files = await buildBundle(doc, cues, { outDir, companion: { mode: flag("mode", "bridge") as any, surfaceHost: flag("host", "127.0.0.1:8090") } });
  console.log(`${cues.length} cues → ${outDir}/`); files.forEach((f) => console.log("  " + f));
  if (doc.review.status !== "approved") console.warn(`\n⚠ review.status is '${doc.review.status}' — ${doc.review.flags.length} flag(s):\n  - ${doc.review.flags.join("\n  - ")}`);
}
