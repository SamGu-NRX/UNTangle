import { describe, expect, it } from "bun:test";
import { buildCatalogRequest, catalogSectionsPerCourse, pickCatalogCourseCodes } from "../../src/lib/optimizer/bench/catalogAdapter";
import { BENCH_BUILDING_IDS, BENCH_UNKNOWN_BUILDING_IDS, benchWalkingTime, generateInstance } from "../../src/lib/optimizer/bench/generator";
import { buildSuite, isEnumerable } from "../../src/lib/optimizer/bench/instances";
import { courses, sections } from "@/lib/seed-data";
import { findLockedConflict } from "../../src/lib/optimizer/scorer";

describe("generator determinism", () => {
  it("the same seed twice produces deep-equal instances", () => {
    const a = generateInstance(1234, { courses: 3, sectionsPerCourse: 5, locks: 1, exclusions: 2, constraintDensity: 0.5, profile: "mixed" });
    const b = generateInstance(1234, { courses: 3, sectionsPerCourse: 5, locks: 1, exclusions: 2, constraintDensity: 0.5, profile: "mixed" });
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it("different seeds differ", () => {
    const a = generateInstance(1234, { courses: 3, sectionsPerCourse: 5, locks: 1, exclusions: 2, constraintDensity: 0.5, profile: "mixed" });
    const b = generateInstance(1235, { courses: 3, sectionsPerCourse: 5, locks: 1, exclusions: 2, constraintDensity: 0.5, profile: "mixed" });
    expect(JSON.stringify(a)).not.toEqual(JSON.stringify(b));
  });
});

describe("generator bounds and shape", () => {
  const suite = buildSuite();

  it("respects the pinned bounds (<=8 courses, <=40 sections)", () => {
    for (const instance of suite) {
      expect(instance.req.requestedCourseCodes.length).toBeLessThanOrEqual(8);
      const perCourse = new Map<string, number>();
      for (const section of instance.req.sections) {
        perCourse.set(section.courseCode, (perCourse.get(section.courseCode) ?? 0) + 1);
        for (const meeting of section.meetings) {
          expect(meeting.end).toBeGreaterThan(meeting.start);
        }
        if (instance.suite === "catalog") continue; // catalog times come from 'HH:MM' data, not the grid
        expect(section.meetings.length).toBeGreaterThanOrEqual(1);
        expect(section.meetings.length).toBeLessThanOrEqual(3);
        for (const meeting of section.meetings) {
          expect(meeting.start % 30).toBe(0);
          expect(meeting.end % 30).toBe(0);
        }
      }
      for (const count of perCourse.values()) expect(count).toBeLessThanOrEqual(40);
    }
  });

  it("across the pinned suite every hard-constraint kind appears at least once", () => {
    let earliestStart = false;
    let latestEnd = false;
    let daysOff = false;
    let maxCredits = false;
    let blocked = false;
    let transfer = false;
    let locks = false;
    let exclusions = false;
    for (const instance of suite) {
      const hc = instance.req.hardConstraints;
      earliestStart ||= hc.earliestStart !== undefined;
      latestEnd ||= hc.latestEnd !== undefined;
      daysOff ||= (hc.daysOff?.length ?? 0) > 0;
      maxCredits ||= hc.maxCredits !== undefined;
      blocked ||= (hc.blockedTimeRanges?.length ?? 0) > 0;
      transfer ||= hc.minTransferMinutes !== undefined;
      locks ||= instance.req.lockedSectionIds.length > 0;
      exclusions ||= instance.req.excludedSectionIds.length > 0;
    }
    expect(earliestStart).toBe(true);
    expect(latestEnd).toBe(true);
    expect(daysOff).toBe(true);
    expect(maxCredits).toBe(true);
    expect(blocked).toBe(true);
    expect(transfer).toBe(true);
    expect(locks).toBe(true);
    expect(exclusions).toBe(true);
  });

  it("at least one infeasible instance exists", () => {
    expect(suite.some((instance) => instance.expectInfeasible)).toBe(true);
  });

  it("handcrafted edge instances are present", () => {
    const empty = suite.find((i) => i.name === "edge-empty-xs");
    expect(empty).toBeDefined();
    expect(empty?.req.requestedCourseCodes.length).toBe(0);

    const lockedExcluded = suite.find((i) => i.name === "infeasible-locked-excluded-xs");
    expect(lockedExcluded).toBeDefined();
    expect(findLockedConflict(lockedExcluded!.req)).not.toBeNull();

    const zeroCandidates = suite.find((i) => i.name === "edge-zero-candidates-s");
    expect(zeroCandidates).toBeDefined();
    const candidateCounts = new Map<string, number>();
    for (const section of zeroCandidates!.req.sections) {
      candidateCounts.set(section.courseCode, (candidateCounts.get(section.courseCode) ?? 0) + 1);
    }
    expect(zeroCandidates!.req.requestedCourseCodes.some((code) => (candidateCounts.get(code) ?? 0) === 0)).toBe(true);

    const single = suite.find((i) => i.name === "edge-single-option-s");
    expect(single).toBeDefined();
    expect(single!.enumerable).toBe(true);
  });

  it("the worst case is 8 courses x 40 sections and not enumerable", () => {
    const worst = suite.find((i) => i.name === "worst-case-xl");
    expect(worst).toBeDefined();
    expect(worst!.req.requestedCourseCodes.length).toBe(8);
    expect(worst!.req.sections.length).toBe(320);
    expect(worst!.enumerable).toBe(false);
  });

  it("isEnumerable matches the 1e6 product bound", () => {
    // A trivial 2x2 instance is enumerable; 8x40 is not.
    const small = generateInstance(1, { courses: 2, sectionsPerCourse: 2, locks: 0, exclusions: 0, constraintDensity: 0, profile: "plain" });
    expect(isEnumerable(small)).toBe(true);
  });
});

describe("benchmark walking function", () => {
  it("returns 0 campus-network for the same building and unknown for ghost ids", () => {
    expect(benchWalkingTime("bench-arts", "bench-arts")).toEqual({ seconds: 0, source: "campus-network" });
    expect(benchWalkingTime("bench-ghost-1", "bench-arts")).toEqual({ seconds: null, source: "unknown" });
    expect(benchWalkingTime("bench-arts", "bench-ghost-2")).toEqual({ seconds: null, source: "unknown" });
    // Two known buildings give a stable, positive pseudo-distance.
    const w1 = benchWalkingTime("bench-arts", "bench-sci");
    const w2 = benchWalkingTime("bench-arts", "bench-sci");
    expect(w1).toEqual(w2);
    expect(w1.seconds === null ? 0 : w1.seconds).toBeGreaterThan(0);
  });

  it("generated sections include unknown-building meetings so unknown pairs occur", () => {
    const req = generateInstance(777, { courses: 4, sectionsPerCourse: 12, locks: 0, exclusions: 0, constraintDensity: 0, profile: "plain" });
    const buildings = new Set(req.sections.flatMap((s) => s.meetings.map((m) => m.buildingId)));
    expect(BENCH_UNKNOWN_BUILDING_IDS.some((id) => buildings.has(id))).toBe(true);
    expect(BENCH_BUILDING_IDS.some((id) => buildings.has(id))).toBe(true);
  });
});

describe("catalog adapter", () => {
  it("produces minutes-based meetings, lowercase building ids, credits from courses", () => {
    const codes = pickCatalogCourseCodes(3, 2, 8);
    expect(codes.length).toBe(3);
    const req = buildCatalogRequest({ courseCodes: codes, seed: 1, locks: 1, exclusions: 2 });
    const creditHoursByCode = new Map(courses.map((course) => [course.code, course.creditHours] as const));
    for (const section of req.sections) {
      expect(section.historicalGpa).toBeUndefined();
      const credits = creditHoursByCode.get(section.courseCode);
      if (credits === undefined) throw new Error(`no creditHours for ${section.courseCode}`);
      expect(section.credits).toBe(credits);
      for (const meeting of section.meetings) {
        expect(Number.isInteger(meeting.start)).toBe(true);
        expect(Number.isInteger(meeting.end)).toBe(true);
        expect(meeting.end).toBeGreaterThan(meeting.start);
        expect(meeting.buildingId).toEqual(meeting.buildingId.toLowerCase());
        expect(meeting.day).toMatch(/^(Mon|Tue|Wed|Thu|Fri)$/);
      }
    }
  });

  it("same options rebuild the exact same request (determinism)", () => {
    const codes = pickCatalogCourseCodes(4, 2, 6);
    const a = buildCatalogRequest({ courseCodes: codes, seed: 7, locks: 1, exclusions: 2 });
    const b = buildCatalogRequest({ courseCodes: codes, seed: 7, locks: 1, exclusions: 2 });
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it("reports catalog section counts from the bundled data", () => {
    const codes = pickCatalogCourseCodes(1, 2, 8);
    expect(catalogSectionsPerCourse(codes[0])).toBeGreaterThanOrEqual(2);
    expect(sections.length).toBe(2704);
  });
});
