import { describe, expect, test } from "bun:test";
import {
  buildItinerary,
  formatClock,
  formatDistance,
  formatTime,
  lookupKey,
  pairKey,
  pointKey,
  routeRuns,
  stopNumbersLabel,
  transferFit,
  walkMinutesFromSeconds,
  type PairAnswer,
  type StopLookup,
} from "@/lib/map-itinerary";
import type { MapStop } from "@/lib/types";

const gab = { lat: 33.2131868, lng: -97.1481479 };
const blb = { lat: 33.2088704, lng: -97.1476988 };
const wh = { lat: 33.2098557, lng: -97.1456764 };

function stop(courseCode: string, start: string, end: string, place: { id: string; point?: { lat: number; lng: number } }): MapStop {
  return {
    courseCode,
    title: `${courseCode} title`,
    location: place.id.toUpperCase(),
    buildingId: place.id,
    buildingName: `${place.id} building`,
    shortName: place.id.toUpperCase(),
    lat: place.point?.lat,
    lng: place.point?.lng,
    resolutionStatus: place.point ? "local" : "unresolved",
    geocodeQuery: "",
    day: "Mon",
    start,
    end,
  };
}

function walkLeg(seconds: number, meters: number, from = gab, to = blb): PairAnswer {
  return { fromIndex: 0, toIndex: 1, source: "campus-network", geometry: [from, to], distanceMeters: meters, durationSeconds: seconds };
}

const key = (point: { lat: number; lng: number }, id: string) => pointKey(point, id);

describe("transferFit", () => {
  test("late when the walk is longer than the break", () => {
    expect(transferFit(11, 10)).toBe("late");
  });
  test("tight when two minutes or less are left", () => {
    expect(transferFit(8, 10)).toBe("tight");
    expect(transferFit(10, 10)).toBe("tight");
  });
  test("ok with more slack", () => {
    expect(transferFit(7, 10)).toBe("ok");
  });
  test("same building is never tight, even back to back", () => {
    expect(transferFit(0, 0)).toBe("ok");
  });
  test("unknown when the walk time is unknown", () => {
    expect(transferFit(null, 10)).toBe("unknown");
  });
});

describe("stopNumbersLabel", () => {
  test("one stop, a run, and separate visits", () => {
    expect(stopNumbersLabel([3])).toBe("3");
    expect(stopNumbersLabel([2, 3])).toBe("2–3");
    expect(stopNumbersLabel([1, 4])).toBe("1, 4");
    expect(stopNumbersLabel([1, 2, 3, 5])).toBe("1–3, 5");
  });
  test("refuses an empty list", () => {
    expect(() => stopNumbersLabel([])).toThrow();
  });
});

describe("formatting", () => {
  test("walk minutes round up and never show a nonzero walk as 0", () => {
    expect(walkMinutesFromSeconds(0)).toBe(0);
    expect(walkMinutesFromSeconds(1)).toBe(1);
    expect(walkMinutesFromSeconds(60)).toBe(1);
    expect(walkMinutesFromSeconds(61)).toBe(2);
  });
  test("distance in feet under a tenth of a mile, then miles", () => {
    expect(formatDistance(100)).toBe("330 ft");
    expect(formatDistance(482.8)).toBe("0.3 mi");
  });
  test("Day's times: 12-hour, no AM or PM", () => {
    expect(formatTime(8 * 60 + 49)).toBe("8:49");
    expect(formatTime(12 * 60)).toBe("12:00");
    expect(formatTime(13 * 60 + 5)).toBe("1:05");
    expect(formatTime(0)).toBe("12:00");
  });
  test("12-hour clock", () => {
    expect(formatClock("09:05")).toBe("9:05 AM");
    expect(formatClock("12:00")).toBe("12:00 PM");
    expect(formatClock("13:50")).toBe("1:50 PM");
  });
});

describe("buildItinerary", () => {
  test("a walkway leg gets minutes and the late flag when the walk beats the break; it leaves as the class ends", () => {
    const stops = [stop("CSCE 1030", "09:00", "09:50", { id: "gab", point: gab }), stop("MATH 1710", "10:00", "10:50", { id: "blb", point: blb })];
    const answers = new Map<string, PairAnswer>([[pairKey(key(gab, "gab"), key(blb, "blb")), walkLeg(631, 820)]]);
    const { legs } = buildItinerary(stops, new Map(), answers);
    expect(legs).toHaveLength(1);
    const [leg] = legs;
    expect(leg.gapMinutes).toBe(10);
    expect(leg.walkMinutes).toBe(11);
    expect(leg.leaveAt).toBe(9 * 60 + 50);
    expect(leg.transfer).toBe("late");
  });

  test("a walk with time to spare leaves two minutes earlier than the walk needs", () => {
    const stops = [stop("A 1", "09:00", "09:50", { id: "gab", point: gab }), stop("B 1", "10:30", "11:20", { id: "blb", point: blb })];
    const answers = new Map<string, PairAnswer>([[pairKey(key(gab, "gab"), key(blb, "blb")), walkLeg(300, 400)]]);
    const [leg] = buildItinerary(stops, new Map(), answers).legs;
    expect([leg.walkMinutes, leg.leaveAt, leg.transfer]).toEqual([5, 10 * 60 + 23, "ok"]);
  });

  test("a walk that fits with two minutes or less to spare counts as tight, not late", () => {
    const stops = [stop("A 1", "09:00", "09:50", { id: "gab", point: gab }), stop("B 1", "10:00", "10:50", { id: "blb", point: blb })];
    // 481 s rounds up to 9 min against a 10 min break.
    const answers = new Map<string, PairAnswer>([[pairKey(key(gab, "gab"), key(blb, "blb")), walkLeg(481, 700)]]);
    const { legs } = buildItinerary(stops, new Map(), answers);
    expect(legs[0].transfer).toBe("tight");
    expect(legs[0].leaveAt).toBe(9 * 60 + 50);
  });

  test("a straight-line answer has no minutes, no leave-by and no transfer verdict", () => {
    const stops = [stop("A 1", "09:00", "09:50", { id: "gab", point: gab }), stop("B 1", "10:00", "10:50", { id: "blb", point: blb })];
    const fallback: PairAnswer = { fromIndex: 0, toIndex: 1, source: "fallback", geometry: [gab, blb], distanceMeters: 482, durationSeconds: null };
    const answers = new Map<string, PairAnswer>([[pairKey(key(gab, "gab"), key(blb, "blb")), fallback]]);
    const { legs } = buildItinerary(stops, new Map(), answers);
    expect(legs[0].route).toEqual({ kind: "straight-line", meters: 482, geometry: [gab, blb] });
    expect(legs[0].walkMinutes).toBeNull();
    expect(legs[0].leaveAt).toBeNull();
    expect(legs[0].transfer).toBe("unknown");
  });

  test("a routing request that failed falls back to a client-side straight line", () => {
    const stops = [stop("A 1", "09:00", "09:50", { id: "gab", point: gab }), stop("B 1", "10:00", "10:50", { id: "blb", point: blb })];
    const answers = new Map<string, PairAnswer>([[pairKey(key(gab, "gab"), key(blb, "blb")), "failed"]]);
    const [leg] = buildItinerary(stops, new Map(), answers).legs;
    expect(leg.route.kind).toBe("straight-line");
    expect(leg.walkMinutes).toBeNull();
  });

  test("Discovery Park stays in the list, off the map, with a shuttle ride on both sides instead of a walk", () => {
    const stops = [
      stop("A 1", "09:00", "09:50", { id: "gab", point: gab }),
      stop("ART 4720", "11:00", "12:50", { id: "ntdp" }),
      stop("B 1", "14:00", "14:50", { id: "blb", point: blb }),
    ];
    const lookups = new Map<string, StopLookup>([
      [
        lookupKey("NTDP", "ntdp"),
        {
          kind: "unresolved",
          location: {
            location: "NTDP",
            buildingId: "ntdp",
            buildingName: "Discovery Park",
            shortName: "NTDP",
            resolutionStatus: "unresolved",
            geocodeQuery: "",
            unsupportedReason: "Outside UNT Denton main-campus routing bounds",
          },
        },
      ],
    ]);
    const { stops: entries, legs } = buildItinerary(stops, lookups, new Map());
    expect(entries.map((entry) => entry.number)).toEqual([1, 2, 3]);
    expect(entries[1].placement).toEqual({
      kind: "unresolved",
      reason: "off-campus",
      message: "Discovery Park is off the main campus, so there's no walking route to it.",
    });
    // Main campus <-> Discovery Park is the shuttle's fixed estimate, never routed on foot.
    expect(legs.map((leg) => leg.route.kind)).toEqual(["shuttle", "shuttle"]);
    expect(legs.map((leg) => leg.walkMinutes)).toEqual([20, 20]);
  });

  test("a building the registry doesn't know is unresolved as unknown", () => {
    const stops = [stop("A 1", "09:00", "09:50", { id: "zzz" })];
    const lookups = new Map<string, StopLookup>([
      [
        lookupKey("ZZZ", "zzz"),
        {
          kind: "unresolved",
          location: { location: "ZZZ", buildingId: "zzz", buildingName: "ZZZ", shortName: "ZZZ", resolutionStatus: "unresolved", geocodeQuery: "" },
        },
      ],
    ]);
    const [entry] = buildItinerary(stops, lookups, new Map()).stops;
    expect(entry.placement).toMatchObject({ kind: "unresolved", reason: "unknown" });
  });

  test("a stop still being looked up is pending, and so are its legs", () => {
    const stops = [stop("A 1", "09:00", "09:50", { id: "gab", point: gab }), stop("B 1", "10:00", "10:50", { id: "new" })];
    const { stops: entries, legs } = buildItinerary(stops, new Map(), new Map());
    expect(entries[1].placement.kind).toBe("resolving");
    expect(legs[0].route.kind).toBe("loading");
  });

  test("two classes in one building are a zero-minute leg with no leave-by", () => {
    const stops = [stop("A 1", "09:00", "09:50", { id: "gab", point: gab }), stop("B 1", "09:50", "10:40", { id: "gab", point: gab })];
    const [leg] = buildItinerary(stops, new Map(), new Map()).legs;
    expect(leg.route.kind).toBe("same-building");
    expect(leg.walkMinutes).toBe(0);
    expect(leg.leaveAt).toBeNull();
    expect(leg.transfer).toBe("ok");
  });
});

describe("the walk from the starting point", () => {
  const kerr = { name: "Kerr Hall", point: { lat: 33.2077, lng: -97.1468 } };
  const day = [stop("CSCE 2110", "09:00", "09:50", { id: "gab", point: gab }), stop("MATH 2700", "10:00", "10:50", { id: "blb", point: blb })];

  test("is the day's first leg, leaving at class start minus the walk minus two minutes", () => {
    const answers = new Map<string, PairAnswer>([[pairKey(pointKey(kerr.point), key(gab, "gab")), walkLeg(500, 640, kerr.point, gab)]]);
    const { start } = buildItinerary(day, new Map(), answers, kerr);
    expect(start?.place).toEqual(kerr);
    expect(start?.leg).toMatchObject({ fromKey: "start", toKey: "Mon-0-CSCE 2110-09:00", gapMinutes: null, walkMinutes: 9, leaveAt: 8 * 60 + 49, transfer: "ok" });
  });

  test("is loading until routing answers, and has no leave time", () => {
    const { start } = buildItinerary(day, new Map(), new Map(), kerr);
    expect(start?.leg).toMatchObject({ route: { kind: "loading" }, walkMinutes: null, leaveAt: null });
  });

  test("has no route when the first class isn't on the map", () => {
    const lookups = new Map<string, StopLookup>([[lookupKey("NOWHERE", "nowhere"), { kind: "failed" }]]);
    const { start } = buildItinerary([stop("A 1", "09:00", "09:50", { id: "nowhere" })], lookups, new Map(), kerr);
    expect(start?.leg.route).toEqual({ kind: "no-route" });
  });

  test("is the shuttle when the first class is at Discovery Park", () => {
    const { start } = buildItinerary([stop("ART 4720", "11:00", "12:50", { id: "ntdp" })], new Map(), new Map(), kerr);
    expect(start?.leg).toMatchObject({ route: { kind: "shuttle", seconds: 1200 }, walkMinutes: 20, leaveAt: 10 * 60 + 38 });
  });

  test("doesn't exist without a starting point or without classes", () => {
    expect(buildItinerary(day, new Map(), new Map()).start).toBeNull();
    expect(buildItinerary([], new Map(), new Map(), kerr).start).toBeNull();
  });

  test("is routed as its own request, ahead of the class runs", () => {
    const runs = routeRuns(buildItinerary(day, new Map(), new Map(), kerr).stops, kerr);
    expect(runs.map((run) => run.map((point) => point.key))).toEqual([
      [pointKey(kerr.point), key(gab, "gab")],
      [key(gab, "gab"), key(blb, "blb")],
    ]);
  });
});

describe("routeRuns", () => {
  test("merges repeated buildings and splits at a stop that isn't on the map", () => {
    const stops = [
      stop("A", "08:00", "08:50", { id: "gab", point: gab }),
      stop("B", "09:00", "09:50", { id: "gab", point: gab }),
      stop("C", "10:00", "10:50", { id: "blb", point: blb }),
      stop("D", "11:00", "11:50", { id: "nowhere" }),
      stop("E", "12:00", "12:50", { id: "wh", point: wh }),
      stop("F", "13:00", "13:50", { id: "gab", point: gab }),
    ];
    const lookups = new Map<string, StopLookup>([[lookupKey("NOWHERE", "nowhere"), { kind: "failed" }]]);
    const runs = routeRuns(buildItinerary(stops, lookups, new Map()).stops);
    expect(runs.map((run) => run.map((point) => point.buildingId))).toEqual([
      ["gab", "blb"],
      ["wh", "gab"],
    ]);
  });
});
