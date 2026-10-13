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
  hiddenOptions,
  myUntClassNumbers,
  normalizePlannerState,
  parseSchedulePreferences,
  resolveSectionPlan,
  routeStopsOf,
  toOptimizerCourses,
} from "@/lib/planner";
import {
  hasOpenSeats,
  isCandidate,
  meetingsConflict,
  otherSiteOf,
  optionsConflict,
  scheduleEventsOf,
  sectionRef,
  toOptSection,
  untimedMeetings,
} from "@/lib/planner-sections";
import { buildItinerary, placeStop, routeRuns } from "@/lib/map-itinerary";
import { planLookups, createMapDataCache } from "@/lib/map-client-data";
import { isShuttleLeg, plannerTravelTime, SHUTTLE_SECONDS, summarizeWeeklyWalking } from "@/lib/planner-walking";
import type { PlannerState } from "@/lib/types";
import { courseAs, fixtureCatalog, fixtureInput, optionsOf, renumber, setDates } from "../sections/real-term";

const FIRST_HALF = "01/11/2027 - 03/05/2027";
const SECOND_HALF = "03/15/2027 - 05/07/2027";

function plan_(codes: string[], selectedSections: Record<string, string> = {}): PlannerState {
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
    const state = plan_(["SPAN 2040", "MATH 1680"]);
    expect(toOptimizerCourses(["SPAN 2040"], catalog)).toEqual([]);
    const course = resolveSectionPlan(state, catalog).courses.find((entry) => entry.code === "SPAN 2040")!;
    expect(course.state).toBe("recommended");
    expect(course.section?.async).toBe(true);
    // Picked, it stays as picked when the week is optimized.
    const picked = plan_(["SPAN 2040", "MATH 1680"], { "SPAN 2040": course.section!.id });
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
    const state = plan_(["SPAN 2040", "SPAN 2050"]);
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
    const events = buildScheduleEvents(resolveSectionPlan(plan_(["SPAN 2040", "SPAN 2050"]), catalog));
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
    const state = plan_(["MATH 1680", "SPAN 2040", "MATH 1710"]);
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
      buildingId: null,
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

describe("which options the optimizer suggests", () => {
  const filter = (over: Partial<{ openSeatsOnly: boolean; otherSites: boolean }> = {}) => ({ openSeatsOnly: false, otherSites: false, ...over });

  /** MATH 1680 on main campus, plus SPAN 2040 with one Frisco option (DBAS 6003's row) and one at Discovery Park. */
  function sites() {
    const input = fixtureInput();
    courseAs(input, "MATH 1680", "SPAN 2040", (row) => {
      row.linked_sections[0].room = "NTDP F223";
      row.meetings.filter((m) => m.class_number === "6862").forEach((m) => (m.room = "NTDP F223"));
    });
    const frisco = structuredClone(input.courses["DBAS 6003"].sections[0]);
    (input.courses as Record<string, { sections: unknown[] }>)["SPAN 2040"].sections.push(frisco);
    return fixtureCatalog(input);
  }

  test("sections outside Denton are not suggested by default, are counted, and come back on request", () => {
    const catalog = sites();
    const [park, frisco] = optionsOf(catalog, "SPAN 2040");
    // Discovery Park counts as Denton: most CSCE and engineering classes meet there.
    expect([otherSiteOf(park), otherSiteOf(frisco), otherSiteOf(optionsOf(catalog, "MATH 1680")[0])]).toEqual([null, "Frisco", null]);
    // Online and unassigned rooms do not move an option off campus.
    expect(otherSiteOf(optionsOf(catalog, "ACCT 5120")[0])).toBeNull();
    expect(otherSiteOf(optionsOf(catalog, "ART 5450")[0])).toBeNull();

    expect(toOptimizerCourses(["SPAN 2040"], catalog)[0].sections.map((section) => section.id)).toEqual([park.id]);
    expect(toOptimizerCourses(["SPAN 2040"], catalog, filter({ otherSites: true }))[0].sections).toHaveLength(2);

    const plan = resolveSectionPlan(plan_(["SPAN 2040"]), catalog);
    expect(plan.courses[0]).toMatchObject({ state: "recommended", section: { id: park.id } });
    expect(hiddenOptions(plan, filter())).toEqual({ sites: new Map([["Frisco", 1]]), full: 0 });
    // A pick made by hand at another site stays: Optimize leaves the course alone.
    const picked = plan_(["SPAN 2040", "MATH 1680"], { "SPAN 2040": frisco.id });
    expect(buildOptimizeRequest(picked, defaultSchedulePreferences("compact"), { catalog }).courses.map((c) => c.code)).toEqual(["MATH 1680"]);
  });

  test("Open seats only leaves out closed, wait-listed and full-component options", () => {
    const catalog = fixtureCatalog();
    const closed = optionsOf(catalog, "ADES 5510")[0];
    const waitlist = optionsOf(catalog, "ART 5450")[0];
    const [math] = optionsOf(catalog, "MATH 1680");
    const fullLab = { ...math, components: [math.components[0], { ...math.components[1], seats: { open: 0, total: 33 } }] };
    expect([closed, waitlist, math, fullLab].map(hasOpenSeats)).toEqual([false, false, true, false]);
    expect(isCandidate(closed, filter())).toBe(true);
    expect(isCandidate(closed, filter({ openSeatsOnly: true }))).toBe(false);
  });

  test("stored preferences from before these switches load with both off", () => {
    const stored = defaultSchedulePreferences("compact");
    const older: Record<string, unknown> = { ...stored.constraints };
    delete older.openSeatsOnly;
    delete older.otherSites;
    expect(parseSchedulePreferences({ ...stored, constraints: older })?.constraints).toMatchObject({ openSeatsOnly: false, otherSites: false });
    expect(parseSchedulePreferences({ ...stored, constraints: { ...older, otherSites: "yes" } })).toBeNull();
  });
});

describe("weekend days on the map", () => {
  test("Saturday classes get map stops, and a Saturday map day is a valid plan state", () => {
    const [weekend] = optionsOf(fixtureCatalog(), "DBAS 6003");
    const stops = routeStopsOf(scheduleEventsOf(weekend));
    expect(stops.Sat.length).toBeGreaterThan(0);
    expect(stops.Mon).toEqual([]);
    expect(normalizePlannerState({ ...getInitialPlannerState(), activeDay: "Sat" }).activeDay).toBe("Sat");
    expect(normalizePlannerState({ ...getInitialPlannerState(), activeDay: "Caturday" as never }).activeDay).toBe("Mon");
  });
});

describe("date labels on the week", () => {
  test("only classes off the most common range show dates; with no most common range, all do", async () => {
    const { usualRange } = await import("@/components/schedule/week-model");
    const at = (start: string, end: string) => ({ courseCode: "X", sectionId: "x", day: "Tue" as const, start: 0, end: 1, room: "", buildingId: null, professor: "", dates: { start, end, raw: "" } });
    const full = at("2027-01-11", "2027-05-07");
    const first = at("2027-01-11", "2027-03-05");
    const second = at("2027-03-15", "2027-05-07");
    expect(usualRange([full, full, first])).toBe("Jan 11 – May 7");
    expect(usualRange([first, second])).toBeNull();
  });
});

describe("the Discovery Park shuttle", () => {
  test("main campus to Discovery Park is a 20-minute shuttle leg, not a walk", () => {
    expect(SHUTTLE_SECONDS).toBe(1200);
    expect([isShuttleLeg("gab", "ntdp"), isShuttleLeg("ntdp", "lang"), isShuttleLeg("ntdp", "ntdp"), isShuttleLeg("gab", "lang"), isShuttleLeg(null, "ntdp")]).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
    expect(plannerTravelTime("gab", "ntdp")).toEqual({ seconds: 1200, source: "straight-line" });
    expect(plannerTravelTime("gab", "lang")).toEqual(getWalkingSeconds("gab", "lang"));
  });

  test("back to back across the shuttle is late on the map, not routed, and kept off walking totals", () => {
    const stop = (buildingId: string, start: string, end: string) => ({
      courseCode: `C ${start}`,
      title: "",
      location: buildingId,
      buildingId,
      buildingName: buildingId,
      shortName: buildingId,
      lat: 33.2,
      lng: -97.1,
      resolutionStatus: "local" as const,
      geocodeQuery: "",
      day: "Mon" as const,
      start,
      end,
      dates: null,
    });
    const itinerary = buildItinerary([stop("gab", "09:00", "09:50"), stop("ntdp", "10:00", "10:50")], new Map(), new Map());
    expect(itinerary.legs[0]).toMatchObject({ route: { kind: "shuttle", seconds: 1200 }, walkMinutes: 20, transfer: "late", leaveBy: "09:40" });
    expect(itinerary.summary).toMatchObject({ walkMinutes: 0, shuttleLegs: 1, loading: false });
    expect(routeRuns(itinerary.stops)).toEqual([]);
  });

  test("the optimizer treats a shuttle leg like a 20-minute walk: a 10-minute break does not fit", () => {
    const input = fixtureInput();
    // MATH 1680's lecture at Discovery Park, so Monday 8:00 (GAB) -> lecture would need the shuttle.
    courseAs(input, "MATH 1680", "SPAN 2040", (row) => {
      row.linked_sections[0].room = "NTDP F223";
      row.meetings.filter((m) => m.class_number === "6862").forEach((m) => {
        m.room = "NTDP F223";
        m.days = "M";
        m.start_time = "9:00AM";
        m.end_time = "9:50AM";
      });
    });
    const catalog = fixtureCatalog(input);
    const request = buildOptimizeRequest(plan_(["SPAN 2040"]), defaultSchedulePreferences("compact"), { catalog });
    // The option's own Monday GAB 8:00-8:50 recitation then NTDP 9:00: a 10-minute break for a 20-minute shuttle.
    expect(optimize(request).status).toBe("infeasible");
    const relaxed = { ...request, constraints: { ...request.constraints, walking: null } };
    expect(optimize(relaxed).schedules[0].breakdown.walkSeconds).toBe(1200);
  });
});
