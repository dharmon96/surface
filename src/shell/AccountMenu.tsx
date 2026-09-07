import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";

/** who you are on MantaGlow, and the things that belong to the account: sync, theme, sign out. */
export type Theme = "" | "light" | "dark";
export const applyTheme = (t: Theme) => { document.documentElement.classList.remove("dark", "light"); if (t) document.documentElement.classList.add(t); localStorage.setItem("surface.theme", t); };

export function AccountMenu() {
  const { hub, hubBusy, mode, projects, signIn, signOut, syncProjects, loadHub } = useStore();
  const [open, setOpen] = useState(false); const ref = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem("surface.theme") as Theme) || "");
  useEffect(() => { applyTheme(theme); }, [theme]);
  useEffect(() => { const c = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }; window.addEventListener("mousedown", c); return () => window.removeEventListener("mousedown", c); }, []);

  if (!hub?.signedIn) return <button className="btn" disabled={!!hubBusy} onClick={() => signIn()}>{hubBusy ? "signing in…" : "Sign in to MantaGlow"}</button>;
  const name = hub.user?.name ?? hub.user?.email ?? "you";
  const initials = name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  const duringShow = mode === "run";
  return (
    <div className="menu acct" ref={ref}>
      <button className={`acct-chip ${open ? "on" : ""}`} onClick={() => setOpen((o) => !o)} title={hub.user?.email ?? ""}>
        <i>{initials}</i>{name.split(" ")[0]} ▾
      </button>
      {open && (
        <div className="dropdown right">
          <div className="who">
            <b>{name}</b>
            <span className="faint small">{hub.user?.email}{hub.organization ? ` · ${hub.organization.name}` : ""}</span>
            <span className="faint small">apps: {hub.apps.length ? hub.apps.map((a) => a.name).join(", ") : "—"}</span>
          </div>
          {hub.error && <div className="small" style={{ color: "var(--warn)", padding: "0 12px 6px" }}>{hub.error}</div>}
          <button disabled={duringShow || !!hubBusy} title={duringShow ? "Not during a show" : "Push and pull your shows"} onClick={() => { void syncProjects(); setOpen(false); }}>
            {hubBusy ? "syncing…" : "Sync now"}<small>{projects?.projects.length ?? 0} shows</small>
          </button>
          <button onClick={() => { void loadHub(true); }}>Refresh account</button>
          {(window as any).surface?.openHub && <button onClick={() => { (window as any).surface.openHub(); setOpen(false); }}>Open mantaglow.com</button>}
          <div className="sep" />
          <div className="themerow">
            <span className="faint small">Theme</span>
            <div className="seg">{([["", "System"], ["light", "Light"], ["dark", "Dark"]] as const).map(([v, l]) => <button key={v} className={theme === v ? "on" : ""} onClick={() => setTheme(v as Theme)}>{l}</button>)}</div>
          </div>
          <div className="sep" />
          <button className="danger" onClick={() => { void signOut(); setOpen(false); }}>Sign out</button>
        </div>
      )}
    </div>
  );
}
