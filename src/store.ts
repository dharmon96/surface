import { create } from "zustand";
import { io, type Socket } from "socket.io-client";
import type { Cue, ShowDoc } from "../core/types";
import type { RunnerState } from "../core/engine/runner";

const j = async <T,>(url: string, init?: RequestInit): Promise<T> => { const r = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init }); if (!r.ok) throw new Error(`${init?.method ?? "GET"} ${url} → ${r.status}`); return r.json(); };

export interface Health { adapters: { id: string; connected: boolean; detail?: string; latencyMs?: number; lastError?: string }[]; uptimeSec: number }
export interface HubStatus { hubUrl: string; signedIn: boolean; user: { id: string; email: string; name: string | null; image: string | null } | null; organization: { id: string; name: string } | null; apps: { slug: string; name: string }[]; checkedAt?: string; error?: string; projectsEnabled: boolean }
export interface ProjectMeta { id: string; name: string; eventDate?: string; venue?: string; pack: string; createdAt: string; updatedAt: string; cloudUpdatedAt?: string | null; sync: "local" | "synced" | "ahead" | "behind" | "conflict" | "error"; error?: string; visibility?: string }
export interface ProjectsView { enabled: boolean; active: string | null; projects: ProjectMeta[] }
export interface SyncResult { pushed: number; pulled: number; conflicts: string[]; errors: string[]; at: string }
export type SlotStatus = "ready" | "convert" | "missing";
export interface BoardSlot { slot: string; screen: string; w: number; h: number; status: SlotStatus; file?: string; out?: string; thumb?: string; note?: string; confidence?: number }
export interface BoardCell { key: string; label: string; cues: { n: number; id: string; name: string }[]; slots: BoardSlot[]; status: SlotStatus | "none"; thumb?: string; behaviour?: string }
export interface BoardRow { id: string; kind: "event" | "bout"; order: number; title: string; red?: { id: string; name: string; country?: string }; blue?: { id: string; name: string; country?: string }; meta: { rounds?: number; weightClass?: string; title?: string; isMain?: boolean; isCoMain?: boolean }; flags: string[]; cells: Record<string, BoardCell>; rounds?: { n: number; cue: number; status: SlotStatus | "none"; slots: BoardSlot[] }[]; asks: { key: string; question: string }[] }
export interface Board { columns: { key: string; label: string; sub?: string }[]; rows: BoardRow[]; screens: { id: string; name: string; w: number; h: number; ready: number; total: number }[]; missing: { row: string; label: string; screens: string[]; kind: SlotStatus }[]; totals: { slots: number; ready: number; convert: number; missing: number; files: number; unmatched: number }; delivery?: { dir: string; files: number; scheme: any; ocrRan?: number } }
export interface IntakeView { dir: string; probes: number; ocrRan?: number; scheme: any; assignments: any[]; unmatched: any[]; ignored: any[]; unfilled: string[]; issues: string[]; jobs: any[] }

interface S {
  doc: ShowDoc | null; cues: Cue[]; state: RunnerState | null; health: Health | null; intake: IntakeView | null; log: string[]; socket: Socket | null; error: string | null;
  transcode: { running: boolean; progress: Record<string, { phase: string; pct?: number; detail?: string }>; result?: any };
  hub: HubStatus | null; projects: ProjectsView | null; lastSync: SyncResult | null; hubBusy: string | null;
  /** selection is a key, not a snapshot — the rail always renders the live cell, even after a prepare run refreshes the board */
  drawer: string | null; setDrawer(d: string | null): void; selected: { row: string; cellKey: string } | null; select(sel: { row: string; cellKey: string } | null): void;
  board: Board | null; mode: "prepare" | "run"; prepare: { phase: string; detail?: string; dir?: string } | null; versions: { file: string; at: string; diff: string[] }[]; build: { engine: string; done: number; total: number } | null;
  pixelgrid: { id: string; name: string; screens?: number; updatedAt: string }[] | null; loadPixelGrid(): Promise<void>; importPixelGrid(id: string): Promise<string>; importScreenMaps(o: { dir?: string; files?: string[] }): Promise<string>;
  loadBoard(): Promise<void>; setMode(m: "prepare" | "run"): void; runPrepare(dir: string, deleteOriginals: boolean): Promise<void>; dropSheet(text: string, file: string): Promise<string[]>; buildResolume(): Promise<string>; requestText(): Promise<string>;
  loadHub(refresh?: boolean): Promise<void>; signIn(): Promise<void>; signOut(): Promise<void>; syncProjects(): Promise<void>;
  createProject(p: { name: string; date?: string; venue?: string; pack?: string }): Promise<void>; loadSample(): Promise<void>; importSheet(text: string, file: string): Promise<string[]>; openProject(id: string): Promise<void>; deleteProject(id: string, cloud: boolean): Promise<void>;
  load(): Promise<void>; connect(): void; go(n: number): Promise<void>; next(): Promise<void>; prev(): Promise<void>; panic(): Promise<void>;
  approve(): Promise<void>; saveDoc(d: ShowDoc): Promise<void>; runIntake(dir: string, override?: any, engine?: string, ocr?: boolean): Promise<void>; refreshHealth(): Promise<void>;
  startTranscode(deleteOriginals: boolean): Promise<void>;
}

export const useStore = create<S>((set, get) => ({
  doc: null, cues: [], state: null, health: null, intake: null, log: [], socket: null, error: null, transcode: { running: false, progress: {} },
  hub: null, projects: null, lastSync: null, hubBusy: null,
  drawer: null, setDrawer(d) { set({ drawer: d }); }, selected: null, select(sel) { set({ selected: sel }); },
  board: null, mode: (localStorage.getItem("surface.mode") as any) || "prepare", prepare: null, versions: [], build: null,
  pixelgrid: null,
  async loadPixelGrid() { try { set({ pixelgrid: await j("/api/hub/pixelgrid") }); } catch { set({ pixelgrid: [] }); } },
  async importPixelGrid(id) { try { const r = await j<{ screens: number; surfaces: number; patterns: number; flags: string[] }>("/api/import/pixelmapper/hub", { method: "POST", body: JSON.stringify({ id }) }); await get().load(); return `Loaded ${r.screens} screens (${r.surfaces} surfaces), ${r.patterns} test patterns${r.flags.length ? ` — ${r.flags.join("; ")}` : ""}`; } catch (e: any) { return `PixelGrid import failed: ${e.message}`; } },
  async importScreenMaps(o) { try { const r = await j<{ screens: number; project?: string; ids: string[] }>("/api/import/screenmaps", { method: "POST", body: JSON.stringify(o) }); await get().load(); return `Loaded ${r.screens} screens from screen maps${r.project ? ` (${r.project})` : ""}: ${r.ids.join(", ")}`; } catch (e: any) { return `Screen maps failed: ${e.message}`; } },
  async loadBoard() { try { const [board, versions] = await Promise.all([j<Board>("/api/board"), j<any[]>("/api/versions")]); set({ board, versions }); } catch {} },
  setMode(m) { localStorage.setItem("surface.mode", m); set({ mode: m, selected: null }); },
  async runPrepare(dir, deleteOriginals) { set({ prepare: { phase: "probing", dir }, transcode: { running: true, progress: {} } }); try { await j("/api/prepare", { method: "POST", body: JSON.stringify({ dir, deleteOriginals }) }); } catch (e: any) { set({ prepare: { phase: "failed", detail: e.message }, transcode: { running: false, progress: {} } }); } },
  async dropSheet(text, file) { const r = await j<{ diff: string[]; flags: string[] }>("/api/sheet", { method: "POST", body: JSON.stringify({ text, file }) }); await get().load(); await get().loadBoard(); return r.diff; },
  async buildResolume() { set({ build: { engine: "resolume", done: 0, total: 1 } }); try { const r = await j<{ ops: number }>("/api/build/resolume", { method: "POST", body: "{}" }); return `Resolume built — ${r.ops} operations`; } catch (e: any) { return `Resolume build failed: ${e.message}`; } finally { set({ build: null }); } },
  async requestText() { const r = await fetch("/api/board/request"); return r.text(); },
  async loadHub(refresh = false) { try { const [hub, projects] = await Promise.all([j<HubStatus>(`/api/hub/status${refresh ? "?refresh=1" : ""}`), j<ProjectsView>("/api/projects")]); set({ hub, projects }); } catch {} },
  async signIn() {
    const d = (window as any).surface; set({ hubBusy: "signing in…" });
    try {
      if (d?.hubSignIn) { const r = await d.hubSignIn(); if (r?.error) throw new Error(r.error); set({ hub: r }); }
      else { const token = window.prompt("Paste your MantaGlow session token (desktop app signs in automatically):"); if (!token) return; set({ hub: await j<HubStatus>("/api/hub/token", { method: "POST", body: JSON.stringify({ token }) }) }); }
      await get().syncProjects();
    } catch (e: any) { set({ error: `Sign-in failed: ${e.message}` }); } finally { set({ hubBusy: null }); await get().loadHub(); }
  },
  async signOut() { const d = (window as any).surface; if (d?.hubSignOut) await d.hubSignOut(); else await j("/api/hub/signout", { method: "POST" }); await get().loadHub(); },
  async syncProjects() { set({ hubBusy: "syncing…" }); try { const r = await j<SyncResult & ProjectsView>("/api/projects/sync", { method: "POST" }); set({ lastSync: { pushed: r.pushed, pulled: r.pulled, conflicts: r.conflicts, errors: r.errors, at: new Date().toLocaleTimeString() }, projects: { enabled: r.enabled, active: r.active, projects: r.projects } }); } catch (e: any) { set({ error: `Sync failed: ${e.message}` }); } finally { set({ hubBusy: null }); } },
  async loadSample() { const r = await j<ProjectsView>("/api/projects/sample", { method: "POST" }); set({ projects: { enabled: r.enabled, active: r.active, projects: r.projects } }); await get().load(); },
  async createProject(p) { const r = await j<ProjectsView>("/api/projects", { method: "POST", body: JSON.stringify(p) }); set({ projects: { enabled: r.enabled, active: r.active, projects: r.projects } }); await get().load(); },
  async importSheet(text, file) { const r = await j<ProjectsView & { flags: string[] }>("/api/projects/import", { method: "POST", body: JSON.stringify({ text, file }) }); set({ projects: { enabled: r.enabled, active: r.active, projects: r.projects } }); await get().load(); return r.flags ?? []; },
  async openProject(id) { const r = await j<ProjectsView>(`/api/projects/${id}/open`, { method: "POST" }); set({ projects: { enabled: r.enabled, active: r.active, projects: r.projects }, intake: null, selected: null }); await get().load(); },
  async deleteProject(id, cloud) { const r = await j<ProjectsView & { warning?: string }>(`/api/projects/${id}${cloud ? "?cloud=1" : ""}`, { method: "DELETE" }); set({ projects: { enabled: r.enabled, active: r.active, projects: r.projects }, error: r.warning ?? null }); },
  async load() {
    try { const [doc, cues, state, health, intake] = await Promise.all([j<ShowDoc>("/api/doc"), j<Cue[]>("/api/cues"), j<RunnerState>("/api/state"), j<Health>("/api/health"), j<IntakeView | null>("/api/intake")]); set({ doc, cues, state, health, intake, error: null }); get().loadBoard(); }
    catch (e: any) { set({ error: `Server not reachable (${e.message}). Start it with: npm run server -- show.json` }); }
  },
  connect() {
    if (get().socket) return;
    const s = io("/", { path: "/socket.io" });
    s.on("state", (e: any) => set({ state: e.state }));
    s.on("show", () => { get().load(); get().loadHub(); get().loadBoard(); });
    s.on("board", () => { get().loadBoard(); });
    s.on("prepare", (e: any) => set({ prepare: e.phase === "probing" ? { ...e, phase: "reading files" } : e }));
    // live intake progress: probing (parallel ffprobe) and the OCR pass, as "reading files 120/300"
    s.on("intake", (e: any) => set((st) => {
      if (e.phase === "done") return /reading/.test(st.prepare?.phase ?? "") ? { prepare: null } : {};
      return { prepare: { phase: e.phase === "ocr" ? "reading text on unplaced files" : "reading files", detail: e.total ? `${e.done}/${e.total}` : undefined, dir: st.prepare?.dir } };
    }));
    s.on("build", (e: any) => set({ build: e }));
    s.on("fired", (e: any) => set((st) => ({ log: [`${new Date().toLocaleTimeString()}  GO ${String(e.cue.n).padStart(3, "0")} ${e.cue.id}  ${e.cue.name}`, ...st.log].slice(0, 200) })));
    s.on("revert", (e: any) => set((st) => ({ log: [`${new Date().toLocaleTimeString()}  ↩ ${e.surface}/${e.layer} back to base`, ...st.log].slice(0, 200) })));
    s.on("transcode", (e: any) => set((st) => { if (e.job === "*") { get().loadBoard(); return { transcode: { ...st.transcode, running: false } }; } return { transcode: { ...st.transcode, running: true, progress: { ...st.transcode.progress, [e.job]: { phase: e.phase, pct: e.pct, detail: e.detail } } } }; }));
    s.on("error", (e: any) => set((st) => ({ log: [`${new Date().toLocaleTimeString()}  ✗ ${e.adapter}: ${e.error}`, ...st.log].slice(0, 200) })));
    set({ socket: s });
  },
  async go(n) { await j(`/api/cue/${n}/go`, { method: "POST" }); },
  async next() { await j("/api/next", { method: "POST" }); },
  async prev() { await j("/api/prev", { method: "POST" }); },
  async panic() { await j("/api/panic", { method: "POST" }); },
  async approve() { await j("/api/review/approve", { method: "POST" }); await get().load(); },
  async saveDoc(d) { await j("/api/doc", { method: "PUT", body: JSON.stringify(d) }); await get().load(); },
  async runIntake(dir, override, engine, ocr) { const r = await j<IntakeView>("/api/intake", { method: "POST", body: JSON.stringify({ dir, override, engine, ocr }) }); set({ intake: r }); },
  async startTranscode(deleteOriginals) { set((st) => ({ transcode: { ...st.transcode, running: true, progress: {} } })); await j("/api/transcode", { method: "POST", body: JSON.stringify({ deleteOriginals }) }); },
  async refreshHealth() { set({ health: await j<Health>("/api/health") }); },
}));
