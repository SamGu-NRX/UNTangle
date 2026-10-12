/**
 * Regenerates the committed saved-plan fixtures against the current catalog.
 * Run: bun tests/fixtures/plan-library/generate-fixtures.ts
 */
import { writeFileSync } from "node:fs";
import { defaultPlannerState } from "@/lib/seed-data";
import { buildSavedPlanSnapshot } from "@/lib/plan-library/snapshot";
import type { PlannerState } from "@/lib/types";

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

const planState: PlannerState = {
  ...defaultPlannerState,
  courseStatuses: {
    ...defaultPlannerState.courseStatuses,
    "ANTH 1010": "inProgress",
    "ANTH 1150": "completed",
  },
  selectedSections: { "ANTH 1010": "anth-1010-001" },
  transcriptRecords: [sampleRecord],
  updatedAt: capturedAt,
};

const valid = buildSavedPlanSnapshot({
  state: planState,
  name: "Fall plan",
  source: { kind: "workingState", detail: "Saved from the working schedule" },
  planId: "11111111-1111-4111-8111-111111111111",
  now: new Date(capturedAt),
});
writeFileSync(
  new URL("./saved-plan-valid.json", import.meta.url),
  `${JSON.stringify(valid, null, 2)}\n`,
);

const invalidVersion = { ...valid, schemaVersion: 2 };
writeFileSync(
  new URL("./saved-plan-invalid-version.json", import.meta.url),
  `${JSON.stringify(invalidVersion, null, 2)}\n`,
);

// A plan captured against a catalog whose ANTH 1010 section list has since
// changed: the saved selection no longer resolves in the running catalog.
const staleState: PlannerState = {
  ...planState,
  selectedSections: { "ANTH 1010": "anth-1010-999-gone" },
};
const stale = buildSavedPlanSnapshot({
  state: staleState,
  name: "Plan from an older catalog",
  source: { kind: "workingState", detail: "Saved from the working schedule" },
  planId: "22222222-2222-4222-8222-222222222222",
  now: new Date(capturedAt),
});
writeFileSync(
  new URL("./saved-plan-missing-section.json", import.meta.url),
  `${JSON.stringify(stale, null, 2)}\n`,
);

console.log("fixtures regenerated:", valid.catalog, stale.catalog);
