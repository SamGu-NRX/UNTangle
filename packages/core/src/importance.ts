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
  void answers;
  throw new Error("Not built yet: docs/tasks/importance-to-weights.md");
}
