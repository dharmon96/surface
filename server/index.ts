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
import { createServer } from "node:http";
import { Server } from "socket.io";
import { readFileSync, existsSync } from "node:fs";
import { deriveCues, loadShowDoc, mediaManifest, publishCueNumbers } from "../core/index.js";
import { writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve as resolvePath, sep } from "node:path";
import { probe, type Probe } from "../core/intake/intake.js";
import { intake, type IntakeOptions } from "../core/intake/match.js";
import { deliveryItems } from "../core/intake/confirm.js";
import { deck, applyDecision, intakeOptionsFrom, decisionText, isDocKind } from "../core/review.js";
import { planTranscodes } from "../core/intake/transcode.js";
import { executeTranscodes, type ExecEvent } from "../core/intake/execute.js";
import { ocrAvailable, ocrFile, type OcrResult } from "../core/intake/ocr.js";
import { toShowCall, fromShowCall } from "../core/integrations/showcall.js";
import { fromPixelMapper, contentGuideRows, autoRouting, autoVenue, autoOutputs, screensFromMapFiles } from "../core/integrations/pixelmapper.js";
import { copyFileSync, mkdirSync as mkdirSync2 } from "node:fs";
import { basename, dirname } from "node:path";
import { buildBundle } from "../core/index.js";
import type { ScreenSynonyms } from "../core/intake/tokens.js";
import { Runner } from "../core/engine/runner.js";
import { MockAdapter, ResolumeAdapter, DisguiseAdapter, CompanionAdapter } from "../core/engine/adapters.js";
import type { EngineAdapter } from "../core/engine/adapter.js";
import type { ShowDoc, OutputCanvas, ConfirmItem } from "../core/types.js";
import { parseSheet } from "../core/parse/index.js";
import { HubClient, HUB_URL } from "../core/hub/client.js";
import { ProjectStore, blankShowDoc, type HubState } from "./projects.js";
import { buildBoard, promoterRequest } from "./board.js";
import { ProxyStore } from "./proxy.js";
import { mergeSheets } from "../core/parse/index.js";
import { resolumePlan } from "../core/gen/engines.js";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, statSync as statSyncFs } from "node:fs";
import { tmpdir, networkInterfaces } from "node:os";

export interface SurfaceConfig {
  port?: number;
  /** interface to listen on. Default 127.0.0.1 (the console PC only). Bridge mode with Companion on ANOTHER machine
   *  needs "0.0.0.0" (--bind) — the API is unauthenticated, so open it up only on a trusted show network. */
  bind?: string;
  /** where to persist engine settings changed from the UI (the file the server was started with) */
  configFile?: string;
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
  let lastIntake: any = null;
  let hubState: HubState = store?.readHub() ?? { token: null, session: null };
  const hub = new HubClient(hubState.token, cfg.hubUrl ?? HUB_URL);
  let activeId: string | null = null;
  // the active show: a project when one is open (its show.json), else the file we were started with
  if (store) {
    const ix = store.list(); const wanted = existsSync(join(cfg.dataDir!, "active.json")) ? JSON.parse(readFileSync(join(cfg.dataDir!, "active.json"), "utf8")).id : null;
    if (wanted && store.get(wanted)) { activeId = wanted; showFile = store.path(wanted); }
    else if (existsSync(showFile) && !showFile.startsWith(join(cfg.dataDir!, "projects"))) {
      // a loose show.json becomes a project once; remembered in imported.json (never touch the file itself)
      const impFile = join(cfg.dataDir!, "imported.json"); const imported: Record<string, string> = existsSync(impFile) ? JSON.parse(readFileSync(impFile, "utf8")) : {};
      const known = imported[showFile] && store.get(imported[showFile]) ? imported[showFile] : null;
      if (known) { activeId = known; showFile = store.path(known); }
      else { const m = store.create(loadShowDoc(JSON.parse(readFileSync(showFile, "utf8")))); imported[showFile] = m.id; writeFileSync(impFile, JSON.stringify(imported, null, 1)); activeId = m.id; showFile = store.path(m.id); }
    }
    else if (ix[0]) { activeId = ix[0].id; showFile = store.path(activeId); }
  }
  if (!existsSync(showFile)) { const d = blankShowDoc("Untitled show"); if (store) { const m = store.create(d); activeId = m.id; showFile = store.path(m.id); } else writeFileSync(showFile, JSON.stringify(d, null, 1)); }

  let doc = loadShowDoc(JSON.parse(readFileSync(showFile, "utf8"))); let cues = deriveCues(doc, (doc as any).pack);
  let runner: Runner; const adapters = buildAdapters(cfg, () => runner.variables());
  runner = new Runner(doc, cues, adapters);
  for (const a of adapters) await a.init(doc, cues);

  // no CORS wildcard: the UI is same-origin (Electron serves dist/, Vite dev proxies /api and /socket.io),
  // and Bridge-mode Companion calls are server-to-server — a drive-by web page must not be able to fire cues
  const app = express(); app.use(express.json({ limit: "20mb" })); app.use(express.text({ limit: "20mb" }));
  if (process.env.SURFACE_STATIC && existsSync(process.env.SURFACE_STATIC)) { app.use(express.static(process.env.SURFACE_STATIC)); }
  const http = createServer(app); const io = new Server(http);
  runner.on((e) => io.emit(e.type, e));
  /** wrap an async route so a thrown error becomes a 500, never an unhandled rejection that hangs the request */
  const guard = (fn: (q: any, res: any) => Promise<unknown> | unknown) => (q: any, res: any) => Promise.resolve(fn(q, res)).catch((e: any) => { if (!res.headersSent) res.status(500).json({ error: String(e?.message ?? e) }); });

  const proxies = new ProxyStore(join(cfg.dataDir ?? tmpdir(), "surface-proxies"));
  /** file-serving endpoints (?f=<abs>) only ever serve from the show's own directories — never the whole disk */
  const allowedFile = (f: string) => {
    if (!f) return false;
    const roots = [doc.mediaRoot, lastIntake?.dir, lastIntake?.mediaDir, doc.delivery?.dir, mediaRootOf()].filter(Boolean) as string[];
    const rf = resolvePath(f).toLowerCase();
    return roots.some((r) => { const rr = resolvePath(r).toLowerCase(); return rf === rr || rf.startsWith(rr + sep); });
  };
  /** the show's audio standard (default: level-match to −18 LUFS, peaks under −1 dBTP) */
  const levelMatchOpts = () => (doc.audio?.levelMatch ?? true) ? { targetLufs: doc.audio?.targetLufs ?? -18, ceilingDbTp: doc.audio?.ceilingDbTp ?? -1 } : false as const;
  /** Where this project's converted media lives: set by the first Prepare, else beside the project file. */
  const mediaRootOf = () => doc.mediaRoot ?? lastIntake?.mediaDir ?? join(dirname(showFile), "media");
  /** After a conversion run: remember slot → file so every cue (and every engine build) points at the converted media. */
  const absorbManifest = (mediaDir: string) => {
    const mp = join(mediaDir, "_manifest.json"); if (!existsSync(mp)) return;
    const man: { slot: string; outputs: string[] }[] = JSON.parse(readFileSync(mp, "utf8")); const media = { ...(doc.media ?? {}) };
    for (const m of man) if (m.outputs?.[0]) media[m.slot] = relative(mediaDir, m.outputs[0]).replace(/\\/g, "/");
    setShow({ ...doc, mediaRoot: doc.mediaRoot ?? mediaDir, media });
    // preview proxies in the background so the Venue view never waits at show time
    void proxies.warm(man.map((m) => m.outputs?.[0]).filter(Boolean), () => io.emit("proxy", { type: "proxy" }));
  };
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
  // a stale Card-details draft must not erase answers given since it was loaded: live decisions win
  app.put("/api/doc", (q, res) => { const body = loadShowDoc(q.body); setShow({ ...body, decisions: { ...(body.decisions ?? {}), ...(doc.decisions ?? {}) } }); res.json({ ok: true, cues: cues.length }); });
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
  /** the Glendale sample card, for trying the app with no sheet in hand */
  app.post("/api/projects/sample", (_q, res) => {
    const cands = [new URL("../fixtures/2026-06-13-glendale.bout.json", import.meta.url), new URL("../../fixtures/2026-06-13-glendale.bout.json", import.meta.url)].map((u) => decodeURIComponent(u.pathname.replace(/^\/([A-Za-z]:)/, "$1")));
    const f = cands.find((c) => existsSync(c)); if (!f) return res.status(404).json({ error: "sample not bundled" });
    const d = loadShowDoc(JSON.parse(readFileSync(f, "utf8"))); d.event.name = "Sample card — Vargas v Rodriguez";
    if (store) { const m = store.create(d); setShow(d, store.path(m.id), m.id); } else setShow(d);
    res.json({ ok: true, ...projectsView() });
  });
  app.post("/api/projects/import", (q, res) => {
    const text: string = typeof q.body === "string" ? q.body : q.body?.text; const file: string = q.body?.file ?? "sheet.txt"; if (!text) return res.status(400).json({ error: "text required" });
    const r = parseSheet(text, file); if ("kind" in r && r.kind === "rundown") return res.status(422).json({ error: "that is a running order — import it into an open project from the Review tab", rundown: r.rundown });
    const d = r as ShowDoc; if (q.body?.name) d.event.name = q.body.name;
    if (!store) { setShow(d); return res.json({ ok: true, project: null, ...projectsView() }); }
    const m = store.create(d); setShow(d, store.path(m.id), m.id); res.json({ ok: true, project: m, flags: d.review.flags, ...projectsView() });
  });
  app.post("/api/projects/:id/open", (q, res) => { if (!store) return res.status(400).json({ error: "projects need a data dir" }); const d = store.readDoc(q.params.id); if (!d) return res.status(404).json({ error: "no such project" }); activeId = q.params.id; showFile = store.path(activeId); doc = loadShowDoc(d); cues = deriveCues(doc, (doc as any).pack); runner = new Runner(doc, cues, adapters); runner.on((e) => io.emit(e.type, e)); writeFileSync(join(cfg.dataDir!, "active.json"), JSON.stringify({ id: activeId })); io.emit("show", { type: "show", event: doc.event, project: activeId }); res.json({ ok: true, ...projectsView() }); });
  app.delete("/api/projects/:id", async (q, res) => { if (!store) return res.status(400).json({ error: "projects need a data dir" }); if (q.params.id === activeId) return res.status(409).json({ error: "close it first (open another project)" }); store.remove(q.params.id); if (q.query.cloud && hub.signedIn) { try { await hub.delete(`project:${q.params.id}`); } catch (e: any) { return res.json({ ok: true, warning: `removed locally; hub: ${e.message}`, ...projectsView() }); } } res.json({ ok: true, ...projectsView() }); });
  app.post("/api/projects/sync", guard(async (_q, res) => { if (!store) return res.status(400).json({ error: "projects need a data dir" }); if (!hub.signedIn) return res.status(401).json({ error: "sign in first" }); const r = await store.sync(hub); if (activeId && !store.get(activeId)) activeId = null; if (r.errors.some((e) => /expired/.test(e))) { hubState = { ...hubState, error: "session expired — sign in again" }; saveHub(); } res.json({ ok: true, ...r, ...projectsView() }); }));
  app.get("/api/manifest", (_q, res) => res.json(mediaManifest(doc, cues)));
  const mediaDirFor = (dir: string, outDir?: string) => outDir ?? join(dir, "..", "media");
  type IntakeRunOpts = { override?: any; ocr?: boolean; engine?: "resolume" | "disguise" | "generic"; outDir?: string };
  /** the last delivery read, kept in memory so an answer can re-match without probing (or re-OCRing) hundreds of files again */
  let last: { dir: string; probes: Probe[]; unreadable: { file: string; why: string }[]; ocr: Record<string, OcrResult>; ocrRan: number; opts: IntakeRunOpts } | null = null;
  /** Walk + probe the promoter's folder (parallel ffprobe with live progress) into the `last` cache. */
  async function probeDelivery(dir: string) {
    const walk = (d: string): string[] => { try { return readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.(mov|mp4|mxf|avi|png|jpe?g|tif|webp)$/i.test(f) ? [p] : []; }); } catch { return []; } };
    const files = walk(dir); const probes: Probe[] = []; const unreadable: { file: string; why: string }[] = [];
    // probe in parallel (each is its own ffprobe process) with live progress — a real delivery is hundreds of files,
    // and a silent minute of serial probing reads as "hung" from the board
    let probed = 0, idx = 0;
    io.emit("intake", { phase: "probing", done: 0, total: files.length });
    await Promise.all(Array.from({ length: 6 }, async () => {
      for (let i = idx++; i < files.length; i = idx++) {
        const f = files[i];
        try { const p = await probe(f); p.file = relative(dir, f).replace(/\\/g, "/"); probes.push(p); }
        catch { unreadable.push({ file: relative(dir, f).replace(/\\/g, "/"), why: "unreadable — ffprobe could not open it" }); }
        probed++; if (probed % 10 === 0 || probed === files.length) io.emit("intake", { phase: "probing", done: probed, total: files.length });
      }
    }));
    last = { dir, probes, unreadable, ocr: {}, ocrRan: 0, opts: {} };
  }
  /** Match the cached probes → (OCR the stragglers, once) → plan; the operator's answers feed the scheme override and
   *  per-file placements; the delivery's open questions replace the previous run's in review.items / review.flags. */
  async function matchAndPlan(o: IntakeRunOpts) {
    if (!last) throw new Error("no delivery in memory — check the folder again");
    const { dir, probes, unreadable } = last;
    const syn: ScreenSynonyms = Object.fromEntries(doc.screens.map((s) => [s.id, { words: [s.id.toLowerCase().replace(/_/g, " "), s.name.toLowerCase(), ...(((doc as any).screenWords ?? {})[s.id] ?? [])], w: s.w, h: s.h }]));
    const man = mediaManifest(doc, cues);
    const dec = intakeOptionsFrom(doc);
    const override = { direction: o.override?.direction ?? dec.override.direction, aIs: o.override?.aIs ?? dec.override.aIs };
    const opts: IntakeOptions = { override, assign: dec.assign, ocr: last.ocr };
    let r = intake(doc, man, probes, syn, opts);
    // second pass: OCR only the files the first pass could not place confidently, then match again with the words it read
    if (o.ocr && !Object.keys(last.ocr).length && (await ocrAvailable())) {
      const weak = new Set([...r.unmatched.map((u) => u.file), ...r.assignments.filter((a) => a.confidence < 0.7).map((a) => a.file)]);
      const list = probes.filter((p) => weak.has(p.file)); let i = 0; const cache = last;
      await Promise.all(Array.from({ length: 3 }, async () => { for (let p = list[i++]; p; p = list[i++]) { try { cache.ocr[p.file] = await ocrFile(join(dir, p.file), p); cache.ocrRan++; io.emit("intake", { phase: "ocr", file: p.file, done: cache.ocrRan, total: list.length }); } catch {} } }));
      r = intake(doc, man, probes, syn, opts);
    }
    const jobs = planTranscodes(r.assignments, probes, man, { engine: o.engine ?? "resolume", outDir: mediaDirFor(dir, o.outDir) });
    lastIntake = { dir, mediaDir: mediaDirFor(dir, o.outDir), probes: probes.length, ocrRan: last.ocrRan, scheme: r.scheme, assignments: r.assignments, unmatched: r.unmatched.map((u) => ({ file: u.file, why: u.why, candidates: u.candidates, ocr: (u.evidence as any).ocr?.words?.slice(0, 6) })), ignored: [...r.ignored, ...unreadable], unfilled: r.unfilled, issues: r.issues, jobs };
    // every delivery-level inference lands in review.flags (and, typed, in review.items) — replaced per run, sheet items untouched
    const marker = "Delivery: ";
    const d = deliveryItems(r, doc, opts, unreadable);
    const kept = doc.review.flags.filter((f) => !f.startsWith(marker)); const keptItems = (doc.review.items ?? []).filter((i) => i.source !== "delivery");
    doc.review = { ...doc.review, flags: [...kept, ...d.flags], items: [...keptItems, ...d.items] };
    doc.delivery = { dir, at: new Date().toISOString() };
    persist();
    io.emit("intake", { phase: "done", files: probes.length, matched: r.assignments.length, unmatched: r.unmatched.length });
    io.emit("board", { type: "board", reason: "intake" });
    return lastIntake;
  }
  /** Probe → match → (OCR the stragglers) → plan. Shared by /api/intake (advanced) and /api/prepare (the board's one button). */
  const runIntake = async (dir: string, o: IntakeRunOpts) => { await probeDelivery(dir); last!.opts = o; return matchAndPlan(o); };
  app.post("/api/intake", guard(async (q, res) => { const dir: string = q.body?.dir; if (!dir) return res.status(400).json({ error: "dir required" }); res.json(await runIntake(dir, { override: q.body?.override, ocr: q.body?.ocr, engine: q.body?.engine, outDir: q.body?.outDir })); }));
  app.get("/api/intake", (_q, res) => res.json(lastIntake));
  app.get("/api/versions", (_q, res) => res.json((doc as any).versions ?? []));
  // ── transcode execution: runs the last plan; progress over Socket.IO ("transcode" events); originals deleted only if asked and only after verify
  let transcodeRun: { running: boolean; started?: string; events: ExecEvent[]; result?: any } = { running: false, events: [] };
  app.post("/api/transcode", async (q, res) => {
    if (!lastIntake) return res.status(400).json({ error: "run intake first" }); if (transcodeRun.running) return res.status(409).json({ error: "already running" });
    transcodeRun = { running: true, started: new Date().toISOString(), events: [] }; res.json({ ok: true, jobs: lastIntake.jobs.length });
    const onProgress = (e: ExecEvent) => { transcodeRun.events.push(e); if (transcodeRun.events.length > 5000) transcodeRun.events.splice(0, 1000); io.emit("transcode", e); };
    try { transcodeRun.result = await executeTranscodes(lastIntake.jobs, { srcRoot: lastIntake.dir, concurrency: Number(q.body?.concurrency ?? 2), deleteOriginals: !!q.body?.deleteOriginals, onProgress, levelMatch: levelMatchOpts() }); absorbManifest(lastIntake.mediaDir); }
    catch (e: any) { transcodeRun.result = { error: e.message }; } finally { transcodeRun.running = false; io.emit("transcode", { job: "*", phase: "done", detail: "all jobs finished" }); io.emit("board", { type: "board", reason: "transcode" }); }
  });
  /** run the last plan (Prepare's tail, and the re-conversion after an answer moves files); originals deleted only when asked */
  const convert = async (deleteOriginals: boolean, concurrency = 2) => {
    transcodeRun = { running: true, started: new Date().toISOString(), events: [] };
    const onProgress = (e: ExecEvent) => { transcodeRun.events.push(e); if (transcodeRun.events.length > 5000) transcodeRun.events.splice(0, 1000); io.emit("transcode", e); };
    try { transcodeRun.result = await executeTranscodes(lastIntake.jobs, { srcRoot: lastIntake.dir, concurrency, deleteOriginals, onProgress, levelMatch: levelMatchOpts() }); absorbManifest(lastIntake.mediaDir); }
    catch (e: any) { transcodeRun.result = { error: e.message }; } finally { transcodeRun.running = false; io.emit("transcode", { job: "*", phase: "done", detail: "all jobs finished" }); io.emit("prepare", { phase: "done" }); io.emit("board", { type: "board", reason: "transcode" }); }
  };
  // ── the board's one button: intake with everything inferred, then convert; originals deleted only if asked (after verify)
  app.post("/api/prepare", async (q, res) => {
    const dir: string = q.body?.dir; if (!dir) return res.status(400).json({ error: "dir required" }); if (transcodeRun.running) return res.status(409).json({ error: "already converting" });
    io.emit("prepare", { phase: "probing", dir });
    try { await runIntake(dir, { override: q.body?.override, ocr: q.body?.ocr ?? true, engine: q.body?.engine ?? "resolume", outDir: doc.mediaRoot }); if (!doc.mediaRoot) setShow({ ...doc, mediaRoot: lastIntake.mediaDir }); } catch (e: any) { io.emit("prepare", { phase: "failed", detail: e.message }); return res.status(500).json({ error: e.message }); }
    res.json({ ok: true, files: lastIntake.probes, jobs: lastIntake.jobs.length, scheme: lastIntake.scheme });
    if (q.body?.convert === false || !lastIntake.jobs.length) { io.emit("prepare", { phase: "done" }); return; }
    void convert(!!q.body?.deleteOriginals, Number(q.body?.concurrency ?? 2));
  });
  // ── the Card Board itself, the promoter request, thumbnails
  const thumbDir = join(cfg.dataDir ?? tmpdir(), "surface-thumbs"); mkdirSync(thumbDir, { recursive: true });
  /** preview proxy for any file (HAP / DXV / NotchLC / ProRes → small H.264, alpha → VP9 webm); 202 while it is being built */
  app.get("/api/proxy", guard(async (q, res) => {
    const f = String(q.query.f ?? ""); if (!allowedFile(f) || !existsSync(f)) return res.status(404).end();
    const p = proxies.pathFor(f); if (p.ready) return res.set("Cache-Control", "private, max-age=3600").sendFile(p.path, { acceptRanges: true });
    void proxies.build(f); res.status(202).json({ building: true });
  }));
  const thumbUrl = (abs: string) => `/api/thumb?f=${encodeURIComponent(abs)}`;
  const board = () => buildBoard({ doc, cues, intake: lastIntake, mediaDir: mediaRootOf(), thumbUrl, deck: deck(doc) });
  app.get("/api/board", (_q, res) => res.json(board()));
  app.get("/api/board/request", (_q, res) => res.type("text/plain").send(promoterRequest(board(), doc)));
  app.get("/api/thumb", guard(async (q, res) => {
    const f = String(q.query.f ?? ""); if (!allowedFile(f) || !existsSync(f)) return res.status(404).end();
    const st = statSyncFs(f); const key = createHash("sha1").update(`${f}|${st.size}|${st.mtimeMs}`).digest("hex"); const out = join(thumbDir, `${key}.jpg`);
    if (!existsSync(out)) {
      // one frame ~1 s in (animated cards have revealed their text by then), 264 px wide, flattened over black
      const isStill = /\.(png|jpe?g|tif|webp)$/i.test(f);
      const run = (args: string[]) => new Promise<void>((r) => execFile("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args, out], () => r()));
      await run([...(isStill ? [] : ["-ss", "1.2"]), "-i", f, "-frames:v", "1", "-vf", "scale=264:-2:flags=area,format=yuv420p", "-q:v", "6"]);
      if (!existsSync(out)) await run(["-i", f, "-frames:v", "1", "-vf", "scale=264:-2,format=yuv420p", "-q:v", "6"]);
    }
    if (!existsSync(out)) return res.status(404).end();
    res.set("Cache-Control", "private, max-age=86400").sendFile(out);
  }));
  // ── the venue view: screens in metres (PixelGrid 3D/2D positions, else an automatic layout) + what each surface is showing, as media URLs
  app.get("/api/media", (q, res) => { const f = String(q.query.f ?? ""); if (!allowedFile(f) || !existsSync(f)) return res.status(404).end(); res.set("Cache-Control", "private, max-age=3600").sendFile(f, { acceptRanges: true }); });
  /** every screen with what it is showing right now (BASE/OVERLAY/FULL as preview URLs) — the venue mirror and the outputs share it */
  const liveScreens = () => {
    const screens = autoVenue(doc.screens, doc.surfaces); const root = mediaRootOf();
    const url = (slot: string | null) => { const rel = slot ? doc.media?.[slot] : undefined; if (!rel || !existsSync(join(root, rel))) return null; const abs = join(root, rel); const p = proxies.pathFor(abs); if (!p.ready) void proxies.build(abs); return p.still ? `/api/media?f=${encodeURIComponent(abs)}` : p.ready ? `/api/proxy?f=${encodeURIComponent(abs)}` : `building:/api/proxy?f=${encodeURIComponent(abs)}`; };
    const st = runner.getState();
    // the runner tracks one slot per surface layer; a surface with several screens has one file per screen, named by that screen
    const forScreen = (slot: string | null, sc: { id: string; w: number; h: number }, sf?: { screens: string[] }) => { if (!slot) return null; for (const id of sf?.screens ?? []) { const o = doc.screens.find((x) => x.id === id); const tail = o ? `_${o.id}_${o.w}x${o.h}` : ""; if (tail && slot.endsWith(tail)) return slot.slice(0, -tail.length) + `_${sc.id}_${sc.w}x${sc.h}`; } return slot; };
    const out = screens.map((sc) => { const sf = doc.surfaces.find((x) => x.screens.includes(sc.id)); const ss = sf ? st.surfaces[sf.id] : undefined;
      const L = (k: "BASE" | "OVERLAY" | "FULL") => { const slot = forScreen(ss?.[k].slot ?? null, sc, sf); return { slot, url: url(slot) }; };
      return { id: sc.id, name: sc.name, w: sc.w, h: sc.h, venue: sc.venue, surface: sf?.id ?? null, independent: !!sf?.independent, testPattern: sc.testPattern ? `/api/media?f=${encodeURIComponent(join(root, sc.testPattern))}` : null, layers: { BASE: L("BASE"), OVERLAY: L("OVERLAY"), FULL: L("FULL") } }; });
    return { screens: out, current: st.current, bout: st.bout, round: st.round };
  };
  app.get("/api/venue", (_q, res) => res.json(liveScreens()));
  // ── the clip clock: remaining time of whatever non-looping media is on the walls (VTs, walkouts, fight opens, stings,
  // timed cards). Served as /clock.html so a laptop on the venue network can watch it too (needs --bind 0.0.0.0).
  const clipDur = new Map<string, number>();
  const clock = () => {
    try { const mp = join(mediaRootOf(), "_manifest.json"); if (existsSync(mp)) for (const m of JSON.parse(readFileSync(mp, "utf8"))) if (m.durationSec && m.slot) clipDur.set(m.slot, m.durationSec); } catch {}
    const st = runner.getState(); const now = Date.now(); const seen = new Set<string>(); const playing: any[] = [];
    for (const [sid, S] of Object.entries(st.surfaces)) for (const l of ["FULL", "OVERLAY", "BASE"] as const) {
      const L = S[l]; if (!L.slot || L.cueN == null || seen.has(L.slot)) continue;
      const cue = cues.find((c) => c.n === L.cueN); if (!cue) continue;
      const act: any = cue.targets.flatMap((t) => t.actions).find((a: any) => a.op === "show" && a.media.slot === L.slot);
      const b = act?.media?.behaviour; if (!b || b.kind === "loop") continue;
      const total = b.kind === "timed" ? b.holdSec : b.kind === "playToMarker" ? b.markerSec : clipDur.get(L.slot) ?? null;
      const elapsed = (now - L.since) / 1000; seen.add(L.slot);
      playing.push({ slot: L.slot, cue: { n: cue.n, id: cue.id, name: cue.name }, behaviour: b.kind, surface: sid, layer: l, totalSec: total, elapsedSec: Math.round(elapsed * 10) / 10, remainingSec: total != null ? Math.max(0, Math.round((total - elapsed) * 10) / 10) : null });
    }
    playing.sort((a, b2) => (a.remainingSec ?? Infinity) - (b2.remainingSec ?? Infinity));
    const nx = st.next != null ? cues.find((c) => c.n === st.next) : undefined;
    const lan = (cfg.bind ?? "127.0.0.1") === "0.0.0.0";
    const ips = lan ? Object.values(networkInterfaces()).flat().filter((x: any) => x && x.family === "IPv4" && !x.internal).map((x: any) => x.address) : [];
    return { playing, current: st.current, next: nx ? { n: nx.n, id: nx.id, name: nx.name } : null, serverNow: now, share: { lan, port: cfg.port ?? 8090, urls: ips.map((ip) => `http://${ip}:${cfg.port ?? 8090}/clock.html`) } };
  };
  app.get("/api/clock", (_q, res) => res.json(clock()));
  // ── outputs: the canvases the LED processors take (PixelGrid canvases or one per screen), each assignable to a display
  app.get("/api/outputs", (_q, res) => res.json({ outputs: doc.outputs ?? autoOutputs(doc.screens), auto: !doc.outputs?.length }));
  app.put("/api/outputs", (q, res) => { const outputs: OutputCanvas[] = q.body?.outputs; if (!Array.isArray(outputs)) return res.status(400).json({ error: "outputs[] required" }); setShow({ ...doc, outputs }); res.json({ ok: true }); });
  /** poke the output windows: identify overlay on/off, test patterns when idle on/off (all outputs, or one by id) */
  app.post("/api/outputs/signal", (q, res) => { io.emit("output", { identify: q.body?.identify, test: q.body?.test, id: q.body?.id }); res.json({ ok: true }); });
  /** what one output window renders: the canvas, its screens at canvas positions, and their live layers */
  app.get("/api/outputs/:id", (q, res) => {
    const o = (doc.outputs ?? autoOutputs(doc.screens)).find((x) => x.id === q.params.id); if (!o) return res.status(404).json({ error: "no such output" });
    const live = liveScreens(); const screens = o.screens.map((p) => { const s = live.screens.find((x) => x.id === p.id); return s ? { ...s, x: p.x, y: p.y, cw: p.w ?? s.w, ch: p.h ?? s.h, rotation: p.rotation ?? 0 } : null; }).filter(Boolean);
    res.json({ ...o, screens, current: live.current });
  });
  // ── a newer sheet dropped on the open project: merge (fighter ids stay, graphics follow the fighter), keep the diff
  app.post("/api/sheet", guard(async (q, res) => {
    const text: string = typeof q.body === "string" ? q.body : q.body?.text; const file: string = q.body?.file ?? "sheet.txt"; if (!text) return res.status(400).json({ error: "text required" });
    const r = parseSheet(text, file); if ("kind" in r && r.kind === "rundown") return res.status(422).json({ error: "that is a TV running order, not a bout/timing sheet" });
    const inc = r as ShowDoc; const hasBouts = (doc.data.bouts ?? []).length > 0;
    if (!hasBouts) {
      const keep = { screens: doc.screens, surfaces: doc.surfaces, screenWords: (doc as any).screenWords, stingers: doc.stingers, transitions: doc.transitions, pack: (doc as any).pack, decisions: doc.decisions, delivery: doc.delivery };
      const next = { ...inc, ...keep, event: { ...inc.event, ...(doc.event.name !== "Untitled show" ? { name: doc.event.name } : {}) }, versions: [{ file, at: new Date().toISOString(), diff: ["first sheet"] }] } as unknown as ShowDoc;
      setShow(next); return res.json({ ok: true, diff: ["first sheet"], flags: next.review.flags });
    }
    const m = mergeSheets(doc, inc); (m.doc as any).versions = [...((doc as any).versions ?? []), { file, at: new Date().toISOString(), diff: m.diff }]; setShow(m.doc);
    // the card moved under the delivery: re-match from the cached probes so the board is right immediately
    if (last && Object.keys(doc.decisions ?? {}).length) { try { await matchAndPlan(last.opts); } catch {} }
    res.json({ ok: true, diff: m.diff, flags: m.doc.review.flags });
  }));

  // ── the confirm deck: every open question with its evidence, one answer at a time
  /** attach the URLs the deck needs for thumbnails and hold loops (files are delivery-relative) */
  const withUrls = (i: ConfirmItem) => {
    const dir = doc.delivery?.dir; const isVideo = (f: string) => !/\.(png|jpe?g|tif|webp)$/i.test(f);
    const files = [...(i.evidence?.files ?? []), ...i.options.map((o) => o.file).filter(Boolean) as string[]];
    const thumbs: Record<string, string> = {}; const proxies: Record<string, string> = {};
    if (dir) for (const f of files) { const abs = join(dir, f); thumbs[f] = thumbUrl(abs); if (isVideo(f)) proxies[f] = `/api/proxy?f=${encodeURIComponent(abs)}`; }
    const bout = i.anchor?.fighters?.length ? (doc.data.bouts ?? []).find((b: any) => i.anchor!.fighters!.every((f) => f === b.red || f === b.blue))?.id : undefined;
    return { ...i, bout, thumbs, proxies, options: i.options.map((o) => (o.file ? { ...o, thumb: thumbs[o.file], proxy: proxies[o.file] } : o)) };
  };
  const confirmView = () => {
    const items = deck(doc).map(withUrls);
    const byKey = new Map((doc.review.items ?? []).map((i) => [i.key, i]));
    const answered = Object.entries(doc.decisions ?? {}).map(([key, d]) => ({ key, kind: d.kind, question: byKey.get(key)?.question ?? d.text, text: d.text, at: d.at }));
    // an answer about the graphics needs the folder in memory to take effect
    const needsFiles = Object.keys(doc.decisions ?? {}).some((k) => k === "numbering" || k === "sides" || k.startsWith("assign:"));
    return { count: items.length, items, answered, rematchNeeded: !!doc.delivery && !last && needsFiles };
  };
  app.get("/api/confirm", (_q, res) => res.json(confirmView()));
  app.post("/api/confirm", guard(async (q, res) => {
    const { key, option, value } = q.body ?? {};
    if (!key) return res.status(400).json({ error: "key required" });
    const item = deck(doc).find((i) => i.key === key); if (!item) return res.status(404).json({ error: "that question is no longer open" });
    const opt = item.options.find((o) => o.id === option);
    let v: any;
    if (opt?.input === "text") {
      v = String(value ?? "").trim(); if (!v) return res.status(400).json({ error: "type a value" });
      if (item.kind === "country") { v = v.toUpperCase(); if (!/^[A-Z]{2}$/.test(v)) return res.status(400).json({ error: "two-letter country code" }); }
    } else {
      if (!opt) return res.status(400).json({ error: "pick one of the options" });
      v = item.kind === "file-side" ? (option === "skip" ? { skip: true } : { fighter: option })
        : item.kind === "hold-variant" ? (option === "skip" ? { skip: true } : { variant: option })
        : item.kind === "aspect" ? (option === "skip" ? { skip: true } : { ok: true })
        : item.kind === "rounds" ? Number(option)
        : item.kind === "anthems" ? String(option).split(",").filter(Boolean)
        : option;
    }
    const was = item.options.find((o) => o.suggested)?.id;
    doc.decisions = { ...(doc.decisions ?? {}), [key]: { kind: item.kind, value: v, at: new Date().toISOString(), text: decisionText(item, v), was } };
    const a = applyDecision(doc, item, v);
    persist();
    let rematched = false, converting = 0;
    if (a.rematch && last) {
      await matchAndPlan(last.opts); rematched = true;
      // an answer never deletes the promoter's originals — only the operator's own checkbox does that
      if (lastIntake.jobs.length && !transcodeRun.running) { converting = lastIntake.jobs.length; void convert(false); }
    }
    const view = confirmView();
    res.json({ ok: true, applied: a.changed, rematched, converting, rematchNeeded: a.rematch && !last && !!doc.delivery, next: view.items[0] ?? null, count: view.count });
  }));
  app.post("/api/confirm/forget", guard(async (q, res) => {
    const key = String(q.body?.key ?? ""); const d = doc.decisions?.[key];
    if (!d) return res.status(404).json({ error: "no answer recorded for that" });
    delete doc.decisions![key];
    // put the card's own reading back so the doc matches what the deck will suggest again
    const item = (doc.review.items ?? []).find((i) => i.key === key);
    if (item && d.was !== undefined && isDocKind(item.kind)) {
      applyDecision(doc, item, item.kind === "rounds" ? Number(d.was) : item.kind === "anthems" ? String(d.was).split(",").filter(Boolean) : d.was);
    }
    persist();
    if (last && (key === "numbering" || key === "sides" || key.startsWith("assign:") || isDocKind(d.kind))) { try { await matchAndPlan(last.opts); } catch {} }
    res.json(confirmView());
  }));
  // ── screens from PixelGrid: exported screen-map PNGs (one per screen, 1:1 pixels, test pattern baked in) or the project via the hub
  const placeholders = () => doc.review.flags.some((f) => /placeholder/i.test(f));
  /** copy a test-pattern image under <mediaRoot>/_TEST and point the screen + the EVT.TEST slot at it */
  const adoptTestPattern = (screen: { id: string; w: number; h: number }, src: string | Buffer, media: Record<string, string>) => {
    const root = mediaRootOf(); const rel = `_TEST/${screen.id}_${screen.w}x${screen.h}.png`; mkdirSync2(join(root, "_TEST"), { recursive: true });
    if (typeof src === "string") copyFileSync(src, join(root, rel)); else writeFileSync(join(root, rel), src);
    media[`EVT_TEST_${screen.id}_${screen.w}x${screen.h}`] = rel; return rel;
  };
  const applyScreens = (screens: ShowDoc["screens"], surfaces: ShowDoc["surfaces"], screenWords: Record<string, string[]>, media: Record<string, string>, note: string, outputs?: OutputCanvas[]) => {
    const routing = placeholders() || !Object.keys(doc.routing).length ? autoRouting(screens, surfaces) : doc.routing;
    const flags = doc.review.flags.filter((f) => !/placeholder/i.test(f));
    // outputs = the canvases the LED processors take (PixelGrid canvases when we have them, else one canvas per screen);
    // keep display assignments the operator already made for canvases of the same id
    const fresh = outputs?.length ? outputs : autoOutputs(screens); const prev = new Map((doc.outputs ?? []).map((o) => [o.id, o]));
    const merged = fresh.map((o) => { const p = prev.get(o.id); return p ? { ...o, display: p.display, fit: p.fit ?? o.fit } : o; });
    setShow({ ...doc, screens, surfaces, routing, outputs: merged, media: { ...(doc.media ?? {}), ...media }, mediaRoot: mediaRootOf(), review: { ...doc.review, flags: [...flags, note] } } as ShowDoc & { screenWords: any });
    (doc as any).screenWords = { ...((doc as any).screenWords ?? {}), ...screenWords }; persist();
  };
  app.post("/api/import/screenmaps", async (q, res) => {
    let files: string[] = q.body?.files ?? [];
    if (q.body?.dir) files = readdirSync(q.body.dir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).map((f) => join(q.body.dir, f));
    files = files.filter((f) => existsSync(f)); if (!files.length) return res.status(400).json({ error: "no PNG screen maps found" });
    const probed = []; for (const f of files) { try { const p = await probe(f); probed.push({ path: f, name: basename(f), w: p.w, h: p.h }); } catch { probed.push({ path: f, name: basename(f), w: 0, h: 0 }); } }
    const found = screensFromMapFiles(probed.map((p) => ({ name: p.name, w: p.w, h: p.h }))); const byName = new Map(probed.map((p) => [p.name, p.path]));
    const media: Record<string, string> = {}; const replace = placeholders() || q.body?.replace === true;
    // keep ids that already exist for the same size/name (media is mapped by id), add the rest
    const screens = replace ? [] : [...doc.screens]; const surfaces = replace ? [] : [...doc.surfaces]; const words: Record<string, string[]> = {};
    for (const sc of found.screens) {
      const existing = screens.find((s) => s.id === sc.id || (s.w === sc.w && s.h === sc.h && s.name.toLowerCase() === sc.name.toLowerCase()));
      const target = existing ?? { id: sc.id, name: sc.name, w: sc.w, h: sc.h }; if (existing) { existing.w = sc.w; existing.h = sc.h; } else { screens.push(target); surfaces.push({ id: target.id, name: target.name, screens: [target.id], independent: /host|booth|table|scale|podium/i.test(target.name) || undefined }); }
      (target as any).testPattern = adoptTestPattern(target, byName.get(sc.file)!, media); words[target.id] = [target.name.toLowerCase(), ...target.name.toLowerCase().split(/[\s_-]+/).filter((w) => w.length > 3)];
    }
    applyScreens(screens, surfaces, words, media, `Screens loaded from ${found.screens.length} PixelGrid screen maps${found.project ? ` (${found.project})` : ""}`);
    res.json({ ok: true, screens: found.screens.length, project: found.project, ids: found.screens.map((s) => s.id) });
  });
  app.get("/api/hub/pixelgrid", async (_q, res) => {
    if (!hub.signedIn) return res.status(401).json({ error: "sign in first" });
    try { const items = await hub.listApp("pixel"); res.json(items.filter((i) => i.key.startsWith("project:")).map((i) => ({ id: i.key.slice(8), name: i.preview?.name ?? i.key.slice(8), screens: (i.preview as any)?.screenCount, updatedAt: i.updated_at, visibility: i.visibility }))); }
    catch (e: any) { res.status(502).json({ error: e.message }); }
  });
  app.post("/api/import/pixelmapper/hub", async (q, res) => {
    if (!hub.signedIn) return res.status(401).json({ error: "sign in first" }); const id: string = q.body?.id; if (!id) return res.status(400).json({ error: "id required" });
    try {
      const proj = await hub.getApp<any>("pixel", `project:${id}`); if (!proj) return res.status(404).json({ error: "no such PixelGrid project" });
      const r = fromPixelMapper(proj.value); const media: Record<string, string> = {}; let patterns = 0;
      // cached native renders ("generations") — the screen test patterns PixelGrid already drew for this project
      try {
        const gens = (await hub.listApp("pixel")).filter((i) => i.key.startsWith("generation:"));
        for (const g of gens) { const full = await hub.getApp<any>("pixel", g.key); const v = full?.value; if (!v || v.projectId !== id || v.type !== "screen") continue;
          for (const f of v.files ?? []) { const m = String(f.filename ?? "").match(/_(\d+)x(\d+)\.(png|jpe?g|webp)$/i); const pmIds: string[] = v.metadata?.screenIds ?? [];
            const sc = r.screens.find((s) => pmIds.includes(s.pixelMapper?.screenId ?? "")) ?? (m ? r.screens.find((s) => s.w === Number(m[1]) && s.h === Number(m[2]) && !s.testPattern) : undefined); if (!sc) continue;
            try { sc.testPattern = adoptTestPattern(sc, await hub.fetchFile(f.url), media); patterns++; } catch {} } }
      } catch {}
      applyScreens(r.screens, r.surfaces, r.screenWords, media, `Screens loaded from PixelGrid project '${proj.value?.metadata?.name ?? id}'${r.flags.length ? ` — ${r.flags.join("; ")}` : ""}`, r.outputs);
      res.json({ ok: true, screens: r.screens.length, surfaces: r.surfaces.length, patterns, flags: r.flags });
    } catch (e: any) { res.status(502).json({ error: e.message }); }
  });
  // ── build the engine live (Resolume over REST); the author-only bundle stays at /api/bundle
  /** the 1-frame transparent still every "clear" clip points at — created in the media root before any build references it */
  const CLEAR_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAGklEQVR4nGNkoBCwjBrAMBoGDKNhwDAswgAAggAAPmp6ZNoAAAAASUVORK5CYII=", "base64");
  const ensureClearStill = (root: string) => { const p = join(root, "_CLEAR.png"); if (!existsSync(p)) { mkdirSync(root, { recursive: true }); writeFileSync(p, CLEAR_PNG); } };
  app.post("/api/build/resolume", async (q, res) => {
    const ra = adapters.find((a) => a.id === "resolume") as ResolumeAdapter | undefined; if (!ra) return res.status(400).json({ error: "no Resolume adapter in surface.config.json" });
    const mediaRoot = q.body?.mediaRoot ?? mediaRootOf(); ensureClearStill(mediaRoot);
    const plan = resolumePlan(doc, cues, mediaRoot.replace(/\\/g, "/"), String(q.body?.savePath ?? join(mediaRoot, "..", `${doc.event.id}.avc`)).replace(/\\/g, "/"));
    try { const n = await ra.build(plan, (done, total, op) => io.emit("build", { engine: "resolume", done, total, op: op.op })); (doc as any).built = { ...((doc as any).built ?? {}), resolume: new Date().toISOString() }; publishCueNumbers(doc, cues); persist(); res.json({ ok: true, ops: n }); }
    catch (e: any) { res.status(502).json({ error: e.message, hint: "Resolume Arena 7.8+ with Webserver enabled (Preferences → Webserver), on this machine or a reachable IP" }); }
  });

  app.get("/api/transcode", (_q, res) => res.json({ running: transcodeRun.running, started: transcodeRun.started, recent: transcodeRun.events.slice(-50), result: transcodeRun.result }));
  // ── ShowCall / PixelMapper bridges and the author-only bundle
  app.get("/api/export/showcall", (_q, res) => res.json(toShowCall(doc, cues)));
  app.post("/api/import/showcall", (q, res) => { const extra = fromShowCall(cues, q.body?.cues ?? q.body ?? []); doc.customCues = [...(doc.customCues ?? []).filter((c) => !String(c.id).startsWith("SC.")), ...extra]; persist(); res.json({ ok: true, imported: extra.length, cues: cues.length }); });
  app.post("/api/import/pixelmapper", (q, res) => { const r = fromPixelMapper(q.body); doc.screens = r.screens; doc.surfaces = r.surfaces; (doc as any).screenWords = r.screenWords; doc.review.flags = [...doc.review.flags.filter((f) => !/placeholder/i.test(f)), ...r.flags]; persist(); res.json({ ok: true, screens: r.screens.length, surfaces: r.surfaces.length, flags: r.flags, cues: cues.length }); });
  app.get("/api/content-guide", (_q, res) => res.json(contentGuideRows(doc.screens, doc.surfaces)));
  app.post("/api/bundle", guard(async (q, res) => { const outDir = q.body?.outDir ?? join(process.cwd(), "out", doc.event.id); ensureClearStill(mediaRootOf()); const files = await buildBundle(doc, cues, { outDir, mediaRoot: mediaRootOf().replace(/\\/g, "/"), companion: { mode: q.body?.mode ?? "bridge", surfaceHost: q.body?.host ?? `127.0.0.1:${cfg.port ?? 8090}` } }); publishCueNumbers(doc, cues); persist(); res.json({ ok: true, outDir, files }); }));
  app.get("/api/show", (_q, res) => res.json({ event: doc.event, surfaces: doc.surfaces, screens: doc.screens, review: doc.review, cueCount: cues.length, project: activeId, confirm: deck(doc).length }));
  app.get("/api/cues", (_q, res) => res.json(cues));
  app.get("/api/state", (_q, res) => res.json(runner.getState()));
  app.get("/api/variables", (_q, res) => res.json(runner.variables()));
  app.get("/api/health", (_q, res) => res.json({ adapters: adapters.map((a) => a.status()), uptimeSec: Math.round(process.uptime()) }));
  // ── engines: set up connections from the app (no config file editing), test before saving, swap adapters live
  const engineView = () => ({ adapters: cfg.adapters, status: adapters.map((a) => a.status()) });
  app.get("/api/engines", (_q, res) => res.json(engineView()));
  app.post("/api/engines/test", async (q, res) => {
    const a = q.body; if (!a?.type) return res.status(400).json({ error: "type required" });
    try {
      if (a.type === "resolume") { const base = a.base ?? "http://127.0.0.1:8080/api/v1"; const t = Date.now(); const r = await fetch(`${base}/composition`, { signal: AbortSignal.timeout(2500) }); if (!r.ok) throw new Error(`Arena answered ${r.status}`); const c: any = await r.json(); return res.json({ ok: true, detail: `${c.name?.value ?? "composition"} · ${c.layergroups?.length ?? 0} groups · ${c.columns?.length ?? 0} columns · ${Date.now() - t} ms` }); }
      if (a.type === "disguise") { const t = Date.now(); const r = await fetch(`http://${a.host}/api/session/status/health`, { signal: AbortSignal.timeout(2500) }); if (!r.ok) throw new Error(`disguise answered ${r.status}`); return res.json({ ok: true, detail: `director reachable · ${Date.now() - t} ms` }); }
      if (a.type === "companion") { const base = a.base ?? "http://127.0.0.1:8000"; const t = Date.now(); const r = await fetch(`${base}/api/variables`, { signal: AbortSignal.timeout(2500) }).catch(() => fetch(`${base}/`, { signal: AbortSignal.timeout(2500) })); if (!r.ok) throw new Error(`Companion answered ${r.status}`); return res.json({ ok: true, detail: `Companion reachable · ${Date.now() - t} ms` }); }
      res.json({ ok: true, detail: "rehearsal mode — nothing to reach" });
    } catch (e: any) { res.json({ ok: false, detail: /aborted|timeout/i.test(e.message) ? "no answer in 2.5 s — is it running, and is the web server enabled?" : e.message }); }
  });
  app.put("/api/engines", async (q, res) => {
    const list = Array.isArray(q.body?.adapters) ? q.body.adapters : null; if (!list) return res.status(400).json({ error: "adapters[] required" });
    cfg.adapters = list.length ? list : [{ type: "mock" }];
    for (const a of adapters) await a.close().catch(() => {});
    const fresh = buildAdapters(cfg, () => runner.variables()); adapters.splice(0, adapters.length, ...fresh); // same array the runner holds
    for (const a of adapters) await a.init(doc, cues);
    if (cfg.configFile) { try { writeFileSync(cfg.configFile, JSON.stringify({ ...(existsSync(cfg.configFile) ? JSON.parse(readFileSync(cfg.configFile, "utf8")) : {}), adapters: cfg.adapters }, null, 2)); } catch {} }
    io.emit("health", engineView()); res.json(engineView());
  });
  app.post("/api/cue/:n/go", async (q, res) => { const c = await runner.go(Number(q.params.n)); c ? res.json({ ok: true, cue: { n: c.n, id: c.id, name: c.name } }) : res.status(404).json({ ok: false, error: `no cue ${q.params.n}` }); });
  app.post("/api/cue/:id/go-by-id", async (q, res) => { const c = cues.find((x) => x.id === q.params.id); if (!c) return res.status(404).json({ ok: false, error: `no cue ${q.params.id}` }); const fired = await runner.go(c.n); res.json({ ok: true, cue: fired ? { n: fired.n, id: fired.id, name: fired.name } : null }); });
  app.post("/api/next", async (_q, res) => res.json({ ok: true, cue: (await runner.next())?.id ?? null }));
  app.post("/api/prev", async (_q, res) => res.json({ ok: true, cue: (await runner.prev())?.id ?? null }));
  app.post("/api/panic", async (_q, res) => { await runner.panic(); res.json({ ok: true }); });
  app.post("/api/text/:key", async (q, res) => { const value = typeof q.body === "string" ? q.body : q.body?.value ?? ""; for (const a of adapters) for (const s of doc.surfaces) await a.apply({ kind: "setText", surface: s.id, layer: "OVERLAY", key: q.params.key, value }).catch(() => {}); res.json({ ok: true }); });
  app.post("/api/media/ended", async (q, res) => { await runner.mediaEnded(q.body?.slot ?? ""); res.json({ ok: true }); });
  io.on("connection", (s) => { s.emit("state", { type: "state", state: runner.getState() }); s.on("go", (n: number) => void runner.go(n)); s.on("next", () => void runner.next()); s.on("panic", () => void runner.panic()); });

  if (process.env.SURFACE_STATIC && existsSync(process.env.SURFACE_STATIC)) app.get(/^(?!\/api|\/socket\.io).*/, (_q, res) => res.sendFile(join(process.env.SURFACE_STATIC!, "index.html")));
  const port = cfg.port ?? 8090;
  const bind = cfg.bind ?? "127.0.0.1"; // loopback unless the operator opens it up for Bridge mode (--bind 0.0.0.0)
  await new Promise<void>((resolve, reject) => {
    http.once("error", (e: any) => reject(e.code === "EADDRINUSE" ? new Error(`port ${port} is already in use on ${bind} — is another Surface (or \`npm run server\`) running? Stop it, or start with --port ${port + 1}`) : e));
    http.listen(port, bind, resolve);
  });
  console.log(`Surface ${doc.event.name} — ${cues.length} cues · ${doc.surfaces.length} surfaces · adapters: ${adapters.map((a) => `${a.id}${a.status().connected ? "" : " (offline)"}`).join(", ")} · http://${bind === "0.0.0.0" ? "<this PC's IP>" : bind}:${port}`);
  return { app, http, io, runner, adapters, close: async () => { for (const a of adapters) await a.close(); io.close(); http.close(); } };
}

if (process.argv[1] && /server[\\/]index\.[tj]s$/.test(process.argv[1])) {
  const args = process.argv.slice(2); const flag = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
  // a positional show file is any .json that is not itself the value of a --flag (argument order must not matter)
  const flagValues = new Set(args.flatMap((a, i) => (a.startsWith("--") && args[i + 1] ? [args[i + 1]] : [])));
  const show = flag("show", "") || args.find((a) => !a.startsWith("--") && !flagValues.has(a) && a.endsWith(".json")) || "show.json";
  const cfgFile = flag("config", "surface.config.json");
  const cfg: SurfaceConfig = existsSync(cfgFile) ? JSON.parse(readFileSync(cfgFile, "utf8")) : { adapters: [{ type: "mock" }] }; cfg.configFile = cfgFile;
  if (flag("port", "")) cfg.port = Number(flag("port", "8090"));
  if (flag("bind", "")) cfg.bind = flag("bind", "");
  if (flag("data", "")) cfg.dataDir = flag("data", ""); if (flag("hub", "")) cfg.hubUrl = flag("hub", "");
  startServer(show, cfg).catch((e) => { console.error(`Surface could not start: ${e.message}`); process.exit(1); });
}
