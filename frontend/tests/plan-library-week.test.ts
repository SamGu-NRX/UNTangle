import { describe, expect, test } from "bun:test";
import { clockText, compareRows, gridDays, overlayBlocks, plannedSections, sectionChanges, spokenClock, usesSampleSections, weekBlocks, weekStats, type PlannedSection } from "@/lib/plan-library/week";
import { getInitialPlannerState } from "@/lib/planner";
import { sampleCatalog } from "@/lib/planner-sections";
import type { WalkingTime } from "@/lib/planner-walking";
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

const WALK_SECONDS: Record<string, number> = {
  "GAB>CURY": 360, // 6 min
  "CURY>PHYS": 450, // 7.5, rounds up to 8 min
  "PHYS>LANG": 300, // 5 min
  "WH>ESSC": 600, // 10 min
};
const travel = (from: string, to: string): WalkingTime => {
  if (from === "GAB" && to === "NTDP") return { seconds: 1200, source: "straight-line" };
  const seconds = WALK_SECONDS[`${from}>${to}`];
  return seconds === undefined ? { seconds: null, source: "unknown" } : { seconds, source: "campus-network" };
};

/** The sections a week's blocks belong to, as plannedSections reports them. */
function sectionsOf(events: ScheduleEvent[]): PlannedSection[] {
  const blocks = weekBlocks(events);
  return [...new Set(blocks.map((b) => b.code))].map((code) => {
    const own = blocks.filter((b) => b.code === code);
    return { code, sectionId: own[0].sectionId, blocks: own };
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
  test("Main: five days, 9:00 to 1:50, 34 minutes walking, two tight walks", () => {
    // Mon and Wed: GAB to CURY 6 (10 min break) + CURY to PHYS 8 (10 min break, 8 >= 10 - 2: tight); Fri: 6.
    expect(weekStats(main, travel)).toEqual({ days: 5, first: 540, last: 830, walkMinutes: 34, tightWalks: 2 });
  });

  test("Fridays off: four days, 9:30 to 4:50, 30 minutes walking, no tight walk", () => {
    // Mon and Wed: PHYS to LANG 5 (220 min break); Tue and Thu: WH to ESSC 10 (100 min break).
    expect(weekStats(fridaysOff, travel)).toEqual({ days: 4, first: 570, last: 1010, walkMinutes: 30, tightWalks: 0 });
  });

  test("a walk with no known time makes the walking figures unknown, not shorter", () => {
    const unknownWalk = [...meets("A 1", "1", ["Mon"], "09:00", "09:50", "GAB"), ...meets("B 1", "1", ["Mon"], "10:00", "10:50", "NOWHERE")];
    expect(weekStats(unknownWalk, travel)).toMatchObject({ walkMinutes: null, tightWalks: null, days: 1 });
  });

  test("a shuttle ride to Discovery Park is not walking, though it can still be tight", () => {
    // NTDP is Discovery Park: the trip is a 20-minute shuttle (planner-walking.ts), not on foot.
    const shuttle = [...meets("A 1", "1", ["Mon"], "09:00", "09:50", "GAB"), ...meets("B 1", "1", ["Mon"], "10:00", "10:50", "NTDP")];
    expect(weekStats(shuttle, travel)).toMatchObject({ walkMinutes: 0, tightWalks: 1 });
  });

  test("an empty week has no first or last class", () => {
    expect(weekStats([], travel)).toEqual({ days: 0, first: null, last: null, walkMinutes: 0, tightWalks: 0 });
  });
});

describe("comparing Main (A) with Fridays off (B)", () => {
  test("each row judges B against A", () => {
    expect(compareRows(weekStats(main, travel), weekStats(fridaysOff, travel))).toEqual([
      { label: "Days on campus", a: "5", b: "4", verdict: "better" },
      { label: "First class", a: "9:00", b: "9:30", verdict: "better" },
      { label: "Last class ends", a: "1:50", b: "4:50", verdict: "worse" },
      { label: "Walking a week", a: "34 min", b: "30 min", verdict: "better" },
      { label: "Tight walks", a: "2", b: "0", verdict: "better" },
    ]);
  });

  test("an unknown side judges nothing", () => {
    const unknown = { days: 3, first: null, last: null, walkMinutes: null, tightWalks: null };
    const rows = compareRows(weekStats(main, travel), unknown);
    expect(rows.map((row) => row.verdict)).toEqual(["better", "same", "same", "same", "same"]);
    expect(rows[1].b).toBe("None");
    expect(rows[3].b).toBe("Unknown");
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

  test("a course only one schedule has shows as added or dropped", () => {
    const extra = [...main, ...meets("TECM 2700", "900", ["Fri"], "13:00", "13:50", "GAB")];
    expect(sectionChanges(sectionsOf(extra), sectionsOf(main)).changes).toEqual([{ code: "TECM 2700", from: "F 1:00", to: null }]);
  });

  test("an online or TBA section that changes still shows, as No set time", () => {
    const online = (sectionId: string): PlannedSection => ({ code: "TECM 2700", sectionId, blocks: [] });
    expect(sectionChanges([...sectionsOf(main), online("900")], [...sectionsOf(main), online("901")]).changes).toEqual([
      { code: "TECM 2700", from: "No set time", to: "No set time" },
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
    const a = gone(plan("2027-spring:ANTH 1010:11111"));
    const b = gone(plan("2027-spring:ANTH 1010:22222"));
    expect(a.map((s) => [s.code, s.unresolved])).toEqual([["ANTH 1010", "gone"]]);
    expect(sectionChanges(a, b).changes).toEqual([{ code: "ANTH 1010", from: "Not offered now", to: "Not offered now" }]);
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
    expect(sections.map((s) => [s.code, s.sectionId, s.blocks.length])).toEqual([["ANTH 1010", "anth-1010-002", 3]]);
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
