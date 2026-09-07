import { useEffect, useMemo, useState } from "react";
import { useStore, type Board } from "../store";
import type { Screen, ShowDoc, Surface } from "../../core/types";

/**
 * Screens & routing — where the venue's screens come from and which graphics go where.
 *   Screen   = a physical raster (id is stable: it is baked into asset names, so rename the label, not the id, after intake)
 *   Surface  = screens that always show the same thing (IMAG L + R). "Independent" surfaces are never hit by "ALL".
 *   Routing  = graphic type → surfaces, picked on tiles that look like the screens (their PixelGrid test patterns), each
 *              tile saying whether the delivery actually has that graphic for that screen.
 */
const GRAPHICS: { key: string; label: string; hint: string; cells: string[] }[] = [
  { key: "HOLD", label: "Holding", hint: "loops between fights", cells: ["EVT.HOLD_MAIN", "EVT.HOLD_COMAIN", "EVT.HOLD_SPONSOR"] }, { key: "UP_NEXT", label: "Up next", hint: "before each walk", cells: ["UP_NEXT"] },
  { key: "WALKOUT", label: "Walkouts", hint: "one per fighter", cells: ["WALK_RED", "WALK_BLUE"] }, { key: "FIGHTER", label: "Fighter cards", hint: "single-fighter stills (intros)", cells: [] },
  { key: "TALE", label: "Fighter v Fighter", hint: "stays up through the fight", cells: ["TALE"] }, { key: "ROUND", label: "Rounds", hint: "over the fight graphic, ~10 s", cells: ["ROUNDS"] },
  { key: "ROUND_STAY", label: "Rounds (stay up)", hint: "keep the card up all round", cells: ["ROUNDS"] }, { key: "WINNER", label: "Winner", hint: "", cells: ["WINNER"] },
  { key: "FLAG", label: "Anthem flags", hint: "", cells: ["FLAGS"] }, { key: "VT", label: "VTs / ads", hint: "play and hold last frame", cells: ["VTS"] },
];
const aspect = (s: Screen) => s.w / Math.max(1, s.h);
const shape = (s: Screen) => (aspect(s) > 6 ? "ribbon" : aspect(s) < 0.8 ? "portrait" : aspect(s) > 2.5 ? "wide" : "16:9");
const newId = (name: string, taken: Set<string>) => { let id = name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 16) || "SCREEN"; while (taken.has(id)) id += "_2"; return id; };
const thumbOf = (doc: ShowDoc, s: Screen) => (s.testPattern && doc.mediaRoot ? `/api/thumb?f=${encodeURIComponent(`${doc.mediaRoot}/${s.testPattern}`)}` : null);

/** how much of a graphic type the delivery has, per screen: {ready, total} counted over the board's cells */
function availability(board: Board | null, cells: string[]): Record<string, { have: number; total: number }> {
  const out: Record<string, { have: number; total: number }> = {}; if (!board) return out;
  for (const r of board.rows) {
    const slots = cells.flatMap((k) => (k === "ROUNDS" ? (r.rounds ?? []).flatMap((x) => x.slots) : r.cells[k]?.slots ?? []));
    for (const s of slots) { const o = (out[s.screen] ??= { have: 0, total: 0 }); o.total++; if (s.status !== "missing") o.have++; }
  }
  return out;
}

/** A screen drawn at its real shape with its test pattern; ticked = routed */
function Tile({ s, doc, on, avail, onClick, scale = 1 / 48 }: { s: Screen; doc: ShowDoc; on?: boolean; avail?: { have: number; total: number }; onClick?: () => void; scale?: number }) {
  // drawn to scale against the other screens (a 7680 ribbon really is twice the main wall), clamped so nothing becomes unclickable
  const w = Math.min(200, Math.max(40, s.w * scale)); const h = Math.min(90, Math.max(10, s.h * scale)); const t = thumbOf(doc, s);
  const state = !avail ? "" : avail.total === 0 ? "" : avail.have === avail.total ? "full" : avail.have ? "part" : "none";
  return (
    <div className={`tile ${on ? "on" : ""} ${onClick ? "click" : ""} ${state}`} style={{ width: Math.max(w, 64) + 4 }} onClick={onClick} title={`${s.name} · ${s.w}×${s.h}${avail && avail.total ? ` · ${avail.have}/${avail.total} delivered` : ""}`}>
      <div className="raster" style={{ width: w, height: h, backgroundImage: t ? `url(${t})` : undefined }}>{!t && <span>{s.id}</span>}</div>
      <div className="cap"><span>{s.id}</span>{avail && avail.total > 0 && <b>{avail.have}/{avail.total}</b>}</div>
    </div>
  );
}

export function Screens() {
  const { doc, saveDoc, board, hub, pixelgrid, loadPixelGrid, importPixelGrid, importScreenMaps } = useStore();
  const [draft, setDraft] = useState<ShowDoc | null>(null); const [pm, setPm] = useState(""); const [msg, setMsg] = useState<string | null>(null); const [mapDir, setMapDir] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { if (hub?.signedIn && pixelgrid === null) loadPixelGrid(); }, [hub?.signedIn]);
  const d = draft ?? doc; if (!d) return null;
  const words: Record<string, string[]> = (d as any).screenWords ?? {};
  const dirty = draft !== null; const hasMedia = !!board?.delivery; const desktop = (window as any).surface;
  const set = (patch: Partial<ShowDoc> & { screenWords?: Record<string, string[]> }) => setDraft({ ...(draft ?? doc!), ...patch } as ShowDoc);
  const surfaceOf = (sid: string) => d.surfaces.find((s) => s.screens.includes(sid));
  const setScreen = (i: number, s: Screen) => set({ screens: d.screens.map((x, k) => (k === i ? s : x)) });
  const addScreen = () => { const id = newId("Screen " + (d.screens.length + 1), new Set(d.screens.map((s) => s.id))); set({ screens: [...d.screens, { id, name: `Screen ${d.screens.length + 1}`, w: 1920, h: 1080 }], surfaces: [...d.surfaces, { id, name: `Screen ${d.screens.length + 1}`, screens: [id] }] }); };
  const removeScreen = (id: string) => { const surfaces = d.surfaces.map((s) => ({ ...s, screens: s.screens.filter((x) => x !== id) })).filter((s) => s.screens.length); const routing = Object.fromEntries(Object.entries(d.routing).map(([k, v]) => [k, v.filter((x) => x === "ALL" || surfaces.some((s) => s.id === x))])); set({ screens: d.screens.filter((s) => s.id !== id), surfaces, routing }); };
  const regroup = (sid: string, target: string) => {
    let surfaces = d.surfaces.map((s) => ({ ...s, screens: s.screens.filter((x) => x !== sid) })).filter((s) => s.screens.length);
    if (target && surfaces.some((s) => s.id === target)) surfaces = surfaces.map((s) => (s.id === target ? { ...s, screens: [...s.screens, sid] } : s));
    else { const sc = d.screens.find((s) => s.id === sid)!; surfaces = [...surfaces, { id: sid, name: sc.name, screens: [sid] }]; }
    const routing = Object.fromEntries(Object.entries(d.routing).map(([k, v]) => [k, v.filter((x) => x === "ALL" || surfaces.some((s) => s.id === x))]));
    set({ surfaces, routing });
  };
  const routed = (g: string, sid: string) => { const v = d.routing[g] ?? []; const s = d.surfaces.find((x) => x.id === sid); return v.includes("ALL") ? !s?.independent : v.includes(sid); };
  const toggleRoute = (g: string, sid: string) => { const cur = d.routing[g] ?? []; const base = cur.includes("ALL") ? d.surfaces.filter((s) => !s.independent).map((s) => s.id) : cur; const next = base.includes(sid) ? base.filter((x) => x !== sid) : [...base, sid]; set({ routing: { ...d.routing, [g]: next } }); };
  const toggleAll = (g: string) => set({ routing: { ...d.routing, [g]: (d.routing[g] ?? []).includes("ALL") ? [] : ["ALL"] } });
  const importPM = async () => { try { const r = await fetch("/api/import/pixelmapper", { method: "POST", headers: { "Content-Type": "application/json" }, body: pm }); const b = await r.json(); if (!r.ok) throw new Error(b.error ?? r.status); setDraft(null); setPm(""); await useStore.getState().load(); setMsg(`Imported ${b.screens} screens as ${b.surfaces} surfaces${b.flags?.length ? ` · ${b.flags.join("; ")}` : ""}`); } catch (e: any) { setMsg(`Import failed: ${e.message}`); } };
  const pickMaps = async () => { setBusy(true); try { const dir = desktop?.pickFolder ? await desktop.pickFolder() : mapDir; if (!dir) return; setDraft(null); setMsg(await importScreenMaps({ dir })); } finally { setBusy(false); } };
  const save = async () => { await saveDoc(d); setDraft(null); setMsg("Saved — cues re-derived"); };
  const avail = useMemo(() => Object.fromEntries(GRAPHICS.map((g) => [g.key, availability(board, g.cells)])), [board]);
  const scale = 200 / Math.max(1, ...d.screens.map((s) => s.w));
  const surfaceScreens = (sf: Surface) => sf.screens.map((id) => d.screens.find((s) => s.id === id)!).filter(Boolean);
  return (
    <div className="screens">
      {msg && <div className="note" onClick={() => setMsg(null)}>{msg}</div>}
      <div className="grid2" style={{ marginBottom: 14 }}>
        <div className="panel">
          <h3>Load from PixelGrid</h3>
          {hub?.signedIn ? (
            <div>
              <div className="dim mono-small" style={{ marginBottom: 6 }}>Your PixelGrid projects. Loading one brings the screens, their groups, and the test patterns PixelGrid already rendered.</div>
              {pixelgrid === null ? <div className="dim">loading…</div> : !pixelgrid.length ? <div className="dim">No PixelGrid projects in this account yet.</div> :
                <table><tbody>{pixelgrid.map((p) => <tr key={p.id}><td>{p.name}</td><td className="dim mono-small">{p.screens ?? "?"} screens</td><td className="dim mono-small">{new Date(p.updatedAt).toLocaleDateString()}</td><td><button onClick={async () => { setBusy(true); setDraft(null); setMsg(await importPixelGrid(p.id)); setBusy(false); }} disabled={busy}>Load</button></td></tr>)}</tbody></table>}
            </div>
          ) : <div className="dim">Sign in (Projects) to list your PixelGrid projects. Or use the exported screen maps →</div>}
        </div>
        <div className="panel">
          <h3>Screen maps from PixelGrid</h3>
          <div className="dim mono-small" style={{ marginBottom: 6 }}>PixelGrid → Export → native PNGs, one per screen at 1:1 pixels with the test pattern baked in. Drop them on the board, or pick the folder — sizes, names and patterns come from the files.</div>
          <div className="gorow" style={{ margin: 0 }}>{desktop?.pickFolder ? <button onClick={pickMaps} disabled={busy}>Import screen maps…</button> : <><input placeholder="folder with the PNGs" value={mapDir} onChange={(e) => setMapDir(e.target.value)} style={{ flex: 1 }} /><button onClick={pickMaps} disabled={!mapDir || busy}>Import</button></>}</div>
          <details style={{ marginTop: 10 }}><summary className="dim mono-small" style={{ cursor: "pointer" }}>Paste project JSON instead</summary>
            <textarea value={pm} onChange={(e) => setPm(e.target.value)} placeholder='{"metadata":…,"data":{"screens":…}}' style={{ width: "100%", height: 90, marginTop: 6, font: "12px var(--mono)", background: "var(--card)", color: "var(--foreground)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: 8 }} />
            <div className="gorow" style={{ margin: "6px 0 0" }}><button disabled={!pm.trim()} onClick={importPM}>Import JSON</button></div></details>
        </div>
      </div>
      <div className="panel" style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}><h3 style={{ margin: 0 }}>Screens</h3><span className="dim mono-small">{d.screens.length} screens · {d.surfaces.length} groups</span><span style={{ marginLeft: "auto" }} /><button onClick={addScreen}>Add screen</button></div>
        {hasMedia && <div className="dim mono-small" style={{ margin: "6px 0" }}>Media is already mapped to these ids — change labels and sizes freely, but adding or removing screens means running Prepare again.</div>}
        <table style={{ marginTop: 8 }}><thead><tr><th></th><th>Id</th><th>Label</th><th>Width</th><th>Height</th><th>Shape</th><th>Group with</th><th title="Never receives an ALL cue (host booth, LED tables, scale)">Independent</th><th title="Words the promoter uses for this screen in file names">Also called</th><th></th></tr></thead>
          <tbody>{d.screens.map((s, i) => { const sf = surfaceOf(s.id); const groupTarget = sf && sf.screens.length > 1 ? sf.id : ""; return (
            <tr key={s.id}>
              <td><Tile s={s} doc={d} scale={scale * 0.5} /></td>
              <td className="mono-small">{s.id}</td>
              <td><input value={s.name} onChange={(e) => setScreen(i, { ...s, name: e.target.value })} style={{ width: 140 }} /></td>
              <td><input type="number" value={s.w} onChange={(e) => setScreen(i, { ...s, w: Number(e.target.value) })} style={{ width: 80 }} /></td>
              <td><input type="number" value={s.h} onChange={(e) => setScreen(i, { ...s, h: Number(e.target.value) })} style={{ width: 80 }} /></td>
              <td className="dim mono-small">{shape(s)}</td>
              <td><select value={groupTarget} onChange={(e) => regroup(s.id, e.target.value)}><option value="">— its own —</option>{d.surfaces.filter((x) => !x.screens.includes(s.id) || x.screens.length > 1).map((x) => <option key={x.id} value={x.id}>{x.id} ({x.screens.join(" + ")})</option>)}</select></td>
              <td><input type="checkbox" checked={!!sf?.independent} onChange={(e) => set({ surfaces: d.surfaces.map((x) => (x.id === sf?.id ? { ...x, independent: e.target.checked } : x)) })} /></td>
              <td><input value={(words[s.id] ?? []).join(", ")} placeholder="fascia, truss, 28576x64" onChange={(e) => set({ screenWords: { ...words, [s.id]: e.target.value.split(",").map((w) => w.trim().toLowerCase()).filter(Boolean) } } as any)} style={{ width: 170 }} /></td>
              <td><button onClick={() => removeScreen(s.id)} title="Remove">×</button></td>
            </tr>); })}</tbody></table>
      </div>
      <div className="panel">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}><h3 style={{ margin: 0 }}>Routing</h3><span className="dim mono-small">click a screen to send that graphic there · the count is how much of it the delivery has for that screen</span><span style={{ marginLeft: "auto" }} /><button onClick={() => set({ routing: Object.fromEntries(Object.entries(autoRouteLocal(d.screens, d.surfaces))) })}>Auto by resolution</button></div>
        <div className="routes">{GRAPHICS.map((g) => { const all = (d.routing[g.key] ?? []).includes("ALL"); return (
          <div key={g.key} className="route">
            <div className="rlabel"><b>{g.label}</b><span className="dim">{g.hint}</span><label className="dim mono-small"><input type="checkbox" checked={all} onChange={() => toggleAll(g.key)} /> every screen</label></div>
            <div className="tiles">{d.surfaces.map((sf) => { const scs = surfaceScreens(sf); if (!scs.length) return null; const on = routed(g.key, sf.id); const av = avail[g.key]; const sum = scs.reduce((o, sc) => { const a = av[sc.id]; if (a) { o.have += a.have; o.total += a.total; } return o; }, { have: 0, total: 0 });
              return <div key={sf.id} className={`sgroup ${scs.length > 1 ? "multi" : ""} ${sf.independent ? "indep" : ""}`} title={sf.independent ? "independent — skipped by 'every screen'" : sf.id}>{scs.map((sc, k) => <Tile key={sc.id} s={sc} doc={d} on={on} avail={k === 0 ? sum : undefined} onClick={() => toggleRoute(g.key, sf.id)} scale={scale} />)}</div>; })}</div>
          </div>); })}</div>
        <div className="faint mono-small" style={{ marginTop: 6 }}>Dashed = independent (host booth, tables, scale) — never hit by "every screen". A file that matches a screen's size, or its exact shape at a higher resolution, counts as delivered for it.</div>
      </div>
      <div className="gorow" style={{ marginTop: 14 }}><button className="primary" disabled={!dirty} onClick={save}>Save screens & routing</button>{dirty && <button onClick={() => setDraft(null)}>Discard</button>}<span className="dim mono-small">Saving re-derives every cue; published cue numbers stay put.</span></div>
    </div>
  );
}

/** same rule as core/integrations/pixelmapper autoRouting (kept local so the drawer works without a round-trip) */
function autoRouteLocal(screens: Screen[], surfaces: Surface[]): Record<string, string[]> {
  const of = (sid: string) => screens.filter((s) => surfaces.find((x) => x.id === sid)?.screens.includes(s.id));
  const isRibbon = (sid: string) => of(sid).some((s) => aspect(s) > 6);
  const area = (sid: string) => of(sid).reduce((n, s) => n + s.w * s.h, 0);
  const normal = surfaces.filter((s) => !s.independent && !isRibbon(s.id)).map((s) => s.id).sort((a, b) => area(b) - area(a)); const ribbon = surfaces.filter((s) => !s.independent && isRibbon(s.id)).map((s) => s.id);
  const r: Record<string, string[]> = { HOLD: ["ALL"], UP_NEXT: normal, WALKOUT: normal, FIGHTER: [...normal.slice(0, 1), ...ribbon], TALE: normal, ROUND: [...normal.slice(0, 1), ...ribbon], ROUND_STAY: ribbon, WINNER: ["ALL"], FLAG: normal.slice(0, 1), VT: normal };
  for (const k of Object.keys(r)) if (!r[k].length) r[k] = normal.length ? [normal[0]] : ["ALL"];
  return r;
}
