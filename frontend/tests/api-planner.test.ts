import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { courses } from "@/lib/seed-data";
import { getInitialPlannerState } from "@/lib/planner";

type SessionFn = () => Promise<{ user: { id: string } } | null>;
type LoadFn = (userId: string) => Promise<unknown>;
type SaveFn = (userId: string, state: unknown, baseRevision: number) => Promise<unknown>;

const getServerSession = mock<SessionFn>(async () => null);
const loadPlannerState = mock<LoadFn>(async () => null);
const savePlannerState = mock<SaveFn>(async () => null);

mock.module("@/lib/auth-server", () => ({ getServerSession }));
mock.module("@/lib/persistence", () => ({ loadPlannerState, savePlannerState }));
mock.module("@/lib/db", () => ({ db: {}, hasDatabaseUrl: true }));

let GET: typeof import("@/app/api/planner/route").GET;
let POST: typeof import("@/app/api/planner/route").POST;

function postRequest(body: unknown) {
  return new Request("http://localhost:3000/api/planner", {
    method: "POST",
    headers: { "content-type": "application/json", "X-Planner-Base-Revision": "0" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  ({ GET, POST } = await import("@/app/api/planner/route"));
});

beforeEach(() => {
  getServerSession.mockClear();
  loadPlannerState.mockClear();
  savePlannerState.mockClear();
});

describe("GET /api/planner", () => {
  test("returns 401 without a session", async () => {
    getServerSession.mockImplementation(async () => null);
    const response = await GET(new Request("http://localhost:3000/api/planner"));
    expect(response.status).toBe(401);
    expect(loadPlannerState).not.toHaveBeenCalled();
  });

  test("returns the persisted state for an authenticated user", async () => {
    getServerSession.mockImplementation(async () => ({ user: { id: "user-1" } }));
    const stored = getInitialPlannerState();
    loadPlannerState.mockImplementation(async () => ({ state: stored, revision: 4 }));
    const response = await GET(new Request("http://localhost:3000/api/planner"));
    expect(response.status).toBe(200);
    // `persistent: true` tells the client this deployment stores rows, so the
    // UI may acknowledge a save as durable. The revision is what the next
    // save must name as its base.
    expect(await response.json()).toEqual({ state: stored, revision: 4, persistent: true });
  });

  test("an account with no stored plan answers revision 0", async () => {
    getServerSession.mockImplementation(async () => ({ user: { id: "user-1" } }));
    loadPlannerState.mockImplementation(async () => null);
    const response = await GET(new Request("http://localhost:3000/api/planner"));
    expect(await response.json()).toEqual({ state: null, revision: 0, persistent: true });
  });

  test("propagates persistence failures as 500", async () => {
    getServerSession.mockImplementation(async () => ({ user: { id: "user-1" } }));
    loadPlannerState.mockImplementation(async () => {
      throw new Error("db down");
    });
    const response = await GET(new Request("http://localhost:3000/api/planner"));
    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe("db down");
  });
});

describe("POST /api/planner", () => {
  test("returns 401 without a session", async () => {
    getServerSession.mockImplementation(async () => null);
    const response = await POST(postRequest(getInitialPlannerState()));
    expect(response.status).toBe(401);
    expect(savePlannerState).not.toHaveBeenCalled();
  });

  test("rejects non-object bodies with 400", async () => {
    getServerSession.mockImplementation(async () => ({ user: { id: "user-1" } }));
    for (const body of ["string", 42, [getInitialPlannerState()]]) {
      const response = await POST(new Request("http://localhost/api/planner", {
        method: "POST",
        body: JSON.stringify(body),
      }));
      expect(response.status).toBe(400);
    }
    expect(savePlannerState).not.toHaveBeenCalled();
  });

  test("rejects malformed payloads with 400 and a reason", async () => {
    getServerSession.mockImplementation(async () => ({ user: { id: "user-1" } }));
    const cases: unknown[] = [
      { ...getInitialPlannerState(), courseStatuses: "nope" },
      { ...getInitialPlannerState(), selectedSections: { CSCE: 12 } },
      { ...getInitialPlannerState(), optimization: 7 },
      { ...getInitialPlannerState(), activeDay: null },
      { ...getInitialPlannerState(), selectedMajor: 3 },
      { ...getInitialPlannerState(), transcriptRecords: "everything" },
      { ...getInitialPlannerState(), updatedAt: 12345 },
    ];
    for (const body of cases) {
      const response = await POST(postRequest(body));
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(typeof json.error).toBe("string");
    }
    expect(savePlannerState).not.toHaveBeenCalled();
  });

  test("rejects invalid JSON bodies with 400", async () => {
    getServerSession.mockImplementation(async () => ({ user: { id: "user-1" } }));
    const response = await POST(
      new Request("http://localhost/api/planner", { method: "POST", body: "{not json" }),
    );
    expect(response.status).toBe(400);
  });

  test("saves a normalized state for a valid payload", async () => {
    getServerSession.mockImplementation(async () => ({ user: { id: "user-1" } }));
    const base = getInitialPlannerState();
    let saved: unknown = null;
    savePlannerState.mockImplementation(async (_userId, state) => {
      saved = state;
      return { kind: "saved", state, revision: 1 };
    });

    const payload = {
      ...base,
      courseStatuses: { ...base.courseStatuses, [courses[0].code]: "inProgress" as const },
    };
    const response = await POST(postRequest(payload));
    expect(response.status).toBe(200);
    expect(savePlannerState).toHaveBeenCalledTimes(1);
    const savedState = saved as ReturnType<typeof getInitialPlannerState>;
    expect(savedState.courseStatuses[courses[0].code]).toBe("inProgress");
    expect(savedState.updatedAt).toEqual(base.updatedAt);
    expect(await response.json()).toMatchObject({ revision: 1, persistent: true });
  });

  test("passes the client's base revision to persistence", async () => {
    getServerSession.mockImplementation(async () => ({ user: { id: "user-1" } }));
    savePlannerState.mockImplementation(async (_userId, state) => ({ kind: "saved", state, revision: 8 }));
    const request = new Request("http://localhost/api/planner", {
      method: "POST",
      headers: { "X-Planner-Base-Revision": "7" },
      body: JSON.stringify(getInitialPlannerState()),
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(savePlannerState.mock.calls[0]?.[2]).toBe(7);
  });

  test("refuses a save without a base revision (428), so nothing can be overwritten blind", async () => {
    getServerSession.mockImplementation(async () => ({ user: { id: "user-1" } }));
    for (const header of [null, "", "-1", "abc", "1.5"]) {
      const headers: Record<string, string> = {};
      if (header !== null) headers["X-Planner-Base-Revision"] = header;
      const response = await POST(
        new Request("http://localhost/api/planner", {
          method: "POST",
          headers,
          body: JSON.stringify(getInitialPlannerState()),
        }),
      );
      expect(response.status).toBe(428);
    }
    expect(savePlannerState).not.toHaveBeenCalled();
  });

  test("answers 409 with the newer stored version when the base revision is stale", async () => {
    getServerSession.mockImplementation(async () => ({ user: { id: "user-1" } }));
    const theirs = { ...getInitialPlannerState(), optimization: "compact" };
    savePlannerState.mockImplementation(async () => ({ kind: "conflict", current: { state: theirs, revision: 3 } }));
    const response = await POST(postRequest(getInitialPlannerState()));
    expect(response.status).toBe(409);
    const json = await response.json();
    expect(json.revision).toBe(3);
    expect(json.state.optimization).toBe("compact");
  });

  test("reports non-persistence when storage is unavailable", async () => {
    getServerSession.mockImplementation(async () => ({ user: { id: "user-1" } }));
    // persistence.ts returns null instead of writing when the deployment has
    // no database URL; the route must surface that honestly (state: null,
    // persistent: false), not as a fake `Saved`.
    savePlannerState.mockImplementation(async () => null);
    const response = await POST(postRequest(getInitialPlannerState()));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: null, persistent: false });
  });

  test("recovers semantically-invalid values instead of rejecting", async () => {
    getServerSession.mockImplementation(async () => ({ user: { id: "user-1" } }));
    savePlannerState.mockImplementation(async (_userId, state) => ({ kind: "saved", state, revision: 1 }));
    const payload = {
      ...getInitialPlannerState(),
      optimization: "warp-speed",
      activeDay: "Someday",
      courseStatuses: { "FAKE 101": "inProgress" },
      transcriptRecords: [{ garbage: true }],
    };
    const response = await POST(postRequest(payload));
    expect(response.status).toBe(200);
    const saved = (await response.json()).state;
    expect(saved.optimization).toBe("clusterMorning");
    expect(saved.activeDay).toBe("Mon");
    expect(Object.keys(saved.courseStatuses)).not.toContain("FAKE 101");
    expect(saved.transcriptRecords).toEqual([]);
  });
});
