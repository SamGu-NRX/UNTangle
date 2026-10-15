import { and, desc, eq, lt, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { DocumentSchema, DocumentKindSchema } from "../../../../packages/contracts/src/documents";
import { PullListSchema, ReceiptSchema, VersionListPageSchema } from "../../../../packages/contracts/src/sync";
import { documents, receipts, versions, users, schema } from "@/lib/db/schema";
import { decideWrite, parseWrite, SyncError, type CurrentDocument } from "./decision";
import { decodePage, encodePage } from "./pagination";
import { ensureLegacyMigrated } from "./legacy-migration";

// A fixed bound keeps history reads small. 50 is an unmeasured starting page size.
const VERSION_PAGE_SIZE = 50;

export function documentRepository(db: NodePgDatabase<typeof schema>) {
  /**
   * Moves the user's legacy row into documents, in its own committed
   * transaction, before any read or write of them. Every route does it: a
   * write can arrive before a successful pull, and a refused write must not
   * roll the migration back and leave its documents unreadable.
   */
  const migrated = (userId: string) =>
    ensureLegacyMigrated(db, userId, async (tx) => {
      const [owner] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
      return owner !== undefined;
    });

  return {
    async write(userId: string, bytes: Uint8Array, documentId: string) {
      const { write, writeSha256 } = parseWrite(bytes);
      if (write.documentId !== documentId) throw new SyncError(400, "ID_MISMATCH", "The URL and write must name the same document.");
      await migrated(userId);
      return db.transaction(async (tx) => {
        // Lock a row that exists even for a first write. All writes for one user
        // serialize, including concurrent operation ids targeting different documents.
        // userId comes only from the verified session, never the request body.
        const [owner] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
        if (!owner) throw new SyncError(401, "UNAUTHORIZED", "Sign in to sync documents.");
        const [savedReceipt] = await tx.select().from(receipts).where(and(eq(receipts.userId, userId), eq(receipts.operationId, write.operationId)));
        const receipt = savedReceipt ? ReceiptSchema.parse(savedReceipt) : null;
        // Replays need no document read, and still work after later edits or deletion.
        if (receipt) {
          const replay = decideWrite({ write, writeSha256, receipt, current: null });
          if (replay.kind === "replay") return replay.receipt;
        }
        const [document] = await tx.select().from(documents).where(and(eq(documents.userId, userId), eq(documents.id, documentId)));
        const [version] = document ? [] : await tx.select().from(versions).where(and(eq(versions.userId, userId), eq(versions.id, documentId)));
        const current: CurrentDocument | null = document
          ? { ...document, kind: DocumentKindSchema.parse(document.kind) }
          : version ? { kind: "version", revision: 1, institutionId: version.institutionId, deleted: false } : null;
        const decision = decideWrite({ write, writeSha256, receipt: null, current });
        if (decision.kind === "replay") return decision.receipt;
        if (decision.kind === "version") {
          await tx.insert(versions).values({ userId, id: documentId, institutionId: decision.body.institutionId,
            scheduleId: decision.body.scheduleId, reason: decision.body.reason, body: decision.body });
        } else {
          const values = { institutionId: decision.institutionId, revision: decision.revision,
            body: decision.body, deleted: decision.deleted, updatedAt: new Date() };
          if (document) {
            await tx.update(documents).set(values).where(and(eq(documents.userId, userId), eq(documents.id, documentId)));
          } else {
            await tx.insert(documents).values({ userId, id: documentId, kind: write.kind, ...values });
          }
        }
        const committed = ReceiptSchema.parse({ userId, operationId: write.operationId, writeSha256,
          committedRevision: decision.kind === "version" ? 1 : decision.revision });
        await tx.insert(receipts).values(committed);
        return committed;
      }, { isolationLevel: "read committed" });
    },

    async get(userId: string, documentId: string) {
      await migrated(userId);
      const [document] = await db.select().from(documents).where(and(eq(documents.userId, userId), eq(documents.id, documentId)));
      if (document) {
        if (document.deleted) throw new SyncError(404, "NOT_FOUND", "The document does not exist.");
        return DocumentSchema.parse({ documentId, kind: document.kind, revision: document.revision, schemaVersion: 1, body: document.body });
      }
      const [version] = await db.select().from(versions).where(and(eq(versions.userId, userId), eq(versions.id, documentId)));
      if (!version) throw new SyncError(404, "NOT_FOUND", "The document does not exist.");
      return DocumentSchema.parse({ documentId, kind: "version", revision: 1, schemaVersion: 1, body: version.body });
    },

    async pull(userId: string) {
      await migrated(userId);
      const rows = await db.select({ documentId: documents.id, kind: documents.kind, revision: documents.revision, deleted: documents.deleted })
        .from(documents).where(eq(documents.userId, userId)).orderBy(documents.id);
      return PullListSchema.parse(rows);
    },

    async listVersions(userId: string, scheduleId: string | null, page: string | null) {
      const cursor = decodePage(page, scheduleId);
      const rows = await db.select({ documentId: versions.id, scheduleId: versions.scheduleId, reason: versions.reason, createdAt: versions.createdAt })
        .from(versions).where(and(eq(versions.userId, userId), scheduleId === null ? undefined : eq(versions.scheduleId, scheduleId),
          cursor ? or(lt(versions.createdAt, cursor.createdAt), and(eq(versions.createdAt, cursor.createdAt), lt(versions.id, cursor.id))) : undefined))
        .orderBy(desc(versions.createdAt), desc(versions.id)).limit(VERSION_PAGE_SIZE + 1);
      const shown = rows.slice(0, VERSION_PAGE_SIZE);
      const last = shown.at(-1);
      return VersionListPageSchema.parse({
        versions: shown.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
        nextPage: rows.length > VERSION_PAGE_SIZE && last ? encodePage({ id: last.documentId, createdAt: last.createdAt }, scheduleId) : null,
      });
    },
  };
}

export type DocumentRepository = ReturnType<typeof documentRepository>;
