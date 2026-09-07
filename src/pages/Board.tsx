import { useEffect, useRef, useState } from "react";
import { useStore, type BoardCell, type BoardRow, type BoardSlot } from "../store";
import { Venue } from "./Venue";
import { StepRow } from "../shell/Steps";
import { placeFile, type PlaceSlot } from "../../core/intake/place";

/**
 * The Card Board — the whole show on one screen.
 * Prepare: drop the promoter's folder, watch the cells fill in, see what is missing, build the engine.
 * Run: the same grid; every cell is a GO button; the live bout row is highlighted.
 * Detail lives inline under the row it belongs to — never in a panel down the side, never in a popup.
 */
const desktop = () => (window as any).surface;
const pathOf = (f: File): string | null => desktop()?.getPath?.(f) ?? (f as any).path ?? null;
const DT = "application/x-surface-file";
const isFileDrag = (e: React.DragEvent) => e.dataTransfer.types.includes(DT);
const fits = (f: { w?: number; h?: number }, s: { w: number; h: number }) => !!f.w && !!f.h && ((f.w === s.w && f.h === s.h) || Math.abs(f.w / f.h - s.w / s.h) / (s.w / s.h) < 0.01);
/** Boxing reads surnames: "Hector Beltran Jr." → "Beltran Jr.", "Jesse 'Bam' Rodriguez" → "Rodriguez" */
const surname = (n?: string) => { if (!n) return ""; const t = n.replace(/["'“”‘’].*?["'“”‘’]/g, "").trim().split(/\s+/); const suffix = /^(jr|sr|ii|iii|iv)\.?$/i.test(t[t.length - 1]) ? " " + t.pop() : ""; const last = t[t.length - 1] ?? n; return /^\d+$/.test(last) || last.length < 3 ? n : last + suffix; };

type ScreenRef = { id: string; name: string };
type DropOn = (e: React.DragEvent, slots: BoardSlot[], row: string, cellKey: string, label: string, round?: number, screen?: string) => void;

function ScreenDots({ slots, screens, quiet, onDropScreen }: { slots: BoardSlot[]; screens: ScreenRef[]; quiet?: boolean; onDropScreen?: (e: React.DragEvent, screen: string) => void }) {
  const drag = useStore((s) => s.dragFile);
  const [over, setOver] = useState<string | null>(null);
  return <span className="scr">{screens.map((sc) => {
    const s = slots.find((x) => x.screen === sc.id);
    const cls = !s ? "n" : s.status === "ready" ? "" : s.status === "convert" ? "w" : quiet ? "q" : "x";
    return <i key={sc.id} className={`${cls}${s?.origin === "operator" ? " p" : ""}${over === sc.id ? " tgt" : ""}${drag && s && fits(drag, s) ? " fit" : ""}`}
      title={`${sc.name}${s ? ` — ${quiet && s.status === "missing" ? "needed" : s.status}${s.origin === "operator" ? " · placed by you" : ""}${s.note ? `: ${s.note}` : ""}` : " — not on this screen"}`}
      onDragOver={onDropScreen && s ? (e) => { if (!isFileDrag(e)) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "copy"; setOver(sc.id); } : undefined}
      onDragLeave={() => setOver(null)}
      onDrop={onDropScreen && s ? (e) => { if (!isFileDrag(e)) return; e.preventDefault(); e.stopPropagation(); setOver(null); onDropScreen(e, sc.id); } : undefined} />;
  })}</span>;
}

function Cell({ cell, row, screens, tone, onFire, live, dropOn }: { cell: BoardCell; row: string; screens: ScreenRef[]; tone: string; onFire?: (n: number) => void; live?: boolean; dropOn?: DropOn }) {
  const { mode, selected, select, board, dragFile } = useStore(); const run = mode === "run";
  const [over, setOver] = useState(false);
  const isSel = !run && selected?.row === row && selected.cellKey === cell.key && selected.round === undefined;
  const click = () => { if (run) { if (cell.cues[0]) onFire?.(cell.cues[0].n); } else select(isSel ? null : { row, cellKey: cell.key }); };
  const missing = cell.status === "missing" && !cell.slots.some((s) => s.thumb);
  // before any delivery has been read, a cell is a quiet placeholder — red only means something once files were looked for
  const quiet = missing && !board?.delivery;
  const dur = cell.behaviour === "loop" ? "loop" : cell.behaviour === "playHold" ? "play·hold" : cell.behaviour === "timed" ? "timed" : cell.behaviour ?? "";
  const missText = cell.key === "TEST" ? "no test patterns — load the venue's screens" : "not delivered";
  if (!cell.cues.length) return <div className="cell none" title="nothing to fire here"><div className="thumb"><span className="faint">—</span></div></div>;
  const droppable = !run && !!dropOn && cell.key !== "TEST";
  const canFit = !run && dragFile && cell.slots.some((s) => fits(dragFile, s));
  return (
    <div className={`cell ${cell.status}${missing ? " miss" : ""}${quiet ? " quiet" : ""}${live ? " on" : ""}${isSel ? " sel" : ""}${over ? " tgt" : ""}${canFit ? " fits" : ""}`}
      onClick={click} title={run ? `GO ${cell.cues[0]?.id ?? ""}` : cell.label} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") click(); }}
      onDragOver={droppable ? (e) => { if (!isFileDrag(e)) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "copy"; setOver(true); } : undefined}
      onDragLeave={() => setOver(false)}
      onDrop={droppable ? (e) => { if (!isFileDrag(e)) return; e.preventDefault(); e.stopPropagation(); setOver(false); dropOn!(e, cell.slots, row, cell.key, cell.label); } : undefined}>
      {cell.thumb && !missing ? <div className="thumb img" style={{ backgroundImage: `url(${cell.thumb})` }} /> : <div className={`thumb ${tone}`}>{missing && !quiet ? missText : cell.label}</div>}
      <div className="foot">
        <span>{missing && !quiet ? cell.label : dur}</span>
        {!!cell.placed && <i className="pin" title={`${cell.placed} placed by you`} />}
        <ScreenDots slots={cell.slots} screens={screens} quiet={quiet} onDropScreen={droppable ? (e, id) => dropOn!(e, cell.slots.filter((s) => s.screen === id), row, cell.key, cell.label, undefined, id) : undefined} />
      </div>
    </div>
  );
}

function Rounds({ row, screens, onFire, liveRound, dropOn }: { row: BoardRow; screens: ScreenRef[]; onFire: (n: number) => void; liveRound?: number; dropOn?: DropOn }) {
  const { mode, board, selected, select, dragFile } = useStore();
  const nameOf = (id: string) => screens.find((x) => x.id === id)?.name ?? id; const quiet = !board?.delivery;
  const [over, setOver] = useState<number | null>(null);
  return <div className={`rounds${quiet ? " quiet" : ""}`}>{(row.rounds ?? []).map((r) => {
    const placed = r.slots.some((s) => s.origin === "operator");
    const canFit = dragFile && r.slots.some((s) => fits(dragFile, s));
    const sel = selected?.row === row.id && selected.round === r.n;
    return <i key={r.n} className={`${r.status === "missing" ? (quiet ? "q" : "x") : r.status === "convert" ? "w" : "ok"}${liveRound === r.n ? " on" : ""}${placed ? " p" : ""}${sel ? " sel" : ""}${over === r.n ? " tgt" : ""}${canFit ? " fits" : ""}`}
      title={`Round ${r.n} — ${r.slots.map((s) => `${nameOf(s.screen)}: ${s.status}`).join(", ")}`}
      onClick={() => mode === "run" ? onFire(r.cue) : select(sel ? null : { row: row.id, cellKey: "ROUNDS", round: r.n })}
      onDragOver={dropOn ? (e) => { if (!isFileDrag(e)) return; e.preventDefault(); e.stopPropagation(); setOver(r.n); } : undefined}
      onDragLeave={() => setOver(null)}
      onDrop={dropOn ? (e) => { if (!isFileDrag(e)) return; e.preventDefault(); e.stopPropagation(); setOver(null); dropOn(e, r.slots, row.id, "ROUNDS", `Round ${r.n}`, r.n); } : undefined}>{r.n}</i>;
  })}
    {!quiet && row.rounds?.some((r) => r.status !== "ready") && <div className="rnote">{[...new Set(row.rounds.flatMap((r) => r.slots.filter((s) => s.status !== "ready").map((s) => `${nameOf(s.screen)}: ${s.status === "missing" ? "none delivered" : "will convert"}`)))].join(" · ")}</div>}
  </div>;
}

/** the inset row under the selected bout: one card per screen, and the two ways to change what is on it */
function Detail({ row, colSpan, say }: { row: BoardRow; colSpan: number; say: (m: string) => void }) {
  const { selected, select, board, placing, setPlacing, picker, setPicker, delivery, loadDelivery, place, unplace, dragFile } = useStore();
  const [find, setFind] = useState("");
  if (!selected || selected.row !== row.id || !board) return null;
  const round = selected.round != null ? row.rounds?.find((r) => r.n === selected.round) : undefined;
  const cell = round ? { key: "ROUNDS", label: `Round ${round.n}`, cues: [], slots: round.slots, status: round.status } as unknown as BoardCell : Object.values(row.cells).find((c) => c.key === selected.cellKey);
  if (!cell) return null;
  const nameOf = (id: string) => board.screens.find((s) => s.id === id)?.name ?? id;
  const openPicker = (s: BoardSlot) => { setPicker({ row: row.id, cellKey: cell.key, round: selected.round, slot: s.slot, screen: s.screen, w: s.w, h: s.h }); void loadDelivery(); };
  const files = (delivery ?? []).filter((f) => !find.trim() || f.name.toLowerCase().includes(find.toLowerCase()))
    .sort((a, b) => Number(fits(b, picker!)) - Number(fits(a, picker!)));
  return (
    <tr className="detail">
      <td colSpan={colSpan}>
        <div className="detail-inner">
          <div className="dhead">
            <div className="dtitle">{row.kind === "bout" ? `Bout ${row.order} · ${row.title}` : "Event"}</div>
            <div className="dlabel">{cell.label}</div>
            <div className="faint small">{cell.cues.map((c) => c.id).join(", ")}{cell.behaviour ? ` · ${cell.behaviour}` : ""}</div>
            {!!cell.placed && <button className="link" onClick={async () => say(await unplace(cell.slots.filter((s) => s.origin === "operator").map((s) => s.slot)))}>Undo all placements</button>}
          </div>

          {placing && placing.row === row.id && placing.cellKey === cell.key ? (
            <div className="placing">
              <b>Place {placing.name}</b>
              <span className="faint small">{placing.w ? `${placing.w}×${placing.h} · ` : ""}{placing.label}</span>
              <div className="opts">
                {placing.step.ask === "scope" && placing.step.options.map((o: any) => <button key={o.key} className="btn" onClick={async () => say(await place(placing.file, o.slots.map((s: PlaceSlot) => s.slot)))}>{o.key === "bout" ? "This bout only" : `Every bout's ${placing.label.toLowerCase()}`}<small>{o.slots.length} screen{o.slots.length === 1 ? "" : "s"}</small></button>)}
                {placing.step.ask === "variant" && placing.step.options.map((o: any) => {
                  const c = cell.cues.find((x) => x.id === o.cue);
                  const label = /WIN_RED/.test(o.cue) ? `${row.red?.name} wins` : /WIN_BLUE/.test(o.cue) ? `${row.blue?.name} wins` : /WIN_DRAW/.test(o.cue) ? "Draw" : c?.name ?? o.cue;
                  return <button key={o.cue} className="btn" onClick={() => { const next = placeFile(o.slots, { w: placing.w ?? 0, h: placing.h ?? 0 }, { cue: o.cue }); if ("ready" in next) void place(placing.file, next.ready.map((r) => r.slot)).then(say); else setPlacing({ ...placing, step: next }); }}>{label}</button>;
                })}
                {placing.step.ask === "screen" && placing.step.options.map((o: any) => <button key={o.screen} className="btn" onClick={async () => say(await place(placing.file, o.slots.map((s: PlaceSlot) => s.slot)))}>{nameOf(o.screen)}<small>{o.note}</small></button>)}
              </div>
              <button className="link" onClick={() => setPlacing(null)}>Cancel</button>
            </div>
          ) : (
            <div className="slots">
              {cell.slots.map((s) => (
                <div key={s.slot} className={`slotcard ${s.status}`}
                  onDragOver={(e) => { if (isFileDrag(e)) { e.preventDefault(); e.stopPropagation(); } }}
                  onDrop={async (e) => { if (!isFileDrag(e)) return; e.preventDefault(); e.stopPropagation(); say(await place(e.dataTransfer.getData(DT), [s.slot])); }}>
                  <div className="sc">{nameOf(s.screen)} <span className="faint">{s.w}×{s.h}</span>{s.origin === "operator" && <span className="tag">placed by you</span>}</div>
                  <div className="st">{s.status === "missing" ? "not delivered" : s.status === "convert" ? "will convert" : "ready"}</div>
                  {(s.file || s.out) && <div className="fl" title={s.file ?? s.out}>{s.file ?? s.out}</div>}
                  {s.note && <div className="faint small">{s.note}</div>}
                  <div className="acts">
                    <button className="link" onClick={() => openPicker(s)}>Swap file…</button>
                    {s.origin === "operator" && <button className="link" onClick={async () => say(await unplace([s.slot]))}>Undo</button>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {picker && picker.row === row.id && picker.cellKey === cell.key && (
            <div className="picker">
              <div className="phead"><b>Swap {nameOf(picker.screen)} {picker.w}×{picker.h}</b><input placeholder="find by name" value={find} onChange={(e) => setFind(e.target.value)} /><button className="x" onClick={() => setPicker(null)}>×</button></div>
              {delivery === null ? <div className="dim small">reading the folder…</div> : !files.length ? <div className="dim small">Nothing in the folder matches.</div> : (
                <div className="pgrid">
                  {files.slice(0, 120).map((f) => (
                    <button key={f.file} className={`t ${fits(f, picker) ? "fits" : ""}`} onClick={async () => say(await place(f.file, [picker.slot]))}
                      draggable onDragStart={(e) => { e.dataTransfer.setData(DT, f.file); useStore.getState().setDragFile({ file: f.file, w: f.w, h: f.h }); }}>
                      <img loading="lazy" src={f.thumb} alt="" />
                      <span className="nm" title={`${f.folder} / ${f.name}`}>{f.name}</span>
                      <span className="faint small">{f.w}×{f.h}{f.placed ? " · placed" : f.on.length ? ` · on ${f.on.length}` : ""}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button className="x close" onClick={() => select(null)} title="Clear (Esc)">×</button>
        </div>
      </td>
    </tr>
  );
}

export function Board() {
  const { board, doc, state, mode, prepare, transcode, build, runPrepare, dropSheet, buildResolume, go, health, venueMode, dragFile, setPlacing, place, setDock, openDeck, confirm, deckKey } = useStore();
  const [dir, setDir] = useState(""); const [del, setDel] = useState(false);
  const [toast, setToast] = useState<string | null>(null); const [dragging, setDragging] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null); const liveRef = useRef<HTMLTableRowElement>(null);
  useEffect(() => { liveRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }); }, [state?.bout]);
  useEffect(() => { if (board?.delivery?.dir && !dir) setDir(board.delivery.dir); }, [board?.delivery?.dir]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 6000); return () => clearTimeout(t); }, [toast]);
  const say = (m: string) => setToast(m);
  if (!board || !doc) return <div className="dim" style={{ padding: 20 }}>Loading the card…</div>;
  const screens: ScreenRef[] = board.screens.map((s) => ({ id: s.id, name: s.name }));
  const run = mode === "run";
  const liveRow = state?.bout ?? null; const liveRound = state?.round ?? undefined;
  const nextRow = liveRow ? board.rows[board.rows.findIndex((r) => r.id === liveRow) + 1]?.id ?? null : null;
  const P = Object.values(transcode.progress); const done = P.filter((p) => p.phase === "done" || p.phase === "skipped").length; const failed = P.filter((p) => p.phase === "failed").length; const jobs = Math.max(done + failed, board.totals.convert + board.totals.ready);
  const busy = transcode.running || (prepare && prepare.phase !== "done" && prepare.phase !== "failed");
  const failedRun = prepare?.phase === "failed";

  const onDrop = async (e: React.DragEvent) => {
    if (isFileDrag(e)) return;                       // a tray tile: the cell it landed on handles it
    e.preventDefault(); setDragging(null); const all = Array.from(e.dataTransfer.files); const f = all[0]; if (!f) return;
    if (all.length && all.every((x) => /\.(png|jpe?g|webp)$/i.test(x.name))) { const paths = all.map(pathOf).filter(Boolean) as string[]; if (!paths.length) return say("Drag the PNGs from Explorer in the desktop app, or use Screens → Import screen maps"); say(await useStore.getState().importScreenMaps({ files: paths })); return; }
    if (/\.(pdf|txt)$/i.test(f.name)) { try { const text = /\.pdf$/i.test(f.name) ? (await desktop()?.readSheetPath?.(pathOf(f)))?.text : await f.text(); if (!text) return say("Could not read that sheet (PDFs need the desktop app)"); const diff = await dropSheet(text, f.name); say(diff.length ? `Sheet merged: ${diff.slice(0, 4).join(" · ")}${diff.length > 4 ? ` (+${diff.length - 4})` : ""}` : "Sheet merged — no changes"); } catch (err: any) { say(`Sheet failed: ${err.message}`); } return; }
    const p = pathOf(f); if (!p) return say("Drag the folder from Explorer in the desktop app, or paste its path");
    setDir(p); runPrepare(p, del);
  };
  const onDragOver = (e: React.DragEvent) => {
    if (isFileDrag(e)) return;
    e.preventDefault();
    const items = Array.from(e.dataTransfer.items ?? []);
    const names = items.map((i) => i.type);
    setDragging(names.some((t) => /pdf|text/.test(t)) ? "Drop to read the newer sheet" : names.some((t) => /image/.test(t)) ? "Drop to load the screen maps" : "Drop to read the folder");
  };
  const pickFolder = async () => { const p = await desktop()?.pickFolder?.(); if (p) { setDir(p); runPrepare(p, del); } };
  const dropSheetBtn = async () => { if (desktop()?.readSheet) { const r = await desktop().readSheet(); if (!r) return; if (r.error) return say(r.error); const diff = await dropSheet(r.text, r.file); say(diff.length ? `Sheet merged: ${diff.slice(0, 4).join(" · ")}` : "Sheet merged — no changes"); } else fileRef.current?.click(); };
  const resolumeOnline = health?.adapters.some((a) => a.id === "resolume" && a.connected);

  /** a file was dropped on a graphic: place it, or ask the one thing the pixels cannot answer */
  const dropOn: DropOn = (e, slots, row, cellKey, label, round, screen) => {
    const file = e.dataTransfer.getData(DT); if (!file) return;
    const tile = board.tray.find((t) => t.file === file) ?? (dragFile?.file === file ? dragFile : undefined);
    const name = file.split("/").pop()!; const dims = { w: tile?.w ?? 0, h: tile?.h ?? 0 };
    const ps: PlaceSlot[] = slots.map((s) => ({ slot: s.slot, screen: s.screen, w: s.w, h: s.h, cue: s.cue ?? "" }));
    useStore.getState().select({ row, cellKey, round });
    if (round != null) {
      const every = board.rows.filter((r) => r.kind === "bout").flatMap((r) => (r.rounds?.find((x) => x.n === round)?.slots ?? []).map((s) => ({ slot: s.slot, screen: s.screen, w: s.w, h: s.h, cue: s.cue ?? "" })));
      setPlacing({ file, name, ...dims, row, cellKey, round, label, step: { ask: "scope", options: [{ key: "bout", slots: ps }, { key: "all", slots: every }] } });
      return;
    }
    const p = placeFile(ps, dims, { screen });
    if ("ready" in p) { if (!p.ready.length) return say("Nothing on that graphic takes this file"); void place(file, p.ready.map((r) => r.slot)).then(say); return; }
    setPlacing({ file, name, ...dims, row, cellKey, round, label, step: p });
  };

  if (!(doc.data.bouts?.length)) return (
    <div className={`board start ${dragging ? "over" : ""}`} onDragOver={onDragOver} onDragLeave={() => setDragging(null)} onDrop={onDrop}>
      {toast && <div className="toast" onClick={() => setToast(null)}>{toast}</div>}
      <div className="startcard">
        <h2>Drop the bout sheet here</h2>
        <p>The promoter's timing sheet or bout sheet (PDF). The card fills in — fighters, corners, rounds, titles — and every graphic the show needs appears on the board: walkouts, fight base, rounds, winners. Then drop the graphics folder on the same window.</p>
        <p className={`small ${doc.screens.length ? "dim" : "warn"}`}>{doc.screens.length ? `Screens: ${doc.screens.length} loaded ✓` : "No screens yet — load the venue first, so files can be matched to walls"}</p>
        <div className="gorow">
          <button className="btn primary" onClick={dropSheetBtn}>Choose a sheet…</button>
          <button className="btn" onClick={() => useStore.getState().setDrawer("Card")}>Build the card by hand</button>
          <button className="btn" onClick={() => useStore.getState().setDrawer("Screens")}>{doc.screens.length ? "Screens ✓ · edit" : "Load the venue's screens first"}</button>
          <button className="btn" onClick={() => useStore.getState().loadSample()}>Try the sample card</button>
        </div>
        <input ref={fileRef} type="file" accept=".txt,.pdf" style={{ display: "none" }} onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; await dropSheet(await f.text(), f.name); say("Sheet loaded"); }} />
        <p className="faint small">Looking for another show? ← Shows, at the top.</p>
      </div>
    </div>);

  const cur = confirm && useStore.getState().dock === "confirm" ? confirm.items.find((i) => i.key === (deckKey ?? confirm.items[0]?.key)) : undefined;
  const askRow = cur?.bout ?? (cur && !cur.anchor?.fighters?.length && cur.source === "delivery" ? "EVT" : undefined);
  const colSpan = board.columns.length + 1;

  return (
    <div className={`board ${run ? "run" : ""} ${dragFile ? "dragfile" : ""}`} onDragOver={onDragOver} onDragLeave={() => setDragging(null)} onDrop={onDrop}>
      {toast && <div className="toast" onClick={() => setToast(null)}>{toast}</div>}
      {dragging && !run && <div className="dragover"><span>{dragging}</span></div>}
      {!run && <div className="strip">
        <div className="striprow">
          <div className={`drop ${board.delivery ? "" : "empty"} ${failedRun ? "failed" : ""}`}>
            {busy ? <>
              <span className="prog"><i style={{ width: transcode.running ? `${(done / Math.max(1, jobs)) * 100}%` : "8%" }} /></span>
              <span className="num">{prepare && !transcode.progress[Object.keys(transcode.progress)[0]] ? `${prepare.phase}${prepare.detail ? ` ${prepare.detail}` : "…"}` : `${done}/${jobs} converted${failed ? ` · ${failed} failed` : ""}`}</span>
            </> : failedRun ? <>
              <span className="num">Could not read the folder — {prepare?.detail}</span>
              <button className="btn" onClick={() => runPrepare(dir, del)}>Try again</button>
            </> : board.delivery ? <>
              <span className="num"><b>{board.delivery.files} files</b> · {board.totals.ready} ready · {board.totals.convert} to convert
                {" · "}<button className="link" onClick={() => setDock("missing")}>{board.totals.missing} missing</button>
                {board.tray.length ? <> · <button className="link" onClick={() => setDock("unplaced")}>{board.tray.length} unplaced</button></> : null}
                {board.totals.placed ? ` · ${board.totals.placed} placed by you` : ""}</span>
              <button className="btn" onClick={() => runPrepare(dir, del)} title={dir}>Check the folder again</button>
            </> : <>
              <span className="num"><b>Drop the promoter's graphics folder here</b> — it is read, matched to the card and converted in one go.</span>
              {desktop() ? <button className="btn" onClick={pickFolder}>Choose folder…</button> : <input className="path" placeholder="or paste the folder path and press Enter" value={dir} onChange={(e) => setDir(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && dir) runPrepare(dir, del); }} />}
            </>}
            <label className="faint small" title="Each original is deleted only after its converted copy has been verified"><input type="checkbox" checked={del} onChange={(e) => setDel(e.target.checked)} /> delete originals once converted</label>
          </div>
          {board.totals.convert > 0 && !busy && <button className="btn" onClick={() => useStore.getState().startTranscode(del)}>Convert {board.totals.convert} files</button>}
          <button className="btn primary" onClick={async () => say(await buildResolume())} disabled={!!build || !resolumeOnline} title={resolumeOnline ? "Create the layer groups, columns and clips in the running Arena" : "Connect Resolume first (Setup → Engines)"}>{build ? `building… ${build.done}/${build.total}` : "Build Resolume"}</button>
        </div>
        <StepRow />
      </div>}

      <div className={`wrap ${run && venueMode !== "off" ? `venue-${venueMode}` : ""}`}>
        {run && venueMode === "big" && <div className="venuecol"><Venue big /></div>}
        <div className="boardwrap">
          <table className="grid">
            <thead><tr><th className="bout">Card <span className="n">{board.rows.length - 1} bouts · running order</span></th>{board.columns.map((c) => <th key={c.key}>{c.label} {c.sub && <span className="n">{c.sub}</span>}</th>)}</tr></thead>
            <tbody>
              {board.rows.map((r) => r.kind === "event" ? (
                <>
                  <tr key={r.id} className={`evt ${askRow === r.id ? "ask" : ""}`}><td className="bout"><span className="ord">EVENT</span><div className="names">{r.title}</div><div className="meta">{Object.keys(r.cells).length} items</div>
                    {!run && r.asks.slice(0, 1).map((a) => <button key={a.key} className="flag ask" title={a.question} onClick={() => openDeck(a.key)}>{a.question}</button>)}</td>
                    <td colSpan={board.columns.length}><div className="stack">{Object.values(r.cells).map((c) => <Cell key={c.key} cell={c} row={r.id} screens={screens} tone={c.key === "FLAGS" ? "t-flag" : c.key === "VTS" ? "t-vt" : c.key === "TEST" ? "t-test" : "t-hold"} onFire={go} dropOn={dropOn} />)}</div></td></tr>
                  {!run && <Detail key={r.id + "-d"} row={r} colSpan={colSpan} say={say} />}
                </>
              ) : (
                <>
                  <tr key={r.id} className={`${liveRow === r.id ? "live" : run && liveRow && nextRow === r.id ? "next" : run && liveRow ? "rest" : ""} ${askRow === r.id ? "ask" : ""}`} ref={liveRow === r.id ? liveRef : undefined}>
                    <td className="bout"><span className="ord">{String(r.order).padStart(2, "0")}{r.meta.isMain ? " · MAIN" : r.meta.isCoMain ? " · CO-MAIN" : ""}</span>
                      <div className="names" title={r.title}><span className="r">{surname(r.red?.name)}</span><span className="v">v</span><span className="b">{surname(r.blue?.name)}</span></div>
                      <div className="full">{r.red?.name} · {r.blue?.name}</div>
                      <div className="meta">{r.meta.title && <b>{r.meta.title} · </b>}{r.meta.rounds} rds{r.meta.weightClass ? ` · ${r.meta.weightClass}` : ""}{r.red?.country && r.blue?.country ? ` · ${r.red.country} v ${r.blue.country}` : ""}</div>
                      {!run && (r.asks.length ? r.asks.slice(0, 2).map((a) => <button key={a.key} className="flag ask" title={a.question} onClick={() => openDeck(a.key)}>{a.question}</button>)
                        : r.flags.slice(0, 2).map((f, i) => <span key={i} className="flag" title={f}>{f.replace(/^Bout \d+: /, "")}</span>))}</td>
                    {board.columns.some((c) => c.key === "OPEN") && <td>{r.cells.OPEN ? <Cell cell={r.cells.OPEN} row={r.id} screens={screens} tone="t-vt" onFire={go} dropOn={dropOn} live={liveRow === r.id && state?.current === r.cells.OPEN.cues[0]?.n} /> : <div className="dim" style={{ textAlign: "center", padding: "18px 0" }}>—</div>}</td>}
                    <td><Cell cell={r.cells.WALK_RED} row={r.id} screens={screens} tone="t-r" onFire={go} dropOn={dropOn} live={liveRow === r.id && state?.current === r.cells.WALK_RED.cues[0]?.n} /></td>
                    <td><Cell cell={r.cells.WALK_BLUE} row={r.id} screens={screens} tone="t-b" onFire={go} dropOn={dropOn} live={liveRow === r.id && state?.current === r.cells.WALK_BLUE.cues[0]?.n} /></td>
                    <td><Cell cell={r.cells.TALE} row={r.id} screens={screens} tone="t-vs" onFire={go} dropOn={dropOn} live={liveRow === r.id && state?.current === r.cells.TALE.cues[0]?.n} /></td>
                    <td><Cell cell={r.cells.UP_NEXT} row={r.id} screens={screens} tone="t-next" onFire={go} dropOn={dropOn} /></td>
                    <td><Rounds row={r} screens={screens} onFire={go} liveRound={liveRow === r.id ? liveRound : undefined} dropOn={!run ? dropOn : undefined} /></td>
                    <td>{run ? <div className="wins">{r.cells.WINNER.cues.map((c) => <button key={c.id} className={`btn ${/RED/.test(c.id) ? "wr" : /BLUE/.test(c.id) ? "wb" : ""}`} onClick={() => go(c.n)}>{/RED/.test(c.id) ? r.red?.name : /BLUE/.test(c.id) ? r.blue?.name : "Draw"}</button>)}</div> : <Cell cell={r.cells.WINNER} row={r.id} screens={screens} tone="t-win" dropOn={dropOn} />}</td>
                  </tr>
                  {!run && <Detail key={r.id + "-d"} row={r} colSpan={colSpan} say={say} />}
                </>
              ))}
            </tbody>
          </table>
        </div>
        {run && venueMode === "side" && <div className="venuecol"><Venue /></div>}
      </div>
    </div>
  );
}
