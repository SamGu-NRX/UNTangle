/**
 * The onboarding importance answers as they are stored and sent: the
 * persisted form of `ImportanceAnswers` in @untangle/core/importance, which
 * turns them into preference weights. The contract tests pin this schema to
 * core's type.
 *
 * Not yet part of PreferencesBodySchema. It joins it in a later preferences
 * schema version, next to the weights it produced, so a later change to the
 * mapping never rewrites a student's saved weights.
 */
import { z } from "zod";
import { OptimizationKeySchema } from "./documents";

/** 1 means "ignore this"; 5 means "this matters most". */
export const ImportanceSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);

export const ImportanceAnswersSchema = z.strictObject({
  /** The goal the student started from. */
  preset: OptimizationKeySchema.nullable(),
  /** Null is "not answered", which keeps the preset's weight. */
  fewerDays: ImportanceSchema.nullable(),
  compact: ImportanceSchema.nullable(),
  walking: ImportanceSchema.nullable(),
  rating: ImportanceSchema.nullable(),
  timeOfDay: z.strictObject({ lean: z.enum(["earlier", "later"]), importance: ImportanceSchema }).nullable(),
});

export type ImportanceAnswers = z.output<typeof ImportanceAnswersSchema>;
