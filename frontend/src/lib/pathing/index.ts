/**
 * Requirement-scoped course pathing on top of `@/lib/prereq`.
 *
 * `unlockAnalysis` takes an explicit `RequirementSet` (the degree plan's course
 * list plus any choose-N groups) and narrows the catalog to the requirement
 * universe: the required courses plus the prerequisites they need, walked
 * downward only. Per course it derives the structural group (required /
 * prerequisite), direct and transitive unfinished unlocks read off the
 * prerequisite EXPRESSION (the cheapest viable OR branch; a satisfied
 * alternative stops unlocking), the remaining chain in terms — assuming one
 * pass per course per term and no limits on credits or course offerings — with
 * plain corequisites adding no term and grade-wrapped ones counting normally,
 * availability, and plain reasons. An unresolved prerequisite cycle surfaces as
 * null chains plus a warning and a null `remainingCriticalPath`; evidence or a
 * viable OR alternative resolves it instead.
 *
 * `recommendNextTerm` greedily packs one next term from the available universe
 * courses under a credit target. `pathingScorer` feeds the same unlock evidence
 * back into the prerequisite engine's `suggestNext`, which alone only picks
 * among the major's core courses.
 */
export { unlockAnalysis, recommendNextTerm } from "./analysis";
export { pathingScorer } from "./scorer";
export type {
  ChooseNGroup,
  CoursePathing,
  PathingAnalysis,
  PathingGroup,
  RequirementSet,
  TermRecommendation,
} from "./types";
