import { beforeAll, describe, expect, mock, test } from "bun:test";

/**
 * The audit endpoint is public reference-data computation: no session, no
 * persistence. The rate-limit wrapper's auth/db imports are mocked so the
 * route can load in tests; the memory store keeps counting local.
 */

const getServerSession = mock(async () => null);

mock.module("@/lib/auth-server", () => ({ getServerSession }));
mock.module("@/lib/db", () => ({ db: {}, hasDatabaseUrl: false }));

let GET: typeof import("@/app/api/degree-audit/route").GET;
let POST: typeof import("@/app/api/degree-audit/route").POST;

function postRequest(body: unknown) {
  return new Request("http://localhost:3000/api/degree-audit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const course = (code: string, extra: Record<string, unknown> = {}) => ({
  code,
  grade: "A",
  credits: 3,
  sourceKind: "unt",
  inProgress: false,
  ...extra,
});

beforeAll(async () => {
  ({ GET, POST } = await import("@/app/api/degree-audit/route"));
});

describe("GET /api/degree-audit", () => {
  test("lists the auditable programs with catalog provenance", async () => {
    const response = (await GET(new Request("http://localhost:3000/api/degree-audit"))) as Response;
    expect(response.status).toBe(200);
    const body = (await response.json()) as { catalogYear: string; programs: { id: string; name: string; sourceUrl: string }[] };
    expect(body.catalogYear).toBe("2026-2027");
    expect(body.programs.map((program) => program.id)).toContain("cs-bs");
    expect(body.programs.every((program) => program.sourceUrl.startsWith("https://catalog.unt.edu"))).toBe(true);
  });
});

describe("POST /api/degree-audit", () => {
  test("audits a record against a program", async () => {
    const response = (await POST(postRequest({
      programId: "cs-bs",
      courses: [course("CSCE 1030"), course("MATH 1710", { credits: 4 }), course("TECM 2700")],
    }))) as Response;
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      programId: string;
      requirements: { name: string; status: string }[];
      policies: { name: string; status: string }[];
      summary: Record<string, number>;
    };
    expect(body.programId).toBe("cs-bs");
    expect(body.summary.satisfied + body.summary.inProgress + body.summary.unsatisfied + body.summary.advisory).toBe(body.requirements.length);
    // Policies are evaluated in their own list; the record clears the C floor.
    const majorGrade = body.policies.find((policy) => policy.name === "Minimum grade of C (major courses)");
    expect(majorGrade?.status).toBe("satisfied");
  });

  test("returns 404 for an unknown program", async () => {
    const response = (await POST(postRequest({ programId: "nope", courses: [] }))) as Response;
    expect(response.status).toBe(404);
  });

  test("returns 400 for a malformed record instead of guessing", async () => {
    const badGrade = (await POST(postRequest({ programId: "cs-bs", courses: [{ code: "CSCE 1030", grade: 4 }] }))) as Response;
    expect(badGrade.status).toBe(400);
    const badCode = (await POST(postRequest({ programId: "cs-bs", courses: [{ code: "intro to cs" }] }))) as Response;
    expect(badCode.status).toBe(400);
    const badBody = (await POST(postRequest("not an object"))) as Response;
    expect(badBody.status).toBe(400);
  });

  test("normalizes the compact code form to the spaced form", async () => {
    const compact = (await POST(postRequest({ programId: "cs-bs", courses: [{ code: "CSCE1030", grade: "A", credits: 3 }] }))) as Response;
    const spaced = (await POST(postRequest({ programId: "cs-bs", courses: [{ code: "CSCE 1030", grade: "A", credits: 3 }] }))) as Response;
    expect(compact.status).toBe(200);
    expect(spaced.status).toBe(200);
    expect(await compact.json()).toEqual(await spaced.json());
  });
});
