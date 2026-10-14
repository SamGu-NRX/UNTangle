import type { InferenceResult, SuggestionScorer } from "@/lib/prereq";
import { unlockAnalysis } from "./analysis";
import type { RequirementSet } from "./types";

/**
 * Plan-aware scores for `suggestNext`: 1 for being on the remaining path, plus
 * the course's transitive unlocks there, plus 0.5 when it sits on the critical
 * path, so one more unlock always outranks the bonus. Courses off the
 * remaining path, including finished ones, score 0.
 *
 * `suggestNext` adds this to its own count of catalog-wide dependents, which
 * is below the catalog's size. Scaling by the catalog size plus one keeps even
 * a half-point difference larger than that count, so the plan evidence decides
 * the order and the catalog count only breaks ties.
 */
export function pathingScorer(requirements: RequirementSet, statuses: InferenceResult): SuggestionScorer {
  const analysis = unlockAnalysis(requirements, statuses);
  const scale = 2 * (statuses.catalog.length + 1);
  return (course) => {
    const entry = analysis.courses.get(course.id);
    if (!entry?.onRemainingPath) return 0;
    return scale * (1 + entry.unlocksTransitive.length + (entry.onCriticalPath ? 0.5 : 0));
  };
}
