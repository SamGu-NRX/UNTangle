import { describe, expect, test } from "bun:test";
import { createDeviceGrants, pkceChallenge, securityChangeTimeout } from "@/server/auth/device-grants";
import type { DeviceClientKind } from "../../../packages/contracts/src/device-grant";
import { MemoryDeviceStore } from "./memory-store";

const verifier = "a".repeat(43);
const day = 86400_000;
function setup() {
  let time = Date.UTC(2026, 9, 15);
  const store = new MemoryDeviceStore(() => time);
  const service = createDeviceGrants(store, () => time);
  const advance = (ms: number) => { time += ms; };
  async function start(kind: DeviceClientKind = "mobile", scheduleId = "alice-schedule") {
    const common = { codeChallenge: pkceChallenge(verifier), codeChallengeMethod: "S256" as const };
    return service.start(kind === "mobile" ? { ...common, clientKind: "mobile" } : { ...common, clientKind: "extension", scheduleId });
  }
  async function issue(kind: DeviceClientKind = "mobile", userId = "alice", scheduleId = "alice-schedule") {
    const started = await start(kind, scheduleId);
    expect(await service.approve(started.userCode, userId, "approve", await service.readSecurityGeneration(userId))).toEqual({ status: "approved" });
    return service.exchange(started.deviceCode, verifier);
  }
  return { store, service, advance, start, issue };
}

const invalidToken = { code: "invalid_token", status: 401 };
const insufficientScope = { code: "insufficient_scope", status: 403 };
const accountChanged = { code: "account_changed", status: 409 };

describe("device grant approval and PKCE", () => {
  test("PKCE mismatch is rejected without consuming the valid exchange", async () => {
    const t = setup();
    const started = await t.start();
    expect(await t.service.inspect(started.userCode)).toEqual({ clientKind: "mobile", scopes: ["documents:read", "documents:write"], userCode: started.userCode, scheduleId: null });
    await t.service.approve(started.userCode, "alice", "approve");
    await expect(t.service.exchange(started.deviceCode, "b".repeat(43))).rejects.toMatchObject({ code: "invalid_grant", status: 400 });
    const tokens = await t.service.exchange(started.deviceCode, verifier);
    expect(await t.service.authenticate(tokens.accessToken, "documents:read")).toMatchObject({ userId: "alice", clientKind: "mobile" });
    expect(tokens.expiresIn).toBe(300);
    expect(tokens.tokenType).toBe("Bearer");
  });

  test("pending and denied grants cannot issue tokens", async () => {
    const t = setup();
    const started = await t.start();
    await expect(t.service.exchange(started.deviceCode, verifier)).rejects.toMatchObject({ code: "authorization_pending" });
    expect(await t.service.approve(started.userCode, "alice", "deny")).toEqual({ status: "denied" });
    await expect(t.service.exchange(started.deviceCode, verifier)).rejects.toMatchObject({ code: "access_denied" });
    await expect(t.service.approve(started.userCode, "alice", "approve")).rejects.toMatchObject({ code: "invalid_grant" });
    expect(t.store.snapshot().tokens).toHaveLength(0);
  });

  test("pending codes expire at ten minutes; approved codes expire at sixty seconds", async () => {
    const t = setup();
    const pending = await t.start();
    t.advance(600_000);
    await expect(t.service.inspect(pending.userCode)).rejects.toMatchObject({ code: "expired_token" });
    await expect(t.service.approve(pending.userCode, "alice", "approve")).rejects.toMatchObject({ code: "expired_token" });
    const approved = await t.start();
    await t.service.approve(approved.userCode, "alice", "approve");
    t.advance(60_000);
    await expect(t.service.exchange(approved.deviceCode, verifier)).rejects.toMatchObject({ code: "expired_token" });
    expect(t.store.snapshot().tokens).toHaveLength(0);
  });

  test("approval never extends a code beyond its original expiry", async () => {
    const t = setup();
    const started = await t.start();
    t.advance(599_000);
    await t.service.approve(started.userCode, "alice", "approve");
    t.advance(1_000);
    await expect(t.service.exchange(started.deviceCode, verifier)).rejects.toMatchObject({ code: "expired_token" });
  });

  test("device and user codes are single-use", async () => {
    const t = setup();
    const started = await t.start();
    await t.service.approve(started.userCode, "alice", "approve");
    const tokens = await t.service.exchange(started.deviceCode, verifier);
    expect((await t.service.authenticate(tokens.accessToken)).userId).toBe("alice");
    await expect(t.service.exchange(started.deviceCode, verifier)).rejects.toMatchObject({ code: "invalid_grant" });
    await expect(t.service.approve(started.userCode, "bob", "approve")).rejects.toMatchObject({ code: "invalid_grant" });
    expect(t.store.snapshot().tokens).toHaveLength(2);
  });

  test("concurrent exchanges issue exactly one token pair", async () => {
    const t = setup();
    const started = await t.start();
    await t.service.approve(started.userCode, "alice", "approve");
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => t.service.exchange(started.deviceCode, verifier)));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(7);
    expect(t.store.snapshot().tokens).toHaveLength(2);
  });
});

describe("device token rotation and revocation", () => {
  test("rotation replaces the refresh token; reuse revokes every token from that grant", async () => {
    const t = setup();
    const original = await t.issue();
    const rotated = await t.service.refresh(original.refreshToken);
    expect(rotated.grantId).toBe(original.grantId);
    expect(rotated.refreshToken).not.toBe(original.refreshToken);
    expect(rotated.accessToken).not.toBe(original.accessToken);
    expect((await t.service.authenticate(rotated.accessToken)).userId).toBe("alice");
    await expect(t.service.refresh(original.refreshToken)).rejects.toMatchObject(invalidToken);
    await expect(t.service.authenticate(original.accessToken)).rejects.toMatchObject(invalidToken);
    await expect(t.service.authenticate(rotated.accessToken)).rejects.toMatchObject(invalidToken);
    await expect(t.service.refresh(rotated.refreshToken)).rejects.toMatchObject(invalidToken);
    expect(t.store.snapshot().grants[0].status).toBe("revoked");
  });

  test("concurrent refresh reuse revokes the pair that won the rotation", async () => {
    const t = setup();
    const original = await t.issue();
    const results = await Promise.allSettled([t.service.refresh(original.refreshToken), t.service.refresh(original.refreshToken)]);
    const successes = results.filter((result) => result.status === "fulfilled");
    expect(successes).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const winner = successes[0];
    if (winner.status !== "fulfilled") throw new Error("expected a completed rotation");
    await expect(t.service.authenticate(winner.value.accessToken)).rejects.toMatchObject(invalidToken);
    await expect(t.service.refresh(winner.value.refreshToken)).rejects.toMatchObject(invalidToken);
    expect(t.store.snapshot().grants[0].status).toBe("revoked");
  });

  test("an access token cannot refresh and a refresh token cannot authenticate", async () => {
    const t = setup();
    const tokens = await t.issue();
    await expect(t.service.refresh(tokens.accessToken)).rejects.toMatchObject(invalidToken);
    await expect(t.service.authenticate(tokens.refreshToken)).rejects.toMatchObject(invalidToken);
    expect((await t.service.authenticate(tokens.accessToken)).userId).toBe("alice");
  });

  test("revoke ends access and refresh while preserving another grant", async () => {
    const t = setup();
    const first = await t.issue();
    const second = await t.issue();
    expect(await t.service.revoke(first.accessToken)).toEqual({ revoked: true });
    await expect(t.service.authenticate(first.accessToken)).rejects.toMatchObject(invalidToken);
    await expect(t.service.refresh(first.refreshToken)).rejects.toMatchObject(invalidToken);
    expect((await t.service.authenticate(second.accessToken)).userId).toBe("alice");
  });

  test("generation bumps revoke all of one account's grants, including rotated and approved tokens", async () => {
    const t = setup();
    const mobile = await t.issue();
    const extension = await t.issue("extension");
    const rotated = await t.service.refresh(mobile.refreshToken);
    const bob = await t.issue("mobile", "bob");
    const pending = await t.start();
    await t.service.approve(pending.userCode, "alice", "approve");
    await t.service.bumpSecurityGeneration("alice");
    for (const tokens of [mobile, extension, rotated]) {
      await expect(t.service.authenticate(tokens.accessToken)).rejects.toMatchObject(invalidToken);
      await expect(t.service.refresh(tokens.refreshToken)).rejects.toMatchObject(invalidToken);
    }
    await expect(t.service.exchange(pending.deviceCode, verifier)).rejects.toMatchObject({ code: "invalid_grant" });
    expect((await t.service.authenticate(bob.accessToken)).userId).toBe("bob");
    const newAlice = await t.issue();
    expect((await t.service.authenticate(newAlice.accessToken)).userId).toBe("alice");
    await t.service.bumpSecurityGeneration("alice");
    await expect(t.service.authenticate(newAlice.accessToken)).rejects.toMatchObject(invalidToken);
    expect((await t.service.authenticate(bob.accessToken)).userId).toBe("bob");
  });

  test("one security change runs at a time, and it blocks only its own account", async () => {
    const t = setup();
    const alice = await t.issue();
    const bob = await t.issue("mobile", "bob");
    const change = await t.service.beginSecurityChange("alice");
    await expect(t.service.beginSecurityChange("alice")).rejects.toMatchObject(accountChanged);
    await expect(t.service.readSecurityGeneration("alice")).rejects.toMatchObject(invalidToken);
    await expect(t.service.authenticate(alice.accessToken)).rejects.toMatchObject(invalidToken);
    expect((await t.service.authenticate(bob.accessToken)).userId).toBe("bob");
    await t.service.finishSecurityChange("alice", change);
    expect(await t.service.readSecurityGeneration("alice")).toBe(2);
    await expect(t.service.refresh(alice.refreshToken)).rejects.toMatchObject(invalidToken);
    const fresh = await t.issue();
    expect((await t.service.authenticate(fresh.accessToken)).userId).toBe("alice");
    await expect(t.service.finishSecurityChange("carol", change)).rejects.toThrow("No account security change to finish");
  });

  test("a change that names the caller's generation is refused once the generation has moved", async () => {
    const t = setup();
    await t.service.bumpSecurityGeneration("alice");
    await expect(t.service.beginSecurityChange("alice", 0)).rejects.toMatchObject(accountChanged);
    expect(await t.service.readSecurityGeneration("alice")).toBe(1);
    const change = await t.service.beginSecurityChange("alice", 1);
    await t.service.finishSecurityChange("alice", change);
    expect(await t.service.readSecurityGeneration("alice")).toBe(3);
  });

  test("an abandoned change stops blocking after its timeout, and the tokens it ended stay ended", async () => {
    const t = setup();
    const alice = await t.issue();
    const abandoned = await t.service.beginSecurityChange("alice");
    t.advance(securityChangeTimeout - 1);
    await expect(t.service.readSecurityGeneration("alice")).rejects.toMatchObject(invalidToken);
    await expect(t.service.beginSecurityChange("alice")).rejects.toMatchObject(accountChanged);
    t.advance(1);
    expect(await t.service.readSecurityGeneration("alice")).toBe(1);
    await expect(t.service.authenticate(alice.accessToken)).rejects.toMatchObject(invalidToken);
    await expect(t.service.refresh(alice.refreshToken)).rejects.toMatchObject(invalidToken);
    const next = await t.service.beginSecurityChange("alice");
    // The abandoned change finishing late still moves the generation, but
    // can't close the change that replaced it.
    await t.service.finishSecurityChange("alice", abandoned);
    await expect(t.service.readSecurityGeneration("alice")).rejects.toMatchObject(invalidToken);
    await t.service.finishSecurityChange("alice", next);
    expect(await t.service.readSecurityGeneration("alice")).toBe(4);
    const fresh = await t.issue();
    expect((await t.service.authenticate(fresh.accessToken)).userId).toBe("alice");
  });

  test("storage holds only token and grant-code hashes", async () => {
    const t = setup();
    const started = await t.start();
    await t.service.approve(started.userCode, "alice", "approve");
    const tokens = await t.service.exchange(started.deviceCode, verifier);
    const persisted = JSON.stringify(t.store.snapshot());
    for (const secret of [started.deviceCode, started.userCode, tokens.accessToken, tokens.refreshToken]) expect(persisted).not.toContain(secret);
    expect(t.store.snapshot().tokens).toHaveLength(2);
    for (const token of t.store.snapshot().tokens) expect(token.hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("device scopes and user identity", () => {
  test("extension access is restricted to the approved schedule and its two scopes", async () => {
    const t = setup();
    const tokens = await t.issue("extension", "alice", "approved-schedule");
    for (const scope of ["schedule:read", "schedule:add-option"] as const) {
      expect(await t.service.authenticate(tokens.accessToken, scope, "approved-schedule")).toMatchObject({ userId: "alice", clientKind: "extension", scheduleId: "approved-schedule", scopes: ["schedule:read", "schedule:add-option"] });
      await expect(t.service.authenticate(tokens.accessToken, scope, "another-schedule")).rejects.toMatchObject(insufficientScope);
      await expect(t.service.authenticate(tokens.accessToken, scope)).rejects.toMatchObject(insufficientScope);
    }
    for (const scope of ["documents:read", "documents:write"] as const)
      await expect(t.service.authenticate(tokens.accessToken, scope, "approved-schedule")).rejects.toMatchObject(insufficientScope);
  });

  test("mobile grants carry the granting user's identity and document scopes only", async () => {
    const t = setup();
    const alice = await t.issue("mobile", "alice");
    const bob = await t.issue("mobile", "bob");
    for (const scope of ["documents:read", "documents:write"] as const) {
      expect((await t.service.authenticate(alice.accessToken, scope)).userId).toBe("alice");
      expect((await t.service.authenticate(bob.accessToken, scope)).userId).toBe("bob");
    }
    await expect(t.service.authenticate(alice.accessToken, "schedule:read", "bob-schedule")).rejects.toMatchObject(insufficientScope);
    expect(alice.scopes).toEqual(["documents:read", "documents:write"]);
  });
});

describe("device grant lifetimes", () => {
  test("access expires at five minutes while an unexpired refresh still works", async () => {
    const t = setup();
    const tokens = await t.issue();
    t.advance(299_999);
    expect((await t.service.authenticate(tokens.accessToken)).userId).toBe("alice");
    t.advance(1);
    await expect(t.service.authenticate(tokens.accessToken)).rejects.toMatchObject(invalidToken);
    const refreshed = await t.service.refresh(tokens.refreshToken);
    expect((await t.service.authenticate(refreshed.accessToken)).userId).toBe("alice");
  });

  test("mobile grants expire after seven idle days; rotation extends idle time", async () => {
    const idle = setup();
    const expired = await idle.issue();
    idle.advance(7 * day);
    await expect(idle.service.refresh(expired.refreshToken)).rejects.toMatchObject(invalidToken);
    const active = setup();
    const first = await active.issue();
    active.advance(6 * day);
    const second = await active.service.refresh(first.refreshToken);
    active.advance(6 * day);
    const third = await active.service.refresh(second.refreshToken);
    expect((await active.service.authenticate(third.accessToken)).userId).toBe("alice");
    active.advance(7 * day);
    await expect(active.service.refresh(third.refreshToken)).rejects.toMatchObject(invalidToken);
  });

  test("extension grants remain refreshable after seven days but expire at thirty absolute days", async () => {
    const t = setup();
    const original = await t.issue("extension");
    t.advance(8 * day);
    const second = await t.service.refresh(original.refreshToken);
    expect((await t.service.authenticate(second.accessToken, "schedule:read", "alice-schedule")).userId).toBe("alice");
    t.advance(22 * day - 1_000);
    const last = await t.service.refresh(second.refreshToken);
    expect(last.expiresIn).toBe(1);
    t.advance(1_000);
    await expect(t.service.authenticate(last.accessToken)).rejects.toMatchObject(invalidToken);
    await expect(t.service.refresh(last.refreshToken)).rejects.toMatchObject(invalidToken);
  });

  test("active mobile rotation never extends the thirty-day absolute lifetime", async () => {
    const t = setup();
    let tokens = await t.issue();
    for (let i = 0; i < 4; i++) {
      t.advance(6 * day);
      tokens = await t.service.refresh(tokens.refreshToken);
    }
    t.advance(6 * day - 1_000);
    tokens = await t.service.refresh(tokens.refreshToken);
    expect(tokens.expiresIn).toBe(1);
    t.advance(1_000);
    await expect(t.service.refresh(tokens.refreshToken)).rejects.toMatchObject(invalidToken);
  });
});
