import { describe, it, expect, afterAll } from "vitest";
import express from "express";
import { mkdtempSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startServer } from "../server/index.js";
import { tokenFromCookie } from "../core/hub/client.js";

// ── a stand-in for mantaglow.com: Better Auth desktop fallback (x-hub-session-token) + the per-app data API
const TOKEN = "sess_abc123";
const cloud = new Map<string, { value: any; updated_at: string }>();
const fakeHub = express(); fakeHub.use(express.json({ limit: "20mb" }));
fakeHub.use((q, res, next) => { if (q.headers["x-hub-session-token"] !== TOKEN) return res.status(401).json({ error: "unauthorized" }); next(); });
fakeHub.get("/api/hub/users/me", (_q, res) => res.json({ user: { id: "u1", email: "darian@example.com", name: "Darian", image: null }, session: { activeOrganizationId: "org1" }, organization: { id: "org1", name: "MantaGlow" }, apps: [{ slug: "surface", name: "Surface" }] }));
fakeHub.get("/api/data/:app", (q, res) => { if (q.params.app !== "surface") return res.status(403).json({ error: "no access" }); res.json([...cloud].map(([key, v]) => ({ key, updated_at: v.updated_at, preview: { name: v.value?.name } }))); });
fakeHub.get("/api/data/:app/:key", (q, res) => { const v = cloud.get(q.params.key); v ? res.json({ key: q.params.key, ...v }) : res.status(404).end(); });
fakeHub.put("/api/data/:app/:key", (q, res) => { cloud.set(q.params.key, { value: q.body, updated_at: new Date().toISOString() }); res.json({ ok: true }); });
fakeHub.delete("/api/data/:app/:key", (q, res) => { cloud.delete(q.params.key); res.json({ ok: true }); });
const hubSrv = fakeHub.listen(18095);

const dataDir = mkdtempSync(join(tmpdir(), "surface-data-"));
const srv = await startServer(join(dataDir, "nope.json"), { port: 18094, dataDir, hubUrl: "http://127.0.0.1:18095", adapters: [{ type: "mock" }] });
const base = "http://127.0.0.1:18094";
const j = async (path: string, init?: RequestInit) => { const r = await fetch(base + path, { headers: { "Content-Type": "application/json" }, ...init }); return { status: r.status, body: await r.json().catch(() => null) }; };
afterAll(async () => { await srv.close(); hubSrv.close(); });

describe("projects + hub dashboard", () => {
  it("starts with a blank project when no show exists, and is signed out", async () => {
    const p = await j("/api/projects"); expect(p.body.enabled).toBe(true); expect(p.body.projects.length).toBe(1); expect(p.body.active).toBe(p.body.projects[0].id);
    const s = await j("/api/hub/status"); expect(s.body.signedIn).toBe(false); expect(s.body.projectsEnabled).toBe(true);
  });
  it("rejects a bad token and accepts the real one (persisted for offline restarts)", async () => {
    expect((await j("/api/hub/token", { method: "POST", body: JSON.stringify({ token: "wrong" }) })).status).toBe(401);
    const ok = await j("/api/hub/token", { method: "POST", body: JSON.stringify({ token: TOKEN }) }); expect(ok.status).toBe(200); expect(ok.body.user.email).toBe("darian@example.com"); expect(ok.body.organization.name).toBe("MantaGlow");
    expect(JSON.parse(readFileSync(join(dataDir, "hub.json"), "utf8")).token).toBe(TOKEN);
  });
  it("imports a bout sheet as a new project and makes it active", async () => {
    const text = readFileSync(new URL("../fixtures/text/2026-06-13-glendale-timing.txt", import.meta.url), "utf8");
    const r = await j("/api/projects/import", { method: "POST", body: JSON.stringify({ text, file: "glendale-timing.pdf" }) });
    expect(r.status).toBe(200); expect(r.body.project.name).toMatch(/v/); expect(r.body.active).toBe(r.body.project.id);
    const show = await j("/api/show"); expect(show.body.cueCount).toBeGreaterThan(100); expect(show.body.project).toBe(r.body.project.id);
    expect(existsSync(join(dataDir, "projects", r.body.project.id, "show.json"))).toBe(true);
  });
  it("pushes local projects to the account, then pulls a project made elsewhere", async () => {
    const s = await j("/api/projects/sync", { method: "POST" }); expect(s.body.pushed).toBe(2); expect(s.body.errors).toEqual([]);
    expect([...cloud.keys()].every((k) => k.startsWith("project:"))).toBe(true);
    // another machine saved a project straight to the account
    cloud.set("project:p_elsewhere", { value: { name: "Fight Week", doc: { ...JSON.parse(readFileSync(join(dataDir, "projects", s.body.projects[0].id, "show.json"), "utf8")), event: { id: "fw", name: "Fight Week" } }, meta: { pack: "boxing.fightnight" }, updatedAt: new Date().toISOString() }, updated_at: new Date().toISOString() });
    const s2 = await j("/api/projects/sync", { method: "POST" }); expect(s2.body.pulled).toBe(1); expect(s2.body.projects.find((p: any) => p.id === "p_elsewhere")).toMatchObject({ name: "Fight Week", sync: "synced" });
  });
  it("marks local edits 'ahead', pushes them, and keeps both sides on a conflict", async () => {
    const before = (await j("/api/projects")).body; const id = before.active;
    const doc = (await j("/api/doc")).body; doc.event.name = "Edited locally"; await j("/api/doc", { method: "PUT", body: JSON.stringify(doc) });
    expect((await j("/api/projects")).body.projects.find((p: any) => p.id === id).sync).toBe("ahead");
    // meanwhile the cloud copy changed too
    await new Promise((r) => setTimeout(r, 5)); const c = cloud.get(`project:${id}`)!; cloud.set(`project:${id}`, { value: { ...c.value, doc: { ...c.value.doc, event: { ...c.value.doc.event, name: "Edited in the cloud" } } }, updated_at: new Date().toISOString() });
    const s = await j("/api/projects/sync", { method: "POST" }); expect(s.body.conflicts).toEqual([id]); expect(s.body.pushed).toBeGreaterThanOrEqual(1);
    expect(readdirSync(join(dataDir, "projects", id)).some((f) => f.startsWith("show.conflict-"))).toBe(true);
    expect(cloud.get(`project:${id}`)!.value.name).toBe("Edited locally"); // ours won, theirs kept beside it
    expect(s.body.projects.find((p: any) => p.id === id).sync).toBe("synced");
  });
  it("opens another project, deletes one locally + in the cloud, and signs out", async () => {
    const o = await j("/api/projects/p_elsewhere/open", { method: "POST" }); expect(o.body.active).toBe("p_elsewhere"); expect((await j("/api/show")).body.event.name).toBe("Fight Week");
    expect((await j("/api/projects/p_elsewhere", { method: "DELETE" })).status).toBe(409);
    const victim = o.body.projects.find((p: any) => p.id !== "p_elsewhere").id;
    const d = await j(`/api/projects/${victim}?cloud=1`, { method: "DELETE" }); expect(d.body.ok).toBe(true); expect(cloud.has(`project:${victim}`)).toBe(false);
    const so = await j("/api/hub/signout", { method: "POST" }); expect(so.body.signedIn).toBe(false);
    expect((await j("/api/projects/sync", { method: "POST" })).status).toBe(401);
  });
  it("turns the Better Auth cookie into the hub's session token", () => {
    expect(tokenFromCookie("abc123.SIGNATURE%3D%3D")).toBe("abc123"); expect(tokenFromCookie("plain")).toBe("plain");
  });
});
