/**
 * The four synced document kinds from docs/architecture/README.md ("Saved
 * state: documents with receipts"), and the envelope a stored document
 * travels in.
 *
 * Bodies are today's planner state split by document, keeping the field
 * names and value types of frontend/src/lib/types.ts so the migration copies
 * values without reshaping them. The contract tests compare these schemas'
 * types with those types, so a change on either side fails typecheck.
 *
 * Today's PlannerState splits like this:
 * - academic-record: courseStatuses, transcriptRecords, coursePlan.manualCredit
 *   and selectedMajor (as `major`);
 * - schedule: the planned courses, selectedSections, lockedSections,
 *   coursePlan.autoPlanned and coursePlan.lastAuto, plus a name and a term;
 * - preferences: optimization (as `goal`), and SchedulePreferences, which
 *   today lives only in localStorage;
 * - nowhere: activeDay, which stays on each device, and updatedAt, which
 *   revisions replace.
 *
 * Every object is strict: an unknown field is an error, never dropped. A
 * client that doesn't know a field can't parse the body, so it can't save
 * the body back without that field.
 */
import { z } from "zod";
import { CatalogIdSchema, CourseCodeSchema, DocumentIdSchema, InstitutionIdSchema, TermIdSchema } from "./ids";

// Value types from frontend/src/lib/types.ts.

export const WeekDaySchema = z.enum(["Mon", "Tue", "Wed", "Thu", "Fri"]);
export const CourseStatusSchema = z.enum(["completed", "inProgress", "notTaken"]);
export const OptimizationKeySchema = z.enum([
  "clusterMorning",
  "clusterNight",
  "compact",
  "minimizeDistance",
  "maximizeProfessor",
]);
export const MajorIdSchema = z.enum(["cs", "ce", "math", "biol", "busi", "psyc", "engl", "other"]);

export const TranscriptCourseRecordSchema = z.strictObject({
  id: z.string().min(1),
  code: z.string(),
  title: z.string(),
  term: z.string(),
  grade: z.string(),
  credits: z.number().nullable(),
  sourceKind: z.enum(["unt", "transfer", "exam", "current", "unknown"]),
  confidence: z.number(),
  rationale: z.string(),
  duplicateExcluded: z.boolean(),
  appliedStatus: z.enum(["completed", "inProgress", "ignored", "needsReview"]),
  prerequisiteSatisfied: z.boolean(),
  reviewRequired: z.boolean(),
});

export const AutoTransactionSchema = z
  .strictObject({
  id: z.string(),
  at: z.string(),
  major: MajorIdSchema.nullable(),
  changes: z.array(z.strictObject({ code: CourseCodeSchema, from: CourseStatusSchema, to: CourseStatusSchema })),
  autoPlannedBefore: z.array(CourseCodeSchema),
  summary: z.string(),
  needsCheck: z.array(CourseCodeSchema),
  invalidatedBy: CourseCodeSchema.optional(),
  })
  // Each list names a course at most once; a repeat would double an undo or a check.
  .superRefine((auto, ctx) => {
    requireUnique(auto.changes.map((change) => change.code), ctx, "changes", "Changed course");
    requireUnique(auto.autoPlannedBefore, ctx, "autoPlannedBefore", "Auto-planned course");
    requireUnique(auto.needsCheck, ctx, "needsCheck", "Course to check");
  });

/** Minutes after midnight. */
const minute = z.int().min(0).max(24 * 60);

/** A real calendar date (YYYY-MM-DD that names an actual day), per parseSchedulePreferences. */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "A date is YYYY-MM-DD.")
  .refine((value) => {
    const ms = Date.parse(`${value}T00:00:00Z`);
    return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
  }, "A date names a real calendar day.");

export const BlockedTimeSchema = z
  .strictObject({
    id: z.string(),
    label: z.string(),
    day: WeekDaySchema,
    start: minute,
    end: minute,
    // The real date ranges the block applies to, when it is not weekly
    // (calendar busy time from a connected feed). Absent, null, or empty
    // means every week.
    dates: z
      .array(z.strictObject({ start: isoDate, end: isoDate }))
      .nullable()
      .optional(),
  })
  .refine((block) => block.end > block.start, { message: "A blocked time ends after it starts.", path: ["end"] })
  .refine((block) => (block.dates ?? []).every((range) => range.start <= range.end), {
    message: "A blocked-time date range ends on or after it starts.",
    path: ["dates"],
  });

/** Fails the parse when `values` repeats one. */
function requireUnique(values: readonly string[], ctx: z.RefinementCtx, path: string, what: string) {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) ctx.addIssue({ code: "custom", path: [path], message: `${what} "${value}" appears twice.` });
    seen.add(value);
  }
}

// Limits match parseSchedulePreferences in frontend/src/lib/planner.ts.
export const ScheduleConstraintsSchema = z
  .strictObject({
    earliestStart: minute.nullable(),
    latestEnd: minute.nullable(),
    daysOff: z.array(WeekDaySchema),
    blocked: z.array(BlockedTimeSchema),
    maxCredits: z.number().min(0).max(40).nullable(),
    walkingBufferMinutes: z.int().min(0).max(120).nullable(),
    excludedSections: z.array(z.string()),
    openSeatsOnly: z.boolean(),
    otherSites: z.boolean(),
  })
  .superRefine((constraints, ctx) => {
    // The optimizer applies each bound on its own, so an inverted pair would rule out every meeting.
    const { earliestStart, latestEnd } = constraints;
    if (earliestStart !== null && latestEnd !== null && latestEnd <= earliestStart) {
      ctx.addIssue({ code: "custom", path: ["latestEnd"], message: "The latest end is after the earliest start." });
    }
    requireUnique(constraints.daysOff, ctx, "daysOff", "Day off");
    requireUnique(
      constraints.blocked.map((block) => block.id),
      ctx,
      "blocked",
      "Blocked time id",
    );
    requireUnique(constraints.excludedSections, ctx, "excludedSections", "Excluded section");
  });

/** Each weight is a whole number from 0 to 4. */
const weight = z.int().min(0).max(4);

export const PreferenceWeightsSchema = z.strictObject({
  fewerDays: weight,
  compact: weight,
  mornings: weight,
  evenings: weight,
  walking: weight,
  rating: weight,
});

// Document bodies. Each carries its institution.

/** One per user and institution. */
export const AcademicRecordBodySchema = z
  .strictObject({
    institutionId: InstitutionIdSchema,
    courseStatuses: z.record(CourseCodeSchema, CourseStatusSchema),
    transcriptRecords: z.array(TranscriptCourseRecordSchema),
    /** Courses the student says they have credit for, whatever the transcript shows. */
    manualCredit: z.array(CourseCodeSchema),
    major: MajorIdSchema.nullable(),
    /** The catalog year the student follows; null until they or an import set it. */
    catalogId: CatalogIdSchema.nullable(),
  })
  .superRefine((record, ctx) => {
    // The planner keys transcript rows by id when it merges imports.
    requireUnique(
      record.transcriptRecords.map((row) => row.id),
      ctx,
      "transcriptRecords",
      "Transcript row id",
    );
    requireUnique(record.manualCredit, ctx, "manualCredit", "Course");
  });

/** One per user, institution and term; a student may keep several. */
export const ScheduleBodySchema = z
  .strictObject({
    institutionId: InstitutionIdSchema,
    termId: TermIdSchema,
    name: z.string().min(1).max(80),
    /** The courses this schedule plans for its term. */
    courses: z.array(CourseCodeSchema),
    /** Course code to the chosen option's id. */
    selectedSections: z.record(CourseCodeSchema, z.string().min(1)),
    /** Course code to the option id the student pinned. */
    lockedSections: z.record(CourseCodeSchema, z.string().min(1)),
    /** Courses Auto-fill added, as opposed to ones added by hand. */
    autoPlanned: z.array(CourseCodeSchema),
    lastAuto: AutoTransactionSchema.nullable(),
  })
  .superRefine((schedule, ctx) => {
    requireUnique(schedule.courses, ctx, "courses", "Course");
    requireUnique(schedule.autoPlanned, ctx, "autoPlanned", "Course");
    // The invariants normalizePlannerState keeps today: a pick belongs to a
    // planned course, and a lock pins exactly the course's pick.
    const planned = new Set(schedule.courses);
    // Auto only plans and unplans courses for this term, which the schedule
    // holds, so its effect and its Undo record commit together in one write.
    // A change touching completed work would belong to the academic record.
    for (const [index, change] of (schedule.lastAuto?.changes ?? []).entries()) {
      const planning = new Set([change.from, change.to]);
      if (change.from === change.to || !planning.has("inProgress") || !planning.has("notTaken")) {
        ctx.addIssue({
          code: "custom",
          path: ["lastAuto", "changes", index],
          message: `Auto's change to ${change.code} isn't between planned and not planned.`,
        });
      }
    }
    // Undo and "clear Auto's picks" act on autoPlanned, so it may name only planned courses.
    for (const code of schedule.autoPlanned) {
      if (!planned.has(code)) {
        ctx.addIssue({ code: "custom", path: ["autoPlanned"], message: `${code} is marked as added by Auto but isn't in courses.` });
      }
    }
    for (const code of Object.keys(schedule.selectedSections)) {
      if (!planned.has(code)) {
        ctx.addIssue({ code: "custom", path: ["selectedSections", code], message: `${code} has a pick but isn't in courses.` });
      }
    }
    for (const [code, optionId] of Object.entries(schedule.lockedSections)) {
      if (schedule.selectedSections[code] !== optionId) {
        ctx.addIssue({ code: "custom", path: ["lockedSections", code], message: `${code} is locked to an option it hasn't picked.` });
      }
    }
  });

/** One per user and institution. */
export const PreferencesBodySchema = z.strictObject({
  institutionId: InstitutionIdSchema,
  /** The preset the weights started from. */
  goal: OptimizationKeySchema,
  constraints: ScheduleConstraintsSchema,
  weights: PreferenceWeightsSchema,
});

/** Append-only: an immutable copy of one schedule. */
export const VersionBodySchema = z
  .strictObject({
    institutionId: InstitutionIdSchema,
    /** The schedule document this is a version of. */
    scheduleId: DocumentIdSchema,
    reason: z.enum(["before-auto", "restore-point", "import"]),
    schedule: ScheduleBodySchema,
  })
  .refine((version) => version.schedule.institutionId === version.institutionId, {
    message: "A version and its schedule belong to the same institution.",
    path: ["schedule", "institutionId"],
  });

export const DocumentKindSchema = z.enum(["academic-record", "schedule", "preferences", "version"]);
export type DocumentKind = z.output<typeof DocumentKindSchema>;

/** The body schema for each kind, for a server that learns the kind from the stored document. */
export const documentBodySchemas = {
  "academic-record": AcademicRecordBodySchema,
  schedule: ScheduleBodySchema,
  preferences: PreferencesBodySchema,
  version: VersionBodySchema,
} as const satisfies Record<DocumentKind, z.ZodType>;

function envelope<const K extends DocumentKind, B extends z.ZodType>(kind: K, body: B) {
  return z.strictObject({
    documentId: DocumentIdSchema,
    kind: z.literal(kind),
    /** 1 after the first write; each write adds 1. */
    revision: z.int().min(1),
    schemaVersion: z.literal(1),
    body,
  });
}

/** A stored document as the server returns it. */
export const DocumentSchema = z.discriminatedUnion("kind", [
  envelope("academic-record", AcademicRecordBodySchema),
  envelope("schedule", ScheduleBodySchema),
  envelope("preferences", PreferencesBodySchema),
  envelope("version", VersionBodySchema),
]);

export type AcademicRecordBody = z.output<typeof AcademicRecordBodySchema>;
export type ScheduleBody = z.output<typeof ScheduleBodySchema>;
export type PreferencesBody = z.output<typeof PreferencesBodySchema>;
export type VersionBody = z.output<typeof VersionBodySchema>;
export type Document = z.output<typeof DocumentSchema>;
