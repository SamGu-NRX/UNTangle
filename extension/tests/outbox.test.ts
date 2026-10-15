import { expect, test } from "bun:test";
import { AddOutbox, type LocalStore, type PendingAdd } from "../src/lib/outbox";
import { PlannerClient } from "../src/lib/planner-client";
import { jsonResponse } from "./helpers";
const command = { command: "add-option" as const, operationId: "op-restart", scheduleId: "main", optionId: "option-1", expectedRevision: 4 };
const pending: PendingAdd = { command, accountId: "account-a", ref: { term: "spring-2027", classNumber: "14523" } };
const grant = { accessToken: "token", grantId: "grant-a", accountId: "account-a", expiresAt: Date.now() + 600000 };
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
    seen.push(JSON.parse(String(init?.body)));
    if (offline)
      throw new Error("response lost after server commit");
    return jsonResponse({ kind: "receipt", operationId: command.operationId, committedRevision: 5 });
  });
  const firstWorker = new AddOutbox(storage, client);
  await firstWorker.enqueue(pending);
  expect(await firstWorker.send(pending, grant)).toBeNull();
  expect(await storage.get("add:op-restart")).toEqual(pending);
  offline = false;
  await new AddOutbox(storage, client).resend(grant);
  expect(seen).toEqual([command, command]);
  expect(await storage.get("add:op-restart")).toBeUndefined();
});
test("a rejection removes the operation and asks for a fresh preview", async () => {
  const storage = memory();
  const fresh: unknown[] = [];
  const box = new AddOutbox(storage, new PlannerClient(async () => jsonResponse({ kind: "rejection", operationId: command.operationId, reason: "stale-revision" }, 409)));
  await box.enqueue(pending);
  await box.resend(grant, async (p) => { fresh.push(p.ref); });
  expect(fresh).toEqual([pending.ref]);
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
test("new accounts, expired grants and invalid receipts cannot drain pending commands", async () => {
  const storage = memory();
  let requests = 0;
  const box = new AddOutbox(storage, new PlannerClient(async () => { requests++; return jsonResponse({ kind: "receipt", operationId: "wrong", committedRevision: 5 }); }));
  await box.enqueue(pending);
  await box.resend({ ...grant, accountId: "other-account" });
  await box.resend({ ...grant, expiresAt: 0 });
  expect(requests).toBe(0);
  await box.resend(grant);
  expect(requests).toBe(1);
  expect(await storage.get("add:op-restart")).toEqual(pending);
});
