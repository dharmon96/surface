import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseTimingSheet, parseBoutSheet, mergeSheets } from "../core/parse/index.js";
import { deriveCues, loadShowDoc } from "../core/index.js";
import { deck, confirmCount, applyDecision, applyDecisions, intakeOptionsFrom, pairKey, noteKey } from "../core/review.js";
import { intake } from "../core/intake/match.js";
import { deliveryItems } from "../core/intake/confirm.js";
import { numbered, matchroom } from "./fixtures-deliveries.js";
import type { ShowDoc, ConfirmItem } from "../core/types.js";

const txt = (n: string) => readFileSync(new URL(`../fixtures/text/${n}`, import.meta.url), "utf8");
const glendale = txt("2026-06-13-glendale-timing.txt"), rocha = txt("rocha-curiel-boutsheet.txt"), romero = txt("2026-08-22-romero-lopez-boutsheet.txt");
const legacy = () => loadShowDoc(JSON.parse(readFileSync(new URL("../fixtures/2026-06-13-glendale.bout.json", import.meta.url), "utf8")));
const find = (d: ShowDoc, kind: string) => deck(d).find((i) => i.kind === kind);
const answer = (d: ShowDoc, item: ConfirmItem, value: any) => {
  d.decisions = { ...(d.decisions ?? {}), [item.key]: { kind: item.kind, value, at: "2026-09-07T00:00:00Z", text: "x", was: item.options.find((o) => o.suggested)?.id } };
  return applyDecision(d, item, value);
};

describe("review helpers", () => {
  it("turns every non-state flag with no typed form into one 'Seen it' card", () => {
    const d = legacy();
    const cards = deck(d);
    expect(cards.length).toBe(confirmCount(d));
    expect(cards.every((c) => c.kind === "note")).toBe(true);                       // the legacy fixture has strings only
    expect(cards.some((c) => /placeholder/i.test(c.question))).toBe(false);          // state markers are never cards
    expect(noteKey("a")).toBe(noteKey("a")); expect(noteKey("a")).not.toBe(noteKey("b"));
  });
  it("an answered card leaves the deck, its sentence never returns as a note, and replay is idempotent", () => {
    const d = parseBoutSheet(rocha.split(/\r?\n/).slice(1).join("\n"));             // no corner header → a corners card
    const corners = find(d, "corners")!;
    expect(d.review.flags).toContain(corners.text);                                  // the sentence is still the log
    answer(d, corners, "blue");
    expect(deck(d).some((i) => i.key === corners.key)).toBe(false);
    expect(deck(d).some((i) => i.question === corners.text)).toBe(false);            // not resurrected as a note
    const once = JSON.stringify(d.data.bouts);
    applyDecisions(d); applyDecisions(d);
    expect(JSON.stringify(d.data.bouts)).toBe(once);
  });
});

describe("bout sheet questions", () => {
  it("no corner header: the card's suggested option reproduces today's parse, the other swaps every bout", () => {
    const withHeader = parseBoutSheet(rocha);
    const d = parseBoutSheet(rocha.split(/\r?\n/).slice(1).join("\n"));
    const c = find(d, "corners")!;
    expect(c.options.find((o) => o.suggested)!.id).toBe("red");
    expect(d.data.fighters[d.data.bouts[9].red].name).toBe(withHeader.data.fighters[withHeader.data.bouts[9].red].name);
    const reds = d.data.bouts.map((b: any) => b.red);
    answer(d, c, "blue");
    expect(d.data.bouts.map((b: any) => b.red)).toEqual(d.data.bouts.map((b: any, i: number) => b.red));
    expect(d.data.bouts.every((b: any, i: number) => b.red !== reds[i])).toBe(true); // every bout swapped
  });
  it("rounds undecided on the sheet raises a rounds card anchored to its bout", () => {
    const d = parseBoutSheet(romero);
    const r = find(d, "rounds")!;
    expect(r.text).toMatch(/rounds undecided/);
    expect(r.options.map((o) => o.id).sort()).toEqual(["4", "6"]);
    answer(d, r, 6);
    const b = d.data.bouts.find((x: any) => pairKey(x.red, x.blue) === r.key.slice(r.key.indexOf(":") + 1))!;
    expect(b.rounds).toBe(6);
  });
  it("'Atlanta, Georgia' offers the state and the country, and the answer sets the fighter", () => {
    const d = parseBoutSheet(rocha.replace("Santa Ana, CA", "Atlanta, Georgia"));
    const c = deck(d).find((i) => i.kind === "country" && /Atlanta/.test(i.question))!;
    expect(c.options.find((o) => o.suggested)!.id).toBe("US");
    expect(c.options.map((o) => o.id)).toContain("GE");
    answer(d, c, "GE");
    expect(d.data.fighters[c.key.slice("country:".length)].country).toBe("GE");
  });
});

describe("timing sheet questions", () => {
  const d = parseTimingSheet(glendale);
  it("raises the weight-class, main and anthem cards with today's exact sentences, and still derives 163 cues", () => {
    const wc = find(d, "weight-class")!; expect(wc.text).toMatch(/weight class .* inferred/);
    expect(wc.options.length).toBeGreaterThan(1);                                    // the neighbouring classes are offered
    expect(find(d, "main")).toBeTruthy();
    expect(find(d, "anthems")!.text).toMatch(/anthems suggested/);
    expect(deriveCues(d).length).toBe(163);
    for (const i of d.review.items ?? []) expect(d.review.flags).toContain(i.text);  // every card's sentence is still the log
  });
  it("a missing walk/intro annotation is a card, and answering it sets both orders", () => {
    const noParens = glendale.replace("(Walk, Intro 2nd)", "").replace("(Walk, Intro 1st)", "");
    const w = parseTimingSheet(noParens);
    const c = find(w, "walk-order")!;
    answer(w, c, "blue");
    expect(w.event.walkOrder).toEqual(["blue", "red"]); expect(w.event.introOrder).toEqual(["blue", "red"]);
  });
});

describe("answers survive a newer sheet", () => {
  it("a sheet that leaves the same thing open keeps the answer and does not re-ask", () => {
    const headerless = rocha.split(/\r?\n/).slice(1).join("\n");
    const base = parseBoutSheet(headerless);
    answer(base, find(base, "corners")!, "blue");
    const reds = base.data.bouts.map((b: any) => base.data.fighters[b.red].name);
    const { doc } = mergeSheets(base, parseBoutSheet(headerless));
    expect(doc.data.bouts.map((b: any) => doc.data.fighters[b.red].name)).toEqual(reds);
    expect(deck(doc).some((i) => i.kind === "corners")).toBe(false);                 // answered, so never asked again
  });
  it("a sheet that states the fact wins over the answer", () => {
    const base = parseBoutSheet(rocha.split(/\r?\n/).slice(1).join("\n"));
    answer(base, find(base, "corners")!, "blue");
    const { doc, diff } = mergeSheets(base, parseBoutSheet(rocha));                  // the real sheet HAS a RED-left header
    expect(diff.some((x) => /SWAPPED/.test(x))).toBe(true);
    expect(doc.data.fighters[doc.data.bouts[9].red].name).toBe("Alexis Rocha");
  });
});

describe("delivery questions", () => {
  it("an unresolved numbering scheme becomes a card with a real filename and both readings", () => {
    const r = intake(numbered.doc, numbered.manifest, numbered.probes, numbered.syn);
    expect(r.scheme.direction).toBe("unknown");
    const { items, flags } = deliveryItems(r, numbered.doc, {}, []);
    const n = items.find((i) => i.kind === "numbering")!;
    expect(n.options.map((o) => o.id).sort()).toEqual(["main-first", "opener-first"]);
    expect(n.options.some((o) => o.suggested)).toBe(false);                          // nothing is suggested when nothing was read
    expect(n.evidence?.files?.[0]).toBeTruthy();
    expect(flags.every((f) => f.startsWith("Delivery: "))).toBe(true);
  });
  it("answering numbering and sides replays into intake and maps the package", () => {
    const doc: ShowDoc = JSON.parse(JSON.stringify(numbered.doc));
    doc.review.items = deliveryItems(intake(doc, numbered.manifest, numbered.probes, numbered.syn), doc, {}, []).items;
    answer(doc, find(doc, "numbering")!, "opener-first");
    const withDir = intake(doc, numbered.manifest, numbered.probes, numbered.syn, intakeOptionsFrom(doc));
    doc.review.items = [...(doc.review.items ?? []).filter((i) => i.kind !== "sides"), ...deliveryItems(withDir, doc, intakeOptionsFrom(doc), []).items.filter((i) => i.kind === "sides")];
    const sides = find(doc, "sides");
    if (sides) answer(doc, sides, "red");
    const r = intake(doc, numbered.manifest, numbered.probes, numbered.syn, intakeOptionsFrom(doc));
    expect(r.assignments.length).toBeGreaterThan(280);
    expect(r.assignments.find((a) => a.slot === "B03_WALKOUT_BLUE_BARGE_1792x504")!.file).toMatch(/Walkouts\/3b\//);
  });
  it("a winner naming both fighters becomes a card, and the answer places it on that fighter's corner", () => {
    // the promoter's real deliveries have no such file; this is the shape that used to be placed on a coin flip
    const b8 = matchroom.doc.data.bouts[7]; const F = matchroom.doc.data.fighters;
    const file = "VENUE SCREENS/WINNER/HUNG_WINNER RUIZ VS KNYBA.mp4";
    const probes = [...matchroom.probes, { ...matchroom.probes.find((p) => /HUNG_/i.test(p.file))!, file }];
    const r = intake(matchroom.doc, matchroom.manifest, probes, matchroom.syn);
    expect(r.unmatched.find((u) => u.file === file)!.why).toMatch(/corner unclear/);
    const c = deliveryItems(r, matchroom.doc, {}, []).items.find((i) => i.kind === "file-side" && i.evidence?.files?.[0] === file)!;
    expect(c.question).toMatch(new RegExp(`${F[b8.red].name.split(" ").pop()}|both`, "i"));
    expect(c.options.map((o) => o.id)).toEqual(expect.arrayContaining([b8.red, b8.blue, "skip"]));
    const placed = intake(matchroom.doc, matchroom.manifest, probes, matchroom.syn, { assign: { [file]: { fighter: b8.red } } });
    const a = placed.assignments.find((x) => x.file === file)!;
    expect(a.slot).toMatch(/^B08_WINNER_RED_/);
    expect(a.reasons.some((x) => /set by you/.test(x))).toBe(true);
    // and 'leave it out' keeps it out of the show entirely
    const out = intake(matchroom.doc, matchroom.manifest, probes, matchroom.syn, { assign: { [file]: { skip: true } } });
    expect(out.ignored.some((i) => i.file === file && /left out by you/.test(i.why))).toBe(true);
    expect(out.assignments.some((x) => x.file === file)).toBe(false);
  });
  it("a hold that could be any variant asks which, and the answer fills only that slot", () => {
    const r = intake(matchroom.doc, matchroom.manifest, matchroom.probes, matchroom.syn);
    const c = deliveryItems(r, matchroom.doc, {}, []).items.find((i) => i.kind === "hold-variant")!;
    const file = c.evidence!.files![0];
    expect(c.options.map((o) => o.id)).toEqual(expect.arrayContaining(["MAIN", "SPONSOR", "skip"]));
    const placed = intake(matchroom.doc, matchroom.manifest, matchroom.probes, matchroom.syn, { assign: { [file]: { variant: "SPONSOR" } } });
    const mine = placed.assignments.filter((a) => a.file === file);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((a) => /_HOLD_SPONSOR_/.test(a.slot))).toBe(true);
  });
});
