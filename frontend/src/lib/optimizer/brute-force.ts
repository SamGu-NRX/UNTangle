/**
 * The exact reference optimizer.
 *
 * Enumerates the cartesian product of per-course candidate lists (after
 * exclusions), keeps only hard-feasible schedules, scores with scorer.ts,
 * and returns the contract's OptimizeResult shape: top-k under the
 * compareSchedules ordering, diversity per contract, status 'optimal' (the
 * enumeration always completes or throws) or 'infeasible' with an IIS found
 * by iis-reference.ts.
 *
 * No search-order cleverness beyond simple feasibility pruning that cannot
 * change the result set: pairwise overlap, credits, day-off, window and
 * blocked-range pruning is monotone (adding sections never repairs those),
 * so partials that already violate them are cut. The transfer rule is NOT
 * used for pruning because adding a section can re-pair consecutive
 * meetings; it is checked exactly at each complete assignment.
 */

import type { OptimizeRequest, OptimizeResult, OptimizedSchedule, OptimizerMeeting, OptimizerSection } from "./types";
import { compareSchedules, computeBreakdown, computeDiversity, findLockedConflict, pruneCandidates } from "./scorer";
import { findIis } from "./iis-reference";

/** The brute-force enumerability bound pinned by the contract. */
const ENUMERABLE_PRODUCT_BOUND = 1_000_000;

/**
 * Typed refusal for instances whose candidate-product exceeds the
 * enumeration bound (see ENUMERABLE_PRODUCT_BOUND). Consumers — the bench
 * runner and any exhaustive variant — classify this error STRUCTURALLY via
 * instanceof; matching on the message string is forbidden.
 */
export class NonEnumerableRefusal extends Error {
  readonly productSize: number;

  constructor(productSize: number) {
    super(
      `optimizer: candidate-product ${productSize} exceeds the ${ENUMERABLE_PRODUCT_BOUND} enumeration bound — instance is not brute-forceable`,
    );
    this.name = "NonEnumerableRefusal";
    this.productSize = productSize;
  }
}

/**
 * Build the per-course candidate lists for enumeration: pool sections of
 * requested courses, minus exclusions; a course with a valid locked pool
 * section collapses to just that section (the lock must be chosen).
 */
function candidateLists(req: OptimizeRequest): { courseCode: string; sections: OptimizerSection[] }[] {
  const poolById = new Map(req.sections.map((section) => [section.id, section] as const));
  const lockedPerCourse = new Map<string, OptimizerSection>();
  for (const id of req.lockedSectionIds) {
    const section = poolById.get(id);
    if (!section || !req.requestedCourseCodes.includes(section.courseCode)) continue; // ignored per contract
    lockedPerCourse.set(section.courseCode, section);
  }
  const lists = pruneCandidates(req).map(({ courseCode, sections }) => {
    const locked = lockedPerCourse.get(courseCode);
    return {
      courseCode,
      sections: locked ? sections.filter((s) => s.id === locked.id) : sections,
    };
  });
  lists.sort((a, b) => (a.courseCode < b.courseCode ? -1 : a.courseCode > b.courseCode ? 1 : 0));
  return lists;
}

/** Monotone constraints only (safe to prune partials): overlap, window, day-off, credits, blocked. */
function violatesMonotone(req: OptimizeRequest, chosenMeetings: (OptimizerMeeting & { sectionId: string })[], section: OptimizerSection, creditsSoFar: number): boolean {
  const hard = req.hardConstraints;
  if (hard.maxCredits !== undefined && creditsSoFar + section.credits > hard.maxCredits) return true;
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
  for (const existing of chosenMeetings) {
    for (const meeting of section.meetings) {
      if (existing.day === meeting.day && existing.start < meeting.end && meeting.start < existing.end) return true;
    }
  }
  return false;
}

/** The transfer rule, checked only on complete assignments (see module doc). */
function violatesTransfer(req: OptimizeRequest, chosen: OptimizerSection[]): boolean {
  const min = req.hardConstraints.minTransferMinutes;
  if (min === undefined) return false;
  const byDay = new Map<string, { start: number; end: number; buildingId: string }[]>();
  for (const section of chosen) {
    for (const meeting of section.meetings) {
      const list = byDay.get(meeting.day) ?? [];
      list.push({ start: meeting.start, end: meeting.end, buildingId: meeting.buildingId });
      byDay.set(meeting.day, list);
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

function throwIfNotEnumerable(req: OptimizeRequest): { courseCode: string; sections: OptimizerSection[] }[] {
  const lists = candidateLists(req);
  let product = 1;
  for (const list of lists) {
    product *= list.sections.length;
    if (product > ENUMERABLE_PRODUCT_BOUND) {
      throw new NonEnumerableRefusal(product);
    }
  }
  return lists;
}

function infeasibleResult(req: OptimizeRequest, initMs: number, searchMs: number): OptimizeResult {
  return {
    status: "infeasible",
    schedules: [],
    diversity: 0,
    initMs,
    searchMs,
    infeasibleSubset: findIis(req, (sub) => isFeasible(sub)),
  };
}

/**
 * The exact optimizer. Deterministic: identical requests produce identical
 * results (schedules are totally ordered by cost then joined sorted ids).
 */
export async function optimize(req: OptimizeRequest): Promise<OptimizeResult> {
  const t0 = performance.now();
  if (findLockedConflict(req)) {
    const initMs = performance.now() - t0;
    return infeasibleResult(req, initMs, 0);
  }
  const lists = throwIfNotEnumerable(req);
  const initMs = performance.now() - t0;
  const tSearch = performance.now();

  const chosen: OptimizerSection[] = [];
  const chosenMeetings: (OptimizerMeeting & { sectionId: string })[] = [];
  const feasible: OptimizedSchedule[] = [];

  const walk = (index: number, creditsSoFar: number): void => {
    if (index >= lists.length) {
      if (violatesTransfer(req, chosen)) return;
      const sectionIds = chosen.map((s) => s.id).sort();
      feasible.push({
        sectionIds,
        byCourse: Object.fromEntries(chosen.map((s) => [s.courseCode, s.id])),
        breakdown: computeBreakdown(req, chosen),
      });
      return;
    }
    for (const section of lists[index].sections) {
      if (violatesMonotone(req, chosenMeetings, section, creditsSoFar)) continue;
      chosen.push(section);
      for (const meeting of section.meetings) chosenMeetings.push({ ...meeting, sectionId: section.id });
      walk(index + 1, creditsSoFar + section.credits);
      chosenMeetings.length -= section.meetings.length;
      chosen.pop();
    }
  };
  walk(0, 0);

  const searchMs = performance.now() - tSearch;
  if (feasible.length === 0) return infeasibleResult(req, initMs, searchMs);

  const schedules = feasible.sort(compareSchedules).slice(0, req.k);
  return {
    status: "optimal",
    schedules,
    diversity: computeDiversity(schedules, req.requestedCourseCodes.length),
    initMs,
    searchMs,
  };
}

/**
 * Feasibility of a (possibly pruned) request: does at least one assignment of
 * one section per requested course satisfy every hard constraint? Used for
 * IIS verification by brute force and available to the harness.
 */
export function isFeasible(req: OptimizeRequest): boolean {
  if (findLockedConflict(req)) return false;
  const lists = candidateLists(req);
  const chosen: OptimizerSection[] = [];
  const chosenMeetings: (OptimizerMeeting & { sectionId: string })[] = [];

  const walk = (index: number, creditsSoFar: number): boolean => {
    if (index >= lists.length) return !violatesTransfer(req, chosen);
    for (const section of lists[index].sections) {
      if (violatesMonotone(req, chosenMeetings, section, creditsSoFar)) continue;
      chosen.push(section);
      for (const meeting of section.meetings) chosenMeetings.push({ ...meeting, sectionId: section.id });
      const ok = walk(index + 1, creditsSoFar + section.credits);
      chosenMeetings.length -= section.meetings.length;
      chosen.pop();
      if (ok) return true;
    }
    return false;
  };
  return walk(0, 0);
}
