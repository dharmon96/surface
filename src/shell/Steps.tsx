import { useStore } from "../store";

/**
 * Show day, in order: sheet → screens → graphics → confirm → engine → build. The same six steps the checklist used to
 * list down the rail, now a row across the strip — each one a button to whatever fixes it.
 */
export interface Step { done: boolean; text: string; action?: string; go?: () => void; soft?: boolean }

export function useSteps(): Step[] {
  const { board, doc, health, versions, confirm, hub, setDrawer, setDock, openDeck } = useStore();
  if (!board || !doc) return [];
  const bouts = doc.data.bouts?.length ?? 0;
  const noScreens = !doc.screens.length; const placeholders = noScreens || /placeholder/i.test(doc.review.flags.join(" "));
  const toConfirm = confirm?.count ?? 0;
  const engines = (health?.adapters ?? []).filter((a) => a.id !== "mock"); const resolume = engines.find((a) => a.id === "resolume");
  const built = (doc as any).built?.resolume as string | undefined;
  return [
    { done: bouts > 0, text: bouts ? `Card · ${bouts} bouts${versions.length ? ` · sheet v${versions.length}` : ""}` : "Drop the bout sheet or timing sheet", action: bouts ? undefined : "Build by hand", go: () => setDrawer("Card") },
    { done: !placeholders, text: noScreens ? "No screens yet — load the venue" : placeholders ? "Screens are placeholders — load the venue" : `Screens · ${doc.screens.length}${doc.screens.some((s) => s.venue?.source?.startsWith("pixelgrid")) ? " from PixelGrid" : ""}`, action: placeholders ? (hub?.signedIn ? "Load from PixelGrid" : "Load screens") : "Edit", go: () => setDrawer("Screens") },
    { done: !!board.delivery && board.totals.missing === 0, soft: !!board.delivery, text: !board.delivery ? "Drop the promoter's graphics folder" : board.totals.missing ? `Graphics · ${board.totals.ready} ready · ${board.totals.missing} missing` : `Graphics · all ${board.totals.ready} ready`, action: board.delivery && board.totals.missing ? "What's missing" : undefined, go: () => setDock("missing") },
    { done: toConfirm === 0, text: toConfirm ? `${toConfirm} thing${toConfirm > 1 ? "s" : ""} the sheet and the files left open` : "Card and graphics confirmed", action: toConfirm ? "Confirm" : undefined, go: () => openDeck() },
    { done: !!resolume?.connected, text: resolume ? (resolume.connected ? "Resolume connected" : "Resolume not answering") : engines.length ? `${engines.map((e) => e.id).join(", ")} ${engines.every((e) => e.connected) ? "connected" : "offline"}` : "No engine yet — rehearsal mode", action: resolume?.connected ? undefined : "Connect", go: () => setDrawer("Engines") },
    { done: !!built, text: built ? `Built ${new Date(built).toLocaleTimeString([], { timeStyle: "short" })}` : "Build Resolume when the graphics are in", action: built ? undefined : "Build", go: () => setDock("build"), soft: true },
  ];
}

/** the strip's second row: every step at a glance, the next one ringed */
export function StepRow() {
  const steps = useSteps(); if (!steps.length) return null;
  const next = steps.find((s) => !s.done);
  if (!next) return <div className="steps"><span className="step done"><i />Show-ready</span></div>;
  return (
    <div className="steps">
      {steps.map((s, i) => (
        <span key={i} className={`step ${s.done ? "done" : s === next ? "next" : ""} ${s.soft && !s.done ? "soft" : ""}`}>
          <i /><span>{s.text}</span>
          {s.action && s.go && <button className="x" onClick={s.go}>{s.action}</button>}
        </span>
      ))}
    </div>
  );
}
