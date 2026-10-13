import { courseReferences } from "./ast";
import type { InferenceResult, Major, Suggestion, SuggestionScorer } from "./types";

export function suggestNext(major: Major, statuses: InferenceResult, options: { maxCredits: number; scorer?: SuggestionScorer }): Suggestion[] {
  if (!Number.isFinite(options.maxCredits) || options.maxCredits < 0) throw new Error("maxCredits must be finite and nonnegative.");
  const dependents = new Map<string, Set<string>>();
  for (const course of statuses.catalog) for (const id of courseReferences(course.prerequisite)) {
    const children = dependents.get(id) ?? new Set<string>();
    children.add(course.id);
    dependents.set(id, children);
  }
  const core = new Set(major.coreCourseCodes);
  const suggestions: Suggestion[] = [];
  for (const course of statuses.catalog) {
    const status = statuses.statuses.get(course.id);
    if (!core.has(course.id) || status?.status !== "eligible") continue;
    const visited = new Set([course.id]);
    const queue = [course.id];
    for (let index = 0; index < queue.length; index++) for (const id of dependents.get(queue[index]) ?? []) {
      if (visited.has(id)) continue;
      visited.add(id);
      queue.push(id);
    }
    const downstream = [...visited].filter(id => id !== course.id && !["done", "taking"].includes(statuses.statuses.get(id)?.status ?? "unknown")).sort();
    const extra = options.scorer?.(course, status) ?? 0;
    if (!Number.isFinite(extra)) throw new Error(`Scorer returned a nonfinite value for ${course.id}`);
    suggestions.push({ courseId: course.id, credits: course.credits, downstream, score: downstream.length + extra,
      reasons: ["Eligible course in the major's core list.", `${downstream.length} unfinished downstream courses depend on this course; their other requirements still apply.`, ...(options.scorer ? [`Custom scorer contributes ${extra}.`] : [])] });
  }
  suggestions.sort((a, b) => b.score - a.score || (a.courseId < b.courseId ? -1 : a.courseId > b.courseId ? 1 : 0));
  let credits = 0;
  return suggestions.filter(course => {
    if (credits + course.credits > options.maxCredits) return false;
    credits += course.credits;
    return true;
  });
}
