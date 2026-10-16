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

// The four majors plus the University Core: the core's Component Area Option
// is where the one-course-one-area allocation is visible in an audit, so
// students audit their core progress directly. The listing route includes the
// core, and every major audit returns the core audit beside it.
const AUDITABLE_PROGRAM_IDS = ["cs-bs", "ce-bs", "math-bsmth", "biology-bsbio", "core"];

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

// Semester ranks inside a calendar year: Spring before Summer before Fall.
const SEASON_RANK: [RegExp, number][] = [
  [/spring/i, 1],
  [/summer/i, 2],
  [/fall|autumn/i, 3],
  [/winter/i, 4],
];

/**
 * Chronological term key: the calendar year times ten plus the semester's
 * rank, so "2025 Spring" orders before "2025 Fall" (and "2024 Fall" before
 * "2025 Spring") whichever way the transcript lists the rows. Both UNT row
 * formats ("2025 Fall", "Fall 2025") parse. An unparsable term sorts oldest,
 * and rows with equal keys keep transcript row order (the later row replaces
 * the earlier), so the resolution stays deterministic.
 */
function termKey(term: string): number {
  const year = /\d{4}/.exec(term);
  const season = SEASON_RANK.find(([pattern]) => pattern.test(term));
  if (!year || !season) return 0;
  return Number(year[0]) * 10 + season[1];
}

/**
 * Maps the planner's academic record to the audit engine's course inputs.
 * Only transcript rows go in: they are the record's sourced evidence. The
 * planner's hand-marked statuses and manual credit claims carry no grade or
 * hour evidence, so an audit over them would guess.
 */
function auditCourses(record: AcademicRecordBody): AuditCourse[] {
  const courses = new Map<string, { course: AuditCourse; term: number }>();
  for (const row of record.transcriptRecords) {
    // Ignored rows are excluded by the student; duplicate-excluded and
    // needs-review rows are still working through the registrar process, and
    // a review-required row (low-confidence import, provisional pass) counts
    // for nothing until reviewed — the planner's evidence path excludes all
    // of these regardless of the applied status, and so does the audit.
    // None of them is completed evidence an audit may read.
    if (row.appliedStatus === "ignored" || row.appliedStatus === "needsReview" || row.duplicateExcluded || row.reviewRequired) continue;
    const inProgress = row.appliedStatus === "inProgress";
    // Current-term rows carry an empty grade; the engine then reads the slot
    // as in progress rather than completed without a grade.
    const grade = row.grade === "" ? null : row.grade;
    const attempt = { course: { code: row.code, grade, credits: row.credits, sourceKind: row.sourceKind, inProgress }, term: termKey(row.term) };
    const existing = courses.get(row.code);
    // Under UNT's repeat rule the most recent attempt counts: a later-term
    // row replaces an earlier one, including a failing grade.
    if (!existing || attempt.term >= existing.term) courses.set(row.code, attempt);
  }
  return [...courses.values()].map((entry) => entry.course);
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
  const courses = auditCourses(record);
  const audit = auditProgram(program, courses);
  // Every major audit carries the University Core audit beside it: both are
  // audited against the same record, and the core's Component Area Option
  // shows where otherwise double-counted courses land.
  const coreProgram = id === "core" ? null : findProgram("core");
  const core = coreProgram ? auditProgram(coreProgram, courses) : null;
  return NextResponse.json(
    {
      program: { id: program.id, name: program.name, catalogId: program.catalogId, sourceUrl: program.sourceUrl },
      catalogYear: DEGREE_DATA.catalogYear,
      audit,
      core,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
