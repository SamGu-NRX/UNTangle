/**
 * The planner on real Spring 2027 options (lib/planner-sections.ts and
 * resolveSectionPlan): the optimizer adapter, eight-week sessions, meetings
 * with no set time, weekends, rooms with no catalogue building, the
 * class-number export and the calendar's real dates. All data comes from the
 * committed vsb fixture; nothing is fetched.
 */
import { describe, expect, test } from "bun:test";
import { getWalkingSeconds } from "@/lib/campus/walking-times";
import { optimize } from "@/lib/optimizer/optimize";
import { GOAL_WEIGHTS, NO_CONSTRAINTS } from "@/lib/optimizer/presets";
import { buildPlanIcs, needsTermDates } from "@/lib/planner-ics";
import {
  buildOptimizeRequest,
  buildScheduleEvents,
  buildStopsForDay,
  defaultSchedulePreferences,
  getInitialPlannerState,
  myUntClassNumbers,
  normalizePlannerState,
  resolveSectionPlan,
  toOptimizerCourses,
} from "@/lib/planner";
import {
  meetingsConflict,
  optionsConflict,
  scheduleEventsOf,
  sectionRef,
  toOptSection,
  untimedMeetings,
} from "@/lib/planner-sections";
import { placeStop } from "@/lib/map-itinerary";
import { planLookups, createMapDataCache } from "@/lib/map-client-data";
import { summarizeWeeklyWalking } from "@/lib/planner-walking";
import type { PlannerState } from "@/lib/types";
import { courseAs, fixtureCatalog, fixtureInput, optionsOf, renumber, setDates } from "../sections/real-term";

const FIRST_HALF = "01/11/2027 - 03/05/2027";
const SECOND_HALF = "03/15/2027 - 05/07/2027";

function plan(codes: string[], selectedSections: Record<string, string> = {}): PlannerState {
  const base = getInitialPlannerState();
  return normalizePlannerState({
    ...base,
    courseStatuses: { ...base.courseStatuses, ...Object.fromEntries(codes.map((code) => [code, "inProgress" as const])) },
    selectedSections,
  });
}

/** MATH 1680's linked option re-filed as SPAN 2040 (first half) and SPAN 2050 (second half), same slot. */
function eightWeekPair() {
  const input = fixtureInput();
  courseAs(input, "MATH 1680", "SPAN 2040", (row) => setDates(row, FIRST_HALF));
  courseAs(input, "MATH 1680", "SPAN 2050", (row) => {
    setDates(row, SECOND_HALF);
    renumber(row, ["6004", "6005"]);
  });
  return fixtureCatalog(input);
}

describe("the optimizer adapter", () => {
  test("an option's linked components become one section with every component's meetings, once", () => {
    const [option] = optionsOf(fixtureCatalog(), "MATH 1680");
    const section = toOptSection(option)!;
    expect(section.id).toBe("vsb:spring-2027:MATH 1680:6862+6863");
    expect(section.label).toBe("110 + 111");
    expect(section.rating).toBeNull();
    expect(section.meetings).toEqual([
      { day: "Tue", start: 575, end: 655, buildingId: "cury", dates: { start: "2027-01-11", end: "2027-05-07" } },
      { day: "Thu", start: 575, end: 655, buildingId: "cury", dates: { start: "2027-01-11", end: "2027-05-07" } },
      { day: "Mon", start: 480, end: 530, buildingId: "gab", dates: { start: "2027-01-11", end: "2027-05-07" } },
    ]);
  });

  test("first and second eight-week sessions in one slot never conflict; full term and a half do", () => {
    const catalog = eightWeekPair();
    const [first] = optionsOf(catalog, "SPAN 2040");
    const [second] = optionsOf(catalog, "SPAN 2050");
    const [fullTerm] = optionsOf(catalog, "MATH 1680");
    expect(meetingsConflict(first.meetings[0], second.meetings[0])).toBe(false);
    expect(optionsConflict(first, second)).toBe(false);
    expect(optionsConflict(fullTerm, first)).toBe(true);
    expect(optionsConflict(fullTerm, second)).toBe(true);

    // The optimizer schedules both halves together, with the walking check on.
    const result = optimize({
      courses: toOptimizerCourses(["SPAN 2040", "SPAN 2050"], catalog),
      locks: {},
      excluded: [],
      constraints: { ...NO_CONSTRAINTS, walking: { bufferMinutes: 0 } },
      weights: GOAL_WEIGHTS.compact,
      walkingTime: () => ({ seconds: null, source: "unknown" }),
      k: 1,
    });
    expect(result.status).toBe("optimal");
    expect(result.schedules[0].byCourse).toEqual({ "SPAN 2040": first.id, "SPAN 2050": second.id });
  });

  test("TBA and async meetings stay off the grid and out of the optimizer", () => {
    const catalog = fixtureCatalog();
    const [async] = optionsOf(catalog, "ACCT 5120");
    expect(async.async).toBe(true);
    expect(toOptSection(async)).toBeNull();
    expect(scheduleEventsOf(async)).toEqual([]);
    expect(untimedMeetings(async)).toHaveLength(1);

    // BCIS 4740 has a Thursday with no time and a timed Thursday; only the timed one is placed.
    const [mixed] = optionsOf(catalog, "BCIS 4740");
    expect(mixed.meetings.map((m) => m.tba)).toEqual([true, false]);
    expect(toOptSection(mixed)!.meetings).toHaveLength(1);
    expect(untimedMeetings(mixed)).toHaveLength(1);
    // A TBA meeting never conflicts, even with itself.
    expect(meetingsConflict(mixed.meetings[0], mixed.meetings[0])).toBe(false);
  });

  test("a course whose only option has no set time is shown as that option, not sent to the optimizer", () => {
    const input = fixtureInput();
    courseAs(input, "ACCT 5120", "SPAN 2040");
    const catalog = fixtureCatalog(input);
    const state = plan(["SPAN 2040", "MATH 1680"]);
    expect(toOptimizerCourses(["SPAN 2040"], catalog)).toEqual([]);
    const course = resolveSectionPlan(state, catalog).courses.find((entry) => entry.code === "SPAN 2040")!;
    expect(course.state).toBe("recommended");
    expect(course.section?.async).toBe(true);
    // Picked, it stays as picked when the week is optimized.
    const picked = plan(["SPAN 2040", "MATH 1680"], { "SPAN 2040": course.section!.id });
    const request = buildOptimizeRequest(picked, defaultSchedulePreferences("compact"), { catalog });
    expect(request.courses.map((entry) => entry.code)).toEqual(["MATH 1680"]);
  });

  test("Saturday and Sunday meetings reach the optimizer, the week and the calendar", () => {
    const [weekend] = optionsOf(fixtureCatalog(), "DBAS 6003");
    expect(new Set(toOptSection(weekend)!.meetings.map((m) => m.day))).toEqual(new Set(["Sat", "Sun"]));
    const events = scheduleEventsOf(weekend);
    expect(new Set(events.map((event) => event.day))).toEqual(new Set(["Sat", "Sun"]));
    const ics = buildPlanIcs(events, null, new Date("2026-10-13T00:00:00Z")).ics;
    expect(ics).toContain("RRULE:FREQ=WEEKLY;BYDAY=SA;UNTIL=20270507T235959");
    expect(ics).toContain("RRULE:FREQ=WEEKLY;BYDAY=SU;UNTIL=20270507T235959");
    // The term starts Monday 2027-01-11, so the first Saturday is the 16th.
    expect(ics).toContain("DTSTART:20270116T113000");
  });

  test("a room with no catalogue building keeps its text, has no building id, and is never looked up", () => {
    const input = fixtureInput();
    courseAs(input, "MATH 1680", "MATH 1680", (row) => {
      row.linked_sections[1].room = "MGV P124";
      row.meetings[1].room = "MGV P124";
    });
    const [option] = optionsOf(fixtureCatalog(input), "MATH 1680");
    expect(toOptSection(option)!.meetings.map((m) => m.buildingId)).toEqual(["cury", "cury", null]);

    const monday = buildStopsForDay(scheduleEventsOf(option), "Mon");
    expect(monday).toHaveLength(1);
    expect(monday[0]).toMatchObject({ location: "MGV P124", buildingName: "Unknown building", unmappedRoom: true });
    expect(monday[0].buildingId).toBeUndefined();
    expect(monday[0].lat).toBeUndefined();
    expect(placeStop(monday[0], undefined)).toMatchObject({ kind: "unresolved", reason: "unknown" });
    expect(planLookups(monday, createMapDataCache(), 0)).toEqual([]);
  });

  test("an unknown building is an unknown walk, never zero", () => {
    const [weekend] = optionsOf(fixtureCatalog(), "DBAS 6003");
    // FRLD (Frisco Landing) is not in the campus catalogue.
    expect(weekend.meetings.every((m) => m.buildingId === null)).toBe(true);
    const events = scheduleEventsOf(weekend).filter((event) => event.day === "Sat");
    const twoClasses = [events[0], { ...events[0], start: "15:00", end: "16:00" }];
    // Two classes in the same unmapped building are still an unknown walk: null is not "the same building".
    const summary = summarizeWeeklyWalking(twoClasses, getWalkingSeconds);
    expect(summary).toMatchObject({ knownSeconds: 0, knownLegs: 0, unknownLegs: 1 });
  });
});

describe("the eight-week pair on the week and the map", () => {
  test("walking and map legs skip classes that meet in different weeks", () => {
    const catalog = eightWeekPair();
    const state = plan(["SPAN 2040", "SPAN 2050"]);
    const events = buildScheduleEvents(resolveSectionPlan(state, catalog));
    const tuesday = buildStopsForDay(events, "Tue");
    expect(tuesday.map((stop) => [stop.courseCode, stop.dates?.start])).toEqual([
      ["SPAN 2040", "2027-01-11"],
      ["SPAN 2050", "2027-03-15"],
    ]);
    const walking = summarizeWeeklyWalking(events, () => ({ seconds: 300, source: "campus-network" }));
    // The Monday recitations of both halves are at the same hour in different weeks: no walks at all.
    expect(walking.knownLegs).toBe(0);
  });

  test("the calendar file runs each half over its own dates, with no typed term", () => {
    const catalog = eightWeekPair();
    const events = buildScheduleEvents(resolveSectionPlan(plan(["SPAN 2040", "SPAN 2050"]), catalog));
    expect(needsTermDates(events)).toBe(false);
    const ics = buildPlanIcs(events, null, new Date("2026-10-13T00:00:00Z")).ics;
    expect(ics).toContain("DTSTART:20270112T093500"); // first Tuesday of the first half
    expect(ics).toContain("UNTIL=20270305T235959");
    expect(ics).toContain("DTSTART:20270316T093500"); // first Tuesday of the second half
    expect(ics).toContain("UNTIL=20270507T235959");
    expect(ics).not.toContain("sample");
  });
});

describe("Copy class numbers for myUNT", () => {
  test("lists every component's class number for real options and names courses without one", () => {
    const input = fixtureInput();
    courseAs(input, "ACCT 5120", "SPAN 2040");
    const catalog = fixtureCatalog(input);
    // MATH 1680 and SPAN 2040 are real; MATH 1710 is not in the file, so it falls back to samples.
    const state = plan(["MATH 1680", "SPAN 2040", "MATH 1710"]);
    const list = myUntClassNumbers(resolveSectionPlan(state, catalog));
    expect(list.text.split("\n")).toEqual(["MATH 1680 §110 + 111: 6862, 6863", "SPAN 2040 §400: 1002"]);
    expect(list.count).toBe(3);
    expect(list.missing).toEqual(["MATH 1710"]);
  });

  test("a saved real pick is named by its id: term, provenance and class numbers", () => {
    expect(sectionRef("vsb:spring-2027:MATH 1680:6862+6863")).toEqual({
      provenance: "real",
      optionId: "vsb:spring-2027:MATH 1680:6862+6863",
      term: "spring-2027",
      courseCode: "MATH 1680",
      classNumbers: ["6862", "6863"],
    });
    expect(sectionRef("math-1710-002")).toEqual({ provenance: "sample", optionId: "math-1710-002" });
  });
});

describe("week lanes", () => {
  test("classes chained by slots in different weeks share one column count and never overlap", async () => {
    const { laneLayout } = await import("@/components/schedule/week-model");
    const event = (start: number, end: number, from: string, to: string) => ({
      courseCode: `C${start}`,
      sectionId: `s${start}`,
      day: "Tue" as const,
      start,
      end,
      room: "",
      professor: "",
      dates: { start: from, end: to, raw: "" },
    });
    // A and B overlap in time but not in weeks; B and C too; A and C never overlap in time.
    const a = event(540, 600, "2027-01-11", "2027-03-05");
    const b = event(570, 660, "2027-03-15", "2027-05-07");
    const c = event(630, 690, "2027-01-11", "2027-03-05");
    const layout = laneLayout([a, b, c]);
    const counts = new Set([a, b, c].map((e) => layout.get(e)!.lanes));
    expect(counts.size).toBe(1);
    expect(layout.get(a)!.lane).not.toBe(layout.get(b)!.lane);
    expect(layout.get(b)!.lane).not.toBe(layout.get(c)!.lane);
    // A real conflict (same weeks) is not split into lanes: it stays flagged on top of each other.
    const clash = event(540, 600, "2027-01-11", "2027-05-07");
    expect(laneLayout([a, clash]).get(clash)).toEqual({ lane: 0, lanes: 1 });
  });
});
