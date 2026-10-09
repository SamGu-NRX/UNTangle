import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { courses } from "@/lib/seed-data";
import { getInitialPlannerState } from "@/lib/planner";

type SessionFn = () => Promise<{ user: { id: string } } | null>;
type LoadFn = (userId: string) => Promise<unknown>;
type SaveFn = (userId: string, state: unknown) => Promise<unknown>;

const getServerSession = mock<SessionFn>(async () => null);
const loadPlannerState = mock<LoadFn>(async () => null);
const savePlannerState = mock<SaveFn>(async () => null);

mock.module("@/lib/auth-server", () => ({ getServerSession }));
mock.module("@/lib/persistence", () => ({ loadPlannerState, savePlannerState }));

let GET: typeof import("@/app/api/planner/route").GET;
let POST: typeof import("@/app/api/planner/route").POST;

function postRequest(body: unknown) {
  return new Request("http://localhost:3000/api/planner", {
    method: "POST",
    headers: { "content-type": "application/json" },
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
    const response = await GET();
    expect(response.status).toBe(401);
    expect(loadPlannerState).not.toHaveBeenCalled();
  });

  test("returns the persisted state for an authenticated user", async () => {
    getServerSession.mockImplementation(async () => ({ user: { id: "user-1" } }));
    const stored = getInitialPlannerState();
    loadPlannerState.mockImplementation(async () => stored);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: stored });
  });

  test("propagates persistence failures as 500", async () => {
    getServerSession.mockImplementation(async () => ({ user: { id: "user-1" } }));
    loadPlannerState.mockImplementation(async () => {
      throw new Error("db down");
    });
    const response = await GET();
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
      return state;
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
  });

  test("recovers semantically-invalid values instead of rejecting", async () => {
    getServerSession.mockImplementation(async () => ({ user: { id: "user-1" } }));
    savePlannerState.mockImplementation(async (_userId, state) => state);
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
