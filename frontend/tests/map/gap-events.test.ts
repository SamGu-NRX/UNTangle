/**
 * "In this gap": which campus events Day lists between two classes, and what
 * each row claims. Trips are injected, so the rules are tested without the
 * campus walking matrix; one block at the end checks the real trip function.
 */
import { describe, expect, test } from "bun:test";
import type { NormalizedEvent } from "@/lib/campus-events/types";
import { buildItinerary } from "@/lib/map-itinerary";
import type { MapStop } from "@/lib/types";
import { nextDateOf } from "@/components/map/day-steps";
import {
  campusDayRange,
  campusTrip,
  GAP_MIN_MINUTES,
  gapRows,
  parseEventsAnswer,
  type TripFn,
} from "@/components/map/gap-events";

/** A Tuesday in October 2026: a class day, campus time UTC-5. */
const DATE = "2026-10-20";

function stop(courseCode: string, start: string, end: string, buildingId: string): MapStop {
  return {
    courseCode,
    title: `${courseCode} title`,
    location: buildingId.toUpperCase(),
    buildingId,
    buildingName: `${buildingId} building`,
    shortName: buildingId.toUpperCase(),
    lat: 33.21,
    lng: -97.15,
    resolutionStatus: "local",
    geocodeQuery: "",
    day: "Tue",
    start,
    end,
  };
}

const day = (...stops: MapStop[]) => buildItinerary(stops, new Map(), new Map());

/** Campus wall time on DATE as the UTC instant the feed sends. */
const at = (time: string) => {
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(Date.UTC(2026, 9, 20, hours + 5, minutes)).toISOString();
};

function event(title: string, start: string, end: string, buildingId: string | null, overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    sourceId: "student_organizations",
    url: `https://calendar.unt.edu/event/${title.toLowerCase().replace(/\W+/g, "-")}`,
    title,
    start: at(start),
    end: at(end),
    isAllDay: false,
    location: buildingId ? `${buildingId.toUpperCase()} Hall, 101` : "Library Mall, by the fountain",
    // Real catalogue ids, so a building event resolves to a name and a point.
    buildingId,
    tags: [],
    ...overrides,
  };
}

/** gab and blb are classrooms; uu is 8 minutes from gab and 4 from blb (seconds round up). */
const trips: TripFn = (from, to) => {
  if (from === to) return { seconds: 0, mode: "walk" };
  const pair = [from, to].sort().join(">");
  const seconds: Record<string, number> = { "gab>uu": 442, "blb>uu": 234, "blb>gab": 300, "blb>sage": 260, "gab>sage": 462 };
  return pair in seconds ? { seconds: seconds[pair], mode: "walk" } : null;
};

const rows = (itinerary: ReturnType<typeof day>, events: NormalizedEvent[] | null, now: number | null = null) =>
  gapRows({ itinerary, date: DATE, events, now, trips });

describe("the gap threshold", () => {
  test(`a break of ${GAP_MIN_MINUTES} minutes gets a row, one minute less gets none`, () => {
    const meeting = event("Club meeting", "10:05", "10:15", "gab");
    const atThreshold = rows(day(stop("CSCE 1030", "09:00", "10:00", "gab"), stop("CSCE 2100", "10:30", "11:20", "gab")), [meeting]);
    expect(atThreshold.map((row) => row.events.map((item) => item.title))).toEqual([["Club meeting"]]);
    const under = rows(day(stop("CSCE 1030", "09:00", "10:01", "gab"), stop("CSCE 2100", "10:30", "11:20", "gab")), [meeting]);
    expect(under).toEqual([]);
  });

  test("the row sits on the walk into the class after the gap", () => {
    const itinerary = day(stop("CSCE 1030", "09:00", "10:00", "gab"), stop("CSCE 2100", "11:00", "11:50", "blb"));
    const [row] = rows(itinerary, [event("Club meeting", "10:15", "10:45", "uu")]);
    expect(row.legKey).toBe(itinerary.legs[0].key);
    expect([row.from.stop.courseCode, row.to.stop.courseCode, row.start, row.end]).toEqual(["CSCE 1030", "CSCE 2100", 600, 660]);
  });
});

describe("fits or doesn't fit", () => {
  const itinerary = day(stop("CSCE 1030", "09:00", "10:00", "gab"), stop("CSCE 2100", "11:00", "11:50", "blb"));

  test("an event with time for both walks makes the next class, with the walk there in minutes", () => {
    const [row] = rows(itinerary, [event("Club meeting", "10:15", "10:45", "uu")]);
    expect(row.events[0]).toMatchObject({
      start: 615,
      end: 645,
      to: { minutes: 8, mode: "walk" },
      back: { minutes: 4, mode: "walk" },
      // 11:00 less the 4-minute walk and the 2 minutes Day keeps before every class.
      leaveBy: 654,
      fit: "ok",
      place: { kind: "building", buildingId: "uu", shortName: "UU" },
    });
  });

  test("leaving on time means leaving as it ends: tight", () => {
    const [row] = rows(itinerary, [event("Info session", "10:15", "10:54", "uu")]);
    expect(row.events[0]).toMatchObject({ leaveBy: 654, fit: "tight" });
  });

  test("an event the student can't walk back from in time is not shown", () => {
    // Ends 10:57; the walk back takes 4 minutes, so the student is a minute late.
    expect(rows(itinerary, [event("Long talk", "10:15", "10:57", "uu")])).toEqual([]);
  });

  test("an event the student can't reach from the class before is not shown", () => {
    // Starts 10:07; the walk there takes 8 minutes.
    expect(rows(itinerary, [event("Early start", "10:07", "10:30", "uu")])).toEqual([]);
  });

  test("whole minutes decide, as the row shows them", () => {
    // Ending 10:56:06, the 234-second walk back arrives at 11:00:00 exactly.
    // The row counts that as ending 10:57 with a 4-minute walk, which misses 11:00.
    expect(rows(itinerary, [event("Close call", "10:15", "10:56", "uu", { end: "2026-10-20T15:56:06.000Z" })])).toEqual([]);
  });

  test("an event overlapping either class, or an all-day one, is not shown", () => {
    const overlaps = event("Overlaps", "09:45", "10:30", "uu");
    const allDay = event("Homecoming", "00:00", "23:59", null, { isAllDay: true });
    expect(rows(itinerary, [overlaps, allDay])).toEqual([]);
  });

  test("the preview order is by start time", () => {
    const [row] = rows(itinerary, [event("Later", "10:30", "10:40", "uu"), event("Sooner", "10:15", "10:20", "uu")]);
    expect(row.events.map((item) => item.title)).toEqual(["Sooner", "Later"]);
  });

  test("a class shown for the weekday that doesn't meet on the date blocks the gap it sits in", () => {
    // CSCE 1040's dates end before Oct 20, but the weekday's itinerary still lists it at 10:15.
    const ended = { ...stop("CSCE 1040", "10:15", "10:45", "sage"), dates: { start: "2026-08-24", end: "2026-10-09" } };
    const withEnded = day(stop("CSCE 1030", "09:00", "10:00", "gab"), ended, stop("CSCE 2100", "11:00", "11:50", "blb"));
    expect(rows(withEnded, [event("Club meeting", "10:15", "10:45", "uu")])).toEqual([]);
  });

  test("overlapping classes count from the one that ends last", () => {
    // CSCE 1040 runs past CSCE 1030, so the gap is 10:30 to 11:00 and starts at sage.
    const overlapping = day(
      stop("CSCE 1030", "09:00", "10:00", "gab"),
      stop("CSCE 1040", "09:30", "10:30", "sage"),
      stop("CSCE 2100", "11:00", "11:50", "blb"),
    );
    const [row] = rows(overlapping, [event("Club meeting", "10:40", "10:50", "uu"), event("During class", "10:05", "10:20", "uu")]);
    expect(row.from.stop.courseCode).toBe("CSCE 1040");
    expect(row.start).toBe(630);
    // sage to uu has no known walk, so the trip there is unknown rather than guessed from gab.
    expect(row.events.map((item) => [item.title, item.to])).toEqual([["Club meeting", null]]);
  });
});

describe("an unknown building", () => {
  const itinerary = day(stop("CSCE 1030", "09:00", "10:00", "gab"), stop("CSCE 2100", "11:00", "11:50", "blb"));

  test("keeps the raw place, has no walk, and claims nothing about the next class", () => {
    const [row] = rows(itinerary, [event("Book swap", "10:05", "10:50", null)]);
    expect(row.events[0]).toMatchObject({
      place: { kind: "raw", location: "Library Mall, by the fountain" },
      to: null,
      back: null,
      leaveBy: null,
      fit: "unknown",
    });
  });

  test("a building with no known walk is the same: no time, no verdict", () => {
    // wh is a real building, but these trips know no walk to it.
    const [row] = rows(itinerary, [event("Debate", "10:05", "10:50", "wh")]);
    expect(row.events[0]).toMatchObject({ place: { kind: "building", buildingId: "wh" }, to: null, back: null, fit: "unknown" });
  });
});

describe("today", () => {
  const itinerary = day(stop("CSCE 1030", "09:00", "10:00", "gab"), stop("CSCE 2100", "11:00", "11:50", "blb"));
  const meeting = event("Club meeting", "10:30", "10:45", "uu");

  test("an event the student can no longer reach in time is gone", () => {
    expect(rows(itinerary, [meeting], 10 * 60 + 20).length).toBe(1);
    // At 10:25 the 8-minute walk arrives at 10:33, after it starts.
    expect(rows(itinerary, [meeting], 10 * 60 + 25)).toEqual([]);
  });

  test("a gap that has ended shows nothing", () => {
    expect(rows(itinerary, [meeting], 11 * 60)).toEqual([]);
  });

  test("the selected event stays listed after the minute it was still reachable", () => {
    const [listed] = rows(itinerary, [meeting], 10 * 60 + 20);
    const key = listed.events[0].key;
    const later = gapRows({ itinerary, date: DATE, events: [meeting], now: 10 * 60 + 25, trips, keep: key });
    expect(later.map((row) => row.events.map((item) => item.key))).toEqual([[key]]);
    // It still goes when its gap ends.
    expect(gapRows({ itinerary, date: DATE, events: [meeting], now: 11 * 60, trips, keep: key })).toEqual([]);
  });
});

describe("the feed", () => {
  const itinerary = day(stop("CSCE 1030", "09:00", "10:00", "gab"), stop("CSCE 2100", "11:00", "11:50", "blb"));

  test("an unavailable feed shows nothing", () => {
    expect(rows(itinerary, null)).toEqual([]);
    expect(rows(itinerary, [])).toEqual([]);
  });

  test("an answer that isn't an events list is unavailable", () => {
    expect(parseEventsAnswer(null)).toBeNull();
    expect(parseEventsAnswer({ error: "the range is capped at 14 days" })).toBeNull();
    expect(parseEventsAnswer({ events: "none" })).toBeNull();
  });

  test("an event missing a field Day reads is dropped, and only a web link opens", () => {
    const good = event("Club meeting", "10:15", "10:45", "uu");
    const parsed = parseEventsAnswer({
      events: [good, { ...good, title: 7 }, { ...good, start: "not a date" }, { ...good, title: "Script", url: "javascript:alert(1)" }],
    });
    expect(parsed?.map((item) => [item.title, item.url])).toEqual([
      ["Club meeting", good.url],
      ["Script", null],
    ]);
  });
});

describe("dates and trips", () => {
  test("a weekday shown in Day means its next date, today included", () => {
    expect(nextDateOf("Mon", "2026-10-12")).toBe("2026-10-12");
    expect(nextDateOf("Thu", "2026-10-12")).toBe("2026-10-15");
    expect(nextDateOf("Mon", "2026-10-15")).toBe("2026-10-19");
  });

  test("the request covers the whole campus day, across a clock change", () => {
    expect(campusDayRange("2026-10-20")).toEqual({ from: "2026-10-20T05:00:00.000Z", to: "2026-10-21T05:00:00.000Z" });
    // Daylight saving ends on Nov 1, 2026: a 25-hour day.
    expect(campusDayRange("2026-11-01")).toEqual({ from: "2026-11-01T05:00:00.000Z", to: "2026-11-02T06:00:00.000Z" });
  });

  test("the campus trip is a walkway time, the shuttle, the same building, or unknown", () => {
    expect(campusTrip("env", "uu")).toEqual({ seconds: 442.1, mode: "walk" });
    expect(campusTrip("gate", "ntdp")).toEqual({ seconds: 20 * 60, mode: "shuttle" });
    // Discovery Park is off the walking matrix, but a building is no walk from itself.
    expect(campusTrip("ntdp", "ntdp")).toEqual({ seconds: 0, mode: "walk" });
    expect(campusTrip("env", "no-such-building")).toBeNull();
  });
});
