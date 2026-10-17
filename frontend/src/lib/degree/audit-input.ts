/**
 * Turns a student's academic record into the degree audit's input. The
 * signed-in audit route and Courses in the browser both call it, so a guest
 * and a signed-in student get the same audit from the same rows. It imports
 * only types and the term chronology, so it runs in the browser.
 */
import type { AuditCourse } from "@untangle/core/degree/audit";
import type { DegreeData } from "@untangle/core/degree/types";
import type { TranscriptCourseRecord } from "@/lib/types";
import { parseAcademicTerm } from "@/lib/term-chronology";

/** The transcript row fields the mapping reads. */
export type AuditTranscriptRow = Pick<TranscriptCourseRecord, "code" | "term" | "grade" | "credits" | "sourceKind" | "appliedStatus" | "duplicateExcluded" | "reviewRequired">;

export type AuditInput =
  /** The record follows another catalog year; it is not audited against this one. */
  | { ok: false; error: string }
  | { ok: true; attempts: AuditCourse[]; warnings: string[] };

/**
 * A row's place in time for the engine's "latest attempt" reads, in the
 * planner's chronology (@/lib/term-chronology): Spring, Summer, Fall, Winter
 * within a year, and a term it cannot read after every known term.
 */
function termRank(term: string): number {
  const parsed = parseAcademicTerm(term);
  return parsed ? parsed.year * 10 + parsed.seasonRank : Number.MAX_SAFE_INTEGER;
}

/** Grades that record an attempt without credit. The importer marks these rows ignored. */
const NO_CREDIT_GRADES = new Set(["F", "W", "I", "NP"]);

/**
 * Maps the planner's transcript rows to the engine's attempts. Only
 * transcript rows go in: hand-marked statuses and manual credit claims carry
 * no grade or hour evidence, so a caller that counts claims passes them to
 * the engine separately, as `ClaimedCourse`s.
 *
 * - A completed or in-progress row the student has confirmed is an attempt.
 * - An ignored row with an F, W, I or NP grade is still an attempt on the
 *   transcript: it earns nothing, and an F counts in the GPA. Ignored rows
 *   with any other grade are rows the student excluded.
 * - A row still waiting for review counts for nothing, as in the planner's
 *   evidence path, and is reported back so the student knows it was left out.
 * - A duplicate-excluded row repeats another row and is dropped.
 * Every attempt is kept, so an in-progress retake sits beside the completed
 * attempt it repeats instead of replacing it.
 */
function transcriptAttempts(rows: readonly AuditTranscriptRow[]): { attempts: AuditCourse[]; unreviewed: string[] } {
  const attempts: AuditCourse[] = [];
  const unreviewed: string[] = [];
  for (const row of rows) {
    if (row.duplicateExcluded) continue;
    const grade = row.grade === "" ? null : row.grade;
    const inProgress = row.appliedStatus === "inProgress";
    // The importer keeps the transcript's earned hours, and a current-term
    // row may print 0.000 earned. That 0 is not the course's hours, so an
    // in-progress row with 0 credits has unknown hours.
    const credits = inProgress && row.credits === 0 ? null : row.credits;
    const attempt = { code: row.code, grade, credits, sourceKind: row.sourceKind, term: termRank(row.term) };
    if (row.appliedStatus === "ignored") {
      if (grade !== null && NO_CREDIT_GRADES.has(grade)) attempts.push({ ...attempt, inProgress: false });
      continue;
    }
    if (row.appliedStatus === "needsReview" || row.reviewRequired) {
      unreviewed.push(`${row.code} (${row.term})`);
      continue;
    }
    attempts.push({ ...attempt, inProgress });
  }
  return { attempts, unreviewed };
}

/**
 * The audit input for a record against the built catalog year. Requirements
 * differ between catalog years, so a record that names another year is
 * refused; one that names none is audited with a warning saying so.
 */
export function auditInput(record: { catalogId: string | null; transcriptRecords: readonly AuditTranscriptRow[] }, data: Pick<DegreeData, "catalogId" | "catalogYear">): AuditInput {
  if (record.catalogId !== null && record.catalogId !== data.catalogId) {
    return { ok: false, error: `Your record follows the ${record.catalogId} catalog. Degree audits are only available for ${data.catalogId} so far.` };
  }
  const warnings: string[] = [];
  if (record.catalogId === null) {
    warnings.push(`Your record does not name a catalog year, so it was audited against the ${data.catalogYear} catalog. Check your catalog year on your degree audit.`);
  }
  const { attempts, unreviewed } = transcriptAttempts(record.transcriptRecords);
  if (unreviewed.length > 0) {
    warnings.push(`Not counted until you review them in the planner: ${unreviewed.join(", ")}.`);
  }
  return { ok: true, attempts, warnings };
}
