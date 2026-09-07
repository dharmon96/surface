import { Fragment } from "react";
import { useStore } from "../store";
import type { Cue } from "../../core/types";

function cell(c: Cue, surface: string) {
  const t = c.targets.find((x) => x.surface === surface); if (!t) return <span className="faint">hold</span>;
  return <>{t.actions.map((a, i) => a.op === "show" ? <span key={i} className={`layer ${a.layer}`} title={a.media.slot}>{a.layer}{a.media.behaviour.kind === "timed" ? ` ${a.media.behaviour.holdSec}s` : a.media.behaviour.kind === "playHold" ? " ⏹" : a.media.behaviour.kind === "playToMarker" ? " ⏸" : ""}</span> : a.op === "clear" ? <span key={i} className="layer empty">{a.layer} ✕</span> : null)}</>;
}

/** The cue list as the caller and operator both read it: one row per cue, one column per surface. */
export function Cues() {
  const { doc, cues, state, go } = useStore(); if (!doc) return null;
  let last = "";
  return (
    <div className="panel scroll" style={{ padding: 0 }}>
      <table><thead><tr><th>#</th><th>Cue</th><th>d3</th><th>Resolume</th>{doc.surfaces.map((s) => <th key={s.id}>{s.name}</th>)}<th>Trigger</th><th>Time</th><th></th></tr></thead>
        <tbody>{cues.map((c) => { const hdr = c.group !== last && c.group !== "EVT"; last = c.group; const b = doc.data.bouts?.find((x: any) => x.id === c.group);
          return (<Fragment key={c.n}>
            {hdr && b && <tr><td colSpan={8 + doc.surfaces.length} style={{ background: b.isMain ? "var(--warn-soft)" : "var(--muted)", fontWeight: 600, fontSize: 15, letterSpacing: ".04em" }}>BOUT {b.order} · {b.rounds} RDS · {String(b.weightClass ?? "").toUpperCase()} {b.title ? `· ${String(b.title).toUpperCase()}` : ""} — <span style={{ color: "var(--red)" }}>{doc.data.fighters[b.red].name}</span> v <span style={{ color: "var(--blue)" }}>{doc.data.fighters[b.blue].name}</span></td></tr>}
            <tr className={state?.current === c.n ? "row-current" : state?.next === c.n ? "row-next" : ""}>
              <td className="num">{String(c.n).padStart(3, "0")}</td><td>{c.name}<div className="faint mono-small">{c.id}</div></td><td className="mono-small">{c.d3?.tag}</td>
              <td className="mono-small">{c.resolume?.groups === "ALL" ? `col ${c.n}` : `col ${c.n} → ${(c.resolume?.groups as string[])?.join(",")}`}</td>
              {doc.surfaces.map((s) => <td key={s.id}>{cell(c, s.id)}</td>)}
              <td className="dim mono-small">{c.trigger}</td><td className="mono-small">{c.timing ?? ""}</td><td><button onClick={() => go(c.n)}>GO</button></td>
            </tr></Fragment>); })}</tbody></table>
    </div>
  );
}
