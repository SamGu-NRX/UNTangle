/**
 * Plain-language schedule preferences: the typed contract.
 *
 * A student says things like "no classes before 10 on Fridays, and I want
 * it all compact" in one breath. This module defines the shape those words
 * parse into (`PreferenceIntent`) and the pure bridge onto the planner's
 * existing inputs (`toPlannerPreferences`). The rule-based parser lives in
 * `parse.ts`; this file is only the contract and the mapping.
 *
 * Two families, kept apart on purpose:
 *
 * - hard constraints are all-or-nothing. A schedule that breaks one is
 *   wrong, the same way the optimizer treats `OptConstraints`.
 * - soft preferences are leanings. Each carries a strength ("strong" or
 *   "mild") so the planner can trade them against each other.
 *
 * Time conventions match the optimizer: minutes after midnight, half-open
 * intervals `[start, end)`. A class ending at 10:00 and a commitment
 * starting at 10:00 do not conflict.
 */

import type {
  BlockedTime,
  PreferenceWeights,
  ScheduleConstraints,
  SchedulePreferences,
  WeekDay,
} from "../types";

/** Every day a preference can mention. The planner's own day settings stop at Fri; see `toPlannerPreferences`. */
export const PREF_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export type PrefDay = (typeof PREF_DAYS)[number];

/** How much a soft preference matters when the planner prices trade-offs. */
export type Strength = "strong" | "mild";

/** The weight each strength maps to, matching the preset scale in optimizer/presets.ts (main term 4, light term 2). */
export const STRENGTH_WEIGHT: Record<Strength, number> = { strong: 4, mild: 2 };

/**
 * Soft preferences the schema can express. `compact` and `spreadOut` are
 * opposites; the rest stand alone. Each mention in a sentence contributes
 * one entry, so a student who asks for compactness twice simply repeats
 * the same key and the last strength wins.
 */
export const SOFT_KEYS = ["compact", "spreadOut", "fewerDays", "minimalWalking", "easierGraders"] as const;
export type SoftKey = (typeof SOFT_KEYS)[number];

export type SoftPreference = { key: SoftKey; strength: Strength };

/** A weekly commitment the student must keep, such as a job, practice or a lab rotation. */
export type PrefBlockedTime = {
  day: PrefDay;
  /** Minutes after midnight, half-open `[start, end)`. */
  start: number;
  end: number;
  /** What the student called it, when they named it ("work", "practice"). Optional. */
  label?: string;
};

/**
 * Instructor preference: either a named instructor the student wants, or
 * "easier graders", meaning a higher historical average GPA. Neither has a
 * direct planner input yet; see the cannot-express list in
 * `toPlannerPreferences`.
 */
export type InstructorPreference =
  | { kind: "named"; name: string; strength: Strength }
  | { kind: "easierGraders"; strength: Strength };

/** Where classes may be: the Denton campus, or other UNT sites (Frisco and similar) too. Discovery Park counts as Denton. */
export type CampusScope = "dentonOnly" | "otherSitesOk";

/** How classes meet. The planner has no input for this yet; see `toPlannerPreferences`. */
export type ClassMode = "online" | "inPerson";

/**
 * Hard constraints. Every one is all-or-nothing. `null` means "not
 * mentioned", not "off": only the fields the student actually constrained
 * are set.
 */
export type HardConstraints = {
  /** No class may start before this minute. */
  earliestStart: number | null;
  /** No class may end after this minute. */
  latestEnd: number | null;
  /** No class on these days. */
  daysOff: PrefDay[];
  /** No class may overlap one of these weekly ranges. */
  blockedTimes: PrefBlockedTime[];
  /** Total credits must reach this. */
  creditMin: number | null;
  /** Total credits may not exceed this. */
  creditMax: number | null;
  /** Suggest only options with an open seat; closed and wait-listed ones stay unpicked. */
  openSeatsOnly: boolean | null;
  /** Denton only, or other UNT sites allowed too. */
  campusScope: CampusScope | null;
  /** Online only, or in person only. */
  mode: ClassMode | null;
  /** Courses the schedule must include, as catalog codes like "CSCE 3110". */
  wantedCourses: string[];
  /** Courses the schedule must not include. */
  avoidedCourses: string[];
};

/** What a preference sentence parses into. */
export type PreferenceIntent = {
  hard: HardConstraints;
  soft: SoftPreference[];
  /** At most one instructor preference; a later mention replaces an earlier one. */
  instructor: InstructorPreference | null;
};

/** An intent with nothing set, the way every parse begins. */
export function emptyIntent(): PreferenceIntent {
  return {
    hard: {
      earliestStart: null,
      latestEnd: null,
      daysOff: [],
      blockedTimes: [],
      creditMin: null,
      creditMax: null,
      openSeatsOnly: null,
      campusScope: null,
      mode: null,
      wantedCourses: [],
      avoidedCourses: [],
    },
    soft: [],
    instructor: null,
  };
}

const PREF_DAY_TO_WEEKDAY: Record<PrefDay, WeekDay | null> = {
  Mon: "Mon",
  Tue: "Tue",
  Wed: "Wed",
  Thu: "Thu",
  Fri: "Fri",
  Sat: null,
  Sun: null,
};

/**
 * Map an intent onto the planner's existing inputs: `ScheduleConstraints`
 * and `PreferenceWeights` from src/lib/types.ts, the shapes the schedule
 * builder already consumes (and which the optimizer mirrors in
 * `OptConstraints`/`OptWeights`, fed by the presets in optimizer/presets.ts).
 *
 * Pure: same intent in, same preferences out, nothing read or written.
 *
 * What the planner cannot express yet (checked field by field against
 * `ScheduleConstraints`, `PreferenceWeights` and the optimizer types):
 *
 * - `hard.creditMin`: the planner only has `maxCredits`; there is no
 *   minimum-credit constraint.
 * - Days off or blocked times on Sat or Sun: the planner's day settings
 *   are `WeekDay` (Mon-Fri), so a weekend day off has nowhere to land.
 *   They stay in the intent and are dropped here.
 * - `soft` `spreadOut`: weights are non-negative and only push
 *   compactness up; there is no term that spreads classes apart.
 * - `hard.wantedCourses`: nothing in the planner's inputs must-include a
 *   course. Optimizer locks are per section id and live outside
 *   `SchedulePreferences`.
 * - `hard.avoidedCourses`: `excludedSections` holds section ids, not
 *   course codes.
 * - Instructor "named": locks are section ids and there is no
 *   instructor-name input, so a named instructor cannot be honored.
 * - `easierGraders`: the closest knob is the `rating` weight, but that
 *   ranks student star ratings (0..5), not historical average GPA. Left
 *   unmapped rather than silently substituting a different number.
 * - `hard.mode` online/inPerson: no online-only or in-person-only input.
 *   The optimizer only notices online sections as untimed meetings,
 *   through `fixedCredits` set by the caller.
 *
 * Dropped-on-purpose is the rule: a value the schema can express but this
 * mapping cannot place is left in the intent, never rounded into a
 * different field.
 */
export function toPlannerPreferences(intent: PreferenceIntent): SchedulePreferences {
  const softWeight = (key: SoftKey): number => {
    const pref = intent.soft.find((s) => s.key === key);
    return pref ? STRENGTH_WEIGHT[pref.strength] : 0;
  };

  const blocked: BlockedTime[] = [];
  for (const b of intent.hard.blockedTimes) {
    const day = PREF_DAY_TO_WEEKDAY[b.day];
    if (!day) continue;
    blocked.push({
      id: `blocked-${blocked.length + 1}`,
      label: b.label ?? "kept free",
      day,
      start: b.start,
      end: b.end,
    });
  }

  const constraints: ScheduleConstraints = {
    earliestStart: intent.hard.earliestStart,
    latestEnd: intent.hard.latestEnd,
    daysOff: intent.hard.daysOff.flatMap((d) => {
      const day = PREF_DAY_TO_WEEKDAY[d];
      return day ? [day] : [];
    }),
    blocked,
    maxCredits: intent.hard.creditMax,
    walkingBufferMinutes: null,
    excludedSections: [],
    openSeatsOnly: intent.hard.openSeatsOnly ?? false,
    otherSites: intent.hard.campusScope === "otherSitesOk",
  };

  const weights: PreferenceWeights = {
    fewerDays: softWeight("fewerDays"),
    compact: softWeight("compact"),
    mornings: 0,
    evenings: 0,
    walking: softWeight("minimalWalking"),
    rating: 0,
  };

  return { constraints, weights };
}
