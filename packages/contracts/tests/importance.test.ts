import { describe, expect, expectTypeOf, test } from "bun:test";
import type { z } from "zod";
import type { ImportanceAnswers } from "../../core/src/importance";
import { ImportanceAnswersSchema } from "../src/importance";
import { decoded, rejections } from "./helpers";

describe("ImportanceAnswersSchema", () => {
  const answers: ImportanceAnswers = {
    preset: "compact",
    fewerDays: null,
    compact: 5,
    walking: 1,
    rating: null,
    timeOfDay: { lean: "earlier", importance: 3 },
  };

  test("answers round-trip", () => {
    expect(decoded(ImportanceAnswersSchema, answers)).toEqual(answers);
  });

  test.each([
    ["importance 0", { ...answers, compact: 0 }],
    ["importance 6", { ...answers, compact: 6 }],
    ["a fractional importance", { ...answers, walking: 2.5 }],
    ["an unknown preset", { ...answers, preset: "balanced" }],
    ["a time of day with no lean", { ...answers, timeOfDay: { importance: 3 } }],
    ["a missing answer instead of null", Object.fromEntries(Object.entries(answers).filter(([key]) => key !== "rating"))],
    ["an unknown field", { ...answers, spreadOut: 3 }],
  ])("rejects %s", (_why, value) => {
    expect(rejections(ImportanceAnswersSchema, value)).not.toEqual([]);
  });

  test("decodes to core's ImportanceAnswers", () => {
    expectTypeOf<z.output<typeof ImportanceAnswersSchema>>().toEqualTypeOf<ImportanceAnswers>();
  });
});
