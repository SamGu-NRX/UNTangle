/**
 * Browse-all entry point: every schedule that meets the hard constraints,
 * best first, for Week's "Browse all" list.
 *
 * `optimize` answers "which few weeks should I look at?", so it returns at
 * most 20 and makes each differ from the last in at least
 * `minDifferentCourses` courses. A list meant to show every combination needs
 * neither rule, so this path is separate:
 *
 * - No diversity rule: two schedules may differ in one section.
 * - Twins stay (`keepTwins` in prepare.ts). Ranking drops a section that
 *   meets at the same times in the same rooms as a cheaper one, because it
 *   can never rank ahead of it; a list of every section has to show it.
 * - Order is Auto's: ascending cost, then section ids in course-code order.
 *   With the same request, the first row is Auto's first option.
 *
 * Two passes, each with its own node budget:
 *
 * 1. Rank: the same branch and bound as `optimize`, pruning against the
 *    `limit`-th best schedule found so far instead of the best one
 *    (`collect` in search.ts). When it completes, the list is exactly the
 *    best `limit` and every row is proven.
 * 2. Count: only when more than `limit` fit, or the rank pass ran out. The
 *    same search with every weight at 0 and nothing to beat, so it visits each
 *    valid schedule once and computes no cost bounds. When it runs out, the
 *    total is a lower bound and the page says "more than".
 *
 * Node budgets give the same answer on every machine. `timeBudgetMs` is an
 * optional wall-clock cap over both passes, for the worker.
 */

import { prepare, PrepareBudgetExhausted, type Prepared } from "./prepare";
import { leafBefore, search, type Budget, type Leaf } from "./search";
import { explainInfeasible } from "./explain";
import { toRanked } from "./optimize";
import { OptimizerInputError, type Explanation, type OptimizeRequest, type OptWeights, type RankedSchedule } from "./types";

/** Most rows one list returns. Rendering is virtualized; this bounds the rank pass and the reply's size. */
export const MAX_LIST_LIMIT = 2000;
export const DEFAULT_LIST_LIMIT = 500;
/**
 * Defaults for the two passes, chosen from tests/optimizer/browse-bench.ts on
 * one M4 Pro, 12 instances per shape, October 2026: 8 courses x 40 sections
 * took 0.3 to 1.8 s per list (p50 about 0.7 s) with 3 of 12 lists unproven and
 * almost every total a lower bound; 6 x 12 took at most 0.3 s and 5 x 8 at
 * most 16 ms, all proven and exact. The rank pass costs about 4 microseconds
 * a node there and the count pass about 0.25. No slower machine was measured.
 */
export const DEFAULT_RANK_NODES = 400_000;
export const DEFAULT_COUNT_NODES = 1_000_000;
const DEFAULT_EXPLAIN_BUDGET_MS = 250;

export type EnumerateRequest = Omit<OptimizeRequest, "k" | "maxNodes"> & {
  /** Rows wanted, best first: an integer 1..MAX_LIST_LIMIT. Default DEFAULT_LIST_LIMIT. */
  limit?: number;
  /** Node budget of the rank pass. Default DEFAULT_RANK_NODES. */
  rankNodes?: number;
  /** Node budget of the count pass. Default DEFAULT_COUNT_NODES. */
  countNodes?: number;
  /** Optional wall-clock cap over both passes. Default: none, so node budgets alone decide. */
  timeBudgetMs?: number;
};

export type EnumerateStats = {
  rankNodes: number;
  countNodes: number;
  elapsedMs: number;
  /** Candidate sections per course after pruning, twins included. */
  candidates: Record<string, number>;
};

export type EnumerateResult =
  | {
      /**
       * At least one schedule fits. `schedules` is best first; each is
       * `proven` when the rank pass finished, so the list is exactly the best
       * `schedules.length`. `total` counts every schedule that fits when
       * `totalExact`, and is a lower bound otherwise.
       */
      status: "listed";
      schedules: RankedSchedule[];
      total: number;
      totalExact: boolean;
      stats: EnumerateStats;
    }
  | {
      /** Proven: nothing meets every hard constraint. */
      status: "infeasible";
      schedules: [];
      total: 0;
      totalExact: true;
      explanation: Explanation;
      stats: EnumerateStats;
    }
  | {
      /** The budget ran out before any schedule was found or ruled out. */
      status: "timeout";
      schedules: [];
      total: 0;
      totalExact: false;
      stats: EnumerateStats;
    };

const NO_WEIGHTS: OptWeights = { fewerDays: 0, compact: 0, mornings: 0, evenings: 0, walking: 0, rating: 0 };

function positiveInteger(value: number, label: string, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isInteger(value) || value < 1 || value > max) throw new OptimizerInputError(`${label} must be an integer 1..${max}, got ${value}`);
  return value;
}

export function enumerateSchedules(request: EnumerateRequest): EnumerateResult {
  const { limit: askedLimit, rankNodes: askedRank, countNodes: askedCount, timeBudgetMs, ...rest } = request;
  const limit = positiveInteger(askedLimit ?? DEFAULT_LIST_LIMIT, "limit", MAX_LIST_LIMIT);
  const rankNodes = positiveInteger(askedRank ?? DEFAULT_RANK_NODES, "rankNodes");
  const countNodes = positiveInteger(askedCount ?? DEFAULT_COUNT_NODES, "countNodes");
  // The engine's own request: no k (validated as Auto's default), no node cap of Auto's.
  const engineRequest: OptimizeRequest = { ...rest };
  const now = engineRequest.now ?? (() => performance.now());
  const started = now();
  const deadline = timeBudgetMs === undefined ? Number.POSITIVE_INFINITY : started + timeBudgetMs;

  let prepared: Prepared;
  try {
    prepared = prepare(engineRequest, deadline, now, { keepTwins: true });
  } catch (error) {
    if (!(error instanceof PrepareBudgetExhausted)) throw error;
    return { status: "timeout", schedules: [], total: 0, totalExact: false, stats: { rankNodes: 0, countNodes: 0, elapsedMs: now() - started, candidates: {} } };
  }

  // Best first, at most `limit`. A leaf only reaches `collect` when it beats
  // the current threshold, but the check stays so the list never depends on that.
  const kept: Leaf[] = [];
  const collect = (leaf: Leaf): Leaf | null => {
    if (kept.length === limit && !leafBefore(leaf, kept[limit - 1])) return kept[limit - 1];
    let index = kept.length;
    while (index > 0 && leafBefore(leaf, kept[index - 1])) index -= 1;
    kept.splice(index, 0, leaf);
    if (kept.length > limit) kept.pop();
    return kept.length === limit ? kept[limit - 1] : null;
  };
  const rankBudget: Budget = { deadline, maxNodes: rankNodes, now, nodes: 0 };
  const ranked = search(prepared, rankBudget, { previous: [], minDifferent: 0, stopAtFirst: false, incumbent: null, collect });

  const countBudget: Budget = { deadline, maxNodes: countNodes, now, nodes: 0 };
  const stats = (): EnumerateStats => ({
    rankNodes: rankBudget.nodes,
    countNodes: countBudget.nodes,
    elapsedMs: now() - started,
    candidates: Object.fromEntries(prepared.courses.map((course) => [course.code, course.candidates.length])),
  });

  if (kept.length === 0) {
    if (!ranked.complete) return { status: "timeout", schedules: [], total: 0, totalExact: false, stats: stats() };
    const explanation = explainInfeasible(engineRequest, engineRequest.explainBudgetMs ?? DEFAULT_EXPLAIN_BUDGET_MS, now);
    return { status: "infeasible", schedules: [], total: 0, totalExact: true, explanation, stats: stats() };
  }

  let total = kept.length;
  let totalExact = ranked.complete;
  // With fewer than `limit` kept and the rank pass complete, nothing was pruned
  // for cost: `kept` is every schedule that fits.
  if (!ranked.complete || kept.length === limit) {
    let count = 0;
    const counted = search({ ...prepared, weights: NO_WEIGHTS }, countBudget, {
      previous: [],
      minDifferent: 0,
      stopAtFirst: false,
      incumbent: null,
      collect: () => {
        count += 1;
        return null;
      },
    });
    total = Math.max(count, kept.length);
    totalExact = counted.complete;
  }

  // A rank pass cut short still listed every schedule when the count found no more than it kept.
  const proven = ranked.complete || (totalExact && total === kept.length);
  const schedules = kept.map((leaf) => toRanked(engineRequest, prepared, leaf, proven));
  return { status: "listed", schedules, total, totalExact, stats: stats() };
}
