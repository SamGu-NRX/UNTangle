import { courses, sections } from "@/lib/seed-data";
import { getMissingPrerequisites } from "@/lib/planner";
import { getPlanningTermCourseCodes } from "@/lib/planner";
import { findOption, sampleCatalog, sectionRef, type SectionCatalog } from "@/lib/planner-sections";
import { validatePlannerStatePayload } from "@/lib/planner-validation";
import type { Section } from "@/lib/sections";
import type { Course, CourseSection, CourseStatus, PlannerState } from "@/lib/types";
import { PreferencesBodySchema } from "../../../../packages/contracts/src/documents";
import {
  SAVED_PLAN_SCHEMA_VERSION,
  type SavedPlanAssumptions,
  type SavedPlanCatalogIdentity,
  type SavedPlanPreferences,
  type SavedPlanSnapshot,
  type SavedPlanSource,
} from "./snapshot-types";

/** The preferences document's own rules, so a kept set is one the account would accept as it is. */
const SavedPlanPreferencesSchema = PreferencesBodySchema.omit({ institutionId: true });

export { SAVED_PLAN_SCHEMA_VERSION };
export type { SavedPlanSnapshot } from "./snapshot-types";

/**
 * Reference resolution for a saved plan's selected sections against the
 * options loaded now, so what a restore keeps, flags or replaces is decided
 * in the open, per reference, before it runs.
 *
 * A real option id is never replaced: one that names no current option
 * (`needsReview`) or whose term has not loaded yet (`unchecked`) is restored
 * as saved, and Week marks it Needs review until the student picks again.
 * A synthetic sample id stays a labeled sample when it still exists.
 */
export type SectionReferenceStatus = "preserved" | "stale" | "inactive" | "unknownCourse" | "needsReview" | "unchecked";

export type SectionReferenceFinding = {
  courseCode: string;
  sectionId: string;
  status: SectionReferenceStatus;
  /** The option, when the reference resolves in what is loaded now (or is a known sample). */
  section: Section | null;
  course: Course | null;
};

export type SectionReferenceReport = {
  findings: SectionReferenceFinding[];
  preserved: SectionReferenceFinding[];
  /** A sample id no longer in the bundled samples; restore lets the goal pick instead. */
  stale: SectionReferenceFinding[];
  /** Section id resolves, but the plan does not declare the course in progress. */
  inactive: SectionReferenceFinding[];
  /** Course codes that do not exist in the running catalog at all. */
  unknownCourses: SectionReferenceFinding[];
  /** Real option ids the loaded options no longer include: kept as saved, flagged in Week. */
  needsReview: SectionReferenceFinding[];
  /** Real option ids whose course options have not loaded: kept as saved, checked in Week. */
  unchecked: SectionReferenceFinding[];
};


export type SavedPlanValidation =
  | { ok: true; snapshot: SavedPlanSnapshot; references: SectionReferenceReport }
  | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** FNV-1a (32-bit) over a string, as 8 hex characters. Not cryptographic —
 * it is a drift signal for catalog slices, nothing else. */
export function stableHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function meetingLine(section: CourseSection): string {
  return section.meetings
    .map(
      (meeting) =>
        `M\t${meeting.day}\t${meeting.start}\t${meeting.end}\t${meeting.buildingId ?? "-"}\t${meeting.location}`,
    )
    .sort()
    .join("\n");
}

/**
 * Fingerprint of the catalog slice a plan references: every declared
 * (non-`notTaken`) course and every selected section, serialized in a stable
 * order with the exact metadata (title, credits, professor, rating, meetings,
 * rooms) the planner shows. A change to any of those fields changes the
 * fingerprint; additions elsewhere in the catalog do not.
 */
export function computeCatalogFingerprint(state: PlannerState): SavedPlanCatalogIdentity {
  const declaredCodes = new Set<string>();
  Object.entries(state.courseStatuses ?? {}).forEach(([courseCode, status]) => {
    if (status !== "notTaken") {
      declaredCodes.add(courseCode);
    }
  });
  Object.keys(state.selectedSections ?? {}).forEach((courseCode) => {
    declaredCodes.add(courseCode);
  });

  const courseLines: string[] = [];
  const sectionLines: string[] = [];
  declaredCodes.forEach((courseCode) => {
    const course = courses.find((entry) => entry.code === courseCode);
    if (course) {
      courseLines.push(`C\t${course.code}\t${course.title}\t${course.creditHours}`);
    }
  });
  Object.entries(state.selectedSections ?? {}).forEach(([courseCode, sectionId]) => {
    const section = sections.find(
      (entry) => entry.id === sectionId && entry.courseCode === courseCode,
    );
    if (section) {
      sectionLines.push(
        `S\t${section.id}\t${section.courseCode}\t${section.professor}\t${section.rating}\t${meetingLine(section)}`,
      );
    } else if (sectionRef(sectionId).provenance === "real") {
      // A real option is named by its id (term and class numbers); its times
      // are read again from the current options on restore.
      sectionLines.push(`S\t${sectionId}\t${courseCode}`);
    }
  });

  const payload = [...courseLines.sort(), ...sectionLines.sort()].join("\n");
  return {
    fingerprint: stableHash(payload),
    referencedCourseCount: declaredCodes.size,
    referencedSectionCount: sectionLines.length,
  };
}

/**
 * Resolve every selected section of a planner state against `catalog` (the
 * planner's loaded options; the bundled samples by default). Read-only, with
 * the planner's active-course rule (getPlanningTermCourseCodes: a course the
 * transcript says is being taken now is not scheduled, so its section is
 * inactive, exactly as restore will treat it).
 */
export function resolveSectionReferences(state: PlannerState, catalog: SectionCatalog = sampleCatalog): SectionReferenceReport {
  const findings: SectionReferenceFinding[] = [];
  const planned = new Set(getPlanningTermCourseCodes(state));

  Object.entries(state.selectedSections ?? {}).forEach(([courseCode, sectionId]) => {
    const course = courses.find((entry) => entry.code === courseCode) ?? null;
    const section = findOption(catalog, courseCode, sectionId);
    const loaded = catalog(courseCode);
    const real = sectionRef(sectionId).provenance === "real";

    let status: SectionReferenceStatus;
    if (!course) {
      status = "unknownCourse";
    } else if (!section && !real) {
      status = "stale";
    } else if (!planned.has(courseCode)) {
      status = "inactive";
    } else if (section) {
      status = "preserved";
    } else {
      status = loaded.status === "ready" && loaded.result.provenance.kind === "real" ? "needsReview" : "unchecked";
    }

    findings.push({ courseCode, sectionId, status, section, course });
  });

  findings.sort((a, b) => a.courseCode.localeCompare(b.courseCode) || a.sectionId.localeCompare(b.sectionId));
  return {
    findings,
    preserved: findings.filter((finding) => finding.status === "preserved"),
    stale: findings.filter((finding) => finding.status === "stale"),
    inactive: findings.filter((finding) => finding.status === "inactive"),
    unknownCourses: findings.filter(
      (finding) => finding.status === "unknownCourse",
    ),
    needsReview: findings.filter((finding) => finding.status === "needsReview"),
    unchecked: findings.filter((finding) => finding.status === "unchecked"),
  };
}

function validateAssumptions(value: unknown): SavedPlanAssumptions | null {
  if (!isRecord(value)) {
    return null;
  }
  const { declaredStatusCounts, major, optimization, transcriptRecordCount, prerequisiteOutstanding } = value;
  if (!isRecord(declaredStatusCounts)) return null;
  if (major !== null && typeof major !== "string") return null;
  if (typeof optimization !== "string") return null;
  if (typeof transcriptRecordCount !== "number") return null;
  if (!isRecord(prerequisiteOutstanding)) return null;
  if (!Object.values(declaredStatusCounts).every((count) => typeof count === "number")) return null;
  if (
    !Object.values(prerequisiteOutstanding).every(
      (missing) => Array.isArray(missing) && missing.every((code) => typeof code === "string"),
    )
  ) {
    return null;
  }
  return value as unknown as SavedPlanAssumptions;
}

function validateSource(value: unknown): SavedPlanSource | null {
  if (!isRecord(value)) {
    return null;
  }
  const { kind, detail, capturedAt } = value;
  if (kind !== "workingState" && kind !== "import" && kind !== "duplicate") {
    return null;
  }
  if (typeof detail !== "string" || typeof capturedAt !== "string") {
    return null;
  }
  return value as unknown as SavedPlanSource;
}

/**
 * Validate an untrusted saved-plan payload (library record or imported file).
 *
 * Structural identity is checked here; the planner state inside is checked by
 * the planner's own `validatePlannerStatePayload`, and catalog references are
 * resolved (not silently dropped) so the caller can show them. Stale or
 * unknown references do NOT fail validation — they are reported, because a
 * plan may still be restorable with the user's explicit confirmation.
 */
export function validateSavedPlanPayload(raw: unknown): SavedPlanValidation {
  if (!isRecord(raw)) {
    return { ok: false, reason: "A saved plan must be a JSON object." };
  }

  if (raw.schemaVersion !== SAVED_PLAN_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: `Unsupported saved-plan schema version: ${String(raw.schemaVersion)}. This library reads version ${SAVED_PLAN_SCHEMA_VERSION}.`,
    };
  }

  const { planId, name, createdAt, snapshotTakenAt, archivedAt, source, catalog, state, assumptions, preferences } = raw;

  if (typeof planId !== "string" || planId.length === 0) {
    return { ok: false, reason: "A saved plan must carry a planId string." };
  }
  if (typeof name !== "string" || name.length === 0) {
    return { ok: false, reason: "A saved plan must carry a name string." };
  }
  if (typeof createdAt !== "string" || typeof snapshotTakenAt !== "string") {
    return { ok: false, reason: "A saved plan must carry createdAt and snapshotTakenAt timestamps." };
  }
  if (archivedAt !== null && typeof archivedAt !== "string") {
    return { ok: false, reason: "A saved plan's archivedAt must be a timestamp or null." };
  }
  const validatedSource = validateSource(source);
  if (!validatedSource) {
    return { ok: false, reason: "A saved plan must carry a valid source identity." };
  }
  if (
    !isRecord(catalog) ||
    typeof catalog.fingerprint !== "string" ||
    typeof catalog.referencedCourseCount !== "number" ||
    typeof catalog.referencedSectionCount !== "number"
  ) {
    return { ok: false, reason: "A saved plan must carry its catalog identity." };
  }
  const validatedAssumptions = validateAssumptions(assumptions);
  if (!validatedAssumptions) {
    return { ok: false, reason: "A saved plan must carry its declared assumptions." };
  }

  const plannerValidation = validatePlannerStatePayload(state);
  if (!plannerValidation.ok) {
    return { ok: false, reason: `Planner state inside the saved plan is invalid: ${plannerValidation.reason}` };
  }
  const keptPreferences = preferences === undefined ? null : SavedPlanPreferencesSchema.safeParse(preferences);
  if (keptPreferences && !keptPreferences.success) {
    const [issue] = keptPreferences.error.issues;
    return { ok: false, reason: `The preferences kept with the saved plan are invalid at ${issue.path.join(".") || "the top level"}: ${issue.message}` };
  }

  const snapshot: SavedPlanSnapshot = {
    schemaVersion: SAVED_PLAN_SCHEMA_VERSION,
    planId,
    name,
    createdAt,
    snapshotTakenAt,
    archivedAt: archivedAt ?? null,
    source: validatedSource,
    catalog: {
      fingerprint: catalog.fingerprint,
      referencedCourseCount: catalog.referencedCourseCount,
      referencedSectionCount: catalog.referencedSectionCount,
    },
    state: plannerValidation.state,
    assumptions: validatedAssumptions,
    ...(keptPreferences ? { preferences: keptPreferences.data } : {}),
  };

  return { ok: true, snapshot, references: resolveSectionReferences(plannerValidation.state) };
}

function declaredStatusCounts(statuses: Record<string, CourseStatus>): Record<string, number> {
  const counts: Record<string, number> = {};
  Object.values(statuses).forEach((status) => {
    counts[status] = (counts[status] ?? 0) + 1;
  });
  return counts;
}

function prerequisiteOutstanding(state: PlannerState): Record<string, string[]> {
  const outstanding: Record<string, string[]> = {};
  Object.entries(state.courseStatuses).forEach(([courseCode, status]) => {
    if (status === "notTaken") {
      return;
    }
    const missing = getMissingPrerequisites(courseCode, state.courseStatuses, state.transcriptRecords);
    if (missing.length > 0) {
      outstanding[courseCode] = missing;
    }
  });
  return outstanding;
}

/**
 * Capture a snapshot from a (provider-normalized) planner state. The state is
 * preserved verbatim — this function reads the planner and the catalog, and
 * writes nothing.
 */
export function buildSavedPlanSnapshot(input: {
  state: PlannerState;
  name: string;
  source: Omit<SavedPlanSource, "capturedAt">;
  planId?: string;
  now?: Date;
  preferences?: SavedPlanPreferences;
}): SavedPlanSnapshot {
  const now = (input.now ?? new Date()).toISOString();
  const statusCounts = declaredStatusCounts(input.state.courseStatuses);
  const catalogIdentity = computeCatalogFingerprint(input.state);

  return {
    schemaVersion: SAVED_PLAN_SCHEMA_VERSION,
    planId: input.planId ?? crypto.randomUUID(),
    name: input.name,
    createdAt: now,
    snapshotTakenAt: input.state.updatedAt,
    archivedAt: null,
    source: { ...input.source, capturedAt: now },
    catalog: catalogIdentity,
    state: input.state,
    assumptions: {
      declaredStatusCounts: statusCounts,
      major: input.state.selectedMajor,
      optimization: input.state.optimization,
      transcriptRecordCount: input.state.transcriptRecords.length,
      prerequisiteOutstanding: prerequisiteOutstanding(input.state),
    },
    ...(input.preferences ? { preferences: input.preferences } : {}),
  };
}
