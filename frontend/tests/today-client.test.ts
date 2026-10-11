import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  clearRouteCacheForTests,
  fetchWalk,
  routeCacheKey,
  walkSummary,
} from "@/components/today/route-client";
import {
  computeTodayState,
  findNextSchoolDay,
  formatCountdown,
  toTodayStops,
  weekdayOf,
  type BuildResolver,
  type ResolvedPlace,
  type TodayStop,
} from "@/components/today/today-engine";
import {
  clearScheduleSnapshotForTests,
  formatSnapshotTime,
  loadScheduleSnapshot,
  saveScheduleSnapshot,
} from "@/components/today/offline-snapshot";
import type { ScheduleEvent } from "@/lib/types";

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

// bun:test has no DOM window; the snapshot and route-cache layers read
// window.localStorage / window.sessionStorage. Install a fresh Map-backed
// stub per test.
function makeStore() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, String(value));
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}

beforeEach(() => {
  const win = { localStorage: makeStore(), sessionStorage: makeStore() };
  (globalThis as unknown as { window?: unknown }).window = win;
  clearRouteCacheForTests();
  clearScheduleSnapshotForTests();
});

afterEach(() => {
  clearRouteCacheForTests();
  clearScheduleSnapshotForTests();
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe("normalizeRouteResponse", () => {
  test("accepts a valid ors response", () => {
    const route = computeRoute({
      distanceMeters: 1200,
      durationSeconds: 900,
      source: "ors",
      geometry: [{ lat: 33.2, lng: -97.15 }],
    });
    expect(route?.source).toBe("ors");
    expect(route?.distanceMeters).toBe(1200);
    expect(route?.geometry).toHaveLength(1);
  });

  test("keeps campus-network", () => {
    const route = computeRoute({ distanceMeters: 500, durationSeconds: 300, source: "campus-network" });
    expect(route?.source).toBe("campus-network");
  });

  test("normalizes unknown and missing sources to fallback", () => {
    expect(computeRoute({ distanceMeters: 500, source: "alien-gps" })?.source).toBe("fallback");
    expect(computeRoute({ distanceMeters: 500 })?.source).toBe("fallback");
  });

  test("rejects malformed and negative bodies", () => {
    expect(computeRoute(null)).toBeNull();
    expect(computeRoute("nope")).toBeNull();
    expect(computeRoute({})).toBeNull();
    expect(computeRoute({ distanceMeters: -5 })).toBeNull();
    expect(computeRoute({ distanceMeters: Number.NaN })).toBeNull();
    expect(computeRoute({ distanceMeters: 100, durationSeconds: -1 })).not.toBeNull();
    expect(computeRoute({ distanceMeters: 100, durationSeconds: -1 })?.durationSeconds).toBe(0);
  });
});

function computeRoute(body: unknown) {
  return normalizeRoute(body);
}

describe("routeCacheKey", () => {
  test("unresolved places produce a distinct honest key", () => {
    const a = stop();
    const unresolved = { ...a, place: null };
    expect(routeCacheKey(null, null)).toBe("walk|?|?");
    expect(routeCacheKey(a.place, unresolved.place)).toBe("walk|33.200000,-97.150000|?");
  });
});

describe("fetchWalk", () => {
  test("distinct pairs produce distinct cache keys", () => {
    const a = stop({ location: "Discovery Park" });
    const b = stop({ location: "Sage Hall" });
    const c = stop({ location: "Blanchard Hall" });
    expect(routeCacheKey(a, b)).not.toBe(routeCacheKey(a, c));
    expect(routeCacheKey(a, b).startsWith("walk|")).toBe(true);
  });

  test("HTTP errors return unavailable and are not cached", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("boom", { status: 500 });
    }) as typeof fetch;
    const from = stop();
    const to = stop({ location: "Sage Hall" });
    expect(await fetchWalk(from, to)).toEqual({ kind: "unavailable" });
    expect(await fetchWalk(from, to)).toEqual({ kind: "unavailable" });
    expect(calls).toBe(2);
  });

  test("malformed route bodies return unavailable without caching", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ nope: true }), { status: 200 });
    }) as typeof fetch;
    const from = stop();
    const to = stop({ location: "Sage Hall" });
    expect(await fetchWalk(from, to)).toEqual({ kind: "unavailable" });
    expect(calls).toBe(1);
  });

  test("network rejection returns unavailable, never throws", async () => {
    globalThis.fetch = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    const from = stop();
    const to = stop({ location: "Sage Hall" });
    expect(await fetchWalk(from, to)).toEqual({ kind: "unavailable" });
  });
});

describe("walkSummary", () => {
  test("fallback routes never claim a duration", () => {
    const summary = walkSummary({
      geometry: [],
      distanceMeters: 1200,
      durationSeconds: 0,
      source: "fallback",
    });
    expect(summary).toContain("straight-line");
    expect(summary).not.toContain("walk");
  });

  test("routed sources state the duration", () => {
    const summary = walkSummary({
      geometry: [],
      distanceMeters: 1200,
      durationSeconds: 900,
      source: "ors",
    });
    expect(summary).toContain("15 min walk");
  });
});

describe("offline snapshot", () => {
  test("round-trips a valid schedule", () => {
    const events = [event(), event({ start: "11:00", end: "11:50" })];
    expect(saveScheduleSnapshot(events)).toBe(true);
    const loaded = loadScheduleSnapshot();
    expect(loaded?.events).toHaveLength(2);
    expect(loaded?.events[1].start).toBe("11:00");
    expect(typeof loaded?.savedAt).toBe("number");
  });

  test("discards corrupted payloads instead of throwing", () => {
    window.localStorage.setItem("untangle.schedule.snapshot.v1", "{not json");
    expect(loadScheduleSnapshot()).toBeNull();
  });

  test("discards snapshots with invalid events", () => {
    const bad = [{ ...event(), start: "not-a-time" }];
    expect(saveScheduleSnapshot(bad)).toBe(false);
    expect(loadScheduleSnapshot()).toBeNull();
  });

  test("formatSnapshotTime renders zero-padded 24h time", () => {
    expect(formatSnapshotTime(new Date(2026, 9, 14, 8, 5).getTime())).toBe("saved 08:05");
  });
});

describe("client wiring math", () => {
  test("phase decision for a between-class moment", () => {
    const events = [event({ start: "09:00", end: "09:50" }), event({ start: "11:00", end: "11:50" })];
    const state = computeTodayState({
      now: new Date(2026, 9, 12, 10, 0, 0, 0),
      eventsForToday: events,
      resolve: resolver,
    });
    expect(state.phase).toBe("between");
  });

  test("week-ahead lookup with an empty week is null", () => {
    expect(findNextSchoolDay({ now: new Date(2026, 9, 14, 8, 0), stopsByDay: {} })).toBeNull();
  });

  test("formatCountdown matches engine output", () => {
    expect(formatCountdown(3600)).toBe("1 hr");
  });
});
