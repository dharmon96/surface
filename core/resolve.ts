import type { Cue, ShowDoc } from "./types.js";
import { expandScope } from "./naming.js";

/**
 * Fill engine addresses. Resolume: one layer group per surface, cue n == column n; scope ALL => composition-level
 * column connect, otherwise per-group connects. disguise: one transport per surface. Companion positions come from the
 * page generator, not here.
 */
export function resolve(doc: ShowDoc, cues: Cue[]): Cue[] {
  const all = expandScope(doc, ["ALL"]);
  return cues.map((c) => {
    const scope = expandScope(doc, c.scope);
    const isAll = all.length === scope.length && all.every((s) => scope.includes(s));
    return {
      ...c,
      resolume: { column: c.n, groups: isAll ? "ALL" : scope },
      d3: c.d3 ? { ...c.d3, transports: scope } : undefined,
      showcall: { cueNumber: String(c.n).padStart(3, "0") },
    };
  });
}

/** Merge custom cues (rundown / hand-added) after pack cues; they take the next free numbers. */
export function withCustomCues(pack: Cue[], custom: Partial<Cue>[] = []): Cue[] {
  let n = pack.length;
  const extra = custom.map((c) => ({
    n: ++n, id: c.id ?? `CUSTOM.${n}`, group: c.group ?? "CUSTOM", name: c.name ?? `Cue ${n}`, origin: c.origin ?? "custom",
    scope: c.scope ?? ["ALL"], targets: c.targets ?? [], ...c,
  })) as Cue[];
  return [...pack, ...extra];
}

/** Legacy bout.json (boutkit/1.0, Python prototype) -> ShowDoc 2.0 */
export function fromLegacyBoutJson(old: any): ShowDoc {
  const screens = old.screens.map((s: any) => ({ id: s.id, name: s.name, w: s.w, h: s.h }));
  const groups: Record<string, string[]> = old.screenGroups ?? {};
  // default: one surface per screen; named groups become extra surfaces only if used in routing
  const surfaces = screens.map((s: any) => ({ id: s.id, name: s.name, screens: [s.id] }));
  for (const [gid, ids] of Object.entries(groups)) if (gid !== "ALL") surfaces.push({ id: gid, name: gid, screens: ids });
  const routing: Record<string, string[]> = {};
  for (const [g, r] of Object.entries(old.routing ?? {})) routing[g] = r as string[];
  routing.VT ??= routing.WALKOUT ?? ["ALL"];
  const bouts = old.bouts.map((b: any) => ({ ...b }));
  const main = bouts.find((b: any) => b.isMain);
  if (main) { const cm = bouts.find((b: any) => b.order === main.order - 1); if (cm) cm.isCoMain = true; }
  return {
    schema: "boutkit/2.0", source: old.source, event: old.event, screens, surfaces,
    data: { fighters: old.fighters, bouts, vts: old.vts ?? [] }, routing,
    customCues: old.customCues ?? [], review: old.review ?? { status: "draft", flags: [] },
  };
}
