import { describe, it, expect, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { startServer } from "../server/index.js";
import { MockAdapter } from "../core/engine/adapters.js";

import { mkdtempSync, copyFileSync } from "node:fs"; import { join } from "node:path"; import { tmpdir } from "node:os";
const fixture = join(mkdtempSync(join(tmpdir(), "surface-srv-")), "show.json"); copyFileSync(new URL("../fixtures/2026-06-13-glendale.bout.json", import.meta.url), fixture);
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

describe("Card Board", () => {
  it("lays the card out as rows of graphics with per-screen readiness, all missing before a delivery", async () => {
    const b = await (await fetch(`${base}/api/board`)).json();
    expect(b.columns.map((c: any) => c.key)).toEqual(["OPEN", "WALK_RED", "WALK_BLUE", "TALE", "UP_NEXT", "ROUNDS", "WINNER"]);
    expect(b.rows.length).toBe(9); expect(b.rows[0].kind).toBe("event"); expect(b.rows[8].meta.isMain).toBe(true);
    const b8 = b.rows[8]; expect(b8.rounds.length).toBe(12); expect(b8.cells.WALK_RED.slots.map((s: any) => s.screen)).toContain("MAIN"); expect(b8.cells.WALK_RED.status).toBe("missing");
    expect(b8.cells.OPEN.cues[0].id).toBe("B08.VT_OPEN"); expect(b.rows[1].cells.OPEN).toBeUndefined(); // the fight open belongs to the main/co-main, not the opener
    expect(b.totals.missing).toBe(b.totals.slots); expect(b.screens.find((s: any) => s.id === "RIBBON").total).toBeGreaterThan(50);
    const req = await (await fetch(`${base}/api/board/request`)).text(); expect(req).toMatch(/Bout 8 \(.*\): .*walkout — Main LED 3840×1080/);
  });
  it("merges a newer sheet into the open show and keeps the version diff", async () => {
    const text = readFileSync(new URL("../fixtures/text/2026-06-13-glendale-timing.txt", import.meta.url), "utf8");
    const r = await (await fetch(`${base}/api/sheet`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, file: "timing-v2.txt" }) })).json();
    expect(r.ok).toBe(true); const v = await (await fetch(`${base}/api/versions`)).json(); expect(v.at(-1).file).toBe("timing-v2.txt");
  });
});

describe("clip clock", () => {
  it("counts down whatever non-looping media is on the walls", async () => {
    const cues = await (await fetch(`${base}/api/cues`)).json();
    const round = cues.find((c: any) => c.id === "B08.R01");
    await fetch(`${base}/api/cue/${round.n}/go`, { method: "POST" });
    const ck = await (await fetch(`${base}/api/clock`)).json();
    const r1 = ck.playing.find((p: any) => p.cue.id === "B08.R01" && p.behaviour === "timed");
    expect(r1).toBeTruthy(); expect(r1.totalSec).toBe(10);
    expect(r1.remainingSec).toBeGreaterThan(8); expect(r1.remainingSec).toBeLessThanOrEqual(10);
    // a playHold clip that has not been converted yet has no known duration — the clock says so instead of guessing
    const open = cues.find((c: any) => c.id === "B08.VT_OPEN");
    await fetch(`${base}/api/cue/${open.n}/go`, { method: "POST" });
    const ck2 = await (await fetch(`${base}/api/clock`)).json();
    const o = ck2.playing.find((p: any) => p.cue.id === "B08.VT_OPEN");
    expect(o.behaviour).toBe("playHold"); expect(o.remainingSec).toBeNull();
    expect(ck2.share.lan).toBe(false); // loopback by default — LAN sharing is the --bind opt-in
  });
});

describe("Confirm deck", () => {
  it("lists the open questions, and the board and show agree on the count", async () => {
    const v = await (await fetch(`${base}/api/confirm`)).json();
    expect(v.count).toBe(v.items.length);
    expect(v.items.length).toBeGreaterThan(0);
    // the merged Glendale timing sheet asks about the weight class it read from a weight
    expect(v.items.some((i: any) => i.kind === "weight-class")).toBe(true);
    const show = await (await fetch(`${base}/api/show`)).json();
    expect(show.confirm).toBe(v.count);
    const board = await (await fetch(`${base}/api/board`)).json();
    const asked = board.rows.flatMap((r: any) => r.asks.map((a: any) => a.key));
    expect(asked.every((k: string) => v.items.some((i: any) => i.key === k))).toBe(true);
    expect(v.items.every((i: any) => typeof i.thumbs === "object")).toBe(true);
  });
  it("an answer moves the card out of the deck and changes the doc", async () => {
    const v = await (await fetch(`${base}/api/confirm`)).json();
    const main = v.items.find((i: any) => i.kind === "main");
    const other = main.options.find((o: any) => !o.suggested);
    const before = v.count;
    const r = await (await fetch(`${base}/api/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: main.key, option: other.id }) })).json();
    expect(r.ok).toBe(true); expect(r.count).toBe(before - 1);
    const doc = await (await fetch(`${base}/api/doc`)).json();
    expect(doc.decisions[main.key].value).toBe(other.id);
    const pk = (b: any) => [b.red, b.blue].sort().join("|");
    expect(doc.data.bouts.find((b: any) => b.isMain && pk(b) === other.id)).toBeTruthy();
    expect((await (await fetch(`${base}/api/confirm`)).json()).items.some((i: any) => i.key === main.key)).toBe(false);
  });
  it("refuses an unknown question and an unknown option, and forgetting one puts it back", async () => {
    expect((await fetch(`${base}/api/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "nope" }) })).status).toBe(404);
    const v = await (await fetch(`${base}/api/confirm`)).json();
    const first = v.items[0];
    expect((await fetch(`${base}/api/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: first.key, option: "not-an-option" }) })).status).toBe(400);
    const back = await (await fetch(`${base}/api/confirm/forget`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "main" }) })).json();
    expect(back.items.some((i: any) => i.kind === "main")).toBe(true);   // the question is open again
    expect(back.answered.some((a: any) => a.key === "main")).toBe(false);
  });
});
