import { useEffect, useState } from "react";
import { useStore } from "./store";
import { Board } from "./pages/Board";
import { Review } from "./pages/Review";
import { Cues } from "./pages/Cues";
import { Media } from "./pages/Media";
import { Health } from "./pages/Health";
import { Hub } from "./pages/Hub";

/** The board is the app. Everything else opens as a drawer over it. */
const DRAWERS = ["Projects", "Card", "Cues", "Media (advanced)", "Engines"] as const;
type Drawer = (typeof DRAWERS)[number];

export default function App() {
  const { doc, cues, state, health, error, load, connect, loadHub, hub, projects, mode, setMode } = useStore();
  const [drawer, setDrawer] = useState<Drawer | null>(null);
  const [theme, setTheme] = useState<"dark" | "light" | "">(() => (localStorage.getItem("surface.theme") as any) || "");
  useEffect(() => { document.documentElement.classList.remove("dark", "light"); if (theme) document.documentElement.classList.add(theme); localStorage.setItem("surface.theme", theme); }, [theme]);
  const isDark = theme === "dark" || (!theme && window.matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => { load(); connect(); loadHub(true); const t = setInterval(() => useStore.getState().refreshHealth().catch(() => {}), 5000); return () => clearInterval(t); }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName; if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "Escape" && drawer) return setDrawer(null);
      if (mode !== "run" || drawer) return;
      if (e.code === "Space" || e.key === "Enter") { e.preventDefault(); useStore.getState().next(); } if (e.key === "Backspace") { e.preventDefault(); useStore.getState().prev(); } if (e.key === "Escape") useStore.getState().panic();
    };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [mode, drawer]);
  const online = health?.adapters.filter((a) => a.connected).length ?? 0;
  const noBouts = doc && !(doc.data.bouts?.length);
  return (
    <div className="app">
      <header className="top">
        <div className="brand">Surface</div>
        {doc && <div className="show" onClick={() => setDrawer("Projects")} title="Projects" style={{ cursor: "pointer" }}>{doc.event.name}<small>{[doc.event.date, doc.event.venue, doc.event.broadcast?.network].filter(Boolean).join(" · ")}{cues.length ? ` · ${cues.length} cues` : ""}</small></div>}
        <div className="mode" role="tablist"><button className={mode === "prepare" ? "on" : ""} onClick={() => setMode("prepare")}>Prepare</button><button className={mode === "run" ? "on" : ""} onClick={() => setMode("run")}>Run</button></div>
        <nav className="more">{DRAWERS.map((d) => <button key={d} className={drawer === d ? "on" : ""} onClick={() => setDrawer(drawer === d ? null : d)}>{d}</button>)}</nav>
        <div className="tags"><button className="theme" title="Switch theme" onClick={() => setTheme(isDark ? "light" : "dark")}>{isDark ? "Light" : "Dark"}</button>{projects?.enabled && <span className={`tag ${hub?.signedIn ? "ok" : ""}`} title={hub?.user?.email ?? "not signed in"}>{hub?.signedIn ? hub.user?.name ?? hub.user?.email : "offline"}</span>} {doc && <span className={`tag ${doc.review.status === "approved" ? "ok" : "warn"}`}>{doc.review.status}</span>} <span className={`tag ${online ? "ok" : "bad"}`}>{online}/{health?.adapters.length ?? 0} engines</span></div>
      </header>
      <main className="main">
        {error && <div className="panel" style={{ borderColor: "var(--red)", margin: 12 }}>{error} <button style={{ marginLeft: 8 }} onClick={() => useStore.setState({ error: null })}>dismiss</button></div>}
        {noBouts && !drawer && <div className="empty"><h2>Start with the promoter's sheet</h2><p>Drop the bout sheet or timing sheet anywhere on this window — the card fills in, then drop the graphics folder on it.</p><p className="dim">Or open a project from the name at the top.</p></div>}
        {doc && <Board />}
        {drawer && <div className="drawer"><div className="drawer-head"><b>{drawer}</b><button onClick={() => setDrawer(null)}>close · Esc</button></div><div className="drawer-body">
          {drawer === "Projects" && <Hub />}{drawer === "Card" && doc && <Review />}{drawer === "Cues" && doc && <Cues />}{drawer === "Media (advanced)" && doc && <Media />}{drawer === "Engines" && <Health />}
        </div></div>}
      </main>
      <footer className="status">
        <span>cue {state?.current ?? "—"} → next {state?.next ?? "—"}</span><span>bout {state?.bout ?? "—"} · round {state?.round ?? "—"}</span>
        {health?.adapters.map((a) => <span key={a.id}><span className={`dot ${a.connected ? "" : "off"}`} />{a.id}{a.detail && a.connected ? ` · ${a.detail.replace(/^https?:\/\//, "").replace(/\/api.*$/, "")}` : ""}</span>)}
        <span style={{ marginLeft: "auto" }}>{mode === "run" ? <>Run: <kbd>Space</kbd> GO · <kbd>Backspace</kbd> back · <kbd>Esc</kbd> panic</> : "Prepare: drop a folder or a sheet anywhere"}</span>
      </footer>
    </div>
  );
}
