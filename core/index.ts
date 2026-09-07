import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Cue, Pack, ShowDoc } from "./types.js";
import { boxingFightNight } from "./packs/boxing-fightnight.js";
import { boxingPressConference, boxingWeighIn } from "./packs/boxing-fightweek.js";
import { resolve, withCustomCues, fromLegacyBoutJson } from "./resolve.js";
import { companionPage, type CompanionOpts } from "./gen/companion.js";
import { writeCueSheet } from "./gen/cuesheet.js";
import { disguiseCueTables, mediaManifest, resolumePlan, resolumeScript } from "./gen/engines.js";

export * from "./types.js";
export { boxingFightNight, boxingPressConference, boxingWeighIn, resolve, withCustomCues, fromLegacyBoutJson, companionPage, writeCueSheet, disguiseCueTables, mediaManifest, resolumePlan, resolumeScript };
export { fromPixelMapper, normalizePixelMapper, autoRouting, autoVenue, autoOutputs, screensFromMapFiles, contentGuideRows } from "./integrations/pixelmapper.js";

export const packs: Record<string, Pack> = { [boxingFightNight.id]: boxingFightNight, [boxingPressConference.id]: boxingPressConference, [boxingWeighIn.id]: boxingWeighIn };

export function loadShowDoc(json: any): ShowDoc {
  if (json.schema === "surface/2.0") return json as ShowDoc;
  if (json.schema === "boutkit/1.0") return fromLegacyBoutJson(json);
  throw new Error(`unknown schema ${json.schema}`);
}

/** Once a composition is published, its cue numbers are pinned: later derivations keep them and new cues take the next
 *  free columns — a mid-week sheet change must never silently repoint Resolume columns or Companion buttons. */
export function applyPinnedNumbers(doc: ShowDoc, cues: Cue[]): Cue[] {
  const pinned = doc.build?.cueNumbers; if (!pinned || !Object.keys(pinned).length) return cues;
  const used = new Set<number>(Object.values(pinned));
  let next = Math.max(0, ...used);
  return cues.map((c) => {
    if (pinned[c.id] !== undefined) return { ...c, n: pinned[c.id] };
    do { next++; } while (used.has(next));
    used.add(next); return { ...c, n: next };
  });
}

/** Record the current numbering as published — call when a composition/bundle is actually built. */
export function publishCueNumbers(doc: ShowDoc, cues: Cue[]): void {
  doc.build = { ...doc.build, cueNumbers: Object.fromEntries(cues.map((c) => [c.id, c.n])) };
}

/** Full derivation: pack cues + custom cues, then engine addresses. Pure; no I/O. */
export function deriveCues(doc: ShowDoc, packId = boxingFightNight.id): Cue[] {
  const pack = packs[packId]; if (!pack) throw new Error(`unknown pack ${packId}`);
  const cues = resolve(doc, applyPinnedNumbers(doc, withCustomCues(pack.deriveCues(doc), doc.customCues)));
  // media resolution: the doc remembers which converted file fills each slot (transcode manifest, test patterns)
  if (doc.media) for (const c of cues) for (const t of c.targets) for (const a of t.actions) if (a.op === "show") a.media.file = doc.media[a.media.slot] ?? null;
  return cues;
}

export interface BuildOpts { outDir: string; companion: CompanionOpts; mediaRoot?: string }

/** Author-only bundle: everything on disk, nothing needs a running engine. */
export async function buildBundle(doc: ShowDoc, cues: Cue[], o: BuildOpts): Promise<string[]> {
  const files: string[] = [];
  const w = (rel: string, data: string) => { const p = join(o.outDir, rel); mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, data); files.push(rel); };
  mkdirSync(o.outDir, { recursive: true });
  // companion pages first: they assign cue.companion positions used by the cue sheet
  for (const b of [...doc.data.bouts].sort((a: any, b: any) => a.order - b.order)) {
    const page = b.order + 1;
    w(`companion/P${String(page).padStart(2, "0")}_${b.id}.companionconfig`, JSON.stringify(companionPage(doc, cues, b.id, page, o.companion), null, 1));
  }
  await writeCueSheet(doc, cues, join(o.outDir, `${doc.event.id}_cuesheet.xlsx`)); files.push(`${doc.event.id}_cuesheet.xlsx`);
  w(`${doc.event.id}_cues.json`, JSON.stringify(cues, null, 1));
  w(`${doc.event.id}_media_manifest.json`, JSON.stringify(mediaManifest(doc, cues), null, 1));
  const mediaRoot = o.mediaRoot ?? `C:/Shows/${doc.event.id}/media`;
  const plan = resolumePlan(doc, cues, mediaRoot, `C:/Shows/${doc.event.id}/${doc.event.id}.avc`);
  w("resolume/plan.json", JSON.stringify(plan, null, 1));
  w("resolume/build.py", resolumeScript(plan));
  for (const [name, txt] of Object.entries(disguiseCueTables(doc, cues))) w(`disguise/cue_tables/${name}`, txt);
  return files;
}
