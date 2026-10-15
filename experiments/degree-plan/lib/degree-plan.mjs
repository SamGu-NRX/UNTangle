// Degree-plan search: bounded (K-best, budgeted) vs exhaustive (full
// enumeration) over the same model, plus infeasibility witnesses.
//
// Model (all of it stated, none of it hidden):
// - Universe: a major's core list closed under catalog prerequisites.
// - Terms: a fixed horizon of Spring/Fall terms after the current one
//   (summer is assumed to offer nothing — see OFFERING_ASSUMPTIONS).
// - Term 0 (the current term) holds the user's P (inProgress) courses,
//   exactly as the single-semester planner shows them; they are pinned.
// - A CR course may be placed in term t (1..H) iff
//     (a) it is offered that term (assumption ledger),
//     (b) every catalog prerequisite is completed in an EARLIER term
//         (or pinned D before term 1, or pinned P completing at term 0's
//         end), and
//     (c) its uncataloged prereq refs are covered by the equivalence
//         assumption when equivalence mode is "assume" (strict mode:
//         the course is unplannable and the gap becomes a witness), and
//     (d) the term's credit load stays within the cap (credits counted
//         per active course — the app's own convention; see
//         docs/schedule-oracle-report.md for the modeled difference vs
//         per-section sums).
// - Goal: every core course completed (pinned D counts as completed).
// - Objective (lexicographic): fewest terms used, then the
//   lexicographically smallest per-course term assignment (deterministic).

import { offeredIn } from "./catalog.mjs";
import { STATUS } from "./semantics.mjs";

// Safety valve: enumeration reports honestly instead of lying when the node
// budget would blow. Recorded per case as exhaustiveComplete.
export const EXHAUSTIVE_NODE_BUDGET = 5_000_000;

export function buildProblem({
  universe,
  courseStatuses,
  transcriptRecords = [],
  termCap,
  horizon,
  anchor,
  equivalence = "assume",
}) {
  const byCode = new Map(universe.map((course) => [course.code, course]));
  const done = new Set(
    universe
      .filter((course) => courseStatuses[course.code] === STATUS.DONE)
      .map((course) => course.code),
  );
  const planned = new Set(
    universe
      .filter((course) => courseStatuses[course.code] === STATUS.PLANNED)
      .map((course) => course.code),
  );

  // Which remaining courses can EVER be planned? A course with an uncataloged
  // prereq ref is unplannable in strict mode: the app could never satisfy it,
  // because normalizePlannerState drops statuses for non-catalog codes.
  // (Self-referencing prereq edges are NOT blockers: setCourseStatus has no
  // lock gate, so completing the course satisfies its own prereq edge.)
  const unplannable = [];
  const remaining = [];
  for (const course of universe) {
    if (done.has(course.code) || planned.has(course.code)) continue;
    const hasUncataloged = course.gapPrereqRefs.some((gap) => gap.kind === "uncataloged");
    if (hasUncataloged && equivalence === "strict") {
      unplannable.push({
        code: course.code,
        uncatalogedPrereqs: course.gapPrereqRefs.filter((g) => g.kind === "uncataloged").map((g) => g.code),
        selfRefs: course.gapPrereqRefs.filter((g) => g.kind === "self").map((g) => g.code),
      });
    } else {
      remaining.push(course);
    }
  }
  remaining.sort((a, b) => a.code.localeCompare(b.code));

  // Cycle check over catalog-only edges (defensive; the real catalog is a DAG).
  const cycle = findCycle(remaining);
  if (cycle) throw new Error(`prerequisite cycle in universe: ${cycle.join(" -> ")}`);

  return {
    universe,
    byCode,
    done,
    planned,
    remaining,
    unplannable,
    termCap,
    horizon,
    anchor,
    equivalence,
    transcriptRecords,
  };
}

function findCycle(remaining) {
  const byCode = new Map(remaining.map((course) => [course.code, course]));
  const state = new Map();
  const stack = [];
  const visit = (code) => {
    if (state.get(code) === 2) return false;
    if (state.get(code) === 1) {
      stack.push(code);
      const start = stack.indexOf(code);
      return stack.slice(start);
    }
    state.set(code, 1);
    stack.push(code);
    const course = byCode.get(code);
    for (const prereq of course.prereqs) {
      if (byCode.has(prereq)) {
        const found = visit(prereq);
        if (found) return found;
      }
    }
    stack.pop();
    state.set(code, 2);
    return false;
  };
  for (const course of remaining) {
    const found = visit(course.code);
    if (found) return found;
  }
  return null;
}

// A plan is an assignment: courseCode -> term index (1..H). Term 0 holds the
// pinned P courses and is implicit.
export function planFromAssignment(assignment) {
  const terms = [];
  for (const [code, term] of Object.entries(assignment)) {
    (terms[term] ??= []).push(code);
  }
  for (let i = 0; i < terms.length; i += 1) terms[i] ??= [];
  return terms.map((term) => [...term].sort());
}

export function planTermsUsed(assignment) {
  let maxTerm = 0;
  for (const term of Object.values(assignment)) maxTerm = Math.max(maxTerm, term);
  return maxTerm;
}

// Lexicographic key: [termsUsed, then per-course term in sorted-code order].
export function planKey(assignment, codes) {
  const parts = [planTermsUsed(assignment)];
  for (const code of codes) parts.push(assignment[code] ?? 0);
  return parts;
}

function betterAssignment(a, b, codes) {
  if (!b) return true;
  const ka = planKey(a, codes);
  const kb = planKey(b, codes);
  for (let i = 0; i < ka.length; i += 1) {
    if (ka[i] !== kb[i]) return ka[i] < kb[i];
  }
  return false;
}

// Core enumeration. Both modes share this single walker — the difference is
// only the stopping rule (topK plan cap for bounded; node budget for both),
// so "bounded vs exhaustive" measures the budget, not two different models.
export function enumerate(problem, { mode, topK = 200, nodeBudget = EXHAUSTIVE_NODE_BUDGET } = {}) {
  const { remaining, termCap, horizon, planned, anchor, byCode } = problem;
  const started = process.hrtime.bigint();
  let nodes = 0;
  let feasiblePlans = 0;
  let stopped = false;

  const codes = remaining.map((course) => course.code);

  // Pinned-P load occupies term 0; P courses complete at term 0's end.
  let pinnedLoad = 0;
  for (const code of planned) pinnedLoad += byCode.get(code).creditHours;
  if (pinnedLoad > termCap) {
    return {
      feasible: false,
      witness: {
        kind: "current-term-over-cap",
        detail: `Pinned in-progress load ${pinnedLoad}h exceeds the ${termCap}h term cap before any planning.`,
      },
      best: null,
      feasiblePlans: 0,
      nodes: 0,
      runtimeMs: msSince(started),
      exhaustiveComplete: true,
    };
  }

  // Strict mode + a core course that can never be planned (uncataloged
  // prereq refs) is infeasible before the search starts. The witness names
  // every such core course. Assume mode covers them via the equivalence
  // assumption, so only strict hits this path.
  if (problem.equivalence === "strict" && problem.unplannable.length > 0) {
    const coreUnplannable = problem.unplannable.filter((entry) =>
      (problem.coreCodes ?? new Set()).has(entry.code),
    );
    if (coreUnplannable.length > 0) {
      return {
        feasible: false,
        witness: infeasibilityWitness(problem),
        best: null,
        feasiblePlans: 0,
        nodes: 0,
        runtimeMs: msSince(started),
        exhaustiveComplete: true,
      };
    }
  }

  const best = { assignment: null };
  const top = [];
  const assignment = new Map();

  // Eligible now = unplaced, offered this term, load fits, and every catalog
  // prereq inside the remaining set is ALREADY placed in a strictly earlier
  // term (prereqs outside the remaining set are pinned-done or covered by the
  // equivalence assumption — buildProblem guarantees that).
  function eligible(termIndex, load) {
    const out = [];
    for (const course of remaining) {
      if (assignment.has(course.code)) continue;
      if (load + course.creditHours > termCap) continue;
      if (!offeredIn(null, course.code, termKindAt(anchor, termIndex))) continue;
      let ok = true;
      for (const p of course.prereqs) {
        if (!remaining.some((r) => r.code === p)) continue; // pinned or assumed
        if (!assignment.has(p) || assignment.get(p) >= termIndex) {
          ok = false;
          break;
        }
      }
      if (ok) out.push(course.code);
    }
    return out;
  }

  function recordPlan() {
    feasiblePlans += 1;
    const asObj = Object.fromEntries(assignment);
    if (betterAssignment(asObj, best.assignment, codes)) best.assignment = asObj;
    if (mode === "bounded") {
      top.push(asObj);
      top.sort((a, b) => (betterAssignment(a, b, codes) ? -1 : 1));
      if (top.length > topK) top.pop();
      if (top.length >= topK) stopped = true;
    }
  }

  function walk(termIndex, load) {
    if (stopped) return;
    nodes += 1;
    if (nodes > nodeBudget) {
      stopped = true;
      return;
    }
    if (assignment.size === codes.length) {
      recordPlan();
      return;
    }
    if (termIndex > horizon) return; // courses left but no terms left

    // Enumerate subsets of eligible courses for this term via
    // include/defer DFS, include-first so the first complete plan is the
    // greedy-earliest one.
    const options = eligible(termIndex, load);
    const subset = [];
    const choose = (index, subsetLoad) => {
      if (stopped) return;
      if (index === options.length) {
        subset.forEach((code) => assignment.set(code, termIndex));
        if (assignment.size === codes.length) {
          recordPlan();
        } else {
          walk(termIndex + 1, 0);
        }
        for (const code of subset) assignment.delete(code);
        return;
      }
      const code = options[index];
      const creditHours = byCode.get(code).creditHours;
      if (load + subsetLoad + creditHours <= termCap) {
        subset.push(code);
        choose(index + 1, subsetLoad + creditHours);
        subset.pop();
      }
      choose(index + 1, subsetLoad); // defer to a later term
    };
    choose(0, 0);
  }

  walk(1, 0);

  const runtimeMs = msSince(started);
  if (!best.assignment) {
    return {
      feasible: false,
      witness: infeasibilityWitness(problem),
      best: null,
      feasiblePlans: 0,
      nodes,
      runtimeMs,
      // If the budget stopped us before any complete plan was found, the
      // infeasibility verdict is NOT proven — recorded honestly here.
      exhaustiveComplete: !stopped,
      note: stopped ? "stopped at budget with no complete plan found — infeasibility not proven" : undefined,
    };
  }
  return {
    feasible: true,
    best: best.assignment,
    top: mode === "bounded" ? top : undefined,
    feasiblePlans,
    nodes,
    runtimeMs,
    exhaustiveComplete: !stopped,
    note: stopped
      ? mode === "bounded"
        ? `bounded mode stopped after ${topK} plans`
        : "node budget exceeded — enumeration incomplete"
      : undefined,
  };
}

function termKindAt(anchor, termIndex) {
  const order = anchor.kind === "S" ? ["F", "S"] : ["S", "F"];
  return order[(termIndex - 1) % 2];
}

function msSince(started) {
  return Number(process.hrtime.bigint() - started) / 1e6;
}

// Witness: why no plan completes the core within the horizon. Explicit
// families, each with its chain or bound spelled out:
//  1. uncataloged-prereq: a core course is unplannable at all (strict mode).
//  2. chain-exceeds-horizon: the longest prerequisite chain through remaining
//     courses needs more terms than the horizon provides.
//  3. credit-bound: remaining credit hours exceed cap x horizon.
//  4. current-term-over-cap is returned directly from enumerate().
export function infeasibilityWitness(problem) {
  const { horizon, termCap } = problem;
  const coreRemaining = problem.universe.filter(
    (course) => !problem.done.has(course.code) && !problem.planned.has(course.code),
  );
  const blockers = [];
  for (const course of coreRemaining) {
    const uncatalogedGaps = (course.gapPrereqRefs ?? []).filter((gap) => gap.kind === "uncataloged");
    if (uncatalogedGaps.length > 0 && problem.equivalence === "strict") {
      const refs = uncatalogedGaps.map((gap) => gap.code);
      blockers.push({
        code: course.code,
        kind: "uncataloged-prereq",
        uncatalogedPrereqs: refs,
        detail: `Requires ${refs.join(", ")}, which ${refs.length === 1 ? "is not a catalog course" : "are not catalog courses"}. The planner drops statuses for non-catalog codes (planner.ts normalizePlannerState), so the app can never mark this prerequisite completed.`,
      });
      continue;
    }
    const chain = longestChain(problem, course.code);
    if (chain.length > horizon) {
      blockers.push({
        code: course.code,
        kind: "chain-exceeds-horizon",
        chain,
        chainLength: chain.length,
        horizon,
        detail: `Prerequisite chain ${chain.join(" -> ")} needs ${chain.length} terms but the horizon is ${horizon}.`,
      });
    }
  }
  const totalMinCredits = coreRemaining.reduce((total, course) => total + course.creditHours, 0);
  if (totalMinCredits > termCap * horizon) {
    blockers.push({
      kind: "credit-bound",
      totalMinCredits,
      capacity: termCap * horizon,
      detail: `Remaining core needs ${totalMinCredits} credit hours; ${horizon} terms at the ${termCap}-credit cap provide ${termCap * horizon}.`,
    });
  }
  return { kind: "infeasible", blockers, unplannable: problem.unplannable };
}

function longestChain(problem, code) {
  const memo = new Map();
  const walk = (c) => {
    if (memo.has(c)) return memo.get(c);
    memo.set(c, [c]); // cycle guard
    const course = problem.byCode.get(c);
    const inRemaining = course.prereqs.filter((p) => problem.remaining.some((r) => r.code === p));
    let best = [c];
    for (const p of inRemaining) {
      const chain = walk(p);
      if (chain.length + 1 > best.length) best = [...chain, c];
    }
    memo.set(c, best);
    return best;
  };
  return walk(code);
}
