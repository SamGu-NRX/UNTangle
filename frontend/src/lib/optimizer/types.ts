/**
 * Contract of the schedule optimizer.
 *
 * The optimizer takes a list of candidate courses (each with its sections),
 * the student's hard constraints and preference weights, and returns up to k
 * ranked, meaningfully different schedules, or a proof that none exists with
 * a short explanation. It knows nothing about the catalog, the planner state
 * or the UI: `planner.ts` adapts those, and a future course-suggestion step
 * can feed it a different course list the same way.
 *
 * Time conventions: minutes after midnight, half-open intervals
 * `[start, end)`. A class ending at 10:00 and one starting at 10:00 do not
 * overlap.
 *
 * This module imports nothing at runtime, so the engine can be copied and
 * mutated by the mutation tests (tests/optimizer/mutation.test.ts).
 */

export const OPT_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export type OptDay = (typeof OPT_DAYS)[number];

/**
 * Inclusive calendar dates, ISO `YYYY-MM-DD`, such as an eight-week session
 * (2027-01-11 to 2027-03-05).
 */
export type OptDateRange = { start: string; end: string };

/**
 * Walking time between two buildings. Structurally the same as
 * `WalkingTime` in `planner-walking.ts` and the campus routing result, so
 * either can be passed in. `unknown` is never treated as 0 seconds.
 */
export type OptWalkingTime =
  | { seconds: number; source: "campus-network" | "straight-line" }
  | { seconds: null; source: "unknown" };

export type OptWalkingTimeFn = (fromBuildingId: string, toBuildingId: string) => OptWalkingTime;

export type OptMeeting = {
  day: OptDay;
  start: number;
  end: number;
  /** null when the catalog has no mapped building. */
  buildingId: string | null;
  /**
   * Place used to decide whether a walk exists. `"online"` is never a walk;
   * an unmapped room uses its building code; null means an unassigned room.
   * Older synthetic requests may omit it, which falls back to buildingId.
   */
  place?: string | null;
  /**
   * Inclusive activity range; absent or null uses the request's term.
   * Meetings share activity only on actual occurrences of their weekday
   * inside both ranges. Dated ranges are not clipped to the term (see weeks.ts).
   * Time-of-day limits, days off and blocked times apply whatever the dates.
   */
  dates?: OptDateRange | null;
};

/**
 * A final exam sitting: an ISO date and minutes after midnight, half-open
 * `[start, end)`. Two sections whose exams share a minute on the same date
 * can't be in one schedule, like two classes that overlap.
 */
export type OptExam = { date: string; start: number; end: number };

export type OptSection = {
  id: string;
  courseCode: string;
  meetings: OptMeeting[];
  /** Instructor rating 0..5, or null when there is none. */
  rating: number | null;
  /**
   * Mean grade points of this instructor's past students in this course, in
   * hundredths (3.27 is 327), a whole number from 0 to 400, from accepted
   * grade-history evidence (a confident instructor match with enough graded
   * sections; the caller decides what counts as accepted). Null or absent
   * when there is none: unknown evidence never satisfies the instructor
   * tie-break, which leaves a course out entirely when any of its options
   * lacks evidence (docs/architecture/README.md). Grade history never
   * enters `rating`.
   */
  instructorGpaHundredths?: number | null;
  /** How a student refers to the section, such as "002"; defaults to the id. */
  label?: string;
  /**
   * The section's final exam. Absent or null when it isn't known: such a
   * section clashes with no exam, and the caller says the check didn't
   * cover it.
   */
  exam?: OptExam | null;
};

export type OptCourse = {
  code: string;
  credits: number;
  sections: OptSection[];
};

/** A time the student must keep free, such as a job or practice. */
export type OptBlockedTime = {
  id: string;
  label: string;
  day: OptDay;
  start: number;
  end: number;
  /**
   * The real date ranges the block applies to, when it is not weekly
   * (calendar busy time). Absent, null or empty means every week. A meeting
   * is only blocked when its own dates (or the request's term dates) overlap
   * a range that also covers the block's weekday.
   */
  dates?: OptDateRange[] | null;
};

/**
 * Hard constraints. Every one is all-or-nothing: a schedule that breaks one
 * is never returned.
 */
export type OptConstraints = {
  /** No class may start before this minute. */
  earliestStart: number | null;
  /** No class may end after this minute. */
  latestEnd: number | null;
  /** No class on these days. */
  daysOff: OptDay[];
  /** No class may overlap one of these ranges. */
  blocked: OptBlockedTime[];
  /** Total credits may not exceed this. */
  maxCredits: number | null;
  /**
   * Walking between back-to-back classes in different buildings must fit in
   * the break between them, plus `bufferMinutes` to spare. null turns the
   * check off. See `transferFits` in score.ts for the exact rule.
   */
  walking: { bufferMinutes: number } | null;
};

/**
 * Preference weights, each an integer 0..MAX_WEIGHT (0 = ignore). They are
 * multiplied with the human-unit terms in score.ts.
 */
export type OptWeights = {
  /** Fewer distinct days with a class. */
  fewerDays: number;
  /** Fewer idle minutes between classes on the same day. */
  compact: number;
  /** Classes earlier in the day. */
  mornings: number;
  /** Classes later in the day. */
  evenings: number;
  /** Less walking between back-to-back classes. */
  walking: number;
  /** Higher-rated instructors. */
  rating: number;
};

export const MAX_WEIGHT = 4;

export type OptimizeRequest = {
  /** The courses to schedule: exactly one section of each is chosen. */
  courses: OptCourse[];
  /** Inclusive first/last day for undated meetings. Required if any meeting has dates. */
  term?: OptDateRange;
  /**
   * Credits of courses the student takes that are not in `courses` (the
   * caller decided their sections already, such as an online section with
   * no set time). They count toward `maxCredits` and the reported credits.
   * Default 0.
   */
  fixedCredits?: number;
  /** Course code -> section id that must be chosen. */
  locks: Record<string, string>;
  /** Section ids that must not be chosen. */
  excluded: string[];
  constraints: OptConstraints;
  weights: OptWeights;
  walkingTime: OptWalkingTimeFn;
  /** Number of alternatives wanted; default 3. */
  k?: number;
  /** Wall-clock budget for the search, from the moment `optimize` is called. Default 300. */
  timeBudgetMs?: number;
  /**
   * Node budget for the search. Unlike the time budget it gives the same
   * answer on every machine, so callers that need a stable result (the
   * planner's state normalization) use it instead of the clock.
   */
  maxNodes?: number;
  /** Budget for building the infeasibility explanation. Default 250 ms. */
  explainBudgetMs?: number;
  /** Clock, injectable for tests. Default `performance.now`. */
  now?: () => number;
};

/** Per-schedule numbers a student can read. */
export type ScheduleBreakdown = {
  /** Distinct days with a class, weekends included, whatever the class's dates. */
  daysOnCampus: number;
  /** Idle minutes between back-to-back classes, each pair counted once, summed over every day. */
  gapMinutes: number;
  /** Known walking between back-to-back classes, each pair counted once, summed over the week. */
  walkSeconds: number;
  /** Back-to-back classes in different buildings with no walking estimate. */
  unknownWalks: number;
  /** Earliest class start of the week (minutes), null for an empty schedule. */
  earliestStart: number | null;
  /** Latest class end of the week (minutes), null for an empty schedule. */
  latestEnd: number | null;
  credits: number;
  /** Mean instructor rating over sections that have one; null when none do. */
  averageRating: number | null;
};

export type RankedSchedule = {
  /** Course code -> chosen section id. */
  byCourse: Record<string, string>;
  /** Integer cost; lower is better. */
  cost: number;
  breakdown: ScheduleBreakdown;
  /**
   * True when the search proved no schedule is better at this rank (under
   * the diversity rule). False when the budget ran out first.
   */
  proven: boolean;
};

/** One item of an infeasibility explanation. */
export type ExplainMember =
  | { kind: "course"; courseCode: string }
  | { kind: "lock"; courseCode: string; sectionId: string }
  | { kind: "excluded"; sectionId: string }
  | { kind: "earliestStart" }
  | { kind: "latestEnd" }
  | { kind: "dayOff"; day: OptDay }
  | { kind: "blocked"; blockedId: string }
  | { kind: "maxCredits" }
  | { kind: "walking" }
  /** The rule that two finals may not overlap. It has no one-click change: UNT sets exam times. */
  | { kind: "exams" };

/** A one-click change that removes one member of the explanation. */
export type Relaxation =
  | { kind: "earliestStart"; to: number | null }
  | { kind: "latestEnd"; to: number | null }
  | { kind: "dayOff"; day: OptDay }
  | { kind: "blocked"; blockedId: string }
  | { kind: "maxCredits"; to: number | null }
  | { kind: "walking"; to: { bufferMinutes: number } | null }
  | { kind: "unlock"; courseCode: string }
  | { kind: "include"; sectionId: string };

export type RelaxSuggestion = {
  relaxation: Relaxation;
  label: string;
  /**
   * True when the whole request becomes feasible after this change, false
   * when another conflict remains, null when the check ran out of budget.
   */
  resolves: boolean | null;
};

export type Explanation = {
  /** The conflicting set: with all of it the request is infeasible. */
  members: ExplainMember[];
  /**
   * True when every member was checked: dropping any one of them makes the
   * set feasible. False when the explanation budget ran out first; the set
   * is still infeasible, but may name more than it needs to.
   */
  minimal: boolean;
  /** One plain sentence for the student. */
  sentence: string;
  suggestions: RelaxSuggestion[];
};

export type SearchStats = {
  nodes: number;
  elapsedMs: number;
  /** Candidate sections left after pruning, per course. */
  candidates: Record<string, number>;
  /** Courses that must differ in meeting times between two alternatives. */
  minDifferentCourses: number;
};

export type OptimizeResult =
  | {
      /** Every returned schedule is proven best at its rank. */
      status: "optimal";
      schedules: RankedSchedule[];
      stats: SearchStats;
    }
  | {
      /** The budget ran out; the schedules satisfy every hard constraint but some are not proven best. */
      status: "feasible";
      schedules: RankedSchedule[];
      stats: SearchStats;
    }
  | {
      /** The budget ran out before any schedule was found or ruled out. */
      status: "timeout";
      schedules: [];
      stats: SearchStats;
    }
  | {
      /** Proven: no schedule satisfies every hard constraint. */
      status: "infeasible";
      schedules: [];
      explanation: Explanation;
      stats: SearchStats;
    };

/** Thrown for a malformed request: a programming error, never a student's input. */
export class OptimizerInputError extends Error {
  constructor(message: string) {
    super(`optimizer: ${message}`);
    this.name = "OptimizerInputError";
  }
}
