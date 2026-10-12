import { majors } from "@/lib/seed-data";
import { weekDays } from "@/lib/types";
import type {
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
