/**
 * The planner on real Spring 2027 options (lib/planner-sections.ts and
 * resolveSectionPlan): the optimizer adapter, eight-week sessions, meetings
 * with no set time, weekends, rooms with no catalogue building, the
 * class-number export and the calendar's real dates. All data comes from the
 * committed vsb fixture; nothing is fetched.
 */
import { describe, expect, test } from "bun:test";
import { getWalkingSeconds } from "@/lib/campus/walking-times";
import { canApply, IDLE, requestKey, runReducer } from "@/components/schedule/run-state";
import { firstClash } from "@/components/schedule/week-model";
import { optimize } from "@/lib/optimizer/optimize";
import { GOAL_WEIGHTS, NO_CONSTRAINTS } from "@/lib/optimizer/presets";
import { buildPlanIcs, needsTermDates } from "@/lib/planner-ics";
import {
  buildOptimizeRequest,
  buildScheduleEvents,
  buildStopsForDay,
  defaultSchedulePreferences,
  getInitialPlannerState,
  heldOutCourses,
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
  meetTogether,
  meetingsConflict,
  otherSiteOf,
  optionsConflict,
  scheduleEventsOf,
  findOption,
  sectionRef,
  termDates,
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
      term: termDates["spring-2027"],
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

const filter = (over: Partial<{ openSeatsOnly: boolean; otherSites: boolean }> = {}) => ({ openSeatsOnly: false, otherSites: false, ...over });

describe("which options the optimizer suggests", () => {
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
    // It still takes its time slot in the search, as a locked one-option course.
    const request = buildOptimizeRequest(picked, defaultSchedulePreferences("compact"), { catalog });
    expect(request.courses.map((c) => [c.code, c.sections.map((section) => section.id)])).toEqual([
      ["MATH 1680", [optionsOf(catalog, "MATH 1680")[0].id]],
      ["SPAN 2040", [frisco.id]],
    ]);
    expect(request.locks).toEqual({ "SPAN 2040": frisco.id });
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

describe("review findings on the planner side (Astra, 01eff64)", () => {
  test("two Monday classes whose ranges share only a Sunday never meet", () => {
    const first = { start: "2027-01-11", end: "2027-01-17", raw: "" };
    const second = { start: "2027-01-17", end: "2027-01-24", raw: "" };
    expect(meetTogether("Mon", first, second)).toBe(false);
    expect(meetTogether("Sun", first, second)).toBe(true);
    // A meeting without dates runs the planning term (Jan 11 - May 7).
    expect(meetTogether("Mon", null, first)).toBe(true);
    expect(meetTogether("Mon", null, { start: "2027-05-08", end: "2027-05-14" })).toBe(false);
    const [math] = optionsOf(fixtureCatalog(), "MATH 1680");
    const monday = math.meetings.find((m) => m.day === "Mon")!;
    expect(meetingsConflict({ ...monday, dates: first }, { ...monday, dates: second })).toBe(false);
  });

  test("a result goes stale when a pick moves its course into the search", () => {
    // SPAN 2040 offers an async online option (ACCT 5120's) and a timed one (MATH 1680's).
    const input = fixtureInput();
    courseAs(input, "MATH 1680", "SPAN 2040");
    (input.courses as Record<string, { sections: unknown[] }>)["SPAN 2040"].sections.push(structuredClone(input.courses["ACCT 5120"].sections[0]));
    const catalog = fixtureCatalog(input);
    const [timed, async] = optionsOf(catalog, "SPAN 2040");
    const prefs = defaultSchedulePreferences("compact");
    const withAsync = buildOptimizeRequest(plan_(["SPAN 2040", "MATH 1710"], { "SPAN 2040": async.id }), prefs, { catalog });
    const withTimed = buildOptimizeRequest(plan_(["SPAN 2040", "MATH 1710"], { "SPAN 2040": timed.id }), prefs, { catalog });
    expect(withAsync.courses.map((course) => course.code)).toEqual(["MATH 1710"]);
    expect(withTimed.courses.map((course) => course.code)).toEqual(["MATH 1710", "SPAN 2040"]);
    // The online course left out of the search still counts toward the credit limit.
    expect([withAsync.fixedCredits, withTimed.fixedCredits]).toEqual([3, 0]);
    const shown = runReducer(runReducer(IDLE, { type: "start", id: 1, inputKey: requestKey(withAsync) }), {
      type: "reply",
      reply: { id: 1, phase: "first", result: optimize(withAsync), settled: true },
    });
    expect(canApply(shown, requestKey(withAsync), shown.result!.schedules[0], {})).toEqual({ ok: true });
    expect(canApply(shown, requestKey(withTimed), shown.result!.schedules[0], {}).ok).toBe(false);
  });

  test("a lock on an old sample section is held out of the search and named, not dropped", () => {
    const locked = { "MATH 1680": "math-1680-002" };
    const state = plan_(["MATH 1680", "MATH 1710"], locked);
    const catalog = fixtureCatalog();
    expect(heldOutCourses({ ...state, lockedSections: locked }, catalog, filter())).toEqual([{ code: "MATH 1680", reason: "lock-unavailable" }]);
    // Unlocked, the old sample is replaced by a real option like any other pick.
    expect(heldOutCourses(state, catalog, filter())).toEqual([]);
  });

  /** Every row and meeting line of a fixture row moved to one weekly slot. */
  const retime = (row: { linked_sections: Line[]; meetings: Line[] }, days: string, start: string, end: string) =>
    [...row.linked_sections, ...row.meetings].forEach((line) => Object.assign(line, { days, start_time: start, end_time: end }));
  type Line = { days: string; start_time: string; end_time: string };

  /** Applies each returned option the way Week does and checks the merged plan, as canApply now does too. */
  function appliedPlansAreFeasible(picks: Record<string, string>, locks: Record<string, string>, catalog: ReturnType<typeof fixtureCatalog>, openSeatsOnly: boolean) {
    const state = { ...plan_(Object.keys(picks).concat("SPAN 2050"), picks), lockedSections: locks };
    const prefs = defaultSchedulePreferences("compact");
    const request = buildOptimizeRequest(state, { ...prefs, constraints: { ...prefs.constraints, openSeatsOnly } }, { catalog });
    const result = optimize(request);
    const find = (code: string, id: string) => findOption(catalog, code, id) ?? undefined;
    const shown = { ...IDLE, id: 1, inputKey: "k", resultKey: "k", status: "done" as const, result };
    return result.schedules.map((schedule) => ({
      clash: firstClash({ ...picks, ...schedule.byCourse }, find),
      applicable: canApply(shown, "k", schedule, locks, (merged) => firstClash(merged, find), picks).ok,
    }));
  }

  /** SPAN 2050: a full-term option in GAB 511 at `slot`, and one on Tuesday and Thursday at 1:00 PM. */
  function span2050(input: ReturnType<typeof fixtureInput>, slot: [string, string, string]) {
    const option = (number: string, days: string, start: string, end: string) => {
      const row = structuredClone(input.courses["ACCT 5120"].sections[0]);
      renumber(row, [number]);
      setDates(row, "01/11/2027 - 05/07/2027");
      row.session = "Regular Academic Session";
      [...row.linked_sections, ...row.meetings].forEach((line) => (line.room = "Gab 511"));
      retime(row, days, start, end);
      return row;
    };
    (input.courses as Record<string, unknown>)["SPAN 2050"] = {
      ...structuredClone(input.courses["ACCT 5120"]),
      course_code: "SPAN 2050",
      sections: [option("7100", ...slot), option("7200", "TR", "1:00PM", "2:20PM")],
    };
  }

  test("a closed pick kept under Open seats only still blocks its time slot", () => {
    const input = fixtureInput();
    courseAs(input, "MATH 1680", "SPAN 2040", (row) => (row.status = "Closed"));
    span2050(input, ["TR", "9:35AM", "10:55AM"]);
    const catalog = fixtureCatalog(input);
    const closed = optionsOf(catalog, "SPAN 2040")[0];
    expect(closed.status).toBe("closed");
    const outcomes = appliedPlansAreFeasible({ "SPAN 2040": closed.id }, {}, catalog, true);
    // Before the fix the search saw only SPAN 2050, and its same-slot option came back applicable.
    expect(outcomes.length).toBeGreaterThan(0);
    expect(outcomes).toEqual(outcomes.map(() => ({ clash: null, applicable: true })));
  });

  test("an old sample lock still blocks the slot Week shows for it", () => {
    const input = fixtureInput();
    // math-1680-002 meets MWF 2:00-2:50 PM.
    span2050(input, ["MWF", "2:00PM", "2:50PM"]);
    const catalog = fixtureCatalog(input);
    const locked = { "MATH 1680": "math-1680-002" };
    const outcomes = appliedPlansAreFeasible(locked, locked, catalog, false);
    expect(outcomes.length).toBeGreaterThan(0);
    expect(outcomes).toEqual(outcomes.map(() => ({ clash: null, applicable: true })));
  });

  test("canApply refuses an option whose merged plan clashes", () => {
    const catalog = fixtureCatalog();
    const [math] = optionsOf(catalog, "MATH 1680");
    const result = optimize(buildOptimizeRequest(plan_(["MATH 1680"]), defaultSchedulePreferences("compact"), { catalog }));
    const shown = { ...IDLE, id: 1, inputKey: "k", resultKey: "k", status: "done" as const, result };
    // The plan already holds a SPAN 2040 pick at MATH 1680's times.
    const current = { "SPAN 2040": math.id.replace("MATH 1680", "SPAN 2040") };
    const find = (code: string, id: string) => (code === "SPAN 2040" ? { ...math, courseCode: "SPAN 2040" } : findOption(catalog, code, id) ?? undefined);
    const check = canApply(shown, "k", result.schedules[0], {}, (merged) => firstClash(merged, find), current);
    expect(check).toEqual({ ok: false, reason: "This option would make SPAN 2040 and MATH 1680 overlap. Optimize again, or pick a section by hand." });
  });
});

describe("walking per session (Astra, 4691089)", () => {
  test("a full-term class followed by a first-half and a second-half class has a walk to each", () => {
    const at = (buildingId: string, start: string, dates: { start: string; end: string }) => ({ day: "Mon" as const, start, buildingId, dates });
    const events = [
      at("a", "09:00", { start: "2027-01-11", end: "2027-05-07" }),
      at("b", "10:00", { start: "2027-01-11", end: "2027-03-05" }),
      at("c", "10:00", { start: "2027-03-15", end: "2027-05-07" }),
    ];
    const seconds: Record<string, number> = { "a>b": 60, "a>c": 600 };
    const summary = summarizeWeeklyWalking(events, (from, to) =>
      seconds[`${from}>${to}`] === undefined ? { seconds: null, source: "unknown" } : { seconds: seconds[`${from}>${to}`], source: "campus-network" },
    );
    // Adjacent entries alone gave 1 leg of 60 s.
    expect(summary).toMatchObject({ knownLegs: 2, knownSeconds: 660, unknownLegs: 0 });
  });
});

describe("walking on dates a class never meets (Astra, 71ea5ca)", () => {
  test("two Monday classes dated only Sunday, Mar 14, have no walk", () => {
    const sunday = { start: "2027-03-14", end: "2027-03-14" };
    const events = [
      { day: "Mon" as const, start: "09:00", buildingId: "a", dates: sunday },
      { day: "Mon" as const, start: "10:00", buildingId: "b", dates: sunday },
    ];
    // The same-range shortcut used to count one 60 s leg; the optimizer counts none.
    expect(summarizeWeeklyWalking(events, () => ({ seconds: 60, source: "campus-network" }))).toMatchObject({ knownLegs: 0, knownSeconds: 0 });
  });
});
