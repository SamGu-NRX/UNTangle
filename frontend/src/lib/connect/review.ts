import { effectiveTranscriptRecord } from "../transcript-import";
import type { TranscriptCourseRecord } from "../types";

/**
 * The import's review step as data (DESIGN.md §4.1 `review`): rows the
 * parser could not settle come first under "To check", the rest sit under
 * their term, and each row carries one fact. Pure, so the grouping, the
 * saved selection and the credit line are tested once.
 */

/**
 * What the student chose for a row. Under "To check" no entry means not
 * chosen, which saves nothing; on any other row no entry keeps the parser's
 * reading, and a choice corrects it.
 */
export type CheckDecision = "completed" | "inProgress" | "ignored";

export type TermGroup = { term: string; records: TranscriptCourseRecord[] };
export type ReviewGroups = { toCheck: TranscriptCourseRecord[]; terms: TermGroup[] };

/** Settled rows that count: the parser's call stands, so "Looks right" saves them. */
function settled(record: TranscriptCourseRecord): boolean {
  return !record.reviewRequired && (record.appliedStatus === "completed" || record.appliedStatus === "inProgress");
}

/**
 * "To check" first, then one group per term in the order the records come
 * (reconcileTranscriptCourses sorts them oldest term first). A settled row
 * the import would not save (excluded or ignored) is left out: it would be
 * a row that changes nothing.
 */
export function reviewGroups(records: readonly TranscriptCourseRecord[]): ReviewGroups {
  const toCheck = records.filter((record) => record.reviewRequired);
  const terms: TermGroup[] = [];
  for (const record of records) {
    if (!settled(record)) continue;
    const group = terms.find((entry) => entry.term === record.term);
    if (group) group.records.push(record);
    else terms.push({ term: record.term, records: [record] });
  }
  return { toCheck, terms };
}

/** The records "Looks right" applies: settled rows as read or as corrected, plus each checked row the student counted. */
export function importSelection(
  records: readonly TranscriptCourseRecord[],
  decisions: Readonly<Record<string, CheckDecision>>,
): TranscriptCourseRecord[] {
  return records.flatMap((record) => {
    const decision = decisions[record.id];
    if (decision === "ignored") return [];
    if (decision === "completed" || decision === "inProgress") {
      // The student settled this row. effectiveTranscriptRecord keeps a record whose
      // status already matched, flag and all, and a flagged record counts as no evidence.
      return [{ ...effectiveTranscriptRecord(record, decision), reviewRequired: false }];
    }
    return settled(record) ? [record] : [];
  });
}

/** What a row will be saved as, for its fact and its choice: a correction, else the parser's reading. */
export function decisionOf(record: TranscriptCourseRecord, decisions: Readonly<Record<string, CheckDecision>>): CheckDecision | null {
  const chosen = decisions[record.id];
  if (chosen) return chosen;
  if (record.reviewRequired) return null;
  return record.appliedStatus === "completed" || record.appliedStatus === "inProgress" ? record.appliedStatus : null;
}

/**
 * The one line under the heading: credits done and in progress across what
 * will be saved. Null when any saved row has no credit figure, because a
 * total that silently skips rows would be wrong, or when nothing is saved.
 */
export function creditLine(selection: readonly TranscriptCourseRecord[]): string | null {
  if (!selection.length || selection.some((record) => record.credits === null)) return null;
  const sum = (status: TranscriptCourseRecord["appliedStatus"]) =>
    selection.filter((record) => record.appliedStatus === status).reduce((total, record) => total + (record.credits ?? 0), 0);
  const done = sum("completed");
  const taking = sum("inProgress");
  const credits = (n: number) => `${formatCredits(n)} ${n === 1 ? "credit" : "credits"}`;
  if (done && taking) return `${credits(done)} done and ${formatCredits(taking)} in progress.`;
  if (done) return `${credits(done)} done.`;
  return `${credits(taking)} in progress.`;
}

/** Transcripts give credits as 3.000; half credits exist, so keep a fraction only when there is one. */
function formatCredits(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** "2025 Fall" (how the transcript prints it) as people say it: "Fall 2025". */
export function termLabel(term: string): string {
  const match = /^(\d{4})\s+(Fall|Spring|Summer|Winter)$/i.exec(term.trim());
  return match ? `${match[2][0].toUpperCase()}${match[2].slice(1).toLowerCase()} ${match[1]}` : term;
}

/** A row's one fact: its grade, that it's in progress, or that it won't be saved. */
export function rowFact(record: TranscriptCourseRecord, decision: CheckDecision | null = decisionOf(record, {})): string {
  if (decision === "ignored") return "Skipped";
  if (decision === "inProgress") return "Taking";
  return record.grade ? `Grade ${record.grade}` : "Done";
}

/**
 * Why a row is under "To check", in a few words. Keyed on the reasons
 * transcript-import's classifier gives; any other reason is shown as it is.
 */
const CHECK_REASONS: Record<string, (record: TranscriptCourseRecord) => string> = {
  "Not in the planner catalog.": () => "Not in the UNT catalog",
  "Transcript marks this row as duplicate or excluded.": () => "Marked as a repeat",
  "Grade does not indicate completed credit.": (record) => `Grade ${record.grade || "missing"} earns no credit`,
  "D can count as completed credit, but may not satisfy C-or-better prerequisites.": () =>
    "A D may not meet prerequisites",
  "P counts as credit, but some major requirements may require advisor validation.": () => "A pass may need an advisor",
  "Found the course code, but not its grade or term. Check both before adding it.": () => "Grade and term not found",
  "Grade or status needs review before it can be applied.": () => "Grade unclear",
  // These three reach "To check" only when the row was read with low confidence.
  "Letter grade or credit marker satisfies completed credit.": () => "Row was hard to read",
  "Accepted transfer or exam credit counts as completed credit.": () => "Row was hard to read",
  "Transcript indicates the course is currently enrolled or in progress.": () => "Row was hard to read",
};

export function checkReason(record: TranscriptCourseRecord): string {
  return CHECK_REASONS[record.rationale]?.(record) ?? record.rationale;
}

/** Approved records the plan no longer holds as approved: a newer saved version replaced them. */
export function missingApprovedRecords(
  approved: readonly TranscriptCourseRecord[],
  current: readonly TranscriptCourseRecord[],
): TranscriptCourseRecord[] {
  const byId = new Map(current.map((record) => [record.id, record]));
  return approved.filter((record) => byId.get(record.id)?.appliedStatus !== record.appliedStatus);
}

/** The planner's save states (planner-provider's PlannerSaveStatus). */
export type SaveStatus = "saving" | "saved" | "pending" | "not-saved" | "failed" | "signed-out";

/**
 * Where an import stands after "Looks right" (#37's honest-save rule: never
 * report success before the save has):
 * - `saved`: the approved courses are in the plan and the plan is stored;
 * - `waiting`: they are in the plan and the save is still on its way;
 * - `conflict`: another tab or device saved a newer version first, and the
 *   student has to choose one before anything saves;
 * - `dropped`: a newer version was adopted without some approved courses;
 * - `unsaved`: the save failed, storage refused it, or the session ended.
 */
export type ImportSaveOutcome = "saved" | "waiting" | "conflict" | "dropped" | "unsaved";

export function importSaveOutcome({
  approved,
  current,
  status,
  conflict,
}: {
  approved: readonly TranscriptCourseRecord[];
  current: readonly TranscriptCourseRecord[];
  status: SaveStatus;
  conflict: boolean;
}): ImportSaveOutcome {
  if (conflict) return "conflict";
  if (missingApprovedRecords(approved, current).length) return "dropped";
  if (status === "saved") return "saved";
  if (status === "saving" || status === "pending") return "waiting";
  return "unsaved";
}
