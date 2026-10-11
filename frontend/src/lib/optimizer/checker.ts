/**
 * THE INDEPENDENT CHECKER.
 *
 * Shares NO code with scorer.ts, brute-force.ts, or any variant: every hard
 * -constraint check and every scoring term is re-implemented from scratch in
 * this file, reading semantics ONLY from the doc comments in types.ts. If
 * this file and the scorer disagree, one of them misread the contract — the
 * benchmark treats that as a defect, not a tolerance.
 */

import { weekDays, type WeekDay } from "@/lib/types";
import type {
  IisMember,
  IisSubset,
  OptimizeRequest,
  OptimizedSchedule,
  OptimizerMeeting,
  OptimizerSection,
  ScoreBreakdown,
} from "./types";

/** One violated rule, with the ids involved. */
export interface Violation {
  rule: string;
  message: string;
  ids: string[];
}

const TOLERANCE = 1e-9;

function closeEnough(a: number, b: number): boolean {
  return Math.abs(a - b) <= TOLERANCE;
}

// ---------------------------------------------------------------------------
// Independent sub-instance pruning (for verifyIis)
// ---------------------------------------------------------------------------

function memberKey(member: IisMember): string {
  return `${member.kind}:${member.id}`;
}

/** Reduce a request to ONLY the kept members' courses/constraints/locks/exclusions. */
export function pruneToMembers(req: OptimizeRequest, kept: Iterable<IisMember>): OptimizeRequest {
  const keep = new Set<string>();
  for (const member of kept) keep.add(memberKey(member));
  const keepCourse = (code: string) => keep.has(`course:${code}`);
  const keepLocked = (id: string) => keep.has(`locked:${id}`);
  const keepExcluded = (id: string) => keep.has(`excluded:${id}`);
  const keepConstraint = (id: string) => keep.has(`constraint:${id}`);

  const hard: OptimizeRequest["hardConstraints"] = {};
  if (req.hardConstraints.earliestStart !== undefined && keepConstraint("earliestStart")) {
    hard.earliestStart = req.hardConstraints.earliestStart;
  }
  if (req.hardConstraints.latestEnd !== undefined && keepConstraint("latestEnd")) {
    hard.latestEnd = req.hardConstraints.latestEnd;
  }
  if (req.hardConstraints.daysOff !== undefined && keepConstraint("daysOff")) {
    hard.daysOff = req.hardConstraints.daysOff;
  }
  if (req.hardConstraints.maxCredits !== undefined && keepConstraint("maxCredits")) {
    hard.maxCredits = req.hardConstraints.maxCredits;
  }
  if (req.hardConstraints.minTransferMinutes !== undefined && keepConstraint("minTransferMinutes")) {
    hard.minTransferMinutes = req.hardConstraints.minTransferMinutes;
  }
  if (req.hardConstraints.blockedTimeRanges !== undefined) {
    const ranges = req.hardConstraints.blockedTimeRanges.filter((_, i) => keepConstraint(`blockedTimeRanges.${i}`));
    if (ranges.length > 0) hard.blockedTimeRanges = ranges;
  }

  return {
    ...req,
    requestedCourseCodes: req.requestedCourseCodes.filter(keepCourse),
    lockedSectionIds: req.lockedSectionIds.filter(keepLocked),
    excludedSectionIds: req.excludedSectionIds.filter(keepExcluded),
    hardConstraints: hard,
  };
}

/**
 * Independent feasibility enumeration used by verifyIis (and only there).
 * Plain recursive product walk with leaf checks — no pruning cleverness,
 * no shared code with the brute force. Sub-instances are small by
 * construction; the checker refuses huge ones.
 */
export function independentSubFeasible(req: OptimizeRequest): boolean {
  const excluded = new Set(req.excludedSectionIds);
  const byCourse = new Map<string, OptimizerSection[]>();
  for (const section of req.sections) {
    if (!req.requestedCourseCodes.includes(section.courseCode)) continue;
    if (excluded.has(section.id)) continue;
    const list = byCourse.get(section.courseCode);
    if (list) list.push(section);
    else byCourse.set(section.courseCode, [section]);
  }
  // Locked ids that are pool sections of requested courses must be chosen.
  const poolById = new Map(req.sections.map((section) => [section.id, section] as const));
  const lockedPerCourse = new Map<string, OptimizerSection>();
  for (const id of req.lockedSectionIds) {
    const section = poolById.get(id);
    if (!section || !req.requestedCourseCodes.includes(section.courseCode)) continue; // ignored per contract
    const existing = lockedPerCourse.get(section.courseCode);
    if (existing && existing.id !== id) return false; // two locks, one course
    lockedPerCourse.set(section.courseCode, section);
  }

  const candidateLists: OptimizerSection[][] = [];
  for (const code of req.requestedCourseCodes) {
    const locked = lockedPerCourse.get(code);
    if (locked) {
      if (excluded.has(locked.id)) return false; // locked and excluded
      candidateLists.push([locked]);
    } else {
      const list = (byCourse.get(code) ?? []).slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      candidateLists.push(list);
    }
  }
  let product = 1;
  for (const list of candidateLists) {
    product *= list.length;
    if (product > 1_000_000) throw new Error("checker: sub-instance exceeds the enumerability bound");
  }

  const chosen: OptimizerSection[] = [];
  const walk = (index: number): boolean => {
    if (index >= candidateLists.length) return checkAllHard(req, chosen).length === 0;
    for (const section of candidateLists[index]) {
      chosen.push(section);
      const ok = walk(index + 1);
      chosen.pop();
      if (ok) return true;
    }
    return false;
  };
  return walk(0);
}

// ---------------------------------------------------------------------------
// Hard-constraint and schedule checks (independent re-implementations)
// ---------------------------------------------------------------------------

/** Pairwise half-open overlap on the same day. */
function overlaps(a: OptimizerMeeting, b: OptimizerMeeting): boolean {
  return a.day === b.day && a.start < b.end && b.start < a.end;
}

/**
 * Check one complete schedule (as chosen sections) against every hard
 * constraint and request rule. Returns one Violation per violated rule,
 * naming the rule and the offending ids. Independent of scorer/brute force.
 */
export function checkChosen(req: OptimizeRequest, chosen: OptimizerSection[]): Violation[] {
  const violations: Violation[] = [];
  const poolById = new Map(req.sections.map((section) => [section.id, section] as const));
  const excluded = new Set(req.excludedSectionIds);

  // Pool origin.
  const unknown = chosen.filter((section) => !poolById.has(section.id));
  if (unknown.length > 0) {
    violations.push({ rule: "pool-origin", message: "chosen sections must come from the pool", ids: unknown.map((s) => s.id) });
  }

  // One section per requested course; not-requested sections flagged.
  const multiCourse = new Map<string, string[]>();
  for (const section of chosen) {
    if (!req.requestedCourseCodes.includes(section.courseCode)) {
      violations.push({
        rule: "course-coverage",
        message: `section ${section.id} belongs to non-requested course ${section.courseCode}`,
        ids: [section.id],
      });
      continue;
    }
    const ids = multiCourse.get(section.courseCode) ?? [];
    ids.push(section.id);
    multiCourse.set(section.courseCode, ids);
  }
  const duplicated: string[][] = [];
  for (const ids of multiCourse.values()) {
    if (ids.length > 1) duplicated.push(ids);
  }
  if (duplicated.length > 0) {
    violations.push({ rule: "course-coverage", message: "more than one chosen section for a course", ids: duplicated.flat() });
  }
  const missingCourses = req.requestedCourseCodes.filter((code) => !multiCourse.has(code));
  if (missingCourses.length > 0 && req.requestedCourseCodes.length > 0) {
    violations.push({ rule: "course-coverage", message: "no chosen section for a requested course", ids: missingCourses });
  }

  // Excluded and locked.
  const chosenExcluded = chosen.filter((section) => excluded.has(section.id));
  if (chosenExcluded.length > 0) {
    violations.push({ rule: "excluded-section", message: "an excluded section is chosen", ids: chosenExcluded.map((s) => s.id) });
  }
  const missingLocks: string[] = [];
  for (const id of req.lockedSectionIds) {
    const section = poolById.get(id);
    if (!section || !req.requestedCourseCodes.includes(section.courseCode)) continue; // ignored per contract
    if (!chosen.some((s) => s.id === id)) missingLocks.push(id);
  }
  if (missingLocks.length > 0) {
    violations.push({ rule: "locked-section", message: "a required locked section is not chosen", ids: missingLocks });
  }

  // All chosen meetings, flattened with their section id.
  const meetings: (OptimizerMeeting & { sectionId: string })[] = [];
  for (const section of chosen) {
    for (const meeting of section.meetings) {
      meetings.push({ ...meeting, sectionId: section.id });
    }
  }

  // Pairwise overlap (baseline invariant).
  const overlapIds = new Set<string>();
  for (let i = 0; i < meetings.length; i++) {
    for (let j = i + 1; j < meetings.length; j++) {
      if (overlaps(meetings[i], meetings[j])) {
        overlapIds.add(meetings[i].sectionId);
        overlapIds.add(meetings[j].sectionId);
      }
    }
  }
  if (overlapIds.size > 0) {
    violations.push({ rule: "overlap", message: "chosen meetings overlap", ids: [...overlapIds] });
  }

  // earliestStart / latestEnd.
  const earlyIds = meetings.filter((m) => req.hardConstraints.earliestStart !== undefined && m.start < req.hardConstraints.earliestStart).map((m) => m.sectionId);
  if (earlyIds.length > 0) {
    violations.push({ rule: "earliestStart", message: "a meeting starts before earliestStart", ids: [...new Set(earlyIds)] });
  }
  const lateIds = meetings.filter((m) => req.hardConstraints.latestEnd !== undefined && m.end > req.hardConstraints.latestEnd).map((m) => m.sectionId);
  if (lateIds.length > 0) {
    violations.push({ rule: "latestEnd", message: "a meeting ends after latestEnd", ids: [...new Set(lateIds)] });
  }

  // daysOff.
  if (req.hardConstraints.daysOff !== undefined) {
    const off = new Set<WeekDay>(req.hardConstraints.daysOff);
    const offIds = meetings.filter((m) => off.has(m.day)).map((m) => m.sectionId);
    if (offIds.length > 0) {
      violations.push({ rule: "daysOff", message: "a meeting falls on a day off", ids: [...new Set(offIds)] });
    }
  }

  // maxCredits.
  if (req.hardConstraints.maxCredits !== undefined) {
    const total = chosen.reduce((sum, section) => sum + section.credits, 0);
    if (total > req.hardConstraints.maxCredits) {
      violations.push({ rule: "maxCredits", message: `credits ${total} exceed maxCredits ${req.hardConstraints.maxCredits}`, ids: chosen.map((s) => s.id) });
    }
  }

  // blockedTimeRanges (same day, half-open).
  if (req.hardConstraints.blockedTimeRanges !== undefined) {
    const blockedIds = new Set<string>();
    for (const range of req.hardConstraints.blockedTimeRanges) {
      for (const meeting of meetings) {
        if (meeting.day === range.day && meeting.start < range.end && range.start < meeting.end) {
          blockedIds.add(meeting.sectionId);
        }
      }
    }
    if (blockedIds.size > 0) {
      violations.push({ rule: "blockedTimeRanges", message: "a meeting overlaps a blocked range", ids: [...blockedIds] });
    }
  }

  // minTransferMinutes: consecutive same-day pairs in DIFFERENT buildings.
  if (req.hardConstraints.minTransferMinutes !== undefined) {
    const transferIds = new Set<string>();
    for (const day of weekDays) {
      const dayMeetings = meetings.filter((m) => m.day === day).sort((a, b) => a.start - b.start);
      for (let i = 1; i < dayMeetings.length; i++) {
        const prev = dayMeetings[i - 1];
        const next = dayMeetings[i];
        if (prev.buildingId === next.buildingId) continue;
        if (next.start - prev.end < req.hardConstraints.minTransferMinutes) {
          transferIds.add(prev.sectionId);
          transferIds.add(next.sectionId);
        }
      }
    }
    if (transferIds.size > 0) {
      violations.push({ rule: "minTransferMinutes", message: "a transfer gap is shorter than minTransferMinutes", ids: [...transferIds] });
    }
  }

  return violations;
}

/** Full hard-constraint check over a chosen list (leaf check). */
export function checkAllHard(req: OptimizeRequest, chosen: OptimizerSection[]): Violation[] {
  return checkChosen(req, chosen).filter((violation) => violation.rule !== "course-coverage");
}

// ---------------------------------------------------------------------------
// Result-level checks
// ---------------------------------------------------------------------------

/** Shape of the result object the checker accepts (variants' OptimizeResult). */
export interface OptimizeResultLike {
  status: "optimal" | "feasible" | "infeasible" | "timeout";
  schedules: OptimizedSchedule[];
  diversity: number;
  initMs: number;
  searchMs: number;
  infeasibleSubset?: IisSubset;
}

/**
 * Check a full result: every schedule's hard rules, plus k, ordering,
 * tie-break, per-schedule breakdown recomputation, diversity, and status
 * plausibility. Tolerance 1e-9 on every recomputation.
 */
export function checkResult(req: OptimizeRequest, result: OptimizeResultLike): Violation[] {
  const violations: Violation[] = [];

  if (result.schedules.length > req.k) {
    violations.push({ rule: "k-exceeded", message: `result returns ${result.schedules.length} schedules, k is ${req.k}`, ids: [] });
  }

  // Per-schedule hard rules + internal integrity + breakdown.
  result.schedules.forEach((schedule, index) => {
    const chosen: OptimizerSection[] = [];
    const missing = schedule.sectionIds.filter((id) => {
      const section = req.sections.find((s) => s.id === id);
      if (section) chosen.push(section);
      return !section;
    });
    if (missing.length > 0) {
      violations.push({ rule: "pool-origin", message: `schedule ${index} references unknown sections`, ids: missing });
    }
    for (const violation of checkChosen(req, chosen)) violations.push(violation);

    // sectionIds sorted ascending.
    const sorted = [...schedule.sectionIds].sort();
    if (sorted.join("|") !== schedule.sectionIds.join("|")) {
      violations.push({ rule: "sectionIds-sorted", message: `schedule ${index} sectionIds are not sorted ascending`, ids: schedule.sectionIds });
    }

    // byCourse consistency with the chosen sections.
    for (const section of chosen) {
      if (schedule.byCourse[section.courseCode] !== section.id) {
        violations.push({ rule: "byCourse", message: `schedule ${index} byCourse maps ${section.courseCode} away from ${section.id}`, ids: [section.id] });
      }
    }

    // Breakdown recomputation (independent).
    const recomputed = recomputeBreakdown(req, chosen);
    const terms: (keyof ScoreBreakdown)[] = [
      "gapMinutes", "walkingSeconds", "earlyStartMinutes", "lateEndMinutes",
      "daysOnCampus", "ratingSum", "gpaSum", "unknownWalkingPairs", "cost",
    ];
    for (const term of terms) {
      if (!closeEnough(schedule.breakdown[term], recomputed[term])) {
        violations.push({
          rule: "breakdown",
          message: `schedule ${index} breakdown.${term} is ${schedule.breakdown[term]}, recomputed ${recomputed[term]}`,
          ids: schedule.sectionIds,
        });
      }
    }
  });

  // Ascending cost with the joined-sorted-ids tie-break.
  for (let i = 1; i < result.schedules.length; i++) {
    const prev = result.schedules[i - 1];
    const curr = result.schedules[i];
    if (prev.breakdown.cost > curr.breakdown.cost + TOLERANCE) {
      violations.push({ rule: "ordering", message: `schedule ${i - 1} costs more than schedule ${i}`, ids: [] });
    } else if (closeEnough(prev.breakdown.cost, curr.breakdown.cost)) {
      const prevKey = [...prev.sectionIds].sort().join("|");
      const currKey = [...curr.sectionIds].sort().join("|");
      if (prevKey > currKey) {
        violations.push({ rule: "ordering", message: `schedule ${i - 1} loses the tie-break to schedule ${i}`, ids: [] });
      }
    }
  }

  // Diversity recomputation.
  const recomputedDiversity = recomputeDiversity(result.schedules, req.requestedCourseCodes.length);
  if (!closeEnough(result.diversity, recomputedDiversity)) {
    violations.push({ rule: "diversity", message: `diversity ${result.diversity} recomputed as ${recomputedDiversity}`, ids: [] });
  }

  // Status plausibility.
  if (result.status === "infeasible" && !result.infeasibleSubset) {
    violations.push({ rule: "status-infeasible-subset", message: "status infeasible without infeasibleSubset", ids: [] });
  }
  if (result.status === "timeout" && result.initMs + result.searchMs > req.timeBudgetMs + 50) {
    violations.push({ rule: "status-timeout-budget", message: `timeout reported at ${result.initMs + result.searchMs}ms over budget ${req.timeBudgetMs}ms (+50 tolerance)`, ids: [] });
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Independent scoring-term recomputation (from the types.ts doc comments)
// ---------------------------------------------------------------------------

function recomputeBreakdown(req: OptimizeRequest, chosen: OptimizerSection[]): ScoreBreakdown {
  const earlyAnchor = req.earlyStartAnchorMinutes ?? 540;
  const lateAnchor = req.lateEndAnchorMinutes ?? 960;

  const perDay = new Map<WeekDay, { start: number; end: number; buildingId: string; sectionId: string }[]>();
  for (const section of chosen) {
    for (const meeting of section.meetings) {
      const list = perDay.get(meeting.day) ?? [];
      list.push({ start: meeting.start, end: meeting.end, buildingId: meeting.buildingId, sectionId: section.id });
      perDay.set(meeting.day, list);
    }
  }

  let gapMinutes = 0;
  let walkingSeconds = 0;
  let unknownWalkingPairs = 0;
  for (const day of weekDays) {
    const list = (perDay.get(day) ?? []).sort((a, b) => a.start - b.start);
    for (let i = 1; i < list.length; i++) {
      gapMinutes += Math.max(0, list[i].start - list[i - 1].end);
      if (list[i - 1].buildingId === list[i].buildingId) continue;
      const walking = req.walkingTime(list[i - 1].buildingId, list[i].buildingId);
      if (walking.seconds === null) unknownWalkingPairs += 1;
      else walkingSeconds += walking.seconds;
    }
  }

  let earlyStartMinutes = 0;
  let lateEndMinutes = 0;
  for (const section of chosen) {
    for (const meeting of section.meetings) {
      earlyStartMinutes += Math.max(0, earlyAnchor - meeting.start);
      lateEndMinutes += Math.max(0, meeting.end - lateAnchor);
    }
  }

  const daysOnCampus = perDay.size;
  let ratingSum = 0;
  let gpaSum = 0;
  for (const section of chosen) {
    if (section.instructorRating !== undefined) ratingSum += section.instructorRating;
    if (section.historicalGpa !== undefined) gpaSum += section.historicalGpa;
  }

  const w = req.softWeights;
  const cost =
    w.perGapMinute * gapMinutes +
    w.perWalkingSecond * walkingSeconds +
    w.perEarlyStartMinute * earlyStartMinutes +
    w.perLateEndMinute * lateEndMinutes +
    w.perDayOnCampus * daysOnCampus -
    w.perRatingPoint * ratingSum -
    w.perGpaPoint * gpaSum +
    w.perUnknownWalking * unknownWalkingPairs;

  return { gapMinutes, walkingSeconds, earlyStartMinutes, lateEndMinutes, daysOnCampus, ratingSum, gpaSum, unknownWalkingPairs, cost };
}

function recomputeDiversity(schedules: OptimizedSchedule[], nCourses: number): number {
  if (schedules.length <= 1 || nCourses <= 0) return 0;
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < schedules.length; i++) {
    for (let j = i + 1; j < schedules.length; j++) {
      let differing = 0;
      for (const course of Object.keys(schedules[i].byCourse)) {
        if (schedules[i].byCourse[course] !== schedules[j].byCourse[course]) differing += 1;
      }
      total += differing / nCourses;
      pairs += 1;
    }
  }
  return pairs === 0 ? 0 : total / pairs;
}

// ---------------------------------------------------------------------------
// IIS verification
// ---------------------------------------------------------------------------

export interface IisVerification {
  subsetInfeasible: boolean;
  allSingleRemovalsFeasible: boolean;
  detail: string[];
}

/**
 * Verify an IIS for `req` with the checker's own independent enumeration:
 * the sub-instance over ONLY the subset's members must be infeasible, and
 * removing any single member must make it feasible.
 */
export function verifyIis(req: OptimizeRequest, subset: IisSubset): IisVerification {
  const detail: string[] = [];
  const sub = pruneToMembers(req, subset.members);
  const subsetInfeasible = !independentSubFeasible(sub);
  detail.push(`subset of ${subset.members.length} members is ${subsetInfeasible ? "infeasible" : "feasible"}`);

  let allSingleRemovalsFeasible = true;
  for (let i = 0; i < subset.members.length; i++) {
    const withoutMember = subset.members.filter((_, j) => j !== i);
    const subWithout = pruneToMembers(req, withoutMember);
    const feasible = independentSubFeasible(subWithout);
    detail.push(`without ${subset.members[i].kind}:${subset.members[i].id} -> ${feasible ? "feasible" : "infeasible"}`);
    if (!feasible) allSingleRemovalsFeasible = false;
  }
  return { subsetInfeasible, allSingleRemovalsFeasible, detail };
}

/**
 * Top-level entry used by the harness and tests: full result check plus IIS
 * verification for infeasible results.
 */
export function runChecker(req: OptimizeRequest, result: OptimizeResultLike): Violation[] {
  const violations = checkResult(req, result);
  if (result.status === "infeasible" && result.infeasibleSubset) {
    const verdict = verifyIis(req, result.infeasibleSubset);
    if (!verdict.subsetInfeasible || !verdict.allSingleRemovalsFeasible) {
      violations.push({ rule: "iis-invalid", message: `IIS failed verification: ${verdict.detail.join("; ")}`, ids: result.infeasibleSubset.members.map((m) => m.id) });
    }
  }
  return violations;
}

/** Convenience: check a schedule built from section ids. */
export function checkSchedule(req: OptimizeRequest, sectionIds: string[]): Violation[] {
  const chosen: OptimizerSection[] = [];
  const missing: string[] = [];
  for (const id of sectionIds) {
    const section = req.sections.find((s) => s.id === id);
    if (section) chosen.push(section);
    else missing.push(id);
  }
  const violations = checkChosen(req, chosen);
  if (missing.length > 0) {
    violations.push({ rule: "pool-origin", message: "schedule references unknown sections", ids: missing });
  }
  return violations;
}
