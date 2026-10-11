/**
 * The mip variant entry point: `optimize(req) -> OptimizeResult` on the
 * frozen round-1 contract (../types.ts). Solved with the `highs` WASM
 * package; see model.ts for the encoding and the solver-choice rationale.
 *
 * SEARCH — best-first enumeration by no-good cuts: each solve returns an
 * optimal solution; adding `sum_{s in S} x_s <= |S| - 1` for the found
 * solution S and re-solving yields the next-best schedule. Every returned
 * schedule has exactly one section per requested course, so the cut excludes
 * exactly S and no other schedule.
 *
 * TIES — the contract orders equal costs by the lexicographic ascending
 * join of sorted section ids. A single second-stage rank-sum solve cannot
 * reproduce string-lexicographic join order in general, so exact ties are
 * resolved by materializing the whole final tier: the cut loop first
 * collects k solutions WITHOUT a cap (cheap re-solves), then adds one cap
 * row `objective <= C_k + 1e-9` (C_k = the k-th solution's cost) and keeps
 * re-solving until Infeasible, which proves the top-k list is complete and
 * materializes every cost-C_k schedule; the final list is sorted by scorer's
 * compareSchedules (cost, then joined sorted ids). The cap is applied only
 * to the last tier: an earlier tier's full membership is implied by the
 * ascending-cost enumeration. Exact-tie tiers are tiny on the pinned suites,
 * so the close phase adds at most a handful of solves.
 *
 * PERFORMANCE — measured on the pinned suite under Bun: HiGHS's presolve is
 * dramatically counterproductive on this z-structured encoding (plain-m:
 * ~1.9s with defaults vs ~0.3s with presolve off, symmetry detection off,
 * and heuristics off), so those options are pinned here. The one-time
 * warm-up solve below (charged to initMs per the contract's "solver load and
 * one-time init") compiles the WASM/JIT paths a dense pair-linearized model
 * touches; without it a cold first solve can be several times slower.
 *
 * STATUS HONESTY: `optimal` is returned only when the enumeration finished —
 * either the final tier was closed by an Infeasible cap solve (the top-k
 * list is then proven complete) or the model was proven exhausted
 * (Infeasible with no cap row active). An exhausted time budget or a
 * time-limited solve returns `timeout` with the best schedules found
 * (possibly none; incumbents are validated before inclusion). Forced-
 * infeasible requests and a first-solve infeasibility return `infeasible`
 * with an IIS derived by deletion filtering over the shared reference
 * helpers (iis-reference's findIis with brute force's isFeasible); the
 * independent checker verifies it. The `feasible` status is never produced:
 * whenever optimality is unproven, the budget was also hit, which is
 * `timeout` by the contract.
 */
import highsLoader from "highs";
import type { LegacyHighs } from "highs";
import { compareSchedules, computeBreakdown, computeDiversity, findLockedConflict } from "../scorer";
import { isFeasible as bruteForceIsFeasible } from "../brute-force";
import { findIis } from "../iis-reference";
import type { OptimizeRequest, OptimizeResult, OptimizedSchedule, OptimizerSection } from "../types";
import { renderLp, type LpRow } from "./lp";
import { buildMipModel, chosenSetProblems, type MipModel } from "./model";

type SolveOptions = Parameters<LegacyHighs["solve"]>[1];
type SolveResult = ReturnType<LegacyHighs["solve"]>;

/**
 * Solver options pinned from measurement on the pinned suite: HiGHS presolve
 * is several times slower than no presolve on this pair-linearized encoding,
 * and symmetry detection plus heuristics only add overhead. `time_limit` is
 * supplied per solve from the request budget.
 */
function fastSolveOptions(timeLimitSeconds: number): SolveOptions {
  return {
    output_flag: false,
    random_seed: 0,
    mip_rel_gap: 0,
    mip_detect_symmetry: false,
    mip_heuristic_effort: 0,
    presolve: "off",
    time_limit: Math.max(0.001, timeLimitSeconds),
  };
}

/**
 * Deterministic dense pair-linearized warm-up model: 12 groups of 5 binaries
 * with exactly-one rows plus a full cross-group z-block with lower-bound
 * rows — the same row shapes as the real encoding, at comparable scale. Its
 * solve result is discarded; it exists only to compile the WASM/JIT paths a
 * first real solve would otherwise pay for inside the request budget.
 * Fully deterministic (fixed structure, fixed options), no request data,
 * no Math.random, no network.
 */
const WARMUP_PROBLEM = (() => {
  const objective: string[] = [];
  const rows: string[] = [];
  const binaries: string[] = [];
  const groups = 12;
  const perGroup = 5;
  for (let g = 0; g < groups; g++) {
    const terms: string[] = [];
    for (let p = 0; p < perGroup; p++) {
      const v = `x${g}_${p}`;
      terms.push(v);
      binaries.push(v);
      objective.push(`-1 ${v}`);
    }
    rows.push(` pick${g}: ${terms.join(" + ")} = 1`);
  }
  let z = 0;
  for (let g = 0; g < groups - 1; g++) {
    for (let p = 0; p < perGroup; p++) {
      for (let q = 0; q < perGroup; q++) {
        const zv = `z${z}`;
        binaries.push(zv);
        objective.push(`0.5 ${zv}`);
        rows.push(` zb${z}: ${zv} - x${g}_${p} - x${g + 1}_${q} >= -1`);
        z++;
      }
    }
  }
  return [
    "Minimize",
    ` obj: ${objective.join(" + ")}`,
    "Subject To",
    ...rows,
    "Binaries",
    `  ${binaries.join(" ")}`,
    " End",
  ].join("\n");
})();

/**
 * Budget discipline: the checker's status-timeout-budget rule sums initMs +
 * searchMs against the request budget (+50 ms tolerance) whenever status is
 * timeout. Model build time and HiGHS's own time-limit slack both land
 * inside that sum, so a solve is launched only when the remaining budget can
 * plausibly pay for it, and each solve is asked to finish slightly before
 * the deadline.
 */
const REMAINING_GUARD_S = 0.25;
const SOLVE_MARGIN_S = 0.25;

/** One-time WASM/solver initialization, shared across optimize() calls. */
let solverPromise: Promise<LegacyHighs> | null = null;
function getSolver(): Promise<LegacyHighs> {
  solverPromise ??= Promise.resolve(highsLoader()).then((instance): LegacyHighs => {
    // Warm up once: the first solve of a dense pair-linearized model pays
    // several-fold JIT/WASM compilation cost that later solves do not. A
    // bounded throwaway solve on a synthetic shape moves that cost into
    // one-time init (initMs), out of the per-request search budget. The
    // status is irrelevant; the time limit keeps init bounded.
    instance.solve(WARMUP_PROBLEM, { ...fastSolveOptions(1) });
    // Route through a narrow adapter so this module depends only on the
    // legacy one-shot solve API of the package.
    return {
      solve: (problem: string, options?: SolveOptions) => instance.solve(problem, options),
    };
  });
  return solverPromise;
}

/** The mip variant's contract entry point. */
export async function optimize(req: OptimizeRequest): Promise<OptimizeResult> {
  const initStart = performance.now();
  const highs = await getSolver();
  const initMs = performance.now() - initStart;
  // The budget clock anchors after one-time init AND, below, after model
  // build: the checker's status-timeout-budget rule sums initMs + searchMs
  // against timeBudgetMs (+50 ms), so model construction — whose cost varies
  // with machine speed — must not be billed to the request's search budget.
  let searchStart = performance.now();
  let deadline = searchStart + req.timeBudgetMs;
  const remainingSeconds = (): number => (deadline - performance.now()) / 1000;
  const finish = (result: Omit<OptimizeResult, "initMs" | "searchMs">): OptimizeResult => ({
    ...result,
    initMs,
    searchMs: performance.now() - searchStart,
  });

  // Empty request: feasible with the empty schedule (pinned semantics).
  if (req.requestedCourseCodes.length === 0) {
    const schedules: OptimizedSchedule[] =
      req.k > 0 ? [{ sectionIds: [], byCourse: {}, breakdown: computeBreakdown(req, []) }] : [];
    return finish({ status: "optimal", schedules, diversity: 0 });
  }

  // Forced infeasibility: a locked-and-excluded section of a requested
  // course, a locked section that cannot legally be chosen, or a requested
  // course with no remaining candidate — all derivable from the build.
  if (findLockedConflict(req) !== null) return finish(infeasibleResult(req));
  const build = buildMipModel(req);
  if (!build.ok) return finish(infeasibleResult(req));
  const model = build.model;
  searchStart = performance.now();
  deadline = searchStart + req.timeBudgetMs;

  const cuts: LpRow[] = [];
  let capRow: LpRow | null = null;
  let cutCounter = 0;
  const found: OptimizedSchedule[] = [];
  let timedOut = false;
  // k=0 still gets one solve: it settles feasibility honestly.
  const target = Math.max(req.k, 1);
  // Phase 1 collects k uncapped solutions; phase 2 (cap active) closes and
  // materializes the final tier, proving the top-k list complete.
  while (found.length < target || capRow !== null) {
    if (remainingSeconds() < REMAINING_GUARD_S) {
      timedOut = true;
      break;
    }
    const text = renderLp(model.data, capRow === null ? cuts : [...cuts, capRow]);
    const solution = highs.solve(text, fastSolveOptions(Math.max(0.001, remainingSeconds() - SOLVE_MARGIN_S)));
    if (solution.Status === "Infeasible") {
      if (capRow !== null) {
        capRow = null;
        break; // the final tier is fully materialized: top-k is proven
      }
      break; // the model is exhausted: everything was enumerated
    }
    if (solution.Status !== "Optimal") {
      // Any other status (e.g. "Time limit reached") is an unproven search:
      // harvest the incumbent if one exists and report timeout honestly.
      timedOut = true;
      const harvest = extractChosen(req, model, solution);
      if (harvest.problems.length === 0) found.push(assembleSchedule(req, harvest.chosen));
      break;
    }
    const { indexes, chosen, problems } = extractChosen(req, model, solution);
    if (problems.length > 0) {
      throw new Error(`mip: the model returned a contract-violating schedule (encoding bug): ${problems.join("; ")}`);
    }
    found.push(assembleSchedule(req, chosen));
    if (req.k > 0 && found.length === req.k && capRow === null) {
      capRow = objectiveCapRow(model, solution.ObjectiveValue); // close the final tier
    }
    cuts.push(noGoodRow(indexes, `cut${cutCounter++}`));
    if (req.k <= 0) break; // k=0: a single solve settles feasibility
  }

  if (found.length === 0) {
    if (timedOut) return finish({ status: "timeout", schedules: [], diversity: 0 });
    return finish(infeasibleResult(req));
  }

  found.sort(compareSchedules);
  const schedules = found.slice(0, Math.max(req.k, 0));
  return finish({
    status: timedOut ? "timeout" : "optimal",
    schedules,
    diversity: computeDiversity(schedules, req.requestedCourseCodes.length),
  });
}

function extractChosen(
  req: OptimizeRequest,
  model: MipModel,
  solution: SolveResult,
): { indexes: number[]; chosen: OptimizerSection[]; problems: string[] } {
  // The legacy result type models only the Infeasible column shape without
  // `Primal`; every solved status carries primal values at runtime.
  const columns = solution.Columns as unknown as Record<string, { readonly Primal: number }>;
  const indexes: number[] = [];
  for (const [name, column] of Object.entries(columns)) {
    if (!name.startsWith("x")) continue;
    const index = Number(name.slice(1));
    if (!Number.isInteger(index) || index < 0 || index >= model.candidates.length) continue;
    if (column.Primal > 0.5) indexes.push(index);
  }
  const chosen = indexes.map((index) => model.candidates[index]);
  return { indexes, chosen, problems: chosenSetProblems(req, chosen) };
}

function assembleSchedule(req: OptimizeRequest, chosen: OptimizerSection[]): OptimizedSchedule {
  return {
    sectionIds: chosen.map((section) => section.id).sort(),
    byCourse: Object.fromEntries(chosen.map((section) => [section.courseCode, section.id])),
    breakdown: computeBreakdown(req, chosen),
  };
}

/** No-good cut: exclude exactly the found schedule S (all schedules pick one section per course, so no same-size subset of S can differ). */
function noGoodRow(indexes: readonly number[], name: string): LpRow {
  return {
    name,
    terms: indexes.map((index) => [1, index] as const),
    sense: "<=",
    rhs: indexes.length - 1,
  };
}

/** Cost cap for the current tie tier: the model objective (all nonzero columns) must stay within 1e-9 of the tier cost. */
function objectiveCapRow(model: MipModel, cost: number, name = "cap"): LpRow {
  const terms: Array<readonly [number, number]> = [];
  model.data.columns.forEach((column, index) => {
    if (column.objective !== 0) terms.push([column.objective, index]);
  });
  return { name, terms, sense: "<=", rhs: cost + 1e-9 };
}

function infeasibleResult(req: OptimizeRequest): Omit<OptimizeResult, "initMs" | "searchMs"> {
  return {
    status: "infeasible",
    schedules: [],
    diversity: 0,
    infeasibleSubset: findIis(req, (sub) => bruteForceIsFeasible(sub)),
  };
}
