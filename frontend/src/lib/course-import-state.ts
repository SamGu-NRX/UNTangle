import { parseCourseImportText, type CourseImportResult } from "@/lib/course-import";
import type { CourseStatus } from "@/lib/types";

/**
 * Pure review-state contract for the text import panel.
 *
 * The parser/catalog remain the only authority on course identity: unknown
 * codes come back as explicit unresolved entries, never fabricated into
 * matched courses. Kept separate from the component so the review flow is
 * testable without a DOM.
 */

export type ImportReviewState = {
  /** The user's pasted text — never wiped by a review, so it stays correctable. */
  text: string | null;
  result: CourseImportResult | null;
  /** Set when the review found nothing to apply. */
  error: string | null;
};

export const emptyImportReviewState: ImportReviewState = {
  text: null,
  result: null,
  error: null,
};

export function beginReview(state: ImportReviewState, text: string): ImportReviewState {
  const result = parseCourseImportText(text);
  if (result.totalCodesFound === 0) {
    return {
      text,
      result,
      error:
        "No UNT-style course codes were found. Check the text and try again — your pasted text is kept.",
    };
  }
  return { text, result, error: null };
}

export function unresolvedCodes(
  result: CourseImportResult | null,
): Array<{ code: string; status: "unresolved" }> {
  if (!result) return [];
  return result.unknownCodes.map((code) => ({ code, status: "unresolved" as const }));
}

export type ImportApplyChange = {
  courseCode: string;
  status: CourseStatus;
};

/**
 * Diff the requested per-row statuses against the planner's current statuses.
 * Applying the same review twice therefore yields no second diff.
 */
export function computeImportApply(
  result: CourseImportResult | null,
  requestedStatuses: Record<string, CourseStatus>,
  currentStatuses: Record<string, CourseStatus>,
): ImportApplyChange[] {
  if (!result) return [];
  const changes: ImportApplyChange[] = [];
  for (const matched of result.matched) {
    const requested = requestedStatuses[matched.code] ?? "inProgress";
    if (currentStatuses[matched.code] !== requested) {
      changes.push({ courseCode: matched.code, status: requested });
    }
  }
  return changes;
}

/**
 * Token guard for the panel's async file reads: when a newer import starts
 * (another file chosen, or a paste reviewed mid-read), an in-flight read's
 * token goes stale and its result must be discarded instead of overwriting
 * newer review state.
 */
export class ImportReadGuard {
  private current = 0;

  begin(): number {
    this.current += 1;
    return this.current;
  }

  isStale(token: number): boolean {
    return token !== this.current;
  }
}
