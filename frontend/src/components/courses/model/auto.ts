/**
 * What one press of Auto changes. Statuses are already inferred live; Auto's
 * job is the plan: drop planned courses the evidence says are finished, then
 * fill the term budget with the engine's ranked eligible core courses.
 * Every change records its previous value so Undo restores it exactly.
 */
import { suggestNext } from "@/lib/prereq";
import type { CourseStatus as PlannerCourseStatus } from "@/lib/types";
import type { CourseModel } from "./course-model";

export type StatusChange = { id: string; from: PlannerCourseStatus | undefined; to: PlannerCourseStatus };

export type AutoOutcome = {
  changes: StatusChange[];
  planned: string[];
  unplanned: string[];
  /** Core courses the engine could not clear; Auto leaves them to the student. */
  needsCheck: string[];
  filled: { done: number; taking: number; covered: number };
};

export function computeAuto(
  model: CourseModel,
  statuses: Readonly<Record<string, PlannerCourseStatus>>,
  coreIds: readonly string[],
  creditBudget: number,
): AutoOutcome {
  const rows = model.rows;
  const changes: StatusChange[] = [];
  const unplanned: string[] = [];
  for (const [id, status] of Object.entries(statuses)) {
    const row = rows.get(id);
    if (status !== "inProgress" || !row) continue;
    if (row.assessment?.status === "done" || (row.coveredBy && row.status !== "taking")) {
      changes.push({ id, from: status, to: "notTaken" });
      unplanned.push(id);
    }
  }
  const unplannedSet = new Set(unplanned);
  const stillPlanned = [...rows.values()].filter((row) => row.status === "planned" && !unplannedSet.has(row.id));
  let credits = stillPlanned.reduce((sum, row) => sum + row.credits, 0);
  const plannedIds = new Set(stillPlanned.map((row) => row.id));

  const ranked = suggestNext({ coreCourseCodes: coreIds }, model.inference, { maxCredits: Number.MAX_SAFE_INTEGER });
  const planned: string[] = [];
  for (const suggestion of ranked) {
    const row = rows.get(suggestion.courseId);
    if (!row || row.status !== "available" || plannedIds.has(row.id)) continue;
    if (credits + row.credits > creditBudget) continue;
    credits += row.credits;
    planned.push(row.id);
    changes.push({ id: row.id, from: statuses[row.id], to: "inProgress" });
  }

  const finishedOrPlanned = new Set([...plannedIds, ...planned]);
  const needsCheck = coreIds.filter((id) => rows.get(id)?.status === "check" && !finishedOrPlanned.has(id));
  const all = [...rows.values()];
  return {
    changes,
    planned,
    unplanned,
    needsCheck,
    filled: {
      done: all.filter((row) => row.status === "done" && !row.override).length,
      taking: all.filter((row) => row.status === "taking").length,
      covered: all.filter((row) => row.status === "covered").length,
    },
  };
}

export function undoChanges(changes: readonly StatusChange[]): StatusChange[] {
  return changes.map((change) => ({ id: change.id, from: change.to, to: change.from ?? "notTaken" }));
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** One line for the AutoNote. */
export function describeAuto(outcome: AutoOutcome, hasTranscript: boolean, term: string): string {
  const { done, taking, covered } = outcome.filled;
  const found = done + taking + covered;
  const first = !hasTranscript
    ? "No transcript yet, so nothing is marked done."
    : `Filled ${plural(found, "course")} from your transcript${covered > 0 ? `, ${covered} through prerequisites` : ""}.`;
  const plannedCount = outcome.planned.length;
  const second =
    plannedCount > 0
      ? `Planned ${plannedCount} for ${term}.`
      : outcome.unplanned.length > 0
        ? `Nothing new to plan for ${term}.`
        : `Nothing to plan for ${term} yet.`;
  const third = outcome.unplanned.length > 0 ? `Removed ${outcome.unplanned.length} you no longer need.` : "";
  return [first, second, third].filter(Boolean).join(" ");
}
