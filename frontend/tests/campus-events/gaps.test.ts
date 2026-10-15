/**
 * Gap-fitting tests: events between two classes, with walking time counted
 * only when both endpoint buildings are known. Walking time is injected, so
 * no campus data is needed.
 */

import { expect, test } from "bun:test";

import { eventsInGaps } from "@/lib/campus-events/gaps";
import type { DayClass, NormalizedEvent } from "@/lib/campus-events/types";
import type { WalkingTimeFn } from "@/lib/campus/walking-times";

function event(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    sourceId: "s",
    url: null,
    title: "Club Meeting",
    start: "2026-10-20T17:00:00.000Z",
    end: "2026-10-20T18:00:00.000Z",
    isAllDay: false,
    location: "Art Building",
    buildingId: "art",
    tags: [],
    ...overrides,
  };
}

function classAt(startUtcHour: number, endUtcHour: number, buildingId: string | null): DayClass {
  const day = "2026-10-20";
  const pad = (hour: number) => String(hour).padStart(2, "0");
  return {
    start: `${day}T${pad(startUtcHour)}:00:00.000Z`,
    end: `${day}T${pad(endUtcHour)}:00:00.000Z`,
    buildingId,
  };
}

/** Two buildings five minutes apart; any other pair unknown. */
const walkingTime: WalkingTimeFn = (from, to) =>
  from === to ? { seconds: 0, source: "campus-network" } : (from === "art" && to === "blb") || (from === "blb" && to === "art")
    ? { seconds: 300, source: "campus-network" }
    : { seconds: null, source: "unknown" };

test("an event that fits the gap between two classes is returned with the gap bounds", () => {
  const schedule = [classAt(15, 16, "art"), classAt(19, 20, "blb")];
  const fits = event({ start: "2026-10-20T16:30:00.000Z", end: "2026-10-20T17:30:00.000Z" });
  const placements = eventsInGaps(schedule, [fits], walkingTime);
  expect(placements.length).toBe(1);
  expect(placements[0]!.gapStart).toBe("2026-10-20T16:00:00.000Z");
  expect(placements[0]!.gapEnd).toBe("2026-10-20T19:00:00.000Z");
});

test("an event overlapping a class does not fit", () => {
  const schedule = [classAt(15, 16, "art"), classAt(19, 20, "blb")];
  const overlaps = event({ start: "2026-10-20T15:30:00.000Z", end: "2026-10-20T16:30:00.000Z" });
  const endsTooLate = event({ start: "2026-10-20T16:30:00.000Z", end: "2026-10-20T19:01:00.000Z" });
  expect(eventsInGaps(schedule, [overlaps, endsTooLate], walkingTime)).toEqual([]);
});

test("two overlapping classes leave no false gap between the later pair", () => {
  // 15:00–18:00 overlaps 16:00–17:00, so 17:00–19:00 is not a gap: the
  // 15:00 class runs until 18:00. The blocks must merge first. The middle
  // class's building pairs unknown buildings with the others, so walking
  // time imposes no requirement and the interval logic is what's tested.
  const schedule = [classAt(15, 18, "art"), classAt(16, 17, "dp"), classAt(19, 20, "art")];
  const collides = event({ start: "2026-10-20T17:00:00.000Z", end: "2026-10-20T18:30:00.000Z" });
  expect(eventsInGaps(schedule, [collides], walkingTime)).toEqual([]);
});

test("an event fits the gap after merged overlapping classes end", () => {
  // The merged block ends at 18:00 (the 15:00 class ends last), so the gap
  // runs 18:00–19:00, not 17:00–19:00.
  const schedule = [classAt(15, 18, "art"), classAt(16, 17, "blb"), classAt(19, 20, "blb")];
  const fits = event({ start: "2026-10-20T18:00:00.000Z", end: "2026-10-20T18:45:00.000Z" });
  const placements = eventsInGaps(schedule, [fits], walkingTime);
  expect(placements.length).toBe(1);
  expect(placements[0]!.gapStart).toBe("2026-10-20T18:00:00.000Z");
  expect(placements[0]!.gapEnd).toBe("2026-10-20T19:00:00.000Z");
});

test("walking time is counted when both buildings are known, on both sides", () => {
  const schedule = [classAt(15, 16, "art"), classAt(19, 20, "blb")];
  // Event at blb: the walk from the earlier class (art) needs 5 minutes; the walk to
  // the next class (also blb) is 0. 6 minutes after class: fits.
  const tightFit = event({ buildingId: "blb", start: "2026-10-20T16:06:00.000Z", end: "2026-10-20T17:30:00.000Z" });
  // Starts 3 minutes after class; the walk needs 5. Does not fit.
  const tooTight = event({ buildingId: "blb", start: "2026-10-20T16:03:00.000Z", end: "2026-10-20T17:30:00.000Z" });
  const placements = eventsInGaps(schedule, [tightFit, tooTight], walkingTime);
  expect(placements.length).toBe(1);
  expect(placements[0]!.event).toBe(tightFit);
  expect(placements[0]!.walkToSeconds).toBe(300);
  expect(placements[0]!.walkFromSeconds).toBe(0);
});

test("an unknown building means no walking requirement, never a guessed 0", () => {
  const schedule = [classAt(15, 16, "art"), classAt(19, 20, "blb")];
  // Same wall times as the too-tight case, but the event building is unknown.
  const unknown = event({ buildingId: null, location: "Somewhere", start: "2026-10-20T16:00:30.000Z", end: "2026-10-20T17:30:00.000Z" });
  const placements = eventsInGaps(schedule, [unknown], walkingTime);
  expect(placements.length).toBe(1);
  expect(placements[0]!.walkToSeconds).toBeNull();
  expect(placements[0]!.walkFromSeconds).toBeNull();
});

test("a day with fewer than two classes fits nothing, and unsorted schedules still work", () => {
  expect(eventsInGaps([classAt(15, 16, "art")], [event()], walkingTime)).toEqual([]);
  expect(eventsInGaps([], [event()], walkingTime)).toEqual([]);
  const unsorted = [classAt(19, 20, "blb"), classAt(15, 16, "art")];
  const fits = event({ start: "2026-10-20T16:30:00.000Z", end: "2026-10-20T17:30:00.000Z" });
  expect(eventsInGaps(unsorted, [fits], walkingTime).length).toBe(1);
});

test("an all-day event can never fit a between-class gap", () => {
  const schedule = [classAt(15, 16, "art"), classAt(19, 20, "blb")];
  const allDay = event({ isAllDay: true, start: "2026-10-20T00:00:00.000Z", end: "2026-10-21T00:00:00.000Z" });
  expect(eventsInGaps(schedule, [allDay], walkingTime)).toEqual([]);
});

test("events spanning multiple gaps fit the earliest gap they fit", () => {
  const schedule = [classAt(15, 16, "art"), classAt(19, 20, "art"), classAt(23, 24, "art")];
  const early = event({ start: "2026-10-20T16:30:00.000Z", end: "2026-10-20T17:30:00.000Z" });
  const late = event({ title: "Evening Club", start: "2026-10-20T20:30:00.000Z", end: "2026-10-20T21:30:00.000Z" });
  const placements = eventsInGaps(schedule, [late, early], walkingTime);
  expect(placements.map(placement => placement.event.title)).toEqual(["Club Meeting", "Evening Club"]);
});
