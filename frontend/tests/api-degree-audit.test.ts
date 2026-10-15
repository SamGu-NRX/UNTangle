import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

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

const recordBody = {
  institutionId: "unt",
  courseStatuses: {},
  manualCredit: [],
  major: null,
  catalogId: null,
  transcriptRecords: [
    {
      id: "row-1",
      code: "CSCE 1030",
      title: "Computer Science I",
      term: "2025 Fall",
      grade: "A",
      credits: 3,
      sourceKind: "unt",
      confidence: 1,
      rationale: "",
      duplicateExcluded: false,
      appliedStatus: "completed",
      prerequisiteSatisfied: true,
      reviewRequired: false,
    },
    {
      id: "row-2",
      code: "CSCE 2110",
      title: "Discrete Structures",
      term: "2026 Spring",
      grade: "",
      credits: null,
      sourceKind: "current",
      confidence: 1,
      rationale: "",
      duplicateExcluded: false,
      appliedStatus: "inProgress",
      prerequisiteSatisfied: true,
      reviewRequired: false,
    },
    {
      id: "row-3",
      code: "MATH 1710",
      title: "Calculus A",
      term: "2025 Fall",
      grade: "C-",
      credits: 4,
      sourceKind: "unt",
      confidence: 1,
      rationale: "",
      duplicateExcluded: false,
      appliedStatus: "completed",
      prerequisiteSatisfied: true,
      reviewRequired: false,
    },
  ],
};

describe("GET /api/v1/programs", () => {
  test("lists the auditable programs with provenance", async () => {
    const response = await programsRoute.GET(new Request("http://localhost:3000/api/v1/programs"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      catalogYear: string;
      builtAt: string;
      programs: { id: string; name: string; sourceUrl: string }[];
      pages: { url: string; sha256: string }[];
    };
    expect(body.programs.map((program) => program.id)).toEqual(["cs-bs", "ce-bs", "math-bsmth", "biology-bsbio", "core"]);
    for (const program of body.programs) expect(program.sourceUrl.startsWith("https://catalog.unt.edu")).toBe(true);
    // Every page cites its capture provenance: url, time, and content hash.
    expect(body.pages.length).toBeGreaterThan(0);
    for (const page of body.pages) expect(page.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test("lists the University Core alongside the majors: each major audit returns it", async () => {
    const response = await programsRoute.GET(new Request("http://localhost:3000/api/v1/programs"));
    const body = (await response.json()) as { programs: { id: string }[] };
    expect(body.programs.some((program) => program.id === "core")).toBe(true);
  });
});

describe("GET /api/v1/programs/[id]/audit", () => {
  test("returns 401 signed out, for any program id", async () => {
    const response = await auditRoute.GET(
      new Request("http://localhost:3000/api/v1/programs/cs-bs/audit"),
      { params: Promise.resolve({ id: "cs-bs" }) },
    );
    expect(response.status).toBe(401);
    expect(pull).not.toHaveBeenCalled();
  });

  test("returns 404 for an unknown program id", async () => {
    getServerSession.mockImplementation(async () => ({ user: { id: "user-1" } }));
    const response = await auditRoute.GET(
      new Request("http://localhost:3000/api/v1/programs/chem-ms/audit"),
      { params: Promise.resolve({ id: "chem-ms" }) },
    );
    expect(response.status).toBe(404);
  });

  test("returns 404 when no academic record is synced", async () => {
    getServerSession.mockImplementation(async () => ({ user: { id: "user-1" } }));
    const response = await auditRoute.GET(
      new Request("http://localhost:3000/api/v1/programs/cs-bs/audit"),
      { params: Promise.resolve({ id: "cs-bs" }) },
    );
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("transcript");
  });

  test("audits the synced record: completed, in-progress, and grade-floor outcomes", async () => {
    getServerSession.mockImplementation(async () => ({ user: { id: "user-1" } }));
    pull.mockImplementation(async () => [
      { documentId: "main", kind: "academic-record", revision: 1, deleted: false },
    ]);
    get.mockImplementation(async () => ({ kind: "academic-record", body: recordBody }));

    const response = await auditRoute.GET(
      new Request("http://localhost:3000/api/v1/programs/cs-bs/audit"),
      { params: Promise.resolve({ id: "cs-bs" }) },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      program: { id: string; name: string; sourceUrl: string };
      catalogYear: string;
      audit: {
        auditId: string;
        requirements: { name: string; status: string; detail: string }[];
        policies: { name: string; status: string; detail: string }[];
        summary: Record<string, number>;
      };
    };
    expect(body.program.id).toBe("cs-bs");
    expect(body.catalogYear).toBe("2026-2027");

    // CSCE 1030 (A) satisfies the first slot of the major's required courses;
    // the current-term CSCE 2110 row reads in progress, not completed.
    const majorRequirements = body.audit.requirements.find((node) => node.name === "Major requirements");
    expect(majorRequirements?.status).toBe("inProgress");
    expect(majorRequirements?.detail).toContain("1 in progress");
    const otherRequired = body.audit.requirements.find((node) => node.name === "Other required courses");
    expect(otherRequired?.detail).toContain("1/3 slots satisfied");
    expect(body.audit.summary.inProgress).toBeGreaterThanOrEqual(1);

    // The C floor sees the completed C- calculus in its scope.
    const majorGrade = body.audit.policies.find((policy) => policy.name === "Minimum grade of C (major courses)");
    expect(majorGrade?.status).toBe("unsatisfied");
    expect(majorGrade?.detail).toContain("MATH 1710 (C-)");

    // Institution-level policies the transcript cannot verify stay unverifiable.
    expect(body.audit.policies.some((policy) => policy.status === "unverifiable")).toBe(true);
  });

  test("audits the University Core: Social and Behavioral Sciences claims PADM 2100 before Option A reads it", async () => {
    getServerSession.mockImplementation(async () => ({ user: { id: "user-1" } }));
    pull.mockImplementation(async () => [
      { documentId: "main", kind: "academic-record", revision: 1, deleted: false },
    ]);
    get.mockImplementation(async () => ({
      kind: "academic-record",
      body: {
        ...recordBody,
        transcriptRecords: [
          {
            id: "row-1",
            code: "PADM 2100",
            title: "Public Administration",
            term: "2025 Fall",
            grade: "A",
            credits: 3,
            sourceKind: "unt",
            confidence: 1,
            rationale: "",
            duplicateExcluded: false,
            appliedStatus: "completed",
            prerequisiteSatisfied: true,
            reviewRequired: false,
          },
          {
            id: "row-2",
            code: "PHIL 2500",
            title: "Introduction to Philosophy",
            term: "2025 Fall",
            grade: "A",
            credits: 3,
            sourceKind: "unt",
            confidence: 1,
            rationale: "",
            duplicateExcluded: false,
            appliedStatus: "completed",
            prerequisiteSatisfied: true,
            reviewRequired: false,
          },
        ],
      },
    }));

    const response = await auditRoute.GET(
      new Request("http://localhost:3000/api/v1/programs/core/audit"),
      { params: Promise.resolve({ id: "core" }) },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      program: { id: string };
      audit: { requirements: { name: string; status: string; detail: string }[] };
    };
    expect(body.program.id).toBe("core");
    // One course per core area: Social and Behavioral Sciences claims PADM
    // 2100 in tree order, so Component Area Option A reads only PHIL 2500 —
    // 1 course, 3 of 6 hours, in progress. Without the allocation the same
    // record fills the option outright at 6/6.
    const option = body.audit.requirements.find((node) => node.name.startsWith("Component Area Option"));
    expect(option?.name).toContain("Option A");
    expect(option?.status).toBe("inProgress");
    expect(option?.detail).toContain("3/6");
  });

  test("a needsReview row is not read as completed evidence", async () => {
    getServerSession.mockImplementation(async () => ({ user: { id: "user-1" } }));
    pull.mockImplementation(async () => [
      { documentId: "main", kind: "academic-record", revision: 1, deleted: false },
    ]);
    get.mockImplementation(async () => ({
      kind: "academic-record",
      body: {
        ...recordBody,
        transcriptRecords: [{ ...recordBody.transcriptRecords[0]!, appliedStatus: "needsReview" }],
      },
    }));

    const response = await auditRoute.GET(
      new Request("http://localhost:3000/api/v1/programs/cs-bs/audit"),
      { params: Promise.resolve({ id: "cs-bs" }) },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { audit: { policies: { name: string; status: string }[] } };
    // The only transcript row is awaiting review, so the GPA has no evidence
    // and reports unverifiable instead of reading the row as completed.
    const overall = body.audit.policies.find((policy) => policy.name === "Overall GPA");
    expect(overall?.status).toBe("unverifiable");
  });

  test("a passing retake replaces an earlier F under UNT's repeat rule", async () => {
    getServerSession.mockImplementation(async () => ({ user: { id: "user-1" } }));
    pull.mockImplementation(async () => [
      { documentId: "main", kind: "academic-record", revision: 1, deleted: false },
    ]);
    get.mockImplementation(async () => ({
      kind: "academic-record",
      body: {
        ...recordBody,
        transcriptRecords: [
          { ...recordBody.transcriptRecords[0]!, term: "2024 Fall", grade: "F" },
          { ...recordBody.transcriptRecords[0]!, id: "row-1b", term: "2025 Fall", grade: "B" },
        ],
      },
    }));

    const response = await auditRoute.GET(
      new Request("http://localhost:3000/api/v1/programs/cs-bs/audit"),
      { params: Promise.resolve({ id: "cs-bs" }) },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { audit: { policies: { name: string; status: string; detail: string }[] } };
    // The most recent attempt (the 2025 Fall B) counts, not the first row.
    const overall = body.audit.policies.find((policy) => policy.name === "Overall GPA");
    expect(overall?.status).toBe("satisfied");
    expect(overall?.detail).toContain("3.00");
  });

  test("a major audit returns the University Core audit alongside it", async () => {
    getServerSession.mockImplementation(async () => ({ user: { id: "user-1" } }));
    pull.mockImplementation(async () => [
      { documentId: "main", kind: "academic-record", revision: 1, deleted: false },
    ]);
    get.mockImplementation(async () => ({ kind: "academic-record", body: recordBody }));

    const response = await auditRoute.GET(
      new Request("http://localhost:3000/api/v1/programs/cs-bs/audit"),
      { params: Promise.resolve({ id: "cs-bs" }) },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { core: { programId: string; requirements: { name: string }[] } | null };
    expect(body.core?.programId).toBe("core");
    expect(body.core?.requirements.length).toBeGreaterThan(0);
  });

  test("does not read another institution's record", async () => {
    getServerSession.mockImplementation(async () => ({ user: { id: "user-1" } }));
    pull.mockImplementation(async () => [
      { documentId: "main", kind: "academic-record", revision: 1, deleted: false },
    ]);
    get.mockImplementation(async () => ({ kind: "academic-record", body: { ...recordBody, institutionId: "uta" } }));

    const response = await auditRoute.GET(
      new Request("http://localhost:3000/api/v1/programs/cs-bs/audit"),
      { params: Promise.resolve({ id: "cs-bs" }) },
    );
    expect(response.status).toBe(404);
  });
});
