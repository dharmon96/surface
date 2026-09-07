/**
 * Output window — what an LED processor sees. Opened by the desktop shell full-screen on one display; renders one output
 * canvas (a PixelGrid canvas, or a single screen) with every screen at its canvas position showing its live layers.
 *   fit "1:1"      canvas pixels = display pixels, anchored top-left (the normal LED case: processor maps this canvas)
 *   fit "scale"    uniform scale to fit, top-left (a 3840 canvas on a 1920 monitor)
 *   fit "letterbox" uniform scale, centred
 *   fit "stretch"  fill the display (a screen that wants a standard 1920×1080 regardless of its pixel size)
 * Media: today the browser proxies (H.264 / VP9 alpha); the HAP GPU path (player/) replaces the <video> elements next.
 */
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { io } from "socket.io-client";

/** the house amber, as a constant: the output window deliberately loads no CSS tokens or webfonts (it must render with nothing but itself) */
const AMBER = "#f5b400";

type Layer = { slot: string | null; url: string | null };
interface OutScreen { id: string; name: string; w: number; h: number; x: number; y: number; cw: number; ch: number; rotation: number; testPattern: string | null; layers: Record<"BASE" | "OVERLAY" | "FULL", Layer> }
interface Output { id: string; name: string; w: number; h: number; fit?: "1:1" | "scale" | "letterbox" | "stretch"; screens: OutScreen[]; current: number | null }
const LAYERS = ["BASE", "OVERLAY", "FULL"] as const;
const q = new URLSearchParams(location.search); const ID = q.get("id") ?? "";
const isVideo = (u: string) => /\.(mov|mp4|mxf|avi|webm)(\?|$)/i.test(decodeURIComponent(u));
const building = (u: string | null) => !!u && u.startsWith("building:");

function Screen({ s, identify, test }: { s: OutScreen; identify: boolean; test: boolean }) {
  const idle = !LAYERS.some((l) => s.layers[l].url);
  const rot = s.rotation ? `rotate(${s.rotation}deg)` : undefined;
  return (
    <div style={{ position: "absolute", left: s.x, top: s.y, width: s.cw, height: s.ch, overflow: "hidden", background: "#000", transform: rot, transformOrigin: "top left" }}>
      {idle && test && s.testPattern && <img src={s.testPattern} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />}
      {LAYERS.map((l) => { const u = s.layers[l].url; if (!u || building(u)) return null;
        return isVideo(u)
          ? <video key={u} src={u} autoPlay muted loop playsInline style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "fill" }} />
          : <img key={u} src={u} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />; })}
      {identify && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "rgba(0,0,0,.55)", color: "#fff", fontFamily: "system-ui, sans-serif", textAlign: "center", border: `4px solid ${AMBER}`, boxSizing: "border-box" }}>
          <div><div style={{ fontSize: Math.max(24, Math.min(s.cw, s.ch) / 5), fontWeight: 700 }}>{s.id}</div><div style={{ fontSize: Math.max(12, Math.min(s.cw, s.ch) / 14), opacity: .8 }}>{s.name} · {s.w}×{s.h} @ {s.x},{s.y}</div></div>
        </div>)}
    </div>
  );
}

function OutputPage() {
  const [out, setOut] = useState<Output | null>(null); const [identify, setIdentify] = useState(q.get("identify") === "1"); const [test, setTest] = useState(true);
  const [win, setWin] = useState({ w: window.innerWidth, h: window.innerHeight });
  const reload = () => fetch(`/api/outputs/${encodeURIComponent(ID)}`).then((r) => r.json()).then((o) => { if (!o.error) setOut(o); }).catch(() => {});
  useEffect(() => {
    reload(); const s = io("/", { path: "/socket.io" });
    for (const ev of ["state", "fired", "revert", "proxy", "show"]) s.on(ev, reload);
    s.on("output", (m: { identify?: boolean; test?: boolean; id?: string }) => { if (m.id && m.id !== ID) return; if (m.identify !== undefined) setIdentify(m.identify); if (m.test !== undefined) setTest(m.test); });
    const onR = () => setWin({ w: window.innerWidth, h: window.innerHeight }); window.addEventListener("resize", onR);
    const poll = setInterval(reload, 5000); // proxies still building, a show swapped from the console
    return () => { s.close(); window.removeEventListener("resize", onR); clearInterval(poll); };
  }, []);
  if (!out) return null;
  const fit = out.fit ?? "1:1"; let sx = 1, sy = 1, ox = 0, oy = 0;
  if (fit === "scale" || fit === "letterbox") { sx = sy = Math.min(win.w / out.w, win.h / out.h); if (fit === "letterbox") { ox = (win.w - out.w * sx) / 2; oy = (win.h - out.h * sy) / 2; } }
  else if (fit === "stretch") { sx = win.w / out.w; sy = win.h / out.h; }
  return (
    <div style={{ position: "absolute", left: ox, top: oy, width: out.w, height: out.h, transform: `scale(${sx}, ${sy})`, transformOrigin: "top left", background: "#000", overflow: "hidden" }}>
      {out.screens.map((s) => <Screen key={s.id} s={s} identify={identify} test={test} />)}
      {identify && <div style={{ position: "absolute", left: 8, top: 8, color: AMBER, fontFamily: "system-ui, sans-serif", fontSize: 14, background: "rgba(0,0,0,.6)", padding: "4px 8px" }}>{out.name} · {out.w}×{out.h} · {fit}</div>}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<OutputPage />);
