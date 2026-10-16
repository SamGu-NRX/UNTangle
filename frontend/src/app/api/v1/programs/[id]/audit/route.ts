import { NextResponse } from "next/server";
import { auditProgram, type AuditCourse } from "@untangle/core/degree/audit";
import type { ProgramData } from "@untangle/core/degree/types";
import type { AcademicRecordBody } from "../../../../../../../../packages/contracts/src/documents";
import { getServerSession } from "@/lib/auth-server";
import { documentRepository } from "@/lib/document-sync/repository";
import { db, hasDatabaseUrl } from "@/lib/db";
import { withRateLimit } from "@/lib/rate-limit/server";
import { DEGREE_DATA } from "@/lib/degree/programs.generated";
import { parseAcademicTerm } from "@/lib/term-chronology";

export const runtime = "nodejs";

// The served set: CS BS, CE BS and the University Core, all from the
// 2026-2027 catalog. Every major audit returns the core audit beside it.
const AUDITABLE_PROGRAM_IDS = ["cs-bs", "ce-bs", "core"];

function findProgram(id: string): ProgramData | null {
  if (!AUDITABLE_PROGRAM_IDS.includes(id)) return null;
  const programs: ProgramData[] = DEGREE_DATA.programs;
  return programs.find((program) => program.id === id) ?? null;
}

/**
 * The signed-in student's UNT academic record, read through the same server
 * document store the planner syncs with. One record per user and institution;
 * this route only reads, never writes.
 */
async function readAcademicRecord(userId: string): Promise<AcademicRecordBody | null> {
  const repository = documentRepository(db);
  const rows = await repository.pull(userId);
  for (const row of rows) {
    if (row.kind !== "academic-record" || row.deleted) continue;
    const document = await repository.get(userId, row.documentId);
    if (document.kind !== "academic-record") continue;
    if (document.body.institutionId === "unt") return document.body;
  }
  return null;
}

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

type Evidence = { attempts: AuditCourse[]; unreviewed: string[] };

/**
 * Maps the planner's transcript rows to the engine's attempts. Only
 * transcript rows go in: the planner's hand-marked statuses and manual
 * credit claims carry no grade or hour evidence.
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
function auditEvidence(record: AcademicRecordBody): Evidence {
  const attempts: AuditCourse[] = [];
  const unreviewed: string[] = [];
  for (const row of record.transcriptRecords) {
    if (row.duplicateExcluded) continue;
    const grade = row.grade === "" ? null : row.grade;
    const attempt = { code: row.code, grade, credits: row.credits, sourceKind: row.sourceKind, term: termRank(row.term) };
    if (row.appliedStatus === "ignored") {
      if (grade !== null && NO_CREDIT_GRADES.has(grade)) attempts.push({ ...attempt, inProgress: false });
      continue;
    }
    if (row.appliedStatus === "needsReview" || row.reviewRequired) {
      unreviewed.push(`${row.code} (${row.term})`);
      continue;
    }
    attempts.push({ ...attempt, inProgress: row.appliedStatus === "inProgress" });
  }
  return { attempts, unreviewed };
}

/**
 * The per-program degree audit against the signed-in student's record.
 * Unknown programs 404 the same signed in or out, so the route does not leak
 * which ids exist.
 */
export const GET = withRateLimit("degreeAudit", async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const session = await getServerSession(request);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in to audit your degree." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const { id } = await context.params;
  const program = findProgram(id);
  if (!program) {
    return NextResponse.json({ error: `No degree audit is available for '${id}'.` }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  if (!hasDatabaseUrl) {
    return NextResponse.json({ error: "The audit service is unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const record = await readAcademicRecord(session.user.id);
  if (!record) {
    return NextResponse.json(
      { error: "No UNT academic record is synced yet. Import your transcript in the planner first." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
  // Requirements differ between catalog years, so a record that names
  // another year is not audited against this one.
  if (record.catalogId !== null && record.catalogId !== DEGREE_DATA.catalogId) {
    return NextResponse.json(
      { error: `Your record follows the ${record.catalogId} catalog. Degree audits are only available for ${DEGREE_DATA.catalogId} so far.` },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }
  const warnings: string[] = [];
  if (record.catalogId === null) {
    warnings.push(`Your record does not name a catalog year, so it was audited against the ${DEGREE_DATA.catalogYear} catalog. Check your catalog year on your degree audit.`);
  }
  const { attempts, unreviewed } = auditEvidence(record);
  if (unreviewed.length > 0) {
    warnings.push(`Not counted until you review them in the planner: ${unreviewed.join(", ")}.`);
  }
  // A saved record holds the rows the student confirmed at import, and the
  // import leaves failed and withdrawn rows unsaved unless the student picks
  // them (frontend/src/lib/connect/review.ts, importSelection). It cannot
  // show every graded attempt, so GPA checks report unverifiable.
  const options = { gradeHistoryComplete: false };
  const audit = auditProgram(program, attempts, options);
  const coreProgram = id === "core" ? null : findProgram("core");
  const core = coreProgram ? auditProgram(coreProgram, attempts, options) : null;
  return NextResponse.json(
    {
      program: { id: program.id, name: program.name, catalogId: program.catalogId, sourceUrl: program.sourceUrl },
      catalogYear: DEGREE_DATA.catalogYear,
      warnings,
      audit,
      core,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
