import { describe, expect, test, afterAll } from "bun:test";
import { untCampusBounds } from "@/lib/campus-locations";
import { POST as routePOST } from "@/app/api/map/route/route";
import { POST as resolvePOST } from "@/app/api/map/resolve/route";
import { SlidingWindowRateLimiter, TtlLruCache, clientIpFromRequest } from "@/lib/map-cache";

// Force the no-API-key code path and make any accidental network call fail
// loudly instead of hanging or passing silently.
delete process.env.ORS_API_KEY;
process.env.RATE_LIMIT_TRUSTED_PROXY = "reverse-proxy";
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

describe("SlidingWindowRateLimiter", () => {
  test("allows the burst then denies with a retry-after hint", () => {
    const clock = createClock();
    const limiter = new SlidingWindowRateLimiter({ windowMs: 1000, maxRequests: 3, now: clock.now });

    expect(limiter.check("ip").allowed).toBe(true);
    expect(limiter.check("ip").allowed).toBe(true);
    expect(limiter.check("ip").allowed).toBe(true);

    const denied = limiter.check("ip");
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBe(1);
  });

  test("recovers after the window passes", () => {
    const clock = createClock();
    const limiter = new SlidingWindowRateLimiter({ windowMs: 1000, maxRequests: 2, now: clock.now });

    limiter.check("ip");
    limiter.check("ip");
    expect(limiter.check("ip").allowed).toBe(false);

    clock.advance(1000);
    const recovered = limiter.check("ip");
    expect(recovered.allowed).toBe(true);
    expect(recovered.retryAfterSeconds).toBe(0);
  });

  test("denied requests do not extend the block", () => {
    const clock = createClock();
    const limiter = new SlidingWindowRateLimiter({ windowMs: 1000, maxRequests: 2, now: clock.now });

    limiter.check("ip");
    limiter.check("ip");
    expect(limiter.check("ip").allowed).toBe(false);

    clock.advance(500);
    expect(limiter.check("ip").allowed).toBe(false);

    clock.advance(500);
    expect(limiter.check("ip").allowed).toBe(true);
  });

  test("prunes stale keys and caps the number of tracked keys", () => {
    const clock = createClock();
    const limiter = new SlidingWindowRateLimiter({
      windowMs: 1000,
      maxRequests: 5,
      maxTrackedKeys: 3,
      now: clock.now,
    });

    for (const key of ["a", "b", "c", "d", "e"]) {
      limiter.check(key);
    }
    expect(limiter.trackedKeys).toBe(3);

    clock.advance(2000); // everything from t=0 is now stale
    limiter.check("fresh");
    expect(limiter.trackedKeys).toBe(1);
  });
});

describe("clientIpFromRequest", () => {
  test("prefers the first forwarded hop, then x-real-ip, then the shared bucket", () => {
    const forwarded = new Request("https://example.test/", {
      headers: { "x-forwarded-for": "203.0.113.7, 70.41.3.2" },
    });
    expect(clientIpFromRequest(forwarded)).toBe("203.0.113.7");

    const realIp = new Request("https://example.test/", { headers: { "x-real-ip": "198.51.100.9" } });
    expect(clientIpFromRequest(realIp)).toBe("198.51.100.9");

    expect(clientIpFromRequest(new Request("https://example.test/"))).toBe("unknown");
  });
});

describe("map routes", () => {
  test("route POST allows the burst then returns 429 with the shared error shape", async () => {
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
