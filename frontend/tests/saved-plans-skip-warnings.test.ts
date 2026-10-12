import { describe, expect, it } from "bun:test";
import { describeSkippedReferences } from "@/lib/saved-plans/restore-adapter";
import { resolveSectionReferences } from "@/lib/plan-library/snapshot";
import { defaultPlannerState } from "@/lib/seed-data";
import type { PlannerState } from "@/lib/types";

// Restoring a plan must PREVIEW every saved section reference that will not
// carry over — stale, inactive, unknown — with an explicit consequence, so
// confirmation is informed rather than destructive.

const stateWith = (overrides: Partial<PlannerState>): PlannerState => ({
  ...defaultPlannerState,
  transcriptRecords: [],
  ...overrides,
});

describe("describeSkippedReferences (restore preview warnings)", () => {
  it("returns no warnings when every saved reference resolves", () => {
    const state = stateWith({
      courseStatuses: { ...defaultPlannerState.courseStatuses, "ANTH 1010": "inProgress" },
      selectedSections: { "ANTH 1010": "anth-1010-001" },
    });
    const warnings = describeSkippedReferences(resolveSectionReferences(state));
    expect(warnings).toEqual([]);
  });

  it("warns about a stale section with the optimizer consequence", () => {
    const state = stateWith({
      courseStatuses: { ...defaultPlannerState.courseStatuses, "ANTH 1010": "inProgress" },
      selectedSections: { "ANTH 1010": "anth-1010-999" },
    });
    const warnings = describeSkippedReferences(resolveSectionReferences(state));
    expect(warnings).toHaveLength(1);
    expect(warnings[0].courseCode).toBe("ANTH 1010");
    expect(warnings[0].sectionId).toBe("anth-1010-999");
    expect(warnings[0].warning).toContain("no longer offered");
    expect(warnings[0].warning).toContain("optimizer");
  });

  it("warns about an inactive section with the active-section consequence", () => {
    const state = stateWith({
      selectedSections: { "ANTH 1150": "anth-1150-001" },
    });
    const warnings = describeSkippedReferences(resolveSectionReferences(state));
    expect(warnings).toHaveLength(1);
    expect(warnings[0].courseCode).toBe("ANTH 1150");
    expect(warnings[0].warning).toContain("not active");
  });

  it("warns about a section of a course the catalog does not know", () => {
    const state = stateWith({
      selectedSections: { "FAKE 101": "fake-101-001" },
    });
    const warnings = describeSkippedReferences(resolveSectionReferences(state));
    expect(warnings).toHaveLength(1);
    expect(warnings[0].courseCode).toBe("FAKE 101");
    expect(warnings[0].warning).toContain("does not know");
  });

  it("reports stale, inactive and unknown warnings together", () => {
    const state = stateWith({
      courseStatuses: { ...defaultPlannerState.courseStatuses, "ANTH 1010": "inProgress" },
      selectedSections: {
        "ANTH 1010": "anth-1010-999",
        "ANTH 1150": "anth-1150-001",
        "FAKE 101": "fake-101-001",
      },
    });
    const warnings = describeSkippedReferences(resolveSectionReferences(state));
    expect(warnings).toHaveLength(3);
    const warnedCourses = warnings.map((warning) => warning.courseCode).sort();
    expect(warnedCourses).toEqual(["ANTH 1010", "ANTH 1150", "FAKE 101"]);
  });
});
