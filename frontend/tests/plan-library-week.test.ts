import { describe, expect, test } from "bun:test";
import { clockText, compareRows, gridDays, overlayBlocks, plannedCredits, plannedSections, sectionChanges, sectionGrid, spokenClock, usesSampleSections, weekBlocks, weekStats, type PlannedSection } from "@/lib/plan-library/week";
import { getInitialPlannerState } from "@/lib/planner";
import { sampleCatalog } from "@/lib/planner-sections";
import type { ClassDay, ScheduleEvent } from "@/lib/types";

// Two sample schedules, compared by hand below. Buildings are made-up ids with
// walking times from the table, so every figure can be worked out on paper.
function meets(code: string, sectionId: string, days: ClassDay[], start: string, end: string, buildingId: string): ScheduleEvent[] {
  return days.map((day) => ({
    courseCode: code,
    title: code,
    sectionId,
    sectionLabel: sectionId,
    professor: "",
    rating: null,
    location: buildingId,
    buildingId,
    buildingName: buildingId,
    day,
    start,
    end,
    dates: null,
    provenance: "sample",
  }));
}

/** The sections a week's blocks belong to, as plannedSections reports them. */
function sectionsOf(events: ScheduleEvent[]): PlannedSection[] {
  const blocks = weekBlocks(events);
  return [...new Set(blocks.map((b) => b.code))].map((code) => {
    const own = blocks.filter((b) => b.code === code);
    return { code, sectionId: own[0].sectionId, label: events.find((event) => event.courseCode === code)!.sectionLabel, blocks: own };
  });
}

const main = [
  ...meets("CSCE 2110", "001", ["Mon", "Wed", "Fri"], "09:00", "09:50", "GAB"),
  ...meets("MATH 2700", "003", ["Mon", "Wed", "Fri"], "10:00", "10:50", "CURY"),
  ...meets("PHYS 2220", "002", ["Mon", "Wed"], "11:00", "11:50", "PHYS"),
  ...meets("CSCE 2610", "002", ["Tue", "Thu"], "12:30", "13:50", "ESSC"),
];
const fridaysOff = [
  ...meets("CSCE 2110", "002", ["Tue", "Thu"], "09:30", "10:50", "WH"),
  ...meets("MATH 2700", "001", ["Mon", "Wed"], "15:30", "16:50", "LANG"),
  ...meets("PHYS 2220", "002", ["Mon", "Wed"], "11:00", "11:50", "PHYS"),
  ...meets("CSCE 2610", "002", ["Tue", "Thu"], "12:30", "13:50", "ESSC"),
];

describe("a week's figures", () => {
  test("Main: five days, 9:00 to 1:50", () => {
    expect(weekStats(main)).toEqual({ days: 5, first: 540, last: 830 });
  });

  test("Fridays off: four days, 9:30 to 4:50", () => {
    expect(weekStats(fridaysOff)).toEqual({ days: 4, first: 570, last: 1010 });
  });

  test("an empty week has no first or last class", () => {
    expect(weekStats([])).toEqual({ days: 0, first: null, last: null });
  });
});

describe("comparing Main (A) with Fridays off (B)", () => {
  // Walking comes from weekWalking (tests/schedules-library-view-model.test.ts); these are its figures for the two weeks.
  const mainFigures = { ...weekStats(main), walkMinutes: 34, tightWalks: 2, unknownWalks: 0, credits: 12 };
  const fridaysOffFigures = { ...weekStats(fridaysOff), walkMinutes: 30, tightWalks: 0, unknownWalks: 0, credits: 12 };

  test("each row judges B against A", () => {
    expect(compareRows(mainFigures, fridaysOffFigures)).toEqual([
      { label: "Credits", a: "12", b: "12", verdict: "same" },
      { label: "Days on campus", a: "5", b: "4", verdict: "better" },
      { label: "First class", a: "9:00", b: "9:30", verdict: "better" },
      { label: "Last class ends", a: "1:50", b: "4:50", verdict: "worse" },
      { label: "Walking a week", a: "34 min", b: "30 min", verdict: "better" },
      { label: "Tight or late walks", a: "2", b: "0", verdict: "better" },
    ]);
  });

  test("a week with no timed class has no first or last class to judge", () => {
    const online = { days: 0, first: null, last: null, walkMinutes: 0, tightWalks: 0, unknownWalks: 0, credits: 12 };
    const rows = compareRows(mainFigures, online).slice(1);
    expect(rows.map((row) => row.verdict)).toEqual(["better", "same", "same", "better", "better"]);
    expect(rows[1].b).toBe("None");
  });

  test("a walk with no known time makes that side's walking a lower bound, and neither walking row is judged", () => {
    // Fridays off with one more walk to a building that isn't on the map: its 30 minutes are at least 30.
    const rows = compareRows(mainFigures, { ...fridaysOffFigures, unknownWalks: 1 });
    expect(rows.slice(4)).toEqual([
      { label: "Walking a week", a: "34 min", b: "At least 30 min", verdict: "unjudged" },
      { label: "Tight or late walks", a: "2", b: "At least 0", verdict: "unjudged" },
    ]);
  });

  test("sections that change, and the courses both share", () => {
    expect(sectionChanges(sectionsOf(main), sectionsOf(fridaysOff))).toEqual({
      changes: [
        { code: "CSCE 2110", from: "MWF 9:00", to: "TR 9:30" },
        { code: "MATH 2700", from: "MWF 10:00", to: "MW 3:30" },
      ],
      same: ["CSCE 2610", "PHYS 2220"],
    });
  });

  test("meeting text groups days by start time", () => {
    const mixed = sectionsOf([
      ...meets("MATH 1680", "001", ["Thu", "Tue"], "09:35", "10:50", "GAB"),
      ...meets("MATH 1680", "001", ["Mon"], "08:00", "08:50", "GAB"),
    ]);
    expect(sectionChanges(mixed, []).changes).toEqual([
      { code: "MATH 1680", from: "M 8:00, TR 9:35", to: null },
    ]);
  });

  test("start-time groups follow their first day, not their start time", () => {
    const mixed = sectionsOf([
      ...meets("MATH 1680", "001", ["Tue", "Thu"], "08:00", "08:50", "GAB"),
      ...meets("MATH 1680", "001", ["Mon"], "10:00", "10:50", "GAB"),
    ]);
    expect(sectionChanges(mixed, []).changes).toEqual([
      { code: "MATH 1680", from: "M 10:00, TR 8:00", to: null },
    ]);
  });

  test("different sections at identical times include their section labels", () => {
    const a = sectionsOf(meets("CSCE 2110", "001", ["Mon", "Wed", "Fri"], "09:00", "09:50", "GAB"));
    const b = sectionsOf(meets("CSCE 2110", "002", ["Mon", "Wed", "Fri"], "09:00", "09:50", "GAB"));
    expect(sectionChanges(a, b).changes).toEqual([
      { code: "CSCE 2110", from: "MWF 9:00, section 001", to: "MWF 9:00, section 002" },
    ]);
  });

  test("a course only one schedule has shows as added or dropped", () => {
    const extra = [...main, ...meets("TECM 2700", "900", ["Fri"], "13:00", "13:50", "GAB")];
    expect(sectionChanges(sectionsOf(extra), sectionsOf(main)).changes).toEqual([{ code: "TECM 2700", from: "F 1:00", to: null }]);
  });

  test("online or TBA sections include labels only when their text matches", () => {
    const online = (sectionId: string): PlannedSection => ({ code: "TECM 2700", sectionId, label: sectionId, blocks: [] });
    expect(sectionChanges([...sectionsOf(main), online("900")], [...sectionsOf(main), online("901")]).changes).toEqual([
      { code: "TECM 2700", from: "No set time, section 900", to: "No set time, section 901" },
    ]);
    expect(sectionChanges([...sectionsOf(main), online("900")], sectionsOf(main)).changes).toEqual([
      { code: "TECM 2700", from: "No set time", to: null },
    ]);
  });

  test("a saved pick the catalog can't place still counts, and two different ones differ", () => {
    const base = getInitialPlannerState();
    const plan = (sectionId: string) => ({
      ...base,
      courseStatuses: { ...base.courseStatuses, "ANTH 1010": "inProgress" as const },
      selectedSections: { "ANTH 1010": sectionId },
    });
    // Real-looking ids that the sample catalog has never had.
    const gone = (state: ReturnType<typeof plan>) => plannedSections(state, sampleCatalog);
    const a = gone(plan("vsb:spring-2027:ANTH 1010:11111"));
    const b = gone(plan("vsb:spring-2027:ANTH 1010:22222"));
    expect(a.map((s) => [s.code, s.unresolved, s.label])).toEqual([["ANTH 1010", "gone", "class 11111"]]);
    expect(sectionChanges(a, b).changes).toEqual([{ code: "ANTH 1010", from: "Not offered now, section class 11111", to: "Not offered now, section class 22222" }]);
  });

  test("meetings from the bundled samples are said once", () => {
    expect(usesSampleSections(main)).toBe(true);
    expect(usesSampleSections(main.map((event) => ({ ...event, provenance: "real" as const })))).toBe(false);
    expect(usesSampleSections([])).toBe(false);
  });

  test("planned sections come from the plan, every scheduled course with its section", () => {
    const base = getInitialPlannerState();
    const state = { ...base, courseStatuses: { ...base.courseStatuses, "ANTH 1010": "inProgress" as const }, selectedSections: { "ANTH 1010": "anth-1010-002" } };
    const sections = plannedSections(state, sampleCatalog);
    expect(sections.map((s) => [s.code, s.sectionId, s.label, s.blocks.length])).toEqual([["ANTH 1010", "anth-1010-002", "002", 3]]);
  });
});

describe("the week's blocks", () => {
  test("are keyed by course and occurrence in day order, so a section switch moves the same block", () => {
    const keys = weekBlocks(main).filter((block) => block.code === "CSCE 2110").map((block) => [block.key, block.day]);
    expect(keys).toEqual([
      ["CSCE 2110-0", "Mon"],
      ["CSCE 2110-1", "Wed"],
      ["CSCE 2110-2", "Fri"],
    ]);
    const switched = weekBlocks(fridaysOff).filter((block) => block.code === "CSCE 2110").map((block) => [block.key, block.day]);
    expect(switched).toEqual([
      ["CSCE 2110-0", "Tue"],
      ["CSCE 2110-1", "Thu"],
    ]);
  });

  test("spoken times say AM or PM, since the list has no grid to place them", () => {
    expect([spokenClock(540), spokenClock(720), spokenClock(780), spokenClock(0)]).toEqual(["9:00 AM", "12:00 PM", "1:00 PM", "12:00 AM"]);
  });

  test("clock text has no AM or PM and wraps at noon", () => {
    expect([clockText(540), clockText(720), clockText(770), clockText(1010)]).toEqual(["9:00", "12:00", "12:50", "4:50"]);
  });
});

describe("one week drawn over another", () => {
  test("alone, every block is solid and keeps its course-and-occurrence id", () => {
    const placed = overlayBlocks(weekBlocks(main), null);
    expect(placed.every((block) => block.variant === "solid")).toBe(true);
    expect(placed.map((block) => block.id)).toEqual(weekBlocks(main).map((block) => block.key));
  });

  test("meetings only the other week has are dashed, and ones only this week has fade", () => {
    const placed = overlayBlocks(weekBlocks(main), weekBlocks(fridaysOff));
    const of = (code: string, variant: string) => placed.filter((b) => b.code === code && b.variant === variant).map((b) => b.day);
    expect(of("CSCE 2110", "faded")).toEqual(["Mon", "Wed", "Fri"]);
    expect(of("CSCE 2110", "dashed")).toEqual(["Tue", "Thu"]);
    expect(of("PHYS 2220", "solid")).toEqual(["Mon", "Wed"]);
    expect(placed.filter((b) => b.variant === "dashed").every((b) => b.id.endsWith("-b"))).toBe(true);
  });

  test("a class that starts at the same time but runs longer counts as a change", () => {
    const short = meets("CSCE 2110", "001", ["Mon"], "09:00", "09:50", "GAB");
    const long = meets("CSCE 2110", "005", ["Mon"], "09:00", "10:50", "GAB");
    const placed = overlayBlocks(weekBlocks(short), weekBlocks(long));
    expect(placed.map((b) => [b.variant, b.end])).toEqual([
      ["faded", 590],
      ["dashed", 650],
    ]);
  });
});

describe("the grid's days", () => {
  test("are Monday to Friday, with Saturday and Sunday only when a class meets then", () => {
    expect(gridDays(weekBlocks(main))).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri"]);
    const sunday = weekBlocks([...main, ...meets("MUEN 1000", "001", ["Sun"], "14:00", "15:50", "MU")]);
    expect(gridDays(sunday)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sun"]);
    const both = weekBlocks([...main, ...meets("MUEN 1000", "001", ["Sat", "Sun"], "14:00", "15:50", "MU")]);
    expect(gridDays(both)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  });
});

describe("credits in the compare table", () => {
  const taking = (codes: string[]) => {
    const initial = getInitialPlannerState();
    return { ...initial, courseStatuses: { ...initial.courseStatuses, ...Object.fromEntries(codes.map((code) => [code, "inProgress" as const])) } };
  };

  test("a plan's planned credits: every course it plans, placed or not", () => {
    // Each of these is 3 credits in the bundled catalog.
    expect(plannedCredits(taking([]))).toBe(0);
    expect(plannedCredits(taking(["ANTH 1010", "ENGL 1310"]))).toBe(6);
    expect(plannedCredits(taking(["ANTH 1010", "ENGL 1310", "MATH 1710", "BIOL 1710"]))).toBe(12);
  });

  test("the first row is each plan's credits, shown and never judged", () => {
    const week = { ...weekStats(main), walkMinutes: 0, tightWalks: 0, unknownWalks: 0 };
    const [credits] = compareRows({ ...week, credits: 12 }, { ...week, credits: 15 });
    expect(credits).toEqual({ label: "Credits", a: "12", b: "15", verdict: "unjudged" });
    expect(compareRows({ ...week, credits: 9 }, { ...week, credits: 9 })[0]).toEqual({ label: "Credits", a: "9", b: "9", verdict: "same" });
  });
});

describe("sections across three plans", () => {
  test("a row per course that differs anywhere, a cell per plan; the rest are shared", () => {
    const third = [
      ...meets("CSCE 2110", "001", ["Mon", "Wed", "Fri"], "09:00", "09:50", "GAB"),
      ...meets("MATH 2700", "004", ["Tue", "Thu"], "11:00", "12:20", "CURY"),
      ...meets("PHYS 2220", "002", ["Mon", "Wed"], "11:00", "11:50", "PHYS"),
    ];
    expect(sectionGrid([sectionsOf(main), sectionsOf(fridaysOff), sectionsOf(third)])).toEqual({
      rows: [
        { code: "CSCE 2110", cells: ["MWF 9:00", "TR 9:30", "MWF 9:00"], ids: ["001", "002", "001"] },
        { code: "CSCE 2610", cells: ["TR 12:30", "TR 12:30", null], ids: ["002", "002", null] },
        { code: "MATH 2700", cells: ["MWF 10:00", "MW 3:30", "TR 11:00"], ids: ["003", "001", "004"] },
      ],
      same: ["PHYS 2220"],
    });
  });

  test("a text collision labels every section in the three-plan row", () => {
    const plan = (sectionId: string, start: string) => sectionsOf(meets("CSCE 2110", sectionId, ["Mon", "Wed", "Fri"], start, "10:50", "GAB"));
    expect(sectionGrid([plan("001", "09:00"), plan("002", "09:00"), plan("003", "10:00")])).toEqual({
      rows: [{
        code: "CSCE 2110",
        cells: ["MWF 9:00, section 001", "MWF 9:00, section 002", "MWF 10:00, section 003"],
        ids: ["001", "002", "003"],
      }],
      same: [],
    });
  });

  test("a text collision leaves an absent course's cell null", () => {
    const plan = (sectionId: string) => sectionsOf(meets("CSCE 2110", sectionId, ["Mon"], "09:00", "09:50", "GAB"));
    expect(sectionGrid([plan("001"), [], plan("002")]).rows).toEqual([
      { code: "CSCE 2110", cells: ["M 9:00, section 001", null, "M 9:00, section 002"], ids: ["001", null, "002"] },
    ]);
  });

  test("with two plans it says what sectionChanges says", () => {
    const grid = sectionGrid([sectionsOf(main), sectionsOf(fridaysOff)]);
    const { changes, same } = sectionChanges(sectionsOf(main), sectionsOf(fridaysOff));
    expect(grid.rows.map(({ code, cells: [from, to] }) => ({ code, from, to }))).toEqual(changes);
    expect(grid.same).toEqual(same);
  });
});
