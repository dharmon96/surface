/**
 * Surface server — Run mode and Bridge mode.
 *   node --import tsx server/index.ts [show.json] [--config surface.config.json] [--port 8090]
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
 */
import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { readFileSync, existsSync } from "node:fs";
import { deriveCues, loadShowDoc } from "../core/index.js";
import { Runner } from "../core/engine/runner.js";
import { MockAdapter, ResolumeAdapter, DisguiseAdapter, CompanionAdapter } from "../core/engine/adapters.js";
import type { EngineAdapter } from "../core/engine/adapter.js";

export interface SurfaceConfig {
  port?: number;
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
  const doc = loadShowDoc(JSON.parse(readFileSync(showFile, "utf8"))); const cues = deriveCues(doc);
  let runner: Runner; const adapters = buildAdapters(cfg, () => runner.variables());
  runner = new Runner(doc, cues, adapters);
  for (const a of adapters) await a.init(doc, cues);

  const app = express(); app.use(cors()); app.use(express.json()); app.use(express.text());
  const http = createServer(app); const io = new Server(http, { cors: { origin: "*" } });
  runner.on((e) => io.emit(e.type, e));

  app.get("/api/show", (_q, res) => res.json({ event: doc.event, surfaces: doc.surfaces, screens: doc.screens, review: doc.review, cueCount: cues.length }));
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

  const port = cfg.port ?? 8090;
  await new Promise<void>((r) => http.listen(port, r));
  console.log(`Surface ${doc.event.name} — ${cues.length} cues · ${doc.surfaces.length} surfaces · adapters: ${adapters.map((a) => `${a.id}${a.status().connected ? "" : " (offline)"}`).join(", ")} · http://127.0.0.1:${port}`);
  return { app, http, io, runner, adapters, close: async () => { for (const a of adapters) await a.close(); io.close(); http.close(); } };
}

if (process.argv[1] && /server[\\/]index\.ts$/.test(process.argv[1])) {
  const args = process.argv.slice(2); const flag = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
  const show = args.find((a) => !a.startsWith("--") && a.endsWith(".json") && !args.includes(`--config`) || a === flag("show", "")) ?? args[0] ?? "show.json";
  const cfgFile = flag("config", "surface.config.json");
  const cfg: SurfaceConfig = existsSync(cfgFile) ? JSON.parse(readFileSync(cfgFile, "utf8")) : { adapters: [{ type: "mock" }] };
  if (flag("port", "")) cfg.port = Number(flag("port", "8090"));
  startServer(show, cfg).catch((e) => { console.error(e); process.exit(1); });
}
