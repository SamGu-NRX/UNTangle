/**
 * Branch-and-bound preprocessing (the bnb variant).
 *
 * Pure functions over the frozen contract: per-course candidate lists after
 * unary hard-constraint pruning, the pairwise cross-course section conflict
 * map, and per-section self costs for the admissible lower bound. Nothing
 * here mutates the request, and no cost term is re-derived — the search
 * scores complete schedules with the normative computeBreakdown from
 * scorer.ts; the self cost here is only the bound's per-section slice.
 */

import {
  DEFAULT_EARLY_START_ANCHOR_MINUTES,
  DEFAULT_LATE_END_ANCHOR_MINUTES,
  type OptimizeRequest,
  type OptimizerMeeting,
  type OptimizerSection,
} from "../types";
import { findLockedConflict, pruneCandidates } from "../scorer";

/** Why prepare() judged the request infeasible before any search ran. */
export type PrepareFailure =
  | { kind: "locked-excluded"; sectionId: string }
  | { kind: "locked-twice"; courseCode: string; sectionId: string }
  | { kind: "locked-unary"; courseCode: string; sectionId: string }
  | { kind: "empty-course"; courseCode: string };

export interface CourseCandidates {
  courseCode: string;
  /** Candidates in id-ascending order — the enumeration order. */
  candidates: OptimizerSection[];
  /** Candidates ascending by self cost (tie: id) — the bound's cost walk. */
  bySelfCost: OptimizerSection[];
  /** Candidates ascending by credits (tie: id) — the bound's credits walk. */
  byCredits: OptimizerSection[];
}

export interface Prepared {
  /** DFS course order: fewest candidates first, courseCode as tiebreak. */
  courses: CourseCandidates[];
  /** Section id -> ids of sections (of OTHER courses) it may not coexist with. */
  conflicts: Map<string, Set<string>>;
  /** Section id -> self cost (see selfCostOf). */
  selfCost: Map<string, number>;
}

/** Pairwise half-open overlap on the same day. */
function meetingsOverlap(a: OptimizerMeeting, b: OptimizerMeeting): boolean {
  return a.day === b.day && a.start < b.end && b.start < a.end;
}

/**
 * Unary hard constraints: a section violates them on its own, independent
 * of the rest of the schedule — earliestStart, latestEnd, daysOff,
 * blockedTimeRanges. A section whose OWN meetings overlap each other can
 * never be part of a feasible schedule either ("no two chosen meetings may
 * overlap" pins the rule for every pair of chosen meetings, including two
 * meetings of the same section), so self-overlap counts as
 * unary-infeasible too. maxCredits and minTransferMinutes are NOT unary:
 * they depend on the chosen set.
 */
export function violatesUnary(req: OptimizeRequest, section: OptimizerSection): boolean {
  const hard = req.hardConstraints;
  const earliestStart = hard.earliestStart;
  if (earliestStart !== undefined && section.meetings.some((m) => m.start < earliestStart)) return true;
  const latestEnd = hard.latestEnd;
  if (latestEnd !== undefined && section.meetings.some((m) => m.end > latestEnd)) return true;
  if (hard.daysOff !== undefined) {
    const off = new Set(hard.daysOff);
    if (section.meetings.some((m) => off.has(m.day))) return true;
  }
  if (hard.blockedTimeRanges !== undefined) {
    for (const range of hard.blockedTimeRanges) {
      for (const meeting of section.meetings) {
        if (meeting.day === range.day && meeting.start < range.end && range.start < meeting.end) return true;
      }
    }
  }
  for (let i = 0; i < section.meetings.length; i++) {
    for (let j = i + 1; j < section.meetings.length; j++) {
      if (meetingsOverlap(section.meetings[i], section.meetings[j])) return true;
    }
  }
  return false;
}

/**
 * The SELF slice of the pinned cost formula: the early-start and late-end
 * meeting terms minus the section's rating/GPA credits. Gap, walking,
 * unknown-walking and day terms are interactions between sections — the
 * bound treats them as 0 (see bnb-optimizer.ts for the admissibility
 * argument). Missing rating/GPA contribute 0, matching computeBreakdown.
 */
export function selfCostOf(req: OptimizeRequest, section: OptimizerSection): number {
  const earlyAnchor = req.earlyStartAnchorMinutes ?? DEFAULT_EARLY_START_ANCHOR_MINUTES;
  const lateAnchor = req.lateEndAnchorMinutes ?? DEFAULT_LATE_END_ANCHOR_MINUTES;
  let earlyStartMinutes = 0;
  let lateEndMinutes = 0;
  for (const meeting of section.meetings) {
    earlyStartMinutes += Math.max(0, earlyAnchor - meeting.start);
    lateEndMinutes += Math.max(0, meeting.end - lateAnchor);
  }
  const w = req.softWeights;
  return (
    w.perEarlyStartMinute * earlyStartMinutes +
    w.perLateEndMinute * lateEndMinutes -
    w.perRatingPoint * (section.instructorRating ?? 0) -
    w.perGpaPoint * (section.historicalGpa ?? 0)
  );
}

function byId(a: OptimizerSection, b: OptimizerSection): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Build the search's static data, or report why the request is infeasible
 * before any search: a locked==excluded pool section of a requested course,
 * two different locks on one requested course (both must be chosen, but
 * only one section per course can be), a locked section violating a unary
 * constraint (the lock forces it into every schedule), or a requested
 * course with no remaining candidate.
 */
export function prepare(
  req: OptimizeRequest,
): { ok: true; prepared: Prepared } | { ok: false; failure: PrepareFailure } {
  const lockedExcluded = findLockedConflict(req);
  if (lockedExcluded !== null) {
    return { ok: false, failure: { kind: "locked-excluded", sectionId: lockedExcluded } };
  }

  const poolById = new Map(req.sections.map((section) => [section.id, section] as const));
  const requested = new Set(req.requestedCourseCodes);
  // Locked ids that are pool sections of requested courses are forced; the
  // rest are ignored per the pinned request semantics.
  const lockedPerCourse = new Map<string, OptimizerSection>();
  for (const id of req.lockedSectionIds) {
    const section = poolById.get(id);
    if (!section || !requested.has(section.courseCode)) continue;
    const existing = lockedPerCourse.get(section.courseCode);
    if (existing && existing.id !== id) {
      return { ok: false, failure: { kind: "locked-twice", courseCode: section.courseCode, sectionId: id } };
    }
    lockedPerCourse.set(section.courseCode, section);
  }

  const courses: CourseCandidates[] = [];
  const selfCost = new Map<string, number>();
  const seenCourses = new Set<string>();
  for (const { courseCode, sections } of pruneCandidates(req)) {
    // Exactly one chosen section per requested course: a duplicated code is
    // one course (pruneCandidates would otherwise list it twice).
    if (seenCourses.has(courseCode)) continue;
    seenCourses.add(courseCode);

    const locked = lockedPerCourse.get(courseCode);
    let kept: OptimizerSection[];
    if (locked) {
      if (violatesUnary(req, locked)) {
        return { ok: false, failure: { kind: "locked-unary", courseCode, sectionId: locked.id } };
      }
      // The lock decides the course; its other candidates are moot.
      kept = sections.filter((section) => section.id === locked.id);
      if (kept.length === 0) {
        // Unreachable: the locked section is a non-excluded pool section of
        // this course, so pruneCandidates lists it. Defensive anyway.
        return { ok: false, failure: { kind: "empty-course", courseCode } };
      }
    } else {
      kept = sections.filter((section) => !violatesUnary(req, section));
      if (kept.length === 0) {
        return { ok: false, failure: { kind: "empty-course", courseCode } };
      }
    }

    for (const section of kept) selfCost.set(section.id, selfCostOf(req, section));
    const bySelfCost = [...kept].sort((a, b) => {
      const diff = (selfCost.get(a.id) ?? 0) - (selfCost.get(b.id) ?? 0);
      return diff !== 0 ? diff : byId(a, b);
    });
    const byCredits = [...kept].sort((a, b) => a.credits - b.credits || byId(a, b));
    courses.push({ courseCode, candidates: kept, bySelfCost, byCredits });
  }

  // Pairwise conflicts across different courses; sections of the same
  // course are never both chosen, so those pairs are skipped.
  const conflicts = new Map<string, Set<string>>();
  const allCandidates = courses.flatMap((course) => course.candidates);
  for (let i = 0; i < allCandidates.length; i++) {
    for (let j = i + 1; j < allCandidates.length; j++) {
      const a = allCandidates[i];
      const b = allCandidates[j];
      if (a.courseCode === b.courseCode) continue;
      if (!a.meetings.some((ma) => b.meetings.some((mb) => meetingsOverlap(ma, mb)))) continue;
      const aSet = conflicts.get(a.id) ?? new Set<string>();
      aSet.add(b.id);
      conflicts.set(a.id, aSet);
      const bSet = conflicts.get(b.id) ?? new Set<string>();
      bSet.add(a.id);
      conflicts.set(b.id, bSet);
    }
  }

  // Fewest remaining candidates first; deterministic tiebreak.
  courses.sort(
    (a, b) =>
      a.candidates.length - b.candidates.length ||
      (a.courseCode < b.courseCode ? -1 : a.courseCode > b.courseCode ? 1 : 0),
  );
  return { ok: true, prepared: { courses, conflicts, selfCost } };
}
