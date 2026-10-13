/**
 * Turns the plan (persisted statuses + transcript rows) into what each row
 * shows. Status is inferred on every call; nothing here writes state.
 *
 * The planner stores three statuses per course plus `coursePlan`:
 * - `coursePlan.manualCredit` is the student saying "I have credit for
 *   this", honored as a `done` override even when a transcript row says
 *   otherwise. "completed" with no transcript row (v1 data) counts the same.
 * - the plan for the planning term is the planner's own selector
 *   (getPlanningTermCourseCodes): "inProgress" with no current transcript row.
 * - everything else comes from the engine.
 */
import { inferStatuses, type CourseAssessment, type Evidence, type InferenceResult } from "@/lib/prereq";
import type { CourseStatus as PlannerCourseStatus, TranscriptCourseRecord } from "@/lib/types";
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
  /** In the plan for the planning term, whatever the row shows. */
  inPlan: boolean;
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
  /** getPlanningTermCourseCodes(plannerState). */
  planned: ReadonlySet<string>;
  manualCredit: ReadonlySet<string>;
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
  const manualDone = new Set([
    ...plan.manualCredit,
    ...Object.entries(plan.statuses)
      .filter(([id, status]) => status === "completed" && !withRows.has(id))
      .map(([id]) => id),
  ]);
  const overrides = new Map(
    [...manualDone].map((id) => [id, { status: "done" as const, reason: "You marked this done." }]),
  );
  // The plan for the planning term; the engine lets it satisfy plain co-requisites only.
  return { evidence: { ...base, overrides, planned: [...plan.planned] }, manualDone };
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
  // Courses closure satisfies, as the engine decided them (no second copy of its rules).
  const covered = inference.coverage;
  const prerequisites = new Map(profile.catalog.map((course) => [course.id, course.prerequisite]));

  const rows = new Map<string, CourseRowModel>();
  for (const entry of profile.entries.values()) {
    const assessment = inference.statuses.get(entry.id);
    const prerequisite = prerequisites.get(entry.id);
    const rule = prerequisite ? ruleFromPrerequisite(prerequisite) : null;
    const engine = assessment?.status ?? "unknown";
    const planned = plan.planned.has(entry.id);
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
      inPlan: planned,
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

/** Counted as done in group headers: credit only. Covered courses are counted separately. */
export const isFinished = (row: CourseRowModel) => row.status === "done";
/** Can be added to the plan from a row or the palette without an override. */
export const isPlannable = (row: CourseRowModel) => row.status === "available";

export type CourseGroupModel = { key: string; label: string; ids: string[]; finished: number; covered: number; tag?: string };

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
  const covered = (ids: string[]) => ids.filter((id) => model.rows.get(id)!.status === "covered").length;
  const groups: CourseGroupModel[] = [];
  if (core.length > 0) {
    groups.push({ key: "core", label: "Core", ids: core, finished: finished(core), covered: covered(core), tag: "Sample degree plan" });
  }
  for (const department of departments) {
    const ids = byDepartment.get(department)!.sort();
    groups.push({ key: `dept:${department}`, label: department, ids, finished: finished(ids), covered: covered(ids) });
  }
  return groups;
}
