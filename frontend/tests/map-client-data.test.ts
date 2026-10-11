import { describe, expect, test } from "bun:test";
import {
  RESOLVE_FAILURE_TTL_MS,
  ROUTE_FAILURE_TTL_MS,
  createMapDataCaches,
  fetchRouteWithCache,
  planResolveQueue,
  resolveStopsWithCache,
  routeKeyForStops,
  stopLocationKey,
  type MapDataCaches,
} from "@/lib/map-client-data";
import type { MapResolvedLocation, MapResolutionStatus, MapStop } from "@/lib/types";

function makeStop(overrides: Partial<MapStop> & Pick<MapStop, "location">): MapStop {
  return {
    courseCode: "CSCE 1010",
    title: "Test course",
    buildingName: overrides.location,
    shortName: overrides.location.slice(0, 6),
    resolutionStatus: "unresolved",
    geocodeQuery: `query ${overrides.location}`,
    day: "Mon",
    start: "09:00",
    end: "09:50",
    ...overrides,
  } as MapStop;
}

function makeEcho(
  location: string,
  lat: number,
  lng: number,
  options: { buildingId?: string; status?: MapResolutionStatus } = {},
): MapResolvedLocation {
  return {
    location,
    buildingId: options.buildingId,
    buildingName: `${location} Hall`,
    shortName: location.slice(0, 6),
    ...(options.status === "unresolved" ? {} : { lat, lng }),
    resolutionStatus: options.status ?? "local",
    geocodeQuery: `query ${location}`,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function abortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

function scriptedFetch(
  responder: (attempt: number) => Response | Promise<Response>,
): { fetchImpl: typeof fetch; calls: () => number } {
  let attempts = 0;
  const fetchImpl = (async () => {
    attempts += 1;
    return responder(attempts);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls: () => attempts };
}

const TERRACE = makeStop({ location: "Terrace Hall" });
const SAGE = makeStop({ location: "Sage Hall" });
const WILLIS = makeStop({ location: "Willis Library" });

describe("resolve identity matching", () => {
  test("matches echoed results by identity even when the server reorders them", async () => {
    const caches = createMapDataCaches();
    const stops = [TERRACE, SAGE, WILLIS];
    // Deliberately scrambled relative to the request order.
    const echoes = [
      makeEcho("Willis Library", 33.21, -97.15),
      makeEcho("Terrace Hall", 33.2, -97.11),
      makeEcho("Sage Hall", 33.21, -97.13),
    ];
    const { fetchImpl } = scriptedFetch(() => jsonResponse({ locations: echoes }));

    const snapshot = await resolveStopsWithCache(stops, caches, { fetchImpl });

    expect(snapshot[stopLocationKey(TERRACE)]?.lat).toBeCloseTo(33.2);
    expect(snapshot[stopLocationKey(TERRACE)]?.lng).toBeCloseTo(-97.11);
    expect(snapshot[stopLocationKey(SAGE)]?.lat).toBeCloseTo(33.21);
    expect(snapshot[stopLocationKey(SAGE)]?.lng).toBeCloseTo(-97.13);
    expect(snapshot[stopLocationKey(WILLIS)]?.lat).toBeCloseTo(33.21);
    expect(snapshot[stopLocationKey(WILLIS)]?.lng).toBeCloseTo(-97.15);
    expect(caches.resolveFailures.size).toBe(0);
  });

  test("a stop with no trustworthy echo is a retryable miss, not a corrupted match", async () => {
    const caches = createMapCaches();
    const nowMs = 1_000_000;
    const now = () => nowMs;
    // The server only echoes Terrace; the other two stops get nothing usable.
    const { fetchImpl } = scriptedFetch(() =>
      jsonResponse({ locations: [makeEcho("Terrace Hall", 33.2, -97.11)] }),
    );

    const snapshot = await resolveStopsWithCache([TERRACE, SAGE, WILLIS], caches, {
      fetchImpl,
      now,
    });

    expect(snapshot[stopLocationKey(TERRACE)]?.lat).toBeCloseTo(33.2);
    expect(snapshot[stopLocationKey(SAGE)]).toBeUndefined();
    expect(snapshot[stopLocationKey(WILLIS)]).toBeUndefined();
    expect(caches.resolutions.has(stopLocationKey(SAGE))).toBe(false);
    expect(caches.resolveFailures.has(stopLocationKey(SAGE))).toBe(true);
    expect(caches.resolveFailures.has(stopLocationKey(WILLIS))).toBe(true);
    // A resolved stop is never marked failed.
    expect(caches.resolveFailures.has(stopLocationKey(TERRACE))).toBe(false);

    // Within the failure TTL the missing stops are not re-requested.
    const queued = planResolveQueue([SAGE, WILLIS], caches, nowMs + RESOLVE_FAILURE_TTL_MS - 1);
    expect(queued).toHaveLength(0);

    // After the TTL they are queued again.
    const queuedLater = planResolveQueue([SAGE, WILLIS], caches, nowMs + RESOLVE_FAILURE_TTL_MS + 1);
    expect(queuedLater).toHaveLength(2);
    void nowMs;
  });

  test("a hard outage stamps failures, skips refetching during the TTL, then recovers", async () => {
    const caches = createMapCaches();
    let nowMs = 2_000_000;
    const now = () => nowMs;
    const { fetchImpl, calls } = scriptedFetch((attempt) => {
      if (attempt === 1) {
        throw new Error("network down");
      }
      return jsonResponse({
        locations: [makeEcho("Terrace Hall", 33.2, -97.11), makeEcho("Sage Hall", 33.21, -97.13)],
      });
    });

    await expect(
      resolveStopsWithCache([TERRACE, SAGE], caches, { fetchImpl, now }),
    ).rejects.toThrow();
    expect(caches.resolutions.size).toBe(0);
    expect(caches.resolveFailures.get(stopLocationKey(TERRACE))).toBe(nowMs);

    // Outage memory: no new fetch while the TTL holds.
    nowMs += RESOLVE_FAILURE_TTL_MS - 1;
    const snapshotDuringOutage = await resolveStopsWithCache([TERRACE, SAGE], caches, {
      fetchImpl,
      now,
    });
    expect(calls()).toBe(1);
    expect(Object.keys(snapshotDuringOutage)).toHaveLength(0);

    // Recovery: after the TTL the same stops resolve and stick.
    nowMs += 2;
    const snapshotAfterRecovery = await resolveStopsWithCache([TERRACE, SAGE], caches, {
      fetchImpl,
      now,
    });
    expect(calls()).toBe(2);
    expect(snapshotAfterRecovery[stopLocationKey(TERRACE)]?.lat).toBeCloseTo(33.2);
    expect(caches.resolveFailures.size).toBe(0);
  });

  test("a definitive unresolved echo is cached as an answer, never retried", async () => {
    const caches = createMapCaches();
    const { fetchImpl, calls } = scriptedFetch(() =>
      jsonResponse({
        locations: [makeEcho("Discovery Park", 0, 0, { status: "unresolved" })],
      }),
    );

    const snapshot = await resolveStopsWithCache(
      [makeStop({ location: "Discovery Park" })],
      caches,
      { fetchImpl },
    );

    expect(snapshot[stopLocationKey(makeStop({ location: "Discovery Park" }))]).toBeNull();
    expect(caches.resolutions.get(stopLocationKey(makeStop({ location: "Discovery Park" })))).toBeNull();
    expect(caches.resolveFailures.size).toBe(0);

    await resolveStopsWithCache([makeStop({ location: "Discovery Park" })], caches, { fetchImpl });
    expect(calls()).toBe(1);
  });
});

describe("resolve abort and staleness", () => {
  test("an aborted resolve writes nothing into the caches", async () => {
    const caches = createMapCaches();
    const controller = new AbortController();
    const { fetchImpl } = scriptedFetch(() => {
      controller.abort();
      throw abortError();
    });

    await expect(
      resolveStopsWithCache([TERRACE, SAGE], caches, { fetchImpl, signal: controller.signal }),
    ).rejects.toThrow();
    expect(caches.resolutions.size).toBe(0);
    expect(caches.resolveFailures.size).toBe(0);
  });

  test("a late response for a superseded day does not contaminate the next day", async () => {
    const caches = createMapCaches();
    const nowMs = 3_000_000;
    const now = () => nowMs;

    const mondayController = new AbortController();
    let settleMonday!: (response: Response) => void;
    const mondayResponse = new Promise<Response>((resolve) => {
      settleMonday = resolve;
    });
    const mondayFetch = (async () => mondayResponse) as unknown as typeof fetch;

    // Monday resolve starts and hangs.
    const mondayPending = resolveStopsWithCache([TERRACE], caches, {
      fetchImpl: mondayFetch,
      now,
      signal: mondayController.signal,
    });

    // Tuesday resolves successfully while Monday is still in flight.
    const tuesday = makeStop({ location: "Sage Hall", day: "Tue" });
    const { fetchImpl: tuesdayFetch } = scriptedFetch(() =>
      jsonResponse({ locations: [makeEcho("Sage Hall", 33.21, -97.13)] }),
    );
    const tuesdaySnapshot = await resolveStopsWithCache([tuesday], caches, {
      fetchImpl: tuesdayFetch,
      now,
    });
    expect(tuesdaySnapshot[stopLocationKey(tuesday)]?.lat).toBeCloseTo(33.21);

    // The user switches back: Monday is aborted, but the server responds late.
    mondayController.abort();
    settleMonday(jsonResponse({ locations: [makeEcho("Terrace Hall", 33.2, -97.11)] }));
    await expect(mondayPending).rejects.toThrow();

    expect(caches.resolutions.size).toBe(1);
    expect(caches.resolutions.has(stopLocationKey(tuesday))).toBe(true);
    expect(caches.resolutions.has(stopLocationKey(TERRACE))).toBe(false);
  });
});

describe("route cache semantics", () => {
  const STOPS = [
    { lat: 33.2, lng: -97.11 },
    { lat: 33.21, lng: -97.13 },
  ];

  test("a successful route is cached and refetched never within the session", async () => {
    const caches = createMapCaches();
    const { fetchImpl, calls } = scriptedFetch(() =>
      jsonResponse({
        geometry: [
          { lat: 33.2, lng: -97.11 },
          { lat: 33.205, lng: -97.12 },
          { lat: 33.21, lng: -97.13 },
        ],
        distanceMeters: 1500,
        durationSeconds: 1080,
        source: "ors",
      }),
    );

    const route = await fetchRouteWithCache(STOPS, caches, { fetchImpl });
    expect(route?.source).toBe("ors");
    expect(route?.distanceMeters).toBe(1500);
    expect(route?.positions).toHaveLength(3);

    const second = await fetchRouteWithCache(STOPS, caches, { fetchImpl });
    expect(second?.source).toBe("ors");
    expect(calls()).toBe(1);
  });

  test("a failed route is not cached permanently: retried after the TTL, recovers", async () => {
    const caches = createMapCaches();
    let nowMs = 4_000_000;
    const now = () => nowMs;
    const { fetchImpl, calls } = scriptedFetch((attempt) => {
      if (attempt < 2) {
        throw new Error("routing down");
      }
      return jsonResponse({
        geometry: [
          { lat: 33.2, lng: -97.11 },
          { lat: 33.21, lng: -97.13 },
        ],
        distanceMeters: 1200,
        durationSeconds: 900,
        source: "ors",
      });
    });

    expect(await fetchRouteWithCache(STOPS, caches, { fetchImpl, now })).toBeNull();
    expect(caches.routes.size).toBe(0);
    expect(caches.routeFailures.has(routeKeyForStops(STOPS))).toBe(true);

    nowMs += ROUTE_FAILURE_TTL_MS - 1;
    expect(await fetchRouteWithCache(STOPS, caches, { fetchImpl, now })).toBeNull();
    expect(calls()).toBe(1);

    nowMs += 2;
    const recovered = await fetchRouteWithCache(STOPS, caches, { fetchImpl, now });
    expect(calls()).toBe(2);
    expect(recovered?.source).toBe("ors");
    expect(caches.routeFailures.size).toBe(0);
  });

  test("a malformed route payload counts as a failure, not a success", async () => {
    const caches = createMapCaches();
    const { fetchImpl, calls } = scriptedFetch(() =>
      jsonResponse({ geometry: [{ lat: 33.2, lng: Number.NaN }], distanceMeters: 1, durationSeconds: 1, source: "ors" }),
    );

    expect(await fetchRouteWithCache(STOPS, caches, { fetchImpl })).toBeNull();
    expect(caches.routes.size).toBe(0);
    expect(caches.routeFailures.size).toBe(1);

    // A server-said fallback route with valid geometry IS a cacheable answer.
    const fallbackCaches = createMapCaches();
    const { fetchImpl: fallbackFetch } = scriptedFetch(() =>
      jsonResponse({
        geometry: [
          { lat: 33.2, lng: -97.11 },
          { lat: 33.21, lng: -97.13 },
        ],
        distanceMeters: 1300,
        durationSeconds: 0,
        source: "fallback",
      }),
    );
    const fallback = await fetchRouteWithCache(STOPS, fallbackCaches, { fetchImpl: fallbackFetch });
    expect(fallback?.source).toBe("fallback");
    expect(fallbackCaches.routes.size).toBe(1);
    void calls;
  });

  test("an aborted route request writes nothing into the caches", async () => {
    const caches = createMapCaches();
    const controller = new AbortController();
    const { fetchImpl } = scriptedFetch(() => {
      controller.abort();
      throw abortError();
    });

    await expect(
      fetchRouteWithCache(STOPS, caches, { fetchImpl, signal: controller.signal }),
    ).rejects.toThrow();
    expect(caches.routes.size).toBe(0);
    expect(caches.routeFailures.size).toBe(0);
  });
});

function createMapCaches(): MapDataCaches {
  return createMapDataCaches();
}
