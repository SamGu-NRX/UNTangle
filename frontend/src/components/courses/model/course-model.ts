/**
 * Turns the plan (persisted statuses + transcript rows) into what each row
 * shows. Status is inferred on every call; nothing here writes state.
 *
 * The planner stores three statuses per course. Their meaning in v2:
 * - "completed" with no transcript row is the student saying "I have credit"
 *   (an override the engine honors as `done`).
 * - "inProgress" is a course in the plan for the planning term, except when
 *   the transcript says the student is taking it now.
 * - everything else comes from the engine.
 */
import { inferStatuses, type CourseAssessment, type Evidence, type InferenceResult } from "@/lib/prereq";
import type { CourseStatus as PlannerCourseStatus, TranscriptCourseRecord } from "@/lib/types";
import { coveredByCompletion } from "./closure";
import { onlyCheckable, ruleFromPrerequisite, unmetFromReason, type RuleNode } from "./rules";
import type { CatalogEntry, SchoolProfile } from "../school";

export type RowStatus = "done" | "taking" | "planned" | "covered" | "available" | "locked" | "check";

export type RowMeta =
  | { kind: "none" }
  | { kind: "grade"; term: string; grade: string }
  | { kind: "text"; text: string }
  | { kind: "needs"; rule: RuleNode }
  | { kind: "via"; id: string };

export type CourseRowModel = CatalogEntry & {
  status: RowStatus;
  /** The student set this, against or without the evidence. */
  override: boolean;
  /** Planned by Auto rather than by hand. */
  auto: boolean;
  meta: RowMeta;
  assessment: CourseAssessment | undefined;
  /** The catalog requirement as written, or null when there is none. */
  rule: RuleNode | null;
  /** What still blocks it (locked and check rows). */
  unmet: RuleNode | null;
  coveredBy: string | null;
};

export type PlanSnapshot = {
  statuses: Readonly<Record<string, PlannerCourseStatus>>;
  transcript: readonly TranscriptCourseRecord[];
  autoPlanned: ReadonlySet<string>;
};

export type CourseModel = {
  rows: ReadonlyMap<string, CourseRowModel>;
  inference: InferenceResult;
  hasTranscript: boolean;
};

export const statusLabels: Record<RowStatus, string> = {
  done: "Done",
  taking: "Taking",
  planned: "Planned",
  covered: "Covered",
  available: "Available",
  locked: "Locked",
  check: "Check",
};

export function buildEvidence(profile: SchoolProfile, plan: PlanSnapshot): { evidence: Evidence; manualDone: Set<string> } {
  const base = profile.evidenceFromTranscript(plan.transcript);
  const withRows = transcriptCodes(profile, plan.transcript);
  const manualDone = new Set(
    Object.entries(plan.statuses)
      .filter(([id, status]) => status === "completed" && !withRows.has(id))
      .map(([id]) => id),
  );
  const overrides = new Map(
    [...manualDone].map((id) => [id, { status: "done" as const, reason: "You marked this done." }]),
  );
  return { evidence: { ...base, overrides }, manualDone };
}

function transcriptCodes(profile: SchoolProfile, records: readonly TranscriptCourseRecord[]) {
  return new Set(
    records.filter((record) => !record.duplicateExcluded).flatMap((record) => profile.normalizeId(record.code) ?? []),
  );
}

function latestPassing(profile: SchoolProfile, records: readonly TranscriptCourseRecord[], id: string) {
  const rows = records.filter(
    (record) =>
      !record.duplicateExcluded &&
      record.appliedStatus === "completed" &&
      profile.normalizeId(record.code) === id &&
      profile.adapter.isPassingGrade(record.grade) === true,
  );
  return rows.at(-1);
}

export function buildCourseModel(profile: SchoolProfile, plan: PlanSnapshot): CourseModel {
  const { evidence, manualDone } = buildEvidence(profile, plan);
  const inference = inferStatuses(profile.catalog, evidence, profile.adapter);
  const done = new Set([...inference.statuses.values()].filter((a) => a.status === "done").map((a) => a.courseId));
  const withRows = transcriptCodes(profile, plan.transcript);
  const blocked = new Set([...withRows].filter((id) => !done.has(id)));
  const covered = coveredByCompletion(profile.catalog, done, blocked);
  const prerequisites = new Map(profile.catalog.map((course) => [course.id, course.prerequisite]));

  const rows = new Map<string, CourseRowModel>();
  for (const entry of profile.entries.values()) {
    const assessment = inference.statuses.get(entry.id);
    const prerequisite = prerequisites.get(entry.id);
    const rule = prerequisite ? ruleFromPrerequisite(prerequisite) : null;
    const engine = assessment?.status ?? "unknown";
    const planned = plan.statuses[entry.id] === "inProgress";
    const coveredBy = covered.get(entry.id) ?? null;
    const unmet = engine === "locked" || engine === "unknown" ? (assessment ? unmetFromReason(assessment.reason) : null) : null;

    let status: RowStatus;
    let meta: RowMeta = { kind: "none" };
    let override = false;
    if (engine === "done") {
      status = "done";
      override = manualDone.has(entry.id);
      const row = latestPassing(profile, plan.transcript, entry.id);
      meta = row ? { kind: "grade", term: row.term, grade: row.grade } : { kind: "text", text: "You marked this" };
    } else if (engine === "taking") {
      status = "taking";
      meta = { kind: "text", text: "This term" };
    } else if (planned) {
      status = "planned";
      // Planned while the engine has not cleared it: the student's call.
      override = engine !== "eligible" && !coveredBy;
      meta = { kind: "text", text: plan.autoPlanned.has(entry.id) ? `${profile.planningTerm} · auto` : profile.planningTerm };
    } else if (coveredBy) {
      status = "covered";
      meta = { kind: "via", id: coveredBy };
    } else if (engine === "eligible") {
      status = "available";
    } else if (engine === "locked") {
      status = "locked";
      const needs = onlyCheckable(unmet);
      meta = needs ? { kind: "needs", rule: needs } : { kind: "text", text: "Prerequisites not met" };
    } else {
      status = "check";
      const needs = onlyCheckable(unmet);
      meta = needs ? { kind: "needs", rule: needs } : { kind: "text", text: "Ask an advisor" };
    }

    rows.set(entry.id, {
      ...entry,
      status,
      override,
      auto: status === "planned" && plan.autoPlanned.has(entry.id),
      meta,
      assessment,
      rule,
      unmet,
      coveredBy,
    });
  }
  return { rows, inference, hasTranscript: plan.transcript.some((record) => !record.duplicateExcluded) };
}

/** Counted as finished in group headers: credit, or covered by a passed course. */
export const isFinished = (row: CourseRowModel) => row.status === "done" || row.status === "covered";
/** Can be added to the plan from a row or the palette without an override. */
export const isPlannable = (row: CourseRowModel) => row.status === "available";

export type CourseGroupModel = { key: string; label: string; ids: string[]; finished: number; tag?: string };

export function buildGroups(model: CourseModel, coreIds: readonly string[], majorDepartment: string | null): CourseGroupModel[] {
  const core = coreIds.filter((id) => model.rows.has(id));
  const coreSet = new Set(core);
  const byDepartment = new Map<string, string[]>();
  for (const row of model.rows.values()) {
    if (coreSet.has(row.id)) continue;
    byDepartment.set(row.department, [...(byDepartment.get(row.department) ?? []), row.id]);
  }
  const departments = [...byDepartment.keys()].sort((a, b) =>
    a === majorDepartment ? -1 : b === majorDepartment ? 1 : a.localeCompare(b),
  );
  const finished = (ids: string[]) => ids.filter((id) => isFinished(model.rows.get(id)!)).length;
  const groups: CourseGroupModel[] = [];
  if (core.length > 0) groups.push({ key: "core", label: "Core", ids: core, finished: finished(core), tag: "Sample degree plan" });
  for (const department of departments) {
    const ids = byDepartment.get(department)!.sort();
    groups.push({ key: `dept:${department}`, label: department, ids, finished: finished(ids) });
  }
  return groups;
}
