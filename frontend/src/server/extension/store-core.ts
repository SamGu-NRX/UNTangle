import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { PreferencesBodySchema, type PreferencesBody } from "../../../../packages/contracts/src/documents";
import { ReceiptSchema, type Receipt } from "../../../../packages/contracts/src/sync";
import { documentRepository } from "@/lib/document-sync/repository";
import { documents, receipts, schema } from "@/lib/db/schema";
import type { ExtensionStore } from "./commands";
import type { StoredDocumentEntry } from "./main-schedule";

/**
 * The Postgres store behind the extension routes, without the server-only
 * import: the live-Postgres tests build this exact store against a real
 * database, and a server-only import throws under the test runner before the
 * opt-in cases can even skip. The route-facing module store.ts adds the
 * server-only guard around this factory.
 *
 * Writes delegate to documentRepository, so an extension command commits with
 * exactly the compare-and-set and receipt semantics of the sync route's
 * writes.
 */
export function extensionStore(db: NodePgDatabase<typeof schema>): ExtensionStore {
  const repository = documentRepository(db);
  return {
    write: (userId, bytes, documentId) => repository.write(userId, bytes, documentId),
    async documents(userId): Promise<StoredDocumentEntry[]> {
      // The pull list moves a legacy row into documents first, as every
      // repository read does, and names every id the account has stored,
      // deleted ones included.
      const listed = await repository.pull(userId);
      // Revision and body come from one read, so the revision an add compares
      // is the one its body was built from.
      const live = await db
        .select({ id: documents.id, revision: documents.revision, body: documents.body })
        .from(documents)
        .where(and(eq(documents.userId, userId), eq(documents.kind, "schedule"), eq(documents.deleted, false)));
      const schedules = new Map(live.map((row) => [row.id, row]));
      return listed.map((entry) => {
        const schedule = schedules.get(entry.documentId);
        return schedule
          ? { documentId: entry.documentId, kind: entry.kind, revision: schedule.revision, body: schedule.body }
          : { documentId: entry.documentId, kind: entry.kind, revision: entry.revision, body: null };
      });
    },
    async preferences(userId, institutionId): Promise<PreferencesBody | null> {
      // One preferences document per user and institution; a student with
      // several picks the first by id order, the pull list's own order.
      // The column is the body's institutionId, copied on every write.
      const [row] = await db
        .select({ body: documents.body })
        .from(documents)
        .where(and(
          eq(documents.userId, userId), eq(documents.kind, "preferences"),
          eq(documents.institutionId, institutionId), eq(documents.deleted, false),
        ))
        .orderBy(documents.id);
      const parsed = PreferencesBodySchema.safeParse(row?.body);
      return parsed.success ? parsed.data : null;
    },
    async receipt(userId, operationId): Promise<Receipt | null> {
      const [row] = await db
        .select()
        .from(receipts)
        .where(and(eq(receipts.userId, userId), eq(receipts.operationId, operationId)));
      return row ? ReceiptSchema.parse(row) : null;
    },
  };
}
