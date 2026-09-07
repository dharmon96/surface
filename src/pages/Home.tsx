import { useRef, useState } from "react";
import { useStore, type ProjectMeta } from "../store";

/**
 * Home — the screen Surface opens on, like ShowCall and PixelGrid: your shows, your account, one way to start one.
 * Every show on this machine (and in your MantaGlow account once synced); the one that is open sits on top with
 * what it still needs. Works signed out and offline: the list is local, the account only backs it up.
 */
const SYNC: Record<ProjectMeta["sync"], { cls: string; label: string; title: string }> = {
  local: { cls: "", label: "local", title: "Only on this machine — sign in and sync to back it up" },
  synced: { cls: "ok", label: "synced", title: "Same as the copy in your MantaGlow account" },
  ahead: { cls: "warn", label: "unsynced edits", title: "Changed here since the last sync" },
  behind: { cls: "warn", label: "newer in cloud", title: "The account copy is newer — sync to pull it" },
  conflict: { cls: "bad", label: "conflict", title: "Changed both here and in the cloud; your copy won, theirs is kept beside it" },
  error: { cls: "bad", label: "sync error", title: "Last sync failed for this show" },
};
const PACKS = [["boxing.fightnight", "Boxing — Fight Night"], ["boxing.pressconf", "Boxing — Press Conference"], ["boxing.weighin", "Boxing — Weigh-in"]];
const PACK_LABEL: Record<string, string> = { "boxing.fightnight": "Fight night", "boxing.pressconf": "Press conference", "boxing.weighin": "Weigh-in" };
const ago = (iso?: string | null) => {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  return s < 90 ? "just now" : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`;
};
const dateLine = (p: ProjectMeta) => [p.eventDate ? new Date(p.eventDate + "T00:00").toLocaleDateString([], { day: "numeric", month: "short" }) : "", p.venue].filter(Boolean).join(" · ");

export function Home() {
  const { hub, projects, lastSync, hubBusy, doc, board, confirm, syncProjects, createProject, importSheet, loadSample, openProject, deleteProject, continueShow, runShow, setView } = useStore();
  const [open, setOpen] = useState(false); const [name, setName] = useState(""); const [date, setDate] = useState(""); const [venue, setVenue] = useState(""); const [pack, setPack] = useState(PACKS[0][0]);
  const [busy, setBusy] = useState(false); const [confirming, setConfirming] = useState<string | null>(null); const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null); const desktop = (window as any).surface;

  const importFile = async (text: string, file: string) => { setBusy(true); try { await importSheet(text, file); } catch (e: any) { useStore.setState({ error: `Could not read that sheet: ${e.message}` }); } finally { setBusy(false); } };
  const chooseSheet = async () => {
    if (desktop?.readSheet) { const r = await desktop.readSheet(); if (!r) return; if (r.error) return useStore.setState({ error: r.error }); await importFile(r.text, r.file); }
    else fileRef.current?.click();
  };
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault(); setOver(false); const f = Array.from(e.dataTransfer.files)[0]; if (!f) return;
    if (!/\.(pdf|txt)$/i.test(f.name)) return useStore.setState({ error: "Sheets only here — open a show, then drop the graphics folder on its board" });
    const path = desktop?.getPath?.(f) ?? (f as any).path;
    if (/\.pdf$/i.test(f.name)) {
      if (!desktop?.readSheetPath) return useStore.setState({ error: "PDFs need the desktop app — export the sheet as text, or use the desktop app" });
      const r = await desktop.readSheetPath(path); if (r?.error) return useStore.setState({ error: r.error }); await importFile(r.text, r.file);
    } else await importFile(await f.text(), f.name);
  };

  const list = projects?.projects ?? []; const activeId = projects?.active ?? null;
  const active = list.find((p) => p.id === activeId); const rest = list.filter((p) => p.id !== activeId);
  const live = !!useStore.getState().state?.bout;
  // readiness of the open show, from what is already loaded
  const openSteps = doc ? [
    { done: (doc.data.bouts?.length ?? 0) > 0, text: doc.data.bouts?.length ? `Card ${doc.data.bouts.length} bouts` : "No card yet" },
    { done: doc.screens.length > 0, text: doc.screens.length ? `Screens ${doc.screens.length}` : "No screens" },
    { done: !!board?.delivery && board.totals.missing === 0, text: board?.delivery ? `Graphics ${board.totals.ready}/${board.totals.slots}` : "No graphics yet" },
    { done: (confirm?.count ?? 0) === 0, text: confirm?.count ? `${confirm.count} to confirm` : "Card confirmed" },
    { done: !!(doc as any).built?.resolume, text: (doc as any).built?.resolume ? "Built" : "Not built" },
  ] : [];
  const readiness = (p: ProjectMeta) => {
    if (p.id === activeId && confirm?.count) return { cls: "warn", text: `${confirm.count} to confirm` };
    if (p.id === activeId && board?.totals.missing) return { cls: "warn", text: `${board.totals.missing} graphics missing` };
    return { cls: "dim", text: `${PACK_LABEL[p.pack] ?? p.pack}` };
  };

  return (
    <div className={`home ${over ? "over" : ""}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
      <div className="home-head">
        <div className="overline">Your shows</div>
        <h2>Shows</h2>
        <p className="dim">Pick a card to keep preparing, or drop the promoter's sheet to start one.</p>
        <p className="faint small">
          {hub?.signedIn
            ? `Synced with your MantaGlow account${lastSync ? ` · last sync ${lastSync.at} · ${lastSync.pushed} pushed · ${lastSync.pulled} pulled` : ""}`
            : "Working offline — shows stay on this machine. Sign in to back them up and open them on another machine."}
          {hub?.signedIn && lastSync?.conflicts.length ? <span style={{ color: "var(--bad)" }}> · {lastSync.conflicts.length} conflict</span> : null}
        </p>
        <button className="btn primary newbtn" onClick={() => setOpen((o) => !o)}>New show</button>
      </div>

      {!projects ? <div className="dim">loading shows…</div> : (
        <>
          {active && (
            <div className="hcard open">
              <div className="overline">{live ? <span style={{ color: "var(--bad)" }}>Open now · live</span> : "Open now"}</div>
              <div className="htitle">{active.name}</div>
              <div className="dim small">{dateLine(active) || "no date yet"} · {PACK_LABEL[active.pack] ?? active.pack}</div>
              <div className="hsteps">{openSteps.map((s, i) => <span key={i} className={s.done ? "ok" : ""}><i />{s.text}</span>)}</div>
              <div className="hfoot">
                <span className={`tag ${SYNC[active.sync].cls}`} title={active.error ?? SYNC[active.sync].title}>{SYNC[active.sync].label}</span>
                <span className="faint small">updated {ago(active.updatedAt)}</span>
                <span style={{ marginLeft: "auto" }} />
                <button className="btn" onClick={continueShow}>Continue</button>
                <button className="btn primary" onClick={runShow}>Run</button>
              </div>
            </div>
          )}

          <div className="hgrid">
            <div className={`hnew ${open ? "on" : ""}`}>
              {!open ? (
                <button className="hnew-face" onClick={() => setOpen(true)}>
                  <b>+ New show</b>
                  <span className="dim small">Drop a bout or timing sheet, or start by hand.</span>
                </button>
              ) : (
                <div className="hnew-open">
                  <button className="btn primary" disabled={busy} onClick={chooseSheet}>{busy ? "reading the sheet…" : "Import bout / timing sheet…"}</button>
                  <input ref={fileRef} type="file" accept=".txt,.pdf" style={{ display: "none" }} onChange={async (e) => { const f = e.target.files?.[0]; if (f) await importFile(await f.text(), f.name); }} />
                  <div className="hr" />
                  <input placeholder="Show name" value={name} onChange={(e) => setName(e.target.value)} />
                  <div className="row2"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /><input placeholder="Venue" value={venue} onChange={(e) => setVenue(e.target.value)} /></div>
                  <select value={pack} onChange={(e) => setPack(e.target.value)}>{PACKS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
                  <button className="btn" disabled={!name.trim()} onClick={async () => { await createProject({ name: name.trim(), date: date || undefined, venue: venue || undefined, pack }); setName(""); setDate(""); setVenue(""); setOpen(false); }}>Create empty show</button>
                  <button className="link" onClick={() => loadSample()}>Try the sample card</button>
                </div>
              )}
            </div>

            {rest.map((p) => {
              const r = readiness(p);
              return (
                <div key={p.id} className="hcard">
                  <div className="htitle">{p.name}{p.visibility === "company" && <span className="tag" style={{ marginLeft: 6 }}>company</span>}</div>
                  <div className="dim small">{dateLine(p) || "no date yet"}</div>
                  <div className={`small ${r.cls}`}>{r.text}</div>
                  {confirming === p.id ? (
                    <div className="hfoot two-step">
                      <span className="small">{hub?.signedIn ? "Delete here and from your account?" : "Delete from this machine?"}</span>
                      <span style={{ marginLeft: "auto" }} />
                      <button className="btn danger" onClick={async () => { await deleteProject(p.id, !!hub?.signedIn); setConfirming(null); }}>Yes, delete</button>
                      <button className="btn" onClick={() => setConfirming(null)}>Keep</button>
                    </div>
                  ) : (
                    <div className="hfoot">
                      <span className={`tag ${SYNC[p.sync].cls}`} title={p.error ?? SYNC[p.sync].title}>{SYNC[p.sync].label}</span>
                      <span className="faint small">{ago(p.updatedAt)}</span>
                      <span style={{ marginLeft: "auto" }} />
                      <span className="acts">
                        <button className="btn" onClick={() => openProject(p.id)}>Open</button>
                        <button className="btn" onClick={() => setConfirming(p.id)}>Delete</button>
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {!list.length && (
            <div className="hempty">
              <b>No shows yet</b>
              <p className="dim">Drop the promoter's bout sheet here, or start one by hand.</p>
              <div className="gorow"><button className="btn primary" onClick={chooseSheet}>Choose a sheet…</button><button className="btn" onClick={() => loadSample()}>Try the sample card</button></div>
            </div>
          )}
          {projects && !projects.enabled && (
            <p className="faint small">The server was started on one show file, so there is no list. Run the desktop app, or <code>npm run server -- --data ~/.surface</code>.</p>
          )}
          {hubBusy && <p className="dim small">{hubBusy}</p>}
        </>
      )}
    </div>
  );
}
