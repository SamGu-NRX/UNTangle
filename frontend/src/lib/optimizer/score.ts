/**
 * How a schedule is scored, in one place.
 *
 * Every term is an integer in human units (days, minutes, seconds, tenths of
 * a rating point), and the cost is an integer weighted sum, so ties are exact
 * and the ranking is the same on every machine.
 */

import {
  OptimizerInputError,
  OPT_DAYS,
  type OptDateRange,
  type OptDay,
  type OptMeeting,
  type OptSection,
  type OptWalkingTimeFn,
  type OptWeights,
  type ScheduleBreakdown,
} from "./types";
import { someBackToBack, weekSegments } from "./weeks";

/**
 * Exchange rates between the terms, in "seconds of the student's time" per
 * unit, at weight 1. There is no measurement behind them: they encode a
 * judgment, flagged here so nobody mistakes them for calibration.
 * - a day on campus costs as much as an hour (the commute and the trip);
 * - an idle minute between classes costs a minute;
 * - a walking second costs a second;
 * - each course meeting an hour later costs 20 minutes under the mornings
 *   lean (and an hour earlier under evenings);
 * - one rating point lower on one course costs 30 minutes.
 */
export const COST_PER_DAY = 3600;
export const COST_PER_GAP_MINUTE = 60;
export const COST_PER_WALK_SECOND = 1;
export const COST_PER_LEAN_MINUTE = 20;
export const COST_PER_RATING_TENTH = 180;

/**
 * An unknown walk is assumed to take 10 minutes, for both the cost and the
 * walking check. No estimate exists for it; 10 minutes is the break between
 * consecutive classes in the bundled sample sections (classes end at :50 and
 * the next starts on the hour), so an unknown walk is assumed to just fit a
 * standard break. It is never 0.
 */
export const UNKNOWN_WALK_SECONDS = 600;

/** Mornings lean counts minutes after 7:00 AM; evenings lean counts minutes before 10:00 PM. */
export const MORNING_ANCHOR = 7 * 60;
export const EVENING_ANCHOR = 22 * 60;

/** Rating used for a section with none: the course's mean, else 3.0. */
export const DEFAULT_RATING_TENTHS = 30;

export function ratingTenths(rating: number | null): number | null {
  if (rating === null || !Number.isFinite(rating)) return null;
  return Math.max(0, Math.min(50, Math.round(rating * 10)));
}

/** Mean rating of a course's sections, in tenths, used for sections without one. */
export function neutralRatingTenths(sections: ReadonlyArray<Pick<OptSection, "rating">>): number {
  const present = sections.map((section) => ratingTenths(section.rating)).filter((value): value is number => value !== null);
  if (present.length === 0) return DEFAULT_RATING_TENTHS;
  return Math.round(present.reduce((sum, value) => sum + value, 0) / present.length);
}

/**
 * The part of the cost a section carries by itself, independent of the rest
 * of the schedule: the time-of-day leans and the instructor rating.
 */
export function selfCost(section: OptSection, weights: OptWeights, neutralTenths: number): number {
  // Leans use the section's mean start and end, so a course counts once
  // however many days it meets. Summing every meeting instead (as the old
  // goals did) made a twice-a-week class look earlier than a three-times-a-
  // week class an hour before it.
  const count = section.meetings.length;
  const meanStart = Math.round(section.meetings.reduce((sum, m) => sum + m.start, 0) / count);
  const meanEnd = Math.round(section.meetings.reduce((sum, m) => sum + m.end, 0) / count);
  const lean =
    weights.mornings * Math.max(0, meanStart - MORNING_ANCHOR) + weights.evenings * Math.max(0, EVENING_ANCHOR - meanEnd);
  const tenths = ratingTenths(section.rating) ?? neutralTenths;
  return lean * COST_PER_LEAN_MINUTE + weights.rating * (50 - tenths) * COST_PER_RATING_TENTH;
}

export function sameBuilding(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a === b;
}

/** Walking seconds between two classes, or null when unknown. Same building is 0. */
/**
 * Walking seconds between two classes, or null when unknown. Same building
 * is 0. Providers may return fractional seconds (the campus network does);
 * this is the one place they are normalized, to whole seconds by rounding,
 * so the walking check, the cost and the breakdown always agree.
 */
export function walkSeconds(walkingTime: OptWalkingTimeFn, from: string | null, to: string | null): number | null {
  if (sameBuilding(from, to)) return 0;
  if (from === null || to === null) return null;
  const leg = walkingTime(from, to);
  if (leg.source === "unknown" || leg.seconds === null) return null;
  if (!Number.isFinite(leg.seconds) || leg.seconds < 0) {
    throw new OptimizerInputError(`walking time ${from} -> ${to} is ${leg.seconds}, not a non-negative number of seconds`);
  }
  return Math.round(leg.seconds);
}

/**
 * The walking check for one pair of back-to-back classes: the break between
 * them, in seconds, must cover the walk plus the buffer. An unknown walk
 * counts as UNKNOWN_WALK_SECONDS.
 */
export function transferFits(
  prev: Pick<OptMeeting, "end">,
  next: Pick<OptMeeting, "start">,
  walk: number | null,
  bufferMinutes: number,
): boolean {
  const needed = (walk ?? UNKNOWN_WALK_SECONDS) + bufferMinutes * 60;
  return (next.start - prev.end) * 60 >= needed;
}

type ChosenMeeting = OptMeeting & { sectionId: string; weeks: number };

function meetingsByDay(sections: readonly OptSection[], term?: OptDateRange): Map<OptDay, ChosenMeeting[]> {
  // The schedule's own dates cut the calendar finely enough: extra cuts from
  // other sections would not change which of its pairs are back to back.
  const segments = weekSegments(sections.flatMap((section) => section.meetings), term);
  const byDay = new Map<OptDay, ChosenMeeting[]>();
  for (const section of sections) {
    for (const meeting of section.meetings) {
      const list = byDay.get(meeting.day) ?? [];
      list.push({ ...meeting, sectionId: section.id, weeks: segments.maskOf(meeting) });
      byDay.set(meeting.day, list);
    }
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => a.start - b.start || a.end - b.end);
  }
  return byDay;
}

export type ScoreInput = {
  sections: readonly OptSection[];
  term?: OptDateRange;
  creditsByCourse: Readonly<Record<string, number>>;
  /** Credits of courses outside the schedule (OptimizeRequest.fixedCredits). */
  fixedCredits?: number;
  neutralRatingByCourse: Readonly<Record<string, number>>;
  weights: OptWeights;
  walkingTime: OptWalkingTimeFn;
};

/** Breakdown and cost of a complete schedule. */
export function scoreSchedule(input: ScoreInput): { cost: number; breakdown: ScheduleBreakdown } {
  const { sections, weights, walkingTime } = input;
  const byDay = meetingsByDay(sections, input.term);
  let gapMinutes = 0;
  let knownWalk = 0;
  let unknownWalks = 0;
  for (const day of OPT_DAYS) {
    const list = byDay.get(day);
    if (!list) continue;
    someBackToBack(list, (prev, next) => {
      gapMinutes += Math.max(0, next.start - prev.end);
      if (sameBuilding(prev.buildingId, next.buildingId)) return false;
      const walk = walkSeconds(walkingTime, prev.buildingId, next.buildingId);
      if (walk === null) unknownWalks += 1;
      else knownWalk += walk;
      return false;
    });
  }
  const meetings = sections.flatMap((section) => section.meetings);
  const ratings = sections.map((section) => ratingTenths(section.rating)).filter((value): value is number => value !== null);
  const credits = sections.reduce((sum, section) => sum + (input.creditsByCourse[section.courseCode] ?? 0), input.fixedCredits ?? 0);
  const breakdown: ScheduleBreakdown = {
    daysOnCampus: byDay.size,
    gapMinutes,
    walkSeconds: knownWalk,
    unknownWalks,
    earliestStart: meetings.length > 0 ? Math.min(...meetings.map((m) => m.start)) : null,
    latestEnd: meetings.length > 0 ? Math.max(...meetings.map((m) => m.end)) : null,
    credits,
    averageRating: ratings.length > 0 ? Math.round(ratings.reduce((a, b) => a + b, 0) / ratings.length) / 10 : null,
  };
  let cost =
    weights.fewerDays * COST_PER_DAY * breakdown.daysOnCampus +
    weights.compact * COST_PER_GAP_MINUTE * gapMinutes +
    weights.walking * COST_PER_WALK_SECOND * (knownWalk + UNKNOWN_WALK_SECONDS * unknownWalks);
  for (const section of sections) {
    cost += selfCost(section, weights, input.neutralRatingByCourse[section.courseCode] ?? DEFAULT_RATING_TENTHS);
  }
  return { cost, breakdown };
}


/**
 * The optimizer's per-preference numbers for one schedule: exactly the terms
 * `scoreSchedule`'s cost is a weighted sum of. Purely additive - nothing in
 * scoring changes, and no existing export is touched. It exists so consumers
 * (the reasons module) can compare schedules in the optimizer's own numbers
 * instead of re-deriving them from the breakdown.
 */
export type CostTerms = {
  /** Distinct days with a class. */
  daysOnCampus: number;
  /** Idle minutes between back-to-back classes, each pair counted once. */
  gapMinutes: number;
  /** Known travel seconds between back-to-back classes, plus UNKNOWN_WALK_SECONDS for each leg with no estimate. */
  travelSeconds: number;
  /**
   * Back-to-back classes in different buildings with no travel estimate. Not
   * a cost term by itself: `travelSeconds` already counts
   * UNKNOWN_WALK_SECONDS for each one.
   */
  unknownWalks: number;
  /** Mornings lean: each section's mean start after MORNING_ANCHOR, summed over sections. */
  morningLeanMinutes: number;
  /** Evenings lean: each section's mean end before EVENING_ANCHOR, summed over sections. */
  eveningLeanMinutes: number;
  /** Rating shortfall: each section's 50 minus its tenths (the course mean fills in when unrated), summed over sections. */
  ratingShortfallTenths: number;
};

/** The per-preference numbers behind `scoreSchedule`'s cost, for the same input. */
export function costTerms(input: ScoreInput): CostTerms {
  const { sections, walkingTime } = input;
  const byDay = meetingsByDay(sections, input.term);
  let gapMinutes = 0;
  let knownTravel = 0;
  let unknownWalks = 0;
  for (const day of OPT_DAYS) {
    const list = byDay.get(day);
    if (!list) continue;
    someBackToBack(list, (prev, next) => {
      gapMinutes += Math.max(0, next.start - prev.end);
      if (sameBuilding(prev.buildingId, next.buildingId)) return false;
      const walk = walkSeconds(walkingTime, prev.buildingId, next.buildingId);
      if (walk === null) unknownWalks += 1;
      else knownTravel += walk;
      return false;
    });
  }
  let morningLeanMinutes = 0;
  let eveningLeanMinutes = 0;
  let ratingShortfallTenths = 0;
  for (const section of sections) {
    const count = section.meetings.length;
    const meanStart = Math.round(section.meetings.reduce((sum, m) => sum + m.start, 0) / count);
    const meanEnd = Math.round(section.meetings.reduce((sum, m) => sum + m.end, 0) / count);
    morningLeanMinutes += Math.max(0, meanStart - MORNING_ANCHOR);
    eveningLeanMinutes += Math.max(0, EVENING_ANCHOR - meanEnd);
    const tenths = ratingTenths(section.rating) ?? input.neutralRatingByCourse[section.courseCode] ?? DEFAULT_RATING_TENTHS;
    ratingShortfallTenths += 50 - tenths;
  }
  return {
    daysOnCampus: byDay.size,
    gapMinutes,
    travelSeconds: knownTravel + UNKNOWN_WALK_SECONDS * unknownWalks,
    unknownWalks,
    morningLeanMinutes,
    eveningLeanMinutes,
    ratingShortfallTenths,
  };
}
