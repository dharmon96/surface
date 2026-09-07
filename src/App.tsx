import { useEffect, useState } from "react";
import { useStore } from "./store";
import { Review } from "./pages/Review";
import { Cues } from "./pages/Cues";
import { Media } from "./pages/Media";
import { Run } from "./pages/Run";
import { Health } from "./pages/Health";

const TABS = ["Review", "Cues", "Media", "Run", "Health"] as const;
type Tab = (typeof TABS)[number];

export default function App() {
  const { doc, cues, state, health, error, load, connect } = useStore();
  const [tab, setTab] = useState<Tab>(() => (localStorage.getItem("surface.tab") as Tab) || "Review");
  useEffect(() => { load(); connect(); const t = setInterval(() => useStore.getState().refreshHealth().catch(() => {}), 5000); return () => clearInterval(t); }, []);
  useEffect(() => { localStorage.setItem("surface.tab", tab); }, [tab]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.target as HTMLElement)?.tagName === "INPUT") return; if (tab !== "Run") return; if (e.code === "Space" || e.key === "Enter") { e.preventDefault(); useStore.getState().next(); } if (e.key === "Backspace") { e.preventDefault(); useStore.getState().prev(); } if (e.key === "Escape") useStore.getState().panic(); };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [tab]);
  const online = health?.adapters.filter((a) => a.connected).length ?? 0;
  return (
    <div className="app">
      <header className="top">
        <div className="brand">SUR<span>FACE</span></div>
        <div className="dim">{doc ? `${doc.event.name} · ${doc.event.date ?? ""} · ${doc.surfaces.length} surfaces · ${cues.length} cues` : "no show loaded"}</div>
        <nav className="tabs">{TABS.map((t) => <button key={t} className={t === tab ? "on" : ""} onClick={() => setTab(t)}>{t}</button>)}</nav>
        <div style={{ marginLeft: "auto" }}>{doc && <span className={`tag ${doc.review.status === "approved" ? "ok" : "warn"}`}>{doc.review.status}</span>} <span className={`tag ${online ? "ok" : "bad"}`}>{online}/{health?.adapters.length ?? 0} engines</span></div>
      </header>
      <main className="main">
        {error && <div className="panel" style={{ borderColor: "var(--red)" }}>{error}</div>}
        {doc && tab === "Review" && <Review />}
        {doc && tab === "Cues" && <Cues />}
        {doc && tab === "Media" && <Media />}
        {doc && tab === "Run" && <Run />}
        {tab === "Health" && <Health />}
      </main>
      <footer className="status">
        <span>cue {state?.current ?? "—"} → next {state?.next ?? "—"}</span><span>bout {state?.bout ?? "—"} · round {state?.round ?? "—"}</span><span>timers {state?.timers ?? 0}</span>
        <span style={{ marginLeft: "auto" }}>Run: <kbd>Space</kbd> GO · <kbd>Backspace</kbd> back · <kbd>Esc</kbd> panic</span>
      </footer>
    </div>
  );
}
