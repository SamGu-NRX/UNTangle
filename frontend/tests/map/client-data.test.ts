import { describe, expect, test } from "bun:test";
import {
  FALLBACK_ROUTE_TTL_MS,
  LOOKUP_FAILURE_TTL_MS,
  ROUTE_FAILURE_TTL_MS,
  createMapDataCache,
  fetchRun,
  lookUpStops,
  lookupSnapshot,
  nextAttemptDelay,
  pairAnswers,
  planLookups,
  planRuns,
  type RunPoint,
} from "@/lib/map-client-data";
import { lookupKey, pairKey } from "@/lib/map-itinerary";
import type { MapStop } from "@/lib/types";

function unplacedStop(location: string, buildingId?: string): MapStop {
  return {
    courseCode: "ART 1",
    title: "t",
    location,
    buildingId,
    buildingName: location,
    shortName: location,
    resolutionStatus: "unresolved",
    geocodeQuery: "",
    day: "Mon",
    start: "09:00",
    end: "09:50",
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function fakeFetch(handler: (body: unknown) => Response | Promise<Response>): typeof fetch {
  return (async (_url: RequestInfo | URL, init?: RequestInit) => handler(JSON.parse(String(init?.body)))) as typeof fetch;
}

const run: RunPoint[] = [
  { key: "gab@1", point: { lat: 33.2131868, lng: -97.1481479 }, buildingId: "gab" },
  { key: "blb@2", point: { lat: 33.2088704, lng: -97.1476988 }, buildingId: "blb" },
];

function legsBody(source: "campus-network" | "fallback") {
  return {
    legs: [
      {
        fromIndex: 0,
        toIndex: 1,
        source,
        geometry: [run[0].point, run[1].point],
        distanceMeters: 500,
        durationSeconds: source === "fallback" ? null : 400,
      },
    ],
  };
}

describe("building lookup", () => {
  test("answers are matched by the identity the server echoes, not by position", async () => {
    const cache = createMapDataCache();
    const queue = [unplacedStop("Discovery Park", "ntdp"), unplacedStop("Mystery Hall")];
    const fetchImpl = fakeFetch(() =>
      jsonResponse({
        // Reversed order on purpose.
        locations: [
          { location: "Mystery Hall", buildingName: "Mystery Hall", shortName: "Mystery Hall", resolutionStatus: "unresolved", geocodeQuery: "" },
          {
            location: "Discovery Park",
            buildingId: "ntdp",
            buildingName: "Discovery Park",
            shortName: "NTDP",
            resolutionStatus: "unresolved",
            geocodeQuery: "",
            unsupportedReason: "Outside UNT Denton main-campus routing bounds",
          },
        ],
      }),
    );
    await lookUpStops(queue, cache, { fetchImpl, now: () => 0 });
    const ntdp = cache.lookups.get(lookupKey("Discovery Park", "ntdp"));
    expect(ntdp?.kind).toBe("unresolved");
    expect(ntdp?.location.unsupportedReason).toBeTruthy();
    expect(cache.lookups.get(lookupKey("Mystery Hall"))?.location.unsupportedReason).toBeUndefined();
  });

  test("a stop with no matching echo is a short-lived failure, then retried", async () => {
    const cache = createMapDataCache();
    const queue = [unplacedStop("Mystery Hall")];
    await lookUpStops(queue, cache, { fetchImpl: fakeFetch(() => jsonResponse({ locations: [] })), now: () => 1000 });
    expect(lookupSnapshot(cache).get(lookupKey("Mystery Hall"))).toEqual({ kind: "failed" });
    expect(planLookups(queue, cache, 1000 + LOOKUP_FAILURE_TTL_MS - 1)).toHaveLength(0);
    expect(planLookups(queue, cache, 1000 + LOOKUP_FAILURE_TTL_MS)).toHaveLength(1);
  });

  test("a transport failure stamps every queued stop and rethrows", async () => {
    const cache = createMapDataCache();
    const queue = [unplacedStop("A"), unplacedStop("B")];
    await expect(lookUpStops(queue, cache, { fetchImpl: fakeFetch(() => jsonResponse({}, 503)), now: () => 5 })).rejects.toThrow("503");
    expect([...cache.lookupFailures.values()]).toEqual([5, 5]);
  });

  test("an aborted lookup writes nothing", async () => {
    const cache = createMapDataCache();
    const controller = new AbortController();
    const fetchImpl = fakeFetch(() => {
      controller.abort();
      return jsonResponse({ locations: [] });
    });
    await expect(lookUpStops([unplacedStop("A")], cache, { fetchImpl, signal: controller.signal })).rejects.toThrow();
    expect(cache.lookups.size + cache.lookupFailures.size).toBe(0);
  });
});

describe("walking routes", () => {
  test("a walkway answer is cached for the session and mapped to its pair", async () => {
    const cache = createMapDataCache();
    expect(await fetchRun(run, cache, { fetchImpl: fakeFetch(() => jsonResponse(legsBody("campus-network"))), now: () => 0 })).toBe(true);
    const answer = pairAnswers([run], cache).get(pairKey("gab@1", "blb@2"));
    expect(answer).toMatchObject({ source: "campus-network", durationSeconds: 400 });
    expect(planRuns([run], cache, 10 * 60 * 60 * 1000)).toHaveLength(0);
  });

  test("a straight-line answer expires so a recovered router can replace it, but keeps showing meanwhile", async () => {
    const cache = createMapDataCache();
    await fetchRun(run, cache, { fetchImpl: fakeFetch(() => jsonResponse(legsBody("fallback"))), now: () => 0 });
    expect(planRuns([run], cache, FALLBACK_ROUTE_TTL_MS - 1)).toHaveLength(0);
    expect(planRuns([run], cache, FALLBACK_ROUTE_TTL_MS)).toHaveLength(1);
    expect(pairAnswers([run], cache).get(pairKey("gab@1", "blb@2"))).toMatchObject({ source: "fallback" });
  });

  test("a fallback leg that claims a walking time is rejected as malformed", async () => {
    const cache = createMapDataCache();
    const body = legsBody("fallback");
    (body.legs[0] as { durationSeconds: number | null }).durationSeconds = 300;
    expect(await fetchRun(run, cache, { fetchImpl: fakeFetch(() => jsonResponse(body)), now: () => 7 })).toBe(false);
    expect(cache.runs.size).toBe(0);
    expect(pairAnswers([run], cache).get(pairKey("gab@1", "blb@2"))).toBe("failed");
  });

  test("an answer with the wrong number of legs is a failure, retried after the window", async () => {
    const cache = createMapDataCache();
    expect(await fetchRun(run, cache, { fetchImpl: fakeFetch(() => jsonResponse({ legs: [] })), now: () => 100 })).toBe(false);
    expect(planRuns([run], cache, 100 + ROUTE_FAILURE_TTL_MS - 1)).toHaveLength(0);
    expect(planRuns([run], cache, 100 + ROUTE_FAILURE_TTL_MS)).toHaveLength(1);
  });

  test("an aborted route request writes nothing", async () => {
    const cache = createMapDataCache();
    const controller = new AbortController();
    const fetchImpl = fakeFetch(() => {
      controller.abort();
      return jsonResponse(legsBody("campus-network"));
    });
    await expect(fetchRun(run, cache, { fetchImpl, signal: controller.signal })).rejects.toThrow();
    expect(cache.runs.size + cache.runFailures.size).toBe(0);
  });

  test("the request names each stop's building so the server can use its entrance", async () => {
    const cache = createMapDataCache();
    let sent: unknown = null;
    await fetchRun(run, cache, {
      fetchImpl: fakeFetch((body) => {
        sent = body;
        return jsonResponse(legsBody("campus-network"));
      }),
    });
    expect(sent).toEqual({
      stops: [
        { lat: 33.2131868, lng: -97.1481479, buildingId: "gab" },
        { lat: 33.2088704, lng: -97.1476988, buildingId: "blb" },
      ],
    });
  });
});

describe("retryable lookups", () => {
  test("a geocoder failure the server marks retryable expires instead of being remembered as unresolved", async () => {
    const cache = createMapDataCache();
    const queue = [unplacedStop("Mystery Hall")];
    const fetchImpl = fakeFetch(() =>
      jsonResponse({
        locations: [
          {
            location: "Mystery Hall",
            buildingName: "Mystery Hall",
            shortName: "Mystery Hall",
            resolutionStatus: "unresolved",
            geocodeQuery: "",
            retryable: true,
          },
        ],
      }),
    );
    await lookUpStops(queue, cache, { fetchImpl, now: () => 1000 });
    expect(cache.lookups.has(lookupKey("Mystery Hall"))).toBe(false);
    expect(lookupSnapshot(cache).get(lookupKey("Mystery Hall"))).toEqual({ kind: "failed" });
    expect(planLookups(queue, cache, 1000 + LOOKUP_FAILURE_TTL_MS)).toHaveLength(1);
  });
});

describe("nextAttemptDelay", () => {
  test("nothing to wait for", () => {
    expect(nextAttemptDelay([], [run], createMapDataCache(), 0)).toBeNull();
  });

  test("a straight-line answer waits for its expiry", () => {
    const cache = createMapDataCache();
    cache.runs.set("gab@1|blb@2", { legs: legsBody("fallback").legs as never, cachedAt: 0 });
    expect(nextAttemptDelay([], [run], cache, 10_000)).toBe(FALLBACK_ROUTE_TTL_MS - 10_000);
  });

  test("an expired straight-line answer whose re-ask failed waits out the failure cooldown, never zero", () => {
    // The outage case: the fallback expired, the re-ask failed. Its expiry
    // is in the past, which used to schedule a zero-delay loop.
    const cache = createMapDataCache();
    const now = FALLBACK_ROUTE_TTL_MS + 30_000;
    cache.runs.set("gab@1|blb@2", { legs: legsBody("fallback").legs as never, cachedAt: 0 });
    cache.runFailures.set("gab@1|blb@2", now);
    expect(nextAttemptDelay([], [run], cache, now)).toBe(ROUTE_FAILURE_TTL_MS);
  });

  test("anything already due waits one cooldown", () => {
    const cache = createMapDataCache();
    cache.runs.set("gab@1|blb@2", { legs: legsBody("fallback").legs as never, cachedAt: 0 });
    expect(nextAttemptDelay([], [run], cache, FALLBACK_ROUTE_TTL_MS * 5)).toBe(ROUTE_FAILURE_TTL_MS);
  });

  test("a lookup failure waits out its own window", () => {
    const cache = createMapDataCache();
    cache.lookupFailures.set("k", 1000);
    expect(nextAttemptDelay(["k"], [], cache, 3000)).toBe(LOOKUP_FAILURE_TTL_MS - 2000);
  });
});
