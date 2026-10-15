import "server-only";
import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { PreferencesBodySchema, type Document, type PreferencesBody } from "../../../../packages/contracts/src/documents";
import { ReceiptSchema, type Receipt } from "../../../../packages/contracts/src/sync";
import { documentRepository } from "@/lib/document-sync/repository";
import { documents, receipts, schema } from "@/lib/db/schema";
import type { ExtensionStore } from "./commands";

/**
 * The Postgres store behind the extension routes. Writes delegate to
 * documentRepository, so an extension command commits with exactly the
 * compare-and-set and receipt semantics of the sync route's writes.
 */
export function extensionStore(db: NodePgDatabase<typeof schema>): ExtensionStore {
  const repository = documentRepository(db);
  return {
    getDocument: (userId, documentId): Promise<Document> => repository.get(userId, documentId),
    write: (userId, bytes, documentId) => repository.write(userId, bytes, documentId),
    async preferences(userId): Promise<PreferencesBody | null> {
      // One preferences document per user and institution; a student with
      // several picks the first by id order, the pull list's own order.
      const [row] = await db
        .select({ body: documents.body })
        .from(documents)
        .where(and(eq(documents.userId, userId), eq(documents.kind, "preferences"), eq(documents.deleted, false)))
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
