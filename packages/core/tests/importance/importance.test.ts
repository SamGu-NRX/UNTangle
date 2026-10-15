import { describe, expect, test } from "bun:test";
import {
  weightsFromImportance,
  type Importance,
  type ImportanceAnswers,
  type PreferenceWeights,
  type PresetKey,
} from "../../src/importance";

const scale: Importance[] = [1, 2, 3, 4, 5];
const presets: Array<PresetKey | null> = [null, "clusterMorning", "clusterNight", "compact", "minimizeDistance", "maximizeProfessor"];
const plainKeys = ["fewerDays", "compact", "walking", "rating"] as const;
const zero: PreferenceWeights = { fewerDays: 0, compact: 0, mornings: 0, evenings: 0, walking: 0, rating: 0 };

/** GOAL_WEIGHTS in frontend/src/lib/optimizer/presets.ts on 2026-10-14: each goal's main term at 4, a light compactness tiebreak. */
const GOAL_WEIGHTS: Record<PresetKey, PreferenceWeights> = {
  clusterMorning: { ...zero, mornings: 4, compact: 1 },
  clusterNight: { ...zero, evenings: 4, compact: 1 },
  compact: { ...zero, compact: 4, fewerDays: 2 },
  minimizeDistance: { ...zero, walking: 4, compact: 1 },
  maximizeProfessor: { ...zero, rating: 4, compact: 1 },
};

const unanswered: ImportanceAnswers = {
  preset: null,
  fewerDays: null,
  compact: null,
  walking: null,
  rating: null,
  timeOfDay: null,
};

/** Every answer the onboarding scale can produce: 6 presets, 6 choices for each plain key, 11 for time of day. */
function* everyAnswer(): Generator<ImportanceAnswers> {
  const choices = [null, ...scale];
  const times = [null, ...scale.flatMap((importance) => (["earlier", "later"] as const).map((lean) => ({ lean, importance })))];
  for (const preset of presets)
    for (const fewerDays of choices)
      for (const compact of choices)
        for (const walking of choices)
          for (const rating of choices)
            for (const timeOfDay of times) yield { preset, fewerDays, compact, walking, rating, timeOfDay };
}

describe("weightsFromImportance", () => {
  test.each([...plainKeys])("%s: importance 1 to 5 gives weight 0 to 4", (key) => {
    expect(scale.map((importance) => weightsFromImportance({ ...unanswered, [key]: importance })[key])).toEqual([0, 1, 2, 3, 4]);
  });

  test("an answered key changes only its own weight", () => {
    expect(weightsFromImportance({ ...unanswered, walking: 4 })).toEqual({ ...zero, walking: 3 });
  });

  test("importance 1 means ignore, even over a preset that leans on the key", () => {
    expect(weightsFromImportance({ ...unanswered, preset: "minimizeDistance", walking: 1 })).toEqual({ ...GOAL_WEIGHTS.minimizeDistance, walking: 0 });
  });

  test("time of day sets the side it leans to and turns the other side off", () => {
    expect(scale.map((importance) => weightsFromImportance({ ...unanswered, timeOfDay: { lean: "earlier", importance } }))).toEqual(
      [0, 1, 2, 3, 4].map((mornings) => ({ ...zero, mornings })),
    );
    expect(weightsFromImportance({ ...unanswered, timeOfDay: { lean: "later", importance: 3 } })).toEqual({ ...zero, evenings: 2 });
  });

  test("an answered time of day overrides the preset's lean", () => {
    expect(weightsFromImportance({ ...unanswered, preset: "clusterNight", timeOfDay: { lean: "earlier", importance: 5 } })).toEqual({
      ...GOAL_WEIGHTS.clusterNight,
      mornings: 4,
      evenings: 0,
    });
  });

  test.each(presets.filter((preset) => preset !== null))("the %s preset with nothing answered gives the planner's goal weights", (preset) => {
    expect(weightsFromImportance({ ...unanswered, preset })).toEqual(GOAL_WEIGHTS[preset]);
  });

  test("no preset and nothing answered gives every weight 0", () => {
    expect(weightsFromImportance(unanswered)).toEqual(zero);
  });

  test("unanswered keys keep the preset's weights", () => {
    expect(weightsFromImportance({ ...unanswered, preset: "compact", walking: 5 })).toEqual({ ...GOAL_WEIGHTS.compact, walking: 4 });
  });

  test("every answer the scale allows maps to whole weights from 0 to 4, the same way every time", () => {
    let checked = 0;
    for (const answers of everyAnswer()) {
      const weights = weightsFromImportance(answers);
      expect(Object.keys(weights).sort()).toEqual(["compact", "evenings", "fewerDays", "mornings", "rating", "walking"]);
      for (const value of Object.values(weights)) {
        if (!Number.isInteger(value) || value < 0 || value > 4) throw new Error(`${JSON.stringify(answers)} gave ${JSON.stringify(weights)}`);
      }
      expect(weightsFromImportance(structuredClone(answers))).toEqual(weights);
      checked += 1;
    }
    expect(checked).toBe(6 * 6 ** 4 * 11);
  });

  test("raising one answer never lowers its weight and never moves another key's", () => {
    for (const answers of everyAnswer()) {
      const before = weightsFromImportance(answers);
      for (const key of plainKeys) {
        const current = answers[key];
        if (current === null || current === 5) continue;
        const after = weightsFromImportance({ ...answers, [key]: current + 1 });
        expect(after[key]).toBeGreaterThanOrEqual(before[key]);
        expect({ ...after, [key]: 0 }).toEqual({ ...before, [key]: 0 });
      }
      const time = answers.timeOfDay;
      if (time !== null && time.importance !== 5) {
        const after = weightsFromImportance({ ...answers, timeOfDay: { ...time, importance: (time.importance + 1) as Importance } });
        const side = time.lean === "earlier" ? "mornings" : "evenings";
        expect(after[side]).toBeGreaterThan(before[side]);
        expect({ ...after, mornings: 0, evenings: 0 }).toEqual({ ...before, mornings: 0, evenings: 0 });
      }
    }
  });

  test("each call returns a new object, so changing one result never changes a preset", () => {
    const first = weightsFromImportance({ ...unanswered, preset: "compact" });
    first.compact = 0;
    first.fewerDays = 0;
    expect(weightsFromImportance({ ...unanswered, preset: "compact" })).toEqual(GOAL_WEIGHTS.compact);
  });

  test.each([0, 6, 2.5, Number.NaN])("an importance of %p throws instead of being clamped", (importance) => {
    expect(weightsFromImportance({ ...unanswered, compact: 3 })).toEqual({ ...zero, compact: 2 });
    // Answers that skipped their schema, as a stale client might send them.
    expect(() => weightsFromImportance({ ...unanswered, compact: importance as Importance })).toThrow();
    expect(() => weightsFromImportance({ ...unanswered, timeOfDay: { lean: "later", importance: importance as Importance } })).toThrow();
  });

  test("an unknown preset throws", () => {
    expect(weightsFromImportance({ ...unanswered, preset: "compact" })).toEqual(GOAL_WEIGHTS.compact);
    expect(() => weightsFromImportance({ ...unanswered, preset: "balanced" as PresetKey })).toThrow();
  });
});
