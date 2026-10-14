import type { InferenceResult, SuggestionScorer } from "@/lib/prereq";
import { unlockAnalysis } from "./analysis";
import type { RequirementSet } from "./types";

/**
 * Scorer seam for `suggestNext`.
 *
 * `suggestNext` alone only considers the major's eligible CORE courses, while
 * this scorer adds requirement-universe unlock evidence for callers that want
 * breadth-aware core-course picking: the score is the course's unfinished
 * transitive unlock count within the requirement universe.
 *
 * Courses on the longest remaining chain get a bounded bonus of 0.5. The bonus
 * is strictly below 1, so a one-course unlock advantage always outweighs it and
 * only reorders courses whose transitive unlock counts tie. The output is
 * always a finite number (0 for finished courses), as `suggestNext` requires.
 */
export function pathingScorer(requirements: RequirementSet, statuses: InferenceResult): SuggestionScorer {
  const analysis = unlockAnalysis(requirements, statuses);
  return (course, assessment) => {
    if (assessment.status === "done" || assessment.status === "taking") return 0;
    const entry = analysis.courses.get(course.id);
    if (!entry) return 0;
    const onLongestChain = entry.remainingChain !== null && entry.remainingChain > 0 && entry.remainingChain === analysis.remainingCriticalPath;
    return entry.unlocksTransitive.length + (onLongestChain ? 0.5 : 0);
  };
}
