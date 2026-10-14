/**
 * Major-aware course pathing on top of `@/lib/prereq`.
 *
 * `unlockAnalysis` narrows the catalog to the major universe (the connected
 * components that contain a core course) and derives, per course: the structural
 * group (core / prerequisite / advanced), direct and transitive unfinished
 * unlocks, the remaining chain to graduation, availability, and plain reasons.
 * `recommendNextTerm` greedily packs one next term from the available universe
 * courses under a credit target. `pathingScorer` feeds the same unlock evidence
 * back into the prerequisite engine's `suggestNext`.
 */
export { unlockAnalysis, recommendNextTerm } from "./analysis";
export { pathingScorer } from "./scorer";
export type { CoursePathing, PathingAnalysis, PathingGroup, TermRecommendation } from "./types";
