/**
 * The extension's single command, add-option, applied through the same server
 * write path document sync uses (frontend/src/lib/document-sync): a whole
 * document compare-and-set write carrying the schedule revision the student
 * saw, a receipt keyed by the operation id, and a replay that returns the
 * original reply. The extension reads documents; it never writes one its own
 * way. The route files stay a few lines, importing nothing from Next.
 */
import { ScheduleBodySchema, type Document, type PreferencesBody, type ScheduleBody } from "../../../../packages/contracts/src/documents";
import type { Receipt } from "../../../../packages/contracts/src/sync";
import { SyncError } from "@/lib/document-sync/decision";
import { extensionAddReplySchema, type ExtensionAddOptionCommand, type ExtensionAddReply } from "./extension-api";
import { sectionMatchesOptionId } from "./option-id";
import type { SectionsSource } from "./preview";

/**
 * What the extension routes need from storage. Writes go through
 * documentRepository so the receipt and compare-and-set semantics are the
 * sync route's own; the remaining reads cover the same tables the sync route
 * serves. The route wires the Postgres store; tests wire an in-memory one.
 */
export interface ExtensionStore {
  getDocument(userId: string, documentId: string): Promise<Document>;
  preferences(userId: string): Promise<PreferencesBody | null>;
  receipt(userId: string, operationId: string): Promise<Receipt | null>;
  write(userId: string, bytes: Uint8Array, documentId: string): Promise<Receipt>;
}

type RejectionReason = Extract<ExtensionAddReply, { kind: "rejection" }>["reason"];

const rejection = (operationId: string, reason: RejectionReason, status: number): CommandOutcome => ({
  status,
  body: extensionAddReplySchema.parse({ kind: "rejection", operationId, reason }),
});

export type CommandOutcome = { status: number; body: ExtensionAddReply };

/**
 * Applies one add-option command. The caller has already authenticated the
 * device grant and verified the command's scheduleId is the grant's bound
 * schedule. Rejections keep the operation uncommitted, so the extension
 * retries the same operation id after showing a fresh preview.
 */
export async function applyAddOption(
  deps: { store: ExtensionStore; sections: SectionsSource },
  identity: { userId: string; scheduleId: string },
  command: ExtensionAddOptionCommand,
): Promise<CommandOutcome> {
  const { userId, scheduleId } = identity;
  // A replay returns the original receipt before any state check, exactly as
  // the sync path's receipt lookup precedes every state check.
  const existing = await deps.store.receipt(userId, command.operationId);
  if (existing) {
    return { status: 200, body: { kind: "receipt", operationId: command.operationId, committedRevision: existing.committedRevision } };
  }

  let schedule: Document;
  try {
    schedule = await deps.store.getDocument(userId, scheduleId);
  } catch {
    return rejection(command.operationId, "not-found", 422);
  }
  if (schedule.kind !== "schedule") {
    return rejection(command.operationId, "not-found", 422);
  }
  const current = ScheduleBodySchema.safeParse(schedule.body);
  if (!current.success) return rejection(command.operationId, "not-found", 422);

  const sections = await deps.sections.termSections(current.data.termId);
  const section = sections?.find((candidate) => sectionMatchesOptionId(candidate, command.optionId)) ?? null;
  if (!section) return rejection(command.operationId, "not-found", 422);
  // Sections data belongs to UNT; a schedule of another institution can't take a UNT option.
  if (current.data.institutionId !== "unt") return rejection(command.operationId, "forbidden", 403);

  // A lock pins exactly the course's pick, so adding an option over a pinned
  // one is refused: the student lifts the pin where they pinned it.
  const locked = current.data.lockedSections[section.courseCode];
  if (locked !== undefined && locked !== section.id) return rejection(command.operationId, "forbidden", 403);

  const body: ScheduleBody = {
    ...current.data,
    courses: current.data.courses.includes(section.courseCode)
      ? current.data.courses
      : [...current.data.courses, section.courseCode],
    selectedSections: { ...current.data.selectedSections, [section.courseCode]: section.id },
  };

  const writePayload = {
    operationId: command.operationId,
    documentId: scheduleId,
    kind: "schedule" as const,
    baseRevision: command.expectedRevision,
    schemaVersion: 1 as const,
    body,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(writePayload));
  try {
    const receipt = await deps.store.write(userId, bytes, scheduleId);
    return { status: 200, body: { kind: "receipt", operationId: command.operationId, committedRevision: receipt.committedRevision } };
  } catch (error) {
    if (error instanceof SyncError && error.code === "REVISION_CONFLICT") {
      // The schedule moved on since the student confirmed. Never a silent
      // overwrite: the extension shows a fresh preview against the latest
      // revision, then the student confirms again.
      return {
        status: 409,
        body: extensionAddReplySchema.parse({ kind: "rejection", operationId: command.operationId, reason: "stale-revision" }),
      };
    }
    if (error instanceof SyncError && error.code === "OPERATION_REUSED") {
      // A concurrent retry of the same operation committed between the receipt
      // lookup and the write. The stored receipt is that operation's reply.
      const committed = await deps.store.receipt(userId, command.operationId);
      if (committed) {
        return { status: 200, body: { kind: "receipt", operationId: command.operationId, committedRevision: committed.committedRevision } };
      }
    }
    throw error;
  }
}
