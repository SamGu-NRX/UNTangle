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
  /**
   * The course that covers this one, when the degree audit still lists this
   * one as needed (CSCE 1030 once CSCE 1040 is passed). Only an advisor can
   * waive it, so the row reads "check", never done. Set by withDegree.
   */
  waiver: string | null;
  /** On the student's transcript, as any record (passed, in progress or waiting for review). */
  onTranscript: boolean;
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
  /**
   * The course's prerequisites assessed as if the student had no record of
   * the course itself. The engine stops at "taking" or "done" for a course
   * on the record, so this is how the detail says whether the rule was met.
   */
  assessWithoutRecord: (id: string) => CourseAssessment | undefined;
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

/** Courses the student marked done by hand: manual credit, and "completed" with no transcript row (v1 data). */
export function manualDoneIds(profile: SchoolProfile, plan: Pick<PlanSnapshot, "statuses" | "transcript" | "manualCredit">): Set<string> {
  const withRows = transcriptCodes(profile, plan.transcript);
  return new Set([
    ...plan.manualCredit,
    ...Object.entries(plan.statuses)
      .filter(([id, status]) => status === "completed" && !withRows.has(id))
      .map(([id]) => id),
  ]);
}

export function buildEvidence(profile: SchoolProfile, plan: PlanSnapshot): { evidence: Evidence; manualDone: Set<string> } {
  const base = profile.evidenceFromTranscript(plan.transcript);
  const manualDone = manualDoneIds(profile, plan);
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
  const onTranscript = transcriptCodes(profile, plan.transcript);

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
      meta = { kind: "text", text: profile.planningTerm };
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
      waiver: null,
      onTranscript: onTranscript.has(entry.id),
    });
  }
  // Lazy and cached: one extra inference per course the detail asks about.
  const withoutRecord = new Map<string, CourseAssessment | undefined>();
  const assessWithoutRecord = (id: string) => {
    if (!withoutRecord.has(id)) {
      const overrides = new Map(evidence.overrides);
      overrides.delete(id);
      const without: Evidence = {
        ...evidence,
        transcript: evidence.transcript?.filter((completion) => completion.courseId !== id),
        inProgress: evidence.inProgress?.filter((code) => code !== id),
        overrides,
      };
      withoutRecord.set(id, inferStatuses(profile.catalog, without, profile.adapter).statuses.get(id));
    }
    return withoutRecord.get(id);
  };
  return { rows, inference, hasTranscript: plan.transcript.some((record) => !record.duplicateExcluded), assessWithoutRecord };
}
