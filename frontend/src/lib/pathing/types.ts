import type { CourseId, CourseStatus } from "@/lib/prereq";

/** Structural role of a universe course: on the degree plan's requirement list, or a prerequisite of one. */
export type PathingGroup = "required" | "prerequisite";

/**
 * A choose-N-of group from the degree plan. Groups never join the critical path
 * (which elective wins is a student decision, not a graph fact) but they are
 * echoed on the analysis so reports can list them with the catalog's own wording.
 */
export type ChooseNGroup = {
  name: string;
  options: readonly CourseId[];
  choose: number;
};

/**
 * The degree-plan scope for one analysis: the courses required outright, plus
 * any choose-N groups. The universe is the required courses plus the
 * prerequisites they need, walked downward only.
 */
export type RequirementSet = {
  readonly requiredCourseIds: readonly CourseId[];
  readonly chooseNGroups?: readonly ChooseNGroup[];
};

/** Unlock analysis for one course in the requirement universe. */
export type CoursePathing = {
  courseId: CourseId;
  group: PathingGroup;
  status: CourseStatus;
  credits: number;
  /** Unfinished universe courses whose cheapest viable prerequisite branch needs this course, sorted by id. */
  readonly unlocksDirect: readonly CourseId[];
  /** Unfinished universe courses that need this course directly or through such needs, sorted by id. */
  readonly unlocksTransitive: readonly CourseId[];
  /**
   * Terms still needed before this course itself can be taken, assuming one pass
   * per course per term and no limits on credits or course offerings. Null when
   * an unresolved prerequisite cycle blocks it; 0 for done and taking courses.
   */
  readonly remainingChain: number | null;
  /** True only when the status is exactly "eligible"; advisor-check ("unknown") and locked courses are never takeable. */
  readonly available: boolean;
  /** Plain reasons grounded in the numeric fields above; empty for unavailable courses. */
  readonly reasons: readonly string[];
};

export type PathingAnalysis = {
  /** Sorted ids of the requirement universe: required courses plus their downward prerequisite closure. */
  readonly universe: readonly CourseId[];
  /** Analysis for every universe course, keyed by course id. */
  readonly courses: ReadonlyMap<CourseId, CoursePathing>;
  /** Required courses skipped because the catalog does not contain them, plus unresolved-cycle notices. */
  readonly warnings: readonly string[];
  /** Choose-N groups from the requirement set, echoed for reports; never on the critical path. */
  readonly chooseNGroups: readonly ChooseNGroup[];
  /**
   * The longest remainingChain over unfinished required courses (0 when there
   * are none), or null when an unresolved prerequisite cycle blocks one of them.
   */
  readonly remainingCriticalPath: number | null;
};

/** One course picked for the next term by the greedy credit-target plan. */
export type TermRecommendation = {
  courseId: CourseId;
  credits: number;
  group: PathingGroup;
  readonly unlocksDirect: readonly CourseId[];
  readonly unlocksTransitive: readonly CourseId[];
  readonly remainingChain: number | null;
  readonly reasons: readonly string[];
};
