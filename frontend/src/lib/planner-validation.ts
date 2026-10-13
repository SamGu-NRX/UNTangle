import { majors } from "@/lib/seed-data";
import { weekDays } from "@/lib/types";
import type {
  AutoTransaction,
  CoursePlan,
  CourseStatus,
  MajorId,
  OptimizationKey,
  PlannerState,
  TranscriptAppliedStatus,
  TranscriptSourceKind,
  WeekDay,
} from "@/lib/types";

const validOptimizationKeys = new Set<OptimizationKey>([
  "clusterMorning",
  "clusterNight",
  "compact",
  "minimizeDistance",
  "maximizeProfessor",
]);

const validWeekDays = new Set<WeekDay>(weekDays);

const validCourseStatuses = new Set<CourseStatus>(["completed", "inProgress", "notTaken"]);

const validAppliedStatuses = new Set<TranscriptAppliedStatus>([
  "completed",
  "inProgress",
  "ignored",
  "needsReview",
]);

const validSourceKinds = new Set<TranscriptSourceKind>(["unt", "transfer", "exam", "current", "unknown"]);

const validMajorIds = new Set<MajorId>(majors.map((major) => major.id));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Structural validation for an untrusted planner-state payload (e.g. a JSON
 * request body). Type errors are rejected outright; value-level mistakes
 * (unknown optimization keys, statuses for non-catalog courses, malformed
 * transcript rows) are left to normalizePlannerState's semantic recovery.
 */
export function validatePlannerStatePayload(
  body: unknown,
): { ok: true; state: PlannerState } | { ok: false; reason: string } {
  if (!isRecord(body)) {
    return { ok: false, reason: "Planner state must be a JSON object." };
  }

  const courseStatuses = body.courseStatuses;
  if (
    !isRecord(courseStatuses) ||
    Object.values(courseStatuses).some((status) => typeof status !== "string")
  ) {
    return { ok: false, reason: "courseStatuses must map course codes to status strings." };
  }

  const selectedSections = body.selectedSections;
  if (
    !isRecord(selectedSections) ||
    Object.values(selectedSections).some((sectionId) => typeof sectionId !== "string")
  ) {
    return { ok: false, reason: "selectedSections must map course codes to section id strings." };
  }

  if (typeof body.optimization !== "string") {
    return { ok: false, reason: "optimization must be a string." };
  }

  if (typeof body.activeDay !== "string") {
    return { ok: false, reason: "activeDay must be a string." };
  }

  if (body.selectedMajor !== null && typeof body.selectedMajor !== "string") {
    return { ok: false, reason: "selectedMajor must be a string or null." };
  }

  if (!Array.isArray(body.transcriptRecords)) {
    return { ok: false, reason: "transcriptRecords must be an array." };
  }

  // Optional: plans saved before section locks existed have no field.
  const lockedSections = body.lockedSections;
  if (
    lockedSections !== undefined &&
    (!isRecord(lockedSections) || Object.values(lockedSections).some((sectionId) => typeof sectionId !== "string"))
  ) {
    return { ok: false, reason: "lockedSections must map course codes to section id strings when present." };
  }

  // Optional: plans saved before the Courses v2 view have no field.
  if (body.coursePlan !== undefined && body.coursePlan !== null && !isRecord(body.coursePlan)) {
    return { ok: false, reason: "coursePlan must be an object when present." };
  }

  if (body.updatedAt !== undefined && typeof body.updatedAt !== "string") {
    return { ok: false, reason: "updatedAt must be a string when present." };
  }

  return { ok: true, state: body as unknown as PlannerState };
}

function isWellFormedTranscriptRecord(record: unknown): record is PlannerState["transcriptRecords"][number] {
  if (!isRecord(record)) {
    return false;
  }

  return (
    typeof record.id === "string" &&
    record.id.length > 0 &&
    typeof record.code === "string" &&
    typeof record.title === "string" &&
    typeof record.term === "string" &&
    typeof record.grade === "string" &&
    (record.credits === null ||
      (typeof record.credits === "number" && Number.isFinite(record.credits))) &&
    typeof record.confidence === "number" &&
    Number.isFinite(record.confidence) &&
    typeof record.rationale === "string" &&
    typeof record.duplicateExcluded === "boolean" &&
    typeof record.prerequisiteSatisfied === "boolean" &&
    typeof record.reviewRequired === "boolean" &&
    typeof record.appliedStatus === "string" &&
    validAppliedStatuses.has(record.appliedStatus as TranscriptAppliedStatus) &&
    typeof record.sourceKind === "string" &&
    validSourceKinds.has(record.sourceKind as TranscriptSourceKind)
  );
}

const emptyCoursePlan = (): CoursePlan => ({ manualCredit: [], autoPlanned: [], lastAuto: null });

/**
 * Keeps only well-formed Courses-view plan facts for known course codes.
 * Anything malformed is dropped rather than trusted: the worst case is a
 * lost Undo or provenance mark, never a status the student did not choose.
 */
export function sanitizeCoursePlan(value: unknown, isCourse: (code: string) => boolean): CoursePlan {
  if (!isRecord(value)) return emptyCoursePlan();
  const codes = (list: unknown) =>
    Array.isArray(list) ? [...new Set(list.filter((code): code is string => typeof code === "string" && isCourse(code)))] : [];
  const raw = value.lastAuto;
  let lastAuto: AutoTransaction | null = null;
  if (
    isRecord(raw) &&
    typeof raw.id === "string" &&
    typeof raw.at === "string" &&
    typeof raw.summary === "string" &&
    (raw.major === null || isValidMajorId(raw.major)) &&
    Array.isArray(raw.changes) &&
    raw.changes.every(
      (change) =>
        isRecord(change) &&
        typeof change.code === "string" &&
        isCourse(change.code) &&
        isValidCourseStatus(change.from) &&
        isValidCourseStatus(change.to),
    )
  ) {
    lastAuto = {
      id: raw.id,
      at: raw.at,
      major: raw.major as MajorId | null,
      changes: (raw.changes as Array<Record<string, unknown>>).map((change) => ({
        code: change.code as string,
        from: change.from as CourseStatus,
        to: change.to as CourseStatus,
      })),
      autoPlannedBefore: codes(raw.autoPlannedBefore),
      summary: raw.summary,
      needsCheck: codes(raw.needsCheck),
      ...(typeof raw.invalidatedBy === "string" && isCourse(raw.invalidatedBy) ? { invalidatedBy: raw.invalidatedBy } : {}),
    };
  }
  return { manualCredit: codes(value.manualCredit), autoPlanned: codes(value.autoPlanned), lastAuto };
}

export function sanitizeTranscriptRecords(
  records: PlannerState["transcriptRecords"],
): PlannerState["transcriptRecords"] {
  if (!Array.isArray(records)) {
    return [];
  }

  return records.filter(isWellFormedTranscriptRecord);
}

export function isValidOptimization(value: unknown): value is OptimizationKey {
  return validOptimizationKeys.has(value as OptimizationKey);
}

export function isValidWeekDay(value: unknown): value is WeekDay {
  return validWeekDays.has(value as WeekDay);
}

export function isValidMajorId(value: unknown): value is MajorId {
  return validMajorIds.has(value as MajorId);
}

export function isValidCourseStatus(value: unknown): value is CourseStatus {
  return validCourseStatuses.has(value as CourseStatus);
}
