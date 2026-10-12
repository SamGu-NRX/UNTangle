import { describe, expect, it } from "bun:test";
import { defaultPlannerState } from "@/lib/seed-data";
import { diffSavedPlanAgainstWorking } from "@/lib/plan-library/diff";
import { buildSavedPlanSnapshot } from "@/lib/plan-library/snapshot";
import type { PlannerState } from "@/lib/types";

const capturedAt = "2026-10-10T12:00:00.000Z";

const stateWith = (overrides: Partial<PlannerState>): PlannerState => ({
  ...defaultPlannerState,
  courseStatuses: {},
  selectedSections: {},
  transcriptRecords: [],
  updatedAt: capturedAt,
  ...overrides,
});

const savedPlanFrom = (state: PlannerState) =>
  buildSavedPlanSnapshot({
    state,
    name: "Diff plan",
    source: { kind: "workingState", detail: "Saved from the working schedule" },
    planId: "55555555-5555-4555-8555-555555555555",
    now: new Date(capturedAt),
  });

describe("plan diff (saved plan vs working schedule)", () => {
  const savedState = stateWith({
    courseStatuses: {
      "ANTH 1010": "inProgress",
      "MATH 1710": "inProgress",
      "CSCE 1030": "completed",
    },
    selectedSections: { "ANTH 1010": "anth-1010-001", "MATH 1710": "math-1710-001" },
    optimization: "clusterMorning",
    activeDay: "Mon",
    selectedMajor: null,
  });
  const savedPlan = savedPlanFrom(savedState);

  const workingState = stateWith({
    courseStatuses: {
      "ANTH 1010": "inProgress",
      "MATH 1710": "inProgress",
      "CSCE 1030": "notTaken",
    },
    selectedSections: { "ANTH 1010": "anth-1010-002", "GONE 4242": "never-existed-001" },
    optimization: "clusterNight",
    activeDay: "Mon",
    selectedMajor: null,
  });

  const diff = diffSavedPlanAgainstWorking(savedPlan, workingState);

  it("reports the status change exactly once, with catalog metadata", () => {
    expect(diff.statusChanges).toHaveLength(1);
    expect(diff.statusChanges[0]).toMatchObject({
      courseCode: "CSCE 1030",
      from: "completed",
      to: "notTaken",
    });
    expect(diff.statusChanges[0].course?.title).toContain("Computer Science");
  });

  it("reports section changes with exact section ids, professors, days, times and rooms", () => {
    expect(diff.sectionChanges).toHaveLength(3);

    const changed = diff.sectionChanges.find((change) => change.courseCode === "ANTH 1010");
    expect(changed?.kind).toBe("changed");
    expect(changed?.from).toMatchObject({
      sectionId: "anth-1010-001",
      professor: "Jamie K. Johnson",
    });
    expect(changed?.from?.meetingsSummary).toContain("Mon/Wed/Fri");
    expect(changed?.from?.meetingsSummary).toContain("4:00 PM");
    expect(changed?.from?.meetingsSummary).toContain("Life Sciences Complex");
    expect(changed?.to?.sectionId).toBe("anth-1010-002");

    const removed = diff.sectionChanges.find((change) => change.courseCode === "MATH 1710");
    expect(removed?.kind).toBe("removed");
    expect(removed?.from?.sectionId).toBe("math-1710-001");
    expect(removed?.to).toBeNull();

    const added = diff.sectionChanges.find((change) => change.courseCode === "GONE 4242");
    expect(added?.kind).toBe("added");
    expect(added?.from).toBeNull();
    expect(added?.to).toMatchObject({
      sectionId: "never-existed-001",
      professor: "unknown section",
    });
  });

  it("surfaces unknown references from either side with their side attribution", () => {
    expect(diff.unknownReferences).toHaveLength(1);
    expect(diff.unknownReferences[0]).toMatchObject({
      courseCode: "GONE 4242",
      sectionId: "never-existed-001",
      side: "workingState",
    });
  });

  it("flags planner preference changes", () => {
    expect(diff.optimizationChanged).toBe(true);
    expect(diff.activeDayChanged).toBe(false);
    expect(diff.majorChanged).toBe(false);
  });

  it("compares transcript record lists without judging them", () => {
    expect(diff.transcriptRecords).toEqual({
      savedPlan: 0,
      workingState: 0,
      changed: false,
    });
  });

  it("commits the preserved/changed field accounting for this scenario", () => {
    // Compared fields: 4 course statuses (ANTH 1010, MATH 1710, CSCE 1030,
    // GONE 4242) + 3 section refs (ANTH 1010, MATH 1710, GONE 4242) +
    // optimization + activeDay + major + transcript list = 11.
    // Changed: 1 status (CSCE 1030) + 3 section changes + 1 optimization = 5.
    expect(diff.comparedFieldCount).toBe(11);
    expect(diff.changedFieldCount).toBe(5);
    expect(diff.preservedFieldCount).toBe(6);
    expect(diff.comparedFieldCount).toBe(diff.preservedFieldCount + diff.changedFieldCount);
  });

  it("counts an identical working schedule as fully preserved", () => {
    const identical = diffSavedPlanAgainstWorking(savedPlan, savedState);
    expect(identical.statusChanges).toHaveLength(0);
    expect(identical.sectionChanges).toHaveLength(0);
    expect(identical.unknownReferences).toHaveLength(0);
    expect(identical.changedFieldCount).toBe(0);
    expect(identical.preservedFieldCount).toBe(identical.comparedFieldCount);
  });

  it("treats transcript differences as a single changed field", () => {
    const withRecord = stateWith({
      courseStatuses: savedState.courseStatuses,
      selectedSections: savedState.selectedSections,
      transcriptRecords: [
        {
          id: "tr-x",
          code: "CSCE 1030",
          title: "Computer Science I",
          term: "2025 Fall",
          grade: "B",
          credits: 3,
          confidence: 1,
          rationale: "synthetic",
          duplicateExcluded: false,
          prerequisiteSatisfied: true,
          reviewRequired: false,
          appliedStatus: "completed",
          sourceKind: "unt",
        },
      ],
    });
    const withRecordPlan = savedPlanFrom(withRecord);
    const transcriptDiff = diffSavedPlanAgainstWorking(withRecordPlan, savedState);
    expect(transcriptDiff.transcriptRecords).toEqual({
      savedPlan: 1,
      workingState: 0,
      changed: true,
    });
    expect(transcriptDiff.changedFieldCount).toBe(1);
  });
});
