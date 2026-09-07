import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { deriveCues, loadShowDoc, resolumePlan } from "../core/index.js";
import { Runner } from "../core/engine/runner.js";
import { MockAdapter, ResolumeAdapter, DisguiseAdapter } from "../core/engine/adapters.js";

const doc = loadShowDoc(JSON.parse(readFileSync(new URL("../fixtures/2026-06-13-glendale.bout.json", import.meta.url), "utf8")));
const cues = deriveCues(doc);
const byId = (id: string) => cues.find((c) => c.id === id)!;

/** manual clock + timers so timed reverts are deterministic */
function fakeTimers() { let t = 0; const q: { at: number; fn: () => void; id: number }[] = []; let id = 0;
  return { now: () => t, setTimeout: (fn: () => void, ms: number) => { const h = ++id; q.push({ at: t + ms, fn, id: h }); return h; }, clearTimeout: (h: number) => { const i = q.findIndex((x) => x.id === h); if (i >= 0) q.splice(i, 1); },
    advance: async (ms: number) => { t += ms; for (const x of [...q].sort((a, b) => a.at - b.at)) if (x.at <= t) { q.splice(q.indexOf(x), 1); await x.fn(); } } };
}

describe("Runner", () => {
  it("tracks BASE / OVERLAY / FULL per surface and scopes the fire", async () => {
    const mock = new MockAdapter(); const r = new Runner(doc, cues, [mock]); await mock.init(doc);
    await r.go(byId("B08.TALE").n);
    let s = r.getState(); expect(s.surfaces.MAIN.BASE.slot).toBe("B08_TALE_MAIN_3840x1080"); expect(s.surfaces.RIBBON.BASE.slot).toBeNull(); expect(s.bout).toBe("B08");
    await r.go(byId("B08.R03").n);
    s = r.getState(); expect(s.surfaces.MAIN.OVERLAY.slot).toBe("B08_ROUND_03_MAIN_3840x1080"); expect(s.surfaces.MAIN.BASE.slot).toBe("B08_TALE_MAIN_3840x1080"); expect(s.round).toBe(3);
    expect(mock.log.at(-1)!.detail).toMatch(/groups MAIN,RIBBON/);
  });
  it("reverts a timed overlay to base after its hold, per surface, unless something newer landed", async () => {
    const ft = fakeTimers(); const mock = new MockAdapter(); const r = new Runner(doc, cues, [mock], ft);
    await r.go(byId("B08.TALE").n); await r.go(byId("B08.R01").n);
    expect(r.getState().surfaces.MAIN.OVERLAY.slot).toMatch(/ROUND_01/); expect(r.getState().timers).toBe(2);
    await ft.advance(10_000);
    const s = r.getState(); expect(s.surfaces.MAIN.OVERLAY.slot).toBeNull(); expect(s.surfaces.RIBBON.OVERLAY.slot).toBeNull(); expect(s.surfaces.MAIN.BASE.slot).toMatch(/TALE/);
    expect(mock.log.filter((l) => l.op.kind === "revertBase").length).toBe(2);
    // a new round card before the hold expires cancels the older revert
    await r.go(byId("B08.R02").n); await ft.advance(5_000); await r.go(byId("B08.R03").n); await ft.advance(6_000);
    expect(r.getState().surfaces.MAIN.OVERLAY.slot).toMatch(/ROUND_03/);
  });
  it("panic clears OVERLAY and FULL but keeps the base", async () => {
    const mock = new MockAdapter(); const r = new Runner(doc, cues, [mock]);
    await r.go(byId("B08.TALE").n); await r.go(byId("B08.WALK_RED").n); await r.panic();
    const s = r.getState(); expect(s.surfaces.MAIN.FULL.slot).toBeNull(); expect(s.surfaces.MAIN.BASE.slot).toMatch(/TALE/); expect(mock.log.at(-1)!.op.kind).toBe("panic");
  });
  it("exposes Companion-ready variables", async () => {
    const r = new Runner(doc, cues, []); await r.go(byId("B08.R07").n);
    const v = r.variables(); expect(v.round).toBe("7"); expect(v.red_name).toBe("Antonio Vargas"); expect(v.blue_name).toBe("Jesse Rodriguez"); expect(v.showing_MAIN).toMatch(/ROUND_07/); expect(v.next).toBe(String(byId("B08.R08").n));
  });
  it("next/prev walk the cue list", async () => { const r = new Runner(doc, cues, []); await r.next(); expect(r.getState().current).toBe(1); await r.next(); expect(r.getState().current).toBe(2); await r.prev(); expect(r.getState().current).toBe(1); });
});

describe("adapters translate ops to engine calls", () => {
  it("Resolume: ALL → composition column connect; scoped → per-group connects; revert → layer clear", async () => {
    const calls: string[] = []; const f = (async (url: string, init?: any) => { calls.push(`${init?.method ?? "GET"} ${String(url).replace("http://x/api/v1", "")}`); return { ok: true, json: async () => ({}) } as any; }) as any;
    const ad = new ResolumeAdapter("http://x/api/v1", f); await ad.init(doc);
    await ad.apply({ kind: "fireCue", cue: byId("B08.WIN_RED") }); expect(calls.at(-1)).toBe(`POST /composition/columns/${byId("B08.WIN_RED").n}/connect`);
    await ad.apply({ kind: "fireCue", cue: byId("B08.R01") }); expect(calls.slice(-2)).toEqual([`POST /composition/layergroups/1/columns/${byId("B08.R01").n}/connect`, `POST /composition/layergroups/2/columns/${byId("B08.R01").n}/connect`]);
    await ad.apply({ kind: "revertBase", surface: "RIBBON", layer: "OVERLAY" }); expect(calls.at(-1)).toBe("POST /composition/layers/5/clear"); // RIBBON is group 2 → layers 4,5,6; OVERLAY = 5
    expect(ad.status().connected).toBe(true);
  });
  it("disguise: REST gototag per in-scope transport", async () => {
    const bodies: any[] = []; const f = (async (url: string, init?: any) => { if (init?.body) bodies.push(JSON.parse(init.body)); return { ok: true } as any; }) as any;
    const ad = new DisguiseAdapter("d3", { transports: { MAIN: "MAIN_T" } }, f); await ad.init(doc);
    await ad.apply({ kind: "fireCue", cue: byId("B08.R01") });
    expect(bodies.length).toBe(2); expect(bodies[0].transports[0].transport.name).toBe("MAIN_T"); expect(bodies[0].transports[0].value).toBe("8.11"); expect(bodies[1].transports[0].transport.name).toBe("RIBBON");
  });
});

describe("stinger transitions", () => {
  it("plays the stinger over the in-scope surfaces, then lands the cue at the cover frame", async () => {
    const d = JSON.parse(JSON.stringify(doc)); d.stingers = [{ id: "whoosh", name: "Whoosh", file: "TX_whoosh.mov", durationSec: 1.2, coverSec: 0.5 }]; d.transitions = { WINNER: "stinger:whoosh" };
    const cs = deriveCues(d); const win = cs.find((c) => c.id === "B08.WIN_RED")!; expect(win.transition).toEqual({ kind: "stinger", stinger: "whoosh" });
    expect(cs.find((c) => c.id === "B08.R01")!.transition).toBeUndefined();
    const ft = fakeTimers(); const mock = new MockAdapter(); const r = new Runner(d, cs, [mock], ft);
    const p = r.go(win.n); await Promise.resolve(); await new Promise((res) => setImmediate(res));
    expect(mock.log.at(-1)!.op.kind).toBe("stinger"); expect(mock.log.at(-1)!.detail).toMatch(/whoosh over MAIN,RIBBON,IMAG_L,IMAG_R \(cover 0.5s\)/);
    expect(r.getState().current).toBeNull();                       // not landed yet
    await ft.advance(500); await p;
    expect(r.getState().current).toBe(win.n); expect(mock.log.some((l) => l.op.kind === "fireCue" && l.op.cue?.id === "B08.WIN_RED")).toBe(true); // winner also clears OVERLAY, so the last op is a clearLayer
  });
  it("Resolume adapter fires the stinger's reserved column on each in-scope group", async () => {
    const d = JSON.parse(JSON.stringify(doc)); d.stingers = [{ id: "whoosh", name: "Whoosh", file: "TX_whoosh.mov", durationSec: 1.2, coverSec: 0.5 }];
    const cs = deriveCues(d); const calls: string[] = []; const f = (async (url: string, init?: any) => { calls.push(`${init?.method ?? "GET"} ${String(url).replace("http://x/api/v1", "")}`); return { ok: true, json: async () => ({}) } as any; }) as any;
    const ad = new ResolumeAdapter("http://x/api/v1", f); await ad.init(d, cs);
    await ad.apply({ kind: "stinger", stinger: d.stingers[0], surfaces: ["MAIN", "RIBBON"] });
    expect(calls.slice(-2)).toEqual([`POST /composition/layergroups/1/columns/${cs.length + 1}/connect`, `POST /composition/layergroups/2/columns/${cs.length + 1}/connect`]);
    const plan = resolumePlan(d, cs, "C:/m", "C:/s.avc"); expect(plan.filter((o: any) => o.op === "openClip" && /STINGER_whoosh/.test(o.name)).length).toBe(4); expect((plan[0] as any).columns).toBe(cs.length + 1);
  });
  it("together layout: the stinger connects the ROUNDS group (where the plan put the clips), once", async () => {
    const d = JSON.parse(JSON.stringify(doc)); d.stingers = [{ id: "whoosh", name: "Whoosh", file: "TX_whoosh.mov", durationSec: 1.2, coverSec: 0.5 }]; d.build = { resolumeLayout: "together" };
    const cs = deriveCues(d); const calls: string[] = []; const f = (async (url: string, init?: any) => { calls.push(`${init?.method ?? "GET"} ${String(url).replace("http://x/api/v1", "")}`); return { ok: true, json: async () => ({}) } as any; }) as any;
    const ad = new ResolumeAdapter("http://x/api/v1", f); await ad.init(d, cs);
    await ad.apply({ kind: "stinger", stinger: d.stingers[0], surfaces: ["MAIN", "RIBBON"] });
    // in the plan, together-mode stingers live on the OVERLAY layers = group 2 (ROUNDS); one connect, not one per surface
    expect(calls.slice(1)).toEqual([`POST /composition/layergroups/2/columns/${cs.length + 1}/connect`]);
    const plan = resolumePlan(d, cs, "C:/m", "C:/s.avc");
    const stClips = plan.filter((o: any) => o.op === "openClip" && /STINGER_whoosh/.test(o.name)) as any[];
    expect(stClips.every((o) => o.layer > d.surfaces.length)).toBe(true); // all in the ROUNDS layers
  });
  it("panic clears OVERLAY+FULL per layer and never disconnects the composition (BASE keeps playing)", async () => {
    const calls: string[] = []; const f = (async (url: string, init?: any) => { calls.push(`${init?.method ?? "GET"} ${String(url).replace("http://x/api/v1", "")}`); return { ok: true, json: async () => ({}) } as any; }) as any;
    const ad = new ResolumeAdapter("http://x/api/v1", f); await ad.init(doc, deriveCues(doc));
    await ad.apply({ kind: "panic" });
    const panics = calls.slice(1);
    expect(panics.every((c) => /\/composition\/layers\/\d+\/clear$/.test(c))).toBe(true);
    expect(panics.length).toBe(doc.surfaces.length * 2); // OVERLAY + FULL for each surface, BASE untouched
    expect(calls.some((c) => /disconnect/i.test(c))).toBe(false);
  });
});
