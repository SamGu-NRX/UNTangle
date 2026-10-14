/**
 * Why this schedule, in sentences a student can check.
 *
 * Preference reasons compare the optimizer's own cost terms (`costTerms` in
 * optimizer/score.ts) with the next alternative the optimizer returned,
 * named as the caller names it (`optionName`, "option 2"). Every term is a cost, so
 * lower is better for every preference: `compare` decides which way a
 * difference points, and the phrase table only words it.
 *
 * A term with missing data is a range, not a number. An unknown walk could
 * take any time, so travel is its known seconds or more, and a claim is made
 * only when the two ranges do not overlap, stated as "at least". A section
 * with no rating leaves the rating unknown, so no rating comparison is made
 * on either side of it. The same holds for a class whose average start is
 * before 7 AM or end after 10 PM: the optimizer counts its lean as 0, so a
 * difference quoted from that term could not be checked by hand. The
 * optimizer's stand-ins for missing data (10 minutes per unknown walk, the
 * course mean for a missing rating) are never quoted.
 *
 * The travel term counts every transfer the planner routed, shuttle rides
 * included, so sentences say "travel", not "walking". Grade history
 * describes past grades and never predicts one.
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
  NEUTRAL_INSTRUCTOR_GPA,
  neutralRatingTenths,
  ratingTenths,
  type CostTerms,
} from "@/lib/optimizer/score";
import { formatClock } from "@/lib/optimizer/explain";
import { OPT_DAYS, type OptDay, type OptSection, type ScheduleBreakdown } from "@/lib/optimizer/types";
import type { GradeData } from "@/lib/grades";
import type { CourseHistory } from "@/lib/grades-history/types";
import { hasOpenSeats } from "@/lib/planner-sections";
import type { Section } from "@/lib/sections/model";
import type { Reason, ReasonEvidence, ScheduleReasonsInput, StatedPreference } from "./types";

const DEFAULT_MAX_REASONS = 3;

/**
 * Grade history needs at least this many of the instructor's past sections
 * of the course with A through F grades. A starting value with no evidence
 * behind it.
 */
const MIN_GRADED_SECTIONS = 3;

const DAY_NAMES: Record<OptDay, string> = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };

function count(n: number, one: string): string {
  return `${n} ${n === 1 ? one : `${one}s`}`;
}

const minutes = (n: number) => count(n, "minute");

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function joinList(items: string[]): string {
  return items.length <= 2 ? items.join(" and ") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** `sessions` lists the date ranges the option's meetings run on, as one comparable key. */
type Option = { terms: CostTerms; sections: OptSection[]; breakdown: ScheduleBreakdown; sessions: string };

/** Where a cost term's true value lies. Equal ends mean it is known exactly. */
type Range = { lo: number; hi: number };
const exactly = (value: number): Range => ({ lo: value, hi: value });

type Fact = { sentence: string; evidence: ReasonEvidence };

type Preference = {
  /** The optimizer's cost per unit of the term, at weight 1. */
  costPerUnit: number;
  /** Evidence label for the term. */
  label: string;
  range: (option: Option) => Range;
  /** A difference in the term's units, as the number the sentence quotes. 0 means too small to state. */
  shown: (difference: number, exact: boolean, courses: number) => number;
  /** When two options can be compared on this term at all. Default: always. */
  comparable?: (mine: Option, theirs: Option) => boolean;
  /** The direction word when this option is better, then when it is worse. */
  words: [better: string, worse: string];
  /** `atLeast` is "at least " when the number is a bound, else empty. */
  say: (shown: number, atLeast: string, word: string, other: string) => string;
  /** This option alone; null when there is nothing to say. */
  fact: (option: Option, options: readonly Option[]) => Fact | null;
};

function travelFact({ knownTravelSeconds: known, unknownWalks: unknown }: CostTerms): Fact {
  const shown = Math.max(1, Math.round(known / 60));
  const evidence = {
    numbers: [
      { label: "known travel seconds", value: known },
      { label: "known travel minutes", value: shown },
      { label: "walks with no known time", value: unknown },
    ],
  };
  const walks = count(unknown, "walk");
  if (unknown === 0 && known === 0) return { sentence: "There is no travel between back-to-back classes.", evidence };
  if (unknown === 0) return { sentence: `Travel between back-to-back classes adds up to ${minutes(shown)}.`, evidence };
  if (known === 0) return { sentence: `${walks} between back-to-back classes ${unknown === 1 ? "has" : "have"} no known time.`, evidence };
  return { sentence: `Travel between back-to-back classes adds up to ${minutes(shown)}, not counting ${walks} with no known time.`, evidence };
}

const identity = (difference: number) => difference;
const UNKNOWN: Range = { lo: -Infinity, hi: Infinity };
/** The lean terms sum over courses; the sentence quotes the average per class. */
const perClass = (minutes: number, _exact: boolean, courses: number) => Math.round(minutes / courses);

const PREFERENCES: Record<StatedPreference, Preference> = {
  fewerDays: {
    costPerUnit: COST_PER_DAY,
    label: "weekdays with a class",
    range: ({ terms }) => exactly(terms.daysOnCampus),
    // Weekdays count across the whole term. Across different sessions (a
    // Monday in the first half and a Wednesday in the second, against a
    // Monday all term) a weekday difference is not a difference in days on
    // campus each week, so the options are compared only on the same dates.
    comparable: (mine, theirs) => mine.sessions === theirs.sessions,
    shown: identity,
    words: ["fewer", "more"],
    say: (n, atLeast, word, other) => `Your classes fall on ${atLeast}${n} ${word} ${n === 1 ? "weekday" : "weekdays"} than in ${other}.`,
    fact: ({ terms, sections }) => {
      const days = OPT_DAYS.filter((day) => sections.some((section) => section.meetings.some((m) => m.day === day)));
      if (days.length === 0) return null;
      const names = joinList(days.map((day) => DAY_NAMES[day]));
      return {
        sentence: `Your classes fall on ${names}.`,
        evidence: { numbers: [{ label: "weekdays with a class", value: terms.daysOnCampus }, { label: "weekdays", value: names }] },
      };
    },
  },
  compact: {
    costPerUnit: COST_PER_GAP_MINUTE,
    label: "minutes between classes",
    range: ({ terms }) => exactly(terms.gapMinutes),
    shown: identity,
    words: ["shorter", "longer"],
    say: (n, atLeast, word, other) => `Time between classes is ${atLeast}${minutes(n)} ${word} than in ${other}.`,
    fact: ({ terms }) => ({
      sentence: terms.gapMinutes === 0 ? "There is no time between classes." : `Time between classes adds up to ${minutes(terms.gapMinutes)}.`,
      evidence: { numbers: [{ label: "minutes between classes", value: terms.gapMinutes }] },
    }),
  },
  mornings: {
    costPerUnit: COST_PER_LEAN_MINUTE,
    label: `minutes after ${formatClock(MORNING_ANCHOR)} of each course's average start, summed`,
    range: ({ terms }) => (terms.clampedMornings > 0 ? UNKNOWN : exactly(terms.morningLeanMinutes)),
    shown: perClass,
    words: ["earlier", "later"],
    say: (n, atLeast, word, other) => `On average its classes start ${atLeast}${minutes(n)} ${word} than ${other}'s.`,
    fact: ({ breakdown }) =>
      breakdown.earliestStart === null
        ? null
        : {
            sentence: `Your earliest class starts at ${formatClock(breakdown.earliestStart)}.`,
            evidence: { numbers: [{ label: "earliest start", value: formatClock(breakdown.earliestStart) }] },
          },
  },
  evenings: {
    costPerUnit: COST_PER_LEAN_MINUTE,
    label: `minutes before ${formatClock(EVENING_ANCHOR)} of each course's average end, summed`,
    range: ({ terms }) => (terms.clampedEvenings > 0 ? UNKNOWN : exactly(terms.eveningLeanMinutes)),
    shown: perClass,
    words: ["later", "earlier"],
    say: (n, atLeast, word, other) => `On average its classes end ${atLeast}${minutes(n)} ${word} than ${other}'s.`,
    fact: ({ breakdown }) =>
      breakdown.latestEnd === null
        ? null
        : {
            sentence: `Your latest class ends at ${formatClock(breakdown.latestEnd)}.`,
            evidence: { numbers: [{ label: "latest end", value: formatClock(breakdown.latestEnd) }] },
          },
  },
  walking: {
    costPerUnit: COST_PER_WALK_SECOND,
    label: "known travel seconds",
    range: ({ terms }) => ({ lo: terms.knownTravelSeconds, hi: terms.unknownWalks > 0 ? Infinity : terms.knownTravelSeconds }),
    // A bound rounds down, so "at least" stays true.
    shown: (seconds, exact) => (exact ? Math.round(seconds / 60) : Math.floor(seconds / 60)),
    words: ["less", "more"],
    say: (n, atLeast, word, other) => `Travel between back-to-back classes takes ${atLeast}${minutes(n)} ${word} than in ${other}.`,
    fact: ({ terms }) => travelFact(terms),
  },
  rating: {
    costPerUnit: COST_PER_RATING_TENTH,
    label: "rating shortfall from 5 in tenths, summed over courses",
    range: ({ terms, sections }) =>
      sections.some((section) => ratingTenths(section.rating) === null) ? UNKNOWN : exactly(terms.ratingShortfallTenths),
    // The term sums over courses; the sentence quotes the average per course.
    shown: (tenths, _exact, courses) => Math.round(tenths / courses) / 10,
    words: ["higher", "lower"],
    say: (n, atLeast, word, other) => `Its instructors' ratings average ${atLeast}${count(n, "point")} ${word} than ${other}'s.`,
    fact: ({ sections, breakdown }, options) => {
      // Only sample sections carry ratings; when no option has one, saying so tells the student nothing.
      if (options.every((option) => option.breakdown.averageRating === null)) return null;
      const rated = sections.filter((section) => ratingTenths(section.rating) !== null).length;
      if (breakdown.averageRating === null) {
        return { sentence: "No section of this schedule has a rating.", evidence: { numbers: [{ label: "rated sections", value: 0 }] } };
      }
      return {
        sentence: `Its instructors average a rating of ${breakdown.averageRating} across ${count(rated, "rated section")}.`,
        evidence: {
          numbers: [
            { label: "average rating of rated sections", value: breakdown.averageRating },
            { label: "rated sections", value: rated },
          ],
        },
      };
    },
  },
};

/** Which way this option differs from another on one term, when the ranges allow a claim. Lower is better. */
function compare(mine: Range, theirs: Range): { better: boolean; amount: number; exact: boolean } | null {
  const exact = mine.lo === mine.hi && theirs.lo === theirs.hi;
  if (mine.hi < theirs.lo) return { better: true, amount: theirs.lo - mine.hi, exact };
  if (mine.lo > theirs.hi) return { better: false, amount: mine.lo - theirs.hi, exact };
  return null;
}

const SEAT_STATUS: Partial<Record<Section["status"], string>> = { closed: "is closed", waitlist: "is wait-listed", cancelled: "is cancelled" };

/** A section the planner does not count as open (`hasOpenSeats`). The student can act on it, so it is never ranked away. */
function seatWarning(section: OptSection, catalog: Pick<Section, "status" | "components">): Reason | null {
  if (hasOpenSeats(catalog)) return null;
  const label = section.label ?? section.id;
  const full = catalog.components.find((component) => component.seats.open === 0);
  const sentence = `Section ${label} of ${section.courseCode} ${SEAT_STATUS[catalog.status] ?? "has no open seats"}.`;
  const numbers = [
    { label: "section", value: label },
    { label: "status", value: catalog.status },
    ...(full ? [{ label: "open seats", value: 0 }, ...(full.seats.total !== null ? [{ label: "total seats", value: full.seats.total }] : [])] : []),
  ];
  return { sentence, kind: "seats", preference: null, evidence: { numbers } };
}

const aThroughF = (g: GradeData) => g.gradeA + g.gradeB + g.gradeC + g.gradeD + g.gradeF;

const hasKnownGpa = (section: OptSection): section is OptSection & { instructorGpa: number } =>
  section.instructorGpa !== undefined && section.instructorGpa !== null;

/**
 * An option's instructor evidence, the value the engine's tie-break ranks
 * by: the mean over its sections of each section's known instructorGpa,
 * with NEUTRAL_INSTRUCTOR_GPA standing in for the missing ones (imported
 * from the engine so the two modules cannot drift). `knownMean` is what a
 * sentence may quote, the mean over the sections with a known gpa only, or
 * null when there is none: the optimizer's stand-ins are never quoted.
 */
function instructorEvidenceOf(sections: OptSection[]): { filled: number; knownMean: number | null; knownCount: number } {
  if (sections.length === 0) return { filled: NEUTRAL_INSTRUCTOR_GPA, knownMean: null, knownCount: 0 };
  let sum = 0;
  let knownSum = 0;
  let knownCount = 0;
  for (const section of sections) {
    sum += section.instructorGpa ?? NEUTRAL_INSTRUCTOR_GPA;
    if (hasKnownGpa(section)) {
      knownSum += section.instructorGpa;
      knownCount += 1;
    }
  }
  return { filled: sum / sections.length, knownMean: knownCount > 0 ? knownSum / knownCount : null, knownCount };
}

function gradeReason(section: OptSection, history: CourseHistory): Reason | null {
  const code = `${history.course.subject} ${history.course.number}`;
  if (code !== section.courseCode) throw new Error(`reasons: grade history for ${code} was given for section ${section.id} of ${section.courseCode}`);
  const graded = history.terms.flatMap((term) => term.sections).filter((past) => aThroughF(past.grades) > 0).length;
  if (graded < MIN_GRADED_SECTIONS) return null;
  const students = aThroughF(history.grades);
  const share = Math.round(((history.grades.gradeA + history.grades.gradeB) / students) * 100);
  return {
    sentence: `Section ${section.label ?? section.id}'s instructor gave an A or B to ${share}% of graded students in ${count(graded, "past section")} of ${code}.`,
    kind: "grade-history",
    preference: null,
    evidence: {
      numbers: [
        { label: "section", value: section.label ?? section.id },
        { label: "past sections with A through F grades", value: graded },
        { label: "share of A or B grades (%)", value: share },
        { label: "students graded A through F", value: students },
        { label: "A grades", value: history.grades.gradeA },
        { label: "B grades", value: history.grades.gradeB },
      ],
    },
  };
}

/**
 * Why `alternatives[index]` is a good choice. Seat warnings come first and
 * always appear. Then up to `maxReasons` (default 3) of: comparisons with
 * the next option, ranked by what the difference is worth to the optimizer
 * (weight times cost per unit times the difference); facts about this
 * option, by preference weight; and grade history.
 *
 * `request` must be the exact `OptimizeRequest` the alternatives came from,
 * `walkingTime` included: the reasons recompute the optimizer's cost terms
 * from it. Store it beside the results; a rebuilt request can differ.
 */
export function scheduleReasons(input: ScheduleReasonsInput): Reason[] {
  const { alternatives, request } = input;
  if (!Number.isInteger(input.index) || input.index < 0 || input.index >= alternatives.length) {
    throw new Error("reasons: index must point at one of the alternatives");
  }
  const maxReasons = input.maxReasons ?? DEFAULT_MAX_REASONS;
  if (!Number.isInteger(maxReasons) || maxReasons < 0) throw new Error("reasons: maxReasons must be a non-negative integer");

  const neutralRatingByCourse = Object.fromEntries(request.courses.map((course) => [course.code, neutralRatingTenths(course.sections)]));
  const creditsByCourse = Object.fromEntries(request.courses.map((course) => [course.code, course.credits]));
  const options: Option[] = alternatives.map((schedule, rank) => {
    const sections = request.courses.map((course) => {
      const section = course.sections.find((candidate) => candidate.id === schedule.byCourse[course.code]);
      if (!section) throw new Error(`reasons: alternatives[${rank}] does not choose a section of ${course.code}`);
      return section;
    });
    const terms = costTerms({ sections, term: request.term, creditsByCourse, neutralRatingByCourse, weights: request.weights, walkingTime: request.walkingTime });
    const ranges = sections.flatMap((section) => section.meetings.map((m) => m.dates ?? request.term).map((r) => (r ? `${r.start}..${r.end}` : "term")));
    return { terms, sections, breakdown: schedule.breakdown, sessions: [...new Set(ranges)].sort().join(" ") };
  });
  const mine = options[input.index];
  const next: Option | undefined = options[input.index + 1];
  const weights = request.weights;

  const comparisons: Array<{ reason: Reason; worth: number }> = [];
  const facts: Reason[] = [];
  // SAFETY: PREFERENCES is a Record<StatedPreference, ...> literal, so its keys are exactly StatedPreference.
  const stated = (Object.keys(PREFERENCES) as StatedPreference[]).filter((key) => weights[key] > 0).sort((a, b) => weights[b] - weights[a]);
  for (const key of stated) {
    const preference = PREFERENCES[key];
    const range = preference.range(mine);
    const theirs = next && (preference.comparable?.(mine, next) ?? true) ? preference.range(next) : null;
    const difference = theirs ? compare(range, theirs) : null;
    const shown = difference ? preference.shown(difference.amount, difference.exact, mine.sections.length) : 0;
    if (theirs && difference && shown > 0) {
      // The caller names options the way its UI does ("option 2"); the engine never invents names.
      const [me, other] = [input.optionName(input.index), input.optionName(input.index + 1)];
      const bound = (r: Range) => (r.lo === r.hi ? "" : ", a lower bound");
      comparisons.push({
        worth: weights[key] * preference.costPerUnit * difference.amount,
        reason: {
          sentence: preference.say(shown, difference.exact ? "" : "at least ", preference.words[difference.better ? 0 : 1], other),
          kind: difference.better ? "comparison" : "trade-off",
          preference: key,
          evidence: {
            numbers: [
              { label: `${capitalize(me)}: ${preference.label}${bound(range)}`, value: range.lo },
              { label: `${capitalize(other)}: ${preference.label}${bound(theirs)}`, value: theirs.lo },
              { label: "difference as quoted", value: shown },
            ],
          },
        },
      });
      continue;
    }
    const fact = preference.fact(mine, options);
    if (!fact) continue;
    // Met only when no option could do better, so an unknown never counts as best.
    const best = options.every((option) => (preference.comparable?.(mine, option) ?? true) && range.hi <= preference.range(option).lo);
    facts.push({ ...fact, kind: best ? "preference-met" : "fact", preference: key });
  }
  // The engine's Auto tie-break: at equal cost, higher instructor evidence
  // (the mean-with-neutral value the optimizer ranks by) wins. Worth 0, so
  // stated-preference comparisons come first, and the maxReasons slice
  // below applies as usual. The sentence quotes only real evidence: the
  // mean over the sections with a known gpa, never the neutral stand-ins.
  if (next && alternatives[input.index].cost === alternatives[input.index + 1].cost) {
    const mineEvidence = instructorEvidenceOf(mine.sections);
    const nextEvidence = instructorEvidenceOf(next.sections);
    if (mineEvidence.filled > nextEvidence.filled && mineEvidence.knownMean !== null) {
      const subject = mineEvidence.knownCount === 1 ? "this instructor's sections" : "these instructors' sections";
      const quoted = (Math.round(mineEvidence.knownMean * 10) / 10).toFixed(1);
      comparisons.push({
        worth: 0,
        reason: {
          sentence: `Students in ${subject} averaged a ${quoted}.`,
          kind: "grade-history",
          preference: null,
          evidence: {
            numbers: [
              { label: "average grade points of sections with grade history", value: Number(quoted) },
              { label: "sections with grade history", value: mineEvidence.knownCount },
              ...mine.sections.filter(hasKnownGpa).map((section) => ({
                label: `grade points of section ${section.label ?? section.id}`,
                value: section.instructorGpa,
              })),
            ],
          },
        },
      });
    }
  }
  comparisons.sort((a, b) => b.worth - a.worth);

  const warnings: Reason[] = [];
  const grades: Reason[] = [];
  for (const section of mine.sections) {
    const catalog = input.seats?.[section.id];
    const warning = catalog ? seatWarning(section, catalog) : null;
    if (warning) warnings.push(warning);
    const history = input.instructorGradeHistory?.[section.id];
    const grade = history ? gradeReason(section, history) : null;
    if (grade) grades.push(grade);
  }
  return [...warnings, ...[...comparisons.map((entry) => entry.reason), ...facts, ...grades].slice(0, maxReasons)];
}
