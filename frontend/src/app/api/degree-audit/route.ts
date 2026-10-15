import { auditProgram, type AuditCourse } from "@untangle/ingest/degree/audit";
import type { ProgramData } from "@untangle/ingest/degree/types";
import { withRateLimit } from "@/lib/rate-limit/server";
import { DEGREE_DATA } from "@/lib/degree/programs.generated";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const programs = DEGREE_DATA.programs as unknown as ProgramData[];

function findProgram(id: string): ProgramData | null {
  return programs.find((program) => program.id === id) ?? null;
}

/** The audit runs on the caller's record, so the body is validated strictly: an
 * unrecognised field would otherwise silently change the result. */
function parseCourses(raw: unknown): AuditCourse[] | null {
  if (!Array.isArray(raw)) return null;
  const courses: AuditCourse[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) return null;
    const record = entry as Record<string, unknown>;
    if (typeof record.code !== "string" || !/^[A-Z]{2,5}\s?\d{4}[A-Z]?$/.test(record.code)) return null;
    const code = record.code.includes(" ") ? record.code : record.code.replace(/^([A-Z]{2,5})(\d{4}[A-Z]?)$/, "$1 $2");
    if (record.grade !== undefined && record.grade !== null && typeof record.grade !== "string") return null;
    if (record.credits !== undefined && record.credits !== null && (typeof record.credits !== "number" || !Number.isFinite(record.credits) || record.credits < 0)) return null;
    if (record.sourceKind !== undefined && !["unt", "transfer", "exam", "current", "unknown"].includes(record.sourceKind as string)) return null;
    courses.push({
      code,
      grade: (record.grade as string | null | undefined) ?? null,
      credits: (record.credits as number | null | undefined) ?? null,
      sourceKind: (record.sourceKind as AuditCourse["sourceKind"] | undefined) ?? "unt",
      inProgress: record.inProgress === true,
    });
  }
  return courses;
}

function listPrograms() {
  return NextResponse.json({
    catalogYear: DEGREE_DATA.catalogYear,
    builtAt: DEGREE_DATA.builtAt,
    programs: programs.map((program) => ({ id: program.id, name: program.name, sourceUrl: program.sourceUrl })),
  });
}

async function audit(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Body must be an object" }, { status: 400 });
  }
  const { programId, courses } = body as Record<string, unknown>;
  if (typeof programId !== "string") {
    return NextResponse.json({ error: "programId is required" }, { status: 400 });
  }
  const program = findProgram(programId);
  if (!program) {
    return NextResponse.json({ error: `Unknown program: ${programId}` }, { status: 404 });
  }
  const parsed = parseCourses(courses);
  if (parsed === null) {
    return NextResponse.json(
      {
        error:
          "courses must be a list of { code: \"SUBJ 1234\", grade: string | null, credits: number | null, sourceKind: \"unt\" | \"transfer\" | \"exam\" | \"current\" | \"unknown\", inProgress?: boolean }",
      },
      { status: 400 },
    );
  }
  return NextResponse.json(auditProgram(program, parsed));
}

/** Catalog reference data: what can be audited. */
export const GET = withRateLimit("degreeAudit", listPrograms);

/** The audit itself: POST a record of completed courses for one program. */
export const POST = withRateLimit("degreeAudit", audit);
