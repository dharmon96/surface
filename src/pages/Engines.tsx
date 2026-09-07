import { useEffect, useState } from "react";
import { useStore } from "../store";

/**
 * Engines — where Surface sends the cues. Set up here, test before saving; no config file to edit.
 * With nothing enabled Surface rehearses against a built-in mock so the board and Run mode work anywhere.
 */
type Adapter = { type: "mock" } | { type: "resolume"; base?: string } | { type: "disguise"; host: string; rest?: boolean; oscPort?: number } | { type: "companion"; base?: string };
const j = async <T,>(url: string, init?: RequestInit): Promise<T> => { const r = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init }); if (!r.ok) throw new Error(`${r.status}`); return r.json(); };

export function Engines() {
  const { health, doc, refreshHealth } = useStore();
  const [cfg, setCfg] = useState<Adapter[] | null>(null); const [test, setTest] = useState<Record<string, { ok: boolean; detail: string } | "…">>({}); const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => { j<{ adapters: Adapter[] }>("/api/engines").then((r) => setCfg(r.adapters)).catch(() => setCfg([{ type: "mock" }])); }, []);
  if (!cfg) return <div className="dim">loading…</div>;
  const get = (t: Adapter["type"]) => cfg.find((a) => a.type === t) as any;
  const setA = (t: Adapter["type"], on: boolean, patch: any = {}) => setCfg((c) => { const rest = (c ?? []).filter((a) => a.type !== t && a.type !== "mock"); const next = on ? [...rest, { ...(get(t) ?? {}), ...patch, type: t }] : rest; return next.length ? next : [{ type: "mock" }]; });
  const runTest = async (a: any) => { setTest((t) => ({ ...t, [a.type]: "…" })); const r = await j<{ ok: boolean; detail: string }>("/api/engines/test", { method: "POST", body: JSON.stringify(a) }); setTest((t) => ({ ...t, [a.type]: r })); };
  const save = async () => { await j("/api/engines", { method: "PUT", body: JSON.stringify({ adapters: cfg }) }); await refreshHealth(); setSaved("Saved — Surface is now talking to " + (cfg.every((a) => a.type === "mock") ? "nothing (rehearsal mode)" : cfg.map((a) => a.type).join(" + "))); };
  const status = (t: string) => health?.adapters.find((a) => a.id === t);
  const Row = ({ t, title, hint, children }: { t: Adapter["type"]; title: string; hint: string; children?: React.ReactNode }) => { const on = !!get(t); const st = status(t); const tr = test[t]; return (
    <div className={`engine ${on ? "on" : ""}`}>
      <label className="ehead"><input type="checkbox" checked={on} onChange={(e) => setA(t, e.target.checked)} /><b>{title}</b><span className="dim">{hint}</span>
        {on && st && <span className={`tag ${st.connected ? "ok" : "bad"}`} style={{ marginLeft: "auto" }}>{st.connected ? `connected${st.latencyMs != null ? ` · ${st.latencyMs} ms` : ""}` : "offline"}</span>}</label>
      {on && <div className="ebody">{children}<div className="gorow" style={{ margin: "8px 0 0" }}><button onClick={() => runTest(get(t))} disabled={tr === "…"}>{tr === "…" ? "testing…" : "Test connection"}</button>{tr && tr !== "…" && <span className={tr.ok ? "ok-text" : "bad-text"}>{tr.detail}</span>}</div></div>}
    </div>); };
  return (
    <div className="engines">
      {saved && <div className="note" onClick={() => setSaved(null)}>{saved}</div>}
      <div className="panel" style={{ marginBottom: 14 }}>
        <h3>Where the cues go</h3>
        <Row t="resolume" title="Resolume Arena" hint="on this machine or across the network">
          <div className="field"><span>Address</span><input value={get("resolume")?.base ?? "http://127.0.0.1:8080/api/v1"} onChange={(e) => setA("resolume", true, { base: e.target.value })} style={{ width: 300 }} /></div>
          <div className="faint mono-small">Arena → Preferences → Webserver: turn it on (port 8080). For another machine, replace 127.0.0.1 with its IP. Build Resolume creates the groups, columns and clips there.</div>
        </Row>
        <Row t="disguise" title="disguise" hint="Director, via REST (r23.2+) with OSC fallback">
          <div className="field"><span>Director</span><input value={get("disguise")?.host ?? ""} placeholder="10.0.0.20 or 10.0.0.20:80" onChange={(e) => setA("disguise", true, { host: e.target.value })} style={{ width: 240 }} /></div>
          <div className="field"><span>OSC port</span><input type="number" value={get("disguise")?.oscPort ?? 7401} onChange={(e) => setA("disguise", true, { oscPort: Number(e.target.value) })} style={{ width: 100 }} /></div>
          <div className="faint mono-small">Cues fire by tag on each surface's transport (per-screen) or on SHOW / ROUNDS (together). Import the cue tables from the bundle once.</div>
        </Row>
        <Row t="companion" title="Bitfocus Companion" hint="only needed for live variables (round, names) on your buttons">
          <div className="field"><span>Address</span><input value={get("companion")?.base ?? "http://127.0.0.1:8000"} onChange={(e) => setA("companion", true, { base: e.target.value })} style={{ width: 300 }} /></div>
          <div className="faint mono-small">Companion pages themselves come from the bundle; they call Surface (Bridge) or the engines directly.</div>
        </Row>
        {cfg.every((a) => a.type === "mock") && <div className="dim" style={{ marginTop: 8 }}>Nothing enabled — rehearsal mode. Everything on the board works; cues go to a built-in recorder.</div>}
        <div className="gorow" style={{ marginTop: 12 }}><button className="primary" onClick={save}>Save</button></div>
      </div>
      <div className="panel">
        <h3>What each screen is called in the engine</h3>
        <table><thead><tr><th>Screen group</th><th>Screens</th><th>Resolume</th><th>disguise track</th></tr></thead>
          <tbody>{(doc?.surfaces ?? []).map((s, i) => <tr key={s.id}><td>{s.name}{s.independent && <span className="tag" style={{ marginLeft: 6 }}>independent</span>}</td><td className="mono-small dim">{s.screens.map((id) => { const sc = doc!.screens.find((x) => x.id === id); return sc ? `${sc.id} ${sc.w}×${sc.h}` : id; }).join(", ")}</td><td className="mono-small">{(doc?.build?.resolumeLayout ?? "per-screen") === "together" ? `SHOW layer ${i + 1} · ROUNDS layer ${(doc?.surfaces.length ?? 0) + i + 1}` : `group ${i + 1} · layers ${i * 3 + 1}–${i * 3 + 3}`}</td><td className="mono-small">{(doc?.build?.resolumeLayout ?? "per-screen") === "together" ? "SHOW / ROUNDS" : s.id}</td></tr>)}</tbody></table>
      </div>
    </div>
  );
}
