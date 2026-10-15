/**
 * Set up Auto's steps (r3 mockup, onboarding.html) and what each writes.
 * Every answer goes through the same `SchedulePreferences` fields the
 * Preferences popover writes (limits.ts), so Week, Preferences and Auto
 * show an answer the moment it is given.
 *
 * The mockup's "In your own words" and "Looking ahead" steps and its
 * preset name and reminder are left out. Looking ahead, the preset and the
 * reminder have no preferences field (the mockup's own review notes say
 * so), and the typed step's facts (days off, busy time, class hours) are
 * all on the painted grid of the shape step.
 */
import type { SchedulePreferences } from "@/lib/types";
import { leanSays, type LeanKey } from "./limits";

export type QuestionKey = "time" | "fewerDays" | "walking" | "rating";

export type SetupStep =
  | { kind: "question"; key: QuestionKey; chapter: 0 }
  | { kind: "shape"; chapter: 1 }
  | { kind: "ready"; chapter: 2 };

export const CHAPTERS = ["What matters most", "Shape of your days", "Ready"] as const;

export const SETUP_STEPS: readonly SetupStep[] = [
  { kind: "question", key: "time", chapter: 0 },
  { kind: "question", key: "fewerDays", chapter: 0 },
  { kind: "question", key: "walking", chapter: 0 },
  { kind: "question", key: "rating", chapter: 0 },
  { kind: "shape", chapter: 1 },
  { kind: "ready", chapter: 2 },
];

export const QUESTION_COUNT = SETUP_STEPS.filter((s) => s.kind === "question").length;

const HOW_MUCH = [
  { value: 0, label: "Doesn't matter" },
  { value: 1, label: "A little" },
  { value: 2, label: "Some" },
  { value: 3, label: "A lot" },
  { value: 4, label: "More than anything" },
] as const;

export type Question = {
  question: string;
  /** A line under the question, when the answers need one. */
  sub?: string;
  answers: ReadonlyArray<{ value: number; label: string }>;
};

/** The mockup's wording. Each answer is a step on the matching Preferences card's slider. */
export const QUESTIONS: Record<QuestionKey, Question> = {
  time: {
    question: "When do you like your classes?",
    answers: [
      { value: -2, label: "As early as I can" },
      { value: -1, label: "Mornings, if they fit" },
      { value: 0, label: "No preference" },
      { value: 1, label: "Afternoons, if they fit" },
      { value: 2, label: "As late as I can" },
    ],
  },
  fewerDays: { question: "How much do fewer days on campus matter?", answers: HOW_MUCH },
  walking: { question: "How much do short walks between classes matter?", answers: HOW_MUCH },
  rating: { question: "How much do well-rated instructors matter?", sub: "From student star ratings.", answers: HOW_MUCH },
};

/** What Auto does with an answer, said under the picture: the Preferences card's line, with Auto as its subject. */
export function autoSays(key: LeanKey, value: number): string {
  if (key === "time" && Math.round(value) === 0) return "Auto puts classes wherever they fit.";
  const line = leanSays(key, value);
  return `Auto ${line[0].toLowerCase()}${line.slice(1)}`;
}

/**
 * Skipping a question puts back what it was when the setup opened, exactly:
 * time of day restores both weights it reads, so an older preference with
 * both set survives a skip.
 */
export function restoreLean(p: SchedulePreferences, before: SchedulePreferences, key: LeanKey): SchedulePreferences {
  const w = before.weights;
  const back = key === "time" ? { mornings: w.mornings, evenings: w.evenings } : { [key]: w[key] };
  return { ...p, weights: { ...p.weights, ...back } };
}

/** Skipping the shape step puts back its fields: class hours, days off, busy time and short gaps. */
export function restoreShape(p: SchedulePreferences, before: SchedulePreferences): SchedulePreferences {
  const b = before.constraints;
  return {
    ...p,
    constraints: { ...p.constraints, earliestStart: b.earliestStart, latestEnd: b.latestEnd, daysOff: b.daysOff, blocked: b.blocked },
    weights: { ...p.weights, compact: before.weights.compact },
  };
}

/** The fields a step's Skip puts back. */
export function skipStep(p: SchedulePreferences, before: SchedulePreferences, step: SetupStep): SchedulePreferences {
  if (step.kind === "question") return restoreLean(p, before, step.key);
  if (step.kind === "shape") return restoreShape(p, before);
  return p;
}

/** Whether the setup changed anything the student would want an Undo for. */
export const changedSince = (p: SchedulePreferences, before: SchedulePreferences) => JSON.stringify(p) !== JSON.stringify(before);
