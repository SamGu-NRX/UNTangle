import { NextResponse } from "next/server";
import { auditProgram } from "@untangle/core/degree/audit";
import type { ProgramData } from "@untangle/core/degree/types";
import type { AcademicRecordBody } from "../../../../../../../../packages/contracts/src/documents";
import { getServerSession } from "@/lib/auth-server";
import { documentRepository } from "@/lib/document-sync/repository";
import { db, hasDatabaseUrl } from "@/lib/db";
import { withRateLimit } from "@/lib/rate-limit/server";
import { auditInput } from "@/lib/degree/audit-input";
import { DEGREE_DATA } from "@/lib/degree/programs.generated";

export const runtime = "nodejs";

// The public index and audit route both expose every program in the generated
// catalog data. Every major audit returns the core audit beside it.
function findProgram(id: string): ProgramData | null {
  return DEGREE_DATA.programs.find((program) => program.id === id) ?? null;
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
  // The route counts transcript rows only; it passes no manual claims.
  const input = auditInput(record, DEGREE_DATA);
  if (!input.ok) {
    return NextResponse.json({ error: input.error }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }
  const { attempts, warnings } = input;
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
