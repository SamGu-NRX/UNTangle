/**
 * Section filters as they are stored and sent: the persisted form of
 * `SectionFilter` in @untangle/core/filters, which judges a section against
 * them. The contract tests pin these schemas to core's types.
 *
 * Not yet part of PreferencesBodySchema. They join it in a later preferences
 * schema version, which replaces ScheduleConstraints' openSeatsOnly and
 * otherSites with an "open-seats" and a "site" filter.
 */
import { z } from "zod";
import { CampusSiteIdSchema } from "./ids";

export const ClassDaySchema = z.enum(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
export const MeetingModeSchema = z.enum(["in-person", "online-timed", "online-async"]);

/** Minutes after midnight; a class may end at 1440. */
const minute = z.int().min(0).max(24 * 60);

/** A non-empty list that names each value once. */
function choices<T extends z.ZodType<string>>(item: T) {
  return z
    .array(item)
    .min(1)
    .superRefine((values, ctx) => {
      const seen = new Set<string>();
      values.forEach((value, index) => {
        if (seen.has(value)) ctx.addIssue({ code: "custom", path: [index], message: `"${value}" appears twice.` });
        seen.add(value);
      });
    });
}

/** Visible characters and single spaces, nothing at either end, as a name is shown. */
const instructorName = z
  .string()
  .max(100)
  .regex(/^\S(?: ?\S)*$/, "An instructor name has no leading, trailing or doubled spaces.");

export const SectionFilterSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("open-seats"), minimum: z.int().min(1) }),
  z.strictObject({ kind: z.literal("modality"), allowed: choices(MeetingModeSchema) }),
  z.strictObject({ kind: z.literal("site"), allowed: choices(CampusSiteIdSchema) }),
  z.strictObject({ kind: z.literal("days"), allowed: choices(ClassDaySchema) }),
  z
    .strictObject({ kind: z.literal("time-window"), earliestStart: minute.nullable(), latestEnd: minute.nullable() })
    .superRefine((filter, ctx) => {
      if (filter.earliestStart === null && filter.latestEnd === null) {
        ctx.addIssue({ code: "custom", path: ["earliestStart"], message: "A time window bounds at least one side." });
      }
      // As in ScheduleConstraintsSchema: an inverted pair would rule out every meeting.
      if (filter.earliestStart !== null && filter.latestEnd !== null && filter.latestEnd <= filter.earliestStart) {
        ctx.addIssue({ code: "custom", path: ["latestEnd"], message: "The latest end is after the earliest start." });
      }
    }),
  z.strictObject({ kind: z.literal("instructor"), match: z.enum(["only", "not"]), names: choices(instructorName) }),
  z
    .strictObject({ kind: z.literal("credit-hours"), min: z.number().min(0).max(40).nullable(), max: z.number().min(0).max(40).nullable() })
    .superRefine((filter, ctx) => {
      if (filter.min === null && filter.max === null) {
        ctx.addIssue({ code: "custom", path: ["min"], message: "A credit-hours filter bounds at least one side." });
      }
      if (filter.min !== null && filter.max !== null && filter.max < filter.min) {
        ctx.addIssue({ code: "custom", path: ["max"], message: "The most credit hours is at least the fewest." });
      }
    }),
]);

/** A student's filters: each kind at most once, so a second filter of a kind can't narrow the first unseen. */
export const SectionFiltersSchema = z.array(SectionFilterSchema).superRefine((filters, ctx) => {
  const seen = new Set<string>();
  filters.forEach((filter, index) => {
    if (seen.has(filter.kind)) ctx.addIssue({ code: "custom", path: [index, "kind"], message: `A second "${filter.kind}" filter.` });
    seen.add(filter.kind);
  });
});

export type SectionFilter = z.output<typeof SectionFilterSchema>;
