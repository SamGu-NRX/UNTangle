import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  fetchDayLegs,
  normalizeLegSource,
  resetLabLegCache,
  setLabLegClock,
  summarizeDayLegs,
} from "@/lib/lab/leg-routing";
import type { LabLeg } from "@/lib/lab/leg-routing";
import type { MapStop } from "@/lib/types";

const WORDS = [
  "alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel",
  "india", "juliet", "kilo", "lima", "mike", "november", "oscar",
];

function stop(overrides: Partial<MapStop> & { id: string }): MapStop {
  const { id, buildingId, location, ...rest } = overrides;
  const n = Number(id) % WORDS.length;
  return {
    courseCode: "CSCE 1010",
    shortName: "CSCE",
    location: location ?? WORDS[n] + " hall",
    buildingId: buildingId ?? WORDS[n],
    buildingName: "Building " + id,
    start: "09:00",
    end: "09:50",
    lat: 33.2119,
    lng: -97.1519,
    resolutionStatus: "local",
    ...rest,
  } as MapStop;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let now = 0;

beforeEach(() => {
  now = 0;
  resetLabLegCache();
  setLabLegClock(() => now);
});

afterEach(() => {
  setLabLegClock(() => Date.now());
});

describe("normalizeLegSource", () => {
  test("passes through known walking sources and fallback", () => {
    expect(normalizeLegSource("ors")).toBe("ors");
    expect(normalizeLegSource("campus-network")).toBe("campus-network");
    expect(normalizeLegSource("fallback")).toBe("fallback");
  });

  test("treats unknown sources as fallback", () => {
    expect(normalizeLegSource("mystery")).toBe("fallback");
    expect(normalizeLegSource(undefined)).toBe("fallback");
    expect(normalizeLegSource(42)).toBe("fallback");
  });
});

describe("fetchDayLegs", () => {
  test("requests one leg per consecutive pair", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return jsonResponse({
        geometry: [
          { lat: 33.2, lng: -97.15 },
          { lat: 33.21, lng: -97.15 },
        ],
        distanceMeters: 800,
        durationSeconds: 600,
        source: "campus-network",
      });
    };
    const stops = [
      stop({ id: "1", lat: 33.21 }),
      stop({ id: "2", lat: 33.22 }),
      stop({ id: "3", lat: 33.23 }),
    ];
    const result = await fetchDayLegs(stops, { fetchImpl });
    expect(result.requestsMade).toBe(2);
    expect(calls).toBe(2);
    expect(result.legs[0]?.status).toBe("walking");
    expect(result.legs[0]?.source).toBe("campus-network");
    expect(result.legs[0]?.durationSeconds).toBe(600);
  });

  test("posts exactly two stops per pair request", async () => {
    const bodies: Array<{ stops: unknown[] }> = [];
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as { stops: unknown[] });
      return jsonResponse({
        geometry: [
          { lat: 1, lng: 2 },
          { lat: 3, lng: 4 },
        ],
        distanceMeters: 10,
        durationSeconds: 10,
        source: "ors",
      });
    };
    await fetchDayLegs([stop({ id: "1" }), stop({ id: "2" })], { fetchImpl });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.stops).toHaveLength(2);
  });

  test("caches stable sources for the session", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return jsonResponse({
        geometry: [
          { lat: 1, lng: 2 },
          { lat: 3, lng: 4 },
        ],
        distanceMeters: 10,
        durationSeconds: 10,
        source: "campus-network",
      });
    };
    const stops = [stop({ id: "1" }), stop({ id: "2" })];
    await fetchDayLegs(stops, { fetchImpl });
    const again = await fetchDayLegs(stops, { fetchImpl });
    expect(calls).toBe(1);
    expect(again.requestsMade).toBe(0);
  });

  test("re-requests fallback routes after the brief cache window", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return jsonResponse({
        geometry: [
          { lat: 1, lng: 2 },
          { lat: 3, lng: 4 },
        ],
        distanceMeters: 10,
        durationSeconds: 0,
        source: "fallback",
      });
    };
    const stops = [stop({ id: "1" }), stop({ id: "2" })];
    await fetchDayLegs(stops, { fetchImpl });
    now = 30_000;
    await fetchDayLegs(stops, { fetchImpl });
    expect(calls).toBe(1);
    now = 61_000;
    await fetchDayLegs(stops, { fetchImpl });
    expect(calls).toBe(2);
  });

  test("fallback results never carry a time", async () => {
    const fetchImpl = async () =>
      jsonResponse({
        geometry: [
          { lat: 1, lng: 2 },
          { lat: 3, lng: 4 },
        ],
        distanceMeters: 10,
        durationSeconds: 0,
        source: "fallback",
      });
    const result = await fetchDayLegs([stop({ id: "1" }), stop({ id: "2" })], { fetchImpl });
    expect(result.legs[0]?.status).toBe("approximate");
    expect(result.legs[0]?.durationSeconds).toBeNull();
  });

  test("request errors become approximate straight-line legs", async () => {
    const fetchImpl = async () => {
      throw new Error("offline");
    };
    const result = await fetchDayLegs([stop({ id: "1" }), stop({ id: "2", lat: 33.23 })], { fetchImpl });
    expect(result.legs[0]?.status).toBe("approximate");
    expect(result.legs[0]?.source).toBe("fallback");
    expect(result.legs[0]?.durationSeconds).toBeNull();
    expect(result.legs[0]?.distanceMeters ?? 0).toBeGreaterThan(0);
  });

  test("same-building pairs skip the network", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return jsonResponse({ geometry: [], distanceMeters: 0, durationSeconds: 0, source: "ors" });
    };
    const stops = [
      stop({ id: "1", buildingId: "GAB", location: "General Academic Building" }),
      stop({ id: "2", buildingId: "GAB", location: "GAB 125" }),
    ];
    const result = await fetchDayLegs(stops, { fetchImpl });
    expect(calls).toBe(0);
    expect(result.requestsMade).toBe(0);
    expect(result.legs[0]?.status).toBe("same-building");
  });

  test("unresolved stops skip the network and are flagged", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return jsonResponse({ geometry: [], distanceMeters: 0, durationSeconds: 0, source: "ors" });
    };
    const stops = [stop({ id: "1", lat: undefined, lng: undefined }), stop({ id: "2" })];
    const result = await fetchDayLegs(stops, { fetchImpl });
    expect(calls).toBe(0);
    expect(result.legs[0]?.status).toBe("unresolved");
  });

  test("a twelve-stop day stays within eleven requests", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return jsonResponse({
        geometry: [
          { lat: 1, lng: 2 },
          { lat: 3, lng: 4 },
        ],
        distanceMeters: 10,
        durationSeconds: 10,
        source: "ors",
      });
    };
    const stops = Array.from({ length: 12 }, (_, i) =>
      stop({ id: String(i), lat: 33.2 + i * 0.001, lng: -97.15 - i * 0.001 }),
    );
    const result = await fetchDayLegs(stops, { fetchImpl });
    expect(result.requestsMade).toBe(11);
    expect(calls).toBe(11);
  });
});

describe("summarizeDayLegs", () => {
  test("totals distance and counts statuses", () => {
    const legs = [
      {
        from: stop({ id: "1" }),
        to: stop({ id: "2" }),
        status: "walking",
        source: "campus-network",
        geometry: [],
        distanceMeters: 400,
        durationSeconds: 300,
      },
      {
        from: stop({ id: "2" }),
        to: stop({ id: "3" }),
        status: "same-building",
        source: null,
        geometry: [],
        distanceMeters: 0,
        durationSeconds: null,
      },
      {
        from: stop({ id: "3" }),
        to: stop({ id: "4" }),
        status: "approximate",
        source: "fallback",
        geometry: [],
        distanceMeters: 120,
        durationSeconds: null,
      },
    ] as LabLeg[];
    const summary = summarizeDayLegs(legs);
    expect(summary.totalDistanceMeters).toBe(520);
    expect(summary.walkingLegs).toBe(1);
    expect(summary.sameBuildingLegs).toBe(1);
    expect(summary.approximateLegs).toBe(1);
    expect(summary.knownWalkingSeconds).toBe(300);
  });
});
