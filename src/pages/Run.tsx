import { useStore } from "../store";

/** GO panel: what is on every surface right now, current / next, and the three keys that matter. */
export function Run() {
  const { doc, cues, state, go, next, prev, panic, log } = useStore(); if (!doc || !state) return null;
  const cur = cues.find((c) => c.n === state.current); const nx = cues.find((c) => c.n === state.next);
  const b = doc.data.bouts?.find((x: any) => x.id === state.bout);
  return (
    <div>
      <div className="gorow">
        <div className="panel" style={{ flex: 1 }}><div className="dim mono-small">NOW</div><div className="big">{cur ? `${String(cur.n).padStart(3, "0")} ${cur.name}` : "—"}</div>{b && <div className="dim">Bout {b.order} · <span style={{ color: "var(--red)" }}>{doc.data.fighters[b.red].name}</span> v <span style={{ color: "var(--blue)" }}>{doc.data.fighters[b.blue].name}</span>{state.round ? ` · round ${state.round}` : ""}</div>}</div>
        <div className="panel" style={{ flex: 1 }}><div className="dim mono-small">NEXT</div><div className="big" style={{ color: "var(--muted)" }}>{nx ? `${String(nx.n).padStart(3, "0")} ${nx.name}` : "—"}</div><div className="dim">{nx?.trigger}</div></div>
        <button onClick={prev}>◀ BACK</button>
        <button className="go" onClick={next}>GO</button>
        <button className="danger" onClick={panic}>PANIC</button>
      </div>
      <div className="surfaces" style={{ marginBottom: 14 }}>
        {doc.surfaces.map((s) => { const S = state.surfaces[s.id]; return (
          <div className="surface" key={s.id}><h4>{s.name} {s.independent && <span className="tag">independent</span>}</h4>
            {(["FULL", "OVERLAY", "BASE"] as const).map((l) => <div key={l} className="slot"><span className={`layer ${S?.[l].slot ? l : "empty"}`}>{l}</span>{S?.[l].slot ?? <span className="faint">—</span>}</div>)}
          </div>); })}
      </div>
      <div className="grid2">
        <div className="panel scroll" style={{ padding: 0, maxHeight: "40vh" }}>
          <table><thead><tr><th>#</th><th>Cue</th><th>Scope</th><th></th></tr></thead>
            <tbody>{cues.map((c) => <tr key={c.n} className={c.n === state.current ? "row-current" : c.n === state.next ? "row-next" : ""}><td className="num">{String(c.n).padStart(3, "0")}</td><td>{c.name}</td><td className="mono-small dim">{c.scope.join(",")}</td><td><button onClick={() => go(c.n)}>GO</button></td></tr>)}</tbody></table>
        </div>
        <div className="panel scroll mono-small" style={{ maxHeight: "40vh" }}><h3>Log</h3>{log.map((l, i) => <div key={i} className={l.includes("✗") ? "" : "dim"} style={l.includes("✗") ? { color: "var(--red)" } : {}}>{l}</div>)}</div>
      </div>
    </div>
  );
}
