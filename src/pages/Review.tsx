import { useState } from "react";
import { useStore } from "../store";

const rec = (f: any) => `${f.record.w}-${f.record.l}${f.record.d ? "-" + f.record.d : ""} (${f.record.ko} KO)`;

/** The gate: nothing generates until the card is approved. Every parser guess is listed and editable here. */
export function Review() {
  const { doc, approve, saveDoc } = useStore(); const [draft, setDraft] = useState<any>(null);
  if (!doc) return null; const d = draft ?? doc; const bouts = [...d.data.bouts].sort((a: any, b: any) => a.order - b.order);
  const setF = (id: string, k: string, v: any) => setDraft({ ...d, data: { ...d.data, fighters: { ...d.data.fighters, [id]: { ...d.data.fighters[id], [k]: v } } } });
  const setB = (id: string, k: string, v: any) => setDraft({ ...d, data: { ...d.data, bouts: d.data.bouts.map((b: any) => (b.id === id ? { ...b, [k]: v } : b)) } });
  const swap = (id: string) => setDraft({ ...d, data: { ...d.data, bouts: d.data.bouts.map((b: any) => (b.id === id ? { ...b, red: b.blue, blue: b.red } : b)) } });
  return (
    <div>
      <div className="grid2" style={{ marginBottom: 14 }}>
        <div className="panel"><h3>Event</h3>
          <div>{d.event.name}</div><div className="dim">{d.event.venue}{d.event.city ? `, ${d.event.city}` : ""} · {d.event.date ?? "date?"} · doors {d.event.doors ?? "—"} · walk order {(d.event.walkOrder ?? []).join(" → ")}</div>
          <div className="dim">source: {d.source?.file ?? "manual"} ({d.source?.kind}) {d.source?.version ? `· ${d.source.version}` : ""}</div>
        </div>
        <div className="panel"><h3>Review flags ({d.review.flags.length})</h3><ul className="flags mono-small" style={{ margin: 0, paddingLeft: 16 }}>{d.review.flags.map((f: string, i: number) => <li key={i}>{f}</li>)}</ul></div>
      </div>
      <div className="panel">
        <h3>Card — {bouts.length} bouts</h3>
        <table><thead><tr><th>#</th><th>Rds</th><th>Class / title</th><th>RED</th><th>Record</th><th>Ctry</th><th></th><th>BLUE</th><th>Record</th><th>Ctry</th><th>Walk</th><th>1st bell</th><th>Anthems</th></tr></thead>
          <tbody>{bouts.map((b: any) => { const r = d.data.fighters[b.red], bl = d.data.fighters[b.blue]; return (
            <tr key={b.id}>
              <td className="num">{b.order}{b.isMain ? <span className="tag gold" style={{ marginLeft: 6 }}>main</span> : b.isCoMain ? <span className="tag" style={{ marginLeft: 6 }}>co-main</span> : null}</td>
              <td><input style={{ width: 56 }} type="number" value={b.rounds} onChange={(e) => setB(b.id, "rounds", Number(e.target.value))} /></td>
              <td><div>{b.weightClass}</div><div className="dim mono-small">{b.title ?? ""}</div></td>
              <td><input value={r.name} onChange={(e) => setF(b.red, "name", e.target.value)} /><div className="dim mono-small">{r.nick ? `"${r.nick}" · ` : ""}{r.hometown}</div></td>
              <td className="mono-small">{rec(r)}</td><td><input style={{ width: 36 }} value={r.country} onChange={(e) => setF(b.red, "country", e.target.value.toUpperCase())} /></td>
              <td><button title="swap corners" onClick={() => swap(b.id)}>⇄</button></td>
              <td><input value={bl.name} onChange={(e) => setF(b.blue, "name", e.target.value)} /><div className="dim mono-small">{bl.nick ? `"${bl.nick}" · ` : ""}{bl.hometown}</div></td>
              <td className="mono-small">{rec(bl)}</td><td><input style={{ width: 36 }} value={bl.country} onChange={(e) => setF(b.blue, "country", e.target.value.toUpperCase())} /></td>
              <td className="mono-small">{b.timing?.walk ?? "—"}</td><td className="mono-small">{b.timing?.firstBell ?? "—"}</td>
              <td><input style={{ width: 70 }} value={(b.anthems ?? []).join(",")} onChange={(e) => setB(b.id, "anthems", e.target.value.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean))} /></td>
            </tr>); })}</tbody></table>
        <div className="gorow" style={{ marginTop: 12 }}>
          <button disabled={!draft} onClick={() => saveDoc(d).then(() => setDraft(null))}>Save changes</button>
          <button disabled={!!draft} className="primary" onClick={approve}>Approve card → generate</button>
          {draft && <span className="dim">unsaved edits — save first, then approve</span>}
          {doc.review.status === "approved" && !draft && <span className="tag ok">approved</span>}
        </div>
      </div>
    </div>
  );
}
