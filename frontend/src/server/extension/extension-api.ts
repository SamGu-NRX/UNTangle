/**
 * Wire schemas for the extension routes, mirroring the types and guards in the
 * extension's `extension/src/shared/extension-api.ts` on the edge branch. The
 * extension validates every response with those guards, so a schema here that
 * accepted a value the guard rejects would break the panel; the route tests
 * feed real responses through copies of the guards to pin this.
 *
 * Schemas are strict: the server never sends a field the extension doesn't
 * know, and a present optional field must satisfy the guard's bound.
 */
import { z } from "zod";
import { DocumentIdSchema, OperationIdSchema } from "../../../../packages/contracts/src/ids";

/** The extension's `isId`: up to 128 letters, digits, hyphens or underscores. */
const ExtensionIdSchema = z.string().max(128).regex(/^[A-Za-z0-9_-]+$/, "An extension id is 1 to 128 letters, digits, hyphens or underscores.");

const text = (max: number) => z.string().min(1).max(max);
const nullableText = (max: number) => z.nullable(text(max));

/** The extension's PreviewMeeting. */
export const extensionPreviewMeetingSchema = z.strictObject({
  days: text(40),
  time: nullableText(40),
  room: nullableText(40),
});

/** The extension's PreviewClash: a course by its code, or a busy time by its private label. */
export const extensionPreviewClashSchema = z.strictObject({
  kind: z.enum(["course", "busy"]),
  name: text(80),
  when: text(80),
});

export const extensionUnknownReasonSchema = z.enum(["no-set-time", "schedule-time-missing", "schedule-unavailable"]);

/** The extension's Preview. Grades are absent: the extension fetches grade history itself. */
export const extensionPreviewSchema = z.strictObject({
  scheduleId: ExtensionIdSchema,
  optionId: ExtensionIdSchema,
  revision: z.int().min(0),
  /** The course code, "CSCE 1030". */
  title: text(160),
  conflict: z.enum(["conflict", "clear", "unknown"]),
  details: z.array(z.string().max(500)).max(30),
  section: text(12).optional(),
  meetings: z.array(extensionPreviewMeetingSchema).max(8).optional(),
  clashes: z.array(extensionPreviewClashSchema).max(12).optional(),
  unknownReason: extensionUnknownReasonSchema.optional(),
  /** The section is already in Main. */
  inSchedule: z.boolean().optional(),
});

/** The extension's AddOptionCommand, in its exact five-key wire shape. */
export const extensionAddOptionCommandSchema = z
  .strictObject({
    command: z.literal("add-option"),
    operationId: OperationIdSchema,
    scheduleId: DocumentIdSchema,
    optionId: ExtensionIdSchema,
    /** The schedule revision the student saw when they confirmed. */
    expectedRevision: z.int().min(0),
  });

/** The extension's AddReply: either a write receipt or a command rejection. */
export const extensionAddReplySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("receipt"), operationId: OperationIdSchema, committedRevision: z.int().min(1) }),
  z.strictObject({
    kind: z.literal("rejection"),
    operationId: OperationIdSchema,
    reason: z.enum(["stale-revision", "not-found", "forbidden"]),
  }),
]);

export type ExtensionPreview = z.output<typeof extensionPreviewSchema>;
export type ExtensionPreviewMeeting = z.output<typeof extensionPreviewMeetingSchema>;
export type ExtensionPreviewClash = z.output<typeof extensionPreviewClashSchema>;
export type ExtensionAddOptionCommand = z.output<typeof extensionAddOptionCommandSchema>;
export type ExtensionAddReply = z.output<typeof extensionAddReplySchema>;
export { ExtensionIdSchema };
