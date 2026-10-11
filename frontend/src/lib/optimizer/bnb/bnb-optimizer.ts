/**
 * The bnb variant: exact branch-and-bound over the frozen round-1 contract.
 *
 * Shape of the search:
 * 1. Preprocess (prepare.ts): per-course candidates after unary pruning,
 *    pairwise cross-course conflict sets, per-section self costs.
 * 2. DFS over courses ordered fewest-candidates-first. Adding a section
 *    checks every hard constraint exactly against the chosen set: overlap
 *    and credits monotonically, and the minTransferMinutes rule
 *    incrementally on the consecutive pairs each insertion forms (see
 *    addSection for why that never cuts a feasible schedule).
 * 3. Complete assignments are scored with the normative computeBreakdown
 *    and kept in a top-k under the contract ordering (ascending cost, ties
 *    by lexicographic ascending joined sorted section ids).
 * 4. Pruning uses an admissible lower bound (see boundFor) plus
 *    credits-sum feasibility, never the transfer rule.
 * 5. Statuses: completed enumeration -> "optimal" (or "infeasible" with an
 *    irreducible infeasibleSubset); budget exhausted mid-search ->
 *    "timeout" with the best schedules found so far. "feasible" is never
 *    claimed: this search either completes or reports timeout.
 *
 * Determinism: no randomness, no wall-clock anywhere except the budget
 * check and the reported timings. Equal requests give equal results.
 */

import type { WeekDay } from "@/lib/types";
import type { OptimizeRequest, OptimizeResult, OptimizedSchedule, OptimizerSection } from "../types";
import { compareSchedules, computeBreakdown, computeDiversity, scheduleKey } from "../scorer";
import { findIis } from "../iis-reference";
import { prepare, type Prepared } from "./prepare";

/**
 * The checker recomputes every term with tolerance 1e-9; the pruning
 * comparison borrows the same cushion so floating-point drift can never
 * prune a branch whose completions TIE the current worst top-k entry —
 * equal-cost branches must survive for the contract tie-break.
 */
const BOUND_EPSILON = 1e-9;

/** Private control-flow signal: unwind the DFS when the budget is gone. */
class BudgetExceeded extends Error {
  constructor() {
    super("bnb: time budget exhausted");
  }
}

interface DayMeeting {
  start: number;
  end: number;
  buildingId: string;
  sectionId: string;
}

/** One inserted meeting plus the day list it went into, for exact rollback. */
type InsertedMeeting = { list: DayMeeting[]; entry: DayMeeting };

interface SearchState {
  req: OptimizeRequest;
  prepared: Prepared;
  k: number;
  minTransfer: number | undefined;
  maxCredits: number | undefined;
  /** performance.now() limit for the whole call (budget covers init + search). */
  deadline: number;
  /** Chosen meetings per day, sorted by start; starts are distinct (no overlap). */
  byDay: Map<WeekDay, DayMeeting[]>;
  chosen: OptimizerSection[];
  chosenIds: Set<string>;
  creditsSoFar: number;
  /** Current top-k, unsorted; sorted once at the end. */
  best: OptimizedSchedule[];
  /** Whether ANY feasible complete assignment was reached (k=0 still counts). */
  foundAny: boolean;
  /** The worst member of best, tracked iff best.length === k > 0. */
  worst: OptimizedSchedule | null;
}

function checkBudget(state: SearchState): void {
  if (performance.now() > state.deadline) throw new BudgetExceeded();
}

/** No already-chosen section may conflict with this one. */
function conflictFree(state: SearchState, section: OptimizerSection): boolean {
  const conflicting = state.prepared.conflicts.get(section.id);
  if (conflicting === undefined) return true;
  for (const id of conflicting) {
    if (state.chosenIds.has(id)) return false;
  }
  return true;
}

/**
 * ADMISSIBILITY of the lower bound. The pinned cost formula splits as
 *
 * cost(schedule) = SUM over chosen sections of self(s)   (early/late - rating/GPA)
 *                + perGapMinute*gapMinutes
 *                + perWalkingSecond*walkingSeconds
 *                + perDayOnCampus*daysOnCampus
 *                + perUnknownWalking*unknownWalkingPairs.
 *
 * Every raw interaction quantity (gapMinutes, walkingSeconds, daysOnCampus,
 * unknownWalkingPairs) is >= 0 and every soft weight is >= 0 by contract
 * ("all plain numbers >= 0"), so the interaction part is always >= 0:
 * interactions only ever INCREASE the cost. Hence for any completion C of a
 * partial choice,
 *
 * cost(C) >= selfSum + SUM over remaining courses c of self(C's pick for c)
 *         >= selfSum + SUM over remaining courses c of
 *              min{ self(x) : x a candidate of c compatible with the chosen set }.
 *
 * The compatibility filter (no conflict with the chosen sections; credits
 * fit below maxCredits) removes only sections NO completion can pick, so
 * the minimum stays a lower bound. The minima are taken independently per
 * course, which may overstate feasibility across courses — an
 * underestimate of the true cost, i.e. still admissible. The transfer rule
 * is deliberately left out of the filter: it is not monotone under
 * addition (a later section re-pairs consecutive meetings), and leaving it
 * out only weakens the bound. Locked sections are just the single
 * candidate of their course, so their self cost is always included.
 */
interface Bound {
  minSelfCost: number;
  minCredits: number;
}

function firstCompatible(state: SearchState, ordered: OptimizerSection[]): OptimizerSection | null {
  const maxCredits = state.maxCredits;
  for (const section of ordered) {
    if (!conflictFree(state, section)) continue;
    if (maxCredits !== undefined && state.creditsSoFar + section.credits > maxCredits) continue;
    return section;
  }
  return null;
}

/** null: some remaining course has no compatible candidate — branch dead. */
function boundFor(state: SearchState, courseIndex: number): Bound | null {
  let minSelfCost = 0;
  let minCredits = 0;
  const courses = state.prepared.courses;
  for (let j = courseIndex; j < courses.length; j++) {
    const course = courses[j];
    const cheapest = firstCompatible(state, course.bySelfCost);
    if (cheapest === null) return null;
    minSelfCost += state.prepared.selfCost.get(cheapest.id) ?? 0;
    const lightest = firstCompatible(state, course.byCredits);
    if (lightest === null) return null; // same predicate as above; cannot differ
    minCredits += lightest.credits;
  }
  return { minSelfCost, minCredits };
}

/** First index whose start is >= the given start (starts are distinct). */
function lowerBound(list: DayMeeting[], start: number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].start < start) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function pairViolatesTransfer(a: DayMeeting | undefined, b: DayMeeting | undefined, min: number): boolean {
  if (a === undefined || b === undefined) return false;
  return a.buildingId !== b.buildingId && b.start - a.end < min;
}

/**
 * SOUNDNESS of the incremental transfer check. Suppose a partial choice
 * contains a consecutive same-day different-building pair (m, s) with
 * s.start - m.end < minTransferMinutes. In ANY completion, every meeting on
 * that day with start between the two sits strictly between m.end and
 * s.start (overlaps are excluded), so the meetings from m to s form a chain
 * whose consecutive gaps are all >= 0 and sum to at most the original gap.
 * Since the buildings run from m's building to s's building and those
 * differ, some consecutive pair in the chain is different-building, and its
 * gap is at most the original gap < min: the completion violates the rule
 * too. So rejecting a branch the moment a violating pair forms never cuts a
 * feasible schedule, and checking exactly the pairs each insertion forms
 * (older pairs were violation-free and either survive or are broken by the
 * insertion) keeps the invariant that no kept partial contains a violating
 * consecutive pair.
 *
 * Returns the inserted day-list entries (empty when the transfer rule is
 * absent), or null when the insertion violates it — with every insertion
 * already rolled back.
 */
function addSection(state: SearchState, section: OptimizerSection): InsertedMeeting[] | null {
  state.chosen.push(section);
  state.chosenIds.add(section.id);
  state.creditsSoFar += section.credits;
  const min = state.minTransfer;
  if (min === undefined) return [];

  const inserted: { list: DayMeeting[]; entry: DayMeeting }[] = [];
  for (const meeting of section.meetings) {
    let list = state.byDay.get(meeting.day);
    if (!list) {
      list = [];
      state.byDay.set(meeting.day, list);
    }
    const entry: DayMeeting = {
      start: meeting.start,
      end: meeting.end,
      buildingId: meeting.buildingId,
      sectionId: section.id,
    };
    const index = lowerBound(list, meeting.start);
    list.splice(index, 0, entry);
    inserted.push({ list, entry });
    if (pairViolatesTransfer(list[index - 1], entry, min) || pairViolatesTransfer(entry, list[index + 1], min)) {
      removeSection(state, section, inserted);
      return null;
    }
  }
  return inserted;
}

/** Undo addSection: remove the inserted meetings and pop the bookkeeping. */
function removeSection(state: SearchState, section: OptimizerSection, inserted: InsertedMeeting[]): void {
  for (let i = inserted.length - 1; i >= 0; i--) {
    const { list, entry } = inserted[i];
    const index = list.indexOf(entry);
    list.splice(index, 1);
  }
  state.chosenIds.delete(section.id);
  state.creditsSoFar -= section.credits;
  state.chosen.pop();
}

function refreshWorst(state: SearchState): void {
  state.worst =
    state.k > 0 && state.best.length === state.k
      ? state.best.reduce((a, b) => (compareSchedules(a, b) > 0 ? a : b))
      : null;
}

/**
 * The self-cost sum of the CURRENTLY chosen sections, recomputed at each
 * node in chosen order. Incremental add/subtract bookkeeping would let
 * floating-point round-off accumulate on the very quantity the pruning
 * compares against the top-k worst cost; a fresh sum over at most a handful
 * of sections is deterministic and cheap.
 */
function selfSum(state: SearchState): number {
  let sum = 0;
  for (const section of state.chosen) sum += state.prepared.selfCost.get(section.id) ?? 0;
  return sum;
}

/** Score a complete assignment with the normative scorer and keep top-k. */
function recordLeaf(state: SearchState): void {
  state.foundAny = true;
  const k = state.k;
  if (k <= 0) return; // k=0: statuses and timings only, never a schedule
  const breakdown = computeBreakdown(state.req, state.chosen);
  const schedule: OptimizedSchedule = {
    sectionIds: state.chosen.map((s) => s.id).sort(),
    byCourse: Object.fromEntries(state.chosen.map((s) => [s.courseCode, s.id])),
    breakdown,
  };
  if (state.best.length < k) {
    state.best.push(schedule);
    refreshWorst(state);
    return;
  }
  const worst = state.worst;
  if (worst === null) return; // unreachable: a full best always tracks its worst member
  const cost = breakdown.cost;
  const newKey = scheduleKey(schedule.sectionIds);
  if (cost < worst.breakdown.cost || (cost === worst.breakdown.cost && newKey < scheduleKey(worst.sectionIds))) {
    state.best.splice(state.best.indexOf(worst), 1);
    state.best.push(schedule);
    refreshWorst(state);
  }
}

function dfs(state: SearchState, courseIndex: number): void {
  checkBudget(state);
  const courses = state.prepared.courses;
  if (courseIndex >= courses.length) {
    recordLeaf(state);
    return;
  }

  const bound = boundFor(state, courseIndex);
  if (bound === null) return; // a remaining course has no compatible candidate
  if (state.maxCredits !== undefined && state.creditsSoFar + bound.minCredits > state.maxCredits) return;
  const worst = state.worst;
  if (worst !== null && selfSum(state) + bound.minSelfCost > worst.breakdown.cost + BOUND_EPSILON) return;

  let sinceCheck = 0;
  for (const section of courses[courseIndex].candidates) {
    if (++sinceCheck >= 16) {
      checkBudget(state);
      sinceCheck = 0;
    }
    if (!conflictFree(state, section)) continue;
    if (state.maxCredits !== undefined && state.creditsSoFar + section.credits > state.maxCredits) continue;
    const inserted = addSection(state, section);
    if (inserted === null) continue; // transfer rule violated
    dfs(state, courseIndex + 1);
    removeSection(state, section, inserted);
  }
}

/**
 * Contract-faithful feasibility for (possibly pruned) sub-requests — the
 * function handed to findIis. Exact: the traversal uses only sound
 * prunings (unary drop, pairwise conflicts, credits, incremental transfer —
 * all argued above), so it agrees with brute force's isFeasible on every
 * request while following the contract's own locked/exclusion semantics
 * (e.g. two locks on one course are infeasible, which the independent
 * checker's verifyIis also asserts).
 */
function feasibleSub(req: OptimizeRequest): boolean {
  const attempt = prepare(req);
  if (!attempt.ok) return false;
  const prepared = attempt.prepared;
  const maxCredits = req.hardConstraints.maxCredits;
  const state: SearchState = {
    req,
    prepared,
    k: 0,
    minTransfer: req.hardConstraints.minTransferMinutes,
    maxCredits,
    deadline: Number.POSITIVE_INFINITY,
    byDay: new Map(),
    chosen: [],
    chosenIds: new Set<string>(),
    creditsSoFar: 0,
    best: [],
    foundAny: false,
    worst: null,
  };

  const walk = (courseIndex: number): boolean => {
    if (courseIndex >= prepared.courses.length) return true;
    for (const section of prepared.courses[courseIndex].candidates) {
      if (!conflictFree(state, section)) continue;
      if (maxCredits !== undefined && state.creditsSoFar + section.credits > maxCredits) continue;
      const inserted = addSection(state, section);
      if (inserted === null) continue;
      if (walk(courseIndex + 1)) return true;
      removeSection(state, section, inserted);
    }
    return false;
  };
  return walk(0);
}

function infeasibleResult(req: OptimizeRequest, initMs: number, searchMs: number): OptimizeResult {
  return {
    status: "infeasible",
    schedules: [],
    diversity: 0,
    initMs,
    searchMs,
    infeasibleSubset: findIis(req, feasibleSub),
  };
}

/**
 * The bnb variant's entry point: exact branch-and-bound under the frozen
 * contract. See the module doc for the shape of the search.
 */
export async function optimize(req: OptimizeRequest): Promise<OptimizeResult> {
  const t0 = performance.now();
  const attempt = prepare(req);
  const initMs = performance.now() - t0;

  if (!attempt.ok) {
    // Proved infeasible before any search; the IIS deletion filter names
    // the irreducible member set that blocks it.
    const tSearch = performance.now();
    const subset = findIis(req, feasibleSub);
    return {
      status: "infeasible",
      schedules: [],
      diversity: 0,
      initMs,
      searchMs: performance.now() - tSearch,
      infeasibleSubset: subset,
    };
  }

  const state: SearchState = {
    req,
    prepared: attempt.prepared,
    k: req.k,
    minTransfer: req.hardConstraints.minTransferMinutes,
    maxCredits: req.hardConstraints.maxCredits,
    deadline: t0 + req.timeBudgetMs,
    byDay: new Map(),
    chosen: [],
    chosenIds: new Set<string>(),
    creditsSoFar: 0,
    best: [],
    foundAny: false,
    worst: null,
  };

  const tSearch = performance.now();
  let timedOut = false;
  try {
    dfs(state, 0);
  } catch (error) {
    if (!(error instanceof BudgetExceeded)) throw error;
    timedOut = true;
  }
  const searchMs = performance.now() - tSearch;

  const schedules = [...state.best].sort(compareSchedules);
  const diversity = computeDiversity(schedules, req.requestedCourseCodes.length);
  if (timedOut) {
    return { status: "timeout", schedules, diversity, initMs, searchMs };
  }
  if (!state.foundAny) {
    // Enumeration completed with no feasible schedule: infeasibility is
    // proven, so produce the irreducible explanation.
    const tIis = performance.now();
    const result = infeasibleResult(req, initMs, searchMs);
    result.searchMs += performance.now() - tIis;
    return result;
  }
  return { status: "optimal", schedules, diversity, initMs, searchMs };
}
