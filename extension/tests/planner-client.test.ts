import { expect, test } from "bun:test";
import { PlannerClient } from "../src/lib/planner-client";
import { fakeFetch, jsonResponse } from "./helpers";
import type { AddOptionCommand, Preview } from "../src/shared/extension-api";
const ref = { term: "spring-2027", classNumber: "14523" };
const preview: Preview = { scheduleId: "main", optionId: "section-14523", revision: 7, title: "CSCE 1030", conflict: "conflict", details: ["Work on Monday"] };
const command: AddOptionCommand = { command: "add-option", operationId: "op-1", scheduleId: "main", optionId: "section-14523", expectedRevision: 7 };
test("preview builds its own URL from validated ids and omits cookies", async () => {
  const f = fakeFetch(() => jsonResponse(preview));
  expect(await new PlannerClient(f.fetchImpl).preview(ref, "token")).toEqual(preview);
  expect(f.requests[0].url).toBe("http://127.0.0.1:3217/api/v1/extension/preview/spring-2027/14523");
  expect(f.requests[0].init?.credentials).toBe("omit");
  expect(new Headers(f.requests[0].init?.headers).get("Authorization")).toBe("Bearer token");
  await expect(new PlannerClient(f.fetchImpl).preview({ ...ref, classNumber: "../../account" }, "token")).rejects.toThrow("Invalid section");
  expect(f.requests).toHaveLength(1);
});
test("one add command carries exactly the confirmed revision", async () => {
  const f = fakeFetch(() => jsonResponse({ kind: "receipt", operationId: command.operationId, committedRevision: 8 }));
  expect((await new PlannerClient(f.fetchImpl).add(command, "token"))?.kind).toBe("receipt");
  expect(f.requests).toHaveLength(1);
  expect(JSON.parse(String(f.requests[0].init?.body))).toEqual(command);
  expect(f.requests[0].init?.credentials).toBe("omit");
});
test("stale revisions reject without silently re-reading and reapplying", async () => {
  const f = fakeFetch(() => jsonResponse({ kind: "rejection", operationId: command.operationId, reason: "stale-revision" }, 409));
  expect(await new PlannerClient(f.fetchImpl).add(command, "token")).toEqual({ kind: "rejection", operationId: "op-1", reason: "stale-revision" });
  expect(f.requests).toHaveLength(1);
});
test("malformed, mismatched, unauthorized and unavailable responses are not receipts", async () => {
  for (const [body, status] of [[{ kind: "receipt", operationId: "other", committedRevision: 9 }, 200], [{}, 200], [{}, 503]] as const) {
    const f = fakeFetch(() => jsonResponse(body, status));
    expect(await new PlannerClient(f.fetchImpl).add(command, "token")).toBeNull();
  }
  expect(await new PlannerClient(async () => { throw new Error("offline"); }).add(command, "token")).toBeNull();
});
test("bad preview schema never reaches the panel", async () => {
  for (const body of [{ ...preview, revision: -1 }, { ...preview, details: [false] }, { ...preview, optionId: "https://evil.test" }])
    await expect(new PlannerClient(fakeFetch(() => jsonResponse(body)).fetchImpl).preview(ref, "token")).rejects.toThrow("Invalid extension preview");
});
test("revoked grants require sign-in rather than losing a pending operation", async () => {
  await expect(new PlannerClient(fakeFetch(() => jsonResponse({}, 401)).fetchImpl).add(command, "token")).rejects.toThrow("Sign in");
});
test("storage key ordering cannot change the bytes of a replayed command", async () => {
  const f = fakeFetch(() => jsonResponse({ kind: "receipt", operationId: command.operationId, committedRevision: 8 }));
  const client = new PlannerClient(f.fetchImpl);
  await client.add(command, "token");
  await client.add({ expectedRevision: 7, optionId: "section-14523", scheduleId: "main", operationId: "op-1", command: "add-option" }, "token");
  expect(f.requests.map(r => r.init?.body)).toEqual([JSON.stringify(command), JSON.stringify(command)]);
});
