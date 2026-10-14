import { effectiveTranscriptRecord } from "../transcript-import";
import type { TranscriptCourseRecord } from "../types";

/**
 * The import's review step as data (DESIGN.md §4.1 `review`): rows the
 * parser could not settle come first under "To check", the rest sit under
 * their term, and each row carries one fact. Pure, so the grouping, the
 * saved selection and the credit line are tested once.
 */

/** What the student chose for a row under "To check". No entry means not chosen, which saves nothing. */
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

/** The records "Looks right" applies: every settled row, plus each checked row the student counted. */
export function importSelection(
  records: readonly TranscriptCourseRecord[],
  decisions: Readonly<Record<string, CheckDecision>>,
): TranscriptCourseRecord[] {
  return records.flatMap((record) => {
    if (settled(record)) return [record];
    const decision = record.reviewRequired ? decisions[record.id] : undefined;
    if (decision !== "completed" && decision !== "inProgress") return [];
    return [effectiveTranscriptRecord(record, decision)];
  });
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

/** A settled row's one fact: its grade, or that it's in progress. */
export function rowFact(record: TranscriptCourseRecord): string {
  if (record.appliedStatus === "inProgress") return "Taking";
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
