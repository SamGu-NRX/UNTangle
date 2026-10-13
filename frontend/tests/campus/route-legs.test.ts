import { describe, expect, test } from "bun:test";
import type { CampusEngine } from "@/lib/campus/engine";
import { buildRouteLegs, summarizeRoute, type ExternalRouter } from "@/lib/campus/route-legs";

// Leg-building rules with the router injected, so no test replaces a module
// for the whole bun process. The real graph is exercised through the API in
// tests/campus-routing.test.ts.

const sage = { lat: 33.2121066, lng: -97.1467423 };
const blb = { lat: 33.2088704, lng: -97.1476988 };
const gab = { lat: 33.2131868, lng: -97.1481479 };

const disconnected: CampusEngine = { routeBetweenPoints: () => null, anchorFor: () => null };

describe("buildRouteLegs", () => {
  test("a pair the campus graph cannot connect becomes a straight line with no walking time", async () => {
    const legs = await buildRouteLegs([sage, blb], disconnected);
    expect(legs).toHaveLength(1);
    const [leg] = legs;
    expect(leg.source).toBe("fallback");
    expect(leg.durationSeconds).toBeNull();
    expect(leg.geometry).toEqual([sage, blb]);
    // Haversine between the two pins, to 0.1 m.
    expect(leg.distanceMeters).toBe(370.7);
  });

  test("the external router is tried only for legs the campus graph refuses", async () => {
    const calls: string[] = [];
    const external: ExternalRouter = async (from, to) => {
      calls.push(`${from.lat},${to.lat}`);
      return { geometry: [from, to], distanceMeters: 400, durationSeconds: 300 };
    };
    const engine: CampusEngine = {
      // Connects only the first leg.
      routeBetweenPoints: (a, b) =>
        a.lat === sage.lat
          ? {
              geometry: [a, b],
              distanceMeters: 500,
              durationSeconds: 360,
              networkDistanceMeters: 500,
              connectorDistanceMeters: 0,
              stepsMeters: 0,
              roadCrossings: 0,
              snapStart: a,
              snapEnd: b,
            }
          : null,
      anchorFor: () => null,
    };
    const legs = await buildRouteLegs([sage, blb, gab], engine, external);
    expect(legs.map((leg) => leg.source)).toEqual(["campus-network", "ors"]);
    expect(calls).toEqual([`${blb.lat},${gab.lat}`]);
    expect(legs.map((leg) => [leg.fromIndex, leg.toIndex])).toEqual([
      [0, 1],
      [1, 2],
    ]);
  });

  test("a stop naming a building routes from that building's anchor", async () => {
    const anchor = { lat: 33.2122, lng: -97.1468 };
    const seen: Array<{ lat: number; lng: number }> = [];
    const engine: CampusEngine = {
      routeBetweenPoints: (a, b) => {
        seen.push(a, b);
        return null;
      },
      anchorFor: (id) => (id === "sage" ? anchor : null),
    };
    await buildRouteLegs([{ ...sage, buildingId: "sage" }, { ...blb, buildingId: "not-in-matrix" }], engine);
    expect(seen).toEqual([anchor, blb]);
  });
});

describe("summarizeRoute", () => {
  test("one straight-line leg makes the whole route's time unknown and its source fallback", async () => {
    const engine: CampusEngine = {
      routeBetweenPoints: (a, b) =>
        a.lat === sage.lat
          ? {
              geometry: [a, gab, b],
              distanceMeters: 500,
              durationSeconds: 360,
              networkDistanceMeters: 500,
              connectorDistanceMeters: 0,
              stepsMeters: 0,
              roadCrossings: 0,
              snapStart: a,
              snapEnd: b,
            }
          : null,
      anchorFor: () => null,
    };
    const route = summarizeRoute(await buildRouteLegs([sage, blb, gab], engine));
    expect(route.source).toBe("fallback");
    expect(route.durationSeconds).toBeNull();
    // Joined geometry shares the middle stop once.
    expect(route.geometry).toEqual([sage, gab, blb, gab]);
  });

  test("all campus legs add up their times", () => {
    const route = summarizeRoute([
      { fromIndex: 0, toIndex: 1, source: "campus-network", geometry: [sage, blb], distanceMeters: 10.25, durationSeconds: 8 },
      { fromIndex: 1, toIndex: 2, source: "campus-network", geometry: [blb, gab], distanceMeters: 20, durationSeconds: 15 },
    ]);
    expect(route.source).toBe("campus-network");
    expect(route.durationSeconds).toBe(23);
    expect(route.distanceMeters).toBe(30.3);
  });

  test("refuses an empty leg list instead of inventing a route", () => {
    expect(() => summarizeRoute([])).toThrow("at least one leg");
  });
});
