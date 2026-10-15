/**
 * The Auto request the real builder hands the engine: instructor evidence
 * reaches the searched courses and only them (a held course has one option,
 * which cannot decide a tie), the tie-break ranks equal-cost schedules by it,
 * and a course with any unevidenced option contributes nothing — core's omit
 * rule, through the request builder.
 */

import { describe, expect, test } from "bun:test";
import { optimize } from "@/lib/optimizer/optimize";
import { buildOptimizeRequest, getCourseByCode } from "@/lib/planner";
import type { SectionCatalog } from "@/lib/planner-sections";
import type { CourseSections, Meeting, Section } from "@/lib/sections/model";
import { defaultPlannerState } from "@/lib/seed-data";
import type { SchedulePreferences } from "@/lib/types";

function meeting(day: Meeting["day"], start: number, end: number): Meeting {
  return {
    room: "204", buildingCode: "NTDP", buildingId: "ntdp", buildingName: "Discovery Park", kind: "building", offCampus: false,
    day, startMinutes: start, endMinutes: end, dates: { start: null, end: null, raw: "" },
    instructor: { display: "Jane Doe", raw: "Doe,Jane" }, async: false, tba: false,
  };
}

function section(id: string, courseCode: string, meetings: Meeting[]): Section {
  return {
    id, term: "spring-2027", courseCode, sectionCode: "001", classNumbers: ["12345"], option: "1",
    instructor: { display: "Jane Doe", raw: "Doe,Jane" }, seats: { open: 25, total: 40 }, status: "open", rawStatus: "Open",
    session: { label: "Full Term", dates: { start: null, end: null, raw: "" } }, components: [], meetings,
    online: false, async: false, tba: false,
  };
}

// ANTH 1010 meets 9:00-10:00 and ANTH 1150 10:00-11:00 (Mon or Tue, same
// building): with no stated preferences every schedule costs the same, so
// evidence alone ranks them, and no two sections share a meeting pattern.
const A = "ANTH 1010";
const B = "ANTH 1150";
const FIXTURES: Record<string, CourseSections> = {
  [A]: {
    status: "ok", availability: "sections", term: "spring-2027", courseCode: A, diagnostic: null,
    provenance: { kind: "real", source: "vsb.untgrades.app", updatedAt: "2026-10-15T00:00:00Z", note: "" }, checkedAt: "2026-10-15T00:00:00Z",
    sections: [section("anth-1010-001", A, [meeting("Mon", 540, 600)]), section("anth-1010-002", A, [meeting("Tue", 540, 600)])],
  },
  [B]: {
    status: "ok", availability: "sections", term: "spring-2027", courseCode: B, diagnostic: null,
    provenance: { kind: "real", source: "vsb.untgrades.app", updatedAt: "2026-10-15T00:00:00Z", note: "" }, checkedAt: "2026-10-15T00:00:00Z",
    sections: [section("anth-1150-001", B, [meeting("Mon", 600, 660)]), section("anth-1150-002", B, [meeting("Tue", 600, 660)])],
  },
};
/** Course B with one section only: the sole choosable course is A, so alternatives may differ in A alone. */
const SINGLE_B: Record<string, CourseSections> = {
  ...FIXTURES,
  [B]: { ...FIXTURES[B], sections: [FIXTURES[B].sections[0]] },
};
const catalog: SectionCatalog = (code) =>
  FIXTURES[code] ? { status: "ready", result: FIXTURES[code] } : { status: "loading" };
const singleBCatalog: SectionCatalog = (code) =>
  SINGLE_B[code] ? { status: "ready", result: SINGLE_B[code] } : { status: "loading" };

const preferences: SchedulePreferences = {
  constraints: {
    earliestStart: null, latestEnd: null, daysOff: [], blocked: [], maxCredits: null,
    walkingBufferMinutes: null, excludedSections: [], openSeatsOnly: false, otherSites: false,
  },
  weights: { fewerDays: 0, compact: 0, mornings: 0, evenings: 0, walking: 0, rating: 0 },
};

const strongEvidence = {
  [A]: { "anth-1010-001": 280, "anth-1010-002": 350 },
  [B]: { "anth-1150-001": 310, "anth-1150-002": 340 },
};

function optimal(request: ReturnType<typeof buildOptimizeRequest>) {
  const result = optimize(request);
  if (result.status !== "optimal") throw new Error(`expected optimal, got ${result.status}`);
  return result.schedules;
}

describe("the Auto request the real builder hands the engine", () => {
  test("it carries the accepted evidence, whole hundredths, per section", () => {
    for (const code of [A, B]) expect(getCourseByCode(code)).toBeDefined();
    const request = buildOptimizeRequest(defaultPlannerState, preferences, { courseCodes: [A, B], catalog, evidenceHundredths: strongEvidence });
    const byCode = Object.fromEntries(request.courses.map((course) => [course.code, course]));
    expect(byCode[A].sections.map((section) => section.instructorGpaHundredths)).toEqual([280, 350]);
    expect(byCode[B].sections.map((section) => section.instructorGpaHundredths)).toEqual([310, 340]);
  });

  test("the engine ranks equal-cost schedules by the evidence the request carries", () => {
    const request = buildOptimizeRequest(defaultPlannerState, preferences, { courseCodes: [A, B], catalog, evidenceHundredths: strongEvidence });
    const schedules = optimal(request);
    // Every schedule costs 0; sums are 690 (002+002), 660 (002+001), 620
    // (001+002), 590 (001+001). The diversity rule asks the second pick to
    // differ in both choosable courses, so the ranks hold 690 then 590 —
    // the evidence order, not the id order (001+001 would lead on ids).
    expect(schedules).toHaveLength(2);
    expect(schedules[0].byCourse).toEqual({ [A]: "anth-1010-002", [B]: "anth-1150-002" });
    expect(schedules[1].byCourse).toEqual({ [A]: "anth-1010-001", [B]: "anth-1150-001" });
  });

  test("a course with an unevidenced option contributes nothing, so its evidenced option cannot decide", () => {
    const partial = { [A]: { "anth-1010-001": null, "anth-1010-002": 350 }, [B]: { "anth-1150-001": 300, "anth-1150-002": null } };
    const request = buildOptimizeRequest(defaultPlannerState, preferences, { courseCodes: [A, B], catalog: singleBCatalog, evidenceHundredths: partial });
    // The request carries per-option evidence as supplied: null stays absent.
    const byCode = Object.fromEntries(request.courses.map((course) => [course.code, course]));
    expect("instructorGpaHundredths" in byCode[A].sections[0]).toBe(false);
    expect(byCode[A].sections[1].instructorGpaHundredths).toBe(350);
    // Core's omit rule zeroes the whole course (one option lacks evidence),
    // so both schedules carry just B's 300 and tie: the id order keeps 001
    // first. With per-option evidence, 002's 350 would rank first instead.
    const schedules = optimal(request);
    expect(schedules.map((schedule) => schedule.byCourse[A])).toEqual(["anth-1010-001", "anth-1010-002"]);
  });

  test("a course left out of the evidence map carries no evidence either", () => {
    const request = buildOptimizeRequest(defaultPlannerState, preferences, {
      courseCodes: [A, B],
      catalog,
      evidenceHundredths: { [B]: { "anth-1150-001": 340, "anth-1150-002": 310 } },
    });
    const byCode = Object.fromEntries(request.courses.map((course) => [course.code, course]));
    for (const entry of byCode[A].sections) expect("instructorGpaHundredths" in entry).toBe(false);
  });
});
