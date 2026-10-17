/**
 * Every Courses-view change to the plan, as an update for the provider's
 * `updateCoursePlan`. The view and the tests run the same functions against
 * the planner's current state, so Auto ownership and Undo cannot drift
 * between what is shown and what is tested.
 */
import { getMajorById, getPlanningTermCourseCodes, normalizePlannerState, takeFromAutoRun } from "@/lib/planner";
import { suggestNext } from "@/lib/prereq";
import type { PlanTransaction } from "@/lib/planner-transaction";
import type { AutoTransaction, CoursePlan, CourseStatus, Major, MajorId, PlannerState } from "@/lib/types";
import type { SchoolProfile } from "../school";
import { computeAuto, describeAuto, undoBlocker, undoStatuses, type AutoOutcome, type AutoSource } from "./auto";
import { buildCourseModel, type CourseModel, type PlanSnapshot } from "./course-model";
import { checkDegree, stillNeeded, withDegree, type DegreeCheck } from "./degree";

export type PlanParts = { courseStatuses: Record<string, CourseStatus>; coursePlan: CoursePlan };
export type PlanUpdate = (current: PlanParts) => Partial<PlanParts>;

/**
 * The student's own edit. Any course in `touched` that the pending Auto run
 * changed now belongs to the student, so Undo is refused from here on:
 * restoring the run's old values would overwrite their choice even when the
 * value happens to match again (remove MATH 1720, then add it back by hand).
 */
export function manualEdit(
  statuses: Record<string, CourseStatus>,
  plan: (current: CoursePlan) => Partial<CoursePlan> = () => ({}),
  alsoTouched: readonly string[] = [],
): PlanUpdate {
  return (current) => {
    const next = takeFromAutoRun({ ...current.coursePlan, ...plan(current.coursePlan) }, [...Object.keys(statuses), ...alsoTouched]);
    return { courseStatuses: { ...current.courseStatuses, ...statuses }, coursePlan: next };
  };
}

/** One Auto run: its status changes, the courses it now owns, and the record Undo needs. */
export function applyAuto(outcome: AutoOutcome, run: Omit<AutoTransaction, "autoPlannedBefore">): PlanUpdate {
  const unplanned = new Set(outcome.unplanned);
  return (current) => ({
    courseStatuses: {
      ...current.courseStatuses,
      ...Object.fromEntries(outcome.changes.map((change) => [change.code, change.to])),
    },
    coursePlan: {
      ...current.coursePlan,
      autoPlanned: [...current.coursePlan.autoPlanned.filter((id) => !unplanned.has(id)), ...outcome.planned],
      lastAuto: { ...run, autoPlannedBefore: current.coursePlan.autoPlanned },
    },
  });
}

/** Undo the pending run, or change nothing when undoBlocker refuses. */
export function undoAuto(major: MajorId | null): PlanUpdate {
  return (current) => {
    const run = current.coursePlan.lastAuto;
    if (!run || undoBlocker(run, current.courseStatuses, major)) return {};
    return {
      courseStatuses: undoStatuses(run, current.courseStatuses),
      coursePlan: { ...current.coursePlan, autoPlanned: run.autoPlannedBefore, lastAuto: null },
    };
  };
}

const EMPTY_PLAN: CoursePlan = { manualCredit: [], autoPlanned: [], lastAuto: null };

/** What the course model reads from a plan. */
export function snapshotOf(plan: PlannerState): PlanSnapshot {
  const coursePlan = plan.coursePlan ?? EMPTY_PLAN;
  return {
    statuses: plan.courseStatuses,
    transcript: plan.transcriptRecords,
    planned: new Set(getPlanningTermCourseCodes(plan)),
    manualCredit: new Set(coursePlan.manualCredit),
    autoPlanned: new Set(coursePlan.autoPlanned),
  };
}

/** An update applied to a whole plan, as planner-provider's updateCoursePlan does. */
export function withPlanUpdate(plan: PlannerState, update: PlanUpdate): PlannerState {
  const coursePlan = plan.coursePlan ?? EMPTY_PLAN;
  const next = update({ courseStatuses: plan.courseStatuses, coursePlan });
  return { ...plan, courseStatuses: next.courseStatuses ?? plan.courseStatuses, coursePlan: next.coursePlan ?? coursePlan };
}

/**
 * The course model with the degree's verdict on covered courses, and the
 * degree check, for one plan and major: what Courses, Auto and Week's
 * course search read, so a course reads the same in each.
 */
export function degreeModel(profile: SchoolProfile, plan: PlannerState, major: Pick<Major, "id"> | null): { model: CourseModel; degree: DegreeCheck } {
  const snapshot = snapshotOf(plan);
  const base = buildCourseModel(profile, snapshot);
  const degree = checkDegree(profile, snapshot, base, major);
  return { model: withDegree(base, degree), degree };
}

/**
 * Courses to suggest for the planning term, best first: the ones the
 * degree audit still needs that the student can take now, in Auto's order
 * (most unfinished courses downstream). A major the audit doesn't cover
 * suggests its sample core list. Nothing without a major.
 */
export function nextTermSuggestions(profile: SchoolProfile, plan: PlannerState): string[] {
  const major = getMajorById(plan.selectedMajor) ?? null;
  if (!major) return [];
  const { model, degree } = degreeModel(profile, plan, major);
  if (degree.kind !== "audited") return [...major.coreCourseCodes];
  return suggestNext({ coreCourseCodes: [...degree.needed] }, model.inference, { maxCredits: Number.MAX_SAFE_INTEGER })
    .map((suggestion) => suggestion.courseId)
    .filter((id) => model.rows.get(id)?.status === "available");
}

/**
 * What Auto would do to a plan. The view's preview and the committing
 * transaction both call this, so they plan from the same candidates: what
 * the degree audit still needs for a major it covers, else the major's
 * sample core list.
 */
export function planAuto(profile: SchoolProfile, plan: PlannerState, major: Major): { model: CourseModel; outcome: AutoOutcome } {
  const snapshot = snapshotOf(plan);
  const { model, degree } = degreeModel(profile, plan, major);
  const source: AutoSource =
    degree.kind === "audited"
      ? { kind: "audit", waivers: degree.waivers, stillNeeded: (planned) => stillNeeded(profile, snapshot, major, planned) }
      : { kind: "sample", coreIds: major.coreCourseCodes };
  return { model, outcome: computeAuto(model, plan.courseStatuses, source, profile.autoCreditBudget) };
}

/**
 * Auto as one transaction (planner-provider's `transact`): it decides on the
 * plan as it is when it commits, not as the last render saw it, and changes
 * nothing when there is nothing to change.
 */
export function autoTransaction(profile: SchoolProfile, major: Major, run: { id: string; at: string }) {
  return (plan: PlannerState): PlanTransaction<AutoOutcome | "major-changed"> => {
    // The student changed the major while Auto waited: its picks were for the old one.
    if (plan.selectedMajor !== major.id) return { result: "major-changed" };
    const { model, outcome } = planAuto(profile, plan, major);
    if (outcome.changes.length === 0) return { result: outcome };
    const summary = describeAuto(outcome, model.hasTranscript, profile.planningTerm);
    const update = applyAuto(outcome, { ...run, major: major.id, changes: outcome.changes, summary, needsCheck: outcome.needsCheck });
    return { next: withPlanUpdate(plan, update), result: outcome };
  };
}

/** Undo of the pending Auto run as a transaction; the result says whether it ran. */
export function undoAutoTransaction(major: MajorId | null) {
  return (plan: PlannerState): PlanTransaction<boolean> => {
    const run = plan.coursePlan?.lastAuto;
    if (!run || undoBlocker(run, plan.courseStatuses, major)) return { result: false };
    return { next: withPlanUpdate(plan, undoAuto(major)), result: true };
  };
}

/** What a hand edit to one course changed, so its Undo can tell whether that is still the plan. */
export type EditReceipt = {
  id: string;
  before: { status: CourseStatus | undefined; section: string | undefined; lock: string | undefined };
  after: { status: CourseStatus | undefined; section: string | undefined; lock: string | undefined };
};

/**
 * A hand edit to one course as a transaction: its status, and optionally its
 * section, as planner-provider's setSection does (a lock moves with the pick).
 * Any edit takes the course from a pending Auto run.
 */
export function courseEdit(id: string, change: { status?: CourseStatus; section?: string }) {
  return (plan: PlannerState): PlanTransaction<EditReceipt> => {
    const before = { status: plan.courseStatuses[id], section: plan.selectedSections[id], lock: plan.lockedSections?.[id] };
    let next = withPlanUpdate(
      plan,
      manualEdit(change.status ? { [id]: change.status } : {}, (current) => ({ autoPlanned: current.autoPlanned.filter((code) => code !== id) }), [id]),
    );
    if (change.section !== undefined) {
      next = {
        ...next,
        selectedSections: { ...next.selectedSections, [id]: change.section },
        lockedSections: before.lock !== undefined ? { ...next.lockedSections, [id]: change.section } : next.lockedSections,
      };
    }
    // The plan as the next transaction will see it: normalizing drops the section of a course taken out of the plan.
    const settled = normalizePlannerState(next);
    return {
      next,
      result: { id, before, after: { status: settled.courseStatuses[id], section: settled.selectedSections[id], lock: settled.lockedSections?.[id] } },
    };
  };
}

/**
 * Puts one course back as it was before `receipt`, or refuses (false) once
 * the course has changed again. A course changed and then changed back to the
 * same values counts as unchanged, as in the WebMCP tools' Undo.
 */
export function undoCourseEdit({ id, before, after }: EditReceipt) {
  return (plan: PlannerState): PlanTransaction<boolean> => {
    // Locking or unlocking the section (in Week) is a change too: Undo would overwrite it.
    if (plan.courseStatuses[id] !== after.status || plan.selectedSections[id] !== after.section || plan.lockedSections?.[id] !== after.lock) {
      return { result: false };
    }
    const next = withPlanUpdate(plan, manualEdit({ [id]: before.status ?? "notTaken" }, () => ({}), [id]));
    const selectedSections = { ...next.selectedSections };
    if (before.section === undefined) delete selectedSections[id];
    else selectedSections[id] = before.section;
    let lockedSections = next.lockedSections;
    if (lockedSections?.[id] !== before.lock) {
      lockedSections = { ...lockedSections };
      if (before.lock === undefined) delete lockedSections[id];
      else lockedSections[id] = before.lock;
    }
    return { next: { ...next, selectedSections, lockedSections }, result: true };
  };
}
