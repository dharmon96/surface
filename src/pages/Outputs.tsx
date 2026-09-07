import { useEffect, useState } from "react";
import { useStore } from "../store";
import type { OutputCanvas, ShowDoc } from "../../core/types";

/**
 * Outputs — the canvases the LED processors take, one window per canvas on a chosen display.
 *   A canvas comes from PixelGrid (its processor canvases, screens at their canvas positions) or is one screen at 0,0.
 *   Pick the display, pick how the canvas meets it (1:1 for LED, scale/stretch for a monitor that wants 1920×1080), open.
 *   Identify paints every screen's id and position on the outputs so the processor mapping can be checked in seconds.
 * Only the desktop app can open windows; in a browser this page still edits the canvases.
 */
interface Display { id: number; label: string; x: number; y: number; w: number; h: number; scale: number; primary: boolean }
const FITS: { v: NonNullable<OutputCanvas["fit"]>; label: string; hint: string }[] = [
  { v: "1:1", label: "1:1", hint: "canvas pixels = display pixels, top-left (LED processor)" }, { v: "scale", label: "Fit", hint: "scaled to fit, top-left" },
  { v: "letterbox", label: "Centre", hint: "scaled to fit, centred" }, { v: "stretch", label: "Stretch", hint: "fill the display" },
];
const thumbOf = (doc: ShowDoc, id: string) => { const s = doc.screens.find((x) => x.id === id); return s?.testPattern && doc.mediaRoot ? `/api/thumb?f=${encodeURIComponent(`${doc.mediaRoot}/${s.testPattern}`)}` : null; };

function Canvas({ o, doc }: { o: OutputCanvas; doc: ShowDoc }) {
  const W = 260, k = Math.min(W / o.w, 120 / o.h);
  return (
    <div className="ocanvas" style={{ width: o.w * k, height: o.h * k }} title={`${o.w}×${o.h}`}>
      {o.screens.map((p) => { const s = doc.screens.find((x) => x.id === p.id); const w = (p.w ?? s?.w ?? 0) * k, h = (p.h ?? s?.h ?? 0) * k; const t = thumbOf(doc, p.id);
        return <div key={p.id} className="oscreen" style={{ left: p.x * k, top: p.y * k, width: w, height: h, backgroundImage: t ? `url(${t})` : undefined }}><span>{p.id}</span></div>; })}
    </div>
  );
}

export function Outputs() {
  const { doc, load } = useStore();
  const desktop = (window as any).surface; const [displays, setDisplays] = useState<Display[]>([]); const [open, setOpen] = useState<string[]>([]); const [identify, setIdentify] = useState(false); const [test, setTest] = useState(true);
  const [outputs, setOutputs] = useState<OutputCanvas[] | null>(null); const [auto, setAuto] = useState(false); const [dirty, setDirty] = useState(false); const [edit, setEdit] = useState<string | null>(null);
  const reload = () => fetch("/api/outputs").then((r) => r.json()).then((r) => { setOutputs(r.outputs); setAuto(r.auto); setDirty(false); });
  useEffect(() => { reload(); if (!desktop?.listDisplays) return; desktop.listDisplays().then(setDisplays); desktop.openOutputs().then(setOpen); const off = desktop.onDisplaysChanged?.(setDisplays); return typeof off === "function" ? off : undefined; }, []);
  if (!doc || !outputs) return null;
  const set = (i: number, patch: Partial<OutputCanvas>) => { setOutputs(outputs.map((o, k) => (k === i ? { ...o, ...patch } : o))); setDirty(true); };
  const save = async () => { await fetch("/api/outputs", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ outputs }) }); await reload(); await load(); };
  const signal = (body: any) => fetch("/api/outputs/signal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const openOut = async (o: OutputCanvas) => { const d = displays.find((x) => x.id === o.display?.id) ?? displays.find((x) => !x.primary) ?? displays[0]; if (!d) return; await desktop.openOutput({ id: o.id, displayId: d.id, w: o.w, h: o.h }); setOpen(await desktop.openOutputs()); };
  const closeOut = async (o: OutputCanvas) => { await desktop.closeOutput(o.id); setOpen(await desktop.openOutputs()); };
  const addCanvas = () => { const id = `CANVAS_${outputs.length + 1}`; setOutputs([...outputs, { id, name: `Canvas ${outputs.length + 1}`, w: 3840, h: 1080, fit: "1:1", screens: [] }]); setDirty(true); setEdit(id); };
  const remove = (i: number) => { setOutputs(outputs.filter((_, k) => k !== i)); setDirty(true); };
  return (
    <div className="outputs">
      <p className="dim">{auto ? "One canvas per screen (load the PixelGrid project for the real processor canvases)." : "Canvases from PixelGrid — each one is a processor input; screens sit where PixelGrid put them."}
        {!desktop && " Outputs open as full-screen windows from the desktop app."}</p>
      {desktop && (
        <div className="row" style={{ gap: 12, alignItems: "center", marginBottom: 12 }}>
          <button className={identify ? "primary" : ""} onClick={() => { setIdentify(!identify); signal({ identify: !identify }); }}>{identify ? "Identify on" : "Identify"}</button>
          <label className="dim small"><input type="checkbox" checked={test} onChange={(e) => { setTest(e.target.checked); signal({ test: e.target.checked }); }} /> test patterns when idle</label>
          <span className="dim small" style={{ marginLeft: "auto" }}>{displays.length} display{displays.length === 1 ? "" : "s"}: {displays.map((d) => `${d.label} ${d.w}×${d.h}${d.primary ? " (console)" : ""}`).join(" · ")}</span>
        </div>)}
      <div className="olist">
        {outputs.map((o, i) => { const isOpen = open.includes(o.id); const d = displays.find((x) => x.id === o.display?.id); const exact = d && d.w === o.w && d.h === o.h;
          return (
            <div key={o.id} className={`ocard ${isOpen ? "live" : ""}`}>
              <Canvas o={o} doc={doc} />
              <div className="ometa">
                <div className="row" style={{ alignItems: "baseline", gap: 8 }}><b>{o.name}</b><span className="dim small">{o.w}×{o.h}{o.pixelMapper?.processor ? ` · ${o.pixelMapper.processor}` : ""}</span>{isOpen && <span className="tag ok">live</span>}</div>
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  {desktop ? <select value={o.display?.id ?? ""} onChange={(e) => { const dd = displays.find((x) => x.id === Number(e.target.value)); set(i, { display: dd ? { id: dd.id, label: dd.label, w: dd.w, h: dd.h } : undefined }); }}>
                    <option value="">display…</option>{displays.map((dd) => <option key={dd.id} value={dd.id}>{dd.label} · {dd.w}×{dd.h}{dd.primary ? " (console)" : ""}</option>)}</select>
                    : <span className="dim small">{o.display?.label ?? "no display"}</span>}
                  <div className="seg">{FITS.map((f) => <button key={f.v} className={(o.fit ?? "1:1") === f.v ? "on" : ""} title={f.hint} onClick={() => set(i, { fit: f.v })}>{f.label}</button>)}</div>
                  {d && !exact && (o.fit ?? "1:1") === "1:1" && <span className="tag warn" title="the display is not the canvas size: at 1:1 the canvas is cropped or leaves black — pick Fit or Stretch if that is not what the processor expects">{d.w}×{d.h} ≠ canvas</span>}
                </div>
                <div className="row" style={{ gap: 8 }}>
                  {desktop && (isOpen ? <button onClick={() => closeOut(o)}>Close output</button> : <button className="primary" disabled={!displays.length} onClick={() => openOut(o)}>Open on display</button>)}
                  <button onClick={() => setEdit(edit === o.id ? null : o.id)}>{edit === o.id ? "Done" : "Edit layout"}</button>
                  <button className="danger" onClick={() => remove(i)}>Remove</button>
                </div>
                {edit === o.id && (
                  <table className="olayout"><thead><tr><th>screen</th><th>x</th><th>y</th><th>w</th><th>h</th><th></th></tr></thead><tbody>
                    <tr><td><i>canvas</i></td><td></td><td></td><td><input type="number" value={o.w} onChange={(e) => set(i, { w: Number(e.target.value) })} /></td><td><input type="number" value={o.h} onChange={(e) => set(i, { h: Number(e.target.value) })} /></td><td></td></tr>
                    {o.screens.map((p, k) => { const s = doc.screens.find((x) => x.id === p.id); const up = (patch: Partial<typeof p>) => set(i, { screens: o.screens.map((x, j) => (j === k ? { ...x, ...patch } : x)) });
                      return <tr key={p.id}><td>{p.id} <span className="dim small">{s ? `${s.w}×${s.h}` : "unknown"}</span></td><td><input type="number" value={p.x} onChange={(e) => up({ x: Number(e.target.value) })} /></td><td><input type="number" value={p.y} onChange={(e) => up({ y: Number(e.target.value) })} /></td>
                        <td><input type="number" value={p.w ?? s?.w ?? 0} onChange={(e) => up({ w: Number(e.target.value) })} /></td><td><input type="number" value={p.h ?? s?.h ?? 0} onChange={(e) => up({ h: Number(e.target.value) })} /></td>
                        <td><button onClick={() => set(i, { screens: o.screens.filter((_, j) => j !== k) })}>×</button></td></tr>; })}
                    <tr><td colSpan={6}><select value="" onChange={(e) => { const s = doc.screens.find((x) => x.id === e.target.value); if (s) set(i, { screens: [...o.screens, { id: s.id, x: 0, y: 0, w: s.w, h: s.h }] }); }}>
                      <option value="">add a screen…</option>{doc.screens.filter((s) => !o.screens.some((p) => p.id === s.id)).map((s) => <option key={s.id} value={s.id}>{s.id} · {s.w}×{s.h}</option>)}</select></td></tr>
                  </tbody></table>)}
              </div>
            </div>);
        })}
      </div>
      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <button onClick={addCanvas}>Add canvas</button>
        {dirty && <><button className="primary" onClick={save}>Save outputs</button><button onClick={reload}>Discard</button></>}
      </div>
    </div>
  );
}
