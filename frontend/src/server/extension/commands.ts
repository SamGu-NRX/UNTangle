/**
 * The extension's single command, add-option, applied through the same server
 * write path document sync uses (frontend/src/lib/document-sync): a whole
 * document compare-and-set write carrying the schedule revision the student
 * saw, a receipt keyed by the operation id, and a replay that returns the
 * original reply. The extension reads documents; it never writes one its own
 * way. The route files stay a few lines, importing nothing from Next.
 *
 * The add lands in the Main of the option's own term (main-schedule.ts), and
 * creates that Main when the account has none yet, with the id and body the
 * web planner's first write would use.
 */
import type { PreferencesBody, ScheduleBody } from "../../../../packages/contracts/src/documents";
import type { Receipt } from "../../../../packages/contracts/src/sync";
import { SyncError } from "@/lib/document-sync/decision";
import { emptyMainSchedule } from "@/lib/planner-documents";
import { extensionAddReplySchema, type ExtensionAddOptionCommand, type ExtensionAddReply } from "./extension-api";
import { termMain, type StoredDocumentEntry } from "./main-schedule";
import { parseExtensionOptionId, sectionMatchesOptionId } from "./option-id";
import type { SectionsSource } from "./preview";

/**
 * What the extension routes need from storage. Writes go through
 * documentRepository so the receipt and compare-and-set semantics are the
 * sync route's own; the remaining reads cover the same tables the sync route
 * serves. The route wires the Postgres store; tests wire an in-memory one.
 */
export interface ExtensionStore {
  /** Every document the account has stored, deleted ones included: what picking a term's Main reads. */
  documents(userId: string): Promise<StoredDocumentEntry[]>;
  /** The user's preferences for one institution, or null when there are none. */
  preferences(userId: string, institutionId: string): Promise<PreferencesBody | null>;
  receipt(userId: string, operationId: string): Promise<Receipt | null>;
  write(userId: string, bytes: Uint8Array, documentId: string): Promise<Receipt>;
}

type RejectionReason = Extract<ExtensionAddReply, { kind: "rejection" }>["reason"];

const rejection = (operationId: string, reason: RejectionReason, status: number): CommandOutcome => ({
  status,
  body: extensionAddReplySchema.parse({ kind: "rejection", operationId, reason }),
});

export type CommandOutcome = { status: number; body: ExtensionAddReply };

/** The schedule body with the option applied as the course's pick. */
function scheduleWithOption(current: ScheduleBody, option: { courseCode: string; id: string }): ScheduleBody {
  return {
    ...current,
    courses: current.courses.includes(option.courseCode) ? current.courses : [...current.courses, option.courseCode],
    selectedSections: { ...current.selectedSections, [option.courseCode]: option.id },
  };
}

/** The whole-document write the command commits: the schedule body with the
 * option applied, at the revision the student confirmed (0 for a Main the
 * write creates). */
function buildWritePayload(command: ExtensionAddOptionCommand, scheduleId: string, body: ScheduleBody) {
  return {
    operationId: command.operationId,
    documentId: scheduleId,
    kind: "schedule" as const,
    baseRevision: command.expectedRevision,
    schemaVersion: 1 as const,
    body,
  };
}

/**
 * Answers a retry whose operation id already has a stored receipt. The
 * extension mints a fresh crypto.randomUUID() for every confirmed add
 * (extension/src/lib/worker-controller.ts on edge) and reuses one only to
 * resend the same queued command after a transport failure or a 503, so a
 * reused operation id is either the genuine retry of the command the receipt
 * committed, or a client bug. The revision relationship tells them apart: the
 * original write committed exactly one revision past the command's expected
 * revision, so a receipt that does not satisfy
 * committedRevision === expectedRevision + 1 belongs to a different command
 * and is refused with the client's own forbidden rejection. A retry that fits
 * the relationship is answered with the original receipt even though the
 * schedule has since moved on — the add committed and only its response was
 * lost. While the option term's Main still stands at the committed revision,
 * the command's option must be the pick recorded for its course; anything
 * else gets the forbidden rejection. (Postgres stores document bodies as
 * jsonb, which re-sorts object keys, so rebuilt write bytes cannot be
 * compared against the receipt's hash.)
 *
 * An option id without a term names no Main to look in, as when the schedule
 * has moved on, so only the revision relationship checks it. This build never
 * commits such an id; its receipt can only be an older build's commit.
 */
async function verifiedReplay(
  deps: { store: ExtensionStore; sections: SectionsSource },
  userId: string,
  command: ExtensionAddOptionCommand,
  receipt: Receipt,
): Promise<CommandOutcome> {
  const refuse = () => rejection(command.operationId, "forbidden", 409);
  if (receipt.committedRevision !== command.expectedRevision + 1) return refuse();
  const option = parseExtensionOptionId(command.optionId);
  // A Main deleted since the commit is no longer live, so there is nothing to check; the receipt still answers.
  const main = option ? termMain(await deps.store.documents(userId), option.term).schedule : null;
  if (option && main && main.revision === receipt.committedRevision) {
    const sections = await deps.sections.termSections(option.term);
    // Unavailable term data is no verdict: the boundary answers 503 and the extension retries.
    if (sections === null) throw new Error("Term sections are unavailable.");
    const section = sections.find((candidate) => sectionMatchesOptionId(candidate, command.optionId)) ?? null;
    if (!section) return refuse();
    // jsonb re-sorts object keys on the way through Postgres, so the rebuilt
    // write bytes cannot reproduce the receipt's hash even for the identical
    // command. The check the hash stood for is the committed effect: the
    // command's option is the pick recorded for its course.
    if (main.body.selectedSections[section.courseCode] !== section.id) return refuse();
  }
  return { status: 200, body: { kind: "receipt", operationId: command.operationId, committedRevision: receipt.committedRevision } };
}

/**
 * Applies one add-option command. The caller has already authenticated the
 * device grant and checked that it is bound to the Main role. Rejections keep
 * the operation uncommitted; after one, the student confirms again from a
 * fresh preview, under a new operation id.
 */
export async function applyAddOption(
  deps: { store: ExtensionStore; sections: SectionsSource },
  userId: string,
  command: ExtensionAddOptionCommand,
): Promise<CommandOutcome> {
  // A replay returns the original receipt before any state check, exactly as
  // the sync path's receipt lookup precedes every state check — but only for
  // the command the receipt actually committed.
  const existing = await deps.store.receipt(userId, command.operationId);
  if (existing) return verifiedReplay(deps, userId, command, existing);

  // The option's term is the term the student saw on class search, and it
  // picks the Main the add goes to. An id without one (an older preview's)
  // can't say which Main, so it names no option this command can add.
  const option = parseExtensionOptionId(command.optionId);
  if (!option) return rejection(command.operationId, "not-found", 422);
  // A storage failure here is not the command's answer: it reaches the HTTP
  // boundary's 503, and the extension retries later.
  const main = termMain(await deps.store.documents(userId), option.term);
  // The write below is built from this read, so it must be the revision the
  // student confirmed: a compare-and-set on the expected revision alone would
  // commit this older body over a write that landed after the read. A term
  // with no Main yet stands at revision 0, the revision its preview showed.
  if ((main.schedule?.revision ?? 0) !== command.expectedRevision) return rejection(command.operationId, "stale-revision", 409);

  const sections = await deps.sections.termSections(option.term);
  // Unavailable term data is no verdict on the option: the HTTP boundary
  // answers 503 and the extension retries.
  if (sections === null) throw new Error("Term sections are unavailable.");
  const section = sections.find((candidate) => sectionMatchesOptionId(candidate, command.optionId)) ?? null;
  if (!section) return rejection(command.operationId, "not-found", 422);
  // The term's first add creates its Main, with the body the web planner's first write gives it.
  const current = main.schedule?.body ?? emptyMainSchedule(option.term);
  // Sections data belongs to UNT; a schedule of another institution can't take a UNT option.
  if (current.institutionId !== "unt") return rejection(command.operationId, "forbidden", 403);

  // A lock pins exactly the course's pick, so adding an option over a pinned
  // one is refused: the student lifts the pin where they pinned it.
  const locked = current.lockedSections[section.courseCode];
  if (locked !== undefined && locked !== section.id) return rejection(command.operationId, "forbidden", 403);

  const writePayload = buildWritePayload(command, main.documentId, scheduleWithOption(current, section));
  const bytes = new TextEncoder().encode(JSON.stringify(writePayload));
  try {
    const receipt = await deps.store.write(userId, bytes, main.documentId);
    return { status: 200, body: { kind: "receipt", operationId: command.operationId, committedRevision: receipt.committedRevision } };
  } catch (error) {
    if (error instanceof SyncError && error.code === "REVISION_CONFLICT") {
      // The schedule moved on since the student confirmed, or another device
      // created this term's Main first. Never a silent overwrite: the
      // extension shows a fresh preview against the latest revision, then
      // the student confirms again.
      return rejection(command.operationId, "stale-revision", 409);
    }
    if (error instanceof SyncError && error.code === "DOCUMENT_DELETED") {
      // Main was deleted between the read and the commit, and a deleted id is
      // never reused. The next preview reads the term as having no Main and
      // offers the add again, to a new document.
      return rejection(command.operationId, "stale-revision", 409);
    }
    if (error instanceof SyncError && error.code === "OPERATION_REUSED") {
      // A concurrent write between the receipt lookup and the commit already
      // stored different bytes under this operation id. The extension mints a
      // fresh operation id for every confirmed add, so reuse is a client bug:
      // the stored receipt is not this command's reply, and the reply is the
      // client's own forbidden rejection.
      return rejection(command.operationId, "forbidden", 409);
    }
    throw error;
  }
}
