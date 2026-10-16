import { expect, test } from "bun:test";
import { WorkerController, type DeviceAuth, type SessionStore } from "../src/lib/worker-controller";
import { AuthenticationRequired, type PlannerApi } from "../src/lib/planner-client";
import type { LocalStore } from "../src/lib/outbox";
import type { DeviceScopeName, DeviceTokenResponse, Preview } from "../src/shared/extension-api";
import type { PanelState } from "../src/shared/panel";
import { StudentError } from "../src/shared/student-error";
const ref = { term: "spring-2027", classNumber: "15802" };
const tokens: DeviceTokenResponse = { accessToken: "a".repeat(43), refreshToken: "r".repeat(43), tokenType: "Bearer", expiresIn: 300, scopes: ["schedule:read", "schedule:add-option"] as DeviceScopeName[], grantId: "grant-a" };
const storedGrant = { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, grantId: tokens.grantId, scopes: [...tokens.scopes], scheduleId: "main", accessExpiresAt: Date.now() + 300_000 };
const projection: Preview = { scheduleId: "main", optionId: "section-15802", revision: 1, title: "ENGL 1310", conflict: "clear", details: [] };
const signIns: SessionStore = { get: async () => undefined, set: async () => { }, remove: async () => { } };
function fixture() {
  const values: Record<string, unknown> = { "device-grant": structuredClone(storedGrant), "proposed-section": ref };
  const store: LocalStore = { get: async (k) => structuredClone(values[k]), set: async (k, v) => { values[k] = structuredClone(v); }, remove: async (k) => { delete values[k]; }, all: async () => structuredClone(values) };
  let changes = 0;
  const api: PlannerApi = { preview: async () => projection, add: async () => null };
  const auth: DeviceAuth = { start: async () => { throw new Error("no sign-in in this test"); }, poll: async () => ({ ...tokens }), refresh: async () => ({ ...tokens }), revoke: async () => { } };
  const worker = new WorkerController(store, signIns, api, auth, async () => { changes++; });
  return { store, api, auth, worker, changes: () => changes };
}
async function status(worker: WorkerController): Promise<PanelState> {
  // SAFETY: panel/status always answers with PanelState.
  return await worker.handle({ type: "panel/status" }) as PanelState;
}
async function confirm(worker: WorkerController): Promise<PanelState> {
  const current = await status(worker);
  // SAFETY: panel/confirm always answers with PanelState.
  return await worker.handle({ type: "panel/confirm", previewId: current.preview!.previewId }) as PanelState;
}
test("each add result names its outcome", async () => {
  const receipt = fixture();
  receipt.api.add = async (command) => ({ kind: "receipt", operationId: command.operationId, committedRevision: 2 });
  await receipt.worker.start();
  expect(await status(receipt.worker)).toMatchObject({ outcome: "none" });
  expect(await confirm(receipt.worker)).toMatchObject({ outcome: "added", preview: null, pending: 0 });

  const stale = fixture();
  stale.api.add = async (command) => ({ kind: "rejection", operationId: command.operationId, reason: "stale-revision" });
  await stale.worker.start();
  expect(await confirm(stale.worker)).toMatchObject({ outcome: "changed", preview: { preview: { title: "ENGL 1310" } } });

  const refused = fixture();
  refused.api.add = async (command) => ({ kind: "rejection", operationId: command.operationId, reason: "forbidden" });
  await refused.worker.start();
  expect(await confirm(refused.worker)).toMatchObject({ outcome: "rejected", preview: null });
});
test("an add with no receipt waits, and its page marker learns of it", async () => {
  const f = fixture();
  await f.worker.start();
  expect(await confirm(f.worker)).toMatchObject({ outcome: "waiting", pending: 1 });
  expect(f.changes()).toBe(1);
  expect(await f.worker.handle({ type: "marker/request", ref })).toEqual({ marker: "pending" });
  expect(await f.worker.handle({ type: "marker/request", ref: { ...ref, classNumber: "14523" } })).toEqual({ marker: "clear" });
});
test("a section already in Main marks as added", async () => {
  const f = fixture();
  f.api.preview = async () => ({ ...projection, conflict: "conflict", inSchedule: true });
  await f.worker.start();
  expect(await f.worker.handle({ type: "marker/request", ref })).toEqual({ marker: "added" });
});
test("an internal error's message never reaches the panel", async () => {
  const f = fixture();
  f.api.preview = async () => { throw new Error("Invalid extension preview response"); };
  await f.worker.start();
  const failed = await status(f.worker);
  expect(failed.outcome).toBe("error");
  expect(failed.notice).toBe("Couldn't load this from UNTangle. Retry in a moment.");
  f.api.preview = async () => { throw new StudentError("Couldn't load Main from UNTangle. Check your connection and retry."); };
  expect((await status(f.worker)).notice).toBe("Couldn't load Main from UNTangle. Check your connection and retry.");
});
test("a failed sign-in gets sign-in copy, not the browser's message", async () => {
  const f = fixture();
  await f.store.remove("device-grant");
  f.auth.start = async () => { throw new Error("The user did not approve access."); };
  const worker = f.worker;
  await worker.start();
  expect(await worker.handle({ type: "panel/sign-in" })).toMatchObject({ signedIn: false, outcome: "error", notice: "Sign-in didn't finish. Sign in again." });
});
test("an add the lapsed grant can't send is discarded and counted, not left waiting for a sign-in", async () => {
  const f = fixture();
  await f.worker.start();
  f.api.add = async () => { throw new AuthenticationRequired(); };
  expect(await confirm(f.worker)).toMatchObject({ signedIn: false, pending: 0, discarded: 1, outcome: "none" });
});
test("a status read while another request holds the worker says so", async () => {
  const f = fixture();
  let finish: (value: Preview) => void = () => { };
  await f.worker.start();
  f.api.preview = () => new Promise(resolve => { finish = resolve; });
  const loading = f.worker.handle({ type: "panel/status" });
  expect(await status(f.worker)).toMatchObject({ working: true });
  finish(projection);
  expect(await loading).toMatchObject({ working: false, signedIn: true });
});
