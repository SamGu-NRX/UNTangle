/**
 * Plain-language schedule preferences: the typed contract.
 *
 * A student says things like "no classes before 10 on Fridays, and I want
 * it all compact" in one breath. This module defines the shape those words
 * parse into (`PreferenceIntent`) and the pure patch function onto the
 * planner's existing inputs (`applyIntent`). The rule-based parser lives in
 * `parse.ts`; this file is the contract, the empty intent, and the patch.
 *
 * Two families, kept apart on purpose:
 *
 * - hard constraints. A schedule that breaks one is wrong.
 * - soft preferences are leanings. Each carries a strength ("strong" or
 *   "mild") so the planner can trade them against each other.
 *
 * Time conventions match the optimizer: minutes after midnight, half-open
 * intervals `[start, end)`. A class ending at 10:00 and a commitment
 * starting at 10:00 do not conflict.
 *
 * Patch semantics (the contract the review pinned): `applyIntent` touches
 * only the fields the intent sets. Every field the intent leaves null or
 * absent is preserved byte-identically from `current` - including
 * `walkingBufferMinutes`, `excludedSections` and every weight the intent
 * does not mention - and the result always satisfies
 * `parseSchedulePreferences`.
 */

import { uniqueBlockId } from "@/components/schedule/constraint-logic";
import { weekDays } from "@/lib/types";
import type {
  BlockedTime,
  PreferenceWeights,
  ScheduleConstraints,
  SchedulePreferences,
  WeekDay,
} from "@/lib/types";

/**
 * How much a soft preference matters. Plain statements are mild; an
 * intensifier ("really", "must", "need", "can't") makes one strong; a hedge
 * keeps it mild.
 */
export type Strength = "strong" | "mild";

/**
 * Planner weight per strength. Strong is 4, the value a preference chip and
 * a goal preset give their main term (`applyChoice`, optimizer/presets.ts).
 * Mild is 2, half of that; no run has tested 2 against other values, it is
 * only the midpoint of the 0..4 scale.
 */
export const STRENGTH_WEIGHT: Record<Strength, number> = { strong: 4, mild: 2 };

/**
 * Soft preferences the schema can express. `compact` and `spreadOut` are
 * opposites; the rest stand alone. Each mention in a sentence contributes
 * one entry, so a repeated key keeps its last strength.
 *
 * `mornings` and `evenings` map to the planner's existing weight rows;
 * `minimalWalking` maps to the walking weight. `spreadOut` and
 * `easierGraders` have no planner input yet and are listed as unsupported
 * by the mapping below.
 */
export const SOFT_KEYS = [
  "compact",
  "spreadOut",
  "fewerDays",
  "minimalWalking",
  "mornings",
  "evenings",
  "easierGraders",
] as const;
export type SoftKey = (typeof SOFT_KEYS)[number];

export type SoftPreference = {
  key: SoftKey;
  strength: Strength;
  /**
   * Direction, for the keys that have one (`mornings`, `evenings`): true or
   * omitted means the student leans INTO that time (the planner's weight
   * rises), false means they lean away ("no morning classes", "not a
   * morning person") and the weight is set to 0 rather than up. Without
   * this, a vague morning complaint would push the planner TOWARD mornings
   * - an inverted fact.
   */
  positive?: boolean;
};

/** A weekly commitment the student must keep, such as a job, practice or a lab rotation. */
export type PrefBlockedTime = {
  /** Planner days only (Mon-Fri): a weekend commitment is tagged unsupported at parse time. */
  day: WeekDay;
  /** Minutes after midnight, half-open `[start, end)`. */
  start: number;
  end: number;
  /** What the student called it, when they named it ("work", "practice"). Optional. */
  label?: string;
};

/** Where classes may be: the Denton campus, or other UNT sites (Frisco and similar) too. Discovery Park counts as Denton. */
export type CampusScope = "dentonOnly" | "otherSitesOk";

/** How classes meet. The planner has no input for this yet; see the mapping notes in `applyIntent`. */
export type ClassMode = "online" | "inPerson";

/**
 * Hard constraints. `null` means "not mentioned", not "off": only the
 * fields the student actually constrained are set, and `applyIntent`
 * preserves the rest of the student's saved preferences.
 *
 * Seats and campus scope are filters on which suggestions are shown, not
 * builder requirements: the planner still picks sections that break neither
 * the schedule nor the credit cap, and the filter narrows what it may
 * suggest (see the field comments in `ScheduleConstraints`).
 */
export type HardConstraints = {
  /** No class may start before this minute. */
  earliestStart: number | null;
  /** No class may end after this minute. */
  latestEnd: number | null;
  /** No class on these days (planner days, Mon-Fri). */
  daysOff: WeekDay[];
  /** No class may overlap one of these weekly ranges. */
  blockedTimes: PrefBlockedTime[];
  /** Total credits must reach this. The planner has no minimum-credit input; see the mapping notes. */
  creditMin: number | null;
  /** Total credits may not exceed this. */
  creditMax: number | null;
  /** A filter on suggestions: only options whose every component with known seats has one open. */
  openSeatsOnly: boolean | null;
  /** A filter on suggestions: Denton only, or other UNT sites allowed too. */
  campusScope: CampusScope | null;
  /** Online only, or in person only. */
  mode: ClassMode | null;
};

/** What a preference sentence parses into. */
export type PreferenceIntent = {
  hard: HardConstraints;
  soft: SoftPreference[];
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
    },
    soft: [],
  };
}

/** The planner's day order, for canonical day lists. */
const DAY_ORDER: readonly WeekDay[] = weekDays;

/** The planner cannot hold more than 40 credits (`parseSchedulePreferences` rejects anything else). */
const MAX_MAPPABLE_CREDITS = 40;

/**
 * Patch the planner's saved preferences with what a preference sentence
 * expressed. Pure: same current and intent in, same preferences out,
 * nothing read or written.
 *
 * Rules:
 *
 * - Only fields the intent sets change. `null`/absent intent fields leave
 *   the current value byte-identical - `walkingBufferMinutes` stays as it
 *   was (a soft walking request sets the walking weight, never the saved
 *   buffer), `excludedSections` is never touched by an intent, and each
 *   weight changes only when its own soft key is mentioned.
 * - Mentioned days off are added, never removed: the intent vocabulary has
 *   no "classes are fine on X" statement, so there is nothing that could
 *   un-set a day.
 * - Blocked times are appended with ids from `uniqueBlockId`, so an intent
 *   can never collide with an existing block's id. A block with the same
 *   day, start and end as one already saved is skipped, so applying the
 *   same sentence twice does not stack copies.
 * - Mornings and evenings are one lean, as in `applyChoice` and
 *   `choicesFromWeights`: leaning into one sets its weight and zeroes the
 *   other, so a mild morning ask on a preset with evenings at 4 reads as
 *   "earlier", not "later". Leaning away zeroes only its own weight.
 * - The output always passes `parseSchedulePreferences`: days are planner
 *   days, blocked ranges satisfy `end > start` (the parser guarantees it),
 *   and an out-of-range credit max is clamped to 0..40 because the planner
 *   cannot hold anything else. The clamp is a planner limit, not a
 *   reinterpretation of what the student said.
 *
 * What the intent can hold but the planner cannot express (kept in the
 * intent, listed as unsupported here, never rounded into another field):
 *
 * - `hard.creditMin`: the planner only has `maxCredits`; there is no
 *   minimum-credit constraint.
 * - `hard.mode` online/inPerson: no online-only or in-person-only input.
 *   The optimizer only notices online sections as untimed meetings,
 *   through `fixedCredits` set by the caller.
 * - `soft` `spreadOut`: weights are non-negative and only push
 *   compactness up; there is no term that spreads classes apart.
 * - `soft` `easierGraders`: the closest knob is the `rating` weight, but
 *   that ranks student star ratings (0..5), not historical average GPA.
 *   Left unmapped rather than silently substituting a different number.
 * - `walkingBufferMinutes`: no intent field sets it. "Minimal walking" is a
 *   leaning and maps to the walking weight; the buffer is a hard minimum
 *   the student sets in the planner.
 */
export function applyIntent(current: SchedulePreferences, intent: PreferenceIntent): SchedulePreferences {
  const constraints: ScheduleConstraints = {
    ...current.constraints,
    blocked: [...current.constraints.blocked],
  };

  // Mentioned days off are added; nothing is removed.
  if (intent.hard.daysOff.length > 0) {
    const days = new Set(current.constraints.daysOff);
    for (const d of intent.hard.daysOff) days.add(d);
    constraints.daysOff = DAY_ORDER.filter((d) => days.has(d));
  }

  for (const b of intent.hard.blockedTimes) {
    if (constraints.blocked.some((x) => x.day === b.day && x.start === b.start && x.end === b.end)) continue;
    const block: BlockedTime = {
      id: uniqueBlockId(constraints.blocked, "pref-block"),
      label: b.label ?? "kept free",
      day: b.day,
      start: b.start,
      end: b.end,
    };
    constraints.blocked = [...constraints.blocked, block];
  }

  if (intent.hard.earliestStart !== null) constraints.earliestStart = intent.hard.earliestStart;
  if (intent.hard.latestEnd !== null) constraints.latestEnd = intent.hard.latestEnd;
  if (intent.hard.creditMax !== null) {
    constraints.maxCredits = Math.min(Math.max(0, intent.hard.creditMax), MAX_MAPPABLE_CREDITS);
  }
  if (intent.hard.openSeatsOnly !== null) constraints.openSeatsOnly = intent.hard.openSeatsOnly;
  if (intent.hard.campusScope !== null) constraints.otherSites = intent.hard.campusScope === "otherSitesOk";

  // An unmentioned soft key leaves its weight exactly as the student last
  // set it. Preferences apply in order, so a later leaning wins.
  const weights: PreferenceWeights = { ...current.weights };
  for (const pref of intent.soft) {
    const weight = STRENGTH_WEIGHT[pref.strength];
    if (pref.key === "compact") weights.compact = weight;
    else if (pref.key === "fewerDays") weights.fewerDays = weight;
    else if (pref.key === "minimalWalking") weights.walking = weight;
    else if (pref.key === "mornings" || pref.key === "evenings") {
      const other = pref.key === "mornings" ? "evenings" : "mornings";
      // The planner has no negative weights: leaning away is 0.
      weights[pref.key] = pref.positive === false ? 0 : weight;
      if (pref.positive !== false) weights[other] = 0;
    }
    // spreadOut and easierGraders have no planner weight; see the notes above.
  }

  // Preserve every top-level field the intent does not touch
  // (walkingBufferMinutes, excludedSections, and any field added later):
  // the patch contract is byte-identical preservation, not reconstruction.
  return { ...current, constraints, weights };
}
