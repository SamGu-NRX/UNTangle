/**
 * Deadline-bounded IIS explanation for the bnb variant.
 *
 * The reference `findIis` (../iis-reference) runs its deletion filter to
 * completion with no clock. The review blocker: explanation work — the
 * deletion filter AND every feasibility oracle call behind it — must respect
 * the request deadline; returning "infeasible" with an unproven or
 * non-irreducible subset is dishonest. This module is the reference's
 * deletion filter with a deadline threaded through every oracle call.
 *
 * Semantics: the filter either COMPLETES (proven: true, and the subset is
 * exactly what the reference would return — same member order, same
 * deterministic filter) or it ABANDONS (proven: false). An abandoned proof
 * never returns a subset; the caller reports the honest bounded outcome
 * ("timeout" per the frozen contract) instead.
 */

import { allMembers, pruneToMembers } from "../iis-reference";
import type { IisMember, IisSubset, OptimizeRequest } from "../types";

/**
 * Tri-state feasibility verdict for a (possibly pruned) sub-request.
 * "indeterminate" means the oracle ran past its deadline without deciding —
 * the answer is unknown, NOT infeasible.
 */
export type BoundedVerdict = "feasible" | "infeasible" | "indeterminate";

export type BoundedFeasibilityFn = (req: OptimizeRequest) => BoundedVerdict;

export interface BoundedIisResult {
  /** True iff the deletion filter completed; `subset` is present iff true. */
  proven: boolean;
  /** The irreducible subset — only when the proof completed. */
  subset: IisSubset | null;
}

function pastDeadline(deadline: number): boolean {
  return performance.now() > deadline;
}

/** Mirrors iis-reference's private sortMembers (KIND_ORDER, then id). */
function sortMembers(members: IisMember[]): IisMember[] {
  const KIND_ORDER: Record<IisMember["kind"], number> = { course: 0, constraint: 1, locked: 2, excluded: 3 };
  return [...members].sort(
    (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/**
 * The reference deletion filter, bounded. `isFeasible` decides feasibility
 * of a pruned sub-request exactly like the reference's `FeasibilityFn`, but
 * reports "indeterminate" instead of guessing when it cannot finish inside
 * the deadline. Any indeterminate verdict — or a deadline check between
 * oracle calls — abandons the proof (proven: false, no subset).
 *
 * Determinism note: the filter visits members in the reference's order and
 * keeps/drops by the same rule, so a COMPLETED proof is identical to the
 * reference's `findIis` output.
 */
export function findIisBounded(
  req: OptimizeRequest,
  isFeasible: BoundedFeasibilityFn,
  deadline: number,
): BoundedIisResult {
  if (pastDeadline(deadline)) return { proven: false, subset: null };
  const members = allMembers(req);
  const fullVerdict = isFeasible(pruneToMembers(req, members));
  if (fullVerdict === "indeterminate") return { proven: false, subset: null };
  if (fullVerdict === "feasible") {
    throw new Error("iis-bounded: the full request is feasible; no IIS exists");
  }
  let kept: IisMember[] = members;
  for (const member of members) {
    if (pastDeadline(deadline)) return { proven: false, subset: null };
    const withoutMember = kept.filter((m) => !(m.kind === member.kind && m.id === member.id));
    if (withoutMember.length === 0) continue; // the empty member set is the empty request: feasible
    const verdict = isFeasible(pruneToMembers(req, withoutMember));
    if (verdict === "indeterminate") return { proven: false, subset: null };
    if (verdict === "infeasible") kept = withoutMember;
  }
  return { proven: true, subset: { members: sortMembers(kept) } };
}
