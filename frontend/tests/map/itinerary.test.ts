import { describe, expect, test } from "bun:test";
import {
  buildItinerary,
  formatClock,
  formatDistance,
  lookupKey,
  pairKey,
  pointKey,
  routeRuns,
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
  test("12-hour clock", () => {
    expect(formatClock("09:05")).toBe("9:05 AM");
    expect(formatClock("12:00")).toBe("12:00 PM");
    expect(formatClock("13:50")).toBe("1:50 PM");
  });
});

describe("buildItinerary", () => {
  test("a walkway leg gets minutes, a leave-by time and the late flag when the walk beats the break", () => {
    const stops = [stop("CSCE 1030", "09:00", "09:50", { id: "gab", point: gab }), stop("MATH 1710", "10:00", "10:50", { id: "blb", point: blb })];
    const answers = new Map<string, PairAnswer>([[pairKey(key(gab, "gab"), key(blb, "blb")), walkLeg(631, 820)]]);
    const { legs, summary } = buildItinerary(stops, new Map(), answers);
    expect(legs).toHaveLength(1);
    const [leg] = legs;
    expect(leg.gapMinutes).toBe(10);
    expect(leg.walkMinutes).toBe(11);
    expect(leg.leaveBy).toBe("09:49");
    expect(leg.transfer).toBe("late");
    expect(summary.tightTransfers).toBe(1);
    expect(summary.walkMinutes).toBe(11);
  });

  test("a straight-line answer shows distance only: no minutes, no leave-by, no transfer verdict", () => {
    const stops = [stop("A 1", "09:00", "09:50", { id: "gab", point: gab }), stop("B 1", "10:00", "10:50", { id: "blb", point: blb })];
    const fallback: PairAnswer = { fromIndex: 0, toIndex: 1, source: "fallback", geometry: [gab, blb], distanceMeters: 482, durationSeconds: null };
    const answers = new Map<string, PairAnswer>([[pairKey(key(gab, "gab"), key(blb, "blb")), fallback]]);
    const { legs, summary } = buildItinerary(stops, new Map(), answers);
    expect(legs[0].route).toEqual({ kind: "straight-line", meters: 482, geometry: [gab, blb] });
    expect(legs[0].walkMinutes).toBeNull();
    expect(legs[0].leaveBy).toBeNull();
    expect(legs[0].transfer).toBe("unknown");
    expect(summary.estimatedLegs).toBe(1);
    expect(summary.walkMeters).toBe(0);
  });

  test("a routing request that failed falls back to a client-side straight line", () => {
    const stops = [stop("A 1", "09:00", "09:50", { id: "gab", point: gab }), stop("B 1", "10:00", "10:50", { id: "blb", point: blb })];
    const answers = new Map<string, PairAnswer>([[pairKey(key(gab, "gab"), key(blb, "blb")), "failed"]]);
    const [leg] = buildItinerary(stops, new Map(), answers).legs;
    expect(leg.route.kind).toBe("straight-line");
    expect(leg.walkMinutes).toBeNull();
  });

  test("an off-campus stop stays in the list with its reason and breaks the walks on both sides", () => {
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
    const { stops: entries, legs, summary } = buildItinerary(stops, lookups, new Map());
    expect(entries.map((entry) => entry.number)).toEqual([1, 2, 3]);
    expect(entries[1].placement).toEqual({
      kind: "unresolved",
      reason: "off-campus",
      message: "Discovery Park is off the main campus, so there's no walking route to it.",
    });
    expect(legs.map((leg) => leg.route.kind)).toEqual(["no-route", "no-route"]);
    expect(summary.unresolved).toBe(1);
    expect(summary.mapped).toBe(2);
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
    const { stops: entries, legs, summary } = buildItinerary(stops, new Map(), new Map());
    expect(entries[1].placement.kind).toBe("resolving");
    expect(legs[0].route.kind).toBe("loading");
    expect(summary.loading).toBe(true);
  });

  test("two classes in one building are a zero-minute leg with no leave-by", () => {
    const stops = [stop("A 1", "09:00", "09:50", { id: "gab", point: gab }), stop("B 1", "09:50", "10:40", { id: "gab", point: gab })];
    const [leg] = buildItinerary(stops, new Map(), new Map()).legs;
    expect(leg.route.kind).toBe("same-building");
    expect(leg.walkMinutes).toBe(0);
    expect(leg.leaveBy).toBeNull();
    expect(leg.transfer).toBe("ok");
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
