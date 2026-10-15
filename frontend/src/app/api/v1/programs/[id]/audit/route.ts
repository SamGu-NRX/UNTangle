import { NextResponse } from "next/server";
import { auditProgram, type AuditCourse } from "@untangle/core/degree/audit";
import type { ProgramData } from "@untangle/core/degree/types";
import type { AcademicRecordBody } from "../../../../../../../../packages/contracts/src/documents";
import { getServerSession } from "@/lib/auth-server";
import { documentRepository } from "@/lib/document-sync/repository";
import { db, hasDatabaseUrl } from "@/lib/db";
import { withRateLimit } from "@/lib/rate-limit/server";
import { DEGREE_DATA } from "@/lib/degree/programs.generated";

export const runtime = "nodejs";

const AUDITABLE_PROGRAM_IDS = ["cs-bs", "ce-bs", "math-bsmth", "biology-bsbio"];

function findProgram(id: string): ProgramData | null {
  if (!AUDITABLE_PROGRAM_IDS.includes(id)) return null;
  const programs = DEGREE_DATA.programs as ProgramData[];
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
 * Maps the planner's academic record to the audit engine's course inputs.
 * Only transcript rows go in: they are the record's sourced evidence. The
 * planner's hand-marked statuses and manual credit claims carry no grade or
 * hour evidence, so an audit over them would guess.
 */
function auditCourses(record: AcademicRecordBody): AuditCourse[] {
  const courses = new Map<string, AuditCourse>();
  for (const row of record.transcriptRecords) {
    if (row.appliedStatus === "ignored" || row.duplicateExcluded) continue;
    const inProgress = row.appliedStatus === "inProgress";
    // Current-term rows carry an empty grade; the engine then reads the slot
    // as in progress rather than completed without a grade.
    const grade = row.grade === "" ? null : row.grade;
    const existing = courses.get(row.code);
    // A retake row with a real grade replaces an earlier ungraded one.
    if (!existing || (existing.grade === null && grade !== null)) {
      courses.set(row.code, { code: row.code, grade, credits: row.credits, sourceKind: row.sourceKind, inProgress });
    }
  }
  return [...courses.values()];
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
  const audit = auditProgram(program, auditCourses(record));
  return NextResponse.json(
    {
      program: { id: program.id, name: program.name, catalogId: program.catalogId, sourceUrl: program.sourceUrl },
      catalogYear: DEGREE_DATA.catalogYear,
      audit,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
