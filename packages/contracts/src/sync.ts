/**
 * The sync protocol's messages from docs/architecture/README.md ("Saved
 * state: documents with receipts"): a whole-document compare-and-set write,
 * the receipt that confirms it, and the pull list.
 */
import { z } from "zod";
import { DocumentKindSchema } from "./documents";
import { DocumentIdSchema, OperationIdSchema } from "./ids";

/**
 * One write to one document. A retry sends the same operationId and the same
 * body. The body is any JSON value, or null to delete. It is checked against
 * its kind's schema (documentBodySchemas) once the server knows the kind.
 */
export const WriteSchema = z.strictObject({
  operationId: OperationIdSchema,
  documentId: DocumentIdSchema,
  /** The revision the client last saw; 0 when it saw no document. */
  baseRevision: z.int().min(0),
  schemaVersion: z.literal(1),
  // z.json() also rejects a missing body, which z.unknown() would let through.
  body: z.json(),
});

/** Proof that a write committed. "Synced" is shown only once one arrives. */
export const ReceiptSchema = z.strictObject({
  userId: z.string().min(1),
  operationId: OperationIdSchema,
  /** Lowercase hex SHA-256 of the exact body bytes the client stored in its outbox. */
  bodySha256: z.string().regex(/^[0-9a-f]{64}$/, "bodySha256 is 64 lowercase hex digits."),
  committedRevision: z.int().min(1),
});

/** One line of the pull list. A deleted document keeps its line, with the revision of the delete. */
export const PullEntrySchema = z.strictObject({
  documentId: DocumentIdSchema,
  kind: DocumentKindSchema,
  revision: z.int().min(1),
  deleted: z.boolean(),
});

/** Every document the student has, one line each. There is no cursor. */
export const PullListSchema = z.array(PullEntrySchema).superRefine((entries, ctx) => {
  const seen = new Set<string>();
  entries.forEach((entry, index) => {
    if (seen.has(entry.documentId)) {
      ctx.addIssue({ code: "custom", path: [index, "documentId"], message: `${entry.documentId} is listed twice.` });
    }
    seen.add(entry.documentId);
  });
});

export type Write = z.output<typeof WriteSchema>;
export type Receipt = z.output<typeof ReceiptSchema>;
export type PullEntry = z.output<typeof PullEntrySchema>;
export type PullList = z.output<typeof PullListSchema>;
