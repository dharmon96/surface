import { useState } from "react";
import { useStore } from "../store";

const rec = (f: any) => `${f.record.w}-${f.record.l}${f.record.d ? "-" + f.record.d : ""} (${f.record.ko} KO)`;

/** The gate: nothing generates until the card is approved. Every parser guess is listed and editable here —
 *  and a card can be built from nothing, bout by bout, for venues/tests with no sheet in hand. */
export function Review() {
  const { doc, approve, saveDoc } = useStore(); const [draft, setDraft] = useState<any>(null);
  if (!doc) return null; const d = draft ?? doc; const bouts = [...d.data.bouts].sort((a: any, b: any) => a.order - b.order);
  const setF = (id: string, k: string, v: any) => setDraft({ ...d, data: { ...d.data, fighters: { ...d.data.fighters, [id]: { ...d.data.fighters[id], [k]: v } } } });
  const setB = (id: string, k: string, v: any) => setDraft({ ...d, data: { ...d.data, bouts: d.data.bouts.map((b: any) => (b.id === id ? { ...b, [k]: v } : b)) } });
  const setE = (k: string, v: any) => setDraft({ ...d, event: { ...d.event, [k]: v } });
  const swap = (id: string) => setDraft({ ...d, data: { ...d.data, bouts: d.data.bouts.map((b: any) => (b.id === id ? { ...b, red: b.blue, blue: b.red } : b)) } });
  const blankFighter = (name: string) => ({ name, nick: null, country: "US", hometown: "", record: { w: 0, l: 0, d: 0, ko: 0 }, weightLbs: null, height: null, flags: [] });
  const addBout = () => {
    const n = d.data.bouts.length + 1; const base = Object.keys(d.data.fighters).length;
    const r = `F${String(base + 1).padStart(2, "0")}`, bl = `F${String(base + 2).padStart(2, "0")}`;
    const fighters = { ...d.data.fighters, [r]: blankFighter(`Red ${n}`), [bl]: blankFighter(`Blue ${n}`) };
    // the newest bout is the main event (cards close with the main); the previous one becomes the co-main
    const others = d.data.bouts.map((x: any) => ({ ...x, isMain: false, isCoMain: false }));
    const list = [...others, { id: `B${String(n).padStart(2, "0")}`, order: n, red: r, blue: bl, rounds: 8, title: null, weightClass: "", female: false, isMain: true, isCoMain: false, broadcast: false, timing: {}, anthems: [] }];
    if (list.length > 1) list[list.length - 2].isCoMain = true;
    setDraft({ ...d, data: { ...d.data, fighters, bouts: list } });
  };
  const removeBout = (id: string) => {
    const list = d.data.bouts.filter((b: any) => b.id !== id).sort((a: any, b: any) => a.order - b.order)
      .map((b: any, i: number) => ({ ...b, order: i + 1, id: `B${String(i + 1).padStart(2, "0")}` }));
    if (list.length && !list.some((b: any) => b.isMain)) list[list.length - 1].isMain = true;
    setDraft({ ...d, data: { ...d.data, bouts: list } });
  };
  const makeMain = (id: string) => {
    const list = d.data.bouts.map((b: any) => ({ ...b, isMain: b.id === id, isCoMain: false }));
    const mi = list.findIndex((b: any) => b.isMain); if (mi > 0) list[mi - 1].isCoMain = true;
    setDraft({ ...d, data: { ...d.data, bouts: list } });
  };
  return (
    <div>
      <div className="grid2" style={{ marginBottom: 14 }}>
        <div className="panel"><h3>Event</h3>
          <div style={{ display: "grid", gap: 6, maxWidth: 420 }}>
            <input value={d.event.name ?? ""} placeholder="Show name" onChange={(e) => setE("name", e.target.value)} />
            <div style={{ display: "flex", gap: 6 }}>
              <input type="date" value={d.event.date ?? ""} onChange={(e) => setE("date", e.target.value)} />
              <input style={{ flex: 1 }} placeholder="Venue" value={d.event.venue ?? ""} onChange={(e) => setE("venue", e.target.value)} />
            </div>
          </div>
          <div className="dim mono-small" style={{ marginTop: 6 }}>walk order {(d.event.walkOrder ?? []).join(" → ")} · source: {d.source?.file ?? "built by hand"}{d.source?.version ? ` · ${d.source.version}` : ""}</div>
        </div>
        <div className="panel"><h3>Review flags ({d.review.flags.length})</h3><ul className="flags mono-small" style={{ margin: 0, paddingLeft: 16, maxHeight: 120, overflow: "auto" }}>{d.review.flags.map((f: string, i: number) => <li key={i}>{f}</li>)}{!d.review.flags.length && <span className="dim">nothing inferred — all facts came from you or the sheet</span>}</ul></div>
      </div>
      <div className="panel">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}><h3 style={{ margin: 0 }}>Card — {bouts.length} bouts</h3><span style={{ marginLeft: "auto" }} /><button onClick={addBout}>Add bout</button></div>
        {!bouts.length && <div className="dim" style={{ margin: "10px 0" }}>No bouts yet. Add them here to build a card by hand, or drop the promoter's sheet on the board.</div>}
        {bouts.length > 0 && <table className="card-edit" style={{ marginTop: 8 }}><thead><tr><th>#</th><th>Red corner</th><th></th><th>Blue corner</th><th>Rds</th><th>Class · title</th><th title="ISO country codes of anthems to play, comma-separated">Anthems</th><th></th></tr></thead>
          <tbody>{bouts.map((b: any) => { const r = d.data.fighters[b.red], bl = d.data.fighters[b.blue];
            const Corner = ({ f, id, tone }: { f: any; id: string; tone: "red" | "blue" }) => (
              <div className={`corner ${tone}`}>
                <div className="line"><input value={f.name} placeholder="Fighter name" onChange={(e) => setF(id, "name", e.target.value)} /><input className="cc" title="Country (ISO code)" value={f.country} onChange={(e) => setF(id, "country", e.target.value.toUpperCase())} /></div>
                <div className="dim mono-small">{[f.nick ? `"${f.nick}"` : "", rec(f), f.hometown].filter(Boolean).join(" · ")}</div>
              </div>);
            return (
            <tr key={b.id}>
              <td className="num"><div className="ord">{b.order}</div><button className="badge" title="Make this the main event (the one before it becomes the co-main)" onClick={() => makeMain(b.id)}>{b.isMain ? <span className="tag gold">main</span> : b.isCoMain ? <span className="tag">co-main</span> : <span className="tag faint">set main</span>}</button></td>
              <td><Corner f={r} id={b.red} tone="red" /></td>
              <td><button title="Swap corners" onClick={() => swap(b.id)}>⇄</button></td>
              <td><Corner f={bl} id={b.blue} tone="blue" /></td>
              <td><input style={{ width: 56 }} type="number" min={1} max={15} value={b.rounds} onChange={(e) => setB(b.id, "rounds", Number(e.target.value))} /></td>
              <td><input style={{ width: 150 }} placeholder="Weight class" value={b.weightClass ?? ""} onChange={(e) => setB(b.id, "weightClass", e.target.value)} /><div className="dim mono-small">{[b.title, b.timing?.walk ? `walk ${b.timing.walk}` : "", b.timing?.firstBell ? `bell ${b.timing.firstBell}` : ""].filter(Boolean).join(" · ")}</div></td>
              <td><input style={{ width: 72 }} placeholder="US,MX" value={(b.anthems ?? []).join(",")} onChange={(e) => setB(b.id, "anthems", e.target.value.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean))} /></td>
              <td><button onClick={() => removeBout(b.id)} title="Remove this bout">×</button></td>
            </tr>); })}</tbody></table>}
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
