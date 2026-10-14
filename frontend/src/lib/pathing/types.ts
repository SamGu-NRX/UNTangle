import type { CourseId, CourseStatus } from "@/lib/prereq";

/** A catalog rule that names courses by subject and level instead of listing them, such as "any 4000-level TECM course". */
export type CoursePattern = {
  readonly subject: string;
  /** Course numbers from `level` up to `level + 999`. */
  readonly level: number;
};

/** One part of a degree plan, in the shapes the UNT catalog uses. */
export type Requirement =
  /** Every listed course. */
  | { readonly kind: "all"; readonly name: string; readonly courses: readonly CourseId[] }
  /**
   * `count` of the listed courses; a one-of alternative is `count: 1`.
   * `companions` names courses an option must be passed with, such as a
   * lecture's lab; the option counts only once all of them are credited.
   */
  | {
      readonly kind: "choose";
      readonly name: string;
      readonly count: number;
      readonly options: readonly CourseId[];
      readonly companions?: Readonly<Record<CourseId, readonly CourseId[]>>;
    }
  /** Listed courses adding up to at least `hours` credit hours. */
  | { readonly kind: "hours"; readonly name: string; readonly hours: number; readonly options: readonly CourseId[] }
  /**
   * `hours` credit hours from courses the catalog defines by rule. Without a
   * `match` the plan data has no way to tell which courses count, so the pool is
   * never marked met and a warning says an advisor must confirm it.
   */
  | { readonly kind: "pool"; readonly name: string; readonly hours: number; readonly match?: CoursePattern }
  /** One branch completed in full, such as the capstone or the senior thesis. */
  | { readonly kind: "choice"; readonly name: string; readonly branches: readonly RequirementBranch[] };

export type RequirementBranch = { readonly name: string; readonly requirements: readonly Requirement[] };

/** A degree plan: the explicit scope of every analysis. */
export type RequirementSet = {
  readonly name: string;
  /** Where the plan was copied from, and when. */
  readonly source?: string;
  /** Catalog rules this data does not check. Each one is repeated as a warning on every analysis. */
  readonly notChecked?: readonly string[];
  readonly requirements: readonly Requirement[];
};

/** How far a student is through one top-level requirement. */
export type RequirementProgress = {
  readonly name: string;
  readonly kind: Requirement["kind"];
  readonly met: boolean;
  /** Courses or hours already counted. For a choice, the met requirements of `branch`. */
  readonly done: number;
  readonly target: number;
  readonly unit: "courses" | "hours" | "requirements";
  /**
   * Terms until it can be met along its shortest route; 0 when met, null when
   * no route exists. When `tracked` is false this counts only the part the data
   * can measure.
   */
  readonly remainingTerms: number | null;
  /** False when the plan data or catalog cannot measure part of it, such as an elective pool with no course list. */
  readonly tracked: boolean;
  /** For a choice, the branch the analysis follows: the started one, else the first reachable one needing no advisor. */
  readonly branch: string | null;
};

/** Unlock analysis for one course in the requirement universe. */
export type CoursePathing = {
  readonly courseId: CourseId;
  readonly status: CourseStatus;
  readonly credits: number;
  /** Name of the top-level requirement that lists the course; null when it is only a prerequisite. */
  readonly group: string | null;
  /** Remaining-path courses whose shortest prerequisite route needs this course, sorted by id. */
  readonly unlocksDirect: readonly CourseId[];
  /** Remaining-path courses that need this course directly or through other such needs, sorted by id. */
  readonly unlocksTransitive: readonly CourseId[];
  /**
   * Terms until this course is complete, counting next term as 1, assuming a
   * pass every term and no credit or offering limits. 0 for done and in-progress
   * courses; null when no prerequisite route exists, as in an unbroken cycle.
   */
  readonly remainingChain: number | null;
  /**
   * On a shortest route whose length equals the remaining critical path. When
   * two OR alternatives tie, both are flagged, though delaying only one of them
   * would not delay graduation.
   */
  readonly onCriticalPath: boolean;
  /** Unfinished, and either counts toward an unmet requirement or lies on the shortest route to one. */
  readonly onRemainingPath: boolean;
  /** Status is exactly "eligible". Advisor-check ("unknown") and locked courses are never available. */
  readonly available: boolean;
  /** One plain line on why the course matters; null when it is off the remaining path. */
  readonly reason: string | null;
};

export type PathingAnalysis = {
  /** Sorted ids of every listed course in the catalog plus their downward prerequisite closure. */
  readonly universe: readonly CourseId[];
  readonly courses: ReadonlyMap<CourseId, CoursePathing>;
  /** One entry per top-level requirement, in plan order. */
  readonly requirements: readonly RequirementProgress[];
  /**
   * The longest remainingTerms over unmet requirements: 0 when all are met,
   * null when one has no route. Parts the data cannot measure add nothing.
   */
  readonly remainingCriticalPath: number | null;
  /**
   * Courses on a shortest remaining route that are one term away and have
   * status "unknown" with no clause the engine already knows is unmet, ranked
   * like recommendations. An advisor must clear each before a student takes it.
   * Alternatives off the shortest route are left out, because the route
   * already has a course the student can take or clear instead.
   */
  readonly advisorChecks: readonly CourseId[];
  readonly warnings: readonly string[];
};

/** One course picked for the next term. */
export type TermRecommendation = {
  readonly courseId: CourseId;
  readonly credits: number;
  readonly group: string | null;
  readonly unlocksDirect: readonly CourseId[];
  readonly unlocksTransitive: readonly CourseId[];
  readonly remainingChain: number | null;
  readonly onCriticalPath: boolean;
  readonly reason: string;
};
