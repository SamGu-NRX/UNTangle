/**
 * Which schedule the extension reads and adds to. An extension grant is bound
 * to the account's Main, not to one document: each preview and add names a
 * term, and the schedule is that term's Main, picked by the web planner's own
 * rule (pickPlannerDocument). A preview checks, and an add writes, the
 * document Week shows for that term.
 */
import { ScheduleBodySchema, type DocumentKind, type ScheduleBody } from "../../../../packages/contracts/src/documents";
import { pickPlannerDocument } from "@/lib/planner-documents";

/**
 * The schedule a device grant names. The extension sends it to device/start
 * (SCHEDULE_ID in extension/src/config.ts on edge) and echoes it as each
 * command's scheduleId. It names the Main role; grants approved before the
 * role existed carry the same value, so they mean it too.
 */
export const MAIN_SCHEDULE_ROLE = "main";

/**
 * One stored document, as far as picking Main needs. `body` is set for a live
 * schedule only: it is null for a deleted document, and for other kinds,
 * whose bodies the pick never reads.
 */
export type StoredDocumentEntry = { documentId: string; kind: DocumentKind; revision: number; body: unknown };

export type TermMain = {
  /** The document to read and write: the live Main, or the id the web planner gives a new one. */
  documentId: string;
  /** Main's body and revision; null when the account has no Main for the term yet. */
  schedule: { body: ScheduleBody; revision: number } | null;
};

/**
 * The term's Main among the account's documents. A stored Main whose body
 * fails the contract throws: the server wrote it, so it is a server fault (or
 * a newer build's body) and the boundary answers 503, never a verdict.
 */
export function termMain(documents: readonly StoredDocumentEntry[], termId: string): TermMain {
  const { id, document } = pickPlannerDocument(documents, "schedule", termId, (entry) => entry.body);
  if (!document) return { documentId: id, schedule: null };
  return { documentId: id, schedule: { body: ScheduleBodySchema.parse(document.body), revision: document.revision } };
}
