/**
 * Independent schedule oracle tests.
 *
 * Compares the brute-force oracle in src/lib/schedule-oracle.ts against the
 * planner's own outputs (sectionConflicts / summarizeCredits) on the real
 * seed catalog. The oracle is the reference; disagreements are recorded, not
 * "fixed" — planner behavior is intentionally left as-is here.
 */
import { describe, expect, it } from "bun:test";
import {
  oracleConflictingPairs,
  oracleSectionsOverlap,
  oracleTotalCredits,
  type OracleSection,
} from "../src/lib/schedule-oracle";
import { sectionConflicts, summarizeCredits } from "../src/lib/planner";
import { courses, defaultPlannerState, majors, sections } from "../src/lib/seed-data";
import type { CourseSection, CourseStatus, PlannerState } from "../src/lib/types";

/** Seeded PRNG (mulberry32) — deterministic, no Math.random. */
function createRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Tally = {
  cases: number;
  agreements: number;
  disagreements: number;
  disagreements_detail: string[];
};

const tally: Tally = { cases: 0, agreements: 0, disagreements: 0, disagreements_detail: [] };

function record(agree: boolean, label: string, oracleValue: unknown, plannerValue: unknown) {
  tally.cases += 1;
  if (agree) {
    tally.agreements += 1;
  } else {
    tally.disagreements += 1;
    tally.disagreements_detail.push(`${label}: oracle=${String(oracleValue)} planner=${String(plannerValue)}`);
  }
}

function toOracleSection(section: CourseSection): OracleSection {
  return {
    id: section.id,
    courseCode: section.courseCode,
    meetings: section.meetings.map((meeting) => ({
      day: meeting.day,
      start: meeting.start,
      end: meeting.end,
    })),
  };
}

function comparePairConflicts(left: CourseSection, right: CourseSection, label: string) {
  const oracleVerdict = oracleSectionsOverlap(toOracleSection(left), toOracleSection(right));
  const plannerVerdict = sectionConflicts(left, [right]);
  record(oracleVerdict === plannerVerdict, `${label} conflict`, oracleVerdict, plannerVerdict);
}

function compareSelectionCredits(selection: CourseSection[], label: string) {
  const creditHoursByCode: Record<string, number> = {};
  for (const course of courses) {
    creditHoursByCode[course.code] = course.creditHours;
  }
  const oracleVerdict = oracleTotalCredits(selection.map(toOracleSection), creditHoursByCode);
  // neutralize the seed's default in-progress courses so the planner sum covers
  // exactly the selection under test (getActiveCourseCodes merges the defaults)
  const courseStatuses: Record<string, CourseStatus> = {};
  for (const [code, status] of Object.entries(defaultPlannerState.courseStatuses)) {
    courseStatuses[code] = status === "inProgress" ? "notTaken" : status;
  }
  for (const section of selection) {
    courseStatuses[section.courseCode] = "inProgress";
  }
  const plannerState: PlannerState = { ...defaultPlannerState, courseStatuses };
  const plannerVerdict = summarizeCredits(plannerState);
  record(oracleVerdict === plannerVerdict, `${label} credits`, oracleVerdict, plannerVerdict);
}

/** Time-shifted deep copy of a real section, keeping its real meeting days. */
function cloneShifted(section: CourseSection, minuteShift: number, idSuffix: string): CourseSection {
  return {
    ...section,
    id: `${section.id}${idSuffix}`,
    meetings: section.meetings.map((meeting) => {
      const [hours, minutes] = meeting.start.split(":").map(Number);
      const shifted = ((hours * 60 + minutes + minuteShift) % 1440 + 1440) % 1440;
      const newHours = String(Math.floor(shifted / 60)).padStart(2, "0");
      const newMinutes = String(shifted % 60).padStart(2, "0");
      const [endHours, endMinutes] = meeting.end.split(":").map(Number);
      const endShifted = ((endHours * 60 + endMinutes + minuteShift) % 1440 + 1440) % 1440;
      const newEndHours = String(Math.floor(endShifted / 60)).padStart(2, "0");
      const newEndMinutes = String(endShifted % 60).padStart(2, "0");
      return {
        ...meeting,
        start: `${newHours}:${newMinutes}`,
        end: `${newEndHours}:${newEndMinutes}`,
      };
    }),
  };
}

function meetingSpanMinutes(meeting: { start: string; end: string }): number {
  const [startHours, startMinutes] = meeting.start.split(":").map(Number);
  const [endHours, endMinutes] = meeting.end.split(":").map(Number);
  return endHours * 60 + endMinutes - (startHours * 60 + startMinutes);
}

describe("schedule oracle: unit behavior", () => {
  it("treats adjacency (end == start) as a non-conflict and overlap as a conflict", () => {
    const base = sections.find((section) => section.meetings.length > 0);
    expect(base).toBeDefined();
    if (!base) return;
    const span = meetingSpanMinutes(base.meetings[0]);

    expect(oracleSectionsOverlap(
      toOracleSection(base),
      toOracleSection(cloneShifted(base, -30, "-overlap")),
    )).toBe(true);
    expect(oracleSectionsOverlap(
      toOracleSection(base),
      toOracleSection(cloneShifted(base, -span, "-adjacent")),
    )).toBe(false);
    expect(oracleSectionsOverlap(
      toOracleSection(base),
      toOracleSection(cloneShifted(base, span + 60, "-disjoint")),
    )).toBe(false);
  });

  it("sums credits per selected section and finds all conflicting pairs", () => {
    const creditHoursByCode: Record<string, number> = {};
    for (const course of courses) {
      creditHoursByCode[course.code] = course.creditHours;
    }
    const picks = [sections[0], sections[10], sections[100]];
    const total = oracleTotalCredits(picks.map(toOracleSection), creditHoursByCode);
    expect(total).toBe(picks.reduce((sum, pick) => sum + creditHoursByCode[pick.courseCode], 0));

    const overlapping: OracleSection[] = [
      { id: "a", courseCode: "X 1", meetings: [{ day: "Mon", start: "09:00", end: "10:00" }] },
      { id: "b", courseCode: "X 2", meetings: [{ day: "Mon", start: "09:30", end: "11:00" }] },
      { id: "c", courseCode: "X 3", meetings: [{ day: "Tue", start: "09:00", end: "10:00" }] },
    ];
    expect(oracleConflictingPairs(overlapping)).toEqual([{ left: 0, right: 1 }]);
  });
});

describe("schedule oracle vs planner: reference cases", () => {
  it("hand-built cases: true conflict, adjacency edge, disjoint, identical, duplicate course", () => {
    const base = sections.find((section) => section.meetings.length > 0);
    expect(base).toBeDefined();
    if (!base) return;
    const span = meetingSpanMinutes(base.meetings[0]);

    // (a) true conflict: shifted 30 minutes into the base meeting
    const overlappingClone = cloneShifted(base, -30, "-clone-overlap");
    comparePairConflicts(base, overlappingClone, "hand-built true conflict");
    expect(oracleSectionsOverlap(toOracleSection(base), toOracleSection(overlappingClone))).toBe(true);

    // (b) adjacency edge: clone starts exactly when base ends (end == start)
    const adjacentClone = cloneShifted(base, span, "-clone-adjacent");
    comparePairConflicts(base, adjacentClone, "hand-built adjacency edge");
    expect(oracleSectionsOverlap(toOracleSection(base), toOracleSection(adjacentClone))).toBe(false);

    // (c) disjoint same-day: one hour of gap
    const disjointClone = cloneShifted(base, span + 60, "-clone-disjoint");
    comparePairConflicts(base, disjointClone, "hand-built disjoint same day");
    expect(oracleSectionsOverlap(toOracleSection(base), toOracleSection(disjointClone))).toBe(false);

    // (d) identical meeting times under a different section id
    const identicalClone = cloneShifted(base, 0, "-clone-identical");
    comparePairConflicts(base, identicalClone, "hand-built identical times");
    expect(oracleSectionsOverlap(toOracleSection(base), toOracleSection(identicalClone))).toBe(true);

    // (e) credits: one section each of two different courses stays in the planner's domain
    const otherCourseSection = sections.find(
      (section) => section.courseCode !== base.courseCode && section.meetings.length > 0,
    );
    expect(otherCourseSection).toBeDefined();
    if (!otherCourseSection) return;
    compareSelectionCredits([base, otherCourseSection], "hand-built one section per course");

    // (f) duplicate course: oracle sums per section, planner sums per active course —
    // a modeling difference, recorded as a disagreement, not fixed
    compareSelectionCredits([base, identicalClone], "hand-built duplicate course");
  });

  it("major section sets: every pair against both conflict engines, credits per major", () => {
    for (const major of majors) {
      const majorSections = sections.filter((section) =>
        major.coreCourseCodes.includes(section.courseCode),
      );
      if (majorSections.length < 2) continue;

      for (let left = 0; left < majorSections.length; left += 1) {
        for (let right = left + 1; right < majorSections.length; right += 1) {
          comparePairConflicts(
            majorSections[left],
            majorSections[right],
            `major ${major.id} sections[${left},${right}]`,
          );
        }
      }

      // one section (lowest id) per course — the planner's one-section-per-course domain
      const firstSectionByCode = new Map<string, CourseSection>();
      for (const section of majorSections) {
        if (!firstSectionByCode.has(section.courseCode) ||
            section.id < (firstSectionByCode.get(section.courseCode) as CourseSection).id) {
          firstSectionByCode.set(section.courseCode, section);
        }
      }
      compareSelectionCredits([...firstSectionByCode.values()], `major ${major.id}`);
    }
  });

  it("seeded pseudo-random section selections agree with the planner", () => {
    const random = createRandom(0x5eed);
    for (let iteration = 0; iteration < 200; iteration += 1) {
      const size = 2 + Math.floor(random() * 4); // 2..5 sections
      const picked = new Map<string, CourseSection>();
      let guard = 0;
      while (picked.size < size && guard < 500) {
        guard += 1;
        const candidate = sections[Math.floor(random() * sections.length)];
        if (!picked.has(candidate.courseCode)) {
          picked.set(candidate.courseCode, candidate);
        }
      }
      const selection = [...picked.values()];
      const oraclePairs = oracleConflictingPairs(selection.map(toOracleSection));
      for (const pair of oraclePairs) {
        comparePairConflicts(
          selection[pair.left],
          selection[pair.right],
          `random#${iteration} sections ${selection[pair.left].id}/${selection[pair.right].id}`,
        );
        expect(sectionConflicts(selection[pair.left], [selection[pair.right]])).toBe(true);
      }
      // every pair the planner flags must also be flagged by the oracle
      for (let left = 0; left < selection.length; left += 1) {
        for (let right = left + 1; right < selection.length; right += 1) {
          const plannerVerdict = sectionConflicts(selection[left], [selection[right]]);
          if (plannerVerdict) {
            comparePairConflicts(
              selection[left],
              selection[right],
              `random#${iteration} planner-flagged ${selection[left].id}/${selection[right].id}`,
            );
            expect(oraclePairs.some((p) => p.left === left && p.right === right)).toBe(true);
          }
        }
      }
      compareSelectionCredits(selection, `random#${iteration}`);
    }
  });

  it("tallies agreement totals for the report", () => {
    // Exact counts are pinned after a deterministic full run; see docs/schedule-oracle-report.md.
    expect(tally.cases).toBeGreaterThan(0);
    expect(tally.cases).toBe(tally.agreements + tally.disagreements);
    // Pinned exact totals (deterministic: fixed seeds, fixed catalog):
    expect(tally.cases).toBe(8663);
    expect(tally.agreements).toBe(8662);
    expect(tally.disagreements).toBe(1);
    expect(tally.disagreements_detail[0]).toContain("hand-built duplicate course");
  });
});
