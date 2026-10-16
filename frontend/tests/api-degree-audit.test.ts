import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { TranscriptCourseRecord } from "@/lib/types";
import { buildLocalFallbackPayload, reconcileTranscriptCourses } from "@/lib/transcript-import";
import { importSelection, type CheckDecision } from "@/lib/connect/review";

type SessionFn = (request?: Request) => Promise<{ user: { id: string } } | null>;
type PullFn = (userId: string) => Promise<{ documentId: string; kind: string; revision: number; deleted: boolean }[]>;
type GetFn = (userId: string, documentId: string) => Promise<{ kind: string; body: unknown }>;

const getServerSession = mock<SessionFn>(async () => null);
const pull = mock<PullFn>(async () => []);
const get = mock<GetFn>(async () => ({ kind: "academic-record", body: {} }));

mock.module("@/lib/auth-server", () => ({ getServerSession }));
mock.module("@/lib/db", () => ({ db: {}, hasDatabaseUrl: true }));
mock.module("@/lib/document-sync/repository", () => ({ documentRepository: () => ({ pull, get }) }));

let programsRoute: typeof import("@/app/api/v1/programs/route");
let auditRoute: typeof import("@/app/api/v1/programs/[id]/audit/route");

beforeAll(async () => {
  programsRoute = await import("@/app/api/v1/programs/route");
  auditRoute = await import("@/app/api/v1/programs/[id]/audit/route");
});

beforeEach(() => {
  getServerSession.mockImplementation(async () => null);
  pull.mockImplementation(async () => []);
  get.mockClear();
});

/**
 * Synthetic UNT-format transcript text (no real student), read by the same
 * parser the import page uses. Columns: attempted, earned, grade, points.
 * The F and the W earn 0 hours, as on a real transcript.
 */
const TRANSCRIPT = `Transfer Credit
ENGL 1310 First-Year Writing I  3.000  3.000  CR  0.000

2025 Fall
CSCE 1030 Computer Science I  3.000  3.000  B  9.000
MATH 1710 Calculus I  4.000  0.000  F  0.000
CSCE 1040 Computer Science II  3.000  3.000  D  3.000
EENG 2710 Digital Logic Design  3.000  0.000  W  0.000

2026 Spring
MATH 1710 Calculus I  4.000  4.000  EN  0.000
CSCE 1030 Computer Science I  3.000  3.000  EN  0.000`;

/** The importer's rows for the transcript, exactly as the import page receives them. */
function importedRows(): TranscriptCourseRecord[] {
  return reconcileTranscriptCourses({ payload: buildLocalFallbackPayload(TRANSCRIPT), modelUsed: "local", extractionMode: "local" }).records;
}

/** The rows the import page saves for a set of decisions under "To check" (importSelection). */
function savedRows(decisions: Record<string, CheckDecision> = {}): TranscriptCourseRecord[] {
  const rows = importedRows();
  const byCode = (code: string, grade: string) => rows.find((row) => row.code === code && row.grade === grade)!.id;
  const resolved = Object.fromEntries(Object.entries(decisions).map(([key, decision]) => {
    const [code, grade] = key.split("|") as [string, string];
    return [byCode(code, grade), decision];
  }));
  return importSelection(rows, resolved);
}

function recordBody(transcriptRecords: TranscriptCourseRecord[], extra: { catalogId?: string | null; institutionId?: string } = {}) {
  return { institutionId: extra.institutionId ?? "unt", courseStatuses: {}, manualCredit: [], major: null, catalogId: extra.catalogId === undefined ? null : extra.catalogId, transcriptRecords };
}

function serve(body: unknown) {
  getServerSession.mockImplementation(async () => ({ user: { id: "user-1" } }));
  pull.mockImplementation(async () => [{ documentId: "doc-1", kind: "academic-record", revision: 1, deleted: false }]);
  get.mockImplementation(async () => ({ kind: "academic-record", body }));
}

type Outcome = { name: string; status: string; detail: string; children?: Outcome[] };
type AuditBody = {
  error?: string;
  warnings: string[];
  catalogYear: string;
  program: { id: string; catalogId: string };
  audit: { requirements: Outcome[]; policies: Outcome[] };
  core: { requirements: Outcome[]; policies: Outcome[] } | null;
};

async function audit(id: string): Promise<{ status: number; body: AuditBody }> {
  const response = await auditRoute.GET(new Request(`http://localhost:3000/api/v1/programs/${id}/audit`), { params: Promise.resolve({ id }) });
  return { status: response.status, body: (await response.json()) as AuditBody };
}

const find = (outcomes: Outcome[], name: string): Outcome => {
  for (const outcome of outcomes) {
    if (outcome.name.startsWith(name)) return outcome;
    const nested = outcome.children ? find(outcome.children, name) : null;
    if (nested) return nested;
  }
  return null as never;
};

describe("the importer's rows, as the route sees them", () => {
  test("the importer marks the F and W ignored and the D for review", () => {
    const rows = importedRows();
    const row = (code: string, grade: string) => rows.find((entry) => entry.code === code && entry.grade === grade)!;
    expect([row("MATH 1710", "F").appliedStatus, row("MATH 1710", "F").credits]).toEqual(["ignored", 0]);
    expect(row("EENG 2710", "W").appliedStatus).toBe("ignored");
    expect([row("CSCE 1040", "D").appliedStatus, row("CSCE 1040", "D").reviewRequired]).toEqual(["completed", true]);
    expect(row("ENGL 1310", "CR").sourceKind).toBe("transfer");
  });

  test("with no decisions the import saves neither the F, the W nor the D", () => {
    expect(savedRows().map((row) => `${row.code} ${row.grade} ${row.appliedStatus}`).sort()).toEqual(["CSCE 1030 B completed", "CSCE 1030 EN inProgress", "ENGL 1310 CR completed", "MATH 1710 EN inProgress"]);
  });
});

describe("GET /api/v1/programs", () => {
  test("lists CS BS, CE BS and the core, with page provenance", async () => {
    const response = await programsRoute.GET(new Request("http://localhost:3000/api/v1/programs"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { catalogId: string; programs: { id: string; sourceUrl: string }[]; pages: { sha256: string }[] };
    expect(body.catalogId).toBe("unt-2026-27");
    expect(body.programs.map((program) => program.id)).toEqual(["cs-bs", "ce-bs", "core"]);
    for (const program of body.programs) expect(program.sourceUrl.startsWith("https://catalog.unt.edu")).toBe(true);
    for (const page of body.pages) expect(page.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("GET /api/v1/programs/[id]/audit", () => {
  test("returns 401 signed out, for any program id", async () => {
    const { status } = await audit("cs-bs");
    expect(status).toBe(401);
    expect(pull).not.toHaveBeenCalled();
  });

  test("returns 404 for a program it does not serve, Mathematics and Biology included", async () => {
    getServerSession.mockImplementation(async () => ({ user: { id: "user-1" } }));
    for (const id of ["chem-ms", "math-bsmth", "biology-bsbio"]) expect((await audit(id)).status).toBe(404);
  });

  test("returns 404 when no academic record is synced", async () => {
    getServerSession.mockImplementation(async () => ({ user: { id: "user-1" } }));
    const { status, body } = await audit("cs-bs");
    expect(status).toBe(404);
    expect(body.error).toContain("transcript");
  });

  test("a default import: the GPA cannot be verified, because the saved rows leave out the F", async () => {
    serve(recordBody(savedRows()));
    const { status, body } = await audit("cs-bs");
    expect(status).toBe(200);
    const overall = find(body.audit.policies, "Overall GPA");
    expect(overall.status).toBe("unverifiable");
    expect(overall.detail).toStartWith("3.00 over 1 graded attempt of 2.0 required, but");
    expect(overall.detail).toContain("leaves out failed and withdrawn attempts");
  });

  test("an in-progress retake does not erase the completed attempt", async () => {
    serve(recordBody(savedRows()));
    const { body } = await audit("cs-bs");
    const required = find(body.audit.requirements, "Required courses");
    expect(required.status).toBe("unsatisfied");
    expect(required.detail).toStartWith("1/17");
    // CSCE 1030's B stands; MATH 1710 has only its current attempt.
    expect(find(body.audit.requirements, "Other required courses").detail).toStartWith("0/3");
    expect(find(body.audit.requirements, "Other required courses").detail).toContain("Counting in-progress courses: 1/3");
  });

  test("a D the student confirms at import fails the major's C floor", async () => {
    serve(recordBody(savedRows({ "CSCE 1040|D": "completed" })));
    const { body } = await audit("cs-bs");
    expect(find(body.audit.policies, "Minimum grade of C (major courses)")).toMatchObject({ status: "unsatisfied", detail: "Below C: CSCE 1040 (D)." });
  });

  test("an F the student marks completed still earns no credit", async () => {
    serve(recordBody(savedRows({ "MATH 1710|F": "completed" })));
    const { body } = await audit("cs-bs");
    expect(find(body.audit.requirements, "Other required courses").detail).toStartWith("0/3");
    expect(find(body.audit.policies, "Overall GPA").detail).toContain("attempted hours unknown for MATH 1710 (F)");
  });

  test("every importer row saved as-is: the F counts as an attempt, the unreviewed D is reported, not counted", async () => {
    serve(recordBody(importedRows()));
    const { body } = await audit("cs-bs");
    expect(body.warnings).toContain("Not counted until you review them in the planner: CSCE 1040 (2025 Fall).");
    expect(find(body.audit.policies, "Overall GPA").detail).toContain("attempted hours unknown for MATH 1710 (F)");
    expect(find(body.audit.policies, "Minimum grade of C (major courses)").status).toBe("satisfied");
  });

  test("exam and transfer credit rows are skipped by the GPA, not a reason to stop", async () => {
    serve(recordBody(savedRows()));
    const { body } = await audit("core");
    expect(find(body.audit.requirements, "Communication, 6 hours").children?.[0]).toMatchObject({ status: "satisfied" });
    expect(find(body.audit.policies, "Communication core grade").detail).toContain("Not checked, no letter grade: ENGL 1310 (CR).");
  });

  test("a record without a catalog year is audited against 2026-27 with a warning", async () => {
    serve(recordBody(savedRows()));
    const { body } = await audit("cs-bs");
    expect(body.program.catalogId).toBe("unt-2026-27");
    expect(body.warnings[0]).toStartWith("Your record does not name a catalog year");
  });

  test("a record on the 2026-27 catalog gets no catalog warning", async () => {
    serve(recordBody(savedRows(), { catalogId: "unt-2026-27" }));
    const { body } = await audit("cs-bs");
    expect(body.warnings).toEqual([]);
  });

  test("a record on another catalog year is refused, not audited against the wrong one", async () => {
    serve(recordBody(savedRows(), { catalogId: "unt-2025-26" }));
    const { status, body } = await audit("cs-bs");
    expect(status).toBe(409);
    expect(body.error).toContain("unt-2025-26");
  });

  test("a major audit returns the University Core audit beside it, and the core alone returns none", async () => {
    serve(recordBody(savedRows()));
    expect((await audit("ce-bs")).body.core?.requirements.length).toBeGreaterThan(0);
    expect((await audit("core")).body.core).toBeNull();
  });

  test("does not read another institution's record", async () => {
    serve(recordBody(savedRows(), { institutionId: "utd" }));
    expect((await audit("cs-bs")).status).toBe(404);
  });
});
