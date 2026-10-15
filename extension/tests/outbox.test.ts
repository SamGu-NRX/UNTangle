import { expect, test } from "bun:test";
import { AddOutbox, type LocalStore, type PendingAdd } from "../src/lib/outbox";
import { PlannerClient } from "../src/lib/planner-client";
import { jsonResponse } from "./helpers";
const ref = { term: "spring-2027", classNumber: "14523" };
const command = { command: "add-option" as const, operationId: "op-restart", scheduleId: "main", optionId: "option-1", expectedRevision: 4 };
const pending: PendingAdd = { command, grantId: "grant-a", ref };
function memory(): LocalStore {
  const data: Record<string, unknown> = {};
  return { get: async (k) => structuredClone(data[k]), set: async (k, v) => { data[k] = structuredClone(v); }, remove: async (k) => { delete data[k]; }, all: async () => structuredClone(data) };
}
test("persist before sending, survive worker loss after commit, replay the identical operation", async () => {
  const storage = memory();
  const seen: unknown[] = [];
  let offline = true;
  const client = new PlannerClient(async (_url, init) => {
    expect(await storage.get("add:op-restart")).toEqual(pending);
    // Replay always presents the grant's own fresh access token.
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer token-a");
    seen.push(JSON.parse(String(init?.body)));
    if (offline)
      throw new Error("response lost after server commit");
    return jsonResponse({ kind: "receipt", operationId: command.operationId, committedRevision: 5 });
  });
  const first = new AddOutbox(storage, client);
  await first.enqueue(pending);
  expect(await first.send(pending, "token-a")).toBeNull();
  expect(await storage.get("add:op-restart")).toEqual(pending);
  offline = false;
  await new AddOutbox(storage, client).resend("grant-a", "token-a");
  expect(seen).toEqual([command, command]);
  expect(await storage.get("add:op-restart")).toBeUndefined();
});
test("a rejection removes the operation and hands the page back for a fresh preview", async () => {
  const storage = memory();
  const fresh: PendingAdd[] = [];
  const box = new AddOutbox(storage, new PlannerClient(async () => jsonResponse({ kind: "rejection", operationId: command.operationId, reason: "stale-revision" }, 409)));
  await box.enqueue(pending);
  await box.resend("grant-a", "token-a", async (p) => { fresh.push(p); });
  expect(fresh).toEqual([pending]);
  expect(await storage.all()).toEqual({});
});
test("a failed local write cannot reach the network", async () => {
  let requests = 0;
  const storage = memory();
  storage.set = async () => { throw new Error("disk full"); };
  const box = new AddOutbox(storage, new PlannerClient(async () => { requests++; return jsonResponse({}); }));
  await expect(box.enqueue(pending)).rejects.toThrow("disk full");
  expect(requests).toBe(0);
});
test("only the owning grant replays its adds; a wrong receipt never drains one", async () => {
  const storage = memory();
  let requests = 0;
  const box = new AddOutbox(storage, new PlannerClient(async () => { requests++; return jsonResponse({ kind: "receipt", operationId: "wrong", committedRevision: 5 }); }));
  await box.enqueue(pending);
  // A different grant's sign-in must not replay grant-a's add, not even
  // accidentally with its own token.
  await box.resend("grant-b", "token-b");
  expect(requests).toBe(0);
  // A receipt naming another operation leaves the add stored for a retry.
  await box.resend("grant-a", "token-a");
  expect(requests).toBe(1);
  expect(await storage.get("add:op-restart")).toEqual(pending);
});
