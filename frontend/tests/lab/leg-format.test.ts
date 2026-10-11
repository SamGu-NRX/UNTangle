import { describe, expect, test } from "bun:test";
import { dayLegNotice, formatMeters, formatWalkingMinutes, pickLongestLeg } from "@/lib/lab/leg-format";
import type { LabLeg } from "@/lib/lab/leg-routing";
import type { MapStop } from "@/lib/types";

function stop(id: string): MapStop {
  return {
    courseCode: "CSCE 1010",
    shortName: "CSCE " + id,
    location: "Building " + id,
    buildingId: "BLDG-" + id,
    buildingName: "Building " + id,
    start: "09:00",
    end: "09:50",
    lat: 33.2,
    lng: -97.15,
    resolutionStatus: "local",
  } as MapStop;
}

function leg(overrides: Partial<LabLeg> & { status: LabLeg["status"]; distanceMeters: number }): LabLeg {
  return {
    from: stop("A"),
    to: stop("B"),
    source: overrides.status === "approximate" ? "fallback" : "ors",
    geometry: [],
    durationSeconds: overrides.status === "approximate" ? null : 300,
    ...overrides,
  } as LabLeg;
}

describe("formatMeters", () => {
  test("renders short distances in meters", () => {
    expect(formatMeters(80)).toBe("80 m");
    expect(formatMeters(449.6)).toBe("450 m");
  });

  test("renders long distances in kilometers", () => {
    expect(formatMeters(1000)).toBe("1 km");
    expect(formatMeters(1234)).toBe("1.2 km");
    expect(formatMeters(15000)).toBe("15 km");
  });
});

describe("formatWalkingMinutes", () => {
  test("never shows zero minutes", () => {
    expect(formatWalkingMinutes(10)).toBe("1 min walk");
    expect(formatWalkingMinutes(90)).toBe("2 min walk");
    expect(formatWalkingMinutes(600)).toBe("10 min walk");
    expect(formatWalkingMinutes(3540)).toBe("59 min walk");
  });
});

describe("pickLongestLeg", () => {
  test("skips same-building and unresolved legs", () => {
    const legs = [
      leg({ status: "same-building", distanceMeters: 0 }),
      leg({ status: "unresolved", distanceMeters: 5000 }),
      leg({ status: "walking", distanceMeters: 400 }),
    ];
    expect(pickLongestLeg(legs)?.distanceMeters).toBe(400);
  });

  test("treats approximate legs as real candidates", () => {
    const legs = [
      leg({ status: "walking", distanceMeters: 400 }),
      leg({ status: "approximate", distanceMeters: 900 }),
    ];
    expect(pickLongestLeg(legs)?.distanceMeters).toBe(900);
  });

  test("returns null with no crossable legs", () => {
    expect(pickLongestLeg([])).toBeNull();
    expect(pickLongestLeg([leg({ status: "same-building", distanceMeters: 0 })])).toBeNull();
  });
});

describe("dayLegNotice", () => {
  test("stays quiet when every leg is a real path", () => {
    expect(dayLegNotice({ walkingLegs: 2, approximateLegs: 0, sameBuildingLegs: 0, unresolvedLegs: 0, totalDistanceMeters: 100, knownWalkingSeconds: 60 })).toBeNull();
  });

  test("announces estimates in plain language", () => {
    expect(dayLegNotice({ walkingLegs: 1, approximateLegs: 1, sameBuildingLegs: 0, unresolvedLegs: 0, totalDistanceMeters: 100, knownWalkingSeconds: 60 }))
      .toBe("One leg is a straight-line estimate — the routing service could not provide a walking path.");
    expect(dayLegNotice({ walkingLegs: 1, approximateLegs: 3, sameBuildingLegs: 0, unresolvedLegs: 0, totalDistanceMeters: 100, knownWalkingSeconds: 60 }))
      .toBe("3 legs are straight-line estimates — the routing service could not provide walking paths.");
  });
});
