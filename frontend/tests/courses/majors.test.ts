import { describe, expect, test } from "bun:test";
import { checkDegree } from "@/components/courses/model/degree";
import { planAuto, snapshotOf } from "@/components/courses/model/plan-edits";
import { buildCourseModel } from "@/components/courses/model/course-model";
import { untProfile } from "@/components/courses/school";
import { getMajorById } from "@/lib/planner";
import { majors } from "@/lib/seed-data";
import type { PlannerState } from "@/lib/types";

const profile = untProfile();
const emptyPlan: PlannerState = {
  courseStatuses: {},
  selectedSections: {},
  optimization: "clusterMorning",
  activeDay: "Mon",
  selectedMajor: null,
  transcriptRecords: [],
  updatedAt: "2026-10-23T00:00:00.000Z",
};

describe("new major picker entries", () => {
  test("uses the ingest program IDs for the new audited majors", () => {
    expect(majors.map(({ id }) => id)).toEqual(["cs", "ce", "it", "cybersecurity", "ee", "math", "biol", "busi", "psyc", "engl", "other"]);
    const model = buildCourseModel(profile, snapshotOf(emptyPlan));
    for (const [majorId, programId] of [["it", "it-bs"], ["cybersecurity", "cybersecurity-bs"], ["ee", "ee-bs"]] as const) {
      const major = getMajorById(majorId)!;
      expect(checkDegree(profile, snapshotOf(emptyPlan), model, major)).toMatchObject({ kind: "audited", programName: expect.stringContaining("BS") });
      expect(programId).toMatch(/-(bs)$/);
    }
  });

  test("keeps the sample-core fallback for majors without an audit", () => {
    const major = getMajorById("other")!;
    expect(major.coreCourseCodes).toEqual([]);
    expect(planAuto(profile, { ...emptyPlan, selectedMajor: "other" }, major).outcome.planned).toEqual([]);
  });
});
