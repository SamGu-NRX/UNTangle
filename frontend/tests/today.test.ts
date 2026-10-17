import { describe, expect, test } from "bun:test";
import {
  computeTodayState,
  dateAtMinutes,
  decideWalk,
  findNextSchoolDay,
  formatCountdown,
  formatDistance,
  haversineMeters,
  parseTimeToMinutes,
  toTodayStops,
  weekdayOf,
  type BuildResolver,
  type NextSchoolDay,
  type ResolvedPlace,
  type TodayStop,
  type WalkDecision,
} from "@/components/today/today-engine";
import { weekDays, type ScheduleEvent, type WeekDay } from "@/lib/types";

const coordMemo = new Map<string, { lat: number; lng: number }>();
function coordsFor(location: string): { lat: number; lng: number } {
  let coords = coordMemo.get(location);
  if (!coords) {
    coords = { lat: 33.2 + coordMemo.size / 5000, lng: -97.15 + coordMemo.size / 7000 };
    coordMemo.set(location, coords);
  }
  return coords;
}

const resolver: BuildResolver = (location, buildingId) => {
  if (location === "UNKNOWN HALL") {
    return undefined;
  }
  const coords = coordsFor(location);
  const place: ResolvedPlace = {
    buildingId: buildingId ?? `id-${location.toLowerCase().replace(/\s+/g, "-")}`,
    buildingName: `${location} Building`,
    shortName: location.split(/\s+/).map((w) => w[0]).join(""),
    lat: coords.lat,
    lng: coords.lng,
  };
  return place;
};

let seq = 0;
function event(overrides: Partial<ScheduleEvent> = {}): ScheduleEvent {
  seq += 1;
  const base = {
    courseCode: "CSCE 2100",
    title: "Foundations of Computing",
    sectionId: `sec-${seq}`,
    professor: "Sample Professor",
    rating: 4.2,
    location: "Discovery Park",
    buildingId: "discovery-park",
    day: "Mon" as const,
    start: "09:00",
    end: "09:50",
    ...overrides,
  };
  // Overriding the location must move the building with it, or the fixture
  // pairs a new place with the old building id.
  if (overrides.location !== undefined && overrides.buildingId === undefined) {
    base.buildingId = `id-${overrides.location.toLowerCase().replace(/\s+/g, "-")}`;
  }
  return base;
}

function stop(overrides: Partial<TodayStop> = {}): TodayStop {
  // Route schedule-shaped overrides through the event so the place and the
  // minute math re-resolve; the rest patches the resolved stop directly.
  const eventOverrides: Partial<ScheduleEvent> = {};
  if (overrides.location !== undefined) {
    eventOverrides.location = overrides.location;
  }
  if (overrides.buildingId !== undefined) {
    eventOverrides.buildingId = overrides.buildingId;
  }
  if (overrides.start !== undefined) {
    eventOverrides.start = overrides.start;
  }
  if (overrides.end !== undefined) {
    eventOverrides.end = overrides.end;
  }
  const base = toTodayStops([event(eventOverrides)], resolver)[0];
  return { ...base, ...overrides };
}

function wednesday(hours: number, minutes: number): Date {
  return new Date(2026, 9, 14, hours, minutes, 0, 0);
}

function saturday(hours: number, minutes: number): Date {
  return new Date(2026, 9, 17, hours, minutes, 0, 0);
}

describe("weekdayOf", () => {
  test("maps school days by name", () => {
    expect(weekdayOf(new Date(2026, 9, 12))).toBe("Mon");
    expect(weekdayOf(new Date(2026, 9, 14))).toBe("Wed");
    expect(weekdayOf(new Date(2026, 9, 16))).toBe("Fri");
  });

  test("returns null on the weekend", () => {
    expect(weekdayOf(new Date(2026, 9, 17))).toBeNull();
    expect(weekdayOf(new Date(2026, 9, 18))).toBeNull();
  });
});

describe("parseTimeToMinutes", () => {
  test("parses 24-hour times", () => {
    expect(parseTimeToMinutes("00:00")).toBe(0);
    expect(parseTimeToMinutes("09:50")).toBe(590);
    expect(parseTimeToMinutes("15:30")).toBe(930);
  });

  test("clamps malformed input instead of throwing", () => {
    expect(parseTimeToMinutes("25:99")).toBe(23 * 60 + 59);
    expect(parseTimeToMinutes("bad")).toBe(0);
  });
});

describe("dateAtMinutes", () => {
  test("keeps the same calendar day", () => {
    const now = wednesday(10, 0);
    const at = dateAtMinutes(now, 14 * 60 + 30);
    expect(at.getHours()).toBe(14);
    expect(at.getMinutes()).toBe(30);
    expect(at.getDate()).toBe(14);
  });

  test("a 10:00 class is one hour after a 09:00 stop", () => {
    const now = wednesday(9, 0);
    const at = dateAtMinutes(now, 600);
    expect((at.getTime() - now.getTime()) / 60000).toBe(60);
  });
});

describe("toTodayStops", () => {
  test("sorts by start and resolves places", () => {
    const stops = toTodayStops([event({ start: "11:00", end: "11:50" }), event({ start: "09:00", end: "09:50" })], resolver);
    expect(stops).toHaveLength(2);
    expect(stops[0].startMinutes).toBeLessThan(stops[1].startMinutes);
    expect(stops[0].place?.buildingName).toBe("Discovery Park Building");
  });

  test("unresolvable buildings carry place: null", () => {
    const stops = toTodayStops([event({ location: "UNKNOWN HALL" })], resolver);
    expect(stops[0].place).toBeNull();
    expect(stops[0].location).toBe("UNKNOWN HALL");
  });
});

describe("computeTodayState", () => {
  test("before the first class: counts down to it", () => {
    const state = computeTodayState({ now: wednesday(7, 30), eventsForToday: [event()], resolve: resolver });
    expect(state.phase).toBe("before-first");
    expect(state.nextStop?.start).toBe("09:00");
    expect(state.countdownKind).toBe("until-start");
    expect(state.countdownSeconds).toBe(5400);
  });

  test("during a class: counts down to its end", () => {
    const state = computeTodayState({ now: wednesday(9, 10), eventsForToday: [event()], resolve: resolver });
    expect(state.phase).toBe("current");
    expect(state.currentStop?.start).toBe("09:00");
    expect(state.countdownSeconds).toBe(40 * 60);
  });

  test("between classes: pairs the ended stop with the next one", () => {
    const events = [event({ start: "09:00", end: "09:50" }), event({ start: "11:00", end: "11:50" })];
    const state = computeTodayState({ now: wednesday(10, 0), eventsForToday: events, resolve: resolver });
    expect(state.phase).toBe("between");
    expect(state.previousStop?.start).toBe("09:00");
    expect(state.nextStop?.start).toBe("11:00");
    expect(state.countdownSeconds).toBe(3600);
  });

  test("after the last class: no countdown", () => {
    const state = computeTodayState({ now: wednesday(18, 0), eventsForToday: [event()], resolve: resolver });
    expect(state.phase).toBe("after-last");
    expect(state.countdownSeconds).toBeNull();
    expect(state.previousStop?.start).toBe("09:00");
  });

  test("weekend: no classes regardless of events", () => {
    const state = computeTodayState({ now: saturday(10, 0), eventsForToday: [event()], resolve: resolver });
    expect(state.isWeekend).toBe(true);
    expect(state.phase).toBe("no-classes");
    expect(state.stops).toHaveLength(0);
  });

  test("school day with an empty schedule: no-classes, not weekend", () => {
    const state = computeTodayState({ now: wednesday(10, 0), eventsForToday: [], resolve: resolver });
    expect(state.isWeekend).toBe(false);
    expect(state.phase).toBe("no-classes");
    expect(state.dayLabel).toBe("Wed");
  });
});

describe("decideWalk", () => {
  test("no pair when there is nothing next", () => {
    expect(decideWalk(null, null).kind).toBe("none");
  });

  test("same-building when both places share the building id", () => {
    const from = stop();
    const to = stop({ buildingId: from.place?.buildingId });
    const decision = decideWalk(from, to);
    expect(decision.kind).toBe("same-building");
  });

  test("unresolvable carries the unresolved end explicitly", () => {
    const from = stop({ location: "UNKNOWN HALL" });
    const to = stop();
    expect(decideWalk(from, to).kind).toBe("unresolvable");
    expect(decideWalk(to, from).kind).toBe("unresolvable");
  });

  test("needs-route when both places resolve", () => {
    const from = stop({ location: "Discovery Park" });
    const to = stop({ location: "Sage Hall" });
    expect(decideWalk(from, to).kind).toBe("needs-route");
  });
});

describe("findNextSchoolDay", () => {
  test("later today counts when today still has a future stop", () => {
    const stopsByDay = { Wed: [stop({ start: "15:00", end: "15:50" })] };
    const next = findNextSchoolDay({ now: wednesday(14, 0), stopsByDay });
    expect(next?.day).toBe("Wed");
    expect(next?.daysAhead).toBe(0);
  });

  test("past stops today do not count; next school day wins", () => {
    const stopsByDay = { Wed: [stop({ start: "09:00", end: "09:50" })], Thu: [stop({ start: "10:00", end: "10:50" })] };
    const next = findNextSchoolDay({ now: wednesday(14, 0), stopsByDay });
    expect(next?.day).toBe("Thu");
    expect(next?.daysAhead).toBe(1);
  });

  test("Friday evening wraps to Monday, three days ahead", () => {
    const friday = new Date(2026, 9, 16, 19, 0, 0, 0);
    const stopsByDay = { Mon: [stop({ start: "10:00", end: "10:50" })] };
    const next = findNextSchoolDay({ now: friday, stopsByDay });
    expect(next?.day).toBe("Mon");
    expect(next?.daysAhead).toBe(3);
  });

  test("Saturday finds Monday, two days ahead", () => {
    const stopsByDay = { Mon: [stop({ start: "10:00", end: "10:50" })] };
    const next = findNextSchoolDay({ now: saturday(12, 0), stopsByDay });
    expect(next?.day).toBe("Mon");
    expect(next?.daysAhead).toBe(2);
  });

  test("Sunday finds Monday, one day ahead", () => {
    const sunday = new Date(2026, 9, 18, 12, 0, 0, 0);
    const stopsByDay = { Mon: [stop({ start: "10:00", end: "10:50" })] };
    const next = findNextSchoolDay({ now: sunday, stopsByDay });
    expect(next?.day).toBe("Mon");
    expect(next?.daysAhead).toBe(1);
  });

  test("a fully empty week returns null", () => {
    const next = findNextSchoolDay({ now: wednesday(12, 0), stopsByDay: {} });
    expect(next).toBeNull();
  });
});

describe("formatCountdown", () => {
  test("zero and tiny remainders still show a minute", () => {
    expect(formatCountdown(0)).toBe("1 min");
    expect(formatCountdown(59)).toBe("1 min");
    expect(formatCountdown(60)).toBe("1 min");
  });

  test("minutes and hours", () => {
    expect(formatCountdown(1500)).toBe("25 min");
    expect(formatCountdown(5400)).toBe("1 hr 30 min");
    expect(formatCountdown(7200)).toBe("2 hr");
  });

  test("negative input never reads negative", () => {
    expect(formatCountdown(-120)).toBe("1 min");
  });
});

describe("formatDistance and haversineMeters", () => {
  test("meters under a kilometre", () => {
    expect(formatDistance(0)).toBe("1 m");
    expect(formatDistance(450)).toBe("450 m");
  });

  test("kilometres beyond", () => {
    expect(formatDistance(1200)).toBe("1.2 km");
  });

  test("haversine is zero for identical points and sane apart", () => {
    const a = { lat: 33.2, lng: -97.15 };
    const b = { lat: 33.205, lng: -97.145 };
    const d = haversineMeters(a, b);
    expect(d).toBeGreaterThan(250);
    expect(d).toBeLessThan(350);
    expect(haversineMeters(a, a)).toBe(0);
  });
});

describe("DST behavior (US rules, self-skipping elsewhere)", () => {
  const observesDST =
    new Date(2026, 0, 15).getTimezoneOffset() !== new Date(2026, 6, 15).getTimezoneOffset();
  const skipOutsideDST = observesDST ? test : test.skip;

  skipOutsideDST("spring-forward day: epoch distance spans the skipped hour", () => {
    // Mar 8 2026: 02:00 -> 03:00. 01:30 to a 03:00 class is 90 real minutes.
    const state = computeTodayState({
      now: new Date(2026, 2, 8, 1, 30, 0, 0),
      eventsForToday: [event({ start: "03:00", end: "03:50" })],
      resolve: resolver,
    });
    expect(state.countdownSeconds).toBe(90 * 60);
    expect(state.countdownKind).toBe("until-start");
  });

  skipOutsideDST("dateAtMinutes avoids the nonexistent 02:30 on spring-forward day", () => {
    const at = dateAtMinutes(new Date(2026, 2, 8, 1, 0, 0, 0), 150);
    expect(at.getHours()).toBe(3);
    expect(at.getMinutes()).toBe(30);
  });

  skipOutsideDST("equal wall-clock hours stay equal on fall-back day", () => {
    // Nov 1 2026 repeats 01:00; midday arithmetic is unaffected.
    const now = new Date(2026, 10, 1, 12, 0, 0, 0);
    const at = dateAtMinutes(now, 13 * 60 + 30);
    expect(at.getTime() - now.getTime()).toBe(90 * 60 * 1000);
  });

  skipOutsideDST("a 10:00 class is exactly 1h after a 09:00 stop on DST-change days", () => {
    const now = new Date(2026, 10, 1, 9, 0, 0, 0);
    const at = dateAtMinutes(now, 600);
    expect((at.getTime() - now.getTime()) / 60000).toBe(60);
  });
});
