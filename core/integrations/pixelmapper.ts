/**
 * PixelMapper bridge. PixelGrid's Screen (pixel-mapper-v2/src/types/screen.ts): { id, name, panel: PanelPreset, panelsX, panelsY,
 * rotation, canvasId, visible, ... } and ScreenGroup. Pixel size = panelsX * panel.pixelsW (x) by panelsY * panel.pixelsH (y),
 * swapped for 90/270 rotation. A ScreenGroup becomes a Surface; ungrouped screens become one surface each.
 * We only read what PixelMapper already knows; Surface never writes back to it.
 */
import type { Screen, Surface } from "../types.js";

export interface PMPanel { id?: string; name?: string; pixelsW?: number; pixelsH?: number; pixelWidth?: number; pixelHeight?: number; resolutionX?: number; resolutionY?: number; widthPx?: number; heightPx?: number }
export interface PMScreen { id: string; name: string; panel: PMPanel; panelsX: number; panelsY: number; rotation?: 0 | 90 | 180 | 270; canvasId?: string | null; visible?: boolean; notes?: string }
export interface PMGroup { id: string; name: string; screenIds?: string[]; screens?: string[] }
export interface PMProject { screens: PMScreen[]; screenGroups?: PMGroup[]; groups?: PMGroup[]; name?: string; venue?: string }

const panelPx = (p: PMPanel) => ({ w: p.pixelsW ?? p.pixelWidth ?? p.resolutionX ?? p.widthPx ?? 0, h: p.pixelsH ?? p.pixelHeight ?? p.resolutionY ?? p.heightPx ?? 0 });
const slug = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24) || "SCREEN";

export function fromPixelMapper(project: PMProject): { screens: Screen[]; surfaces: Surface[]; screenWords: Record<string, string[]>; flags: string[] } {
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
