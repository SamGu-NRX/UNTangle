/**
 * Degree-plan pathing on top of `@/lib/prereq`.
 *
 * A `RequirementSet` is a degree plan in the catalog's own shapes: required
 * courses, choose-N courses, choose-N hours, rule-defined pools, and choices
 * between branches. `unlockAnalysis` scores every course in the plan's
 * downward prerequisite closure: what it unlocks on the remaining path, how
 * many terms it is away, and whether it sits on the critical path.
 * `recommendNextTerm` packs one next term from eligible courses, and
 * `pathingScorer` feeds the same evidence to `suggestNext`.
 */
export { unlockAnalysis, recommendNextTerm } from "./analysis";
export { pathingScorer } from "./scorer";
export type {
  CoursePathing,
  CoursePattern,
  PathingAnalysis,
  Requirement,
  RequirementBranch,
  RequirementProgress,
  RequirementSet,
  TermRecommendation,
} from "./types";
