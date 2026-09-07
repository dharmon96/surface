/**
 * PixelMapper bridge. PixelGrid's Screen (pixel-mapper-v2/src/types/screen.ts): { id, name, panel: PanelPreset, panelsX, panelsY,
 * rotation, canvasId, visible, ... } and ScreenGroup. Pixel size = panelsX * panel.pixelsW (x) by panelsY * panel.pixelsH (y),
 * swapped for 90/270 rotation. A ScreenGroup becomes a Surface; ungrouped screens become one surface each.
 * We only read what PixelMapper already knows; Surface never writes back to it.
 */
import type { Screen, Surface } from "../types.js";

export interface PMPanel { id?: string; name?: string; resX?: number; resY?: number; pixelsW?: number; pixelsH?: number; pixelWidth?: number; pixelHeight?: number; resolutionX?: number; resolutionY?: number; widthPx?: number; heightPx?: number }
export interface PMScreen { id: string; name: string; panel: PMPanel; panelsX: number; panelsY: number; rotation?: 0 | 90 | 180 | 270; canvasId?: string | null; visible?: boolean; notes?: string }
export interface PMGroup { id: string; name: string; screenIds?: string[]; screens?: string[] }
export interface PMProject { screens: PMScreen[]; screenGroups?: PMGroup[]; groups?: PMGroup[]; name?: string; venue?: string }

const panelPx = (p: PMPanel) => ({ w: p.resX ?? p.pixelsW ?? p.pixelWidth ?? p.resolutionX ?? p.widthPx ?? 0, h: p.resY ?? p.pixelsH ?? p.pixelHeight ?? p.resolutionY ?? p.heightPx ?? 0 });
/** PixelGrid saves `{ metadata, data: { screens: Record, screenGroups: Record } }` (the hub `project:<id>` value and the .pixelmap file); older exports used arrays. */
export function normalizePixelMapper(input: any): PMProject {
  const d = input?.data ?? input; const arr = (x: any) => (Array.isArray(x) ? x : x && typeof x === "object" ? Object.values(x) : []);
  return { name: input?.metadata?.name ?? d?.name, venue: input?.metadata?.venue ?? d?.venue, screens: arr(d?.screens), screenGroups: arr(d?.screenGroups ?? d?.groups) };
}
const slug = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24) || "SCREEN";

export function fromPixelMapper(input: PMProject | any): { screens: Screen[]; surfaces: Surface[]; screenWords: Record<string, string[]>; flags: string[] } {
  const project = normalizePixelMapper(input);
  const flags: string[] = []; const used = new Set<string>();
  const screens: Screen[] = project.screens.filter((s) => s.visible !== false).map((s) => {
    const px = panelPx(s.panel); let w = s.panelsX * px.w, h = s.panelsY * px.h; if (s.rotation === 90 || s.rotation === 270) [w, h] = [h, w];
    if (!w || !h) flags.push(`${s.name}: panel preset has no pixel size — set it in PixelMapper`);
    let id = slug(s.name); while (used.has(id)) id += "_2"; used.add(id);
    return { id, name: s.name, w, h, pixelMapper: { screenId: s.id, canvasId: s.canvasId ?? undefined } };
  });
  const byPm = new Map(screens.map((sc) => [sc.pixelMapper!.screenId!, sc.id]));
  const groups = project.screenGroups ?? project.groups ?? []; const grouped = new Set<string>();
  const surfaces: Surface[] = groups.map((g) => { const ids = (g.screenIds ?? g.screens ?? []).map((i) => byPm.get(i)).filter(Boolean) as string[]; ids.forEach((i) => grouped.add(i)); return { id: slug(g.name), name: g.name, screens: ids }; }).filter((s) => s.screens.length);
  for (const sc of screens) if (!grouped.has(sc.id)) surfaces.push({ id: sc.id, name: sc.name, screens: [sc.id], independent: /host|booth|table|scale|podium/i.test(sc.name) || undefined });
  // seed the promoter-word synonym table from the names PixelMapper uses
  const screenWords: Record<string, string[]> = {}; for (const sc of screens) screenWords[sc.id] = [sc.name.toLowerCase(), ...sc.name.toLowerCase().split(/[\s_-]+/).filter((w) => w.length > 3)];
  return { screens, surfaces, screenWords, flags };
}

/** Surface → the LED Content Guide facts PixelMapper's Show Book renders: one line per surface with size, aspect, codec and naming. */
export function contentGuideRows(screens: Screen[], surfaces: Surface[]) {
  return surfaces.map((s) => { const sc = s.screens.map((id) => screens.find((x) => x.id === id)!).filter(Boolean); const w = sc[0]?.w ?? 0, h = sc[0]?.h ?? 0; const g = (a: number, b: number): number => (b ? g(b, a % b) : a); const d = g(w, h) || 1;
    return { surface: s.name, screens: sc.map((x) => x.name).join(", "), pixels: `${w} × ${h}`, aspect: `${w / d}:${h / d}`, stills: "PNG, native resolution, RGB", video: w > 16384 ? "H.264 or ProRes .MOV, native resolution (Surface tiles it)" : "H.264 .MOV, native resolution", naming: `{Bout}_{Graphic}_{Variant}_${s.id}_${w}x${h}` }; });
}

/** Sensible routing from shapes alone: ultra-wide (> 6:1) = ribbon → rounds, fighter cards, holds; independent → holds only; the rest → everything. */
export function autoRouting(screens: Screen[], surfaces: Surface[]): Record<string, string[]> {
  const of = (sid: string) => screens.filter((s) => surfaces.find((x) => x.id === sid)?.screens.includes(s.id));
  const isRibbon = (sid: string) => of(sid).some((s) => s.w / Math.max(1, s.h) > 6);
  const area = (sid: string) => of(sid).reduce((n, s) => n + s.w * s.h, 0);
  const normal = surfaces.filter((s) => !s.independent && !isRibbon(s.id)).map((s) => s.id).sort((a, b) => area(b) - area(a)); // biggest wall first = "the main"
  const ribbon = surfaces.filter((s) => !s.independent && isRibbon(s.id)).map((s) => s.id);
  const r: Record<string, string[]> = { HOLD: ["ALL"], UP_NEXT: normal, WALKOUT: normal, FIGHTER: [...normal.slice(0, 1), ...ribbon], TALE: normal, ROUND: [...normal.slice(0, 1), ...ribbon], ROUND_STAY: ribbon, WINNER: ["ALL"], FLAG: normal.slice(0, 1), VT: normal };
  for (const k of Object.keys(r)) if (!r[k].length) r[k] = normal.length ? [normal[0]] : ["ALL"];
  return r;
}

/**
 * PixelGrid's native exports are named `{Project}_{Screen}_{layout|panel-diagram|wiring-diagram}_{W}x{H}.png`, one per screen,
 * 1:1 pixels, with the screen's test pattern and labels baked in. Given the file names (and probed sizes for anything that
 * doesn't follow the pattern), rebuild the screen list; the common prefix is the project name.
 */
export function screensFromMapFiles(files: { name: string; w: number; h: number }[]): { screens: (Screen & { file: string })[]; project?: string } {
  const parsed = files.map((f) => { const m = f.name.match(/^(.*)_(layout|panel-diagram|wiring-diagram|test|pattern)_(\d+)x(\d+)\.(png|jpe?g|webp)$/i); return m ? { file: f.name, stem: m[1], mode: m[2].toLowerCase(), w: Number(m[3]), h: Number(m[4]) } : { file: f.name, stem: f.name.replace(/\.(png|jpe?g|webp)$/i, ""), mode: "", w: f.w, h: f.h }; });
  // prefer the layout render when a screen was exported in several modes
  const rank = (m: string) => (m === "layout" || m === "test" || m === "pattern" ? 0 : m === "" ? 1 : 2);
  const byStem = new Map<string, typeof parsed[number]>(); for (const p of parsed) { const cur = byStem.get(p.stem); if (!cur || rank(p.mode) < rank(cur.mode)) byStem.set(p.stem, p); }
  const stems = [...byStem.keys()];
  // common `Project_` prefix → the screen name is what's left
  // the prefix is measured over PixelGrid-named files only (a stray PNG in the folder must not hide it)
  const pgStems = stems.filter((st) => byStem.get(st)!.mode);
  let prefix = ""; if (pgStems.length > 1) { const parts = pgStems.map((s) => s.split("_")); let n = 0; while (parts.every((p) => p.length > n + 1 && p[n] === parts[0][n])) n++; prefix = parts[0].slice(0, n).join("_"); if (prefix) prefix += "_"; }
  const used = new Set<string>();
  const screens = stems.map((stem) => { const p = byStem.get(stem)!; const name = (prefix && p.mode && stem.startsWith(prefix) ? stem.slice(prefix.length) : stem).replace(/_/g, " ").trim() || stem; let id = name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24) || "SCREEN"; while (used.has(id)) id += "_2"; used.add(id); return { id, name, w: p.w, h: p.h, file: p.file }; });
  return { screens, project: prefix ? prefix.slice(0, -1).replace(/_/g, " ") : undefined };
}
