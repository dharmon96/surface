import { useStore } from "../store";

export function Health() {
  const { health, doc } = useStore();
  return (
    <div className="grid2">
      <div className="panel"><h3>Engines</h3>
        <table><thead><tr><th>Adapter</th><th>State</th><th>Detail</th><th>Latency</th></tr></thead>
          <tbody>{(health?.adapters ?? []).map((a) => <tr key={a.id}><td>{a.id}</td><td><span className={`tag ${a.connected ? "ok" : "bad"}`}>{a.connected ? "connected" : "offline"}</span></td><td className="mono-small dim">{a.detail}{a.lastError ? <div style={{ color: "var(--red)" }}>{a.lastError}</div> : null}</td><td className="num">{a.latencyMs != null ? `${a.latencyMs} ms` : ""}</td></tr>)}</tbody></table>
        <div className="dim mono-small" style={{ marginTop: 8 }}>Adapters come from <code>surface.config.json</code>; with none configured the mock adapter records every op so a show can be rehearsed with no engines attached. Uptime {health?.uptimeSec ?? 0}s.</div>
      </div>
      <div className="panel"><h3>Surfaces ↔ engines</h3>
        <table><thead><tr><th>Surface</th><th>Screens</th><th>Resolume group</th><th>Layers</th><th>disguise transport</th></tr></thead>
          <tbody>{(doc?.surfaces ?? []).map((s, i) => <tr key={s.id}><td>{s.name}{s.independent && <span className="tag" style={{ marginLeft: 6 }}>independent</span>}</td><td className="mono-small dim">{s.screens.map((id) => { const sc = doc!.screens.find((x) => x.id === id); return sc ? `${sc.id} ${sc.w}×${sc.h}` : id; }).join(", ")}</td><td className="num">{i + 1}</td><td className="mono-small">{i * 3 + 1}–{i * 3 + 3}</td><td className="mono-small">{s.id}</td></tr>)}</tbody></table>
      </div>
    </div>
  );
}
