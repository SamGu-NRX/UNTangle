/**
 * FROZEN round-1 schedule-optimizer contract. The semantics in this file are
 * decided — variants implement them as typed below, no alternatives. Only
 * the M1 thread edits this file; variant threads (bnb/, mip/, lns/) import
 * from here and must not restate or extend the contract.
 *
 * Every variant exposes `optimize(req): Promise<OptimizeResult>` (see
 * `Optimize` at the bottom). `initMs` is reported separately from `searchMs`
 * so a WASM-initialized solver (mip) can amortize setup honestly.
 *
 * DATA HONESTY: section data flowing through this contract — both the
 * bundled catalog (2,704 synthetic sections over 656 courses, 15 buildings)
 * and benchmark-generated instances — consists of synthetic samples, NOT a
 * real term's offerings. Never present results as a real schedule.
 *
 * Time conventions, pinned: minutes are minutes after midnight; intervals
 * are half-open `[start, end)` with `end > start`, so a meeting ending at
 * 10:00 and one starting at 10:00 do NOT conflict.
 */

import type { WeekDay } from "@/lib/types";

// ---------------------------------------------------------------------------
// Walking time
// ---------------------------------------------------------------------------

/**
 * Walking time between two buildings. Integration replaces these local
 * declarations with the import from `@/lib/campus/walking-times.ts`; until
 * then they live here.
 *
 * - `seconds: number, source: "campus-network" | "straight-line"` — a KNOWN
 *   walking time in seconds.
 * - `seconds: null, source: "unknown"` — the pair is unknown. Unknown is
 *   never 0 and never free: callers treat unknown as unknown (a separate
 *   soft penalty, see `SoftWeights.perUnknownWalking`), not as a free walk.
 */
export type WalkingTime =
  | { seconds: number; source: "campus-network" | "straight-line" }
  | { seconds: null; source: "unknown" };

/**
 * Look up the walking time from one building to another. Building ids are
 * the lowercase ids of the bundled data (art, arta, aud, blb, chem, env,
 * gab, gate, hick, lang, life, matt, musi, ntdp, wh). The same building
 * returns `{ seconds: 0, source: "campus-network" }`; an unknown id returns
 * `{ seconds: null, source: "unknown" }` — never 0.
 */
export type WalkingTimeFn = (fromBuildingId: string, toBuildingId: string) => WalkingTime;

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

/** One meeting of an optimizer section, normalized from the catalog. */
export interface OptimizerMeeting {
  /** Mon..Fri. */
  day: WeekDay;
  /** Minutes after midnight; half-open `[start, end)`, `end > start`. */
  start: number;
  /** Minutes after midnight; half-open `[start, end)`, `end > start`. */
  end: number;
  /** Lowercase building id from the bundled data. */
  buildingId: string;
}

/**
 * One candidate section. All sections are synthetic catalog samples, not a
 * real term.
 */
export interface OptimizerSection {
  /** Unique section id (catalog section id or benchmark id). */
  id: string;
  /** Course code like `"ANTH 1010"`. */
  courseCode: string;
  /** Credit hours (from the course's creditHours). */
  credits: number;
  /** 1..3 meetings on Mon..Fri. */
  meetings: OptimizerMeeting[];
  /** Instructor rating 0..5; missing (undefined) skips rating scoring. */
  instructorRating?: number;
  /** Historical GPA 0..4; missing (undefined) skips GPA scoring. */
  historicalGpa?: number;
}

/** A time range the student must keep free. Half-open `[start, end)`. */
export interface BlockedTimeRange {
  day: WeekDay;
  start: number;
  end: number;
}

// ---------------------------------------------------------------------------
// Hard constraints
// ---------------------------------------------------------------------------

/**
 * Hard constraints — every field optional; an omitted constraint is
 * unsolicited. A schedule violating any present constraint is infeasible.
 *
 * DECISION (pinned): actual walking time is SOFT, never hard. A known long
 * walk that does not fit the gap between two meetings is legal but costs
 * walking seconds in the score. `minTransferMinutes` is the only hard
 * transfer rule, and it applies ONLY to consecutive same-day pairs in
 * DIFFERENT buildings (same-building pairs are exempt).
 *
 * DECISION (pinned): no two chosen meetings may overlap (same day,
 * half-open rule). This baseline invariant always applies, even with an
 * empty `HardConstraints`.
 */
export interface HardConstraints {
  /** No meeting may START before this many minutes after midnight. */
  earliestStart?: number;
  /** No meeting may END after this many minutes after midnight. */
  latestEnd?: number;
  /** No chosen section may have a meeting on any of these days. */
  daysOff?: WeekDay[];
  /** Sum of chosen sections' credits must be <= this. */
  maxCredits?: number;
  /**
   * No meeting may overlap a blocked range on the same day (same half-open
   * `[start, end)` rule).
   */
  blockedTimeRanges?: BlockedTimeRange[];
  /**
   * Consecutive same-day meetings in DIFFERENT buildings need
   * `next.start - prev.end >= minTransferMinutes`. Same-building pairs are
   * exempt. Pairs are consecutive by sorted `start` within a day.
   */
  minTransferMinutes?: number;
}

// ---------------------------------------------------------------------------
// Soft weights (the score is a COST to minimize)
// ---------------------------------------------------------------------------

/**
 * Soft weights — all required, all plain numbers >= 0 in the request. The
 * score is a COST: lower is better. Rating/GPA enter as MINUS sums (higher
 * rating/GPA lowers the cost).
 *
 * TERM DEFINITIONS (pinned; chosen meetings = meetings of chosen sections):
 * - `gapMinutes`: per day, sort chosen meetings by start; sum of
 *   `max(0, next.start - prev.end)` over consecutive pairs.
 * - `walkingSeconds`: over the same consecutive pairs that are in different
 *   buildings, the `walkingTime` seconds when known; pairs in the same
 *   building contribute 0 and are skipped; UNKNOWN pairs are skipped here
 *   and counted in `unknownWalkingPairs` instead.
 * - `unknownWalkingPairs`: count of consecutive different-building pairs
 *   whose walking time is unknown.
 * - `earlyStartMinutes`: sum over all chosen meetings of
 *   `max(0, earlyStartAnchor - meeting.start)`.
 * - `lateEndMinutes`: sum over all chosen meetings of
 *   `max(0, meeting.end - lateEndAnchor)`.
 * - `daysOnCampus`: number of distinct WeekDays with at least one chosen
 *   meeting.
 * - `ratingSum` / `gpaSum`: sums over chosen sections; a section with
 *   missing (undefined) value is skipped and contributes 0.
 */
export interface SoftWeights {
  /** Cost per gap minute between consecutive same-day meetings. */
  perGapMinute: number;
  /** Cost per walking second (known walks only). */
  perWalkingSecond: number;
  /** Cost per minute a meeting starts before the early anchor. */
  perEarlyStartMinute: number;
  /** Cost per minute a meeting ends after the late anchor. */
  perLateEndMinute: number;
  /** Cost per distinct day with at least one chosen meeting. */
  perDayOnCampus: number;
  /** Applied as MINUS the sum of chosen sections' ratings (missing -> 0). */
  perRatingPoint: number;
  /** Applied as MINUS the sum of chosen sections' GPAs (missing -> 0). */
  perGpaPoint: number;
  /** Cost per consecutive different-building pair with UNKNOWN walking time. */
  perUnknownWalking: number;
}

/** Default early-start anchor: 540 minutes = 9:00. */
export const DEFAULT_EARLY_START_ANCHOR_MINUTES = 540;
/** Default late-end anchor: 960 minutes = 16:00. */
export const DEFAULT_LATE_END_ANCHOR_MINUTES = 960;

/**
 * COST FORMULA (pinned):
 * cost = perGapMinute*gapMinutes
 *      + perWalkingSecond*walkingSeconds
 *      + perEarlyStartMinute*earlyStartMinutes
 *      + perLateEndMinute*lateEndMinutes
 *      + perDayOnCampus*daysOnCampus
 *      - perRatingPoint*ratingSum
 *      - perGpaPoint*gpaSum
 *      + perUnknownWalking*unknownWalkingPairs
 */

// ---------------------------------------------------------------------------
// Request / result
// ---------------------------------------------------------------------------

/** The complete optimization request. */
export interface OptimizeRequest {
  /** The candidate pool. Chosen sections must come from here. */
  sections: OptimizerSection[];
  /** Exactly one chosen section per requested course code. */
  requestedCourseCodes: string[];
  /** Always chosen (when eligible); see pinned semantics below. */
  lockedSectionIds: string[];
  /** Never chosen. */
  excludedSectionIds: string[];
  hardConstraints: HardConstraints;
  softWeights: SoftWeights;
  /** Early-start anchor; default 540 (9:00). */
  earlyStartAnchorMinutes?: number;
  /** Late-end anchor; default 960 (16:00). */
  lateEndAnchorMinutes?: number;
  /** Maximum number of returned schedules. */
  k: number;
  /** Wall-clock budget in milliseconds for the whole search. */
  timeBudgetMs: number;
  /** Walking-time lookup (see `WalkingTimeFn`). */
  walkingTime: WalkingTimeFn;
}

/**
 * PINNED REQUEST SEMANTICS:
 * - Exactly one chosen section per requested course code.
 * - Chosen sections must come from the pool.
 * - Excluded ids are never chosen.
 * - Locked ids are always chosen.
 * - A locked id that is not a pool section of a requested course is IGNORED
 *   (e.g. a lock on a section whose course is not requested, or an id not
 *   in the pool at all).
 * - Sections whose courseCode is not requested are ignored.
 * - Empty `requestedCourseCodes` is feasible with the empty schedule:
 *   status "optimal", one empty schedule, cost 0.
 */

/** Raw scoring terms in their stated units, plus the weighted `cost`. */
export interface ScoreBreakdown {
  gapMinutes: number;
  walkingSeconds: number;
  earlyStartMinutes: number;
  lateEndMinutes: number;
  daysOnCampus: number;
  ratingSum: number;
  gpaSum: number;
  unknownWalkingPairs: number;
  cost: number;
}

/** One returned schedule: which sections, and what it costs in raw terms. */
export interface OptimizedSchedule {
  /** Chosen section ids, sorted ascending. */
  sectionIds: string[];
  /** courseCode -> chosen section id. */
  byCourse: Record<string, string>;
  breakdown: ScoreBreakdown;
}

/**
 * Result status semantics (pinned):
 * - "optimal": the search completed and proved the returned top-k optimal.
 * - "feasible": returned schedules satisfy every hard constraint but
 *   optimality is NOT proven and the time budget was not hit.
 * - "timeout": the time budget was hit before search completion (include
 *   any schedules found).
 * - "infeasible": the search PROVED no assignment satisfies all hard
 *   constraints; `infeasibleSubset` is present.
 *
 * ORDERING AND TIES (pinned): schedules ascend by cost; ties break by the
 * lexicographic ascending order of the joined sorted section ids. All
 * variants are deterministic.
 *
 * DIVERSITY (pinned): for m returned schedules over n requested courses:
 * 0 when m <= 1, else the average over all unordered pairs of schedules of
 * (number of course slots whose chosen section differs / n), in [0, 1].
 */
export interface OptimizeResult {
  status: "optimal" | "feasible" | "infeasible" | "timeout";
  /** At most k schedules, ascending cost, best first. */
  schedules: OptimizedSchedule[];
  /** See diversity definition above; in [0, 1]. */
  diversity: number;
  /** Milliseconds spent initializing (e.g. WASM instantiation). */
  initMs: number;
  /** Milliseconds spent searching (excludes init). */
  searchMs: number;
  /** Present iff status is "infeasible". */
  infeasibleSubset?: IisSubset;
}

// ---------------------------------------------------------------------------
// Infeasible subset (IIS)
// ---------------------------------------------------------------------------

/** One member of an infeasible subset. */
export interface IisMember {
  /** "course" | "constraint" | "locked" | "excluded". */
  kind: "course" | "constraint" | "locked" | "excluded";
  /**
   * - "course": the course code.
   * - "constraint": kind and index, e.g. `"maxCredits"`, `"blockedTimeRanges.2"`.
   * - "locked" / "excluded": the section id.
   */
  id: string;
}

/**
 * An IIS for a request is a set of members such that the sub-request
 * containing ONLY those requested courses, ONLY those hard constraints, and
 * ONLY those locked/excluded ids is infeasible, and removing any single
 * member makes it feasible. (Irreducible infeasible subset, deletion-filter
 * semantics — see bench/iis-reference.ts.)
 */
export interface IisSubset {
  members: IisMember[];
}

// ---------------------------------------------------------------------------
// Variant interface
// ---------------------------------------------------------------------------

/**
 * The variant entry point every round-1 optimizer exposes
 * (`optimize(req): Promise<OptimizeResult>`). Async so a WASM solver can
 * initialize; `initMs` covers initialization, `searchMs` the search.
 */
export type Optimize = (req: OptimizeRequest) => Promise<OptimizeResult>;
