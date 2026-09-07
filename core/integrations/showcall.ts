/**
 * ShowCall bridge. ShowCall's model (from showcall/src/lib/api.ts): Show { cues: Cue[] }, Cue { cue_number, title, description,
 * duration_seconds, cue_type: standard|section-header|break|note, color, notes, sort_order, departments: CueDepartment[] },
 * CueDepartment { department_name, instructions }.
 *
 * Export: Surface cues → ShowCall cues with a "Video" department carrying the operator instruction (what lands on which surface),
 *         one section-header per bout. Import: ShowCall cues that Surface did not generate become custom cue candidates.
 * Round-trip key: ShowCall cue_number == Surface cue number (zero-padded), so both sheets say the same "go 087".
 */
import type { Cue, ShowDoc } from "../types.js";

export interface ShowCallCueIn { cue_number: string; title: string; description?: string | null; duration_seconds?: number | null; cue_type?: string; color?: string | null; notes?: string | null; sort_order?: number; departments?: { department_name: string; instructions?: string | null }[] }

export function toShowCall(doc: ShowDoc, cues: Cue[], videoDept = "Video") {
  const rows: any[] = []; let sort = 0; let lastGroup = "";
  for (const c of cues) {
    const b = doc.data.bouts?.find((x: any) => x.id === c.group);
    if (b && c.group !== lastGroup) { rows.push({ cue_number: `B${String(b.order).padStart(2, "0")}`, title: `BOUT ${b.order} — ${doc.data.fighters[b.red].name} v ${doc.data.fighters[b.blue].name}`, description: `${b.rounds} rds · ${b.weightClass ?? ""}${b.title ? " · " + b.title : ""}`, cue_type: "section-header", sort_order: sort++, color: b.isMain ? "#d4a63a" : null, departments: [] }); lastGroup = c.group; }
    const per = c.targets.map((t) => { const s = doc.surfaces.find((x) => x.id === t.surface)?.name ?? t.surface; const acts = t.actions.map((a) => a.op === "show" ? `${a.layer}: ${a.media.slot}` : a.op === "clear" ? `${a.layer}: clear` : `${a.layer}: ${a.key}=${a.value}`).join(", "); return `${s} → ${acts}`; });
    rows.push({ cue_number: String(c.n).padStart(3, "0"), title: c.name, description: c.trigger ?? null, duration_seconds: c.follow?.afterSec ?? null, cue_type: "standard", start_time: c.timing ?? null, color: /WALK_RED|WIN_RED|INTRO_RED/.test(c.id) ? "#e0472f" : /WALK_BLUE|WIN_BLUE|INTRO_BLUE/.test(c.id) ? "#4a86e8" : null, notes: c.notes ?? null, sort_order: sort++,
      departments: [{ department_name: videoDept, instructions: `${c.resolume ? `Resolume col ${c.resolume.column}${c.resolume.groups === "ALL" ? "" : " (" + (c.resolume.groups as string[]).join(",") + ")"}` : ""}${c.d3 ? ` · d3 CUE ${c.d3.tag}` : ""}\n${per.join("\n")}` }], surface: { id: c.id, scope: c.scope } });
  }
  return { event_type: "boxing", name: doc.event.name, event_date: doc.event.date ?? null, venue: doc.event.venue ?? null, cues: rows };
}

/** ShowCall cues Surface didn't author (no zero-padded number that matches a Surface cue) → custom cue candidates for the cue editor. */
export function fromShowCall(cues: Cue[], scRows: ShowCallCueIn[]) {
  const ours = new Set(cues.map((c) => String(c.n).padStart(3, "0")));
  return scRows.filter((r) => r.cue_type !== "section-header" && !ours.has(r.cue_number)).map((r) => ({
    id: `SC.${r.cue_number}`, group: "SHOWCALL", origin: "rundown" as const, name: r.title, scope: ["ALL"], targets: [],
    trigger: r.description ?? undefined, notes: [r.notes, r.departments?.map((d) => `${d.department_name}: ${d.instructions ?? ""}`).join(" · ")].filter(Boolean).join(" — ") || undefined,
    follow: r.duration_seconds ? { afterSec: r.duration_seconds } : undefined,
  }));
}
