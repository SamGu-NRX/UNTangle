import type { InferenceResult, Major, SuggestionScorer } from "@/lib/prereq";
import { unlockAnalysis } from "./analysis";

/**
 * Scorer seam for `suggestNext`.
 *
 * `suggestNext` alone only considers the major's eligible CORE courses, while this
 * scorer adds major-universe unlock evidence for callers that want breadth-aware
 * core-course picking: the score is the course's unfinished transitive unlock
 * count within the major universe.
 *
 * Courses on the longest remaining chain get a bounded bonus of 1. The bonus is
 * bounded so it only reorders courses whose transitive unlock counts tie; a
 * one-course unlock advantage always outweighs it. The output is always a finite
 * number (0 for finished courses), as `suggestNext` requires.
 */
export function pathingScorer(major: Major, statuses: InferenceResult): SuggestionScorer {
  const analysis = unlockAnalysis(major, statuses);
  return (course, assessment) => {
    if (assessment.status === "done" || assessment.status === "taking") return 0;
    const entry = analysis.courses.get(course.id);
    if (!entry) return 0;
    const onLongestChain = entry.remainingChain > 0 && entry.remainingChain === analysis.remainingCriticalPath;
    return entry.unlocksTransitive.length + (onLongestChain ? 1 : 0);
  };
}
