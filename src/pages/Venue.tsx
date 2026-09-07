import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { useStore } from "../store";

/**
 * Venue — what the walls are showing right now, drawn on the LED map.
 *   2D: the screens as a plan (PixelGrid positions or an automatic layout), each stacking BASE / OVERLAY / FULL live media.
 *   3D: the same screens as planes in a three.js scene you can orbit; textures are the same media, composited per frame.
 * The media is Surface's own converted files, so this is a faithful mirror of what the engine was told to play — not a
 * capture of the engine's output.
 */
export interface VenueScreen { id: string; name: string; w: number; h: number; venue?: { x: number; y: number; z: number; wM: number; hM: number; rot?: [number, number, number]; source: string }; surface: string | null; independent: boolean; testPattern: string | null; layers: Record<"BASE" | "OVERLAY" | "FULL", { slot: string | null; url: string | null }> }
interface VenueData { screens: VenueScreen[]; current: number | null; bout: string | null; round: number | null }
const LAYERS = ["BASE", "OVERLAY", "FULL"] as const;
const isVideo = (u: string) => /\.(mov|mp4|mxf|avi|webm)(\?|$)/i.test(decodeURIComponent(u));
const building = (u: string | null) => !!u && u.startsWith("building:");
const thumbFor = (u: string) => `/api/thumb?f=${u.replace(/^building:\/api\/proxy\?f=/, "")}`;

/** One screen's live stack as DOM media (also the texture source for 3D). */
function Stack({ s, showTest, onEl }: { s: VenueScreen; showTest: boolean; onEl?: (id: string, els: HTMLElement[]) => void }) {
  const refs = useRef<Record<string, HTMLElement | null>>({});
  useEffect(() => { onEl?.(s.id, LAYERS.map((l) => refs.current[l]).filter(Boolean) as HTMLElement[]); });
  const idle = !LAYERS.some((l) => s.layers[l].url);
  return (
    <div className="stack" style={{ aspectRatio: `${s.w} / ${s.h}` }}>
      {idle && showTest && s.testPattern && <img src={s.testPattern} alt="" className="layer" style={{ opacity: .35 }} />}
      {LAYERS.map((l) => { const u = s.layers[l].url; if (!u) return null;
        if (building(u)) return <img key={u} ref={(e) => { refs.current[l] = e; }} src={thumbFor(u)} className="layer" alt="" crossOrigin="anonymous" title="preview proxy being made" />; // a frame until the proxy is ready
        return isVideo(u)
        ? <video key={u} ref={(e) => { refs.current[l] = e; }} src={u} className="layer" autoPlay muted loop playsInline crossOrigin="anonymous" />
        : <img key={u} ref={(e) => { refs.current[l] = e; }} src={u} className="layer" alt="" crossOrigin="anonymous" />; })}
      {idle && <div className="idle">{s.id}</div>}
    </div>
  );
}

/** 2D plan: metres → pixels, fitted to the panel. */
function Plan({ screens, showTest, onEl }: { screens: VenueScreen[]; showTest: boolean; onEl?: (id: string, els: HTMLElement[]) => void }) {
  const box = useMemo(() => { const v = screens.map((s) => s.venue!).filter(Boolean); if (!v.length) return { x0: -5, x1: 5, y0: 0, y1: 6 }; return { x0: Math.min(...v.map((s) => s.x - s.wM / 2)) - 0.5, x1: Math.max(...v.map((s) => s.x + s.wM / 2)) + 0.5, y0: Math.min(...v.map((s) => s.y - s.hM / 2)) - 0.5, y1: Math.max(...v.map((s) => s.y + s.hM / 2)) + 0.5 }; }, [screens]);
  const W = box.x1 - box.x0, H = box.y1 - box.y0;
  return (
    <div className="plan" style={{ aspectRatio: `${W} / ${H}` }}>
      <div className="floor" />
      {screens.map((s) => { const v = s.venue!; if (!v) return null; const left = ((v.x - v.wM / 2 - box.x0) / W) * 100, top = ((box.y1 - (v.y + v.hM / 2)) / H) * 100, w = (v.wM / W) * 100, h = (v.hM / H) * 100;
        return <div key={s.id} className={`vs ${s.independent ? "indep" : ""}`} style={{ left: `${left}%`, top: `${top}%`, width: `${w}%`, height: `${h}%`, transform: v.rot ? `rotateY(${v.rot[1]}rad)` : undefined }} title={`${s.name} · ${s.w}×${s.h} · ${v.wM.toFixed(1)}×${v.hM.toFixed(1)} m`}>
          <Stack s={s} showTest={showTest} onEl={onEl} /><span className="lbl">{s.id}</span></div>; })}
    </div>
  );
}

/** 3D: planes in metres, textures composited from the same DOM media every frame. */
function Scene({ screens, showTest, els }: { screens: VenueScreen[]; showTest: boolean; els: React.MutableRefObject<Record<string, HTMLElement[]>> }) {
  const mount = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = mount.current!; const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); renderer.setPixelRatio(Math.min(2, window.devicePixelRatio)); el.appendChild(renderer.domElement);
    const scene = new THREE.Scene(); const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
    const xs = screens.map((s) => s.venue?.x ?? 0), ys = screens.map((s) => s.venue?.y ?? 2); const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2; const span = Math.max(6, Math.max(...xs) - Math.min(...xs) + 8);
    const aspect0 = Math.max(1, el.clientWidth / Math.max(1, el.clientHeight)); const dist = Math.max(6, ((Math.max(...xs) - Math.min(...xs) + 6) / (2 * Math.tan((50 / 2) * Math.PI / 180) * aspect0)) * 1.15);
    // eye a little below the walls' centre, looking slightly up: walls sit mid-frame, floor grid gives the scale
    cam.position.set(cx, Math.max(1.2, cy - 0.8), dist); const ctl = new OrbitControls(cam, renderer.domElement); ctl.target.set(cx, cy + 0.6, 0); ctl.enableDamping = true; ctl.maxPolarAngle = Math.PI / 2 - 0.02;
    scene.add(new THREE.AmbientLight(0xffffff, 1.2));
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(span * 4, span * 4), new THREE.MeshBasicMaterial({ color: 0x14100c })); floor.rotation.x = -Math.PI / 2; scene.add(floor);
    const grid = new THREE.GridHelper(span * 4, span * 4, 0x3a3128, 0x2a241d); scene.add(grid);
    const panels: { id: string; canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; s: VenueScreen; testImg?: HTMLImageElement }[] = [];
    for (const s of screens) { const v = s.venue; if (!v) continue;
      const canvas = document.createElement("canvas"); const scale = Math.min(1, 1024 / s.w); canvas.width = Math.max(64, Math.round(s.w * scale)); canvas.height = Math.max(16, Math.round(s.h * scale)); const ctx = canvas.getContext("2d")!;
      const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(v.wM, v.hM), new THREE.MeshBasicMaterial({ map: tex })); mesh.position.set(v.x, v.y, v.z); if (v.rot) mesh.rotation.set(v.rot[0], v.rot[1], v.rot[2]); scene.add(mesh);
      const frame = new THREE.Mesh(new THREE.PlaneGeometry(v.wM + 0.06, v.hM + 0.06), new THREE.MeshBasicMaterial({ color: 0x0a0806 })); frame.position.copy(mesh.position); frame.position.z -= 0.02; frame.rotation.copy(mesh.rotation); scene.add(frame);
      const p: (typeof panels)[number] = { id: s.id, canvas, ctx, tex, s }; if (s.testPattern) { const img = new Image(); img.crossOrigin = "anonymous"; img.src = s.testPattern; p.testImg = img; } panels.push(p);
    }
    let raf = 0; const draw = () => {
      for (const p of panels) { const { ctx, canvas } = p; ctx.fillStyle = "#000"; ctx.fillRect(0, 0, canvas.width, canvas.height); const list = els.current[p.id] ?? [];
        if (!list.length && showTest && p.testImg?.complete) { ctx.globalAlpha = .35; try { ctx.drawImage(p.testImg, 0, 0, canvas.width, canvas.height); } catch {} ctx.globalAlpha = 1; }
        for (const e of list) { try { if (e instanceof HTMLVideoElement ? e.readyState >= 2 : (e as HTMLImageElement).complete) ctx.drawImage(e as any, 0, 0, canvas.width, canvas.height); } catch {} }
        p.tex.needsUpdate = true; }
      const w = el.clientWidth, h = el.clientHeight; if (renderer.domElement.width !== w * renderer.getPixelRatio() || renderer.domElement.height !== h * renderer.getPixelRatio()) { renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); }
      ctl.update(); renderer.render(scene, cam); raf = requestAnimationFrame(draw); };
    draw();
    return () => { cancelAnimationFrame(raf); ctl.dispose(); renderer.dispose(); el.innerHTML = ""; };
  }, [screens.map((s) => s.id + JSON.stringify(s.venue)).join("|"), showTest]);
  return <div className="scene" ref={mount} />;
}

export function Venue({ big }: { big?: boolean }) {
  const { state } = useStore();
  const [data, setData] = useState<VenueData | null>(null); const [view, setView] = useState<"2d" | "3d">((localStorage.getItem("surface.venue") as any) || "2d"); const [showTest, setShowTest] = useState(true);
  const els = useRef<Record<string, HTMLElement[]>>({});
  const reload = () => fetch("/api/venue").then((r) => r.json()).then(setData).catch(() => {});
  useEffect(() => { reload(); }, [state?.current, state?.firedAt, state?.timers]);
  // proxies build in the background: poll while any layer is still waiting on one, and refresh when the server says one finished
  const pending = !!data?.screens.some((s) => LAYERS.some((l) => building(s.layers[l].url)));
  useEffect(() => { if (!pending) return; const t = setInterval(reload, 2000); return () => clearInterval(t); }, [pending]);
  useEffect(() => { const sock = useStore.getState().socket; if (!sock) return; sock.on("proxy", reload); return () => { sock.off("proxy", reload); }; }, []);
  useEffect(() => { localStorage.setItem("surface.venue", view); }, [view]);
  if (!data) return <div className="dim">loading the venue…</div>;
  const onEl = (id: string, list: HTMLElement[]) => { els.current[id] = list; };
  const src = data.screens[0]?.venue?.source;
  return (
    <div className={`venue ${big ? "big" : ""}`}>
      <div className="vhead">
        <div className="seg"><button className={view === "2d" ? "on" : ""} onClick={() => setView("2d")}>Plan</button><button className={view === "3d" ? "on" : ""} onClick={() => setView("3d")}>3D</button></div>
        <label className="dim small"><input type="checkbox" checked={showTest} onChange={(e) => setShowTest(e.target.checked)} /> test patterns when idle</label>
        <span className="dim small" style={{ marginLeft: "auto" }}>{src === "pixelgrid-3d" ? "positions from PixelGrid 3D" : src === "pixelgrid-2d" ? "positions from the PixelGrid canvas" : "automatic layout — load the PixelGrid project for real positions"}</span>
      </div>
      {/* the DOM stacks always exist: the plan shows them, the 3D scene reads them as textures */}
      <div className={view === "2d" ? "" : "offstage"}><Plan screens={data.screens} showTest={showTest} onEl={onEl} /></div>
      {view === "3d" && <Scene screens={data.screens} showTest={showTest} els={els} />}
    </div>
  );
}
