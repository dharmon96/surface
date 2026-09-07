import { useEffect, useRef, useState } from "react";
import { useStore } from "./store";
import { Board } from "./pages/Board";
import { Review } from "./pages/Review";
import { Cues } from "./pages/Cues";
import { Media } from "./pages/Media";
import { Engines } from "./pages/Engines";
import { Hub } from "./pages/Hub";
import { Screens } from "./pages/Screens";
import { Outputs } from "./pages/Outputs";

/** The board is the app. Setup and the advanced views open as a drawer over it. */
const SETUP: { key: string; label: string; hint: string }[] = [
  { key: "Screens", label: "Screens & routing", hint: "from PixelGrid" }, { key: "Outputs", label: "Outputs", hint: "canvases → displays" }, { key: "Engines", label: "Engines", hint: "Resolume · disguise" }, { key: "Projects", label: "Projects & account", hint: "" },
];
const ADVANCED: { key: string; label: string; hint: string }[] = [
  { key: "Card", label: "Card details", hint: "fighters, flags" }, { key: "Cues", label: "Cue list", hint: "" }, { key: "Media", label: "Media tools", hint: "manual intake" },
];
const TITLES: Record<string, string> = { Screens: "Screens & routing", Outputs: "Outputs", Engines: "Engines", Projects: "Projects & account", Card: "Card details", Cues: "Cue list", Media: "Media tools" };

export default function App() {
  const { doc, state, health, error, load, connect, loadHub, mode, setMode, drawer, setDrawer } = useStore();
  const [theme, setTheme] = useState<"dark" | "light" | "">(() => (localStorage.getItem("surface.theme") as any) || "");
  const [menu, setMenu] = useState(false); const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => { document.documentElement.classList.remove("dark", "light"); if (theme) document.documentElement.classList.add(theme); localStorage.setItem("surface.theme", theme); }, [theme]);
  const isDark = theme === "dark" || (!theme && window.matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => { load(); connect(); loadHub(true); const t = setInterval(() => useStore.getState().refreshHealth().catch(() => {}), 5000); return () => clearInterval(t); }, []);
  // the footer promises "drop anywhere on this window": a drop outside the board must never navigate the app away
  useEffect(() => { const stop = (e: DragEvent) => e.preventDefault(); window.addEventListener("dragover", stop); window.addEventListener("drop", stop); return () => { window.removeEventListener("dragover", stop); window.removeEventListener("drop", stop); }; }, []);
  useEffect(() => { const c = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false); }; window.addEventListener("mousedown", c); return () => window.removeEventListener("mousedown", c); }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName; if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Escape" && (drawer || menu)) { setDrawer(null); setMenu(false); return; }
      if (mode !== "run" || drawer) return;
      if (e.code === "Space" || e.key === "Enter") { e.preventDefault(); useStore.getState().next(); } if (e.key === "Backspace") { e.preventDefault(); useStore.getState().prev(); } if (e.key === "Escape") useStore.getState().panic();
    };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [mode, drawer, menu]);
  const engines = (health?.adapters ?? []).filter((a) => a.id !== "mock"); const online = engines.filter((a) => a.connected);
  const engineName = (id: string) => ({ resolume: "Resolume", disguise: "disguise", companion: "Companion", mock: "Rehearsal" } as Record<string, string>)[id] ?? id;
  const enginePill = !engines.length ? { cls: "", text: "Rehearsal · no engine" } : online.length === engines.length ? { cls: "ok", text: `${online.map((a) => engineName(a.id)).join(" + ")} · connected` } : { cls: "bad", text: `${engines.filter((a) => !a.connected).map((a) => engineName(a.id)).join(", ")} offline` };
  const toConfirm = doc?.review.flags.filter((f) => !/placeholder|no bouts yet/i.test(f)).length ?? 0;
  const open = (k: string) => { setDrawer(k); setMenu(false); };
  return (
    <div className="app">
      <header className="top">
        <div className="brand">Surface</div>
        {doc && <button className="show" onClick={() => open("Projects")} title="Projects">{doc.event.name}<small>{[doc.event.date, doc.event.venue].filter(Boolean).join(" · ")}</small></button>}
        <div className="mode" role="tablist"><button className={mode === "prepare" ? "on" : ""} onClick={() => setMode("prepare")}>Prepare</button><button className={mode === "run" ? "on" : ""} onClick={() => setMode("run")}>Run</button></div>
        <div className="tags">
          {toConfirm > 0 && mode === "prepare" && <button className="tag warn" onClick={() => open("Card")} title="Things the sheet parser had to guess">{toConfirm} to confirm</button>}
          <button className={`tag ${enginePill.cls}`} onClick={() => open("Engines")} title="Engines">{enginePill.text}</button>
          <div className="menu" ref={menuRef}>
            <button className={`more ${menu || drawer ? "on" : ""}`} onClick={() => setMenu((m) => !m)}>Setup ▾</button>
            {menu && <div className="dropdown">
              {SETUP.map((s) => <button key={s.key} onClick={() => open(s.key)}>{s.label}<small>{s.hint}</small></button>)}
              <div className="sep">Advanced</div>
              {ADVANCED.map((s) => <button key={s.key} onClick={() => open(s.key)}>{s.label}<small>{s.hint}</small></button>)}
              <div className="sep" />
              <button onClick={() => { setTheme(isDark ? "light" : "dark"); setMenu(false); }}>{isDark ? "Light theme" : "Dark theme"}</button>
            </div>}
          </div>
        </div>
      </header>
      <main className="main">
        {error && <div className="panel errbar">{error} <button onClick={() => useStore.setState({ error: null })}>dismiss</button></div>}
        {doc && <Board />}
        {drawer && <div className="drawer"><div className="drawer-head"><b>{TITLES[drawer] ?? drawer}</b><button onClick={() => setDrawer(null)}>Done · Esc</button></div><div className="drawer-body">
          {drawer === "Projects" && <Hub />}{drawer === "Card" && doc && <Review />}{drawer === "Screens" && doc && <Screens />}{drawer === "Outputs" && doc && <Outputs />}{drawer === "Cues" && doc && <Cues />}{drawer === "Media" && doc && <Media />}{drawer === "Engines" && <Engines />}
        </div></div>}
      </main>
      <footer className="status">
        {mode === "run" ? <><span>cue {state?.current ?? "—"} → next {state?.next ?? "—"}</span><span>bout {state?.bout ?? "—"} · round {state?.round ?? "—"}</span></> : <span>{doc ? `${doc.data.bouts?.length ?? 0} bouts · ${doc.screens.length} screens` : ""}</span>}
        {health?.adapters.map((a) => <span key={a.id}><span className={`dot ${a.connected ? "" : "off"}`} />{a.id}{a.detail && a.connected && a.id !== "mock" ? ` · ${a.detail.replace(/^https?:\/\//, "").replace(/\/api.*$/, "")}` : ""}</span>)}
        <span style={{ marginLeft: "auto" }}>{mode === "run" ? <><kbd>Space</kbd> GO · <kbd>Backspace</kbd> back · <kbd>Esc</kbd> panic</> : "Drop a sheet, a graphics folder, or PixelGrid screen maps anywhere on this window"}</span>
      </footer>
    </div>
  );
}
