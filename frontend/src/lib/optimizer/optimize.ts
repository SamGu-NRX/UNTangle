/**
 * Entry point: ranked, meaningfully different schedules, or why none fit.
 *
 * 1. `prepare` drops sections that break a constraint on their own and
 *    precomputes which pairs of sections can never coexist.
 * 2. `search` finds the cheapest schedule exactly (branch and bound).
 * 3. Each further alternative is the cheapest schedule that places at least
 *    `minDifferentCourses` courses at different meeting times than every
 *    schedule already picked (see `minDifferentCourses` in prepare.ts). The
 *    search for it starts from the best such schedule seen so far.
 * 4. If the first search proves nothing fits, `explainInfeasible` names a
 *    smallest conflicting set and checked one-click relaxations.
 *
 * Order and ties: ascending cost, then the section ids in course-code order
 * compared one by one. The same request always gives the same answer, except
 * that a wall-clock budget can stop the search at different points on
 * different machines; `maxNodes` does not.
 */

import { prepare, PrepareBudgetExhausted } from "./prepare";
import { differingCourses, leafBefore, search, type Budget, type Leaf } from "./search";
import { scoreSchedule } from "./score";
import { explainInfeasible } from "./explain";
import type { OptimizeRequest, OptimizeResult, RankedSchedule, SearchStats } from "./types";

const DEFAULT_K = 3;
const DEFAULT_TIME_BUDGET_MS = 300;
const DEFAULT_EXPLAIN_BUDGET_MS = 250;
/** Good schedules remembered across searches, to start each alternative's search from. */
const POOL_SIZE = 64;

const defaultNow = () => performance.now();

export function optimize(request: OptimizeRequest): OptimizeResult {
  const now = request.now ?? defaultNow;
  const started = now();
  const k = request.k ?? DEFAULT_K;
  const budget: Budget = {
    deadline: started + (request.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS),
    maxNodes: request.maxNodes ?? Number.POSITIVE_INFINITY,
    now,
    nodes: 0,
  };
  let prepared: ReturnType<typeof prepare>;
  try {
    prepared = prepare(request, budget.deadline, now);
  } catch (error) {
    if (!(error instanceof PrepareBudgetExhausted)) throw error;
    return {
      status: "timeout",
      schedules: [],
      stats: { nodes: 0, elapsedMs: now() - started, candidates: {}, minDifferentCourses: 0 },
    };
  }
  const minDifferent = prepared.minDifferentCourses;

  const pool: Leaf[] = [];
  const remember = (leaf: Leaf) => {
    if (pool.length === POOL_SIZE && !leafBefore(leaf, pool[pool.length - 1])) return;
    if (pool.some((entry) => entry.key.every((id, i) => id === leaf.key[i]))) return;
    let index = pool.length;
    while (index > 0 && leafBefore(leaf, pool[index - 1])) index -= 1;
    pool.splice(index, 0, leaf);
    if (pool.length > POOL_SIZE) pool.pop();
  };
  const distinctFrom = (leaf: Leaf, picked: Leaf[]) => picked.every((other) => differingCourses(leaf, other) >= minDifferent);

  const picks: Array<{ leaf: Leaf; proven: boolean }> = [];
  let ranOut = false;
  for (let rank = 0; rank < k; rank += 1) {
    const previous = picks.map((pick) => pick.leaf);
    const seed = rank === 0 ? null : (pool.find((leaf) => distinctFrom(leaf, previous)) ?? null);
    const outcome =
      now() > budget.deadline
        ? { best: seed, complete: false }
        : search(prepared, budget, { previous, minDifferent, stopAtFirst: false, incumbent: seed, onLeaf: remember });
    if (outcome.complete) {
      if (outcome.best === null) break;
      picks.push({ leaf: outcome.best, proven: true });
      continue;
    }
    ranOut = true;
    if (outcome.best !== null) picks.push({ leaf: outcome.best, proven: false });
    // Fill the remaining ranks from schedules already seen, unproven.
    while (picks.length > 0 && picks.length < k) {
      const next = pool.find((leaf) => distinctFrom(leaf, picks.map((pick) => pick.leaf)));
      if (!next) break;
      picks.push({ leaf: next, proven: false });
    }
    break;
  }

  const stats = (): SearchStats => ({
    nodes: budget.nodes,
    elapsedMs: now() - started,
    candidates: Object.fromEntries(prepared.courses.map((course) => [course.code, course.candidates.length])),
    minDifferentCourses: minDifferent,
  });

  if (picks.length === 0) {
    if (ranOut) return { status: "timeout", schedules: [], stats: stats() };
    const explanation = explainInfeasible(request, request.explainBudgetMs ?? DEFAULT_EXPLAIN_BUDGET_MS, now);
    return { status: "infeasible", schedules: [], explanation, stats: stats() };
  }

  const schedules = picks.map(({ leaf, proven }) => toRanked(request, prepared, leaf, proven));
  return ranOut ? { status: "feasible", schedules, stats: stats() } : { status: "optimal", schedules, stats: stats() };
}

/** A search leaf as the page reads it, rescored from scratch; the two costs must agree exactly. Shared with enumerate.ts. */
export function toRanked(request: OptimizeRequest, prepared: ReturnType<typeof prepare>, leaf: Leaf, proven: boolean): RankedSchedule {
  const sections = leaf.picks.map((pick) => pick.section);
  const { cost, breakdown } = scoreSchedule({
    sections,
    term: request.term,
    creditsByCourse: prepared.creditsByCourse,
    fixedCredits: request.fixedCredits,
    neutralRatingByCourse: prepared.neutralRatingByCourse,
    weights: request.weights,
    walkingTime: request.walkingTime,
  });
  if (cost !== leaf.cost) {
    // The search's incremental cost and the scorer must agree exactly.
    throw new Error(`optimizer: search cost ${leaf.cost} disagrees with scorer cost ${cost} for ${leaf.key.join(", ")}`);
  }
  return {
    byCourse: Object.fromEntries(leaf.picks.map((pick) => [pick.section.courseCode, pick.section.id])),
    cost,
    breakdown,
    proven,
  };
}
