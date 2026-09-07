import { useRef, useState } from "react";
import { useStore, type ProjectMeta } from "../store";

const SYNC: Record<ProjectMeta["sync"], { cls: string; label: string; title: string }> = {
  local: { cls: "", label: "local", title: "Only on this machine — sign in and sync to back it up" },
  synced: { cls: "ok", label: "synced", title: "Same as the copy in your MantaGlow account" },
  ahead: { cls: "warn", label: "unsynced edits", title: "Changed here since the last sync" },
  behind: { cls: "warn", label: "newer in cloud", title: "The account copy is newer — sync to pull it" },
  conflict: { cls: "bad", label: "conflict", title: "Changed both here and in the cloud; your copy won, theirs is kept as show.conflict-*.json in the project folder" },
  error: { cls: "bad", label: "sync error", title: "Last sync failed for this project" },
};
const PACKS = [["boxing.fightnight", "Boxing — Fight Night"], ["boxing.pressconf", "Boxing — Press Conference"], ["boxing.weighin", "Boxing — Weigh-in"]];
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—");

/** The dashboard: who you are on MantaGlow, and every project on this machine (and in the account once synced). */
export function Hub() {
  const { hub, projects, lastSync, hubBusy, signIn, signOut, syncProjects, loadHub, createProject, importSheet, openProject, deleteProject, doc } = useStore();
  const [name, setName] = useState(""); const [date, setDate] = useState(""); const [venue, setVenue] = useState(""); const [pack, setPack] = useState(PACKS[0][0]); const [flags, setFlags] = useState<string[] | null>(null); const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null); const desktop = (window as any).surface;
  const doImport = async () => {
    setBusy(true); setFlags(null);
    try {
      if (desktop?.readSheet) { const r = await desktop.readSheet(); if (!r) return; if (r.error) { useStore.setState({ error: r.error }); return; } setFlags(await importSheet(r.text, r.file)); }
      else fileRef.current?.click();
    } catch (e: any) { useStore.setState({ error: `Import failed: ${e.message}` }); } finally { setBusy(false); }
  };
  const onFile = async (f: File | undefined) => { if (!f) return; setBusy(true); try { setFlags(await importSheet(await f.text(), f.name)); } catch (e: any) { useStore.setState({ error: `Import failed: ${e.message}` }); } finally { setBusy(false); } };
  const list = projects?.projects ?? [];
  return (
    <div>
      <div className="grid2" style={{ gridTemplateColumns: "minmax(280px, 1fr) 2fr" }}>
        <div>
          <div className="panel" style={{ marginBottom: 14 }}>
            <h3>MantaGlow account</h3>
            {hub?.signedIn ? (
              <div>
                <div style={{ fontSize: 15 }}>{hub.user?.name ?? hub.user?.email}</div>
                <div className="dim mono-small">{hub.user?.email}{hub.organization ? ` · ${hub.organization.name}` : ""}</div>
                <div className="dim mono-small" style={{ marginTop: 4 }}>apps: {hub.apps.length ? hub.apps.map((a) => a.name).join(", ") : "—"}{hub.checkedAt ? ` · checked ${when(hub.checkedAt)}` : ""}</div>
                {hub.error && <div className="mono-small" style={{ color: "var(--amber)", marginTop: 6 }}>{hub.error}</div>}
                <div className="gorow"><button className="primary" disabled={!!hubBusy} onClick={syncProjects}>{hubBusy ?? "Sync now"}</button><button onClick={() => loadHub(true)}>Refresh</button>{desktop?.openHub && <button onClick={() => desktop.openHub()}>Open mantaglow.com</button>}<button onClick={signOut}>Sign out</button></div>
              </div>
            ) : (
              <div>
                <div className="dim">Working offline. Projects stay on this machine; sign in to back them up to your account and open them on another machine.</div>
                {hub?.error && <div className="mono-small" style={{ color: "var(--amber)", marginTop: 6 }}>{hub.error}</div>}
                <div className="gorow"><button className="primary" disabled={!!hubBusy} onClick={signIn}>{hubBusy ?? "Sign in to MantaGlow"}</button></div>
                {!desktop && <div className="faint mono-small">In a browser the sign-in asks for a session token; the desktop app signs in with the normal MantaGlow login window.</div>}
              </div>
            )}
            {lastSync && <div className="mono-small dim" style={{ marginTop: 8 }}>last sync {lastSync.at}: {lastSync.pushed} pushed · {lastSync.pulled} pulled{lastSync.conflicts.length ? <span style={{ color: "var(--red)" }}> · {lastSync.conflicts.length} conflict(s)</span> : null}{lastSync.errors.length ? <div style={{ color: "var(--amber)" }}>{lastSync.errors.join("; ")}</div> : null}</div>}
          </div>
          <div className="panel" style={{ marginBottom: 14 }}>
            <h3>New project</h3>
            <div className="dim mono-small" style={{ marginBottom: 8 }}>Start from the promoter's sheet — the bout sheet is the source of truth — or from nothing.</div>
            <div className="gorow" style={{ margin: 0 }}><button className="primary" disabled={busy} onClick={doImport}>{busy ? "importing…" : "Import bout / timing sheet…"}</button><input ref={fileRef} type="file" accept=".txt,.pdf" style={{ display: "none" }} onChange={(e) => onFile(e.target.files?.[0])} /></div>
            {!desktop && <div className="faint mono-small" style={{ marginTop: 4 }}>Browser: text export only (`pdftotext -layout sheet.pdf sheet.txt`). The desktop app reads PDFs directly.</div>}
            {flags && <div className="mono-small" style={{ marginTop: 8 }}><span className="tag warn">review</span> {flags.length} thing(s) to confirm on the Review tab<ul className="flags" style={{ margin: "4px 0 0", paddingLeft: 16, maxHeight: 120, overflow: "auto" }}>{flags.slice(0, 8).map((f, i) => <li key={i}>{f}</li>)}</ul></div>}
            <div style={{ borderTop: "1px solid var(--line2)", margin: "12px 0" }} />
            <div style={{ display: "grid", gap: 6 }}>
              <input placeholder="Show name" value={name} onChange={(e) => setName(e.target.value)} />
              <div style={{ display: "flex", gap: 6 }}><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /><input style={{ flex: 1 }} placeholder="Venue" value={venue} onChange={(e) => setVenue(e.target.value)} /></div>
              <select value={pack} onChange={(e) => setPack(e.target.value)}>{PACKS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
              <div className="gorow" style={{ margin: 0 }}><button disabled={!name.trim()} onClick={async () => { await createProject({ name: name.trim(), date: date || undefined, venue: venue || undefined, pack }); setName(""); setDate(""); setVenue(""); }}>Create empty project</button></div>
            </div>
          </div>
        </div>
        <div className="panel scroll" style={{ padding: 0 }}>
          <div style={{ padding: "8px 10px", display: "flex", gap: 8, alignItems: "center" }}><h3 style={{ margin: 0 }}>Projects</h3><span className="dim mono-small">{list.length} on this machine{hub?.signedIn ? " · synced with your account" : ""}</span></div>
          {!projects?.enabled && <div className="dim" style={{ padding: 10 }}>The server was started on a single show file (no data dir), so there is no project list. Run the desktop app, or `npm run server -- --data ~/.surface`.</div>}
          <table><thead><tr><th>Show</th><th>Date</th><th>Venue</th><th>Pack</th><th>Updated</th><th>Sync</th><th></th></tr></thead>
            <tbody>{list.map((p) => { const active = p.id === projects?.active; const s = SYNC[p.sync]; return (
              <tr key={p.id} style={active ? { background: "var(--panel2, rgba(255,255,255,.04))" } : {}}>
                <td>{active && <span className="tag gold" style={{ marginRight: 6 }}>open</span>}{p.name}{p.visibility === "company" && <span className="tag" style={{ marginLeft: 6 }}>company</span>}</td>
                <td className="mono-small">{p.eventDate ?? "—"}</td><td className="mono-small dim">{p.venue ?? "—"}</td><td className="mono-small dim">{p.pack.replace("boxing.", "")}</td><td className="mono-small dim">{when(p.updatedAt)}</td>
                <td><span className={`tag ${s.cls}`} title={p.error ?? s.title}>{s.label}</span></td>
                <td style={{ whiteSpace: "nowrap" }}>{!active && <button onClick={() => openProject(p.id)}>Open</button>} {!active && <button title={hub?.signedIn ? "Delete here and in your account" : "Delete from this machine"} onClick={() => { if (window.confirm(`Delete "${p.name}"${hub?.signedIn ? " here and from your MantaGlow account" : " from this machine"}? The show.json is removed.`)) deleteProject(p.id, !!hub?.signedIn); }}>Delete</button>}</td>
              </tr>); })}</tbody></table>
          {projects?.enabled && !list.length && <div className="dim" style={{ padding: 10 }}>No projects yet — import a sheet or create one.</div>}
        </div>
      </div>
      {doc && <div className="panel" style={{ marginTop: 14 }}><h3>Open now</h3><div>{doc.event.name} <span className="dim mono-small">· {doc.event.date ?? "no date"} · {doc.data.bouts?.length ?? 0} bouts · {doc.surfaces.length} surfaces · <span className={`tag ${doc.review.status === "approved" ? "ok" : "warn"}`}>{doc.review.status}</span></span></div><div className="dim mono-small" style={{ marginTop: 4 }}>Next: Review → approve the card · Media → map the promoter's delivery · Cues → check routing · Run.</div></div>}
    </div>
  );
}
