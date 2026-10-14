import { describe, expect, test } from "bun:test";
import { PlannerClient } from "../src/lib/planner-client";
import type { ClassNumberMatch, PlannerState } from "../src/shared/api-types";
import { fakeFetch, jsonResponse, rowFixture } from "./helpers";

const seededSections = { "CSCE 1040": "vsb:spring-2027:CSCE 1040:10001" };

function plannerBody(revision: number, selectedSections: Record<string, string> = seededSections): {
  state: PlannerState;
  revision: number;
  persistent: boolean;
} {
  return {
    state: {
      courseStatuses: {},
      selectedSections,
      optimization: "compact",
      activeDay: "Mon",
      selectedMajor: null,
      transcriptRecords: [],
      updatedAt: "2026-10-14T00:00:00.000Z",
    },
    revision,
    persistent: true,
  };
}

const match: ClassNumberMatch = {
  term: "spring-2027",
  classNumber: "14523",
  courseCode: "CSCE 1030",
  sectionId: "vsb:spring-2027:CSCE 1030:14523",
};

describe("PlannerClient.load", () => {
  test("re-reads the planner on every load", async () => {
    // The snapshot is never reused across flows: the session cache cannot
    // tell which account the cookie belongs to, so a stale read could merge
    // one account's plan into another's session.
    const { fetchImpl, requests } = fakeFetch(() => jsonResponse(plannerBody(1)));
    const client = new PlannerClient(fetchImpl, "http://127.0.0.1:3217");

    const first = await client.load();
    const second = await client.load();

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok) expect(first.snapshot.revision).toBe(1);
    expect(requests).toHaveLength(2);
    expect(requests.every(request => request.init?.credentials === "include")).toBe(true);
  });

  test("reports signed-out on 401", async () => {
    const { fetchImpl } = fakeFetch(() => jsonResponse({ error: "Unauthorized" }, 401));
    const client = new PlannerClient(fetchImpl, "http://127.0.0.1:3217");
    const result = await client.load();
    expect(result).toEqual({ ok: false, status: 401 });
  });

  test("reports unreachable when the fetch throws", async () => {
    const { fetchImpl } = fakeFetch(() => {
      throw new Error("connection refused");
    });
    const client = new PlannerClient(fetchImpl, "http://127.0.0.1:3217");
    const result = await client.load();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected the load to fail");
    expect(result.status).toBe(0);
    expect(result.error).toContain("connection refused");
  });
});

describe("PlannerClient.addToMain", () => {
  test("resolves the class number and posts the merged state with the revision header", async () => {
    const { fetchImpl, requests } = fakeFetch(index => {
      if (index === 0) return jsonResponse(match);
      if (index === 1) return jsonResponse(plannerBody(1));
      return jsonResponse(plannerBody(2, { ...seededSections, "CSCE 1030": match.sectionId }));
    });
    const client = new PlannerClient(fetchImpl, "http://127.0.0.1:3217");

    const outcome = await client.addToMain(rowFixture());

    expect(outcome).toBe("added");
    expect(requests).toHaveLength(3);
    expect(requests[0]?.url).toBe("http://127.0.0.1:3217/api/sections/spring-2027/class/14523");
    const post = requests[2];
    expect(post?.init?.method).toBe("POST");
    expect(post?.init?.credentials).toBe("include");
    const headers = post?.init?.headers as Record<string, string>;
    expect(headers["X-Planner-Base-Revision"]).toBe("1");
    const body = JSON.parse(String(post?.init?.body)) as PlannerState;
    expect(body.selectedSections["CSCE 1030"]).toBe("vsb:spring-2027:CSCE 1030:14523");
    expect(body.selectedSections["CSCE 1040"]).toBe("vsb:spring-2027:CSCE 1040:10001");
  });

  test("marks the course in progress so the server keeps the pick", async () => {
    // The server's normalizePlannerState drops a section pick whose course is
    // not planned as inProgress, so the add has to plan the course too.
    const seeded = plannerBody(1);
    seeded.state.courseStatuses = { "CSCE 1040": "inProgress" };
    const { fetchImpl, requests } = fakeFetch(index => {
      if (index === 0) return jsonResponse(match);
      if (index === 1) return jsonResponse(seeded);
      return jsonResponse(plannerBody(2, { ...seededSections, "CSCE 1030": match.sectionId }));
    });
    const client = new PlannerClient(fetchImpl, "http://127.0.0.1:3217");

    expect(await client.addToMain(rowFixture())).toBe("added");

    const body = JSON.parse(String(requests[2]?.init?.body)) as PlannerState;
    expect(body.courseStatuses["CSCE 1030"]).toBe("inProgress");
    expect(body.courseStatuses["CSCE 1040"]).toBe("inProgress");
  });

  test("does not claim added when the deployment stores nothing", async () => {
    const { fetchImpl } = fakeFetch(index => {
      if (index === 0) return jsonResponse(match);
      if (index === 1) return jsonResponse(plannerBody(1));
      // The route answers ok with state null and persistent false when the
      // deployment has no database: nothing was stored.
      return jsonResponse({ state: null, persistent: false });
    });
    const client = new PlannerClient(fetchImpl, "http://127.0.0.1:3217");
    expect(await client.addToMain(rowFixture())).toBe("failed");
  });

  test("does not claim added when the saved plan drops the pick", async () => {
    const { fetchImpl } = fakeFetch(index => {
      if (index === 0) return jsonResponse(match);
      if (index === 1) return jsonResponse(plannerBody(1));
      // The echoed state no longer names the requested section.
      return jsonResponse(plannerBody(2, seededSections));
    });
    const client = new PlannerClient(fetchImpl, "http://127.0.0.1:3217");
    expect(await client.addToMain(rowFixture())).toBe("failed");
  });

  test("reports already-scheduled without writing", async () => {
    const { fetchImpl, requests } = fakeFetch(index => {
      if (index === 0) return jsonResponse({ ...match, courseCode: "CSCE 1040", sectionId: seededSections["CSCE 1040"] });
      return jsonResponse(plannerBody(1));
    });
    const client = new PlannerClient(fetchImpl, "http://127.0.0.1:3217");

    const outcome = await client.addToMain(rowFixture());

    expect(outcome).toBe("already-scheduled");
    expect(requests).toHaveLength(2);
  });

  test("retries a 409 by re-reading and re-merging", async () => {
    const { fetchImpl, requests } = fakeFetch(index => {
      // 0: class resolve; 1: GET rev 1; 2: POST 409; 3: GET rev 1; 4: POST success
      if (index === 0) return jsonResponse(match);
      if (index === 2)
        return jsonResponse(
          { error: "Your saved plan was updated by another session", state: plannerBody(1).state, revision: 1 },
          409,
        );
      if (index === 4) return jsonResponse(plannerBody(2, { ...seededSections, "CSCE 1030": match.sectionId }));
      return jsonResponse(plannerBody(1));
    });
    const client = new PlannerClient(fetchImpl, "http://127.0.0.1:3217");

    const outcome = await client.addToMain(rowFixture());

    expect(outcome).toBe("added");
    expect(requests).toHaveLength(5);
    const firstRevision = (requests[2]?.init?.headers as Record<string, string>)["X-Planner-Base-Revision"];
    const secondRevision = (requests[4]?.init?.headers as Record<string, string>)["X-Planner-Base-Revision"];
    expect(firstRevision).toBe("1");
    expect(secondRevision).toBe("1");
  });

  test("gives up honestly after three conflicting writes", async () => {
    const { fetchImpl, requests } = fakeFetch(index => {
      if (index === 0) return jsonResponse(match);
      if (index % 2 === 0)
        return jsonResponse({ error: "conflict", state: plannerBody(1).state, revision: 1 }, 409);
      return jsonResponse(plannerBody(1));
    });
    const client = new PlannerClient(fetchImpl, "http://127.0.0.1:3217");

    const outcome = await client.addToMain(rowFixture());

    expect(outcome).toBe("conflict-write");
    expect(requests).toHaveLength(7); // resolve + 3 x (GET + POST)
  });

  test("reports signed-out when the planner read is unauthorized", async () => {
    const { fetchImpl } = fakeFetch(index => {
      if (index === 0) return jsonResponse(match);
      return jsonResponse({ error: "Unauthorized" }, 401);
    });
    const client = new PlannerClient(fetchImpl, "http://127.0.0.1:3217");
    expect(await client.addToMain(rowFixture())).toBe("signed-out");
  });

  test("reports not-found when the class number does not resolve", async () => {
    const { fetchImpl, requests } = fakeFetch(() => jsonResponse({ error: "Not found" }, 404));
    const client = new PlannerClient(fetchImpl, "http://127.0.0.1:3217");
    expect(await client.addToMain(rowFixture())).toBe("not-found");
    expect(requests).toHaveLength(1);
  });

  test("short-circuits an invalid term or class number without fetching", async () => {
    const { fetchImpl, requests } = fakeFetch(() => jsonResponse(match));
    const client = new PlannerClient(fetchImpl, "http://127.0.0.1:3217");
    expect(await client.addToMain(rowFixture({ term: "not-a-term" }))).toBe("not-found");
    expect(await client.addToMain(rowFixture({ classNumber: "abc" }))).toBe("not-found");
    expect(requests).toHaveLength(0);
  });
});
