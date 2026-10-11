/**
 * IIS reference: the deletion filter.
 *
 * An IIS (irreducible infeasible subset) for a request is a set of members
 * (requested courses, hard constraints, locked ids, excluded ids — the same
 * shape types.ts pins) such that the sub-request over ONLY those members is
 * infeasible, and removing any single member makes it feasible.
 *
 * The deletion filter starts from the full member set and, member by member
 * in a deterministic order, permanently removes any member whose removal
 * keeps the sub-instance infeasible. The result is irreducible by
 * construction. This module is used by brute-force.ts and available to
 * variants through the bench path; it shares NO code with checker.ts (the
 * checker carries its own independent pruning + enumeration for verifyIis —
 * the two must agree, and the contract tests cross-check them).
 */

import type { IisMember, IisSubset, OptimizeRequest } from "./types";

export type FeasibilityFn = (req: OptimizeRequest) => boolean;

/** Constraint ids that can appear as members, in member-listing order. */
const CONSTRAINT_IDS = ["earliestStart", "latestEnd", "daysOff", "maxCredits", "minTransferMinutes"] as const;

function constraintPresent(req: OptimizeRequest, id: string): boolean {
  const hard = req.hardConstraints;
  switch (id) {
    case "earliestStart": return hard.earliestStart !== undefined;
    case "latestEnd": return hard.latestEnd !== undefined;
    case "daysOff": return hard.daysOff !== undefined;
    case "maxCredits": return hard.maxCredits !== undefined;
    case "minTransferMinutes": return hard.minTransferMinutes !== undefined;
    default: return false;
  }
}

/** Every candidate member of the request, in the filter's deterministic order. */
export function allMembers(req: OptimizeRequest): IisMember[] {
  const members: IisMember[] = [];
  for (const code of req.requestedCourseCodes) members.push({ kind: "course", id: code });
  for (const id of CONSTRAINT_IDS) {
    if (constraintPresent(req, id)) members.push({ kind: "constraint", id });
  }
  if (req.hardConstraints.blockedTimeRanges !== undefined) {
    req.hardConstraints.blockedTimeRanges.forEach((_, i) => members.push({ kind: "constraint", id: `blockedTimeRanges.${i}` }));
  }
  for (const id of req.lockedSectionIds) members.push({ kind: "locked", id });
  for (const id of req.excludedSectionIds) members.push({ kind: "excluded", id });
  return members;
}

/**
 * Reduce a request to ONLY the kept members' courses/constraints/locks/
 * exclusions. The sections pool stays whole: per the pinned semantics,
 * sections of non-requested courses are ignored anyway. Soft weights,
 * anchors, walking, k and time budget are not IIS members and pass through.
 */
export function pruneToMembers(req: OptimizeRequest, kept: Iterable<IisMember>): OptimizeRequest {
  const keep = new Set<string>();
  for (const member of kept) keep.add(`${member.kind}:${member.id}`);

  const hard: OptimizeRequest["hardConstraints"] = {};
  for (const id of CONSTRAINT_IDS) {
    if (constraintPresent(req, id) && keep.has(`constraint:${id}`)) {
      (hard as Record<string, unknown>)[id] = req.hardConstraints[id as keyof typeof req.hardConstraints];
    }
  }
  if (req.hardConstraints.blockedTimeRanges !== undefined) {
    const ranges = req.hardConstraints.blockedTimeRanges.filter((_, i) => keep.has(`constraint:blockedTimeRanges.${i}`));
    if (ranges.length > 0) hard.blockedTimeRanges = ranges;
  }

  return {
    ...req,
    requestedCourseCodes: req.requestedCourseCodes.filter((code) => keep.has(`course:${code}`)),
    lockedSectionIds: req.lockedSectionIds.filter((id) => keep.has(`locked:${id}`)),
    excludedSectionIds: req.excludedSectionIds.filter((id) => keep.has(`excluded:${id}`)),
    hardConstraints: hard,
  };
}

const KIND_ORDER: Record<IisMember["kind"], number> = { course: 0, constraint: 1, locked: 2, excluded: 3 };

function sortMembers(members: IisMember[]): IisMember[] {
  return [...members].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Deletion filter. `isFeasible` decides feasibility of a pruned sub-request
 * (brute force passes its exhaustive checker). Deterministic: the same
 * request yields the same irreducible subset.
 */
export function findIis(req: OptimizeRequest, isFeasible: FeasibilityFn): IisSubset {
  const members = allMembers(req);
  if (isFeasible(pruneToMembers(req, members))) {
    throw new Error("iis-reference: the full request is feasible; no IIS exists");
  }
  let kept: IisMember[] = members;
  for (const member of members) {
    const withoutMember = kept.filter((m) => !(m.kind === member.kind && m.id === member.id));
    if (withoutMember.length === 0) continue; // the empty member set is the empty request: feasible
    if (!isFeasible(pruneToMembers(req, withoutMember))) kept = withoutMember;
  }
  return { members: sortMembers(kept) };
}
