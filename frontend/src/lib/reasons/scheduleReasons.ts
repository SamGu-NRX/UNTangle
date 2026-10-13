/**
 * Why this schedule, in sentences a student can check.
 *
 * Every reason carries evidence: the exact optimizer numbers (or grade
 * history, or seat counts) it rests on. Comparisons are relative to the
 * optimizer's actual alternatives, never a hypothetical. Trade-offs are
 * stated as plainly as wins. Grade history describes the past and never
 * predicts a grade.
 *
 * This module imports from the optimizer's own modules (types, score,
 * explain) so its numbers are the optimizer's numbers. It changes nothing
 * in the optimizer or in grades-history.
 */

import { UNKNOWN_WALK_SECONDS } from "@/lib/optimizer/score";
import { formatClock } from "@/lib/optimizer/explain";
import { MAX_WEIGHT, type OptWeights, type RankedSchedule, type ScheduleBreakdown } from "@/lib/optimizer/types";
import type { CourseHistory } from "@/lib/grades-history/types";
import type { Reason, ReasonEvidence, ScheduleReasonsInput, StatedPreference } from "./types";

/** Most reasons returned by default. */
export const DEFAULT_MAX_REASONS = 3;

/**
 * Grade-history reasons need at least this many past sections of a course.
 * 10 is a starting value with no evidence behind it: it was never measured
 * against real grade distributions.
 */
export const MIN_GRADE_HISTORY_SECTIONS = 10;

/**
 * A section with at most this share of its seats open counts as filling up.
 * A judgment call, not a measurement.
 */
const TIGHT_SEAT_SHARE = 0.25;

type Dim = {
  key: StatedPreference;
  /** True when a lower number is better for the student. */
  lowerIsBetter: boolean;
  stat: (breakdown: ScheduleBreakdown) => number | null;
  statLabel: string;
};

const DIMS: Dim[] = [
  { key: "fewerDays", lowerIsBetter: true, stat: (b) => b.daysOnCampus, statLabel: "days on campus" },
  { key: "compact", lowerIsBetter: true, stat: (b) => b.gapMinutes, statLabel: "idle minutes" },
  { key: "mornings", lowerIsBetter: true, stat: (b) => b.earliestStart, statLabel: "earliest start (minutes)" },
  { key: "evenings", lowerIsBetter: false, stat: (b) => b.latestEnd, statLabel: "latest end (minutes)" },
  {
    key: "walking",
    lowerIsBetter: true,
    // The optimizer's own walking term: known seconds, each unknown walk as 600 s.
    stat: (b) => b.walkSeconds + UNKNOWN_WALK_SECONDS * b.unknownWalks,
    statLabel: `walking seconds (each unknown walk counted as ${UNKNOWN_WALK_SECONDS})`,
  },
  {
    key: "rating",
    lowerIsBetter: false,
    stat: (b) => (b.averageRating === null ? null : Math.round(b.averageRating * 10)),
    statLabel: "average instructor rating (tenths)",
  },
];

function strengthForWeight(weight: number): number {
  return Math.min(1, 0.4 + (0.15 * weight) / MAX_WEIGHT);
}

function minutes(n: number): string {
  return `${n} ${n === 1 ? "minute" : "minutes"}`;
}

function days(n: number): string {
  return `${n} ${n === 1 ? "day" : "days"}`;
}

/** "16 minutes" or "960 seconds": never a rounded walk. */
function walkAmount(seconds: number): string {
  return seconds % 60 === 0 ? `${seconds / 60} ${seconds === 60 ? "minute" : "minutes"}` : `${seconds} seconds`;
}

function ratingPoints(tenths: number): string {
  return String(Math.round(tenths) / 10);
}

/** A relative phrase against the next option, for one dimension and a signed diff. */
function diffSentence(key: StatedPreference, magnitude: number, worse: boolean): string {
  switch (key) {
    case "fewerDays":
      return worse
        ? `It costs ${magnitude} more ${magnitude === 1 ? "day" : "days"} on campus each week than the next option.`
        : `It means ${magnitude} fewer ${magnitude === 1 ? "day" : "days"} on campus each week than the next option.`;
    case "compact":
      return worse
        ? `It means ${minutes(magnitude)} more of idle time between classes than the next option.`
        : `It means ${minutes(magnitude)} less of idle time between classes than the next option.`;
    case "mornings":
      return worse
        ? `It starts ${minutes(magnitude)} later than the next option.`
        : `It starts ${minutes(magnitude)} earlier than the next option.`;
    case "evenings":
      return worse
        ? `It ends ${minutes(magnitude)} earlier than the next option.`
        : `It ends ${minutes(magnitude)} later than the next option.`;
    case "walking":
      return worse
        ? `It means ${walkAmount(magnitude)} more of walking a week than the next option.`
        : `It means ${walkAmount(magnitude)} less of walking a week than the next option.`;
    case "rating":
      return worse
        ? `Its instructors average ${ratingPoints(magnitude)} points lower than the next option's.`
        : `Its instructors average ${ratingPoints(magnitude)} points higher than the next option's.`;
  }
}

function evidenceForDiff(mine: number, theirs: number, dim: Dim): ReasonEvidence {
  return {
    numbers: [
      { label: `this schedule: ${dim.statLabel}`, value: mine },
      { label: `next option: ${dim.statLabel}`, value: theirs },
      { label: "difference", value: mine - theirs },
    ],
    facts: ["optimizer breakdowns of both schedules, as returned by the search"],
  };
}

/** Comparisons (favorable) and trade-offs (unfavorable) against the next option the optimizer returned. */
function pushComparisons(out: Reason[], mine: ScheduleBreakdown, theirs: ScheduleBreakdown, weights: OptWeights): void {
  for (const dim of DIMS) {
    const weight = weights[dim.key];
    if (weight <= 0) continue;
    const a = dim.stat(mine);
    const b = dim.stat(theirs);
    if (a === null || b === null || a === b) continue;
    const worse = dim.lowerIsBetter ? a > b : a < b;
    out.push({
      sentence: diffSentence(dim.key, Math.abs(a - b), worse),
      kind: worse ? "trade-off" : "comparison",
      preference: dim.key,
      strength: strengthForWeight(weight),
      evidence: evidenceForDiff(a, b, dim),
    });
  }
}

/** Facts about this schedule alone, tied to the stated preferences. */
function pushPreferenceMet(out: Reason[], breakdown: ScheduleBreakdown, weights: OptWeights): void {
  if (weights.fewerDays > 0) {
    out.push({
      sentence: `It keeps you on campus ${days(breakdown.daysOnCampus)} a week.`,
      kind: "preference-met",
      preference: "fewerDays",
      strength: strengthForWeight(weights.fewerDays),
      evidence: {
        numbers: [
          { label: "days on campus", value: breakdown.daysOnCampus },
          { label: "fewerDays weight", value: weights.fewerDays },
        ],
        facts: ["optimizer breakdown.daysOnCampus"],
      },
    });
  }
  if (weights.compact > 0) {
    out.push({
      sentence:
        breakdown.gapMinutes === 0
          ? "There is no idle time between classes."
          : `Idle time between classes adds up to ${minutes(breakdown.gapMinutes)} a week.`,
      kind: "preference-met",
      preference: "compact",
      strength: strengthForWeight(weights.compact),
      evidence: {
        numbers: [
          { label: "idle minutes", value: breakdown.gapMinutes },
          { label: "compact weight", value: weights.compact },
        ],
        facts: ["optimizer breakdown.gapMinutes"],
      },
    });
  }
  if (weights.mornings > 0 && breakdown.earliestStart !== null) {
    out.push({
      sentence: `Your earliest class starts at ${formatClock(breakdown.earliestStart)}.`,
      kind: "preference-met",
      preference: "mornings",
      strength: strengthForWeight(weights.mornings),
      evidence: {
        numbers: [
          { label: "earliest start (minutes)", value: breakdown.earliestStart },
          { label: "mornings weight", value: weights.mornings },
        ],
        facts: ["optimizer breakdown.earliestStart"],
      },
    });
  }
  if (weights.evenings > 0 && breakdown.latestEnd !== null) {
    out.push({
      sentence: `Your latest class ends at ${formatClock(breakdown.latestEnd)}.`,
      kind: "preference-met",
      preference: "evenings",
      strength: strengthForWeight(weights.evenings),
      evidence: {
        numbers: [
          { label: "latest end (minutes)", value: breakdown.latestEnd },
          { label: "evenings weight", value: weights.evenings },
        ],
        facts: ["optimizer breakdown.latestEnd"],
      },
    });
  }
  if (weights.rating > 0 && breakdown.averageRating !== null) {
    out.push({
      sentence: `Your sections' instructors average ${breakdown.averageRating.toFixed(1)} of 5.`,
      kind: "preference-met",
      preference: "rating",
      strength: strengthForWeight(weights.rating),
      evidence: {
        numbers: [
          { label: "average instructor rating", value: breakdown.averageRating },
          { label: "rating weight", value: weights.rating },
        ],
        facts: ["optimizer breakdown.averageRating"],
      },
    });
  }
}

/** Walking facts, with unknown walks kept unknown instead of quietly assumed away. */
function pushWalking(out: Reason[], breakdown: ScheduleBreakdown, weights: OptWeights): void {
  if (breakdown.walkSeconds === 0 && breakdown.unknownWalks === 0) return;
  const hasUnknown = breakdown.unknownWalks > 0;
  const knownPart =
    breakdown.walkSeconds > 0 ? `Walking between back-to-back classes adds up to ${walkAmount(breakdown.walkSeconds)} a week` : null;
  const unknownPart = hasUnknown
    ? `walk time is unknown for ${breakdown.unknownWalks} back-to-back ${breakdown.unknownWalks === 1 ? "pair" : "pairs"}, and the estimate assumes ${walkAmount(UNKNOWN_WALK_SECONDS)} for ${breakdown.unknownWalks === 1 ? "it" : "each"}`
    : null;
  const sentence = [knownPart, unknownPart].filter((part): part is string => part !== null).join("; ") + ".";
  const numbers: ReasonEvidence["numbers"] = [
    { label: "known walking seconds", value: breakdown.walkSeconds },
    { label: "unknown walks", value: breakdown.unknownWalks },
  ];
  if (hasUnknown) numbers.push({ label: "assumed seconds per unknown walk", value: UNKNOWN_WALK_SECONDS });
  out.push({
    sentence,
    kind: "walking",
    preference: weights.walking > 0 ? "walking" : null,
    strength: weights.walking > 0 ? strengthForWeight(weights.walking) : 0.35,
    evidence: {
      numbers,
      facts: [
        "optimizer breakdown.walkSeconds (known walks, whole seconds)",
        "optimizer breakdown.unknownWalks",
        "assumption UNKNOWN_WALK_SECONDS = 600 seconds from optimizer/score.ts, not a measurement",
      ],
    },
  });
}

/** Seat counts come from the caller; unknowns never become numbers. */
function pushSeats(
  out: Reason[],
  input: ScheduleReasonsInput,
  schedule: RankedSchedule,
): void {
  if (!input.seats) return;
  for (const course of input.request.courses) {
    const sectionId = schedule.byCourse[course.code];
    if (sectionId === undefined) continue;
    const section = course.sections.find((candidate) => candidate.id === sectionId);
    const seats = input.seats[sectionId];
    if (!section || !seats || seats.open === null) continue;
    const isClosed = seats.open === 0;
    const isTight = isClosed || (seats.total !== null && seats.open / seats.total <= TIGHT_SEAT_SHARE);
    if (!isTight) continue;
    const label = section.label ?? section.id;
    out.push({
      sentence: isClosed
        ? `Section ${label} of ${course.code} has no open seats left.`
        : `Section ${label} of ${course.code} has ${seats.open} of ${seats.total} seats open.`,
      kind: "seats",
      preference: null,
      strength: isClosed ? 0.9 : 0.45,
      evidence: {
        numbers: [
          { label: "open seats", value: seats.open },
          ...(seats.total !== null ? [{ label: "total seats", value: seats.total }] : []),
        ],
        facts: ["seat counts supplied by the caller for this section"],
      },
    });
  }
}

/**
 * Descriptive grade history from untgrades.app, only for courses with enough
 * past sections. It never predicts a grade and never claims that a section
 * causes one.
 */
function pushGradeHistory(
  out: Reason[],
  input: ScheduleReasonsInput,
  schedule: RankedSchedule,
): void {
  if (!input.gradeHistory) return;
  for (const course of input.request.courses) {
    const sectionId = schedule.byCourse[course.code];
    if (sectionId === undefined) continue;
    const history: CourseHistory | undefined = input.gradeHistory[course.code];
    if (!history || history.sectionCount < MIN_GRADE_HISTORY_SECTIONS) continue;
    const total = history.total;
    const aOrB = history.grades.gradeA + history.grades.gradeB;
    if (total <= 0) continue;
    const share = Math.round((aOrB / total) * 100);
    const gpa = history.gpa !== null ? ` (GPA ${history.gpa.toFixed(2)})` : "";
    out.push({
      sentence: `Across ${history.sectionCount} past sections of ${course.code}, ${share}% of recorded grades were an A or B${gpa}.`,
      kind: "grade-history",
      preference: null,
      strength: 0.2,
      evidence: {
        numbers: [
          { label: "past sections", value: history.sectionCount },
          { label: "share of A or B grades (%)", value: share },
          { label: "recorded grades", value: total },
          ...(history.gpa !== null ? [{ label: "GPA", value: history.gpa }] : []),
        ],
        facts: [
          "grade history from untgrades.app via lib/grades-history",
          "descriptive only: past grades of other students say nothing about any future grade",
        ],
      },
    });
  }
}

/**
 * Why this schedule, ranked by the student's stated preferences.
 *
 * Returns at most `maxReasons` (default 3), strongest first. Comparisons and
 * trade-offs are relative to the next option the optimizer actually returned;
 * with no next option there are none. Every reason carries evidence; none is
 * emitted without it.
 */
export function scheduleReasons(input: ScheduleReasonsInput): Reason[] {
  const rank = input.alternatives.findIndex((alternative) => alternative === input.schedule);
  if (rank < 0) throw new Error("reasons: schedule must be one of the alternatives");
  if (input.maxReasons !== undefined && input.maxReasons < 0) {
    throw new Error("reasons: maxReasons must not be negative");
  }
  const next = input.alternatives[rank + 1] ?? null;
  const reasons: Reason[] = [];
  if (next) pushComparisons(reasons, input.schedule.breakdown, next.breakdown, input.request.weights);
  pushPreferenceMet(reasons, input.schedule.breakdown, input.request.weights);
  pushWalking(reasons, input.schedule.breakdown, input.request.weights);
  pushSeats(reasons, input, input.schedule);
  pushGradeHistory(reasons, input, input.schedule);
  return reasons
    .map((reason, index) => ({ reason, index }))
    .sort((a, b) => b.reason.strength - a.reason.strength || a.index - b.index)
    .slice(0, input.maxReasons ?? DEFAULT_MAX_REASONS)
    .map((entry) => entry.reason);
}
