import type { CourseId, CourseStatus } from "@/lib/prereq";

/** Structural role of a universe course: the major's core list, an upstream feeder, or a downstream side requirement. */
export type PathingGroup = "core" | "prerequisite" | "advanced";

/** Unlock analysis for one course in the major universe. */
export type CoursePathing = {
  courseId: CourseId;
  group: PathingGroup;
  status: CourseStatus;
  credits: number;
  /** Unfinished universe courses that list this course in their prerequisite references, sorted by id. */
  readonly unlocksDirect: readonly CourseId[];
  /** Unfinished universe courses reachable through prerequisite-reference edges, sorted by id. */
  readonly unlocksTransitive: readonly CourseId[];
  /** 1 + the longest chain of unfinished dependents; 0 for done/taking courses and prerequisite-cycle members. */
  readonly remainingChain: number;
  /** True only when the status is exactly "eligible"; advisor-check ("unknown") and locked courses are never takeable. */
  readonly available: boolean;
  /** Plain reasons grounded in the numeric fields above; empty for unavailable courses. */
  readonly reasons: readonly string[];
};

export type PathingAnalysis = {
  /** Sorted ids of the major universe: connected components (via prerequisite references in either direction) that contain a core course. */
  readonly universe: readonly CourseId[];
  /** Analysis for every universe course, keyed by course id. */
  readonly courses: ReadonlyMap<CourseId, CoursePathing>;
  /** Core courses skipped because the catalog does not contain them. */
  readonly warnings: readonly string[];
  /** The longest remainingChain over unfinished universe courses (0 when there are none). */
  readonly remainingCriticalPath: number;
};

/** One course picked for the next term by the greedy credit-target plan. */
export type TermRecommendation = {
  courseId: CourseId;
  credits: number;
  group: PathingGroup;
  readonly unlocksDirect: readonly CourseId[];
  readonly unlocksTransitive: readonly CourseId[];
  readonly remainingChain: number;
  readonly reasons: readonly string[];
};
