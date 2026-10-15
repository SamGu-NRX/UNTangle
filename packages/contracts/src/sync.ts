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
 * body. The body is any JSON value, or null to delete. `kind` says which body
 * schema applies, so the server can check a document's first write; on later
 * writes it must equal the stored document's kind, or the write is rejected.
 */
export const WriteSchema = z
  .strictObject({
    operationId: OperationIdSchema,
    documentId: DocumentIdSchema,
    kind: DocumentKindSchema,
    /** The revision the client last saw; 0 when it saw no document. */
    baseRevision: z.int().min(0),
    schemaVersion: z.literal(1),
    // z.json() also rejects a missing body, which z.unknown() would let through.
    body: z.json(),
  })
  // Versions are restore history, so they are created once and never changed or deleted.
  .superRefine((write, ctx) => {
    if (write.kind !== "version") return;
    if (write.baseRevision !== 0) {
      ctx.addIssue({ code: "custom", path: ["baseRevision"], message: "A version is only ever created, from revision 0." });
    }
    if (write.body === null) {
      ctx.addIssue({ code: "custom", path: ["body"], message: "A version can't be deleted." });
    }
  });

/** Proof that a write committed. "Synced" is shown only once one arrives. */
export const ReceiptSchema = z.strictObject({
  userId: z.string().min(1),
  operationId: OperationIdSchema,
  /**
   * Lowercase hex SHA-256 of the whole write, every field, exactly as the
   * client stored it in its outbox and resends it. Hashing the body alone
   * would let a reused operation id match a different write with the same
   * body, as every delete's null body does.
   */
  writeSha256: z.string().regex(/^[0-9a-f]{64}$/, "writeSha256 is 64 lowercase hex digits."),
  committedRevision: z.int().min(1),
});

/**
 * One line of the pull list. A deleted document keeps its line, with the
 * revision of the delete. Versions are append-only and listed separately,
 * paged (VersionListPageSchema), so they never appear here.
 */
export const PullEntrySchema = z.strictObject({
  documentId: DocumentIdSchema,
  kind: DocumentKindSchema.exclude(["version"]),
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

/**
 * One page of a student's versions, newest first, from
 * `GET /api/v1/versions?scheduleId=&page=`. A fresh device reads these pages
 * to rebuild the schedule library; each line is enough to list the version,
 * and the body is fetched by id when it's opened.
 */
export const VersionListPageSchema = z.strictObject({
  versions: z.array(
    z.strictObject({
      documentId: DocumentIdSchema,
      scheduleId: DocumentIdSchema,
      reason: z.enum(["before-auto", "restore-point", "import"]),
      createdAt: z.iso.datetime(),
    }),
  ),
  /** Opaque; null on the last page. */
  nextPage: z.string().min(1).max(512).nullable(),
});

/**
 * Header a browser client sends with the account it is syncing for. The
 * browser attaches whichever session cookie it holds now, so a tab still
 * syncing for a student who signed out could otherwise read or write as the
 * next one. The server refuses a request whose header names another account.
 */
export const ACCOUNT_HEADER = "x-untangle-account";

export type Write = z.output<typeof WriteSchema>;
export type Receipt = z.output<typeof ReceiptSchema>;
export type PullEntry = z.output<typeof PullEntrySchema>;
export type PullList = z.output<typeof PullListSchema>;
export type VersionListPage = z.output<typeof VersionListPageSchema>;
