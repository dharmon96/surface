import { readFileSync } from "node:fs";
import { parseTimingSheet } from "./core/parse/index.js";
import { deriveCues, mediaManifest } from "./core/index.js";
import { intake } from "./core/intake/match.js";
import { planTranscodes, transcodeSummary } from "./core/intake/transcode.js";
import type { Probe } from "./core/intake/intake.js";
const rows = readFileSync("fixtures/examples-survey/probes.jsonl","utf8").trim().split("\n").map(l=>JSON.parse(l));
const toProbe = (r:any): Probe => ({ file:r.f, w:r.w, h:r.h, durationSec:r.dur, fps:0, hasAlpha:/a$|rgba/.test(r.pix||""), still:r.codec==="png", bytes:r.mb*1048576, codec:r.codec, pix:r.pix, audio:r.audio } as any);
// --- package 1: numbered Fight Night, stand-in sheet = Glendale (8 bouts)
const doc = parseTimingSheet(readFileSync("fixtures/text/2026-06-13-glendale-timing.txt","utf8"));
doc.screens = [{id:"MAIN",name:"Main Video Board",w:1920,h:1080},{id:"BARGE",name:"Full Barge",w:1792,h:504},{id:"CORNER",name:"Corner Boards",w:576,h:648},{id:"WEDGE",name:"Wedge",w:504,h:2016},{id:"TUNNEL",name:"Tunnel",w:1536,h:1152}];
doc.surfaces = doc.screens.map(s=>({id:s.id,name:s.name,screens:[s.id]}));
doc.routing = { HOLD:["ALL"], FLAG:["MAIN"], WALKOUT:["ALL"], FIGHTER:["MAIN","BARGE"], TALE:["MAIN","BARGE"], ROUND:["MAIN","BARGE"], ROUND_STAY:["BARGE"], WINNER:["MAIN","BARGE","CORNER","TUNNEL"], UP_NEXT:["MAIN","BARGE"], VT:["MAIN"] };
const syn = { MAIN:{words:["main video board","main board","main video","hung","centerhung","main videoboard","main video booard"],w:1920,h:1080}, BARGE:{words:["full barge","barge","scoreboard","fullbarge","full burge"],w:1792,h:504}, CORNER:{words:["corner boards","corner board","corner post","corner","cornerboards"],w:576,h:648}, WEDGE:{words:["wedge"],w:504,h:2016}, TUNNEL:{words:["tunnel"],w:1536,h:1152} };
const cues = deriveCues(doc); const man = mediaManifest(doc, cues);
const p1 = rows.filter((r:any)=>r.f.startsWith("Fight Night/")).map(toProbe);
for (const ov of [undefined, {direction:"opener-first" as const, aIs:"red" as const}]) {
  const r = intake(doc, man, p1, syn, { override: ov });
  console.log("\n=== Fight Night", ov ? "with override" : "no override", "| scheme:", r.scheme.direction, r.scheme.aIs, r.scheme.confidence.toFixed(2));
  console.log(r.scheme.evidence.slice(0,4).join("\n"));
  console.log(`assigned ${r.assignments.length}/${man.length} slots · unmatched ${r.unmatched.length} · ignored ${r.ignored.length} · unfilled ${r.unfilled.length} · issues ${r.issues.length}`);
  console.log(r.assignments.slice(0,6).map(a=>`  ${a.slot.padEnd(40)} ← ${a.file.slice(0,60).padEnd(60)} ${a.confidence.toFixed(2)} [${a.reasons.join("; ")}] ${a.issues.join("; ")}`).join("\n"));
  console.log("  issues:", r.issues.slice(0,8).join("\n          "));
  console.log("  unmatched:", r.unmatched.slice(0,8).map(u=>`${u.file.slice(0,55)} :: ${u.why}`).join("\n             "));
  console.log("  unfilled sample:", r.unfilled.slice(0,6).join(", "));
  if (ov) { const jobs = planTranscodes(r.assignments, p1, man, { engine:"resolume", outDir:"C:/Shows/x/media" }); console.log("  transcode:", transcodeSummary(jobs)); console.log("  ", jobs.find(j=>j.notes.length)?.notes, jobs[0]?.args[0].join(" ").slice(0,160)); }
}
