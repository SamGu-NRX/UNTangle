/**
 * The onboarding importance scale, turned into the optimizer's preference
 * weights.
 *
 * A student answers "how much does this matter?" from 1 to 5 for each
 * leaning, and may start from one of the planner's five goal presets. The
 * optimizer reads PreferenceWeights: whole numbers from 0 to 4, the shape
 * PreferenceWeightsSchema in @untangle/contracts/documents checks.
 *
 * The persisted form of the answers is ImportanceAnswersSchema in
 * @untangle/contracts/importance; its tests pin it to the types here.
 */

/** 1 means "ignore this"; 5 means "this matters most". */
export type Importance = 1 | 2 | 3 | 4 | 5;

/** The planner's goal presets, as `OptimizationKey` in frontend/src/lib/types.ts names them. */
export type PresetKey = "clusterMorning" | "clusterNight" | "compact" | "minimizeDistance" | "maximizeProfessor";

/** Preference weights, each a whole number from 0 to 4, as in frontend/src/lib/types.ts. */
export type PreferenceWeights = {
  fewerDays: number;
  compact: number;
  mornings: number;
  evenings: number;
  walking: number;
  rating: number;
};

/**
 * What the student answered. Null means "not answered", which keeps the
 * preset's weight; it never means "ignore", which is importance 1.
 *
 * Time of day is one question with a direction, because the planner treats
 * mornings and evenings as one lean (`applyChoice` in
 * frontend/src/components/schedule/constraint-logic.ts): leaning into one
 * turns the other off.
 */
export type ImportanceAnswers = {
  /** The goal the student started from; null starts every weight at 0. */
  preset: PresetKey | null;
  fewerDays: Importance | null;
  compact: Importance | null;
  /** Short walks between classes. */
  walking: Importance | null;
  /** Instructor ratings. */
  rating: Importance | null;
  timeOfDay: { lean: "earlier" | "later"; importance: Importance } | null;
};

const ZERO_WEIGHTS: Readonly<PreferenceWeights> = { fewerDays: 0, compact: 0, mornings: 0, evenings: 0, walking: 0, rating: 0 };

// Match frontend/src/lib/optimizer/presets.ts without importing the web app into core.
const GOAL_WEIGHTS: Record<PresetKey, Readonly<PreferenceWeights>> = {
  clusterMorning: { ...ZERO_WEIGHTS, mornings: 4, compact: 1 },
  clusterNight: { ...ZERO_WEIGHTS, evenings: 4, compact: 1 },
  compact: { ...ZERO_WEIGHTS, compact: 4, fewerDays: 2 },
  minimizeDistance: { ...ZERO_WEIGHTS, walking: 4, compact: 1 },
  maximizeProfessor: { ...ZERO_WEIGHTS, rating: 4, compact: 1 },
};

function importanceWeight(importance: Importance, question: string): number {
  if (!Number.isInteger(importance) || importance < 1 || importance > 5) {
    throw new Error(`${question}: importance must be a whole number from 1 to 5`);
  }
  return importance - 1;
}

/**
 * The weights the answers ask for.
 *
 * Starts from the preset's weights, which equal GOAL_WEIGHTS in
 * frontend/src/lib/optimizer/presets.ts, or from all zeros. Each answered
 * key then gets weight `importance - 1`, so 1 turns it off and 5 gives 4,
 * the value a preference chip uses. An answered time of day sets the leaned
 * side the same way and the other side to 0.
 *
 * Total over every valid answer, deterministic, and monotonic: raising one
 * key's importance never lowers that key's weight and never changes another
 * key's. Returns a new object each call, never a shared preset. Throws on an
 * importance outside 1 to 5, a non-integer one, or an unknown preset; it
 * never clamps or rounds a bad answer into a valid one.
 */
export function weightsFromImportance(answers: ImportanceAnswers): PreferenceWeights {
  if (answers.preset !== null && !Object.hasOwn(GOAL_WEIGHTS, answers.preset)) {
    throw new Error(`Unknown importance preset: ${answers.preset}`);
  }
  const weights = { ...(answers.preset === null ? ZERO_WEIGHTS : GOAL_WEIGHTS[answers.preset]) };
  for (const key of ["fewerDays", "compact", "walking", "rating"] as const) {
    const importance = answers[key];
    if (importance !== null) weights[key] = importanceWeight(importance, key);
  }
  if (answers.timeOfDay !== null) {
    const { lean, importance } = answers.timeOfDay;
    if (lean !== "earlier" && lean !== "later") throw new Error(`Unknown time-of-day lean: ${lean}`);
    const weight = importanceWeight(importance, "timeOfDay");
    weights.mornings = lean === "earlier" ? weight : 0;
    weights.evenings = lean === "later" ? weight : 0;
  }
  return weights;
}
