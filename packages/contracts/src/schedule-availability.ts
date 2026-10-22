import { z } from "zod";
import { CourseCodeSchema, DocumentIdSchema, InstitutionIdSchema, TermIdSchema } from "./ids";

export const SeatAvailabilitySchema = z.enum(["open", "full", "closed", "waitlist", "cancelled", "unknown"]);
export type SeatAvailability = z.output<typeof SeatAvailabilitySchema>;

const SeatsSchema = z.strictObject({ open: z.int().min(0).nullable(), total: z.int().min(0).nullable() });

export const AvailabilitySectionSchema = z.strictObject({
  id: z.string().min(1),
  sectionCode: z.string(),
  classNumbers: z.array(z.string()),
  status: z.enum(["open", "closed", "waitlist", "cancelled", "unknown"]),
  seats: SeatAvailabilitySchema,
  components: z.array(z.strictObject({
    classNumber: z.string().nullable(),
    sectionCode: z.string(),
    role: z.enum(["primary", "required-linked"]),
    seats: SeatsSchema,
  })),
});
export type AvailabilitySection = z.output<typeof AvailabilitySectionSchema>;

const EvidenceSchema = z.strictObject({
  checkedAt: z.string(),
  provenance: z.strictObject({ kind: z.literal("real"), source: z.literal("vsb.untgrades.app"), updatedAt: z.string(), note: z.string() }),
});
const selection = { courseCode: CourseCodeSchema, selectedSectionId: z.string().min(1) };

export const CourseAvailabilitySchema = z.discriminatedUnion("state", [
  z.strictObject({ courseCode: CourseCodeSchema, selectedSectionId: z.null(), state: z.literal("unselected"), evidence: z.null(), section: z.null() }),
  z.strictObject({ ...selection, state: z.enum(["unsupported-course", "unavailable", "sample"]), evidence: z.null(), section: z.null() }),
  z.strictObject({ ...selection, state: z.literal("stale"), evidence: EvidenceSchema, section: AvailabilitySectionSchema.nullable() }),
  z.strictObject({ ...selection, state: z.literal("missing"), evidence: EvidenceSchema, section: z.null() }),
  z.strictObject({ ...selection, state: SeatAvailabilitySchema, evidence: EvidenceSchema, section: AvailabilitySectionSchema }),
]);
export type CourseAvailability = z.output<typeof CourseAvailabilitySchema>;

export const ScheduleAvailabilitySchema = z.strictObject({
  documentId: DocumentIdSchema,
  revision: z.int().min(1),
  institutionId: InstitutionIdSchema,
  termId: TermIdSchema,
  /** Describes source seat evidence, never permission to enroll. */
  summary: z.enum(["empty", "open", "needs-attention", "unknown"]),
  courses: z.array(CourseAvailabilitySchema),
});
export type ScheduleAvailability = z.output<typeof ScheduleAvailabilitySchema>;
