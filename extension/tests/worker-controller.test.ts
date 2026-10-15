import { expect, test } from "bun:test";
import { WorkerController } from "../src/lib/worker-controller";
import { AuthenticationRequired, type PlannerApi } from "../src/lib/planner-client";
import type { LocalStore } from "../src/lib/outbox";
import type { AddOptionCommand, DeviceGrant, Preview } from "../src/shared/extension-api";
import type { PanelState } from "../src/shared/panel";
const ref = { term: "spring-2027", classNumber: "15802" };
const grant: DeviceGrant = { accessToken: "token-a", grantId: "grant-a", accountId: "account-a", expiresAt: Date.now() + 3600000 };
const projection: Preview = { scheduleId: "main", optionId: "section-15802", revision: 1, title: "ENGL 1310", conflict: "clear", details: ["Work on Tuesday"] };
function fixture() {
  const values: Record<string, unknown> = { "device-grant": grant, "proposed-section": ref };
  const store: LocalStore = { get: async (k) => structuredClone(values[k]), set: async (k, v) => { values[k] = structuredClone(v); }, remove: async (k) => { delete values[k]; }, all: async () => structuredClone(values) };
  const sent: AddOptionCommand[] = [];
  let changes = 0;
  const api: PlannerApi = { preview: async () => projection, add: async (command) => { sent.push(command); return { kind: "receipt", operationId: command.operationId, committedRevision: 2 }; } };
  const auth = { signIn: async () => ({ ...grant, grantId: "renewed", accessToken: "token-b" }) };
  const make = () => new WorkerController(store, api, auth, async () => { changes++; });
  return { store, api, auth, make, sent, changes: () => changes };
}
async function state(worker: WorkerController): Promise<PanelState> {
  const reply = await worker.handle({ type: "panel/status" });
  // SAFETY: This helper only sends panel/status, whose result is PanelState.
  return reply as PanelState;
}
test("a page proposal returns no private preview and never sends a command", async () => {
  const f = fixture();
  const worker = f.make();
  await worker.start();
  expect(await worker.handle({ type: "proposal/request", ref })).toEqual({ proposed: true });
  expect(await worker.handle({ type: "marker/request", ref })).toEqual({ marker: "clear" });
  expect(f.sent).toEqual([]);
  expect((await state(worker)).preview?.preview.details).toEqual(["Work on Tuesday"]);
});
test("only the displayed preview id can confirm, and storage already holds the exact command at send", async () => {
  const f = fixture();
  const worker = f.make();
  await worker.start();
  const current = await state(worker);
  await worker.handle({ type: "panel/confirm", previewId: "forged" });
  expect(f.sent).toEqual([]);
  f.api.add = async (command) => {
    expect(await f.store.get(`add:${command.operationId}`)).toEqual({ command, accountId: grant.accountId, ref });
    f.sent.push(command);
    return { kind: "receipt", operationId: command.operationId, committedRevision: 2 };
  };
  await worker.handle({ type: "panel/confirm", previewId: current.preview!.previewId });
  expect(f.sent).toHaveLength(1);
  expect(f.sent[0].expectedRevision).toBe(1);
  await worker.handle({ type: "panel/confirm", previewId: current.preview!.previewId });
  expect(f.sent).toHaveLength(1);
  expect(f.changes()).toBe(1);
});
test("stale rejection shows a new preview and requires a fresh confirmation", async () => {
  const f = fixture();
  const worker = f.make();
  await worker.start();
  const current = await state(worker);
  f.api.add = async (command) => { f.sent.push(command); return { kind: "rejection", operationId: command.operationId, reason: "stale-revision" }; };
  f.api.preview = async () => ({ ...projection, revision: 2 });
  const reply = await worker.handle({ type: "panel/confirm", previewId: current.preview!.previewId });
  expect(reply).toMatchObject({ preview: { preview: { revision: 2 } }, pending: 0 });
  expect(f.sent).toHaveLength(1);
  await worker.handle({ type: "panel/confirm", previewId: current.preview!.previewId });
  expect(f.sent).toHaveLength(1);
});
test("a restarted worker replays the same persisted add without a second confirmation", async () => {
  const f = fixture();
  let lost = true;
  f.api.add = async (command) => { f.sent.push(command); if (lost)
    return null; return { kind: "receipt", operationId: command.operationId, committedRevision: 2 }; };
  const worker = f.make();
  await worker.start();
  const current = await state(worker);
  await worker.handle({ type: "panel/confirm", previewId: current.preview!.previewId });
  expect((await state(worker)).pending).toBe(1);
  lost = false;
  const restarted = f.make();
  await restarted.start();
  expect(f.sent).toHaveLength(2);
  expect(f.sent[0]).toEqual(f.sent[1]);
  expect((await state(restarted)).pending).toBe(0);
});
test("a revoked token reveals sign-in while preserving the pending operation", async () => {
  const f = fixture();
  const worker = f.make();
  await worker.start();
  const current = await state(worker);
  f.api.add = async () => { throw new AuthenticationRequired(); };
  await worker.handle({ type: "panel/confirm", previewId: current.preview!.previewId });
  expect(await state(worker)).toMatchObject({ signedIn: false, preview: null });
  expect(Object.keys(await f.store.all()).filter(k => k.startsWith("add:"))).toHaveLength(1);
  f.api.add = async (command) => { f.sent.push(command); return { kind: "receipt", operationId: command.operationId, committedRevision: 2 }; };
  await worker.handle({ type: "panel/sign-in" });
  expect(f.sent).toHaveLength(1);
  expect((await state(worker)).signedIn).toBe(true);
});
test("another account cannot replay or be blocked by a previous account's pending command", async () => {
  const f = fixture();
  f.api.add = async () => null;
  const worker = f.make();
  await worker.start();
  const current = await state(worker);
  await worker.handle({ type: "panel/confirm", previewId: current.preview!.previewId });
  f.auth.signIn = async () => ({ ...grant, accountId: "account-b", grantId: "grant-b" });
  f.api.add = async (command) => { f.sent.push(command); return { kind: "receipt", operationId: command.operationId, committedRevision: 2 }; };
  await worker.handle({ type: "panel/sign-in" });
  expect(f.sent).toEqual([]);
  const next = await state(worker);
  expect(next.pending).toBe(0);
  await worker.handle({ type: "panel/confirm", previewId: next.preview!.previewId });
  expect(f.sent).toHaveLength(1);
  expect(Object.keys(await f.store.all()).filter(k => k.startsWith("add:"))).toHaveLength(1);
});
test("failed preview during stale startup replay does not poison future requests", async () => {
  const f = fixture();
  const command: AddOptionCommand = { command: "add-option", operationId: "persisted", scheduleId: "main", optionId: "section-15802", expectedRevision: 0 };
  await f.store.set("add:persisted", { command, accountId: grant.accountId, ref });
  f.api.add = async () => ({ kind: "rejection", operationId: "persisted", reason: "stale-revision" });
  f.api.preview = async () => { throw new Error("offline"); };
  const worker = f.make();
  await worker.start();
  expect(await worker.handle({ type: "panel/retry" })).toMatchObject({ signedIn: true });
  f.api.preview = async () => ({ ...projection, revision: 2 });
  expect(await state(worker)).toMatchObject({ preview: { preview: { revision: 2 } } });
});
