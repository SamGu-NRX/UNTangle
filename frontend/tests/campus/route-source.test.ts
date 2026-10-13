import { afterAll, describe, expect, mock, test } from "bun:test";

// Handler-level contract for POST /api/map/route response `source` values.
//
// The on-campus "campus-network" tier is covered against the real graph in
// tests/campus-routing.test.ts. The committed walkway graph snaps every point
// inside untCampusBounds within the 250 m connector cap (verified by grid
// probe), so the handler can only reach its fallback tier when the campus
// graph module itself reports a disconnect — that tier is isolated here by
// stubbing the graph module before the handler is imported.

// Any ORS attempt in these tests must fail loudly. No ORS_API_KEY is set in
// the test environment, and a fetch here would mean the handler took the ORS
// tier instead of the documented no-key straight-line fallback.
const originalFetch = globalThis.fetch;
globalThis.fetch = Object.assign(
  () => Promise.reject(new Error("Network access is disabled in route-source tests")),
  { preconnect: () => {} },
);
afterAll(() => {
  globalThis.fetch = originalFetch;
});

mock.module("@/lib/campus/graph", () => ({
  routeBetweenPoints: () => null,
}));

const { POST } = await import("@/app/api/map/route/route");

function postJson(body: unknown, ip: string) {
  // Distinct IP: the route module's per-IP limiter is module-global across
  // the bun test process.
  return new Request("http://localhost/api/map/route", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

describe("map route API source contract", () => {
  test("a pair the campus network cannot connect falls back when no ORS key is set", async () => {
    const response = await POST(
      postJson(
        {
          stops: [
            { lat: 33.2121066, lng: -97.1467423 }, // Sage Hall
            { lat: 33.2088704, lng: -97.1476988 }, // Business Leadership Building
          ],
        },
        "198.51.100.77",
      ),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      source?: string;
      geometry?: Array<{ lat: number; lng: number }>;
      durationSeconds?: number;
    };
    expect(payload.source).toBe("fallback");
    expect(payload.durationSeconds).toBe(0);
    expect(payload.geometry).toHaveLength(2);
  });
});
