/**
 * Engine build plans. Generators emit *operation lists*; adapters execute them (live) or serialise them (scripts).
 * Keeping ops as data means the same plan can be diffed, dry-run, replayed after a card change, or unit-tested.
 */
import type { Cue, ShowDoc } from "../types.js";
import { expandScope, screensOf } from "../naming.js";

// ───────────────────────────────────────────── Resolume Arena (REST /api/v1)
export type ResolumeOp =
  | { op: "grow"; columns: number; layers: number }
  | { op: "addGroup"; index: number; name: string }
  | { op: "renameLayer"; index: number; name: string }
  | { op: "renameColumn"; index: number; name: string }
  | { op: "openClip"; layer: number; column: number; url: string; name: string }
  | { op: "clearClip"; layer: number; column: number }
  | { op: "save"; url: string };

export const RESOLUME_LAYERS: Array<"BASE" | "OVERLAY" | "FULL"> = ["BASE", "OVERLAY", "FULL"]; // bottom -> top within a group

/**
 * The composition, one column per cue, laid out per doc.build.resolumeLayout:
 *   per-screen  one layer group per surface (doc order), three layers per group (BASE, OVERLAY, FULL)
 *   together    group 1 "SHOW" = one layer per surface carrying BASE and FULL content (the column fires everything at once),
 *               group 2 "ROUNDS" = one overlay layer per surface, so rounds trigger without re-firing the walls
 */
export function resolumePlan(doc: ShowDoc, cues: Cue[], mediaRoot: string, savePath: string): ResolumeOp[] {
  const surfaces = doc.surfaces.filter((s) => s.screens.length); // every surface gets a layer/group, independent ones included
  const together = (doc.build?.resolumeLayout ?? "per-screen") === "together";
  const totalLayers = together ? surfaces.length * 2 : surfaces.length * RESOLUME_LAYERS.length;
  const ops: ResolumeOp[] = [{ op: "grow", columns: cues.length, layers: totalLayers }];
  const si = (surface: string) => surfaces.findIndex((s) => s.id === surface);
  const layerIndex = (surface: string, layer: string) => together ? (layer === "OVERLAY" ? surfaces.length + si(surface) + 1 : si(surface) + 1) : si(surface) * RESOLUME_LAYERS.length + RESOLUME_LAYERS.indexOf(layer as any) + 1;
  if (together) {
    ops.push({ op: "addGroup", index: 1, name: "SHOW" }); surfaces.forEach((s) => ops.push({ op: "renameLayer", index: layerIndex(s.id, "BASE"), name: s.id }));
    ops.push({ op: "addGroup", index: 2, name: "ROUNDS" }); surfaces.forEach((s) => ops.push({ op: "renameLayer", index: layerIndex(s.id, "OVERLAY"), name: `${s.id} ROUNDS` }));
  } else surfaces.forEach((s, gi) => {
    ops.push({ op: "addGroup", index: gi + 1, name: s.id });
    RESOLUME_LAYERS.forEach((l) => ops.push({ op: "renameLayer", index: layerIndex(s.id, l), name: `${s.id} ${l}` }));
  });
  const clipUrl = (a: any) => a.media.file ? `file:///${mediaRoot}/${a.media.file}` : `source:///video/Text Block`;
  for (const c of cues) {
    ops.push({ op: "renameColumn", index: c.n, name: `${String(c.n).padStart(3, "0")} ${c.id}` });
    for (const s of surfaces) {
      const t = c.targets.find((x) => x.surface === s.id);
      if (together) {
        // one slot per surface for BASE/FULL (FULL wins when both are in the cue), one for the overlay
        const main = t?.actions.find((x) => x.layer === "FULL" && x.op === "show") ?? t?.actions.find((x) => x.layer === "BASE" && x.op === "show");
        if (main && main.op === "show") ops.push({ op: "openClip", layer: layerIndex(s.id, "BASE"), column: c.n, url: clipUrl(main), name: main.media.slot });
        else ops.push({ op: "clearClip", layer: layerIndex(s.id, "BASE"), column: c.n }); // empty slot = the wall keeps playing
        const ov = t?.actions.find((x) => x.layer === "OVERLAY" && (x.op === "show" || x.op === "clear"));
        if (ov?.op === "show") ops.push({ op: "openClip", layer: layerIndex(s.id, "OVERLAY"), column: c.n, url: clipUrl(ov), name: ov.media.slot });
        else if (ov?.op === "clear") ops.push({ op: "openClip", layer: layerIndex(s.id, "OVERLAY"), column: c.n, url: `file:///${mediaRoot}/_CLEAR.png`, name: `${c.id} ROUNDS CLEAR` });
        else ops.push({ op: "clearClip", layer: layerIndex(s.id, "OVERLAY"), column: c.n });
        continue;
      }
      for (const l of RESOLUME_LAYERS) {
        const a = t?.actions.find((x) => x.layer === l && (x.op === "show" || x.op === "clear"));
        if (a?.op === "show") {
          // Resolume renders one raster per group; the group's first screen defines the slot (multi-screen surfaces share one file)
          ops.push({ op: "openClip", layer: layerIndex(s.id, l), column: c.n, url: clipUrl(a), name: a.media.slot });
        } else if (a?.op === "clear") {
          // Resolume keeps a layer playing on empty slots, so a "clear" loads a 1-frame transparent still named CLEAR
          ops.push({ op: "openClip", layer: layerIndex(s.id, l), column: c.n, url: `file:///${mediaRoot}/_CLEAR.png`, name: `${c.id} ${l} CLEAR` });
        } else {
          ops.push({ op: "clearClip", layer: layerIndex(s.id, l), column: c.n }); // untouched -> hold
        }
      }
    }
  }
  // stingers live in reserved columns after the cue columns: the top layer of every surface holds the alpha animation
  (doc.stingers ?? []).forEach((st, i) => {
    const col = cues.length + 1 + i; ops[0] = { op: "grow", columns: col, layers: totalLayers };
    ops.push({ op: "renameColumn", index: col, name: `TX ${st.id}` });
    for (const s of surfaces) ops.push({ op: "openClip", layer: layerIndex(s.id, together ? "OVERLAY" : "FULL"), column: col, url: st.file ? `file:///${mediaRoot}/${st.file}` : "source:///video/Text Block", name: `STINGER_${st.id}_${s.id}` });
  });
  ops.push({ op: "save", url: `file:///${savePath}` });
  return ops;
}
export function stingerColumn(doc: ShowDoc, cues: Cue[], stingerId: string): number | null { const i = (doc.stingers ?? []).findIndex((s) => s.id === stingerId); return i < 0 ? null : cues.length + 1 + i; }

/** Serialise a plan as a standalone Python script (for Author-only mode when no Surface process runs beside Arena). */
export function resolumeScript(plan: ResolumeOp[], base = "http://127.0.0.1:8080/api/v1"): string {
  return `#!/usr/bin/env python3
# Generated by Surface. Run beside Resolume Arena (7.8+) with Webserver enabled. Idempotent.
import requests, sys, json
BASE = sys.argv[1] if len(sys.argv) > 1 else ${JSON.stringify(base)}
def P(m, p, **k):
    r = requests.request(m, BASE + p, **k); r.raise_for_status(); return r
def name(path, n): P("put", path, json={"name": {"value": n}})
ops = json.loads(r'''${JSON.stringify(plan)}''')
for o in ops:
    t = o["op"]
    if t == "grow": P("post", "/composition/grow-to", json={"column_count": o["columns"], "layer_count": o["layers"]})
    elif t == "addGroup":
        groups = P("get", "/composition").json().get("layergroups", [])
        if o["index"] > len(groups): P("post", "/composition/layergroups/add")
        name(f"/composition/layergroups/{o['index']}", o["name"])
    elif t == "renameLayer": name(f"/composition/layers/{o['index']}", o["name"])
    elif t == "renameColumn": name(f"/composition/columns/{o['index']}", o["name"])
    elif t == "openClip":
        P("post", f"/composition/layers/{o['layer']}/clips/{o['column']}/open", data=o["url"], headers={"Content-Type": "text/plain"})
        name(f"/composition/layers/{o['layer']}/clips/{o['column']}", o["name"])
    elif t == "clearClip": P("post", f"/composition/layers/{o['layer']}/clips/{o['column']}/clear")
    elif t == "save": P("post", "/composition/save", data=o["url"], headers={"Content-Type": "text/plain"})
print("done", len(ops), "ops")
`;
}

// ───────────────────────────────────────────── disguise cue tables (Track Editor import) — one track per surface per group
export function disguiseCueTables(doc: ShowDoc, cues: Cue[], secPerCue = 10, bpm = 120): Record<string, string> {
  const out: Record<string, string> = {};
  const byTrack = new Map<string, Cue[]>();
  const together = (doc.build?.disguiseLayout ?? doc.build?.resolumeLayout ?? "per-screen") === "together";
  for (const c of cues) {
    // together: one SHOW track carries everything, rounds (overlays) get their own track so they never restart the walls
    if (together) { const k = c.targets.some((t) => t.actions.some((a) => a.layer === "OVERLAY" && a.op === "show")) && !c.targets.some((t) => t.actions.some((a) => a.layer !== "OVERLAY" && a.op === "show")) ? "ROUNDS" : "SHOW"; (byTrack.get(k) ?? byTrack.set(k, []).get(k)!).push(c); continue; }
    for (const s of expandScope(doc, c.scope)) { const k = `${c.group === "EVT" ? "EVT" : c.group}_${s}`; (byTrack.get(k) ?? byTrack.set(k, []).get(k)!).push(c); }
  }
  for (const [track, cs] of byTrack) {
    const lines = [`objects/track/${track}.apx`, "Beat\tTag\tNote\tTrack Time\tTimecode Time\tSection Break"];
    cs.forEach((c, i) => {
      const t = i * secPerCue, beat = (t * bpm) / 60;
      const hh = String(Math.floor(t / 3600)).padStart(2, "0"), mm = String(Math.floor((t % 3600) / 60)).padStart(2, "0"), ss = String(t % 60).padStart(2, "0");
      lines.push(`${beat}\tCUE ${c.d3?.tag ?? ""}\t${String(c.n).padStart(3, "0")} ${c.name}\t${hh}:${mm}:${ss}:00\t\t${i ? 1 : 0}`);
    });
    out[`${track}_cue_table.txt`] = lines.join("\n");
  }
  return out;
}

/** Media manifest: every slot the show expects, per screen, with resolution — the list you send the promoter/designer. */
export function mediaManifest(doc: ShowDoc, cues: Cue[]): Array<{ slot: string; screen: string; w: number; h: number; layer: string; behaviour: string; usedBy: string[] }> {
  const m = new Map<string, any>();
  for (const c of cues) for (const t of c.targets) for (const a of t.actions) if (a.op === "show") {
    const sc = screensOf(doc, t.surface).find((s) => a.media.slot.includes(`_${s.id}_`))!;
    const e = m.get(a.media.slot) ?? { slot: a.media.slot, screen: sc.id, w: sc.w, h: sc.h, layer: a.layer, behaviour: a.media.behaviour.kind, usedBy: [] };
    e.usedBy.push(c.id); m.set(a.media.slot, e);
  }
  return [...m.values()];
}
