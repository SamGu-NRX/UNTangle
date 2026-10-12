import { describe, expect, it } from "bun:test";
import { courses, defaultPlannerState } from "@/lib/seed-data";
import {
  buildSavedPlanSnapshot,
  computeCatalogFingerprint,
  resolveSectionReferences,
  validateSavedPlanPayload,
} from "@/lib/plan-library/snapshot";
import type { PlannerState } from "@/lib/types";
import validFixture from "./fixtures/plan-library/saved-plan-valid.json";
import invalidVersionFixture from "./fixtures/plan-library/saved-plan-invalid-version.json";
import missingSectionFixture from "./fixtures/plan-library/saved-plan-missing-section.json";

const capturedAt = "2026-10-10T12:00:00.000Z";

const sampleRecord: PlannerState["transcriptRecords"][number] = {
  id: "tr-anth-1150",
  code: "ANTH 1150",
  title: "World Cultures Through Film",
  term: "2024 Fall",
  grade: "A",
  credits: 3,
  confidence: 0.98,
  rationale: "Imported from UNT transcript",
  duplicateExcluded: false,
  prerequisiteSatisfied: true,
  reviewRequired: false,
  appliedStatus: "completed",
  sourceKind: "unt",
};

const stateWith = (overrides: Partial<PlannerState>): PlannerState => ({
  ...defaultPlannerState,
  courseStatuses: {
    ...defaultPlannerState.courseStatuses,
    "ANTH 1010": "inProgress",
    "ANTH 1150": "completed",
  },
  selectedSections: { "ANTH 1010": "anth-1010-001" },
  transcriptRecords: [sampleRecord],
  updatedAt: capturedAt,
  ...overrides,
});

describe("saved-plan snapshot contract", () => {
  it("round-trips a snapshot through JSON with state, catalog identity and assumptions intact", () => {
    const snapshot = buildSavedPlanSnapshot({
      state: stateWith({}),
      name: "Roundtrip plan",
      source: { kind: "workingState", detail: "Saved from the working schedule" },
      planId: "33333333-3333-4333-8333-333333333333",
      now: new Date(capturedAt),
    });

    const serialized = JSON.stringify(snapshot);
    const validation = validateSavedPlanPayload(JSON.parse(serialized));

    expect(validation.ok).toBe(true);
    if (!validation.ok) return;
    expect(validation.snapshot.state).toEqual(stateWith({}));
    expect(validation.snapshot.catalog).toEqual(snapshot.catalog);
    expect(validation.snapshot.assumptions).toEqual(snapshot.assumptions);
    expect(validation.snapshot.planId).toBe("33333333-3333-4333-8333-333333333333");
  });

  it("rejects an unsupported schema version with an explicit reason", () => {
    const validation = validateSavedPlanPayload(invalidVersionFixture);
    expect(validation.ok).toBe(false);
    if (validation.ok) return;
    expect(validation.reason).toContain("Unsupported saved-plan schema version: 2");
    expect(validation.reason).toContain("version 1");
  });

  it("validates the committed valid fixture and resolves its references as preserved", () => {
    const validation = validateSavedPlanPayload(validFixture);
    expect(validation.ok).toBe(true);
    if (!validation.ok) return;

    expect(validation.snapshot.name).toBe("Fall plan");
    expect(validation.snapshot.source.kind).toBe("workingState");
    expect(validation.snapshot.assumptions.transcriptRecordCount).toBe(1);
    expect(validation.snapshot.assumptions.declaredStatusCounts.completed).toBeGreaterThanOrEqual(1);
    expect(validation.snapshot.assumptions.declaredStatusCounts.inProgress).toBeGreaterThanOrEqual(1);
    expect(validation.references.preserved).toHaveLength(1);
    expect(validation.references.preserved[0]).toMatchObject({
      courseCode: "ANTH 1010",
      sectionId: "anth-1010-001",
    });
    expect(validation.references.stale).toHaveLength(0);
    expect(validation.references.inactive).toHaveLength(0);
    expect(validation.references.unknownCourses).toHaveLength(0);
  });

  it("surfaces a missing-section plan as visible stale references, not a silent replacement", () => {
    const validation = validateSavedPlanPayload(missingSectionFixture);
    expect(validation.ok).toBe(true);
    if (!validation.ok) return;

    expect(validation.references.stale).toHaveLength(1);
    expect(validation.references.stale[0]).toMatchObject({
      courseCode: "ANTH 1010",
      sectionId: "anth-1010-999-gone",
    });
    expect(validation.references.stale[0].section).toBeNull();
    expect(validation.references.preserved).toHaveLength(0);
  });

  it("classifies selections for courses that are not in progress as inactive", () => {
    const report = resolveSectionReferences(
      stateWith({
        courseStatuses: { ...defaultPlannerState.courseStatuses, "ANTH 1150": "completed" },
        selectedSections: { "ANTH 1010": "anth-1010-001" },
      }),
    );
    expect(report.inactive).toHaveLength(1);
    expect(report.inactive[0]).toMatchObject({
      courseCode: "ANTH 1010",
      sectionId: "anth-1010-001",
    });
    expect(report.inactive[0].section).not.toBeNull();
  });

  it("classifies selections for courses missing from the catalog as unknown", () => {
    const report = resolveSectionReferences(
      stateWith({ selectedSections: { "FAKE 4242": "never-existed-001" } }),
    );
    expect(report.unknownCourses).toHaveLength(1);
    expect(report.unknownCourses[0]).toMatchObject({
      courseCode: "FAKE 4242",
      sectionId: "never-existed-001",
    });
  });

  it("fingerprints the referenced catalog slice: stable for identical state, sensitive to referenced sections and metadata", () => {
    const state = stateWith({});
    const first = computeCatalogFingerprint(state);
    expect(computeCatalogFingerprint(stateWith({}))).toEqual(first);

    // A different section of the same course changes the fingerprint.
    const otherSection = computeCatalogFingerprint(
      stateWith({ selectedSections: { "ANTH 1010": "anth-1010-002" } }),
    );
    expect(otherSection.fingerprint).not.toBe(first.fingerprint);

    // A not-taken status (no catalog metadata referenced) does not.
    const notTakenNoise = computeCatalogFingerprint(
      stateWith({
        courseStatuses: {
          ...defaultPlannerState.courseStatuses,
          "ANTH 1010": "inProgress",
          "ANTH 1150": "completed",
          "BIOL 2040": "notTaken",
        },
      }),
    );
    expect(notTakenNoise.fingerprint).toBe(first.fingerprint);

    // Preferences are not catalog metadata and do not move the fingerprint.
    const preferenceNoise = computeCatalogFingerprint(
      stateWith({ optimization: "clusterNight", activeDay: "Tue" }),
    );
    expect(preferenceNoise.fingerprint).toBe(first.fingerprint);
  });

  it("delegates planner-state structural validation to the planner's own validator", () => {
    const validation = validateSavedPlanPayload({
      ...validFixture,
      state: { ...validFixture.state, courseStatuses: "nope" },
    });
    expect(validation.ok).toBe(false);
    if (validation.ok) return;
    expect(validation.reason).toContain("courseStatuses");
  });

  it("records declared assumptions, including outstanding prerequisites under existing policy", () => {
    const courseWithPrereq = courses.find((course) => course.prerequisites.length > 0);
    expect(courseWithPrereq).toBeDefined();
    if (!courseWithPrereq) return;

    const snapshot = buildSavedPlanSnapshot({
      state: stateWith({
        courseStatuses: {
          ...defaultPlannerState.courseStatuses,
          [courseWithPrereq.code]: "inProgress",
        },
        selectedSections: {},
        transcriptRecords: [],
      }),
      name: "Assumption plan",
      source: { kind: "workingState", detail: "Saved from the working schedule" },
      planId: "44444444-4444-4444-8444-444444444444",
      now: new Date(capturedAt),
    });

    expect(snapshot.assumptions.declaredStatusCounts.inProgress).toBeGreaterThanOrEqual(1);
    expect(snapshot.assumptions.prerequisiteOutstanding[courseWithPrereq.code]).toEqual(
      courseWithPrereq.prerequisites,
    );
    expect(snapshot.assumptions.major).toBeNull();
    expect(snapshot.assumptions.optimization).toBe("clusterMorning");
  });
});
