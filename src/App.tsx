import { useEffect, useRef, useState } from "react";
import { useStore } from "./store";
import { Board } from "./pages/Board";
import { Home } from "./pages/Home";
import { Review } from "./pages/Review";
import { Cues } from "./pages/Cues";
import { Media } from "./pages/Media";
import { Engines } from "./pages/Engines";
import { Screens } from "./pages/Screens";
import { Outputs } from "./pages/Outputs";
import { AccountMenu, applyTheme, type Theme } from "./shell/AccountMenu";
import { Dock } from "./shell/Dock";
import { Transport } from "./shell/Transport";

/** Setup and the advanced views open as a drawer over the board; Home and the board are the two screens. */
const SETUP: { key: string; label: string; hint: string }[] = [
  { key: "Screens", label: "Screens & routing", hint: "from PixelGrid" }, { key: "Outputs", label: "Outputs", hint: "canvases → displays" }, { key: "Engines", label: "Engines", hint: "Resolume · disguise" },
];
const ADVANCED: { key: string; label: string; hint: string }[] = [
  { key: "Card", label: "Card details", hint: "fighters, answers" }, { key: "Cues", label: "Cue list", hint: "" }, { key: "Media", label: "Media tools", hint: "manual intake" },
];
const TITLES: Record<string, string> = { Screens: "Screens & routing", Outputs: "Outputs", Engines: "Engines", Card: "Card details", Cues: "Cue list", Media: "Media tools" };

function Clock() {
  const [t, setT] = useState(() => new Date());
  useEffect(() => { const i = setInterval(() => setT(new Date()), 1000); return () => clearInterval(i); }, []);
  return <span className="clock">{t.toLocaleTimeString([], { hour12: false })}</span>;
}

export default function App() {
  const { doc, state, health, error, load, connect, loadHub, mode, setMode, drawer, setDrawer, view, setView, confirm, openDeck, versions, openLast, setOpenLast, board } = useStore();
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem("surface.theme") as Theme) || "");
  const [menu, setMenu] = useState(false); const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => { applyTheme(theme); }, [theme]);
  const isDark = theme === "dark" || (!theme && window.matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => { load(); connect(); loadHub(true); const t = setInterval(() => useStore.getState().refreshHealth().catch(() => {}), 5000); return () => clearInterval(t); }, []);
  // the footer promises "drop anywhere on this window": a drop outside a drop target must never navigate the app away
  useEffect(() => { const stop = (e: DragEvent) => e.preventDefault(); window.addEventListener("dragover", stop); window.addEventListener("drop", stop); return () => { window.removeEventListener("dragover", stop); window.removeEventListener("drop", stop); }; }, []);
  useEffect(() => { const c = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false); }; window.addEventListener("mousedown", c); return () => window.removeEventListener("mousedown", c); }, []);
  useEffect(() => { document.title = view === "home" ? "Surface" : `${doc?.event.name ?? "Surface"}${mode === "run" ? " · Run" : ""} · Surface`; }, [view, mode, doc?.event.name]);
  // one keyboard handler for the whole app: Esc unwinds what is open, and GO only ever fires on a show's board in Run
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName; if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const st = useStore.getState();
      if (e.key === "Escape") {
        if (menu) { setMenu(false); return; }
        if (st.drawer) { setDrawer(null); return; }
        if (st.picker) { st.setPicker(null); return; }
        if (st.placing) { st.setPlacing(null); return; }
        if (st.selected) { st.select(null); return; }
        if (view === "board" && mode === "run") st.panic();
        return;
      }
      if (view !== "board" || drawer) return;
      if (mode === "prepare" && (e.key === "c" || e.key === "C")) { openDeck(); return; }
      if (mode !== "run") return;
      if (e.code === "Space" || e.key === "Enter") { e.preventDefault(); st.next(); }
      if (e.key === "Backspace") { e.preventDefault(); st.prev(); }
    };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [mode, drawer, menu, view]);

  const engines = (health?.adapters ?? []).filter((a) => a.id !== "mock"); const online = engines.filter((a) => a.connected);
  const engineName = (id: string) => ({ resolume: "Resolume", disguise: "disguise", companion: "Companion", mock: "Rehearsal" } as Record<string, string>)[id] ?? id;
  const enginePill = !engines.length ? { cls: "", text: "Rehearsal · no engine" } : online.length === engines.length ? { cls: "ok", text: `${online.map((a) => engineName(a.id)).join(" + ")} · connected` } : { cls: "bad", text: `${engines.filter((a) => !a.connected).map((a) => engineName(a.id)).join(", ")} offline` };
  const toConfirm = confirm?.count ?? 0;
  const open = (k: string) => { setDrawer(k); setMenu(false); };
  const home = view === "home";
  const live = !!state?.bout;
  const hasCard = !!doc?.data.bouts?.length;
  const band = !home && hasCard ? (mode === "run" ? <Transport /> : <Dock />) : null;

  return (
    <div className={`app ${band ? "with-band" : ""}`}>
      <header className="top">
        {!home && <button className="back" onClick={() => setView("home")} title="Shows">←</button>}
        <div className="brand">Surface</div>
        {!home && doc && <>
          <span className="divider" />
          <div className="showblock"><b>{doc.event.name}</b><small>{[doc.event.date, doc.event.venue].filter(Boolean).join(" · ")}</small></div>
          {mode === "prepare" && versions.length > 0 && <button className={`tag ${versions.at(-1)?.diff.length && versions.at(-1)!.diff[0] !== "first sheet" ? "warn" : ""}`} title={versions.at(-1)?.diff.slice(0, 3).join(" · ")} onClick={() => open("Card")}>Sheet v{versions.length}</button>}
        </>}
        <div className="tags">
          {!home && hasCard && <div className={`mode ${mode === "run" ? "run" : ""}`} role="tablist"><button className={mode === "prepare" ? "on" : ""} onClick={() => setMode("prepare")}>Prepare</button><button className={mode === "run" ? "on" : ""} onClick={() => setMode("run")}>Run{live && <i className="live" />}</button></div>}
          {!home && mode === "run" && <Clock />}
          {!home && mode === "prepare" && toConfirm > 0 && <button className="tag warn" onClick={() => openDeck()} title="Questions the sheet and the delivery left open — one at a time (C)">{toConfirm} to confirm</button>}
          <button className={`tag ${enginePill.cls}`} onClick={() => open("Engines")} title="Engines">{enginePill.text}</button>
          {home && <AccountMenu />}
          <div className="menu" ref={menuRef}>
            <button className={`more ${menu || drawer ? "on" : ""}`} onClick={() => setMenu((m) => !m)}>Setup ▾</button>
            {menu && <div className="dropdown">
              {!home && <button onClick={() => { setView("home"); setMenu(false); }}>Shows &amp; account<small>every show on this machine</small></button>}
              {SETUP.map((s) => <button key={s.key} disabled={home} title={home ? "Open a show first" : ""} onClick={() => open(s.key)}>{s.label}<small>{s.hint}</small></button>)}
              <div className="sep">Advanced</div>
              {ADVANCED.map((s) => <button key={s.key} disabled={home} title={home ? "Open a show first" : ""} onClick={() => open(s.key)}>{s.label}<small>{s.hint}</small></button>)}
              <div className="sep" />
              <label className="check"><input type="checkbox" checked={openLast} onChange={(e) => setOpenLast(e.target.checked)} /> Open the last show on launch</label>
              {!home && <button onClick={() => { setTheme(isDark ? "light" : "dark"); setMenu(false); }}>{isDark ? "Light theme" : "Dark theme"}</button>}
            </div>}
          </div>
        </div>
      </header>

      <main className="main">
        {error && <div className="panel errbar">{error} <button onClick={() => useStore.setState({ error: null })}>dismiss</button></div>}
        {home ? <Home /> : doc ? <Board /> : <div className="dim" style={{ padding: 20 }}>Loading…</div>}
        {!home && drawer && <div className="drawer"><div className="drawer-head"><b>{TITLES[drawer] ?? drawer}</b><button onClick={() => setDrawer(null)}>Done · Esc</button></div><div className="drawer-body">
          {drawer === "Card" && doc && <Review />}{drawer === "Screens" && doc && <Screens />}{drawer === "Outputs" && doc && <Outputs />}{drawer === "Cues" && doc && <Cues />}{drawer === "Media" && doc && <Media />}{drawer === "Engines" && <Engines />}
        </div></div>}
      </main>

      {band}

      <footer className="status">
        {home ? <span>{useStore.getState().projects?.projects.length ?? 0} shows on this machine{useStore.getState().hub?.signedIn ? " · synced with your account" : ""}</span>
          : mode === "run" ? <><span>cue {state?.current ?? "—"} → next {state?.next ?? "—"}</span><span>bout {state?.bout ?? "—"} · round {state?.round ?? "—"}</span></>
          : <span>{doc ? `${doc.data.bouts?.length ?? 0} bouts · ${doc.screens.length} screens${board?.totals.placed ? ` · ${board.totals.placed} placed by you` : ""}` : ""}</span>}
        {health?.adapters.map((a) => <span key={a.id}><span className={`dot ${a.connected ? "" : "off"}`} />{a.id}{a.detail && a.connected && a.id !== "mock" ? ` · ${a.detail.replace(/^https?:\/\//, "").replace(/\/api.*$/, "")}` : ""}</span>)}
        <span style={{ marginLeft: "auto" }}>{home ? "Drop a bout or timing sheet anywhere on this window to start a show" : mode === "run" ? <><kbd>Space</kbd> GO · <kbd>Backspace</kbd> back · <kbd>Esc</kbd> panic</> : "Drop a sheet, a graphics folder, or PixelGrid screen maps anywhere on this window"}</span>
      </footer>
    </div>
  );
}
