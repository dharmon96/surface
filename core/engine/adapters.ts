import { createSocket, type Socket } from "node:dgram";
import type { Cue, ShowDoc } from "../types.js";
import { resolumeAddress, type AdapterStatus, type EngineAdapter, type EngineOp } from "./adapter.js";
import { expandScope } from "../naming.js";
import { stingerColumn, type ResolumeOp } from "../gen/engines.js";

// ───────────────────────────────────────────── mock: records everything (tests, dry-run, "Author-only" preview)
export class MockAdapter implements EngineAdapter {
  id = "mock"; log: { t: number; op: EngineOp; detail: string }[] = []; doc!: ShowDoc;
  async init(doc: ShowDoc) { this.doc = doc; }
  async apply(op: EngineOp) {
    let detail: string = op.kind;
    if (op.kind === "fireCue" && op.cue) { const r = op.cue.resolume; detail = r?.groups === "ALL" ? `column ${r.column} → composition` : `column ${r?.column} → groups ${(r?.groups as string[])?.join(",")}`; }
    if (op.kind === "stinger") detail = `stinger ${op.stinger?.id} over ${op.surfaces?.join(",")} (cover ${op.stinger?.coverSec}s)`;
    if (op.kind === "clearLayer" || op.kind === "revertBase") detail = `${op.kind} ${op.surface}/${op.layer}`;
    if (op.kind === "setText") detail = `text ${op.surface}/${op.layer} ${op.key}=${op.value}`;
    this.log.push({ t: Date.now(), op, detail });
  }
  status(): AdapterStatus { return { id: this.id, connected: true, detail: `${this.log.length} ops` }; }
  async close() {}
}

// ───────────────────────────────────────────── Resolume Arena — REST /api/v1 (7.8+). Column == cue.n; group per surface.
export class ResolumeAdapter implements EngineAdapter {
  id = "resolume"; private doc!: ShowDoc; private cues: Cue[] = []; private ok = false; private lastError?: string; private latency?: number;
  constructor(private base = "http://127.0.0.1:8080/api/v1", private fetchImpl: typeof fetch = fetch) {}
  private async req(method: string, path: string, body?: string | object) {
    const t = Date.now();
    const r = await this.fetchImpl(this.base + path, { method, headers: { "Content-Type": typeof body === "string" ? "text/plain" : "application/json" }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
    this.latency = Date.now() - t; if (!r.ok) throw new Error(`${method} ${path} → ${r.status}`); this.ok = true; return r;
  }
  async init(doc: ShowDoc, cues: Cue[] = []) { this.doc = doc; this.cues = cues; try { await this.req("GET", "/composition"); } catch (e: any) { this.ok = false; this.lastError = e.message; } }
  async apply(op: EngineOp) {
    try {
      if (op.kind === "stinger" && op.stinger) {
        const col = stingerColumn(this.doc, this.cues, op.stinger.id); if (col === null) throw new Error(`stinger ${op.stinger.id} has no column`);
        for (const s of op.surfaces ?? []) await this.req("POST", `/composition/layergroups/${resolumeAddress(this.doc, s, "BASE").group}/columns/${col}/connect`);
      } else if (op.kind === "fireCue" && op.cue) {
        const r = op.cue.resolume!; const groups = r.groups === "ALL" ? null : r.groups;
        if (!groups) await this.req("POST", `/composition/columns/${r.column}/connect`);
        else for (const s of groups) await this.req("POST", `/composition/layergroups/${resolumeAddress(this.doc, s, "BASE").group}/columns/${r.column}/connect`);
      } else if ((op.kind === "clearLayer" || op.kind === "revertBase") && op.surface && op.layer) {
        await this.req("POST", `/composition/layers/${resolumeAddress(this.doc, op.surface, op.layer).layer}/clear`);   // base keeps playing underneath
      } else if (op.kind === "setText" && op.surface && op.layer) {
        // text lands on the Text Block source of the currently connected clip on that layer: /composition/layers/{i}/clips/selected … via WS `set` in future; REST fallback = PUT on the connected clip's source param
        const { layer } = resolumeAddress(this.doc, op.surface, op.layer);
        await this.req("PUT", `/composition/layers/${layer}/clips/selected`, { video: { sourceparams: { Text: { value: op.value } } } });
      } else if (op.kind === "openClip" && op.surface && op.layer && op.cue && op.file) {
        const { layer } = resolumeAddress(this.doc, op.surface, op.layer);
        await this.req("POST", `/composition/layers/${layer}/clips/${op.cue.n}/open`, `file:///${op.file}`);
      } else if (op.kind === "panic") {
        await this.req("POST", "/composition/disconnectall").catch(async () => { for (let g = 1; g <= this.doc.surfaces.length; g++) for (const l of ["OVERLAY", "FULL"] as const) await this.req("POST", `/composition/layers/${resolumeAddress(this.doc, this.doc.surfaces[g - 1].id, l).layer}/clear`); });
      }
    } catch (e: any) { this.ok = false; this.lastError = e.message; throw e; }
  }
  status(): AdapterStatus { return { id: this.id, connected: this.ok, latencyMs: this.latency, lastError: this.lastError, detail: this.base }; }
  /** Execute a build plan (resolumePlan) live over REST — the same ops the generated python script runs. Idempotent. */
  async build(plan: ResolumeOp[], onProgress?: (done: number, total: number, op: ResolumeOp) => void) {
    const name = (path: string, n: string) => this.req("PUT", path, { name: { value: n } });
    let done = 0;
    for (const o of plan) {
      switch (o.op) {
        case "grow": await this.req("POST", "/composition/grow-to", { column_count: o.columns, layer_count: o.layers }); break;
        case "addGroup": { const comp: any = await (await this.req("GET", "/composition")).json(); if (o.index > (comp.layergroups?.length ?? 0)) await this.req("POST", "/composition/layergroups/add"); await name(`/composition/layergroups/${o.index}`, o.name); break; }
        case "renameLayer": await name(`/composition/layers/${o.index}`, o.name); break;
        case "renameColumn": await name(`/composition/columns/${o.index}`, o.name); break;
        case "openClip": await this.req("POST", `/composition/layers/${o.layer}/clips/${o.column}/open`, o.url); await name(`/composition/layers/${o.layer}/clips/${o.column}`, o.name); break;
        case "clearClip": await this.req("POST", `/composition/layers/${o.layer}/clips/${o.column}/clear`); break;
        case "save": await this.req("POST", "/composition/save", o.url); break;
      }
      onProgress?.(++done, plan.length, o);
    }
    return done;
  }
  async close() {}
}

// ───────────────────────────────────────────── disguise — REST transport (gototag per transport) with OSC /d3/showcontrol/cue fallback
export class DisguiseAdapter implements EngineAdapter {
  id = "disguise"; private doc!: ShowDoc; private ok = false; private lastError?: string; private sock?: Socket;
  constructor(private host = "10.0.0.10", private opts: { rest?: boolean; oscPort?: number; transports?: Record<string, string> } = {}, private fetchImpl: typeof fetch = fetch) {}
  async init(doc: ShowDoc) {
    this.doc = doc;
    if (this.opts.rest !== false) { try { const r = await this.fetchImpl(`http://${this.host}/api/session/transport/transports`); this.ok = r.ok; } catch (e: any) { this.ok = false; this.lastError = e.message; } }
    if (!this.ok) { this.sock = createSocket("udp4"); }
  }
  private transportFor(surface: string) { return this.opts.transports?.[surface] ?? surface; }
  private osc(address: string, args: (number | string)[]) {
    // minimal OSC encoder: address, type tags, int32/string args
    const pad = (b: Buffer) => Buffer.concat([b, Buffer.alloc(4 - (b.length % 4 || 4))]);
    const str = (s: string) => pad(Buffer.from(s + "\0"));
    const tags = "," + args.map((a) => (typeof a === "number" ? "i" : "s")).join("");
    const body = args.map((a) => (typeof a === "number" ? (() => { const b = Buffer.alloc(4); b.writeInt32BE(a); return b; })() : str(a)));
    const msg = Buffer.concat([str(address), str(tags), ...body]);
    this.sock?.send(msg, this.opts.oscPort ?? 7401, this.host);
  }
  async apply(op: EngineOp) {
    if (op.kind === "fireCue" && op.cue?.d3) {
      const [maj, min] = op.cue.d3.tag.split(".").map(Number);
      if (this.ok) {
        for (const s of expandScope(this.doc, op.cue.scope)) {
          const r = await this.fetchImpl(`http://${this.host}/api/session/transport/gototag`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transports: [{ transport: { name: this.transportFor(s) }, type: "CUE", value: op.cue.d3.tag, playmode: "PlaySection", allowGlobalJump: true }] }) });
          if (!r.ok) { this.lastError = `gototag ${op.cue.d3.tag} → ${r.status}`; throw new Error(this.lastError); }
        }
      } else this.osc("/d3/showcontrol/cue", [maj, min]);            // OSC transport can't scope per surface: it hits the OSC transport's track
    } else if (op.kind === "setText" && op.surface && op.key) {
      if (this.ok) await this.fetchImpl(`http://${this.host}/api/session/sockpuppet/live`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patches: [{ address: `${op.surface}/${op.key}`, changes: [{ field: "text", stringValue: op.value ?? "" }] }] }) });
      else this.osc(`/d3/layer/${op.surface}_${op.key}/text`, [op.value ?? ""]);
    } else if (op.kind === "panic") { if (this.ok) await this.fetchImpl(`http://${this.host}/api/session/transport/stop`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transports: [] }) }).catch(() => {}); else this.osc("/d3/showcontrol/fadedown", [1]); }
    // clearLayer / revertBase: disguise sections already model this (the base section loops); a dedicated "clear" tag per bout (N.98) is a later refinement
  }
  status(): AdapterStatus { return { id: this.id, connected: this.ok || !!this.sock, detail: this.ok ? `REST ${this.host}` : `OSC ${this.host}:${this.opts.oscPort ?? 7401}`, lastError: this.lastError }; }
  async close() { this.sock?.close(); }
}

// ───────────────────────────────────────────── Companion — pushes runner variables as custom variables so buttons label/highlight themselves
export class CompanionAdapter implements EngineAdapter {
  id = "companion"; private ok = false; private lastError?: string;
  constructor(private base = "http://127.0.0.1:8000", private getVars: () => Record<string, string>, private fetchImpl: typeof fetch = fetch) {}
  async init() { try { const r = await this.fetchImpl(`${this.base}/api/connections`); this.ok = r.ok; } catch (e: any) { this.ok = false; this.lastError = e.message; } }
  async apply(op: EngineOp) {
    if (op.kind !== "fireCue" && op.kind !== "revertBase" && op.kind !== "panic") return;
    const vars = this.getVars();
    await Promise.all(Object.entries(vars).map(([k, v]) => this.fetchImpl(`${this.base}/api/custom-variable/${encodeURIComponent(k)}/value`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: v }).then((r) => { this.ok = r.ok; }).catch((e) => { this.ok = false; this.lastError = e.message; })));
  }
  status(): AdapterStatus { return { id: this.id, connected: this.ok, detail: this.base, lastError: this.lastError }; }
  async close() {}
}
