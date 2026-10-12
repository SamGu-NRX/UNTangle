import { describe, expect, it } from "bun:test";
import {
  BASE_REVISION_HEADER,
  type FetchLike,
  loadPlannerStateFromServer,
  savePlannerStateToServer,
} from "@/lib/planner-save";
import { defaultPlannerState } from "@/lib/seed-data";
import type { PlannerState } from "@/lib/types";

const state = (): PlannerState => ({
  ...defaultPlannerState,
  courseStatuses: { ...defaultPlannerState.courseStatuses, "ANTH 1010": "inProgress" },
  transcriptRecords: [],
  updatedAt: "2026-10-10T12:00:00.000Z",
});

const fetchLike = (body: unknown, status: number): FetchLike =>
  async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

const failingFetch = (error: string): FetchLike =>
  async () => {
    throw new Error(error);
  };

describe("savePlannerStateToServer (honest save classification)", () => {
  it("acknowledges durability only when the server confirmed a persisted row", async () => {
    const outcome = await savePlannerStateToServer(state(), 0, fetchLike({ state: state(), revision: 3, persistent: true }, 200));
    expect(outcome.kind).toBe("saved");
    if (outcome.kind === "saved") {
      expect(outcome.revision).toBe(3);
    }
  });

  it("sends the base revision the save started from", async () => {
    let sent = null as string | null;
    await savePlannerStateToServer(state(), 7, async (_input, init) => {
      sent = new Headers(init?.headers).get(BASE_REVISION_HEADER);
      return new Response(JSON.stringify({ state: state(), revision: 8 }), { status: 200 });
    });
    expect(sent).toBe("7");
  });

  it("classifies a 409 as a conflict carrying the newer stored version", async () => {
    const theirs = { ...state(), optimization: "compact" as const, updatedAt: "2026-10-11T09:00:00.000Z" };
    const outcome = await savePlannerStateToServer(state(), 1, fetchLike({ error: "newer", state: theirs, revision: 2 }, 409));
    expect(outcome.kind).toBe("conflict");
    if (outcome.kind === "conflict") {
      expect(outcome.revision).toBe(2);
      expect(outcome.theirs?.optimization).toBe("compact");
      expect(outcome.savedAt).toBe("2026-10-11T09:00:00.000Z");
    }
  });

  it("reports Not saved — never Saved — when the deployment stores nothing", async () => {
    // persistence.ts answers 200 with state: null when there is no database.
    const outcome = await savePlannerStateToServer(state(), 0, fetchLike({ state: null, persistent: false }, 200));
    expect(outcome.kind).toBe("not-saved");
    if (outcome.kind === "not-saved") {
      expect(outcome.message).toContain("storage is unavailable");
    }
  });

  it("classifies a 500 as a retryable server failure, not a save", async () => {
    const outcome = await savePlannerStateToServer(state(), 0, fetchLike({ error: "boom" }, 500));
    expect(outcome.kind).toBe("failed");
    if (outcome.kind === "failed") {
      expect(outcome.reason).toBe("server");
    }
  });

  it("classifies a 401 as an expired session, not a save", async () => {
    const outcome = await savePlannerStateToServer(state(), 0, fetchLike({ error: "Unauthorized" }, 401));
    expect(outcome.kind).toBe("failed");
    if (outcome.kind === "failed") {
      expect(outcome.reason).toBe("session");
    }
  });

  it("classifies a dropped connection as a network failure, not a save", async () => {
    const outcome = await savePlannerStateToServer(state(), 0, failingFetch("network down"));
    expect(outcome.kind).toBe("failed");
    if (outcome.kind === "failed") {
      expect(outcome.reason).toBe("network");
    }
  });

  it("classifies an unreadable 200 body as a server failure, not a save", async () => {
    const outcome = await savePlannerStateToServer(state(), 0, async () => new Response("{not json", { status: 200 }));
    expect(outcome.kind).toBe("failed");
    if (outcome.kind === "failed") {
      expect(outcome.reason).toBe("server");
    }
  });
});

describe("loadPlannerStateFromServer", () => {
  it("loads and normalizes a persisted state", async () => {
    const raw = {
      ...state(),
      optimization: "warp-speed",
      activeDay: "Someday",
    };
    const outcome = await loadPlannerStateFromServer(fetchLike({ state: raw, persistent: true }, 200));
    expect(outcome.kind).toBe("loaded");
    if (outcome.kind === "loaded") {
      expect(outcome.persistent).toBe(true);
      expect(outcome.state?.optimization).toBe("clusterMorning");
      expect(outcome.state?.activeDay).toBe("Mon");
    }
  });

  it("treats an empty account (no saved state) as a normal load", async () => {
    const outcome = await loadPlannerStateFromServer(fetchLike({ state: null, persistent: true }, 200));
    expect(outcome.kind).toBe("loaded");
    if (outcome.kind === "loaded") {
      expect(outcome.state).toBeNull();
    }
  });

  it("treats 401 as signed-out: nothing was read, so nothing may be saved over it", async () => {
    const outcome = await loadPlannerStateFromServer(fetchLike({ error: "Unauthorized" }, 401));
    expect(outcome.kind).toBe("signed-out");
  });

  it("reads the stored revision with the state", async () => {
    const outcome = await loadPlannerStateFromServer(fetchLike({ state: state(), revision: 5, persistent: true }, 200));
    expect(outcome.kind === "loaded" && outcome.revision).toBe(5);
  });

  it("surfaces a 500 as an unavailable load", async () => {
    const outcome = await loadPlannerStateFromServer(fetchLike({ error: "db down" }, 500));
    expect(outcome.kind).toBe("unavailable");
    if (outcome.kind === "unavailable") {
      expect(outcome.message).toContain("500");
    }
  });

  it("surfaces a dropped connection as an unavailable load", async () => {
    const outcome = await loadPlannerStateFromServer(failingFetch("offline"));
    expect(outcome.kind).toBe("unavailable");
    if (outcome.kind === "unavailable") {
      expect(outcome.message).toContain("could not reach the server");
    }
  });

  it("reports non-persistence when the deployment stores nothing", async () => {
    const outcome = await loadPlannerStateFromServer(fetchLike({ state: null, persistent: false }, 200));
    expect(outcome.kind).toBe("loaded");
    if (outcome.kind === "loaded") {
      expect(outcome.persistent).toBe(false);
    }
  });
});
