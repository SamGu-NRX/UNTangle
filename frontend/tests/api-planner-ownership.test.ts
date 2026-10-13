import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { getInitialPlannerState } from "@/lib/planner";

// Ownership-contract tests for /api/planner: the session user id is the ONLY
// source of persistence identity, payload-shape rejections return 400, and
// client-supplied identity fields must never reach persistence.

type SessionFn = () => Promise<{ user: { id: string } } | null>;
type LoadFn = (userId: string) => Promise<unknown>;
type SaveFn = (userId: string, state: unknown, baseRevision: number) => Promise<unknown>;

const getServerSession = mock<SessionFn>(async () => null);
const loadPlannerState = mock<LoadFn>(async () => null);
const savePlannerState = mock<SaveFn>(async () => null);

mock.module("@/lib/auth-server", () => ({ getServerSession }));
mock.module("@/lib/persistence", () => ({ loadPlannerState, savePlannerState }));

let GET: (request: Request) => Promise<Response>;
let POST: (request: Request) => Promise<Response>;

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
  savePlannerState.mockImplementation(async (_userId, state) => ({ kind: "saved", state, revision: 1 }));
});

describe("GET /api/planner ownership", () => {
  test("returns 401 and never touches persistence without a session", async () => {
    getServerSession.mockImplementation(async () => null);
    const response = await GET(new Request("http://localhost:3000/api/planner"));
    expect(response.status).toBe(401);
    expect(loadPlannerState).not.toHaveBeenCalled();
  });

  test("loads state with the session user id", async () => {
    getServerSession.mockImplementation(async () => ({ user: { id: "sess-user-9" } }));
    await GET(new Request("http://localhost:3000/api/planner"));
    expect(loadPlannerState).toHaveBeenCalledTimes(1);
    expect(loadPlannerState.mock.calls[0]?.[0]).toBe("sess-user-9");
  });
});

describe("POST /api/planner ownership", () => {
  test("returns 401 and never touches persistence without a session", async () => {
    getServerSession.mockImplementation(async () => null);
    const response = await POST(postRequest(getInitialPlannerState()));
    expect(response.status).toBe(401);
    expect(savePlannerState).not.toHaveBeenCalled();
  });

  test("rejects non-object bodies with 400", async () => {
    getServerSession.mockImplementation(async () => ({ user: { id: "sess-user-1" } }));
    for (const body of [null, "string", 42, true, [getInitialPlannerState()]]) {
      const response = await POST(postRequest(body));
      expect(response.status).toBe(400);
    }
    expect(savePlannerState).not.toHaveBeenCalled();
  });

  test("rejects wrong-shape maps with 400", async () => {
    getServerSession.mockImplementation(async () => ({ user: { id: "sess-user-1" } }));
    const base = getInitialPlannerState();
    const cases: unknown[] = [
      { ...base, courseStatuses: "nope" },
      { ...base, courseStatuses: { CSCE: 12 } },
      { ...base, selectedSections: { CSCE: 12 } },
      { ...base, optimization: 7 },
      { ...base, activeDay: null },
      { ...base, transcriptRecords: { notAnArray: true } },
      { ...base, updatedAt: 12345 },
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
    getServerSession.mockImplementation(async () => ({ user: { id: "sess-user-1" } }));
    const response = await POST(
      new Request("http://localhost:3000/api/planner", {
        method: "POST",
        body: "{not json",
      }),
    );
    expect(response.status).toBe(400);
    expect(savePlannerState).not.toHaveBeenCalled();
  });

  test("derives the persistence user id from the session only", async () => {
    getServerSession.mockImplementation(async () => ({ user: { id: "sess-user-42" } }));
    const response = await POST(postRequest(getInitialPlannerState()));
    expect(response.status).toBe(200);
    expect(savePlannerState).toHaveBeenCalledTimes(1);
    expect(savePlannerState.mock.calls[0]?.[0]).toBe("sess-user-42");
  });

  test("a spoofed identity field in the body never reaches persistence", async () => {
    getServerSession.mockImplementation(async () => ({ user: { id: "sess-user-42" } }));
    const payload = {
      ...getInitialPlannerState(),
      userId: "attacker-1",
      id: "attacker-1",
      user_id: "attacker-1",
    };
    const response = await POST(postRequest(payload));
    expect(response.status).toBe(200);

    expect(savePlannerState).toHaveBeenCalledTimes(1);
    expect(savePlannerState.mock.calls[0]?.[0]).toBe("sess-user-42");

    const savedState = savePlannerState.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(savedState.userId).toBeUndefined();
    expect(savedState.id).toBeUndefined();
    expect(savedState.user_id).toBeUndefined();
    expect(JSON.stringify(savedState)).not.toContain("attacker-1");
  });

  test("a spoofed nested identity field is stripped from the saved state", async () => {
    getServerSession.mockImplementation(async () => ({ user: { id: "sess-user-42" } }));
    const base = getInitialPlannerState();
    const payload = {
      ...base,
      courseStatuses: { ...base.courseStatuses, ownerUserId: undefined },
      selectedSections: { ...base.selectedSections, spoofed: "attacker-section" },
    };
    const response = await POST(postRequest(payload));
    expect(response.status).toBe(200);
    const savedState = savePlannerState.mock.calls[0]?.[1] as Record<string, unknown>;
    const savedSections = savedState.selectedSections as Record<string, unknown>;
    expect(Object.keys(savedSections)).not.toContain("spoofed");
  });
});
