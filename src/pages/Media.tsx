import { useState } from "react";
import { useStore } from "../store";

/** Drop → probe → match → plan. Nothing is converted or deleted from this screen yet; it shows what would happen. */
export function Media() {
  const { intake, runIntake, doc, transcode, startTranscode } = useStore(); const [del, setDel] = useState(false);
  const [dir, setDir] = useState(intake?.dir ?? ""); const [direction, setDirection] = useState(""); const [aIs, setAIs] = useState(""); const [engine, setEngine] = useState("resolume"); const [busy, setBusy] = useState(false); const [ocr, setOcr] = useState(true); const [filter, setFilter] = useState<"all" | "low" | "issues">("all");
  const run = async () => { setBusy(true); try { await runIntake(dir, { direction: direction || undefined, aIs: aIs || undefined }, engine, ocr); } finally { setBusy(false); } };
  const rows = (intake?.assignments ?? []).filter((a) => filter === "all" || (filter === "low" && a.confidence < 0.7) || (filter === "issues" && a.issues.length));
  const slots = new Set((intake?.assignments ?? []).map((a) => a.slot)).size; const total = slots + (intake?.unfilled.length ?? 0);
  return (
    <div>
      <div className="panel" style={{ marginBottom: 14 }}>
        <h3>Delivery folder</h3>
        <div className="gorow" style={{ margin: 0 }}>
          <input style={{ flex: 1 }} placeholder="D:\Shows\event\delivery (as the promoter sent it)" value={dir} onChange={(e) => setDir(e.target.value)} />
          {(window as any).surface?.pickFolder && <button onClick={async () => { const p = await (window as any).surface.pickFolder(); if (p) setDir(p); }}>Browse…</button>}
          <select value={direction} onChange={(e) => setDirection(e.target.value)}><option value="">numbering: infer</option><option value="opener-first">1 = opener</option><option value="main-first">1 = main event</option></select>
          <select value={aIs} onChange={(e) => setAIs(e.target.value)}><option value="">a/b: infer</option><option value="red">a = red</option><option value="blue">a = blue</option></select>
          <select value={engine} onChange={(e) => setEngine(e.target.value)}><option value="resolume">Resolume (DXV)</option><option value="disguise">disguise (HAP)</option><option value="generic">generic (H.264)</option></select>
          <label className="dim mono-small" title="Reads the text baked into files the filename can't place (offline, tesseract)"><input type="checkbox" checked={ocr} onChange={(e) => setOcr(e.target.checked)} /> OCR unresolved</label>
          <button className="primary" disabled={!dir || busy} onClick={run}>{busy ? "probing…" : "Probe & match"}</button>
        </div>
        {intake && <div className="dim mono-small" style={{ marginTop: 8 }}>
          {intake.probes} files probed{intake.ocrRan ? ` · ${intake.ocrRan} OCR'd` : ""} · scheme <b>{intake.scheme.direction}</b>, a = <b>{intake.scheme.aIs}</b> (confidence {Number(intake.scheme.confidence).toFixed(2)}) · mapped <b>{slots}/{total}</b> slots · {intake.unmatched.length} unmatched · {intake.ignored.length} ignored · {intake.unfilled.length} still empty
          <ul style={{ margin: "6px 0 0", paddingLeft: 16 }}>{intake.scheme.evidence.slice(0, 5).map((e: string, i: number) => <li key={i}>{e}</li>)}</ul>
        </div>}
      </div>
      {intake && <div className="grid2">
        <div className="panel scroll" style={{ padding: 0 }}>
          <div style={{ padding: "8px 10px", display: "flex", gap: 8, alignItems: "center" }}><h3 style={{ margin: 0 }}>Mapping</h3><span style={{ marginLeft: "auto" }} />
            {(["all", "low", "issues"] as const).map((f) => <button key={f} className={filter === f ? "primary" : ""} onClick={() => setFilter(f)}>{f}</button>)}</div>
          <table><thead><tr><th>Graphic</th><th>File</th><th>Conf</th><th>Why / issues</th></tr></thead>
            <tbody>{rows.slice(0, 400).map((a) => <tr key={a.slot}><td className="mono-small">{a.slot}</td><td className="mono-small">{a.file}{a.update && <span className="tag" style={{ marginLeft: 6 }}>update</span>}</td><td><span className="conf"><i style={{ width: `${a.confidence * 100}%`, background: a.confidence < 0.7 ? "var(--amber)" : "var(--green)" }} /></span></td><td className="mono-small dim">{a.reasons.join("; ")}{a.issues.length ? <div style={{ color: "var(--amber)" }}>{a.issues.join("; ")}</div> : null}</td></tr>)}</tbody></table>
        </div>
        <div>
          <div className="panel" style={{ marginBottom: 14 }}><h3>Unmatched files ({intake.unmatched.length})</h3><div className="scroll" style={{ maxHeight: 240 }}><table><tbody>{intake.unmatched.map((u: any) => <tr key={u.file}><td className="mono-small">{u.file}</td><td className="mono-small dim">{u.why}{u.ocr?.length ? <div className="faint">read: {u.ocr.join(" ")}</div> : null}</td></tr>)}</tbody></table></div></div>
          <div className="panel" style={{ marginBottom: 14 }}><h3>Slots still empty ({intake.unfilled.length}) — the list you send back</h3><div className="scroll mono-small dim" style={{ maxHeight: 200 }}>{intake.unfilled.map((s) => <div key={s}>{s}</div>)}</div></div>
          <div className="panel" style={{ marginBottom: 14 }}><h3>Issues ({intake.issues.length})</h3><ul className="flags mono-small" style={{ margin: 0, paddingLeft: 16, maxHeight: 160, overflow: "auto" }}>{intake.issues.map((i, k) => <li key={k}>{i}</li>)}</ul></div>
          <div className="panel"><h3>Transcode plan ({intake.jobs.length} files → {doc?.event.id}/media)</h3>
            <div className="mono-small dim">{Object.entries(intake.jobs.reduce((o: any, j: any) => ((o[`${j.action}·${j.codec}`] = (o[`${j.action}·${j.codec}`] ?? 0) + 1), o), {})).map(([k, v]) => <span key={k} style={{ marginRight: 12 }}>{k}: {v as number}</span>)}</div>
            <div className="scroll mono-small" style={{ maxHeight: 200, marginTop: 6 }}>{intake.jobs.filter((j: any) => j.notes.length).slice(0, 60).map((j: any) => <div key={j.slot}><span className="dim">{j.slot}</span> — {j.notes.join("; ")}</div>)}</div>
            <div className="gorow">
              <button className="primary" disabled={transcode.running || !intake.jobs.length} onClick={() => startTranscode(del)}>{transcode.running ? "transcoding…" : `Transcode ${intake.jobs.length} files`}</button>
              <label className="dim mono-small"><input type="checkbox" checked={del} onChange={(e) => setDel(e.target.checked)} /> delete originals after each output verifies</label>
            </div>
            {Object.keys(transcode.progress).length > 0 && (() => { const P = Object.values(transcode.progress); const done = P.filter((p) => p.phase === "done" || p.phase === "skipped").length, failed = P.filter((p) => p.phase === "failed").length; return (
              <div className="mono-small" style={{ marginTop: 6 }}>
                <div><span className="conf" style={{ width: 200 }}><i style={{ width: `${(done / Math.max(1, intake.jobs.length)) * 100}%` }} /></span> {done}/{intake.jobs.length} done{failed ? <span style={{ color: "var(--red)" }}> · {failed} failed</span> : null}</div>
                <div className="scroll" style={{ maxHeight: 160 }}>{Object.entries(transcode.progress).filter(([, p]) => p.phase !== "done" && p.phase !== "skipped").slice(0, 12).map(([k, p]) => <div key={k}><span className={p.phase === "failed" ? "" : "dim"} style={p.phase === "failed" ? { color: "var(--red)" } : {}}>{p.phase}{p.pct != null ? ` ${p.pct}%` : ""}</span> {k} <span className="faint">{p.detail}</span></div>)}</div>
              </div>); })()}
          </div>
        </div>
      </div>}
    </div>
  );
}
