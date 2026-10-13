import { describe, expect, test, afterAll } from "bun:test";
import { untCampusBounds } from "@/lib/campus-locations";
import { POST as routePOST } from "@/app/api/map/route/route";
import { POST as resolvePOST } from "@/app/api/map/resolve/route";
import { TtlLruCache } from "@/lib/map-cache";
import { pinClockMidWindow, trustRealIp } from "./rate-limit/route-fixtures";

// Force the no-API-key code path and make any accidental network call fail
// loudly instead of hanging or passing silently.
delete process.env.ORS_API_KEY;
trustRealIp();
const originalFetch = globalThis.fetch;
globalThis.fetch = Object.assign(
  () => Promise.reject(new Error("Network access is disabled in map-hardening tests")),
  { preconnect: () => {} },
);
afterAll(() => {
  globalThis.fetch = originalFetch;
});

function createClock(startMs = 1_000_000) {
  let nowMs = startMs;
  return {
    now: () => nowMs,
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

function postJson(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": "198.51.100.200" },
    body: JSON.stringify(body),
  });
}

describe("TtlLruCache", () => {
  test("returns cached values until TTL expiry", () => {
    const clock = createClock();
    const cache = new TtlLruCache<string>({ maxEntries: 10, ttlMs: 1000, now: clock.now });

    cache.set("key", "value");
    expect(cache.get("key")).toBe("value");

    clock.advance(999);
    expect(cache.get("key")).toBe("value");

    clock.advance(1);
    expect(cache.get("key")).toBeUndefined();
  });

  test("evicts the least recently used entry at capacity", () => {
    const clock = createClock();
    const cache = new TtlLruCache<string>({ maxEntries: 2, ttlMs: 1000, now: clock.now });

    cache.set("a", "1");
    cache.set("b", "2");
    clock.advance(10);
    expect(cache.get("a")).toBe("1"); // refresh a, b becomes LRU

    cache.set("c", "3");
    expect(cache.get("a")).toBe("1");
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBe("3");
  });

  test("overwriting a key refreshes its recency", () => {
    const clock = createClock();
    const cache = new TtlLruCache<string>({ maxEntries: 2, ttlMs: 1000, now: clock.now });

    cache.set("a", "1");
    cache.set("b", "2");
    clock.advance(10);
    cache.set("a", "1b"); // overwrite moves a to most recent
    cache.set("c", "3");

    expect(cache.get("a")).toBe("1b");
    expect(cache.get("b")).toBeUndefined();
    expect(cache.size).toBe(2);
  });

  test("failure entries expire after the short failure TTL while successes persist", () => {
    const clock = createClock();
    const cache = new TtlLruCache<string>({
      maxEntries: 10,
      ttlMs: 60_000,
      failureTtlMs: 10_000,
      now: clock.now,
    });

    cache.set("ok", "good");
    cache.set("bad", "fallback", { failure: true });

    clock.advance(9999);
    expect(cache.get("ok")).toBe("good");
    expect(cache.get("bad")).toBe("fallback");

    clock.advance(1);
    expect(cache.get("bad")).toBeUndefined();
    expect(cache.get("ok")).toBe("good");
  });

  test("keeps failures out of the cache when failureTtlMs is 0", () => {
    const clock = createClock();
    const cache = new TtlLruCache<string>({
      maxEntries: 10,
      ttlMs: 1000,
      failureTtlMs: 0,
      now: clock.now,
    });

    cache.set("bad", "fallback", { failure: true });
    expect(cache.get("bad")).toBeUndefined();
    expect(cache.size).toBe(0);
  });
});

describe("map routes", () => {
  test("route POST allows the burst then returns 429 with the shared error shape", async () => {
    pinClockMidWindow();
    const midLat = (untCampusBounds.north + untCampusBounds.south) / 2;
    const midLng = (untCampusBounds.east + untCampusBounds.west) / 2;
    const body = {
      stops: [
        { lat: midLat, lng: midLng },
        { lat: midLat + 0.001, lng: midLng + 0.001 },
      ],
    };

    for (let index = 0; index < 60; index += 1) {
      const response = await routePOST(postJson("http://localhost/api/map/route", body));
      expect(response.status).toBe(200);
    }

    const limited = await routePOST(postJson("http://localhost/api/map/route", body));
    expect(limited.status).toBe(429);
    const payload = (await limited.json()) as { error?: string };
    expect(payload.error).toBe("Too many requests");
    expect(limited.headers.get("Retry-After")).toBeTruthy();
  });

  test("resolve POST without ORS_API_KEY returns unresolved without touching the network", async () => {
    const response = await resolvePOST(
      postJson("http://localhost/api/map/resolve", {
        locations: [{ location: "definitely not a campus building" }],
      }),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { locations?: Array<{ resolutionStatus?: string }> };
    expect(payload.locations).toHaveLength(1);
    expect(payload.locations?.[0]?.resolutionStatus).toBe("unresolved");
  });
});
