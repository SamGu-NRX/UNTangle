import { describe, expect, test } from "bun:test";
import { auditProgram, type AuditResult, type ClaimedCourse, type NodeOutcome } from "@untangle/core/degree/audit";
import type { ProgramData } from "@untangle/core/degree/types";
import { importSelection } from "@/lib/connect/review";
import { auditInput } from "@/lib/degree/audit-input";
import { DEGREE_DATA } from "@/lib/degree/programs.generated";
import { buildLocalFallbackPayload, reconcileTranscriptCourses } from "@/lib/transcript-import";

/**
 * The record-to-audit mapping the audit route and Courses share, and the
 * browser path Courses will take: transcript rows through `auditInput`,
 * manual claims beside them. The route's own behaviour is pinned by
 * api-degree-audit.test.ts.
 */

/** The student-auto journey's transcript (output/playwright/student-auto/fixtures/make-transcript.mjs). */
const JOURNEY_TRANSCRIPT = `Fall 2025
MATH 1710 Calculus I 3.000 3.000 B 3.000
ENGL 1310 College Writing I 3.000 3.000 A 3.000

Spring 2026
CSCE 1040 Computer Science II 3.000 3.000 A 3.000`;

function journeyRows() {
  const rows = reconcileTranscriptCourses({ payload: buildLocalFallbackPayload(JOURNEY_TRANSCRIPT), modelUsed: "local", extractionMode: "local" }).records;
  return importSelection(rows, {});
}

function program(id: string): ProgramData {
  const found = DEGREE_DATA.programs.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`missing program ${id}`);
  return found;
}

const claim = (code: string, credits = 3): ClaimedCourse => ({ code, credits, sourceKind: "claimed" });

const requirement = (result: AuditResult, prefix: string): NodeOutcome => {
  const walk = (outcomes: NodeOutcome[]): NodeOutcome | null => {
    for (const outcome of outcomes) {
      if (outcome.name.startsWith(prefix)) return outcome;
      const nested = walk(outcome.children ?? []);
      if (nested) return nested;
    }
    return null;
  };
  const found = walk(result.requirements);
  if (!found) throw new Error(`no requirement starting ${prefix}`);
  return found;
};

describe("auditInput", () => {
  test("the journey transcript becomes three finished UNT attempts ranked by term, and a record with no catalog year is warned", () => {
    const input = auditInput({ catalogId: null, transcriptRecords: journeyRows() }, DEGREE_DATA);
    if (!input.ok) throw new Error(input.error);
    const attempts = input.attempts.map((attempt) => [attempt.code, attempt.grade, attempt.credits, attempt.sourceKind, attempt.inProgress, attempt.term]);
    // Fall 2025 ranks 20252 and Spring 2026 ranks 20260: year * 10 + season.
    expect(attempts.sort()).toEqual([
      ["CSCE 1040", "A", 3, "unt", false, 20260],
      ["ENGL 1310", "A", 3, "unt", false, 20252],
      ["MATH 1710", "B", 3, "unt", false, 20252],
    ]);
    expect(input.warnings).toEqual(["Your record does not name a catalog year, so it was audited against the 2026-2027 catalog. Check your catalog year on your degree audit."]);
  });

  test("a record on another catalog year is refused, naming both years", () => {
    expect(auditInput({ catalogId: "unt-2025-26", transcriptRecords: journeyRows() }, DEGREE_DATA)).toEqual({
      ok: false,
      error: "Your record follows the unt-2025-26 catalog. Degree audits are only available for unt-2026-27 so far.",
    });
  });

  test("a record on the built catalog year is audited without a warning", () => {
    expect(auditInput({ catalogId: "unt-2026-27", transcriptRecords: journeyRows() }, DEGREE_DATA)).toMatchObject({ ok: true, warnings: [] });
  });
});

describe("claims beside the transcript, as Courses will pass them", () => {
  const input = auditInput({ catalogId: "unt-2026-27", transcriptRecords: journeyRows() }, DEGREE_DATA);
  if (!input.ok) throw new Error(input.error);

  test("a claim on a transcript course is set aside; a claim on a new course is counted but not verified", () => {
    const result = auditProgram(program("cs-bs"), [...input.attempts, claim("MATH 1710"), claim("CSCE 1030")], { gradeHistoryComplete: false });
    expect(result.ignoredClaims).toEqual(["MATH 1710"]);
    expect(result.totals).toEqual({ required: 120, finished: 9, inProgress: 0, claimed: 3, stillNeeded: 108, unknownHours: [] });
    const required = requirement(result, "Required courses");
    expect(required.status).toBe("unsatisfied");
    expect(required.remaining.kind === "courses" && required.remaining.courses.filter((code) => code === "CSCE 1030" || code === "CSCE 1040")).toEqual([]);
  });

  test("a guest with no transcript who marks a requirement's courses done gets claimed, never satisfied", () => {
    const guest = auditInput({ catalogId: null, transcriptRecords: [] }, DEGREE_DATA);
    if (!guest.ok) throw new Error(guest.error);
    const result = auditProgram(program("cs-bs"), [...guest.attempts, claim("EENG 2710"), claim("MATH 1710", 4), claim("TECM 2700")], { gradeHistoryComplete: false });
    expect(requirement(result, "Other required courses")).toMatchObject({ status: "claimed", remaining: { kind: "none" } });
    expect(result.summary.satisfied).toBe(0);
    expect(result.totals).toMatchObject({ finished: 0, claimed: 10, stillNeeded: 110 });
  });
});

describe("Courses' two additions: marked-done courses and catalog hours", () => {
  /** A current-term row: the transcript prints 0.000 earned, and the importer keeps the 0. */
  const current = (code: string) => ({ code, term: "Fall 2026", grade: "IP", credits: 0, sourceKind: "current" as const, appliedStatus: "inProgress" as const, duplicateExcluded: false, reviewRequired: false });
  const catalog = new Map([["CSCE 2100", 3], ["ENGL 1320", 3]]);
  const catalogHours = (code: string) => catalog.get(code) ?? null;

  test("an in-progress row that printed 0 takes the catalog's hours, and the input says which rows did", () => {
    const input = auditInput({ catalogId: null, transcriptRecords: [current("CSCE 2100"), current("AGER 2250")] }, DEGREE_DATA, { catalogHours });
    if (!input.ok) throw new Error(input.error);
    expect(input.attempts.map((attempt) => [attempt.code, attempt.credits])).toEqual([["CSCE 2100", 3], ["AGER 2250", null]]);
    expect(input.catalogHours).toEqual(["CSCE 2100"]);
    // Without a catalog the hours stay unknown, as the audit route reads them.
    const bare = auditInput({ catalogId: null, transcriptRecords: [current("CSCE 2100")] }, DEGREE_DATA);
    expect(bare.ok && bare.attempts[0]!.credits).toBeNull();
    expect(bare.ok && bare.catalogHours).toEqual([]);
  });

  test("marked-done codes become claims at catalog hours, unknown when the catalog lacks the course", () => {
    const input = auditInput({ catalogId: null, transcriptRecords: [] }, DEGREE_DATA, { claimed: ["ENGL 1320", "HIST 2610", "ENGL 1320"], catalogHours });
    if (!input.ok) throw new Error(input.error);
    expect(input.claims).toEqual([
      { code: "ENGL 1320", credits: 3, sourceKind: "claimed" },
      { code: "HIST 2610", credits: null, sourceKind: "claimed" },
    ]);
    expect(input.attempts).toEqual([]);
  });
});
