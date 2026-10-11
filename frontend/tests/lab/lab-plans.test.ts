import { describe, expect, test } from "bun:test";
import { buildScheduleEvents, isCourseLocked, normalizePlannerState, serializePlannerPayload } from "@/lib/planner";
import { labPlan, labPlannerState, labScheduleEvents } from "@/lib/lab/lab-plans";
import type { PlannerState } from "@/lib/types";

function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const earthRadiusMeters = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(h));
}

describe("lab plan fixture", () => {
  test("survives normalization with pinned sections intact", () => {
    expect(labPlannerState.selectedSections).toEqual(labPlan.plannerState.selectedSections);
    expect(labPlannerState.courseStatuses).toEqual(labPlan.plannerState.courseStatuses);
  });

  test("runs on exactly five active synthetic courses", () => {
    const active = Object.entries(labPlannerState.courseStatuses)
      .filter(([, status]) => status === "inProgress")
      .map(([code]) => code)
      .sort();
    expect(active).toEqual(labPlan.activeCourseCodes);
    expect(active).toHaveLength(5);
  });

  test("has exactly one engineered Tuesday conflict", () => {
    const tuesday = labScheduleEvents().filter((event) => event.day === "Tue");
    expect(tuesday.length).toBeGreaterThanOrEqual(3);
    const [codeA, codeB] = labPlan.conflictCourseCodes;
    const eventA = tuesday.find((event) => event.courseCode === codeA);
    const eventB = tuesday.find((event) => event.courseCode === codeB);
    expect(eventA && eventB).toBeTruthy();
    expect(eventA!.start < eventB!.end && eventB!.start < eventA!.end).toBe(true);
    const pairs = new Set<string>();
    for (let i = 0; i < tuesday.length; i += 1) {
      for (let j = i + 1; j < tuesday.length; j += 1) {
        if (tuesday[i].start < tuesday[j].end && tuesday[j].start < tuesday[i].end) {
          pairs.add([tuesday[i].courseCode, tuesday[j].courseCode].sort().join("|"));
        }
      }
    }
    expect([...pairs]).toEqual([[codeA, codeB].sort().join("|")]);
  });

  test("lets Friday be kept free: one Friday class with a Friday-free alternative", () => {
    const friday = labScheduleEvents().filter((event) => event.day === "Fri");
    expect(friday.map((event) => event.courseCode)).toEqual([labPlan.fridayCourseCode]);

    const swapped: PlannerState = {
      ...labPlannerState,
      selectedSections: {
        ...labPlannerState.selectedSections,
        [labPlan.fridayCourseCode]: labPlan.fridayAlternativeSectionId,
      },
    };
    const normalized = normalizePlannerState(swapped);
    const events = buildScheduleEvents(normalized);
    expect(events.filter((event) => event.day === "Fri")).toHaveLength(0);
    // The engineered Tuesday conflict is deliberate fixture data; the swap must
    // not introduce any conflict beyond it.
    let baseline = 0;
    const before = labScheduleEvents();
    for (let i = 0; i < before.length; i += 1) {
      for (let j = i + 1; j < before.length; j += 1) {
        if (before[i].day === before[j].day && before[i].start < before[j].end && before[j].start < before[i].end) {
          baseline += 1;
        }
      }
    }
    expect(baseline).toBe(1);
    let conflicts = 0;
    for (let i = 0; i < events.length; i += 1) {
      for (let j = i + 1; j < events.length; j += 1) {
        if (events[i].day === events[j].day && events[i].start < events[j].end && events[j].start < events[i].end) {
          conflicts += 1;
        }
      }
    }
    expect(conflicts).toBe(baseline);
  });

  test("marks exactly the expected prerequisite-locked course", () => {
    const locked = labPlan.activeCourseCodes.filter((code) => isCourseLocked(labPlannerState, code));
    expect(locked).toEqual([labPlan.lockedCourseCode]);
    expect(labPlan.activeCourseCodes).toContain(labPlan.lockedCourseCode);
  });

  test("resolves every Tuesday stop to a real building with coordinates", () => {
    const routeStops = serializePlannerPayload(labPlannerState).routeStops;
    const tuesdayStops = routeStops["Tue"] ?? [];
    expect(tuesdayStops.length).toBeGreaterThanOrEqual(3);
    tuesdayStops.forEach((stop) => {
      expect(typeof stop.lat).toBe("number");
      expect(typeof stop.lng).toBe("number");
      expect(stop.buildingId).toBeTruthy();
      expect(stop.buildingName).toBeTruthy();
    });
    let maxGap = 0;
    for (let i = 0; i < tuesdayStops.length - 1; i += 1) {
      const a = tuesdayStops[i];
      const b = tuesdayStops[i + 1];
      if (
        typeof a.lat === "number" && typeof a.lng === "number" &&
        typeof b.lat === "number" && typeof b.lng === "number"
      ) {
        maxGap = Math.max(maxGap, haversineMeters({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng }));
      }
    }
    expect(maxGap).toBeGreaterThan(0);
  });
});
