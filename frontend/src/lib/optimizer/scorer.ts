/**
 * Normative implementation of the pinned term definitions and cost formula
 * (see types.ts). Brute force and variants import these; the independent
 * checker must NOT — it re-derives every term from the doc comments.
 */
import { weekDays, type WeekDay } from "@/lib/types";
import {
  DEFAULT_EARLY_START_ANCHOR_MINUTES,
  DEFAULT_LATE_END_ANCHOR_MINUTES,
  type OptimizeRequest,
  type OptimizedSchedule,
  type OptimizerSection,
  type ScoreBreakdown,
} from "./types";

/** A chosen meeting flattened for scoring. */
interface ChosenMeeting {
  start: number;
  end: number;
  buildingId: string;
}

/**
 * Compute the full breakdown for a schedule (the chosen sections). Raw
 * terms are in their stated units; `cost` is the weighted cost to minimize.
 * Deterministic and side-effect free.
 */
export function computeBreakdown(req: OptimizeRequest, chosen: OptimizerSection[]): ScoreBreakdown {
  const earlyAnchor = req.earlyStartAnchorMinutes ?? DEFAULT_EARLY_START_ANCHOR_MINUTES;
  const lateAnchor = req.lateEndAnchorMinutes ?? DEFAULT_LATE_END_ANCHOR_MINUTES;

  // Group chosen meetings per day; gaps and walks are consecutive-pair terms.
  const byDay = new Map<WeekDay, ChosenMeeting[]>();
  for (const section of chosen) {
    for (const meeting of section.meetings) {
      const list = byDay.get(meeting.day);
      if (list) list.push({ start: meeting.start, end: meeting.end, buildingId: meeting.buildingId });
      else byDay.set(meeting.day, [{ start: meeting.start, end: meeting.end, buildingId: meeting.buildingId }]);
    }
  }

  let gapMinutes = 0;
  let walkingSeconds = 0;
  let unknownWalkingPairs = 0;
  for (const day of weekDays) {
    const meetings = (byDay.get(day) ?? []).sort((a, b) => a.start - b.start);
    for (let i = 1; i < meetings.length; i++) {
      const prev = meetings[i - 1];
      const next = meetings[i];
      gapMinutes += Math.max(0, next.start - prev.end);
      if (prev.buildingId === next.buildingId) continue; // same building: free, skipped
      const walking = req.walkingTime(prev.buildingId, next.buildingId);
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

  const daysOnCampus = byDay.size;

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

  return {
    gapMinutes,
    walkingSeconds,
    earlyStartMinutes,
    lateEndMinutes,
    daysOnCampus,
    ratingSum,
    gpaSum,
    unknownWalkingPairs,
    cost,
  };
}

/** Per-course candidate lists in requested-course order (after exclusions). */
export function pruneCandidates(req: OptimizeRequest): { courseCode: string; sections: OptimizerSection[] }[] {
  const excluded = new Set(req.excludedSectionIds);
  const byCode = new Map<string, OptimizerSection[]>();
  for (const section of req.sections) {
    if (!req.requestedCourseCodes.includes(section.courseCode)) continue;
    if (excluded.has(section.id)) continue;
    const list = byCode.get(section.courseCode);
    if (list) list.push(section);
    else byCode.set(section.courseCode, [section]);
  }
  return req.requestedCourseCodes.map((courseCode) => ({
    courseCode,
    sections: (byCode.get(courseCode) ?? []).slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  }));
}

/**
 * The one locked/excluded overlap case that must fail fast: a section id
 * both locked and excluded cannot be satisfied. Returns the first such id,
 * or null when the request has none.
 */
export function findLockedConflict(req: OptimizeRequest): string | null {
  const excluded = new Set(req.excludedSectionIds);
  const poolById = new Map(req.sections.map((section) => [section.id, section] as const));
  for (const id of req.lockedSectionIds) {
    if (!excluded.has(id)) continue;
    // Only a pool section of a REQUESTED course can conflict: a locked (or
    // excluded) id of a non-requested course is inert per the pinned
    // semantics, and IIS sub-instances rely on that when courses are pruned.
    const section = poolById.get(id);
    if (section && req.requestedCourseCodes.includes(section.courseCode)) return id;
  }
  return null;
}

/** Canonical schedule key: joined sorted section ids (the tie-break key). */
export function scheduleKey(sectionIds: string[]): string {
  return [...sectionIds].sort().join("|");
}

/**
 * Contract ordering: ascending cost, ties broken by lexicographic ascending
 * joined sorted section ids. Comparator for `sort`.
 */
export function compareSchedules(a: OptimizedSchedule, b: OptimizedSchedule): number {
  const costDiff = a.breakdown.cost - b.breakdown.cost;
  if (costDiff !== 0) return costDiff < 0 ? -1 : 1;
  const aKey = scheduleKey(a.sectionIds);
  const bKey = scheduleKey(b.sectionIds);
  return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
}

/**
 * Pinned diversity: for m returned schedules over n requested courses, 0
 * when m <= 1, else the average over all unordered schedule pairs of
 * (course slots whose chosen section differs / n), in [0, 1].
 */
export function computeDiversity(schedules: OptimizedSchedule[], nCourses: number): number {
  if (schedules.length <= 1 || nCourses <= 0) return 0;
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < schedules.length; i++) {
    for (let j = i + 1; j < schedules.length; j++) {
      const a = schedules[i].byCourse;
      const b = schedules[j].byCourse;
      let differing = 0;
      for (const courseCode of Object.keys(a)) {
        if (a[courseCode] !== b[courseCode]) differing += 1;
      }
      total += differing / nCourses;
      pairs += 1;
    }
  }
  return pairs === 0 ? 0 : total / pairs;
}
