// Independent plan validator. Deliberately dumb: it re-checks every rule from
// the model statement with no shared code with the search walker. Used by the
// tests and by replay to validate every plan the engine emits.

import { offeredIn } from "./catalog.mjs";
import { STATUS } from "./semantics.mjs";

export function validatePlan(problem, assignment, { termLabels } = {}) {
  const errors = [];
  const { byCode, remaining, termCap, horizon, anchor, equivalence } = problem;

  // 1. Every remaining course placed exactly once, within 1..H.
  for (const course of remaining) {
    const term = assignment[course.code];
    if (term === undefined || term < 1 || term > horizon) {
      errors.push(`${course.code}: missing or out-of-horizon placement (${term})`);
    }
  }
  for (const [code, term] of Object.entries(assignment)) {
    if (!remaining.some((course) => course.code === code)) {
      errors.push(`${code}: placed but not a remaining course (pinned courses are not schedulable)`);
    }
    if (term < 1 || term > horizon) errors.push(`${code}: term ${term} outside 1..${horizon}`);
  }

  // 2. Credit cap per term, per active course (app convention).
  const load = {};
  for (const [code, term] of Object.entries(assignment)) {
    load[term] = (load[term] ?? 0) + byCode.get(code).creditHours;
  }
  for (const [term, value] of Object.entries(load)) {
    if (value > termCap) errors.push(`term ${term}: load ${value}h exceeds cap ${termCap}h`);
  }

  // 3. Prerequisites strictly earlier.
  for (const course of remaining) {
    for (const p of course.prereqs) {
      if (!remaining.some((r) => r.code === p)) continue;
      const pTerm = assignment[p];
      const term = assignment[course.code];
      if (pTerm === undefined || term === undefined) continue; // covered by error 1
      if (pTerm >= term) errors.push(`${course.code} (term ${term}) takes its prereq ${p} in the same or a later term (${pTerm})`);
    }
  }

  // 4. Offering assumption per term kind.
  for (const [code, term] of Object.entries(assignment)) {
    const kind = termLabels ? termLabels[term - 1]?.kind : termKindFallback(anchor, term);
    if (!offeredIn(null, code, kind)) errors.push(`${code}: not offered in a ${kind} term per the offering ledger`);
  }

  // 5. Strict mode: no course with an uncataloged prereq ref may be planned
  //    (self-referencing prereq edges are satisfiable and never block).
  if (equivalence === "strict") {
    for (const course of remaining) {
      const hasUncataloged = course.gapPrereqRefs.some((gap) => gap.kind === "uncataloged");
      if (hasUncataloged && assignment[course.code] !== undefined) {
        errors.push(`${course.code}: planned under strict mode despite uncataloged prereq refs ${course.gapPrereqRefs.filter((g) => g.kind === "uncataloged").map((g) => g.code).join(", ")}`);
      }
    }
  }

  // 6. Pinned choices respected: D/P courses never placed.
  for (const code of problem.done) {
    if (assignment[code] !== undefined) errors.push(`${code}: pinned Done but appears in the plan`);
  }
  for (const code of problem.planned) {
    if (assignment[code] !== undefined) errors.push(`${code}: pinned Taking (current term) but appears in the plan`);
  }

  // 7. Goal: every core course ends completed (placed, pinned D, or pinned P).
  // The caller sets problem.coreCodes (a Set) so this checker never
  // hardcodes major definitions.
  for (const course of problem.universe) {
    if (!isCoreOf(problem, course.code)) continue;
    const placed = assignment[course.code] !== undefined;
    if (!placed && !problem.done.has(course.code) && !problem.planned.has(course.code)) {
      errors.push(`${course.code}: core course left unplanned`);
    }
  }

  return { valid: errors.length === 0, errors };
}

function termKindFallback(anchor, termIndex) {
  const order = anchor.kind === "S" ? ["F", "S"] : ["S", "F"];
  return order[(termIndex - 1) % 2];
}

function isCoreOf(problem, code) {
  return problem.coreCodes?.has(code) ?? false;
}
