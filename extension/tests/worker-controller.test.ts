import { expect, test } from "bun:test";
import { WorkerController, type DeviceAuth } from "../src/lib/worker-controller";
import { GrantRevoked } from "../src/lib/device-client";
import { AuthenticationRequired, type PlannerApi } from "../src/lib/planner-client";
import type { LocalStore } from "../src/lib/outbox";
import type { AddOptionCommand, DeviceScopeName, DeviceTokenResponse, Preview, StoredGrant } from "../src/shared/extension-api";
import type { PanelState } from "../src/shared/panel";
import { StudentError } from "../src/shared/student-error";
const ref = { term: "spring-2027", classNumber: "15802" };
const tokens: DeviceTokenResponse = { accessToken: "token-a", refreshToken: "refresh-a", tokenType: "Bearer", expiresIn: 300, scopes: ["schedule:read", "schedule:add-option"] as DeviceScopeName[], grantId: "grant-a" };
const projection: Preview = { scheduleId: "main", optionId: "section-15802", revision: 1, title: "ENGL 1310", conflict: "clear", details: ["Work on Tuesday"] };
function fixture() {
  let now = 1_000_000;
  // The seeded grant's access token lives 300s from `now`, comfortably above
  // the refresh margin; tests that exercise expiry overwrite it.
  const values: Record<string, unknown> = { "device-grant": { ...tokens, scheduleId: "main", accessExpiresAt: now + 300_000 }, "proposed-section": ref };
  const store: LocalStore = { get: async (k) => structuredClone(values[k]), set: async (k, v) => { values[k] = structuredClone(v); }, remove: async (k) => { delete values[k]; }, all: async () => structuredClone(values) };
  const sent: AddOptionCommand[] = [];
  const revoked: string[] = [];
  const refreshes: string[] = [];
  let changes = 0;
  const api: PlannerApi = { preview: async () => projection, add: async (command) => { sent.push(command); return { kind: "receipt", operationId: command.operationId, committedRevision: 2 }; } };
  const auth: DeviceAuth = {
    signIn: async () => ({ ...tokens, grantId: "renewed", accessToken: "token-b", refreshToken: "refresh-b" }),
    refresh: async (refreshToken) => { refreshes.push(refreshToken); return { ...tokens, accessToken: "token-b", refreshToken: "refresh-b" }; },
    revoke: async (accessToken) => { revoked.push(accessToken); },
  };
  const make = () => new WorkerController(store, api, auth, async () => { changes++; }, () => now);
  return { store, api, auth, make, sent, revoked, refreshes, changes: () => changes, advance: (ms: number) => { now += ms; }, now: () => now };
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
    expect(await f.store.get(`add:${command.operationId}`)).toEqual({ command, grantId: tokens.grantId, ref });
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
test("a lapsed sign-in reveals sign-in while preserving the pending operation", async () => {
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
test("another grant cannot replay or be blocked by a previous grant's pending command", async () => {
  const f = fixture();
  f.api.add = async () => null;
  const worker = f.make();
  await worker.start();
  const current = await state(worker);
  await worker.handle({ type: "panel/confirm", previewId: current.preview!.previewId });
  f.auth.signIn = async () => ({ ...tokens, grantId: "grant-b", accessToken: "token-b", refreshToken: "refresh-b" });
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
  await f.store.set("add:persisted", { command, grantId: tokens.grantId, ref });
  f.api.add = async () => ({ kind: "rejection", operationId: "persisted", reason: "stale-revision" });
  f.api.preview = async () => { throw new Error("offline"); };
  const worker = f.make();
  await worker.start();
  expect(await worker.handle({ type: "panel/retry" })).toMatchObject({ signedIn: true });
  f.api.preview = async () => ({ ...projection, revision: 2 });
  expect(await state(worker)).toMatchObject({ preview: { preview: { revision: 2 } } });
});
test("an access token inside the refresh margin refreshes before use, and a fresh one does not", async () => {
  const f = fixture();
  const seen: string[] = [];
  f.api.preview = async (_ref, token) => { seen.push(token); return projection; };
  const worker = f.make();
  await worker.start();
  await state(worker);
  expect(f.refreshes).toEqual([]);
  expect(seen).toEqual(["token-a"]);
  // 300s life minus 271s leaves 29s: inside the 30s margin, so the next use
  // rotates the pair first and the planner sees only the new token.
  f.advance(271_000);
  expect(await state(worker)).toMatchObject({ signedIn: true });
  expect(f.refreshes).toEqual(["refresh-a"]);
  expect(seen).toEqual(["token-a", "token-b"]);
  const stored = (await f.store.get("device-grant")) as StoredGrant;
  expect(stored.accessToken).toBe("token-b");
  expect(stored.refreshToken).toBe("refresh-b");
  expect(stored.accessExpiresAt).toBe(f.now() + 300_000);
});
test("concurrent uses share one refresh, so the server never sees a reused token", async () => {
  const f = fixture();
  let refreshCount = 0;
  let release: () => void = () => { };
  const gate = new Promise<void>(resolve => { release = resolve; });
  f.auth.refresh = async () => { refreshCount++; await gate; return { ...tokens, accessToken: "token-b", refreshToken: "refresh-b" }; };
  // Seed a grant already inside the margin, so any session() call refreshes.
  await f.store.set("device-grant", { ...tokens, scheduleId: "main", accessExpiresAt: f.now() + 5_000 });
  const worker = f.make();
  const started = worker.start();
  // Both markers must join the in-flight rotation instead of starting another.
  const first = worker.handle({ type: "marker/request", ref });
  const second = worker.handle({ type: "marker/request", ref });
  await new Promise(resolve => setTimeout(resolve, 0));
  release();
  await started;
  await Promise.all([first, second]);
  expect(refreshCount).toBe(1);
});
test("a dead refresh token signs out, clears storage, and sign-in works again", async () => {
  const f = fixture();
  await f.store.set("device-grant", { ...tokens, scheduleId: "main", accessExpiresAt: f.now() + 5_000 });
  f.auth.refresh = async () => { throw new GrantRevoked(); };
  f.api.preview = async () => { throw new Error("session() must throw before any authenticated call"); };
  const worker = f.make();
  await worker.start();
  const reply = await state(worker);
  expect(reply.signedIn).toBe(false);
  expect(await f.store.get("device-grant")).toBeUndefined();
  f.auth.signIn = async () => ({ ...tokens });
  await worker.handle({ type: "panel/sign-in" });
  expect((await state(worker)).signedIn).toBe(true);
  expect(await f.store.get("device-grant")).toMatchObject({ accessToken: "token-a", grantId: "grant-a" });
});
test("an unreachable refresh keeps the grant and reports the outage, not sign-out", async () => {
  const f = fixture();
  await f.store.set("device-grant", { ...tokens, scheduleId: "main", accessExpiresAt: f.now() + 5_000 });
  f.auth.refresh = async () => { throw new StudentError("Couldn't reach UNTangle. Check your connection and retry."); };
  const worker = f.make();
  await worker.start();
  const reply = await state(worker);
  // The pair survives for the next attempt; the notice is student copy.
  expect(reply.signedIn).toBe(true);
  expect(reply.outcome).toBe("error");
  expect(reply.notice).toBe("Couldn't reach UNTangle. Check your connection and retry.");
  expect(await f.store.get("device-grant")).toMatchObject({ accessToken: "token-a" });
});
test("signing out revokes the grant and clears the tokens even if the server cannot be reached", async () => {
  const f = fixture();
  f.auth.revoke = async (accessToken) => { f.revoked.push(accessToken); throw new StudentError("Couldn't reach UNTangle. Check your connection and retry."); };
  const worker = f.make();
  await worker.start();
  await worker.handle({ type: "panel/sign-out" });
  expect(f.revoked).toEqual(["token-a"]);
  expect((await state(worker)).signedIn).toBe(false);
  expect(await f.store.get("device-grant")).toBeUndefined();
});
