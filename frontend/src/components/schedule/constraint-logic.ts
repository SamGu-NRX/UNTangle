/**
 * The constraint rail's rules, kept out of the component so each has one
 * tested answer: which weights a preference chip owns, when a blocked time
 * is complete, and which max-credit values the selector offers.
 */
import type { BlockedTime, PreferenceWeights, WeekDay } from "@/lib/types";

export type Lean = "earlier" | "any" | "later";

export type Choices = { lean: Lean; compact: boolean; walks: boolean; profs: boolean };

/** Which chips read as on for a set of weights (fine-tuned weights included). */
export function choicesFromWeights(w: PreferenceWeights): Choices {
  return {
    lean: w.mornings > w.evenings ? "earlier" : w.evenings > w.mornings ? "later" : "any",
    compact: w.compact >= 3 || w.fewerDays >= 2,
    walks: w.walking >= 3,
    profs: w.rating >= 3,
  };
}

export type Choice = { lean: Lean } | { compact: boolean } | { walks: boolean } | { profs: boolean };

/**
 * Applies one chip or segment change. Each control owns only its own
 * weights, so toggling "Short walks" never rewrites a weight the student
 * fine-tuned elsewhere. The on values match the goal presets in
 * optimizer/presets.ts: the chip's term at 4; "Compact days" also turns
 * fewer days to 2, and off it leaves the light idle-time tiebreak (1) every
 * preset carries.
 */
export function applyChoice(weights: PreferenceWeights, choice: Choice): PreferenceWeights {
  if ("lean" in choice) {
    return { ...weights, mornings: choice.lean === "earlier" ? 4 : 0, evenings: choice.lean === "later" ? 4 : 0 };
  }
  if ("compact" in choice) {
    return { ...weights, compact: choice.compact ? 4 : 1, fewerDays: choice.compact ? 2 : 0 };
  }
  if ("walks" in choice) return { ...weights, walking: choice.walks ? 4 : 0 };
  return { ...weights, rating: choice.profs ? 4 : 0 };
}

export type BlockDraft = { label: string; day: WeekDay; start: string; end: string };

/** What a time input holds: "HH:MM", or "HH:MM:SS" in some browsers; "" when cleared. */
const TIME = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/;

export function timeToMinutes(value: string): number | null {
  const match = TIME.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/**
 * A blocked time from the form, or the one reason it cannot be added yet
 * and the field it is about. A cleared time input gives "", which must
 * never read as midnight.
 */
export function parseBlockDraft(
  draft: BlockDraft,
  id: string,
): { ok: true; block: BlockedTime } | { ok: false; field: "label" | "start" | "end"; reason: string } {
  const label = draft.label.trim();
  if (label.length === 0) return { ok: false, field: "label", reason: "Name the time you want kept free." };
  const start = timeToMinutes(draft.start);
  if (start === null) return { ok: false, field: "start", reason: "Enter when the blocked time starts." };
  const end = timeToMinutes(draft.end);
  if (end === null) return { ok: false, field: "end", reason: "Enter when the blocked time ends." };
  if (end <= start) return { ok: false, field: "end", reason: "The end must be after the start." };
  return { ok: true, block: { id, label, day: draft.day, start, end } };
}

/** An id no existing blocked time uses, so two blocks added in the same millisecond still differ. */
export function uniqueBlockId(existing: readonly BlockedTime[], base: string): string {
  const taken = new Set(existing.map((block) => block.id));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

const CREDIT_STEPS = Array.from({ length: 19 }, (_, i) => i + 3);

/**
 * Max-credit values the selector lists: 3 to 21, plus the active value when
 * it lies outside that (a suggested fix can raise the cap to 24), so the
 * selector always shows the limit actually in force.
 */
export function maxCreditOptions(current: number | null): number[] {
  if (current === null || CREDIT_STEPS.includes(current)) return CREDIT_STEPS;
  return [...CREDIT_STEPS, current].sort((a, b) => a - b);
}
