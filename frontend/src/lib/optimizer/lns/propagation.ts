/**
 * Constraint propagation for the LNS variant.
 *
 * Domains are per-course candidate lists: pool sections of requested courses
 * minus exclusions, a valid lock collapsing its course to that one section.
 * Propagation prunes only candidates that provably cannot appear in ANY
 * feasible schedule:
 * - unary constraints (earliestStart, latestEnd, daysOff, blockedTimeRanges)
 *   — a section violating one can never be chosen; a LOCKED section
 *   violating one is immediate infeasibility (the lock must be chosen);
 * - credits bounds — a sum of per-course minimum credits above maxCredits
 *   proves infeasibility, and a candidate pushing the minimum total over
 *   the cap is pruned;
 * - singleton conflicts — a course with exactly one remaining candidate is
 *   forced, so any other candidate overlapping it (same day, half-open
 *   [start, end)) is pruned, and two forced overlapping candidates prove
 *   infeasibility.
 *
 * Every rule is sound: pruning never removes a candidate of a feasible
 * schedule, so an empty domain proves infeasibility, and searching the
 * propagated domains searches a superset of all feasible schedules. The
 * transfer rule is deliberately NOT propagated — adding a section can
 * re-pair consecutive meetings — it is checked exactly on complete
 * schedules (the same discipline as the brute-force reference).
 */

import type { OptimizeRequest, OptimizerSection } from "../types";
import { pruneCandidates } from "../scorer";

/** Per-course candidate domain after propagation. */
export interface CourseDomain {
  courseCode: string;
  /** Remaining candidates, ascending by section id (pruneCandidates order). */
  candidates: OptimizerSection[];
  /** The valid locked pool section pinning this course, or null. */
  lockedSection: OptimizerSection | null;
}

export interface PropagationOutcome {
  /** False only when propagation PROVED the request infeasible. */
  feasible: boolean;
  /** The propagated domains; empty when infeasible. */
  domains: CourseDomain[];
}

/** The monotone per-section constraints only (never the transfer rule). */
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
  return false;
}

/** Pairwise half-open overlap between two sections' meetings. */
export function sectionsOverlap(a: OptimizerSection, b: OptimizerSection): boolean {
  for (const ma of a.meetings) {
    for (const mb of b.meetings) {
      if (ma.day === mb.day && ma.start < mb.end && mb.start < ma.end) return true;
    }
  }
  return false;
}

/**
 * Propagate to a fixpoint. Deterministic and read-only on the request.
 * feasible=false only on a sound proof (empty domain, overloaded credits
 * floor, or two forced conflicting candidates).
 */
export function propagate(req: OptimizeRequest): PropagationOutcome {
  const poolById = new Map(req.sections.map((section) => [section.id, section] as const));
  const lockedPerCourse = new Map<string, OptimizerSection>();
  for (const id of req.lockedSectionIds) {
    const section = poolById.get(id);
    if (!section || !req.requestedCourseCodes.includes(section.courseCode)) continue; // ignored per contract
    const existing = lockedPerCourse.get(section.courseCode);
    if (existing && existing.id !== id) return { feasible: false, domains: [] }; // two locks, one course
    lockedPerCourse.set(section.courseCode, section);
  }

  const domains: CourseDomain[] = pruneCandidates(req).map(({ courseCode, sections }) => {
    const locked = lockedPerCourse.get(courseCode) ?? null;
    return {
      courseCode,
      candidates: locked ? sections.filter((s) => s.id === locked.id) : sections,
      lockedSection: locked,
    };
  });

  const maxCredits = req.hardConstraints.maxCredits;
  let changed = true;
  while (changed) {
    changed = false;

    // Unary pruning; locked sections stay (a violating lock is infeasibility).
    for (const domain of domains) {
      if (domain.lockedSection) {
        if (violatesUnary(req, domain.lockedSection)) return { feasible: false, domains: [] };
        if (domain.candidates.length === 0) return { feasible: false, domains: [] }; // lock excluded or not in pool
        continue;
      }
      const kept = domain.candidates.filter((section) => !violatesUnary(req, section));
      if (kept.length !== domain.candidates.length) {
        domain.candidates = kept;
        changed = true;
      }
      if (domain.candidates.length === 0) return { feasible: false, domains: [] };
    }

    // Credits bounds: floor over per-course minimums, then per candidate.
    if (maxCredits !== undefined) {
      const mins = domains.map((domain) => Math.min(...domain.candidates.map((section) => section.credits)));
      const floor = mins.reduce((sum, value) => sum + value, 0);
      if (floor > maxCredits) return { feasible: false, domains: [] };
      for (let i = 0; i < domains.length; i++) {
        const domain = domains[i];
        if (domain.lockedSection) continue; // locked stays; the floor check handles overload
        const othersFloor = floor - mins[i];
        const kept = domain.candidates.filter((section) => othersFloor + section.credits <= maxCredits);
        if (kept.length !== domain.candidates.length) {
          domain.candidates = kept;
          changed = true;
        }
        if (domain.candidates.length === 0) return { feasible: false, domains: [] };
      }
    }

    // Singleton conflicts: a forced section prunes overlapping candidates,
    // and two forced overlapping candidates are infeasible.
    for (const singleton of domains) {
      if (singleton.candidates.length !== 1) continue;
      const forced = singleton.candidates[0];
      for (const domain of domains) {
        if (domain === singleton) continue;
        if (domain.candidates.length === 1) {
          if (sectionsOverlap(domain.candidates[0], forced)) return { feasible: false, domains: [] };
          continue;
        }
        const kept = domain.candidates.filter((section) => !sectionsOverlap(section, forced));
        if (kept.length !== domain.candidates.length) {
          domain.candidates = kept;
          changed = true;
        }
        if (domain.candidates.length === 0) return { feasible: false, domains: [] };
      }
    }
  }

  return { feasible: true, domains };
}
