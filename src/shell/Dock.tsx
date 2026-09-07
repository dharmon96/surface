import { useEffect, useState } from "react";
import { useStore, type DeckItem, type TrayItem } from "../store";

/**
 * Prepare's bottom band. Everything that used to stand down the right-hand rail lives here, one tab at a time:
 * the questions still open, the files with no home yet, what the promoter still owes, and the build.
 * The bar itself is always visible — screen coverage and the legend sit on its right.
 */
const DT = "application/x-surface-file";

/** a still, or the loop itself once its preview has been built */
function Preview({ thumb, proxy, title, className }: { thumb?: string; proxy?: string; title?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (proxy && !failed) return <video className={className} src={proxy} poster={thumb} muted loop autoPlay playsInline title={title} onError={() => setFailed(true)} />;
  return <div className={`thumb img ${className ?? ""}`} style={{ backgroundImage: thumb ? `url(${thumb})` : undefined }} title={title} />;
}

function ConfirmTab() {
  const { confirm, deckKey, deckBusy, deckNote, answerCard, skipCard, forgetCard, doc, approve, setDrawer } = useStore();
  const [typing, setTyping] = useState<string | null>(null); const [text, setText] = useState("");
  const items = confirm?.items ?? [];
  const idx = Math.max(0, items.findIndex((i) => i.key === (deckKey ?? items[0]?.key)));
  const it: DeckItem | undefined = items[idx];
  useEffect(() => { setTyping(null); setText(""); }, [it?.key]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName; if (tag === "INPUT" || tag === "TEXTAREA" || !it) return;
      if (e.key === "Enter") { const s = it.options.find((o) => o.suggested); if (s && !s.input) { e.preventDefault(); void answerCard(it.key, s.id); } return; }
      if (/^[1-9]$/.test(e.key)) { const o = it.options[Number(e.key) - 1]; if (o && !o.input) { e.preventDefault(); void answerCard(it.key, o.id); } }
      if (e.key === "ArrowRight") skipCard();
    };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [it, answerCard, skipCard]);

  if (!it) return (
    <div className="deck done">
      <b>Everything is confirmed.</b>
      <span className="dim small">{confirm?.answered.length ?? 0} answered</span>
      {doc?.review.status !== "approved" && <button className="btn primary" onClick={() => approve()}>Approve card</button>}
    </div>
  );
  const evidenceFiles = (it.evidence?.files ?? []).filter((f) => !it.options.some((o) => o.file === f));
  const pair = it.options.filter((o) => o.file).length >= 2;
  return (
    <div className="deck">
      <div className="deckhead">
        <span className="overline">{idx + 1} of {items.length}</span>
        {deckNote && <span className="note">{deckNote}</span>}
        <span className="grow" />
        {items.length > 1 && <button className="btn" onClick={skipCard}>Skip →</button>}
      </div>
      <div className="q">{it.question}</div>
      {it.detail && <div className="dim small">{it.detail}</div>}
      {it.evidence?.sheet?.length ? <pre className="sheet">{it.evidence.sheet.join("\n")}</pre> : null}
      {evidenceFiles.length > 0 && <div className="ev">{evidenceFiles.map((f) => <Preview key={f} thumb={it.thumbs[f]} proxy={it.proxies[f]} title={f} />)}</div>}
      {it.evidence?.ocr?.length ? <div className="faint small">read: {it.evidence.ocr.join(" ")}</div> : null}
      <div className={`opts ${pair ? "pair" : ""}`}>
        {it.options.map((o, n) => typing === o.id ? (
          <span key={o.id} className="typing">
            <input autoFocus value={text} placeholder={it.kind === "country" ? "e.g. MX" : "type it"} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) void answerCard(it.key, o.id, text.trim()); if (e.key === "Escape") setTyping(null); }} />
            <button className="btn" disabled={!text.trim()} onClick={() => void answerCard(it.key, o.id, text.trim())}>OK</button>
          </span>
        ) : (
          <button key={o.id} className={`opt ${o.tone ?? ""} ${o.suggested ? "sug" : ""}`} disabled={deckBusy} onClick={() => (o.input ? setTyping(o.id) : void answerCard(it.key, o.id))}>
            {o.file && <Preview thumb={o.thumb} proxy={o.proxy} />}
            <span className="lbl">{o.label}{o.hint && <small>{o.hint}</small>}</span>
            <kbd>{n + 1}</kbd>{o.suggested && <kbd>↵</kbd>}
          </button>
        ))}
      </div>
      {!!confirm?.answered.length && (
        <div className="answered">
          <span className="faint small">{confirm.answered.length} answered</span>
          <button className="link" onClick={() => forgetCard(confirm.answered[confirm.answered.length - 1].key)}>undo the last one</button>
          <button className="link" onClick={() => setDrawer("Card")}>see them all</button>
        </div>
      )}
    </div>
  );
}

function UnplacedTab() {
  const { board, setDragFile, placing, unplace, select } = useStore();
  const tray = board?.tray ?? [];
  if (!tray.length) return <div className="dim">Every file found a place.</div>;
  return (
    <div className="tray">
      <div className="faint small">{placing ? `Placing ${placing.name} — pick where it goes, or press Esc` : "Drag a file onto the graphic it belongs to — or onto one screen square to be exact."}</div>
      <div className="items">
        {tray.map((t: TrayItem) => (
          <div key={t.file} className={`item ${t.kind}`} draggable={t.kind !== "lost"}
            onDragStart={(e) => { e.dataTransfer.setData(DT, t.file); e.dataTransfer.effectAllowed = "copy"; setDragFile({ file: t.file, w: t.w, h: t.h }); }}
            onDragEnd={() => setDragFile(null)}>
            <img loading="lazy" src={t.thumb} alt="" />
            <div className="nm" title={`${t.folder} / ${t.name}`}>{t.name}</div>
            <div className="why" title={t.raw}>{t.why}</div>
            {t.hint && <div className="faint small hint">{t.hint}</div>}
            {t.w ? <div className="faint small">{t.w}×{t.h}</div> : null}
            {t.kind === "lost" && <button className="btn" onClick={() => unplace([t.file])}>Forget</button>}
          </div>
        ))}
      </div>
    </div>
  );
}

function MissingTab() {
  const { board, select, requestText } = useStore();
  const [msg, setMsg] = useState<string | null>(null);
  if (!board) return null;
  if (!board.delivery) return <div className="dim">{board.totals.slots} graphics across {board.screens.length} screens once the card is confirmed. Drop the promoter's folder to see what is there — or copy the request to send them the list.</div>;
  const missing = board.missing;
  if (!missing.length) return <div className="dim">Everything the card needs is here.</div>;
  return (
    <div className="misswrap">
      <div className="misshead">
        <button className="btn" onClick={async () => { const t = await requestText(); try { await navigator.clipboard.writeText(t); setMsg("Copied — paste it into the email to the promoter"); } catch { window.prompt("Copy this:", t); } }}>
          Copy request to promoter ({missing.filter((m) => m.kind === "missing").length})
        </button>
        {msg && <span className="dim small">{msg}</span>}
      </div>
      <div className="misslist">
        {missing.map((m, i) => (
          <button key={i} className="missrow" onClick={() => { const row = board.rows.find((r) => r.id === m.row); const cell = row && Object.values(row.cells).find((c) => c.label === m.label.replace(/ — .*$/, "")); if (row) select({ row: row.id, cellKey: cell?.key ?? Object.keys(row.cells)[0] }); }}>
            <span className={`k ${m.kind === "convert" ? "w" : ""}`}>{m.row}</span>
            <span>{m.label}{m.kind === "missing" ? ` — ${m.screens.map((id) => board.screens.find((s) => s.id === id)?.name ?? id).join(", ")}` : ""}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function BuildTab() {
  const { doc, board, cues, build, health, buildResolume, saveDoc } = useStore();
  const [msg, setMsg] = useState<string | null>(null);
  if (!doc) return null;
  const online = health?.adapters.some((a) => a.id === "resolume" && a.connected);
  const built = (doc as any).built?.resolume as string | undefined;
  return (
    <div className="buildtab">
      <div className="seg" title="How the composition is laid out. Group per screen: a cue fires only the screens it touches. All together: one column fires everything, with rounds on their own group.">
        {(["per-screen", "together"] as const).map((l) => <button key={l} className={(doc.build?.resolumeLayout ?? "per-screen") === l ? "on" : ""} onClick={() => saveDoc({ ...doc, build: { ...(doc.build ?? {}), resolumeLayout: l } })}>{l === "per-screen" ? "Group per screen" : "All together"}</button>)}
      </div>
      <button className="btn primary" disabled={!!build || !online} title={online ? "Create the groups, columns and clips in the running Arena" : "Connect Resolume first (Setup → Engines)"} onClick={async () => setMsg(await buildResolume())}>
        {build ? `building… ${build.done}/${build.total}` : "Resolume Arena"} <span>{(doc.build?.resolumeLayout ?? "per-screen") === "together" ? "SHOW + ROUNDS" : `${doc.surfaces.length} groups`} · {cues.length} cols</span>
      </button>
      <button className="btn" onClick={async () => { try { const r = await fetch("/api/bundle", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); const b = await r.json(); setMsg(`Bundle written to ${b.outDir} (${b.files.length} files)`); } catch (e: any) { setMsg(e.message); } }}>Companion + cue sheet + disguise <span>bundle</span></button>
      <span className="dim small">{built ? `Built ${new Date(built).toLocaleTimeString([], { timeStyle: "short" })}` : "Not built yet"}</span>
      {msg && <span className="dim small">{msg}</span>}
    </div>
  );
}

export function Dock() {
  const { board, confirm, dock, setDock, setDrawer } = useStore();
  if (!board) return null;
  const tabs: { key: NonNullable<typeof dock>; label: string; n?: number }[] = [
    ...(confirm?.count ? [{ key: "confirm" as const, label: "Confirm", n: confirm.count }] : []),
    ...(board.tray.length ? [{ key: "unplaced" as const, label: "Unplaced", n: board.tray.length }] : []),
    { key: "missing", label: board.delivery ? "Missing" : "Needed", n: board.delivery ? board.missing.filter((m) => m.kind === "missing").length : board.totals.slots },
    { key: "build", label: "Build" },
  ];
  return (
    <div className="dock">
      {dock && <div className="dock-body">
        {dock === "confirm" && <ConfirmTab />}
        {dock === "unplaced" && <UnplacedTab />}
        {dock === "missing" && <MissingTab />}
        {dock === "build" && <BuildTab />}
      </div>}
      <div className="dock-bar">
        {tabs.map((t) => <button key={t.key} className={`tab ${dock === t.key ? "on" : ""}`} onClick={() => setDock(t.key)}>{t.label}{t.n != null && <span className="n"> · {t.n}</span>}</button>)}
        <span className="grow" />
        <span className="cov">
          {board.screens.map((s) => <button key={s.id} className="covchip" title={`${s.w}×${s.h} — ${s.ready} of ${s.total} ready`} onClick={() => setDrawer("Screens")}>
            <i className={s.total && s.ready === s.total ? "ok" : s.ready ? "w" : ""} />{s.name} {s.ready}/{s.total}
          </button>)}
        </span>
        <span className="legend"><span><i className="ok" />ready</span><span><i className="w" />will convert</span><span><i className="x" />missing</span></span>
      </div>
    </div>
  );
}
