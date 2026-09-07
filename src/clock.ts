/**
 * Clip clock — the broadcast VT clock: how much is left of whatever non-looping media is on the walls right now.
 * Big enough to read across a truck. Opens as its own window from the desktop app, or on any laptop on the venue
 * network at http://<console-ip>:8090/clock.html (server started with --bind 0.0.0.0).
 * Self-contained on purpose: no CSS tokens, no webfonts — it must render with nothing but itself.
 */
type Playing = { slot: string; cue: { n: number; id: string; name: string }; behaviour: string; surface: string; layer: string; totalSec: number | null; elapsedSec: number; remainingSec: number | null };
type Clock = { playing: Playing[]; current: number | null; next: { n: number; id: string; name: string } | null; serverNow: number; share: { lan: boolean; port: number; urls: string[] } };

const root = document.getElementById("root")!;
const AMBER = "#f5b400", RED = "#e33b28", GREEN = "#39c07f", DIM = "#8a8578";
let last: Clock | null = null; let fetchedAt = 0;

const fmt = (s: number) => {
  if (s < 0) s = 0;
  const m = Math.floor(s / 60), sec = s - m * 60;
  return s < 10 ? `${sec.toFixed(1)}` : `${m}:${String(Math.floor(sec)).padStart(2, "0")}`;
};

function render() {
  const now = Date.now();
  const drift = last ? (now - fetchedAt) / 1000 : 0;
  const p = last?.playing[0];
  const remain = p?.remainingSec != null ? Math.max(0, p.remainingSec - drift) : null;
  const color = remain == null ? DIM : remain <= 10 ? RED : remain <= 30 ? AMBER : "#fff";
  const flash = remain != null && remain <= 10 && Math.floor(now / 500) % 2 === 0;
  const pct = p?.totalSec && remain != null ? Math.max(0, Math.min(1, remain / p.totalSec)) : null;
  const others = (last?.playing ?? []).slice(1, 4);
  root.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:baseline;color:${DIM};font-size:2.4vmin;letter-spacing:.08em;text-transform:uppercase">
      <span>${p ? `${p.cue.id} · ${esc(p.cue.name)}` : "Surface · clip clock"}</span>
      <span>${p ? `${p.surface} / ${p.layer}${p.behaviour === "playHold" ? " · holds last frame" : p.behaviour === "playToMarker" ? " · pauses at marker" : ""}` : ""}</span>
    </div>
    <div style="display:grid;place-items:center">
      <div style="font-size:${remain != null && remain < 10 ? "34vmin" : "30vmin"};font-weight:700;line-height:1;color:${flash ? "#fff" : color};letter-spacing:-.02em">${
        remain != null ? fmt(remain) : p ? "PLAYING" : "—"
      }</div>
      ${p && remain == null ? `<div style="color:${DIM};font-size:2.6vmin;margin-top:1vmin">duration unknown — convert the clip to get a countdown</div>` : ""}
    </div>
    <div style="height:1.6vmin;background:#1c1a16;border-radius:1vmin;overflow:hidden">${
      pct != null ? `<div style="height:100%;width:${pct * 100}%;background:${color};transition:width .2s linear"></div>` : ""
    }</div>
    <div style="display:flex;justify-content:space-between;gap:2vmin;color:${DIM};font-size:2.2vmin;min-height:3vmin">
      <span>${others.map((o) => { const r = o.remainingSec != null ? Math.max(0, o.remainingSec - drift) : null; return `${o.surface}: ${r != null ? fmt(r) : o.behaviour}`; }).join(" · ")}</span>
      <span style="color:${GREEN}">${last?.next ? `next ${last.next.id} — ${esc(last.next.name)}` : ""}</span>
    </div>`;
}
const esc = (s: string) => s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!));

async function poll() {
  try { const r = await fetch("/api/clock"); if (r.ok) { last = await r.json(); fetchedAt = Date.now(); } } catch {}
}
poll(); setInterval(poll, 500); setInterval(render, 100); render();
