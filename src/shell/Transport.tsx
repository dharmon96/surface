import { useStore } from "../store";

/**
 * Run mode's bottom band: what is on the walls, what fires next, and the three buttons that matter.
 * Buttons never take focus, so a Space after clicking one still means GO and nothing else.
 */
const blur = (e: React.MouseEvent) => (e.currentTarget as HTMLElement).blur();

export function Transport() {
  const { state, board, cues, venueMode, setVenueMode, go, next, prev, panic } = useStore();
  const liveRow = state?.bout ? board?.rows.find((r) => r.id === state.bout) : undefined;
  const nextCue = state?.next != null ? cues.find((c) => c.n === state.next) : undefined;
  const test = board?.rows.find((r) => r.kind === "event")?.cells.TEST?.cues[0];
  const desktop = (window as any).surface;
  return (
    <div className="transport">
      <div className="readout">
        <b>{liveRow ? `${liveRow.id} · ${liveRow.title}` : "Pre-show"}</b>
        <small>{state?.round ? `round ${state.round}` : ""}{state?.current ? `${state.round ? " · " : ""}cue ${state.current}` : ""}</small>
      </div>
      <span className="nextcue">{nextCue ? <>next <b>{nextCue.n}</b> · {nextCue.name}</> : "end of show"}</span>
      <span className="grow" />
      {test && <button className="btn" tabIndex={-1} onMouseUp={blur} onClick={() => go(test.n)} title="Every screen's own test pattern — the line-up you can always go back to">Test patterns</button>}
      <button className={`btn ${venueMode !== "off" ? "on" : ""}`} tabIndex={-1} onMouseUp={blur} onClick={() => setVenueMode(venueMode === "off" ? "side" : venueMode === "side" ? "big" : "off")} title="What the walls are showing, on the LED map">
        {venueMode === "off" ? "Venue" : venueMode === "side" ? "Venue · bigger" : "Venue · hide"}
      </button>
      <button className="btn" tabIndex={-1} onMouseUp={blur} onClick={() => { if (desktop?.openClock) desktop.openClock(); else window.open("/clock.html", "surface-clock", "width=560,height=320"); }} title="Time left on whatever video is playing — its own window, or on a laptop at /clock.html">Clip clock</button>
      <button className="btn" tabIndex={-1} onMouseUp={blur} disabled={state?.current == null} onClick={() => prev()}>◀ Back</button>
      <button className="gobtn" tabIndex={-1} onMouseUp={blur} onClick={() => next()}>GO</button>
      <button className="panic" tabIndex={-1} onMouseUp={blur} onClick={() => panic()}>PANIC</button>
    </div>
  );
}
