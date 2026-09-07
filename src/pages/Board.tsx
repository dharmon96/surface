import { useEffect, useRef, useState } from "react";
import { useStore, type BoardCell, type BoardRow, type BoardSlot } from "../store";
import { Venue } from "./Venue";

/**
 * The Card Board — the whole show on one screen.
 * Prepare: drop the promoter's folder, watch the cells fill in, see what's missing, build the engine.
 * Run: the same grid; every cell is a GO button; the live bout row is highlighted.
 */
const desktop = () => (window as any).surface;
const pathOf = (f: File): string | null => desktop()?.getPath?.(f) ?? (f as any).path ?? null;
/** Boxing reads surnames: "Hector Beltran Jr." → "Beltran Jr.", "Jesse 'Bam' Rodriguez" → "Rodriguez" */
const surname = (n?: string) => { if (!n) return ""; const t = n.replace(/["'“”‘’].*?["'“”‘’]/g, "").trim().split(/\s+/); const suffix = /^(jr|sr|ii|iii|iv)\.?$/i.test(t[t.length - 1]) ? " " + t.pop() : ""; return (t[t.length - 1] ?? n) + suffix; };

function ScreenDots({ slots, screens }: { slots: BoardSlot[]; screens: string[] }) {
  return <span className="scr">{screens.map((id) => { const s = slots.find((x) => x.screen === id); return <i key={id} className={!s ? "n" : s.status === "ready" ? "" : s.status === "convert" ? "w" : "x"} title={`${id}${s ? ` — ${s.status}${s.note ? `: ${s.note}` : ""}` : " — not on this screen"}`} />; })}</span>;
}

function Cell({ cell, row, screens, tone, onFire, live }: { cell: BoardCell; row: string; screens: string[]; tone: string; onFire?: (n: number) => void; live?: boolean }) {
  const { mode, selected, select } = useStore(); const run = mode === "run";
  const isSel = !run && selected?.row === row && selected.cellKey === cell.key;
  const click = () => { if (run) { if (cell.cues[0]) onFire?.(cell.cues[0].n); } else select(isSel ? null : { row, cellKey: cell.key }); };
  const missing = cell.status === "missing" && !cell.slots.some((s) => s.thumb);
  const dur = cell.behaviour === "loop" ? "loop" : cell.behaviour === "playHold" ? "play·hold" : cell.behaviour === "timed" ? "timed" : cell.behaviour ?? "";
  return (
    <div className={`cell ${cell.status}${missing ? " miss" : ""}${live ? " on" : ""}${isSel ? " sel" : ""}`} onClick={click} title={run ? `GO ${cell.cues[0]?.id ?? ""}` : cell.label} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") click(); }}>
      {cell.thumb && !missing ? <div className="thumb img" style={{ backgroundImage: `url(${cell.thumb})` }} /> : <div className={`thumb ${tone}`}>{missing ? "not delivered" : cell.label}</div>}
      <div className="foot"><span>{missing ? cell.label : dur}</span><ScreenDots slots={cell.slots} screens={screens} /></div>
    </div>
  );
}

/** The one place details live: whatever cell is selected, in the rail. Click the cell again (or Esc) to clear it. */
function Selected() {
  const { selected, select, board } = useStore(); if (!selected || !board) return null;
  const row = board.rows.find((r) => r.id === selected.row);
  const c = row ? Object.values(row.cells).find((x) => x.key === selected.cellKey) : undefined;
  if (!c) return null;
  return (
    <div className="selpanel">
      <h4>{row?.kind === "bout" ? `Bout ${row.order} · ${row.title}` : "Event"} <button className="x" onClick={() => select(null)} title="Clear (Esc)">×</button></h4>
      <div className="sel-title">{c.label} <span className="dim">{c.cues.map((x) => x.id).join(", ")}</span></div>
      {c.slots.map((s) => <div key={s.slot} className={`slot ${s.status}`}><span className="k">{s.screen} <span className="dim">{s.w}×{s.h}</span></span><span className="v">{s.status === "missing" ? "missing" : s.file ?? s.out}</span>{s.note && <span className="dim n">{s.note}</span>}</div>)}
      {c.cues.length > 1 && <div className="dim" style={{ marginTop: 6, fontSize: 12 }}>{c.cues.length} cues: {c.cues.map((x) => x.name).join(" · ")}</div>}
    </div>
  );
}

function Rounds({ row, screens, onFire, liveRound }: { row: BoardRow; screens: string[]; onFire: (n: number) => void; liveRound?: number }) {
  const { mode } = useStore();
  return <div className="rounds">{(row.rounds ?? []).map((r) => <i key={r.n} className={`${r.status === "missing" ? "x" : r.status === "convert" ? "w" : "ok"}${liveRound === r.n ? " on" : ""}`} title={`Round ${r.n} — ${r.slots.map((s) => `${s.screen}: ${s.status}`).join(", ")}`} onClick={() => mode === "run" && onFire(r.cue)}>{r.n}</i>)}
    {row.rounds?.some((r) => r.status !== "ready") && <div className="rnote">{[...new Set(row.rounds.flatMap((r) => r.slots.filter((s) => s.status !== "ready").map((s) => `${s.screen.toLowerCase()}: ${s.status === "missing" ? "none delivered" : "will convert"}`)))].join(" · ")}</div>}
  </div>;
}

/** The rail's first panel in Prepare: what's done, what's next — every line is a button to the thing that fixes it. */
function Checklist() {
  const { board, doc, health, versions, setDrawer, hub } = useStore(); if (!board || !doc) return null;
  const bouts = doc.data.bouts?.length ?? 0; const placeholders = /placeholder/i.test(doc.review.flags.join(" ")); const toConfirm = doc.review.flags.filter((f) => !/placeholder|no bouts yet/i.test(f)).length;
  const engines = (health?.adapters ?? []).filter((a) => a.id !== "mock"); const resolume = engines.find((a) => a.id === "resolume");
  const built = (doc as any).built?.resolume as string | undefined;
  const steps: { done: boolean; text: string; action?: string; go?: () => void; soft?: boolean }[] = [
    { done: bouts > 0, text: bouts ? `Card: ${bouts} bouts${versions.length ? ` (sheet v${versions.length})` : ""}` : "Drop the bout sheet or timing sheet" },
    { done: !placeholders, text: placeholders ? "Screens are placeholders — load the venue" : `Screens: ${doc.screens.length} from ${doc.screens.some((s) => s.venue?.source?.startsWith("pixelgrid")) ? "PixelGrid" : "the map"}`, action: placeholders ? (hub?.signedIn ? "Load from PixelGrid" : "Load screens") : "Edit", go: () => setDrawer("Screens") },
    { done: !!board.delivery && board.totals.missing === 0, soft: !!board.delivery, text: !board.delivery ? "Drop the promoter's graphics folder" : board.totals.missing ? `Graphics: ${board.totals.ready} ready · ${board.totals.missing} missing` : `Graphics: all ${board.totals.ready} ready` },
    { done: toConfirm === 0, text: toConfirm ? `${toConfirm} thing${toConfirm > 1 ? "s" : ""} the sheet parser guessed` : "Card details confirmed", action: toConfirm ? "Confirm" : undefined, go: () => setDrawer("Card") },
    { done: !!resolume?.connected, text: resolume ? (resolume.connected ? "Resolume connected" : "Resolume not answering") : engines.length ? `${engines.map((e) => e.id).join(", ")} ${engines.every((e) => e.connected) ? "connected" : "offline"}` : "No engine yet — rehearsal mode", action: resolume?.connected ? undefined : "Connect", go: () => setDrawer("Engines") },
    { done: !!built, text: built ? `Resolume built ${new Date(built).toLocaleTimeString([], { timeStyle: "short" })}` : "Build Resolume when the graphics are in", soft: true },
  ];
  const next = steps.find((x) => !x.done);
  return (
    <div className="checklist"><h4>Show day checklist</h4>
      {steps.map((x, i) => <div key={i} className={`step ${x.done ? "done" : x === next ? "next" : ""} ${x.soft && !x.done ? "soft" : ""}`}><i /><span>{x.text}</span>{x.action && x.go && <button className="x" onClick={x.go}>{x.action}</button>}</div>)}
    </div>
  );
}

export function Board() {
  const { board, doc, state, mode, prepare, transcode, versions, build, runPrepare, dropSheet, buildResolume, requestText, go, health } = useStore();
  const [dir, setDir] = useState(""); const [del, setDel] = useState(false); const [venue, setVenue] = useState<"off" | "side" | "big">((localStorage.getItem("surface.venueMode") as any) || "side");
  useEffect(() => { localStorage.setItem("surface.venueMode", venue); }, [venue]); const [toast, setToast] = useState<string | null>(null); const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null); const liveRef = useRef<HTMLTableRowElement>(null);
  useEffect(() => { liveRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }); }, [state?.bout]);
  useEffect(() => { if (board?.delivery?.dir && !dir) setDir(board.delivery.dir); }, [board?.delivery?.dir]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 6000); return () => clearTimeout(t); }, [toast]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !useStore.getState().drawer) useStore.getState().select(null); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, []);
  const say = (m: string) => setToast(m);
  if (!board || !doc) return <div className="dim" style={{ padding: 20 }}>Loading the card…</div>;
  const screens = board.screens.map((s) => s.id);
  const run = mode === "run";
  const liveRow = state?.bout ?? null; const liveRound = state?.round ?? undefined;
  const nextRow = liveRow ? board.rows[board.rows.findIndex((r) => r.id === liveRow) + 1]?.id ?? null : null;
  const P = Object.values(transcode.progress); const done = P.filter((p) => p.phase === "done" || p.phase === "skipped").length; const failed = P.filter((p) => p.phase === "failed").length; const jobs = Math.max(done + failed, board.totals.convert + board.totals.ready);
  const busy = transcode.running || (prepare && prepare.phase !== "done" && prepare.phase !== "failed");

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false); const all = Array.from(e.dataTransfer.files); const f = all[0]; if (!f) return;
    // a handful of PNGs = PixelGrid screen maps (one per screen): they become the screens and their test patterns
    if (all.length && all.every((x) => /\.(png|jpe?g|webp)$/i.test(x.name))) { const paths = all.map(pathOf).filter(Boolean) as string[]; if (!paths.length) return say("Drag the PNGs from Explorer in the desktop app, or use Screens → Import screen maps"); say(await useStore.getState().importScreenMaps({ files: paths })); return; }
    if (/\.(pdf|txt)$/i.test(f.name)) { try { const text = /\.pdf$/i.test(f.name) ? (await desktop()?.readSheetPath?.(pathOf(f)))?.text : await f.text(); if (!text) return say("Could not read that sheet (PDFs need the desktop app)"); const diff = await dropSheet(text, f.name); say(diff.length ? `Sheet merged: ${diff.slice(0, 4).join(" · ")}${diff.length > 4 ? ` (+${diff.length - 4})` : ""}` : "Sheet merged — no changes"); } catch (err: any) { say(`Sheet failed: ${err.message}`); } return; }
    const p = pathOf(f); if (!p) return say("Drag the folder from Explorer in the desktop app, or paste its path");
    setDir(p); runPrepare(p, del);
  };
  const pickFolder = async () => { const p = await desktop()?.pickFolder?.(); if (p) { setDir(p); runPrepare(p, del); } };
  const dropSheetBtn = async () => { if (desktop()?.readSheet) { const r = await desktop().readSheet(); if (!r) return; if (r.error) return say(r.error); const diff = await dropSheet(r.text, r.file); say(diff.length ? `Sheet merged: ${diff.slice(0, 4).join(" · ")}` : "Sheet merged — no changes"); } else fileRef.current?.click(); };
  const copyRequest = async () => { const t = await requestText(); try { await navigator.clipboard.writeText(t); say("Request copied — paste it into the email to the promoter"); } catch { window.prompt("Copy this:", t); } };
  const resolumeOnline = health?.adapters.some((a) => a.id === "resolume" && a.connected);
  if (!(doc.data.bouts?.length)) return (
    <div className={`board start ${dragging ? "over" : ""}`} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
      {toast && <div className="toast" onClick={() => setToast(null)}>{toast}</div>}
      <div className="startcard">
        <h2>Drop the bout sheet here</h2>
        <p>The promoter's timing sheet or bout sheet (PDF). The card fills in — fighters, corners, rounds, titles — and every graphic the show needs appears on the board: walkouts, fight base, rounds, winners. Then drop the graphics folder on the same window.</p>
        <div className="gorow"><button className="btn primary" onClick={dropSheetBtn}>Choose a sheet…</button><button className="btn" onClick={() => useStore.getState().setDrawer("Screens")}>Load the venue's screens first</button><button className="btn" onClick={() => useStore.getState().loadSample()}>Try the sample card</button></div>
        <input ref={fileRef} type="file" accept=".txt,.pdf" style={{ display: "none" }} onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; const diff = await dropSheet(await f.text(), f.name); say(diff.length ? `Sheet loaded` : "Sheet loaded"); }} />
        <p className="dim small">Already have a project? Click the show name at the top.</p>
      </div>
    </div>);

  return (
    <div className={`board ${run ? "run" : ""}`} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
      {toast && <div className="toast" onClick={() => setToast(null)}>{toast}</div>}
      {!run && <div className="strip">
        <div className={`drop ${dragging ? "over" : ""} ${board.delivery ? "" : "empty"}`}>
          {busy ? <>
            <span className="prog"><i style={{ width: transcode.running ? `${(done / Math.max(1, jobs)) * 100}%` : "8%" }} /></span>
            <span className="num">{prepare?.phase === "probing" ? `reading ${board.delivery?.files ?? ""} files…` : `${done}/${jobs} converted${failed ? ` · ${failed} failed` : ""}`}</span>
          </> : board.delivery ? <>
            <span className="num"><b>{board.delivery.files} files</b> · {board.totals.ready} ready · {board.totals.convert} to convert · {board.totals.missing} missing{board.totals.unmatched ? ` · ${board.totals.unmatched} unplaced` : ""}</span>
            <button className="btn" onClick={() => runPrepare(dir, del)} title={dir}>Check the folder again</button>
          </> : <>
            <span className="num"><b>Drop the promoter's graphics folder here</b> — it is read, matched to the card and converted in one go.</span>
            {desktop() ? <button className="btn" onClick={pickFolder}>Choose folder…</button> : <input className="path" placeholder="or paste the folder path and press Enter" value={dir} onChange={(e) => setDir(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && dir) runPrepare(dir, del); }} />}
          </>}
          <label className="dim small" title="Each original is deleted only after its converted copy has been verified"><input type="checkbox" checked={del} onChange={(e) => setDel(e.target.checked)} /> delete originals once converted</label>
        </div>
        <div className="stack">
          <button className="btn" onClick={copyRequest} disabled={!board.missing.length} title="The missing list, in the promoter's words, on your clipboard">Copy request to promoter{board.missing.filter((m) => m.kind === "missing").length ? ` (${board.missing.filter((m) => m.kind === "missing").length})` : ""}</button>
          <button className="btn primary" onClick={async () => say(await buildResolume())} disabled={!!build || !resolumeOnline} title={resolumeOnline ? "Create the layer groups, columns and clips in the running Arena" : "Connect Resolume first (Setup → Engines)"}>{build ? `building… ${build.done}/${build.total}` : "Build Resolume"}</button>
        </div>
      </div>}
      {run && <div className="runbar">
        <div className="big">{liveRow ? `${liveRow} · ${board.rows.find((r) => r.id === liveRow)?.title ?? ""}` : "Pre-show"}<small>{liveRound ? `round ${liveRound}` : ""}{state?.current ? ` · cue ${state.current}` : ""}</small></div>
        <span>next: <b>{state?.next ?? "—"}</b></span><kbd>Space</kbd> GO · <kbd>Backspace</kbd> back · <kbd>Esc</kbd> panic
        {(() => { const evt = board.rows.find((r) => r.kind === "event"); return evt?.cells.TEST?.cues[0] && <button className="btn" onClick={() => go(evt.cells.TEST.cues[0].n)} title="Every screen's own test pattern — the line-up you can always go back to">Test patterns</button>; })()}
        <button className={`btn ${venue !== "off" ? "on" : ""}`} onClick={() => setVenue(venue === "off" ? "side" : venue === "side" ? "big" : "off")} title="See what the walls are showing, on the LED map (plan or 3D)">{venue === "off" ? "Venue" : venue === "side" ? "Venue · bigger" : "Venue · hide"}</button>
        <button className="btn" onClick={() => { if (desktop()?.openClock) desktop().openClock(); else window.open("/clock.html", "surface-clock", "width=560,height=320"); }} title="Remaining time of whatever video is playing (VTs, walkouts, the fight open) — its own window; share http://<this PC>:8090/clock.html on the venue network (server started with --bind 0.0.0.0)">Clip clock</button>
        <button className="gobtn" onClick={() => useStore.getState().next()}>GO</button><button className="panic" onClick={() => useStore.getState().panic()}>PANIC</button>
      </div>}

      <div className={`wrap ${run && venue !== "off" ? `venue-${venue}` : ""}`}>
        {run && venue === "big" && <div className="venuecol"><Venue big /></div>}
        <div className="boardwrap">
          <table className="grid">
            <thead><tr><th className="bout">Card <span className="n">{board.rows.length - 1} bouts · running order</span></th>{board.columns.map((c) => <th key={c.key}>{c.label} {c.sub && <span className="n">{c.sub}</span>}</th>)}</tr></thead>
            <tbody>
              {board.rows.map((r) => r.kind === "event" ? (
                <tr key={r.id} className="evt"><td className="bout"><span className="ord">EVENT</span><div className="names">{r.title}</div><div className="meta">{Object.keys(r.cells).length} items</div></td>
                  <td colSpan={board.columns.length}><div className="stack">{Object.values(r.cells).map((c) => <Cell key={c.key} cell={c} row={r.id} screens={screens} tone={c.key === "FLAGS" ? "t-flag" : c.key === "VTS" ? "t-vt" : c.key === "TEST" ? "t-test" : "t-hold"} onFire={go} />)}</div></td></tr>
              ) : (
                <tr key={r.id} className={liveRow === r.id ? "live" : run && liveRow && nextRow === r.id ? "next" : run && liveRow ? "rest" : ""} ref={liveRow === r.id ? liveRef : undefined}>
                  <td className="bout"><span className="ord">{String(r.order).padStart(2, "0")}{r.meta.isMain ? " · MAIN" : r.meta.isCoMain ? " · CO-MAIN" : ""}</span>
                    <div className="names" title={r.title}><span className="r">{surname(r.red?.name)}</span><span className="v">v</span><span className="b">{surname(r.blue?.name)}</span></div>
                    <div className="full">{r.red?.name} · {r.blue?.name}</div>
                    <div className="meta">{r.meta.title && <b>{r.meta.title} · </b>}{r.meta.rounds} rds{r.meta.weightClass ? ` · ${r.meta.weightClass}` : ""}{r.red?.country && r.blue?.country ? ` · ${r.red.country} v ${r.blue.country}` : ""}</div>
                    {r.flags.slice(0, 2).map((f, i) => <span key={i} className="flag" title={f}>{f.replace(/^Bout \d+: /, "")}</span>)}</td>
                  {board.columns.some((c) => c.key === "OPEN") && <td>{r.cells.OPEN ? <Cell cell={r.cells.OPEN} row={r.id} screens={screens} tone="t-vt" onFire={go} live={liveRow === r.id && state?.current === r.cells.OPEN.cues[0]?.n} /> : <div className="dim" style={{ textAlign: "center", padding: "18px 0" }}>—</div>}</td>}
                  <td><Cell cell={r.cells.WALK_RED} row={r.id} screens={screens} tone="t-r" onFire={go} live={liveRow === r.id && state?.current === r.cells.WALK_RED.cues[0]?.n} /></td>
                  <td><Cell cell={r.cells.WALK_BLUE} row={r.id} screens={screens} tone="t-b" onFire={go} live={liveRow === r.id && state?.current === r.cells.WALK_BLUE.cues[0]?.n} /></td>
                  <td><Cell cell={r.cells.TALE} row={r.id} screens={screens} tone="t-vs" onFire={go} live={liveRow === r.id && state?.current === r.cells.TALE.cues[0]?.n} /></td>
                  <td><Cell cell={r.cells.UP_NEXT} row={r.id} screens={screens} tone="t-next" onFire={go} /></td>
                  <td><Rounds row={r} screens={screens} onFire={go} liveRound={liveRow === r.id ? liveRound : undefined} /></td>
                  <td>{run ? <div className="wins">{r.cells.WINNER.cues.map((c) => <button key={c.id} className={`btn ${/RED/.test(c.id) ? "wr" : /BLUE/.test(c.id) ? "wb" : ""}`} onClick={() => go(c.n)}>{/RED/.test(c.id) ? r.red?.name : /BLUE/.test(c.id) ? r.blue?.name : "Draw"}</button>)}</div> : <Cell cell={r.cells.WINNER} row={r.id} screens={screens} tone="t-win" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {run && venue === "side" && <div className="venuecol"><Venue /></div>}
        {!(run && venue !== "off") && <aside className="rail">
          {!run && <Selected />}
          {!run && <Checklist />}
          <div><h4>Screens{doc.screens.length && /placeholder/i.test(doc.review.flags.join(" ")) ? " · placeholders" : ""} <button className="x" onClick={() => useStore.getState().setDrawer("Screens")} title="Screens, groups and routing">Edit</button></h4>
            {board.screens.map((s) => <div key={s.id} className="screen"><span className="id">{s.id}</span><span className={`cov ${s.total && s.ready === s.total ? "ok" : s.ready ? "w" : ""}`}>{s.ready}/{s.total}</span><span className="sz">{s.w}×{s.h}{s.name !== s.id ? ` · ${s.name}` : ""}</span><span className="bar"><i style={{ width: `${s.total ? (s.ready / s.total) * 100 : 0}%`, background: s.ready === s.total ? "var(--ok)" : "var(--warn)" }} /></span></div>)}
          </div>
          <div><h4>Missing · {board.missing.filter((m) => m.kind === "missing").length}</h4>
            <div className="misslist">{board.missing.slice(0, 14).map((m, i) => <div key={i}><span className={`k ${m.kind === "convert" ? "w" : ""}`}>{m.row}</span><span>{m.label}{m.kind === "missing" ? ` — ${m.screens.join(", ")}` : ""}</span></div>)}{board.missing.length > 14 && <div className="dim">+{board.missing.length - 14} more</div>}{!board.missing.length && <div className="dim">{board.delivery ? "Everything the card needs is here." : "Drop the delivery to find out."}</div>}</div>
          </div>
          <div><h4>Sheet</h4>
            <div className="ver">{versions.length ? [...versions].reverse().slice(0, 3).map((v, i) => <span key={i}>{i === 0 ? <b>v{versions.length}</b> : `v${versions.length - i}`} · {new Date(v.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })} {i === 0 && v.diff.length > 0 && v.diff[0] !== "first sheet" && <span className="diff">{v.diff.slice(0, 3).join(" · ")}</span>}</span>) : <span>{doc.source?.file ?? "no sheet yet"}</span>}
              <button className="btn" style={{ alignSelf: "flex-start" }} onClick={dropSheetBtn}>Drop a new sheet</button><input ref={fileRef} type="file" accept=".txt,.pdf" style={{ display: "none" }} onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; const diff = await dropSheet(await f.text(), f.name); say(diff.length ? `Sheet merged: ${diff.slice(0, 4).join(" · ")}` : "Sheet merged — no changes"); }} />
            </div>
          </div>
          <div className="build"><h4>Build</h4>
            <div className="seg" title="How the composition is laid out. Per screen: a layer group per screen, a cue fires only the groups it touches (Companion presses each). Together: one SHOW group where every column fires everything at once, plus a ROUNDS group so round cards never restart the walls.">
              {(["per-screen", "together"] as const).map((l) => <button key={l} className={(doc.build?.resolumeLayout ?? "per-screen") === l ? "on" : ""} onClick={() => useStore.getState().saveDoc({ ...doc, build: { ...(doc.build ?? {}), resolumeLayout: l } })}>{l === "per-screen" ? "Group per screen" : "All together"}</button>)}
            </div>
            <button className="btn" onClick={async () => say(await buildResolume())} disabled={!!build}>Resolume Arena <span>{(doc.build?.resolumeLayout ?? "per-screen") === "together" ? "SHOW + ROUNDS" : `${doc.surfaces.length} groups`} · {useStore.getState().cues.length} cols</span></button>
            <button className="btn" onClick={async () => { try { const r = await fetch("/api/bundle", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); const b = await r.json(); say(`Bundle written to ${b.outDir} (${b.files.length} files)`); } catch (e: any) { say(e.message); } }}>Companion + cue sheet + disguise <span>bundle</span></button>
          </div>
          <div className="legend"><span><i style={{ background: "var(--ok)" }} />ready</span><span><i style={{ background: "var(--warn)" }} />will convert</span><span><i style={{ border: "1px solid var(--miss)" }} />missing</span><span><i style={{ background: "var(--line2)" }} />not on this screen</span><span>squares = {screens.join(" · ")}</span></div>
        </aside>}
      </div>
    </div>
  );
}
