/**
 * Surface server — Run mode and Bridge mode.
 *   node --import tsx server/index.ts [show.json] [--config surface.config.json] [--port 8090] [--data <dir>] [--hub https://mantaglow.com]
 *
 * HTTP (the API the generated Companion pages call in Bridge mode):
 *   GET  /api/show                 show doc summary + surfaces
 *   GET  /api/cues                 the resolved cue list
 *   GET  /api/state                runner state (per-surface layers, current/next, round, bout)
 *   GET  /api/variables            Companion-ready variables
 *   GET  /api/health               adapter status
 *   POST /api/cue/:n/go            fire cue n (scope resolved here, fanned out to engines)
 *   POST /api/next  /api/prev  /api/panic
 *   POST /api/text/:key   {value}  live text update (round, names) to engines that accept it
 *   POST /api/media/ended {slot}   an engine or watcher reports a VT finished → follow-on
 * Socket.IO: emits "state", "fired", "revert", "error" so the GO panel and ShowCall stay live.
 *
 * Projects + hub (desktop dashboard): with cfg.dataDir set, shows live as projects under <dataDir>/projects and can be synced
 * to the MantaGlow account (GET /api/hub/status, POST /api/hub/token, POST /api/hub/signout, GET/POST /api/projects,
 * POST /api/projects/import, POST /api/projects/:id/open, DELETE /api/projects/:id, POST /api/projects/sync).
 */
import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { readFileSync, existsSync } from "node:fs";
import { deriveCues, loadShowDoc, mediaManifest } from "../core/index.js";
import { writeFileSync, readdirSync, statSync, renameSync } from "node:fs";
import { join, relative } from "node:path";
import { probe } from "../core/intake/intake.js";
import { intake } from "../core/intake/match.js";
import { planTranscodes } from "../core/intake/transcode.js";
import { executeTranscodes, type ExecEvent } from "../core/intake/execute.js";
import { ocrAvailable, ocrFile, type OcrResult } from "../core/intake/ocr.js";
import { toShowCall, fromShowCall } from "../core/integrations/showcall.js";
import { fromPixelMapper, contentGuideRows } from "../core/integrations/pixelmapper.js";
import { buildBundle } from "../core/index.js";
import type { ScreenSynonyms } from "../core/intake/tokens.js";
import { Runner } from "../core/engine/runner.js";
import { MockAdapter, ResolumeAdapter, DisguiseAdapter, CompanionAdapter } from "../core/engine/adapters.js";
import type { EngineAdapter } from "../core/engine/adapter.js";
import type { ShowDoc } from "../core/types.js";
import { parseSheet } from "../core/parse/index.js";
import { HubClient, HUB_URL } from "../core/hub/client.js";
import { ProjectStore, blankShowDoc, type HubState } from "./projects.js";

export interface SurfaceConfig {
  port?: number;
  /** where projects and the hub session live (Electron: the user-data dir). Without it the server is a single-show server. */
  dataDir?: string;
  hubUrl?: string;
  adapters: Array<
    | { type: "mock" }
    | { type: "resolume"; base?: string }
    | { type: "disguise"; host: string; rest?: boolean; oscPort?: number; transports?: Record<string, string> }
    | { type: "companion"; base?: string }
  >;
}

export function buildAdapters(cfg: SurfaceConfig, getVars: () => Record<string, string>): EngineAdapter[] {
  return cfg.adapters.map((a) => a.type === "resolume" ? new ResolumeAdapter(a.base) : a.type === "disguise" ? new DisguiseAdapter(a.host, a) : a.type === "companion" ? new CompanionAdapter(a.base, getVars) : new MockAdapter());
}

export async function startServer(showFile: string, cfg: SurfaceConfig) {
  // ── projects + hub session (optional: only when the app runs with a data dir)
  const store = cfg.dataDir ? new ProjectStore(cfg.dataDir) : null;
  let hubState: HubState = store?.readHub() ?? { token: null, session: null };
  const hub = new HubClient(hubState.token, cfg.hubUrl ?? HUB_URL);
  let activeId: string | null = null;
  // the active show: a project when one is open (its show.json), else the file we were started with
  if (store) {
    const ix = store.list(); const wanted = existsSync(join(cfg.dataDir!, "active.json")) ? JSON.parse(readFileSync(join(cfg.dataDir!, "active.json"), "utf8")).id : null;
    if (wanted && store.get(wanted)) { activeId = wanted; showFile = store.path(wanted); }
    else if (existsSync(showFile) && !showFile.startsWith(join(cfg.dataDir!, "projects"))) { const m = store.create(loadShowDoc(JSON.parse(readFileSync(showFile, "utf8")))); renameSync(showFile, `${showFile}.imported`); activeId = m.id; showFile = store.path(m.id); } // a loose show.json becomes a project once
    else if (ix[0]) { activeId = ix[0].id; showFile = store.path(activeId); }
  }
  if (!existsSync(showFile)) { const d = blankShowDoc("Untitled show"); if (store) { const m = store.create(d); activeId = m.id; showFile = store.path(m.id); } else writeFileSync(showFile, JSON.stringify(d, null, 1)); }

  let doc = loadShowDoc(JSON.parse(readFileSync(showFile, "utf8"))); let cues = deriveCues(doc, (doc as any).pack);
  let runner: Runner; const adapters = buildAdapters(cfg, () => runner.variables());
  runner = new Runner(doc, cues, adapters);
  for (const a of adapters) await a.init(doc, cues);

  const app = express(); app.use(cors()); app.use(express.json({ limit: "20mb" })); app.use(express.text({ limit: "20mb" }));
  if (process.env.SURFACE_STATIC && existsSync(process.env.SURFACE_STATIC)) { app.use(express.static(process.env.SURFACE_STATIC)); }
  const http = createServer(app); const io = new Server(http, { cors: { origin: "*" } });
  runner.on((e) => io.emit(e.type, e));

  /** Replace the live show: re-derive cues, restart the runner, persist (to the project when one is open). */
  const setShow = (next: ShowDoc, file = showFile, id = activeId) => {
    doc = next; cues = deriveCues(doc, (doc as any).pack); runner = new Runner(doc, cues, adapters); runner.on((e) => io.emit(e.type, e)); showFile = file; activeId = id;
    if (store && activeId) store.update(activeId, doc); else writeFileSync(showFile, JSON.stringify(doc, null, 1));
    if (store && cfg.dataDir) writeFileSync(join(cfg.dataDir, "active.json"), JSON.stringify({ id: activeId }));
    io.emit("show", { type: "show", event: doc.event, project: activeId });
  };
  const persist = () => setShow(doc);

  // ── authoring endpoints used by the desktop UI
  app.get("/api/doc", (_q, res) => res.json(doc));
  app.put("/api/doc", (q, res) => { setShow(loadShowDoc(q.body)); res.json({ ok: true, cues: cues.length }); });
  app.post("/api/review/approve", (_q, res) => { doc.review.status = "approved"; persist(); res.json({ ok: true }); });

  // ── hub account + projects (the dashboard)
  const hubStatus = () => ({ hubUrl: cfg.hubUrl ?? HUB_URL, signedIn: hub.signedIn, user: hubState.session?.user ?? null, organization: hubState.session?.organization ?? null, apps: hubState.session?.apps ?? [], checkedAt: hubState.checkedAt, error: hubState.error, projectsEnabled: !!store });
  const saveHub = () => { if (store) store.writeHub(hubState); };
  app.get("/api/hub/status", async (q, res) => {
    if (q.query.refresh && hub.signedIn) { try { hubState = { ...hubState, session: await hub.me(), checkedAt: new Date().toISOString(), error: undefined }; } catch (e: any) { hubState = { ...hubState, checkedAt: new Date().toISOString(), error: e.message }; if (/expired/.test(e.message)) { hubState.token = null; hub.setToken(null); } } saveHub(); }
    res.json(hubStatus());
  });
  app.post("/api/hub/token", async (q, res) => {
    const token: string = q.body?.token; if (!token) return res.status(400).json({ error: "token required" });
    hub.setToken(token);
    try { const session = await hub.me(); hubState = { token, session, checkedAt: new Date().toISOString() }; saveHub(); res.json(hubStatus()); }
    catch (e: any) { hub.setToken(hubState.token); res.status(401).json({ error: e.message }); }
  });
  app.post("/api/hub/signout", (_q, res) => { hubState = { token: null, session: null }; hub.setToken(null); saveHub(); res.json(hubStatus()); });
  const projectsView = () => ({ enabled: !!store, active: activeId, projects: store?.list() ?? [] });
  app.get("/api/projects", (_q, res) => res.json(projectsView()));
  app.post("/api/projects", (q, res) => {
    if (!store) return res.status(400).json({ error: "projects need a data dir" });
    const d = q.body?.doc ? loadShowDoc(q.body.doc) : blankShowDoc(q.body?.name ?? "Untitled show", { date: q.body?.date, venue: q.body?.venue, pack: q.body?.pack });
    const m = store.create(d); if (q.body?.open !== false) setShow(d, store.path(m.id), m.id); res.json({ ok: true, project: m, ...projectsView() });
  });
  /** A sheet (pdftotext -layout text) becomes a new project, or merges into the open one with ?into=active. */
  app.post("/api/projects/import", (q, res) => {
    const text: string = typeof q.body === "string" ? q.body : q.body?.text; const file: string = q.body?.file ?? "sheet.txt"; if (!text) return res.status(400).json({ error: "text required" });
    const r = parseSheet(text, file); if ("kind" in r && r.kind === "rundown") return res.status(422).json({ error: "that is a running order — import it into an open project from the Review tab", rundown: r.rundown });
    const d = r as ShowDoc; if (q.body?.name) d.event.name = q.body.name;
    if (!store) { setShow(d); return res.json({ ok: true, project: null, ...projectsView() }); }
    const m = store.create(d); setShow(d, store.path(m.id), m.id); res.json({ ok: true, project: m, flags: d.review.flags, ...projectsView() });
  });
  app.post("/api/projects/:id/open", (q, res) => { if (!store) return res.status(400).json({ error: "projects need a data dir" }); const d = store.readDoc(q.params.id); if (!d) return res.status(404).json({ error: "no such project" }); activeId = q.params.id; showFile = store.path(activeId); doc = loadShowDoc(d); cues = deriveCues(doc, (doc as any).pack); runner = new Runner(doc, cues, adapters); runner.on((e) => io.emit(e.type, e)); writeFileSync(join(cfg.dataDir!, "active.json"), JSON.stringify({ id: activeId })); io.emit("show", { type: "show", event: doc.event, project: activeId }); res.json({ ok: true, ...projectsView() }); });
  app.delete("/api/projects/:id", async (q, res) => { if (!store) return res.status(400).json({ error: "projects need a data dir" }); if (q.params.id === activeId) return res.status(409).json({ error: "close it first (open another project)" }); store.remove(q.params.id); if (q.query.cloud && hub.signedIn) { try { await hub.delete(`project:${q.params.id}`); } catch (e: any) { return res.json({ ok: true, warning: `removed locally; hub: ${e.message}`, ...projectsView() }); } } res.json({ ok: true, ...projectsView() }); });
  app.post("/api/projects/sync", async (_q, res) => { if (!store) return res.status(400).json({ error: "projects need a data dir" }); if (!hub.signedIn) return res.status(401).json({ error: "sign in first" }); const r = await store.sync(hub); if (activeId && !store.get(activeId)) activeId = null; if (r.errors.some((e) => /expired/.test(e))) { hubState = { ...hubState, error: "session expired — sign in again" }; saveHub(); } res.json({ ok: true, ...r, ...projectsView() }); });
  app.get("/api/manifest", (_q, res) => res.json(mediaManifest(doc, cues)));
  let lastIntake: any = null;
  app.post("/api/intake", async (q, res) => {
    const dir: string = q.body?.dir; if (!dir) return res.status(400).json({ error: "dir required" });
    const walk = (d: string): string[] => { try { return readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.(mov|mp4|mxf|avi|png|jpe?g|tif|webp)$/i.test(f) ? [p] : []; }); } catch { return []; } };
    const files = walk(dir); const probes = [];
    for (const f of files) { try { const p = await probe(f); p.file = relative(dir, f).replace(/\\/g, "/"); probes.push(p); } catch {} }
    const syn: ScreenSynonyms = Object.fromEntries(doc.screens.map((s) => [s.id, { words: [s.id.toLowerCase().replace(/_/g, " "), s.name.toLowerCase(), ...(((doc as any).screenWords ?? {})[s.id] ?? [])], w: s.w, h: s.h }]));
    const man = mediaManifest(doc, cues);
    let r = intake(doc, man, probes, syn, { override: q.body?.override });
    // second pass: OCR only the files the first pass could not place confidently, then match again with the words it read
    let ocrRan = 0; if (q.body?.ocr && (await ocrAvailable())) {
      const weak = new Set([...r.unmatched.map((u) => u.file), ...r.assignments.filter((a) => a.confidence < 0.7).map((a) => a.file)]);
      const ocr: Record<string, OcrResult> = {}; const list = probes.filter((p) => weak.has(p.file)); let i = 0;
      await Promise.all(Array.from({ length: 3 }, async () => { for (let p = list[i++]; p; p = list[i++]) { try { ocr[p.file] = await ocrFile(join(dir, p.file), p); ocrRan++; io.emit("intake", { phase: "ocr", file: p.file, done: ocrRan, total: list.length }); } catch {} } }));
      r = intake(doc, man, probes, syn, { override: q.body?.override, ocr });
    }
    const jobs = planTranscodes(r.assignments, probes, man, { engine: q.body?.engine ?? "resolume", outDir: q.body?.outDir ?? join(dir, "..", "media"), deleteOriginals: false });
    lastIntake = { dir, probes: probes.length, ocrRan, scheme: r.scheme, assignments: r.assignments, unmatched: r.unmatched.map((u) => ({ file: u.file, why: u.why, candidates: u.candidates, ocr: (u.evidence as any).ocr?.words?.slice(0, 6) })), ignored: r.ignored, unfilled: r.unfilled, issues: r.issues, jobs };
    res.json(lastIntake);
  });
  app.get("/api/intake", (_q, res) => res.json(lastIntake));
  // ── transcode execution: runs the last plan; progress over Socket.IO ("transcode" events); originals deleted only if asked and only after verify
  let transcodeRun: { running: boolean; started?: string; events: ExecEvent[]; result?: any } = { running: false, events: [] };
  app.post("/api/transcode", async (q, res) => {
    if (!lastIntake) return res.status(400).json({ error: "run intake first" }); if (transcodeRun.running) return res.status(409).json({ error: "already running" });
    transcodeRun = { running: true, started: new Date().toISOString(), events: [] }; res.json({ ok: true, jobs: lastIntake.jobs.length });
    const onProgress = (e: ExecEvent) => { transcodeRun.events.push(e); if (transcodeRun.events.length > 5000) transcodeRun.events.splice(0, 1000); io.emit("transcode", e); };
    try { transcodeRun.result = await executeTranscodes(lastIntake.jobs, { srcRoot: lastIntake.dir, concurrency: Number(q.body?.concurrency ?? 2), deleteOriginals: !!q.body?.deleteOriginals, onProgress }); }
    catch (e: any) { transcodeRun.result = { error: e.message }; } finally { transcodeRun.running = false; io.emit("transcode", { job: "*", phase: "done", detail: "all jobs finished" }); }
  });
  app.get("/api/transcode", (_q, res) => res.json({ running: transcodeRun.running, started: transcodeRun.started, recent: transcodeRun.events.slice(-50), result: transcodeRun.result }));
  // ── ShowCall / PixelMapper bridges and the author-only bundle
  app.get("/api/export/showcall", (_q, res) => res.json(toShowCall(doc, cues)));
  app.post("/api/import/showcall", (q, res) => { const extra = fromShowCall(cues, q.body?.cues ?? q.body ?? []); doc.customCues = [...(doc.customCues ?? []).filter((c) => !String(c.id).startsWith("SC.")), ...extra]; persist(); res.json({ ok: true, imported: extra.length, cues: cues.length }); });
  app.post("/api/import/pixelmapper", (q, res) => { const r = fromPixelMapper(q.body); doc.screens = r.screens; doc.surfaces = r.surfaces; (doc as any).screenWords = r.screenWords; doc.review.flags = [...doc.review.flags.filter((f) => !/placeholder/i.test(f)), ...r.flags]; persist(); res.json({ ok: true, screens: r.screens.length, surfaces: r.surfaces.length, flags: r.flags, cues: cues.length }); });
  app.get("/api/content-guide", (_q, res) => res.json(contentGuideRows(doc.screens, doc.surfaces)));
  app.post("/api/bundle", async (q, res) => { const outDir = q.body?.outDir ?? join(process.cwd(), "out", doc.event.id); const files = await buildBundle(doc, cues, { outDir, companion: { mode: q.body?.mode ?? "bridge", surfaceHost: q.body?.host ?? `127.0.0.1:${cfg.port ?? 8090}` } }); res.json({ ok: true, outDir, files }); });
  app.get("/api/show", (_q, res) => res.json({ event: doc.event, surfaces: doc.surfaces, screens: doc.screens, review: doc.review, cueCount: cues.length, project: activeId }));
  app.get("/api/cues", (_q, res) => res.json(cues));
  app.get("/api/state", (_q, res) => res.json(runner.getState()));
  app.get("/api/variables", (_q, res) => res.json(runner.variables()));
  app.get("/api/health", (_q, res) => res.json({ adapters: adapters.map((a) => a.status()), uptimeSec: Math.round(process.uptime()) }));
  app.post("/api/cue/:n/go", async (q, res) => { const c = await runner.go(Number(q.params.n)); c ? res.json({ ok: true, cue: { n: c.n, id: c.id, name: c.name } }) : res.status(404).json({ ok: false, error: `no cue ${q.params.n}` }); });
  app.post("/api/cue/:id/go-by-id", async (q, res) => { const c = cues.find((x) => x.id === q.params.id); c ? res.json({ ok: true, cue: await runner.go(c.n) }) : res.status(404).json({ ok: false }); });
  app.post("/api/next", async (_q, res) => res.json({ ok: true, cue: (await runner.next())?.id ?? null }));
  app.post("/api/prev", async (_q, res) => res.json({ ok: true, cue: (await runner.prev())?.id ?? null }));
  app.post("/api/panic", async (_q, res) => { await runner.panic(); res.json({ ok: true }); });
  app.post("/api/text/:key", async (q, res) => { const value = typeof q.body === "string" ? q.body : q.body?.value ?? ""; for (const a of adapters) for (const s of doc.surfaces) await a.apply({ kind: "setText", surface: s.id, layer: "OVERLAY", key: q.params.key, value }).catch(() => {}); res.json({ ok: true }); });
  app.post("/api/media/ended", async (q, res) => { await runner.mediaEnded(q.body?.slot ?? ""); res.json({ ok: true }); });
  io.on("connection", (s) => { s.emit("state", { type: "state", state: runner.getState() }); s.on("go", (n: number) => void runner.go(n)); s.on("next", () => void runner.next()); s.on("panic", () => void runner.panic()); });

  if (process.env.SURFACE_STATIC && existsSync(process.env.SURFACE_STATIC)) app.get(/^(?!\/api|\/socket\.io).*/, (_q, res) => res.sendFile(join(process.env.SURFACE_STATIC!, "index.html")));
  const port = cfg.port ?? 8090;
  await new Promise<void>((r) => http.listen(port, r));
  console.log(`Surface ${doc.event.name} — ${cues.length} cues · ${doc.surfaces.length} surfaces · adapters: ${adapters.map((a) => `${a.id}${a.status().connected ? "" : " (offline)"}`).join(", ")} · http://127.0.0.1:${port}`);
  return { app, http, io, runner, adapters, close: async () => { for (const a of adapters) await a.close(); io.close(); http.close(); } };
}

if (process.argv[1] && /server[\\/]index\.[tj]s$/.test(process.argv[1])) {
  const args = process.argv.slice(2); const flag = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
  const show = args.find((a) => !a.startsWith("--") && a.endsWith(".json") && !args.includes(`--config`) || a === flag("show", "")) ?? args[0] ?? "show.json";
  const cfgFile = flag("config", "surface.config.json");
  const cfg: SurfaceConfig = existsSync(cfgFile) ? JSON.parse(readFileSync(cfgFile, "utf8")) : { adapters: [{ type: "mock" }] };
  if (flag("port", "")) cfg.port = Number(flag("port", "8090"));
  if (flag("data", "")) cfg.dataDir = flag("data", ""); if (flag("hub", "")) cfg.hubUrl = flag("hub", "");
  startServer(show, cfg).catch((e) => { console.error(e); process.exit(1); });
}
