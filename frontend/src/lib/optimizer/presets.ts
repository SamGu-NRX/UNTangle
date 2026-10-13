/**
 * The planner's five goals as preset preference weights. Each preset leans
 * hard on its own term and lightly on compactness, so ties inside the main
 * goal break toward fewer idle hours instead of toward section ids.
 */

import type { OptConstraints, OptWeights } from "./types";

export type GoalKey = "clusterMorning" | "clusterNight" | "compact" | "minimizeDistance" | "maximizeProfessor";

export const ZERO_WEIGHTS: OptWeights = { fewerDays: 0, compact: 0, mornings: 0, evenings: 0, walking: 0, rating: 0 };

export const GOAL_WEIGHTS: Record<GoalKey, OptWeights> = {
  clusterMorning: { ...ZERO_WEIGHTS, mornings: 4, compact: 1 },
  clusterNight: { ...ZERO_WEIGHTS, evenings: 4, compact: 1 },
  compact: { ...ZERO_WEIGHTS, compact: 4, fewerDays: 2 },
  minimizeDistance: { ...ZERO_WEIGHTS, walking: 4, compact: 1 },
  maximizeProfessor: { ...ZERO_WEIGHTS, rating: 4, compact: 1 },
};

/** The preset whose weights match exactly, or null for a custom mix. */
export function goalForWeights(weights: OptWeights): GoalKey | null {
  for (const [goal, preset] of Object.entries(GOAL_WEIGHTS) as Array<[GoalKey, OptWeights]>) {
    if ((Object.keys(preset) as Array<keyof OptWeights>).every((key) => preset[key] === weights[key])) return goal;
  }
  return null;
}

export const NO_CONSTRAINTS: OptConstraints = {
  earliestStart: null,
  latestEnd: null,
  daysOff: [],
  blocked: [],
  maxCredits: null,
  walking: null,
};
