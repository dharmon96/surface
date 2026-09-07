import { describe, it, expect, afterAll } from "vitest";
import { startServer } from "../server/index.js";
import { MockAdapter } from "../core/engine/adapters.js";

const fixture = new URL("../fixtures/2026-06-13-glendale.bout.json", import.meta.url).pathname;
const srv = await startServer(fixture, { port: 18090, adapters: [{ type: "mock" }] });
const base = "http://127.0.0.1:18090";
afterAll(async () => { await srv.close(); });

describe("Bridge API", () => {
  it("serves the show, cues and health", async () => {
    const show = await (await fetch(`${base}/api/show`)).json(); expect(show.cueCount).toBeGreaterThan(150); expect(show.surfaces.length).toBe(4);
    const health = await (await fetch(`${base}/api/health`)).json(); expect(health.adapters[0]).toMatchObject({ id: "mock", connected: true });
  });
  it("fires a cue from a Companion-style POST and updates state + variables", async () => {
    const cues = await (await fetch(`${base}/api/cues`)).json(); const r7 = cues.find((c: any) => c.id === "B08.R07");
    const tale = cues.find((c: any) => c.id === "B08.TALE"); await fetch(`${base}/api/cue/${tale.n}/go`, { method: "POST" });
    const res = await (await fetch(`${base}/api/cue/${r7.n}/go`, { method: "POST" })).json(); expect(res.ok).toBe(true);
    const st = await (await fetch(`${base}/api/state`)).json(); expect(st.round).toBe(7); expect(st.surfaces.RIBBON.OVERLAY.slot).toMatch(/ROUND_07_RIBBON/); expect(st.surfaces.IMAG_L.OVERLAY.slot).toBeNull();
    const vars = await (await fetch(`${base}/api/variables`)).json(); expect(vars.round).toBe("7"); expect(vars.red_name).toBe("Antonio Vargas");
    const mock = srv.adapters[0] as MockAdapter; expect(mock.log.at(-1)!.detail).toMatch(/groups MAIN,RIBBON/);
  });
  it("404s an unknown cue and panics cleanly", async () => {
    expect((await fetch(`${base}/api/cue/9999/go`, { method: "POST" })).status).toBe(404);
    const p = await (await fetch(`${base}/api/panic`, { method: "POST" })).json(); expect(p.ok).toBe(true);
    const st = await (await fetch(`${base}/api/state`)).json(); expect(st.surfaces.MAIN.OVERLAY.slot).toBeNull(); expect(st.surfaces.MAIN.BASE.slot).toMatch(/TALE/);
  });
});
