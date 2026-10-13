/**
 * Constraint propagation + large-neighborhood-search variant (round 1).
 *
 * Pipeline: propagate per-course domains to a fixpoint (sound prunes only —
 * see ./propagation.ts), seed a solution with a greedy-with-backtracking DFS
 * over the propagated domains, then loop large neighborhoods: re-optimize a
 * random subset of 2-3 courses EXHAUSTIVELY against the fixed remainder,
 * accepting strict cost improvements or ties whose joined sorted section ids
 * are lexicographically smaller. All randomness comes from a locally seeded
 * mulberry32 (never Math.random), so equal requests that finish inside the
 * budget return equal results.
 *
 * STATUS HONESTY (this variant's core discipline): 'optimal' is returned
 * ONLY when the search provably exhausted the entire space — either
 * propagation left every course a singleton (one forced combination), or a
 * COMPLETED neighborhood covered every non-singleton course (its product
 * with the forced remainder IS the whole space, because propagation prunes
 * are sound). Otherwise 'feasible' on convergence (a fixed number of
 * consecutive neighborhoods without acceptance), 'timeout' when the budget
 * clock was hit, and 'infeasible' only on a sound proof (propagation, an
 * exhausted seed DFS, or the locked==excluded conflict) with an irreducible
 * infeasible subset from the shared deletion-filter reference.
 *
 * Costs and breakdowns always come from scorer.computeBreakdown — never
 * re-derived here. Walking time enters only through req.walkingTime inside
 * the scorer: unknown pairs are never free (perUnknownWalking term).
 */

import type {
  OptimizeRequest,
  OptimizeResult,
  OptimizedSchedule,
  OptimizerMeeting,
  OptimizerSection,
  ScoreBreakdown,
} from "../types";
import {
  compareSchedules,
  computeBreakdown,
  computeDiversity,
  findLockedConflict,
  scheduleKey,
} from "../scorer";
import { findIis } from "../iis-reference";
import { isFeasible as bruteIsFeasible } from "../brute-force";
import { mulberry32, shuffled, type LnsRng } from "./rng";
import { propagate, sectionsOverlap, violatesUnary, type CourseDomain } from "./propagation";

/** Fixed search seed — never Math.random, never time-derived. */
const SEARCH_SEED = 0x0b5eed;
/** Consecutive non-improving neighborhoods before declaring convergence. */
const STAGNATION_LIMIT = 60;
/** Neighborhood subset size range (the variant's core knob). */
const MIN_SUBSET = 2;
const MAX_SUBSET = 3;
/** Prefer neighborhoods whose candidate product stays under this bound. */
const SUBSET_PRODUCT_CAP = 200_000;
/** Budget-clock check stride (nodes) inside the subset enumeration. */
const BUDGET_CHECK_STRIDE = 64;
/** Brute-force enumerability bound (shared with the reference). */
const ENUMERABLE_PRODUCT_BOUND = 1_000_000;

/** The transfer rule on a complete assignment (non-monotone; leaf-only). */
function violatesTransfer(req: OptimizeRequest, chosen: OptimizerSection[]): boolean {
  const min = req.hardConstraints.minTransferMinutes;
  if (min === undefined) return false;
  const byDay = new Map<string, { start: number; end: number; buildingId: string }[]>();
  for (const section of chosen) {
    for (const meeting of section.meetings) {
      const list = byDay.get(meeting.day);
      if (list) list.push({ start: meeting.start, end: meeting.end, buildingId: meeting.buildingId });
      else byDay.set(meeting.day, [{ start: meeting.start, end: meeting.end, buildingId: meeting.buildingId }]);
    }
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => a.start - b.start);
    for (let i = 1; i < list.length; i++) {
      if (list[i - 1].buildingId !== list[i].buildingId && list[i].start - list[i - 1].end < min) return true;
    }
  }
  return false;
}

/** Full hard-constraint check of a complete assignment (forced-combo path). */
function violatesHard(req: OptimizeRequest, chosen: OptimizerSection[]): boolean {
  for (let i = 0; i < chosen.length; i++) {
    for (let j = i + 1; j < chosen.length; j++) {
      if (sectionsOverlap(chosen[i], chosen[j])) return true;
    }
  }
  for (const section of chosen) {
    if (violatesUnary(req, section)) return true;
  }
  const maxCredits = req.hardConstraints.maxCredits;
  if (maxCredits !== undefined) {
    const total = chosen.reduce((sum, section) => sum + section.credits, 0);
    if (total > maxCredits) return true;
  }
  return violatesTransfer(req, chosen);
}

/** Search state: one feasible assignment plus its cost and contract key. */
interface SearchState {
  /** courseCode -> chosen section. */
  assignment: Map<string, OptimizerSection>;
  /** All chosen sections (the scorer's input). */
  sections: OptimizerSection[];
  cost: number;
  key: string;
}

function stateFromChosen(chosen: OptimizerSection[], breakdown: ScoreBreakdown): SearchState {
  const assignment = new Map<string, OptimizerSection>();
  for (const section of chosen) assignment.set(section.courseCode, section);
  return {
    assignment,
    sections: [...chosen], // copy: the caller's array keeps mutating
    cost: breakdown.cost,
    key: scheduleKey(chosen.map((section) => section.id)),
  };
}

/** Contract-shaped schedule built from chosen sections and a breakdown. */
function scheduleFrom(chosen: OptimizerSection[], breakdown: ScoreBreakdown): OptimizedSchedule {
  return {
    sectionIds: chosen.map((section) => section.id).sort(),
    byCourse: Object.fromEntries(chosen.map((section) => [section.courseCode, section.id])),
    breakdown,
  };
}

/** Bounded top-k of DISTINCT schedules under the contract ordering. */
class TopK {
  private readonly entries: OptimizedSchedule[] = []; // ascending by compareSchedules

  constructor(private readonly k: number) {}

  get full(): boolean {
    return this.entries.length >= this.k;
  }

  get worstCost(): number | undefined {
    return this.entries[this.entries.length - 1]?.breakdown.cost;
  }

  /** Could this cost still enter the top-k? Cheap pre-filter before building. */
  admits(cost: number): boolean {
    if (this.k <= 0) return false;
    const worst = this.worstCost;
    return !this.full || worst === undefined || cost <= worst;
  }

  add(schedule: OptimizedSchedule): void {
    if (this.k <= 0) return;
    const worst = this.entries[this.entries.length - 1];
    if (worst !== undefined && this.entries.length >= this.k && compareSchedules(schedule, worst) >= 0) return;
    const key = scheduleKey(schedule.sectionIds);
    for (const entry of this.entries) {
      if (scheduleKey(entry.sectionIds) === key) return; // distinct only
    }
    this.entries.push(schedule);
    this.entries.sort(compareSchedules);
    if (this.entries.length > this.k) this.entries.pop();
  }

  list(): OptimizedSchedule[] {
    return [...this.entries];
  }
}

type SeedOutcome =
  | { kind: "schedule"; state: SearchState }
  | { kind: "infeasible" }
  | { kind: "budget" };

/**
 * Greedy seed with backtracking: courses ordered by fewest remaining
 * candidates, candidates by incremental cost (scorer-computed against the
 * partial schedule, so day-structure effects count), ties by section id.
 * Monotone constraints prune during the walk; the non-monotone transfer rule
 * is checked at leaves. The DFS is complete: exhausting it without a
 * schedule — and without hitting the deadline — proves infeasibility over
 * the (soundly) propagated domains.
 */
function findSeed(req: OptimizeRequest, domains: CourseDomain[], deadline: number): SeedOutcome {
  const order = [...domains].sort(
    (a, b) =>
      a.candidates.length - b.candidates.length ||
      (a.courseCode < b.courseCode ? -1 : a.courseCode > b.courseCode ? 1 : 0),
  );
  const maxCredits = req.hardConstraints.maxCredits;
  const chosen: OptimizerSection[] = [];
  const chosenMeetings: OptimizerMeeting[] = [];
  let budgetHit = false;

  const violatesPartial = (section: OptimizerSection, creditsSoFar: number): boolean => {
    if (maxCredits !== undefined && creditsSoFar + section.credits > maxCredits) return true;
    for (const existing of chosenMeetings) {
      for (const meeting of section.meetings) {
        if (existing.day === meeting.day && existing.start < meeting.end && meeting.start < existing.end) return true;
      }
    }
    return false;
  };

  let foundSeed: SearchState | null = null;
  const dfs = (index: number, creditsSoFar: number): boolean => {
    if (index >= order.length) {
      // Snapshot the full assignment NOW: the success unwind pops the shared
      // stack on the way out, so the array is empty after dfs returns true.
      if (violatesTransfer(req, chosen)) return false;
      foundSeed = stateFromChosen(chosen, computeBreakdown(req, chosen));
      return true;
    }
    if (performance.now() >= deadline) {
      budgetHit = true;
      return false;
    }
    const partialCost = computeBreakdown(req, chosen).cost;
    const candidates = [...order[index].candidates].sort((a, b) => {
      const costA = computeBreakdown(req, [...chosen, a]).cost - partialCost;
      const costB = computeBreakdown(req, [...chosen, b]).cost - partialCost;
      return costA - costB || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    });
    for (const section of candidates) {
      if (budgetHit) return false;
      if (violatesPartial(section, creditsSoFar)) continue;
      chosen.push(section);
      for (const meeting of section.meetings) chosenMeetings.push(meeting);
      const ok = dfs(index + 1, creditsSoFar + section.credits);
      chosenMeetings.length -= section.meetings.length;
      chosen.pop();
      if (ok || budgetHit) return ok;
    }
    return false;
  };

  dfs(0, 0);
  if (budgetHit) return { kind: "budget" };
  const seedState = foundSeed;
  if (!seedState) return { kind: "infeasible" };
  return { kind: "schedule", state: seedState };
}

interface SubsetOutcome {
  /** Best combo over the subset's product (never worse than current; null only on abort). */
  best: SearchState | null;
  /** False when the budget clock aborted the enumeration. */
  completed: boolean;
}

/**
 * Exhaustively re-optimize the subset's courses against the fixed remainder
 * of the current schedule: monotone checks (overlap, credits) prune during
 * the walk, the non-monotone transfer rule is checked on leaves over the
 * days the subset touches (untouched days stay valid — removing a meeting
 * only widens consecutive gaps), and every feasible leaf is scored with the
 * normative scorer and offered to the top-k. The current assignment is
 * always among the combos, so the best combo is never worse than current.
 */
function reoptimizeSubset(
  req: OptimizeRequest,
  current: SearchState,
  subset: CourseDomain[],
  deadline: number,
  topK: TopK,
): SubsetOutcome {
  const subsetCodes = new Set(subset.map((domain) => domain.courseCode));
  const fixedSections: OptimizerSection[] = [];
  let fixedCredits = 0;
  for (const [code, section] of current.assignment) {
    if (!subsetCodes.has(code)) {
      fixedSections.push(section);
      fixedCredits += section.credits;
    }
  }
  // Fixed meetings per day for overlap and transfer checks.
  const fixedByDay = new Map<string, OptimizerMeeting[]>();
  for (const section of fixedSections) {
    for (const meeting of section.meetings) {
      const list = fixedByDay.get(meeting.day);
      if (list) list.push(meeting);
      else fixedByDay.set(meeting.day, [meeting]);
    }
  }
  for (const list of fixedByDay.values()) list.sort((a, b) => a.start - b.start);

  const maxCredits = req.hardConstraints.maxCredits;
  const minTransfer = req.hardConstraints.minTransferMinutes;
  const picks: OptimizerSection[] = [];
  const pickMeetings: OptimizerMeeting[] = [];
  let best: SearchState | null = null;
  let nodeCount = 0;
  let aborted = false;

  const conflicts = (section: OptimizerSection): boolean => {
    for (const meeting of section.meetings) {
      const fixed = fixedByDay.get(meeting.day);
      if (fixed) {
        for (const other of fixed) {
          if (other.start < meeting.end && meeting.start < other.end) return true;
        }
      }
      for (const other of pickMeetings) {
        if (other.day === meeting.day && other.start < meeting.end && meeting.start < other.end) return true;
      }
    }
    return false;
  };

  // Only days the subset touches are re-checked; untouched days keep the
  // current schedule's validated consecutive pairs.
  const transferViolated = (): boolean => {
    if (minTransfer === undefined) return false;
    const touched = new Set<string>();
    for (const meeting of pickMeetings) touched.add(meeting.day);
    for (const day of touched) {
      const merged = [...(fixedByDay.get(day) ?? [])];
      for (const meeting of pickMeetings) {
        if (meeting.day === day) merged.push(meeting);
      }
      merged.sort((a, b) => a.start - b.start);
      for (let i = 1; i < merged.length; i++) {
        if (merged[i - 1].buildingId !== merged[i].buildingId && merged[i].start - merged[i - 1].end < minTransfer) {
          return true;
        }
      }
    }
    return false;
  };

  const walk = (index: number, creditsSoFar: number): void => {
    nodeCount += 1;
    if ((nodeCount & (BUDGET_CHECK_STRIDE - 1)) === 0 && performance.now() >= deadline) {
      aborted = true;
      return;
    }
    if (index >= subset.length) {
      if (transferViolated()) return;
      const chosen = fixedSections.concat(picks);
      const breakdown = computeBreakdown(req, chosen);
      if (topK.admits(breakdown.cost)) topK.add(scheduleFrom(chosen, breakdown));
      const currentBest = best;
      if (currentBest === null || breakdown.cost < currentBest.cost) {
        best = stateFromChosen(chosen, breakdown);
      } else if (breakdown.cost === currentBest.cost) {
        // Tie: prefer the lexicographically smaller joined sorted ids.
        const key = scheduleKey(chosen.map((section) => section.id));
        if (key < currentBest.key) best = stateFromChosen(chosen, breakdown);
      }
      return;
    }
    for (const section of subset[index].candidates) {
      if (aborted) return;
      if (maxCredits !== undefined && fixedCredits + creditsSoFar + section.credits > maxCredits) continue;
      if (conflicts(section)) continue;
      picks.push(section);
      for (const meeting of section.meetings) pickMeetings.push(meeting);
      walk(index + 1, creditsSoFar + section.credits);
      pickMeetings.length -= section.meetings.length;
      picks.pop();
    }
  };

  walk(0, 0);
  return { best: aborted ? null : best, completed: !aborted };
}

/** Random 2-3-course subset of the flexible courses (seeded, deterministic). */
function pickSubset(rng: LnsRng, flexible: CourseDomain[]): CourseDomain[] {
  const size =
    flexible.length > MIN_SUBSET && rng() < 0.5 ? Math.min(MAX_SUBSET, flexible.length) : Math.min(MIN_SUBSET, flexible.length);
  const subset = shuffled(rng, flexible).slice(0, size);
  const product = subset.reduce((acc, domain) => acc * domain.candidates.length, 1);
  if (product <= SUBSET_PRODUCT_CAP) return subset;
  // Product too large for one neighborhood: fall back to the smallest
  // domains (product-minimal, same size) — still exhaustive, just cheaper.
  return [...flexible]
    .sort(
      (a, b) =>
        a.candidates.length - b.candidates.length ||
        (a.courseCode < b.courseCode ? -1 : a.courseCode > b.courseCode ? 1 : 0),
    )
    .slice(0, size);
}

/** Product of per-course candidate counts after exclusions (locks unapplied). */
function productBound(req: OptimizeRequest): number {
  const excluded = new Set(req.excludedSectionIds);
  const counts = new Map<string, number>();
  for (const section of req.sections) {
    if (!req.requestedCourseCodes.includes(section.courseCode)) continue;
    if (excluded.has(section.id)) continue;
    counts.set(section.courseCode, (counts.get(section.courseCode) ?? 0) + 1);
  }
  let product = 1;
  for (const code of req.requestedCourseCodes) {
    product *= counts.get(code) ?? 0;
    if (product > ENUMERABLE_PRODUCT_BOUND) return product;
  }
  return product;
}

/**
 * Feasibility oracle for the shared IIS deletion filter. Exact reference
 * enumeration on enumerable sub-instances; beyond that, propagation — which
 * only ever claims infeasibility with a sound proof, so the filter can never
 * remove a member on a false verdict (it keeps members when unproven).
 */
function guardedFeasible(req: OptimizeRequest): boolean {
  if (productBound(req) <= ENUMERABLE_PRODUCT_BOUND) return bruteIsFeasible(req);
  return propagate(req).feasible;
}

function infeasibleResult(req: OptimizeRequest, initMs: number, searchMsBeforeIis: number): OptimizeResult {
  const tIis = performance.now();
  const infeasibleSubset = findIis(req, guardedFeasible);
  return {
    status: "infeasible",
    schedules: [],
    diversity: 0,
    initMs,
    searchMs: searchMsBeforeIis + (performance.now() - tIis),
    infeasibleSubset,
  };
}

function timeoutResult(initMs: number, searchMs: number): LnsResult {
  return {
    status: "timeout",
    schedules: [],
    diversity: 0,
    initMs,
    searchMs,
    diagnostics: { fullyEnumerated: false, neighborhoods: 0 },
  };
}

/** Extra outcome details for tests and the benchmark; not part of the contract. */
export interface LnsDiagnostics {
  /** True when a completed enumeration covered the entire (propagated) space: the returned top-k is the true top-k. */
  fullyEnumerated: boolean;
  /** Large neighborhoods evaluated by the LNS loop. */
  neighborhoods: number;
}

export type LnsResult = OptimizeResult & { diagnostics: LnsDiagnostics };

/**
 * The variant with diagnostics. Same search as optimize(); tests and the
 * benchmark may read diagnostics for honest top-k claims.
 */
export async function optimizeWithDiagnostics(req: OptimizeRequest): Promise<LnsResult> {
  const t0 = performance.now();
  const deadline = t0 + req.timeBudgetMs;

  // Pinned edge: empty request -> optimal with the empty schedule, cost 0.
  // (k=0 still returns an empty list: schedules never exceed k.)
  if (req.requestedCourseCodes.length === 0) {
    const schedules = req.k > 0 ? [scheduleFrom([], computeBreakdown(req, []))] : [];
    return {
      status: "optimal",
      schedules,
      diversity: 0,
      initMs: performance.now() - t0,
      searchMs: 0,
      diagnostics: { fullyEnumerated: true, neighborhoods: 0 },
    };
  }

  // Locked==excluded on a pool section of a requested course: pinned infeasibility.
  if (findLockedConflict(req)) {
    return {
      ...infeasibleResult(req, performance.now() - t0, 0),
      diagnostics: { fullyEnumerated: false, neighborhoods: 0 },
    };
  }

  // Constraint propagation to a fixpoint.
  const propagation = propagate(req);
  if (!propagation.feasible) {
    return {
      ...infeasibleResult(req, performance.now() - t0, 0),
      diagnostics: { fullyEnumerated: false, neighborhoods: 0 },
    };
  }
  const domains = propagation.domains;

  // All singletons: the space is one forced combination. Verify it exactly —
  // feasible proves 'optimal' (propagation is sound); any hard violation
  // proves infeasibility.
  if (domains.every((domain) => domain.candidates.length === 1)) {
    const forced = domains.map((domain) => domain.candidates[0]);
    if (violatesHard(req, forced)) {
      return {
        ...infeasibleResult(req, performance.now() - t0, 0),
        diagnostics: { fullyEnumerated: false, neighborhoods: 0 },
      };
    }
    const schedule = scheduleFrom(forced, computeBreakdown(req, forced));
    return {
      status: "optimal",
      schedules: req.k > 0 ? [schedule] : [],
      diversity: computeDiversity(req.k > 0 ? [schedule] : [], req.requestedCourseCodes.length),
      initMs: performance.now() - t0,
      searchMs: 0,
      diagnostics: { fullyEnumerated: true, neighborhoods: 0 },
    };
  }

  const initMs = performance.now() - t0;
  const tSearch = performance.now();

  // Seed: greedy with backtracking over the propagated domains.
  const seed = findSeed(req, domains, deadline);
  if (seed.kind === "budget") return timeoutResult(initMs, performance.now() - tSearch);
  if (seed.kind === "infeasible") {
    return {
      ...infeasibleResult(req, initMs, performance.now() - tSearch),
      diagnostics: { fullyEnumerated: false, neighborhoods: 0 },
    };
  }
  let current = seed.state;

  // LNS loop: re-optimize random 2-3-course subsets exhaustively against the
  // fixed remainder; accept improvements or tie-break-better equals; stop on
  // the budget clock, full-space enumeration, or stagnation.
  const rng = mulberry32(SEARCH_SEED);
  const topK = new TopK(req.k);
  topK.add(scheduleFrom(current.sections, computeBreakdown(req, current.sections)));
  const flexible = domains.filter((domain) => domain.candidates.length > 1);
  let stagnant = 0;
  let fullyEnumerated = false;
  let budgetHit = false;
  let neighborhoods = 0;

  while (stagnant < STAGNATION_LIMIT && !fullyEnumerated) {
    if (performance.now() >= deadline) {
      budgetHit = true;
      break;
    }
    if (flexible.length === 0) break; // everything forced (handled above; defensive)
    const subset = pickSubset(rng, flexible);
    neighborhoods += 1;
    const outcome = reoptimizeSubset(req, current, subset, deadline, topK);
    if (!outcome.completed) {
      budgetHit = true;
      break;
    }
    if (subset.length === flexible.length) fullyEnumerated = true;
    const candidate = outcome.best;
    if (
      candidate &&
      (candidate.cost < current.cost || (candidate.cost === current.cost && candidate.key < current.key))
    ) {
      current = candidate;
      stagnant = 0;
    } else {
      stagnant += 1;
    }
  }

  const searchMs = performance.now() - tSearch;
  const schedules = topK.list();
  const status: OptimizeResult["status"] = budgetHit ? "timeout" : fullyEnumerated ? "optimal" : "feasible";
  return {
    status,
    schedules,
    diversity: computeDiversity(schedules, req.requestedCourseCodes.length),
    initMs,
    searchMs,
    diagnostics: { fullyEnumerated: fullyEnumerated && !budgetHit, neighborhoods },
  };
}

/** The contract entry point — exactly the frozen Optimize shape. */
export async function optimize(req: OptimizeRequest): Promise<OptimizeResult> {
  const result = await optimizeWithDiagnostics(req);
  const contract: OptimizeResult = {
    status: result.status,
    schedules: result.schedules,
    diversity: result.diversity,
    initMs: result.initMs,
    searchMs: result.searchMs,
  };
  if (result.infeasibleSubset) contract.infeasibleSubset = result.infeasibleSubset;
  return contract;
}
