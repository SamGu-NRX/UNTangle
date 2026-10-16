import { describe, expect, test } from "bun:test";
import { changedCount, hourSpan, isBusy, leanOf, ledger, paint, renameBusy, stepCredits, toggleDayOff, withHours, withLean } from "@/components/schedule-builder/limits";
import { preferenceSummary, withLunch } from "@/components/schedule-builder/preferences";
import type { SchedulePreferences } from "@/lib/types";

const defaults: SchedulePreferences = {
  constraints: {
    earliestStart: null,
    latestEnd: null,
    daysOff: [],
    blocked: [],
    maxCredits: null,
    walkingBufferMinutes: 0,
    excludedSections: [],
    openSeatsOnly: false,
    otherSites: false,
  },
  weights: { fewerDays: 2, compact: 4, mornings: 0, evenings: 0, walking: 0, rating: 0 },
};
let n = 0;
const id = () => `b${(n += 1)}`;
const blocksOf = (p: SchedulePreferences) => p.constraints.blocked.map(({ label, day, start, end }) => `${label} ${day} ${start}-${end}`).sort();

describe("painting busy times", () => {
  test("a painted rectangle becomes one block per day", () => {
    const p = paint(defaults, ["Tue", "Thu"], 900, 1020, "busy", id);
    expect(blocksOf(p)).toEqual(["Busy Thu 900-1020", "Busy Tue 900-1020"]);
    expect(isBusy(p, "Tue", 990)).toBe(true);
    expect(isBusy(p, "Tue", 1020)).toBe(false);
    expect(isBusy(p, "Wed", 900)).toBe(false);
  });

  test("painting next to a named block grows it and keeps its name", () => {
    const work = renameBusy(paint(defaults, ["Tue"], 900, 1020, "busy", id), ["b" + n], "Work");
    const grown = paint(work, ["Tue"], 1020, 1080, "busy", id);
    expect(blocksOf(grown)).toEqual(["Work Tue 900-1080"]);
  });

  test("painting beside Lunch adds a block of its own, which outlasts turning Lunch off", () => {
    const p = paint(withLunch(defaults, true), ["Tue"], 780, 900, "busy", id);
    expect(blocksOf(p).filter((block) => block.includes("Tue"))).toEqual(["Busy Tue 780-900", "Lunch Tue 720-780"]);
    expect(preferenceSummary(p, defaults)).toContain("busy Tue 1:00–3:00");
    expect(blocksOf(withLunch(p, false))).toEqual(["Busy Tue 780-900"]);
  });

  test("time painted between two named blocks joins one of them, never both", () => {
    const work = renameBusy(paint(defaults, ["Mon"], 600, 660, "busy", id), ["b" + n], "Work");
    const both = renameBusy(paint(work, ["Mon"], 720, 780, "busy", id), ["b" + n], "Practice");
    expect(blocksOf(paint(both, ["Mon"], 660, 720, "busy", id))).toEqual(["Practice Mon 720-780", "Work Mon 600-720"]);
  });

  test("freeing the middle of a block splits it in two, both keeping the name", () => {
    const work = renameBusy(paint(defaults, ["Mon"], 600, 840, "busy", id), ["b" + n], "Work");
    const split = paint(work, ["Mon"], 690, 750, "free", id);
    expect(blocksOf(split)).toEqual(["Work Mon 600-690", "Work Mon 750-840"]);
    expect(new Set(split.constraints.blocked.map((b) => b.id)).size).toBe(2);
  });

  test("freeing time that holds nothing changes nothing", () => {
    const p = paint(defaults, ["Mon"], 600, 660, "busy", id);
    expect(paint(p, ["Fri"], 600, 660, "free", id)).toEqual(p);
  });
});

describe("the ledger", () => {
  test("one fact per row, grouped by name and hours across days", () => {
    let p = withHours(defaults, "start", 540);
    p = toggleDayOff(p, "Fri");
    p = paint(p, ["Tue", "Thu"], 900, 1020, "busy", id);
    p = renameBusy(p, p.constraints.blocked.map((b) => b.id), "Work");
    const rows = ledger(p);
    expect(rows.map((r) => r.title)).toEqual(["No class before 9 AM", "Fridays off", "Work"]);
    expect(rows[2]).toMatchObject({ kind: "busy", detail: "Tue and Thu, 3–5 PM", unnamed: false });
    expect(rows[2].kind === "busy" && rows[2].ids.length).toBe(2);
  });

  test("hours across noon name both halves", () => {
    expect(hourSpan(660, 780)).toBe("11 AM–1 PM");
    expect(hourSpan(900, 1020)).toBe("3–5 PM");
    expect(hourSpan(540, 630)).toBe("9–10:30 AM");
  });
});

describe("class hours from the knobs", () => {
  test("the grid's edges mean no limit", () => {
    expect(withHours(defaults, "start", 470).constraints.earliestStart).toBeNull();
    expect(withHours(defaults, "end", 1330).constraints.latestEnd).toBeNull();
  });
  test("snaps to the half hour and keeps an hour open between the two", () => {
    const p = withHours(defaults, "start", 547);
    expect(p.constraints.earliestStart).toBe(540);
    expect(withHours(p, "end", 560).constraints.latestEnd).toBe(600);
  });
});

describe("leanings map to the optimizer's weights", () => {
  test("time of day is one control over mornings and evenings", () => {
    expect(withLean(defaults, "time", -2).weights).toMatchObject({ mornings: 4, evenings: 0 });
    expect(withLean(defaults, "time", -1).weights).toMatchObject({ mornings: 2, evenings: 0 });
    expect(withLean(defaults, "time", 0).weights).toMatchObject({ mornings: 0, evenings: 0 });
    expect(withLean(defaults, "time", 2).weights).toMatchObject({ mornings: 0, evenings: 4 });
    for (const v of [-2, -1, 0, 1, 2]) expect(leanOf(withLean(defaults, "time", v).weights, "time")).toBe(v);
  });
  test("an older preference with both time weights reads as the stronger one", () => {
    expect(leanOf({ ...defaults.weights, mornings: 4, evenings: 1 }, "time")).toBe(-2);
    expect(leanOf({ ...defaults.weights, mornings: 1, evenings: 1 }, "time")).toBe(0);
  });
  test("the others set their own weight 0 to 4 and touch nothing else", () => {
    const p = withLean(defaults, "walking", 3);
    expect(p.weights).toEqual({ ...defaults.weights, walking: 3 });
    expect(withLean(defaults, "rating", 9).weights.rating).toBe(4);
    expect(withLean(defaults, "fewerDays", -1).weights.fewerDays).toBe(0);
  });
});

describe("credit limit", () => {
  test("steps 3 to 21, and past 21 is no limit", () => {
    expect(stepCredits(null, -1)).toBe(21);
    expect(stepCredits(21, 1)).toBeNull();
    expect(stepCredits(null, 1)).toBeNull();
    expect(stepCredits(3, -1)).toBe(3);
    expect(stepCredits(15, 1)).toBe(16);
  });
});

describe("the Preferences button's count", () => {
  test("counts each changed choice once", () => {
    expect(changedCount(defaults, defaults)).toBe(0);
    let p = withHours(defaults, "start", 540);
    p = paint(p, ["Tue", "Thu"], 900, 1020, "busy", id);
    p = withLean(p, "walking", 3);
    p = { ...p, constraints: { ...p.constraints, maxCredits: 15, openSeatsOnly: true } };
    expect(changedCount(p, defaults)).toBe(5);
  });
});

describe("a busy time made from one calendar event", () => {
  const demo = { id: "event-2027-03-02-660-750", label: "Robot demo day", day: "Tue" as const, start: 660, end: 750, dates: [{ start: "2027-03-02", end: "2027-03-02" }] };
  const withDemo: SchedulePreferences = { ...defaults, constraints: { ...defaults.constraints, blocked: [demo] } };

  test("isn't weekly, so the painted week neither shows it nor merges a painted block into it", () => {
    expect(isBusy(withDemo, "Tue", 690)).toBe(false);
    const painted = paint(withDemo, ["Tue"], 600, 720, "busy", id);
    expect(painted.constraints.blocked).toContainEqual(demo);
    expect(painted.constraints.blocked.filter((b) => !b.dates)).toHaveLength(1);
    const freed = paint(withDemo, ["Tue"], 600, 780, "free", id);
    expect(freed.constraints.blocked).toEqual([demo]);
  });

  test("has its own ledger row, said by its date", () => {
    expect(ledger(withDemo)).toEqual([
      { kind: "busy", title: "Robot demo day", detail: "Mar 2, 11 AM–12:30 PM", label: "Robot demo day", ids: [demo.id], unnamed: false, dated: true },
    ]);
  });

  test("a connected calendar counts once on the Preferences button", () => {
    const calendar = { id: "cal-work", name: "Work", sealedUrl: "cf1.a.b.c", feedId: "WorkFeedIdAAAAAAAAAAAA", termId: "spring-2027", checkedAt: "2026-10-15T12:00:00.000Z", busy: [], allDayDates: [], countAllDay: false };
    expect(changedCount({ ...defaults, calendars: [calendar] }, defaults)).toBe(1);
  });
});
