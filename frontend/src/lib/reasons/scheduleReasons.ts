/**
 * Why this schedule, in sentences a student can check.
 *
 * Every number a reason quotes comes from the optimizer's own cost terms
 * (`costTerms` in optimizer/score.ts) or from data the caller supplies.
 * Comparisons and trade-offs are relative to the next alternative the
 * optimizer actually returned, never a hypothetical, and options are named
 * the way the UI names them (Option A, Option B). Trade-offs are stated as
 * plainly as wins. Unknown travel time is never stated as a fact: when this
 * schedule's own walks are unknown, the comparison is dropped and the
 * assumption is labeled; when only the other schedule has unknowns and this
 * one is lower, the difference is stated as "at least".
 *
 * The optimizer's travel term counts every back-to-back transfer it routed,
 * including shuttle rides, so sentences say "travel time", not "walking".
 * Days on campus counts distinct days, not days in a week (part-of-term
 * sessions make "a week" false), so no reason claims one. Grade history
 * describes the past on an A through F denominator and never predicts a
 * grade. This module imports from the optimizer's own modules; it changes
 * nothing in the optimizer.
 */

import {
  costTerms,
  COST_PER_DAY,
  COST_PER_GAP_MINUTE,
  COST_PER_LEAN_MINUTE,
  COST_PER_RATING_TENTH,
  COST_PER_WALK_SECOND,
  EVENING_ANCHOR,
  MORNING_ANCHOR,
  neutralRatingTenths,
  ratingTenths,
  UNKNOWN_WALK_SECONDS,
  type CostTerms,
} from "@/lib/optimizer/score";
import { formatClock } from "@/lib/optimizer/explain";
import type { OptSection, OptWeights, OptimizeRequest, ScheduleBreakdown } from "@/lib/optimizer/types";
import type { GradeTotals } from "@/lib/grades-history/types";
import type { Reason, ReasonEvidence, ScheduleReasonsInput, StatedPreference } from "./types";

/** Most reasons returned by default. */
export const DEFAULT_MAX_REASONS = 3;

/**
 * Grade-history reasons need at least this many graded students (A through F)
 * behind the instructor's totals. 10 is a starting value with no evidence
 * behind it: it was never measured against real grade distributions.
 */
export const MIN_GRADE_SAMPLE = 10;

/**
 * A section with at most this share of its seats open counts as filling up.
 * A judgment call, not a measurement.
 */
const TIGHT_SEAT_SHARE = 0.25;

/** How the UI names options: letters by rank. */
function optionLetter(rank: number): string {
  if (rank < 0 || rank >= 26) throw new Error(`reasons: cannot name alternative ${rank}`);
  return String.fromCharCode(65 + rank);
}

function minutes(n: number): string {
  return `${n} ${n === 1 ? "minute" : "minutes"}`;
}

function days(n: number): string {
  return `${n} ${n === 1 ? "day" : "days"}`;
}

/** Travel times rounded to minutes, as the UI shows them. */
function travelMinutes(seconds: number): string {
  const rounded = Math.max(1, Math.round(seconds / 60));
  return minutes(rounded);
}

function points(tenths: number): string {
  return String(Math.round(tenths) / 10);
}

function pointWord(tenths: number): string {
  return Math.round(tenths) === 10 ? "point" : "points";
}

function pairs(n: number): string {
  return `${n} back-to-back ${n === 1 ? "pair" : "pairs"}`;
}

type FactContext = {
  terms: CostTerms;
  breakdown: ScheduleBreakdown;
  chosen: readonly OptSection[];
  request: OptimizeRequest;
};

type Dim = {
  key: StatedPreference;
  /** The optimizer's exchange rate: cost seconds per unit of the stat, at weight 1. */
  costPerUnit: number;
  /** This schedule's number on this dimension. Lower is always better: every stat is a cost term. */
  stat: (terms: CostTerms) => number;
  /**
   * When a comparison against the next option must not be stated at all.
   * Walking: never when this schedule's own travel is unknown, and only as a
   * lower bound when the other schedule alone has unknowns.
   */
  mayCompare?: (mine: CostTerms, next: CostTerms) => boolean;
  comparison: (mine: CostTerms, next: CostTerms, myLetter: string, theirLetter: string) => { sentence: string; kind: "comparison" | "trade-off"; evidence: ReasonEvidence };
  /** This schedule alone. Null when there is nothing to say. */
  fact: (ctx: FactContext) => { sentence: string; evidence: ReasonEvidence } | null;
};

function diffEvidence(dimLabel: string, myLetter: string, theirLetter: string, mine: number, theirs: number, extra: ReasonEvidence["numbers"] = []): ReasonEvidence {
  return {
    numbers: [
      { label: `Option ${myLetter}: ${dimLabel}`, value: mine },
      { label: `Option ${theirLetter}: ${dimLabel}`, value: theirs },
      { label: "difference (this option minus the next)", value: mine - theirs },
      { label: "difference magnitude", value: Math.abs(mine - theirs) },
      ...extra,
    ],
  };
}

const DIMS: Dim[] = [
  {
    key: "fewerDays",
    costPerUnit: COST_PER_DAY,
    stat: (terms) => terms.daysOnCampus,
    comparison: (mine, next, myLetter, theirLetter) => {
      const diff = mine.daysOnCampus - next.daysOnCampus;
      const worse = diff > 0;
      return {
        sentence: worse
          ? `It costs ${days(diff)} more on campus than Option ${theirLetter}.`
          : `It means ${days(-diff)} fewer on campus than Option ${theirLetter}.`,
        kind: worse ? "trade-off" : "comparison",
        evidence: diffEvidence("days on campus", myLetter, theirLetter, mine.daysOnCampus, next.daysOnCampus),
      };
    },
    fact: ({ breakdown }) => ({
      sentence: `It keeps you on campus ${days(breakdown.daysOnCampus)}.`,
      evidence: { numbers: [{ label: "days on campus", value: breakdown.daysOnCampus }] },
    }),
  },
  {
    key: "compact",
    costPerUnit: COST_PER_GAP_MINUTE,
    stat: (terms) => terms.gapMinutes,
    comparison: (mine, next, myLetter, theirLetter) => {
      const diff = mine.gapMinutes - next.gapMinutes;
      const worse = diff > 0;
      return {
        sentence: worse
          ? `Time between classes runs ${minutes(diff)} longer than Option ${theirLetter}'s.`
          : `Time between classes runs ${minutes(-diff)} shorter than Option ${theirLetter}'s.`,
        kind: worse ? "trade-off" : "comparison",
        evidence: diffEvidence("time between classes (minutes)", myLetter, theirLetter, mine.gapMinutes, next.gapMinutes),
      };
    },
    fact: ({ breakdown }) =>
      breakdown.gapMinutes === 0
        ? { sentence: "There is no time between classes.", evidence: { numbers: [{ label: "time between classes (minutes)", value: 0 }] } }
        : {
            sentence: `Time between classes adds up to ${minutes(breakdown.gapMinutes)}.`,
            evidence: { numbers: [{ label: "time between classes (minutes)", value: breakdown.gapMinutes }] },
          },
  },
  {
    key: "mornings",
    costPerUnit: COST_PER_LEAN_MINUTE,
    stat: (terms) => terms.morningLeanMinutes,
    comparison: (mine, next, myLetter, theirLetter) => {
      const diff = mine.morningLeanMinutes - next.morningLeanMinutes;
      const worse = diff > 0;
      return {
        sentence: worse
          ? `Its classes start a combined ${minutes(diff)} later (counted after ${formatClock(MORNING_ANCHOR)}) than Option ${theirLetter}'s.`
          : `Its classes start a combined ${minutes(-diff)} earlier (counted after ${formatClock(MORNING_ANCHOR)}) than Option ${theirLetter}'s.`,
        kind: worse ? "trade-off" : "comparison",
        evidence: diffEvidence(`morning lean (minutes after ${formatClock(MORNING_ANCHOR)})`, myLetter, theirLetter, mine.morningLeanMinutes, next.morningLeanMinutes, [
          { label: "lean counts minutes after", value: formatClock(MORNING_ANCHOR) },
        ]),
      };
    },
    fact: ({ breakdown }) =>
      breakdown.earliestStart === null
        ? null
        : {
            sentence: `Your earliest class starts at ${formatClock(breakdown.earliestStart)}.`,
            evidence: {
              numbers: [
                { label: "earliest start", value: formatClock(breakdown.earliestStart) },
                { label: "earliest start (minutes after midnight)", value: breakdown.earliestStart },
              ],
            },
          },
  },
  {
    key: "evenings",
    costPerUnit: COST_PER_LEAN_MINUTE,
    stat: (terms) => terms.eveningLeanMinutes,
    comparison: (mine, next, myLetter, theirLetter) => {
      const diff = mine.eveningLeanMinutes - next.eveningLeanMinutes;
      // A smaller evenings lean means the classes end later in the day.
      const worse = diff < 0;
      return {
        sentence: worse
          ? `Its classes end a combined ${minutes(-diff)} earlier (counted before ${formatClock(EVENING_ANCHOR)}) than Option ${theirLetter}'s.`
          : `Its classes end a combined ${minutes(diff)} later (counted before ${formatClock(EVENING_ANCHOR)}) than Option ${theirLetter}'s.`,
        kind: worse ? "trade-off" : "comparison",
        evidence: diffEvidence(`evenings lean (minutes before ${formatClock(EVENING_ANCHOR)})`, myLetter, theirLetter, mine.eveningLeanMinutes, next.eveningLeanMinutes, [
          { label: "lean counts minutes before", value: formatClock(EVENING_ANCHOR) },
        ]),
      };
    },
    fact: ({ breakdown }) =>
      breakdown.latestEnd === null
        ? null
        : {
            sentence: `Your latest class ends at ${formatClock(breakdown.latestEnd)}.`,
            evidence: {
              numbers: [
                { label: "latest end", value: formatClock(breakdown.latestEnd) },
                { label: "latest end (minutes after midnight)", value: breakdown.latestEnd },
              ],
            },
          },
  },
  {
    key: "walking",
    costPerUnit: COST_PER_WALK_SECOND,
    stat: (terms) => terms.travelSeconds,
    mayCompare: (mine, next) =>
      // An unknown walk is assumed 600 seconds, so a comparison that crosses
      // one would state the assumption as a fact. State it only as a lower
      // bound, and only when the unknowns are all on the other side.
      mine.unknownWalks === 0 && (next.unknownWalks === 0 || mine.travelSeconds < next.travelSeconds),
    comparison: (mine, next, myLetter, theirLetter) => {
      const diff = mine.travelSeconds - next.travelSeconds;
      const worse = diff > 0;
      const atLeast = next.unknownWalks > 0;
      const label = "travel seconds (each unknown walk counted as 600)";
      return {
        sentence: worse
          ? `It means ${travelMinutes(diff)} more travel time between classes than Option ${theirLetter}.`
          : `It means ${atLeast ? "at least " : ""}${travelMinutes(-diff)} less travel time between classes than Option ${theirLetter}.`,
        kind: worse ? "trade-off" : "comparison",
        evidence: diffEvidence(label, myLetter, theirLetter, mine.travelSeconds, next.travelSeconds, [
          { label: "difference (minutes)", value: Math.round(Math.abs(diff) / 60) },
          ...(atLeast ? [{ label: "at least: each of the other option's unknown walks could take longer than 600 seconds", value: next.unknownWalks } as const] : []),
        ]),
      };
    },
    fact: ({ terms }) =>
      terms.travelSeconds === 0
        ? { sentence: "There is no travel time between back-to-back classes.", evidence: { numbers: [{ label: "travel seconds", value: 0 }] } }
        : {
            sentence: `Travel time between back-to-back classes adds up to ${travelMinutes(terms.travelSeconds)}.`,
            evidence: {
              numbers: [
                { label: "travel seconds (each unknown walk counted as 600)", value: terms.travelSeconds },
                { label: "travel minutes", value: Math.max(1, Math.round(terms.travelSeconds / 60)) },
              ],
            },
          },
  },
  {
    key: "rating",
    costPerUnit: COST_PER_RATING_TENTH,
    stat: (terms) => terms.ratingShortfallTenths,
    comparison: (mine, next, myLetter, theirLetter) => {
      const diff = mine.ratingShortfallTenths - next.ratingShortfallTenths;
      // A smaller shortfall means the instructors average higher.
      const worse = diff > 0;
      const label = "rating shortfall (tenths; the course mean fills in for unrated sections)";
      return {
        sentence: worse
          ? `Its instructors average ${points(diff)} ${pointWord(diff)} lower than Option ${theirLetter}'s.`
          : `Its instructors average ${points(-diff)} ${pointWord(-diff)} higher than Option ${theirLetter}'s.`,
        kind: worse ? "trade-off" : "comparison",
        evidence: diffEvidence(label, myLetter, theirLetter, mine.ratingShortfallTenths, next.ratingShortfallTenths, [
          { label: "difference (points)", value: Math.abs(Math.round(diff)) / 10 },
        ]),
      };
    },
    fact: ({ terms, breakdown, chosen }) => {
      const rated = chosen.filter((section) => ratingTenths(section.rating) !== null).length;
      if (rated === 0) {
        return {
          sentence: "No section of this schedule has a rating.",
          evidence: {
            numbers: [
              { label: "rated sections", value: 0 },
              { label: "rating shortfall (tenths; the course mean fills in for unrated sections)", value: terms.ratingShortfallTenths },
            ],
          },
        };
      }
      return {
        sentence: `Instructors average ${breakdown.averageRating} of 5 across the ${rated} rated ${rated === 1 ? "section" : "sections"}.`,
        evidence: {
          numbers: [
            { label: "average instructor rating (rated sections only)", value: breakdown.averageRating! },
            { label: "rated sections", value: rated },
            { label: "rating scale maximum", value: 5 },
          ],
        },
      };
    },
  },
];

/** Travel time the optimizer could only assume, stated as an assumption. */
function travelUnknownReason(terms: CostTerms, weight: number): { reason: Reason; weight: number } {
  const n = terms.unknownWalks;
  return {
    reason: {
      sentence: `Travel time is unknown for ${pairs(n)} across buildings, and the estimate counts ${travelMinutes(UNKNOWN_WALK_SECONDS)} for ${n === 1 ? "it" : "each"}.`,
      kind: "travel-unknown",
      preference: weight > 0 ? "walking" : null,
      evidence: {
        numbers: [
          { label: "unknown walks", value: n },
          { label: "assumed seconds per unknown walk", value: UNKNOWN_WALK_SECONDS },
          { label: "assumed minutes per unknown walk", value: UNKNOWN_WALK_SECONDS / 60 },
        ],
      },
    },
    weight,
  };
}

/** Seat counts come from the caller; unknowns never become numbers. */
function seatReasons(input: ScheduleReasonsInput, chosen: readonly OptSection[]): Array<{ reason: Reason; weight: number }> {
  const out: Array<{ reason: Reason; weight: number }> = [];
  if (!input.seats) return out;
  for (const section of chosen) {
    const seats = input.seats[section.id];
    if (!seats || seats.open === null) continue;
    const isClosed = seats.open === 0;
    const isTight = isClosed || (seats.total !== null && seats.total > 0 && seats.open / seats.total <= TIGHT_SEAT_SHARE);
    if (!isTight) continue;
    const label = section.label ?? section.id;
    out.push({
      reason: {
        sentence: isClosed
          ? `Section ${label} of ${section.courseCode} has no open seats left.`
          : `Section ${label} of ${section.courseCode} has ${seats.open} of ${seats.total} seats open.`,
        kind: "seats",
        preference: null,
        evidence: {
          numbers: [
            { label: "open seats", value: seats.open },
            ...(seats.total !== null ? [{ label: "total seats", value: seats.total }] : []),
          ],
        },
      },
      weight: 0,
    });
  }
  return out;
}

/**
 * Descriptive grade history from untgrades.app for the chosen instructor,
 * on an A through F denominator. It never predicts a grade and never claims
 * that a section causes one.
 */
function gradeReasons(input: ScheduleReasonsInput, chosen: readonly OptSection[]): Array<{ reason: Reason; weight: number }> {
  const out: Array<{ reason: Reason; weight: number }> = [];
  if (!input.instructorGradeHistory) return out;
  for (const section of chosen) {
    const totals: GradeTotals | undefined = input.instructorGradeHistory[section.id];
    if (!totals) continue;
    const g = totals.grades;
    const aThroughF = g.gradeA + g.gradeB + g.gradeC + g.gradeD + g.gradeF;
    if (aThroughF < MIN_GRADE_SAMPLE) continue;
    const aOrB = g.gradeA + g.gradeB;
    const share = Math.round((aOrB / aThroughF) * 100);
    out.push({
      reason: {
        sentence: `Across past sections taught by this section's instructor, ${share}% of ${aThroughF} graded students earned an A or B in ${section.courseCode}.`,
        kind: "grade-history",
        preference: null,
        evidence: {
          numbers: [
            { label: "graded students (A through F)", value: aThroughF },
            { label: "share of A or B grades (%)", value: share },
            { label: "A grades", value: g.gradeA },
            { label: "B grades", value: g.gradeB },
          ],
        },
      },
      weight: 0,
    });
  }
  return out;
}

/**
 * Why this schedule, ranked by how much each difference is worth to the
 * optimizer: the weight times the cost per unit times the difference, one
 * reason per preference. Facts that compare nothing come after, in a fixed
 * order. Returns at most `maxReasons` (default 3), strongest first. Every
 * reason carries evidence; none is emitted without it.
 */
export function scheduleReasons(input: ScheduleReasonsInput): Reason[] {
  const { alternatives, request } = input;
  if (!Number.isInteger(input.index) || input.index < 0 || input.index >= alternatives.length) {
    throw new Error("reasons: index must point at one of the alternatives");
  }
  if (input.maxReasons !== undefined && (!Number.isFinite(input.maxReasons) || input.maxReasons < 0)) {
    throw new Error("reasons: maxReasons must be a non-negative number");
  }
  const neutralRatingByCourse: Record<string, number> = {};
  const creditsByCourse: Record<string, number> = {};
  for (const course of request.courses) {
    neutralRatingByCourse[course.code] = neutralRatingTenths(course.sections);
    creditsByCourse[course.code] = course.credits;
  }
  const chosenIn = (rank: number): OptSection[] => {
    const schedule = alternatives[rank];
    return request.courses.map((course) => {
      const sectionId = schedule.byCourse[course.code];
      const section = course.sections.find((candidate) => candidate.id === sectionId);
      if (!section) throw new Error(`reasons: alternatives[${rank}] does not choose a section of ${course.code}`);
      return section;
    });
  };
  const termsIn = (rank: number): CostTerms =>
    costTerms({
      sections: chosenIn(rank),
      term: request.term,
      creditsByCourse,
      neutralRatingByCourse,
      weights: request.weights,
      walkingTime: request.walkingTime,
    });
  const allTerms = alternatives.map((_, rank) => termsIn(rank));
  const mine = allTerms[input.index];
  const next = input.index + 1 < alternatives.length ? allTerms[input.index + 1] : null;
  const myLetter = optionLetter(input.index);
  const theirLetter = next !== null ? optionLetter(input.index + 1) : null;
  const weights: OptWeights = request.weights;

  const tagged: Array<{ reason: Reason; priority: number; weight: number }> = [];
  const push = (reason: Reason, priority: number, weight: number) => tagged.push({ reason, priority, weight });

  for (const dim of DIMS) {
    const weight = weights[dim.key];
    if (weight <= 0) continue;
    const mineStat = dim.stat(mine);
    const comparable = next !== null && (dim.mayCompare ? dim.mayCompare(mine, next) : true);
    if (comparable && dim.stat(next) !== mineStat) {
      const built = dim.comparison(mine, next, myLetter, theirLetter!);
      push({ ...built, preference: dim.key }, weight * dim.costPerUnit * Math.abs(mineStat - dim.stat(next)), weight);
    } else {
      const built = dim.fact({ terms: mine, breakdown: alternatives[input.index].breakdown, chosen: chosenIn(input.index), request });
      if (built) {
        const best = allTerms.every((terms) => dim.stat(terms) >= mineStat);
        push({ sentence: built.sentence, kind: best ? "preference-met" : "fact", preference: dim.key, evidence: built.evidence }, 0, weight);
      }
    }
  }

  if (mine.unknownWalks > 0) {
    const built = travelUnknownReason(mine, weights.walking);
    push(built.reason, 0, built.weight);
  }
  for (const entry of [...seatReasons(input, chosenIn(input.index)), ...gradeReasons(input, chosenIn(input.index))]) {
    push(entry.reason, 0, entry.weight);
  }

  return tagged
    .map((entry, order) => ({ ...entry, order }))
    .sort((a, b) => b.priority - a.priority || b.weight - a.weight || a.order - b.order)
    .slice(0, input.maxReasons ?? DEFAULT_MAX_REASONS)
    .map((entry) => entry.reason);
}
