import { useMemo, useState } from "react";
import { useStore } from "../store";
import type { Screen, ShowDoc, Surface } from "../../core/types";

/**
 * Screens & routing — where the venue's screens come from and which graphics go where.
 *   Screen   = a physical raster (id is stable: it is baked into asset names, so rename the label, not the id, after intake)
 *   Surface  = screens that always show the same thing (IMAG L + R). "Independent" surfaces are never hit by "ALL".
 *   Routing  = graphic type → surfaces. "Auto by resolution" fills a sensible default from the shapes.
 */
const GRAPHICS: { key: string; label: string; hint: string }[] = [
  { key: "HOLD", label: "Holding", hint: "loops between fights" }, { key: "UP_NEXT", label: "Up next", hint: "before each walk" },
  { key: "WALKOUT", label: "Walkouts", hint: "one per fighter" }, { key: "FIGHTER", label: "Fighter cards", hint: "single-fighter stills" },
  { key: "TALE", label: "Fighter v Fighter", hint: "stays up through the fight" }, { key: "ROUND", label: "Rounds", hint: "over the fight graphic, ~10 s" },
  { key: "ROUND_STAY", label: "Rounds (stay up)", hint: "screens that keep the round card all round" }, { key: "WINNER", label: "Winner", hint: "" },
  { key: "FLAG", label: "Anthem flags", hint: "" }, { key: "VT", label: "VTs / ads", hint: "play and hold last frame" },
];
const aspect = (s: Screen) => s.w / Math.max(1, s.h);
/** Sensible routing from shapes alone: ultra-wide = ribbon (rounds, fighter cards, holds); independent = holds only; the rest = everything. */
function autoRoute(screens: Screen[], surfaces: Surface[]): Record<string, string[]> {
  const of = (sid: string) => screens.filter((s) => surfaces.find((x) => x.id === sid)?.screens.includes(s.id));
  const isRibbon = (sid: string) => of(sid).some((s) => aspect(s) > 6);
  const normal = surfaces.filter((s) => !s.independent && !isRibbon(s.id)).map((s) => s.id);
  const ribbon = surfaces.filter((s) => !s.independent && isRibbon(s.id)).map((s) => s.id);
  const r: Record<string, string[]> = {
    HOLD: ["ALL"], UP_NEXT: normal, WALKOUT: normal, FIGHTER: [...normal.slice(0, 1), ...ribbon], TALE: normal,
    ROUND: [...normal.slice(0, 1), ...ribbon], ROUND_STAY: ribbon, WINNER: ["ALL"], FLAG: normal.slice(0, 1), VT: normal,
  };
  for (const k of Object.keys(r)) if (!r[k].length) r[k] = normal.length ? [normal[0]] : ["ALL"];
  return r;
}
const newId = (name: string, taken: Set<string>) => { let id = name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 16) || "SCREEN"; while (taken.has(id)) id += "_2"; return id; };

export function Screens() {
  const { doc, saveDoc, board } = useStore();
  const [draft, setDraft] = useState<ShowDoc | null>(null); const [pm, setPm] = useState(""); const [msg, setMsg] = useState<string | null>(null);
  const d = draft ?? doc; if (!d) return null;
  const words: Record<string, string[]> = (d as any).screenWords ?? {};
  const dirty = draft !== null;
  const hasMedia = !!board?.delivery;
  const set = (patch: Partial<ShowDoc> & { screenWords?: Record<string, string[]> }) => setDraft({ ...(draft ?? doc!), ...patch } as ShowDoc);
  const surfaceOf = (sid: string) => d.surfaces.find((s) => s.screens.includes(sid));
  const setScreen = (i: number, s: Screen) => set({ screens: d.screens.map((x, k) => (k === i ? s : x)) });
  const addScreen = () => { const id = newId("Screen " + (d.screens.length + 1), new Set(d.screens.map((s) => s.id))); set({ screens: [...d.screens, { id, name: `Screen ${d.screens.length + 1}`, w: 1920, h: 1080 }], surfaces: [...d.surfaces, { id, name: `Screen ${d.screens.length + 1}`, screens: [id] }] }); };
  const removeScreen = (id: string) => { const surfaces = d.surfaces.map((s) => ({ ...s, screens: s.screens.filter((x) => x !== id) })).filter((s) => s.screens.length); const routing = Object.fromEntries(Object.entries(d.routing).map(([k, v]) => [k, v.filter((x) => x === "ALL" || surfaces.some((s) => s.id === x))])); set({ screens: d.screens.filter((s) => s.id !== id), surfaces, routing }); };
  /** Move a screen into a surface (group) — "" means its own surface again */
  const regroup = (sid: string, target: string) => {
    let surfaces = d.surfaces.map((s) => ({ ...s, screens: s.screens.filter((x) => x !== sid) })).filter((s) => s.screens.length);
    if (target && surfaces.some((s) => s.id === target)) surfaces = surfaces.map((s) => (s.id === target ? { ...s, screens: [...s.screens, sid] } : s));
    else { const sc = d.screens.find((s) => s.id === sid)!; surfaces = [...surfaces, { id: sid, name: sc.name, screens: [sid] }]; }
    const routing = Object.fromEntries(Object.entries(d.routing).map(([k, v]) => [k, v.filter((x) => x === "ALL" || surfaces.some((s) => s.id === x))]));
    set({ surfaces, routing });
  };
  const toggleRoute = (g: string, sid: string) => { const cur = d.routing[g] ?? []; const all = cur.includes("ALL"); const base = all ? d.surfaces.filter((s) => !s.independent).map((s) => s.id) : cur; const next = base.includes(sid) ? base.filter((x) => x !== sid) : [...base, sid]; set({ routing: { ...d.routing, [g]: next } }); };
  const toggleAll = (g: string) => set({ routing: { ...d.routing, [g]: (d.routing[g] ?? []).includes("ALL") ? [] : ["ALL"] } });
  const routed = (g: string, sid: string) => { const v = d.routing[g] ?? []; const s = d.surfaces.find((x) => x.id === sid); return v.includes("ALL") ? !s?.independent : v.includes(sid); };
  const importPM = async () => { try { const r = await fetch("/api/import/pixelmapper", { method: "POST", headers: { "Content-Type": "application/json" }, body: pm }); const b = await r.json(); if (!r.ok) throw new Error(b.error ?? r.status); setDraft(null); setPm(""); await useStore.getState().load(); setMsg(`Imported ${b.screens} screens as ${b.surfaces} surfaces${b.flags?.length ? ` · ${b.flags.join("; ")}` : ""}`); } catch (e: any) { setMsg(`Import failed: ${e.message}`); } };
  const save = async () => { await saveDoc(d); setDraft(null); setMsg("Saved — cues re-derived"); };
  const surfaceCols = useMemo(() => d.surfaces, [d.surfaces]);
  return (
    <div className="screens">
      {msg && <div className="note" onClick={() => setMsg(null)}>{msg}</div>}
      <div className="panel" style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}><h3 style={{ margin: 0 }}>Screens</h3><span className="dim mono-small">{d.screens.length} rasters · {d.surfaces.length} surfaces</span><span style={{ marginLeft: "auto" }} /><button onClick={addScreen}>Add screen</button></div>
        {hasMedia && <div className="dim mono-small" style={{ margin: "6px 0" }}>Media is already mapped to these ids — change labels and sizes freely, but adding or removing screens means running Prepare again.</div>}
        <table style={{ marginTop: 8 }}><thead><tr><th>Id</th><th>Label</th><th>Width</th><th>Height</th><th>Shape</th><th>Group with</th><th title="Never receives an ALL cue (host booth, LED tables, scale)">Independent</th><th title="Words the promoter uses for this screen in file names">Also called</th><th></th></tr></thead>
          <tbody>{d.screens.map((s, i) => { const sf = surfaceOf(s.id); const groupTarget = sf && sf.screens.length > 1 ? sf.id : ""; return (
            <tr key={s.id}>
              <td className="mono-small">{s.id}</td>
              <td><input value={s.name} onChange={(e) => setScreen(i, { ...s, name: e.target.value })} style={{ width: 150 }} /></td>
              <td><input type="number" value={s.w} onChange={(e) => setScreen(i, { ...s, w: Number(e.target.value) })} style={{ width: 84 }} /></td>
              <td><input type="number" value={s.h} onChange={(e) => setScreen(i, { ...s, h: Number(e.target.value) })} style={{ width: 84 }} /></td>
              <td className="dim mono-small">{aspect(s) > 6 ? "ribbon" : aspect(s) < 0.8 ? "portrait" : aspect(s) > 2.5 ? "wide" : "16:9"}</td>
              <td><select value={groupTarget} onChange={(e) => regroup(s.id, e.target.value)}><option value="">— its own —</option>{d.surfaces.filter((x) => !x.screens.includes(s.id) || x.screens.length > 1).map((x) => <option key={x.id} value={x.id}>{x.id} ({x.screens.join(" + ")})</option>)}</select></td>
              <td><input type="checkbox" checked={!!sf?.independent} onChange={(e) => set({ surfaces: d.surfaces.map((x) => (x.id === sf?.id ? { ...x, independent: e.target.checked } : x)) })} /></td>
              <td><input value={(words[s.id] ?? []).join(", ")} placeholder="fascia, truss, 28576x64" onChange={(e) => set({ screenWords: { ...words, [s.id]: e.target.value.split(",").map((w) => w.trim().toLowerCase()).filter(Boolean) } } as any)} style={{ width: 180 }} /></td>
              <td><button onClick={() => removeScreen(s.id)} title="Remove">×</button></td>
            </tr>); })}</tbody></table>
      </div>
      <div className="grid2">
        <div className="panel">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}><h3 style={{ margin: 0 }}>Routing</h3><span className="dim mono-small">which graphics go to which surface</span><span style={{ marginLeft: "auto" }} /><button onClick={() => set({ routing: autoRoute(d.screens, d.surfaces) })}>Auto by resolution</button></div>
          <table style={{ marginTop: 8 }}><thead><tr><th>Graphic</th><th>All</th>{surfaceCols.map((s) => <th key={s.id} title={s.screens.join(" + ")}>{s.id}{s.independent ? " ⏚" : ""}</th>)}</tr></thead>
            <tbody>{GRAPHICS.map((g) => <tr key={g.key}><td>{g.label}<div className="faint mono-small">{g.hint}</div></td><td><input type="checkbox" checked={(d.routing[g.key] ?? []).includes("ALL")} onChange={() => toggleAll(g.key)} /></td>{surfaceCols.map((s) => <td key={s.id}><input type="checkbox" checked={routed(g.key, s.id)} disabled={(d.routing[g.key] ?? []).includes("ALL")} onChange={() => toggleRoute(g.key, s.id)} /></td>)}</tr>)}</tbody></table>
          <div className="faint mono-small" style={{ marginTop: 6 }}>⏚ independent — skipped by "All". Rounds go over the fight graphic on the screens ticked here; "Rounds (stay up)" keeps the card up for the whole round on those screens.</div>
        </div>
        <div className="panel">
          <h3>Import from PixelGrid</h3>
          <div className="dim mono-small" style={{ marginBottom: 6 }}>Paste the project JSON (PixelGrid → Export) — screens, sizes and groups come across; host/booth/table/scale names become independent surfaces.</div>
          <textarea value={pm} onChange={(e) => setPm(e.target.value)} placeholder='{"screens":[…]}' style={{ width: "100%", height: 140, font: "12px var(--mono)", background: "var(--card)", color: "var(--foreground)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: 8 }} />
          <div className="gorow" style={{ margin: "8px 0 0" }}><button disabled={!pm.trim()} onClick={importPM}>Import</button><span className="faint mono-small">Linking PixelGrid projects by account comes with the hub sync.</span></div>
        </div>
      </div>
      <div className="gorow" style={{ marginTop: 14 }}><button className="primary" disabled={!dirty} onClick={save}>Save screens & routing</button>{dirty && <button onClick={() => setDraft(null)}>Discard</button>}<span className="dim mono-small">Saving re-derives every cue; published cue numbers stay put.</span></div>
    </div>
  );
}
