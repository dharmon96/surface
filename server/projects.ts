/**
 * Project store: local-first, cloud-synced.
 *   <dataDir>/projects/<id>/show.json   the ShowDoc (source of truth while offline)
 *   <dataDir>/projects/index.json       list + sync bookkeeping
 *   <dataDir>/hub.json                  the signed-in hub session (token + who), so the app stays signed in offline
 * Sync is last-write-wins on `updatedAt` per project; conflicts are recorded, never silently dropped (the loser is kept as
 * show.conflict-<timestamp>.json). Works with no hub at all — sync is simply skipped.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { ShowDoc } from "../core/types.js";
import type { HubClient, HubSession } from "../core/hub/client.js";
import { PLACEHOLDER_SCREENS, DEFAULT_ROUTING } from "../core/parse/timing-sheet.js";

export interface ProjectMeta { id: string; name: string; eventDate?: string; venue?: string; pack: string; createdAt: string; updatedAt: string; cloudUpdatedAt?: string | null; sync: "local" | "synced" | "ahead" | "behind" | "conflict" | "error"; error?: string; visibility?: "personal" | "company" }
export interface HubState { token: string | null; session: HubSession | null; checkedAt?: string; error?: string }

/** An empty show for a project that starts from nothing (screens come from PixelMapper, bouts from a sheet or by hand). */
export function blankShowDoc(name: string, o: { date?: string; venue?: string; pack?: string } = {}): ShowDoc {
  const id = `${o.date ?? new Date().toISOString().slice(0, 10)}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "show"}`;
  const doc: ShowDoc & { pack: string } = {
    schema: "surface/2.0", pack: o.pack ?? "boxing.fightnight",
    event: { id, name, date: o.date, venue: o.venue, walkOrder: ["red", "blue"], introOrder: ["red", "blue"] },
    screens: PLACEHOLDER_SCREENS, surfaces: PLACEHOLDER_SCREENS.map((s) => ({ id: s.id, name: s.name, screens: [s.id] })),
    data: { fighters: [], bouts: [], vts: [] }, routing: DEFAULT_ROUTING, customCues: [],
    review: { status: "draft", flags: ["placeholder screens — import from PixelMapper or edit", "no bouts yet — import a bout sheet / timing sheet"] },
  };
  return doc;
}

export class ProjectStore {
  private dir: string; private index: ProjectMeta[] = []; private hubFile: string;
  constructor(dataDir: string) { this.dir = join(dataDir, "projects"); this.hubFile = join(dataDir, "hub.json"); mkdirSync(this.dir, { recursive: true }); const ix = join(this.dir, "index.json"); if (existsSync(ix)) this.index = JSON.parse(readFileSync(ix, "utf8")); else this.rescan(); }
  private save() { writeFileSync(join(this.dir, "index.json"), JSON.stringify(this.index, null, 1)); }
  private rescan() { this.index = readdirSync(this.dir, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(this.dir, d.name, "show.json"))).map((d) => { const doc = this.readDoc(d.name)!; return this.metaFrom(d.name, doc, { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), sync: "local" }); }); this.save(); }
  private metaFrom(id: string, doc: ShowDoc, prev: Partial<ProjectMeta>): ProjectMeta { return { id, name: doc.event.name, eventDate: doc.event.date, venue: doc.event.venue, pack: (doc as any).pack ?? "boxing.fightnight", createdAt: prev.createdAt ?? new Date().toISOString(), updatedAt: prev.updatedAt ?? new Date().toISOString(), cloudUpdatedAt: prev.cloudUpdatedAt ?? null, sync: prev.sync ?? "local", error: prev.error, visibility: prev.visibility }; }
  list(): ProjectMeta[] { return [...this.index].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  get(id: string) { return this.index.find((p) => p.id === id); }
  path(id: string) { return join(this.dir, id, "show.json"); }
  readDoc(id: string): ShowDoc | null { const p = this.path(id); return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null; }
  create(doc: ShowDoc, id = `p_${Date.now().toString(36)}${randomBytes(3).toString("hex")}`): ProjectMeta { mkdirSync(join(this.dir, id), { recursive: true }); writeFileSync(this.path(id), JSON.stringify(doc, null, 1)); const m = this.metaFrom(id, doc, {}); this.index = [...this.index.filter((p) => p.id !== id), m]; this.save(); return m; }
  update(id: string, doc: ShowDoc): ProjectMeta { const prev = this.get(id); if (!prev) return this.create(doc, id); writeFileSync(this.path(id), JSON.stringify(doc, null, 1)); const m = this.metaFrom(id, doc, { ...prev, updatedAt: new Date().toISOString(), sync: prev.sync === "synced" ? "ahead" : prev.sync }); this.index = this.index.map((p) => (p.id === id ? m : p)); this.save(); return m; }
  remove(id: string) { rmSync(join(this.dir, id), { recursive: true, force: true }); this.index = this.index.filter((p) => p.id !== id); this.save(); }

  /** Two-way sync with the hub. Pull projects we don't have; push local changes; last-write-wins on updatedAt with conflict copies. */
  async sync(hub: HubClient): Promise<{ pushed: number; pulled: number; conflicts: string[]; errors: string[] }> {
    const out = { pushed: 0, pulled: 0, conflicts: [] as string[], errors: [] as string[] };
    let remote: Awaited<ReturnType<HubClient["list"]>>; try { remote = await hub.list(); } catch (e: any) { out.errors.push(e.message); return out; }
    const remoteById = new Map(remote.filter((r) => r.key.startsWith("project:")).map((r) => [r.key.slice(8), r]));
    for (const [id, r] of remoteById) {
      const local = this.get(id);
      if (!local || (r.updated_at > (local.cloudUpdatedAt ?? "") && local.sync !== "ahead")) {
        try { const full = await hub.get<{ doc: ShowDoc; meta: Partial<ProjectMeta> }>(`project:${id}`); if (!full) continue; const doc = full.value.doc; mkdirSync(join(this.dir, id), { recursive: true }); writeFileSync(this.path(id), JSON.stringify(doc, null, 1)); const m = this.metaFrom(id, doc, { ...(local ?? {}), createdAt: full.value.meta?.createdAt ?? local?.createdAt, updatedAt: full.updated_at, cloudUpdatedAt: full.updated_at, sync: "synced", error: undefined, visibility: r.visibility }); this.index = [...this.index.filter((p) => p.id !== id), m]; out.pulled++; }
        catch (e: any) { out.errors.push(`${id}: ${e.message}`); }
      } else if (local.sync === "ahead" && r.updated_at > (local.cloudUpdatedAt ?? "")) {
        // both changed: keep ours, save theirs beside it for the operator to inspect
        try { const full = await hub.get<{ doc: ShowDoc }>(`project:${id}`); if (full) writeFileSync(join(this.dir, id, `show.conflict-${full.updated_at.replace(/[:.]/g, "-")}.json`), JSON.stringify(full.value.doc, null, 1)); local.sync = "conflict"; out.conflicts.push(id); } catch (e: any) { out.errors.push(`${id}: ${e.message}`); }
      }
    }
    for (const p of this.index) {
      if (p.sync === "local" || p.sync === "ahead" || p.sync === "conflict" || p.sync === "error") {
        try { const doc = this.readDoc(p.id); if (!doc) continue; await hub.put(`project:${p.id}`, { name: p.name, doc, meta: { createdAt: p.createdAt, pack: p.pack, eventDate: p.eventDate, venue: p.venue }, updatedAt: p.updatedAt }); p.cloudUpdatedAt = new Date().toISOString(); p.sync = "synced"; p.error = undefined; out.pushed++; }
        catch (e: any) { p.sync = "error"; p.error = e.message; out.errors.push(`${p.id}: ${e.message}`); }
      }
    }
    this.save(); return out;
  }

  // ── hub session persistence (the token is what the hub gave the browser; the app keeps it so it stays signed in offline)
  readHub(): HubState { try { return existsSync(this.hubFile) ? JSON.parse(readFileSync(this.hubFile, "utf8")) : { token: null, session: null }; } catch { return { token: null, session: null }; } }
  writeHub(h: HubState) { writeFileSync(this.hubFile, JSON.stringify(h, null, 1), { mode: 0o600 }); }
}
