import { describe, expect, test } from "bun:test";
import { setPasswordHandler } from "@/lib/account-password";
import { createDeviceGrants, pkceChallenge } from "@/server/auth/device-grants";
import { createDeviceHttp } from "@/server/auth/device-http";
import type { DeviceGrants } from "@/server/auth/device-grants";
import { MemoryDeviceStore } from "../device-grants/memory-store";
import { BASE, VICTIM, cookieFrom, setup } from "./fixtures";

const verifier = "x".repeat(43);
const password = "owner-password-123";

async function devices(service: DeviceGrants, userId: string) {
  const common = { codeChallenge: pkceChallenge(verifier), codeChallengeMethod: "S256" as const };
  const mobile = await service.start({ ...common, clientKind: "mobile" });
  const extension = await service.start({ ...common, clientKind: "extension", scheduleId: `${userId}-schedule` });
  const tokens = [];
  for (const grant of [mobile, extension]) {
    await service.approve(grant.userCode, userId, "approve", await service.readSecurityGeneration(userId));
    const original = await service.exchange(grant.deviceCode, verifier);
    const rotated = await service.refresh(original.refreshToken);
    tokens.push(original, rotated);
  }
  return tokens;
}

async function otpSignIn(t: ReturnType<typeof setup>) {
  expect((await t.post("/email-otp/send-verification-otp", { email: VICTIM, type: "sign-in" })).status).toBe(200);
  const response = await t.post("/sign-in/email-otp", { email: VICTIM, otp: t.lastLink("email-code") });
  expect(response.status).toBe(200);
  return cookieFrom(response);
}

function passwordRequest(cookie: string) {
  return new Request(`${BASE}/api/account/set-password`, {
    method: "POST", headers: { origin: BASE, "content-type": "application/json", cookie },
    body: JSON.stringify({ newPassword: password }),
  });
}

async function fixture(unverified = false) {
  const store = new MemoryDeviceStore();
  const service = createDeviceGrants(store);
  const t = setup(undefined, service.bumpSecurityGeneration, service.readSecurityGeneration, { beginSecurityChange: service.beginSecurityChange, finishSecurityChange: service.finishSecurityChange });
  const ctx = await t.auth.$context;
  let cookie = "";
  let userId: string;
  if (unverified) {
    const user = await ctx.internalAdapter.createUser({ email: VICTIM, name: "Victim", emailVerified: false });
    userId = user.id;
    await ctx.internalAdapter.createAccount({ userId, providerId: "credential", accountId: userId, password: await ctx.password.hash("attacker-password") });
    await ctx.internalAdapter.createSession(userId);
  } else {
    cookie = await otpSignIn(t);
    userId = (t.store.user as { id: string }[])[0].id;
  }
  const bob = await ctx.internalAdapter.createUser({ email: "bob@my.unt.edu", name: "Bob", emailVerified: true });
  async function seed() {
    const victimTokens = await devices(service, userId);
    const bobTokens = await devices(service, bob.id);
    // Confirm both users' mobile and extension tokens work before the event.
    for (const token of victimTokens) expect((await service.authenticate(token.accessToken)).userId).toBe(userId);
    for (const token of bobTokens) expect((await service.authenticate(token.accessToken)).userId).toBe(bob.id);
    return async function assertRevoked() {
      for (const token of victimTokens) {
        await expect(service.authenticate(token.accessToken)).rejects.toMatchObject({ code: "invalid_token", status: 401 });
        await expect(service.refresh(token.refreshToken)).rejects.toMatchObject({ code: "invalid_token", status: 401 });
      }
      for (const token of bobTokens) expect((await service.authenticate(token.accessToken)).userId).toBe(bob.id);
      // Only each grant's latest refresh token may rotate normally.
      for (const token of [bobTokens[1], bobTokens[3]]) {
        const rotated = await service.refresh(token.refreshToken);
        expect((await service.authenticate(rotated.accessToken)).userId).toBe(bob.id);
      }
    };
  }
  return { t, cookie, seed, service, userId };
}

describe("auth security events revoke actual device access and refresh tokens", () => {
  test("setting a password revokes every mobile and extension token for that account", async () => {
    const { t, cookie, seed } = await fixture();
    const assertRevoked = await seed();
    expect((await setPasswordHandler(t.auth, { sendEmail: t.send })(passwordRequest(cookie))).status).toBe(200);
    await assertRevoked();
  });

  test("password reset revokes every mobile and extension token for that account", async () => {
    const { t, cookie, seed } = await fixture();
    expect((await setPasswordHandler(t.auth, { sendEmail: t.send })(passwordRequest(cookie))).status).toBe(200);
    const assertRevoked = await seed();
    expect((await t.post("/request-password-reset", { email: VICTIM, redirectTo: "/forgot-password" })).status).toBe(200);
    const token = new URL(t.lastLink("password-reset")).pathname.split("/").pop()!;
    expect((await t.post("/reset-password", { token, newPassword: "reset-password-456" })).status).toBe(200);
    await assertRevoked();
  });

  test("verified-account recovery revokes every mobile and extension token for that account", async () => {
    const { t, seed } = await fixture();
    const assertRevoked = await seed();
    expect((await t.post("/sign-in/magic-link", { email: VICTIM, callbackURL: "/courses" })).status).toBe(200);
    const recovery = await t.get(t.lastVerifyLink());
    expect(recovery.status).toBe(302);
    expect((await t.session(cookieFrom(recovery)))?.user?.email).toBe(VICTIM);
    await assertRevoked();
  });

  test.each([false, true])("changing the password (revokeOtherSessions: %p) revokes every mobile and extension token for that account", async (revokeOtherSessions) => {
    const { t, cookie, seed, service, userId } = await fixture();
    expect((await setPasswordHandler(t.auth, { sendEmail: t.send })(passwordRequest(cookie))).status).toBe(200);
    const assertRevoked = await seed();
    const before = await service.readSecurityGeneration(userId);
    const changed = await t.post("/change-password", { currentPassword: password, newPassword: "changed-password-456", revokeOtherSessions }, cookie);
    expect(changed.status).toBe(200);
    await assertRevoked();
    // The transition finished: the generation is readable and moved twice.
    expect(await service.readSecurityGeneration(userId)).toBe(before + 2);
    expect((await t.post("/sign-in/email", { email: VICTIM, password })).status).toBe(401);
    if (revokeOtherSessions) {
      expect(await t.session(cookie)).toBeNull();
      const replacement = await t.auth.api.getSession({ headers: new Headers({ cookie: cookieFrom(changed) }) });
      expect(replacement?.session.securityGeneration).toBe(before + 2);
    }
  });

  test("a refused password change leaves device tokens and the generation alone", async () => {
    const { t, cookie, seed, service, userId } = await fixture();
    expect((await setPasswordHandler(t.auth, { sendEmail: t.send })(passwordRequest(cookie))).status).toBe(200);
    await seed();
    const before = await service.readSecurityGeneration(userId);
    expect((await t.post("/change-password", { currentPassword: "wrong-password-000", newPassword: "changed-password-456" }, cookie)).status).toBe(400);
    expect((await t.post("/change-password", { currentPassword: password, newPassword: "short" }, cookie)).status).toBe(400);
    expect(await service.readSecurityGeneration(userId)).toBe(before);
    expect((await t.post("/sign-in/email", { email: VICTIM, password })).status).toBe(200);
  });

  test("sign out everywhere revokes every mobile and extension token for that account", async () => {
    const { t, cookie, seed } = await fixture();
    const assertRevoked = await seed();
    expect((await t.post("/revoke-sessions", {}, cookie)).status).toBe(200);
    expect(await t.session(cookie)).toBeNull();
    await assertRevoked();
  });

  test("OTP cleanup of an unverified account revokes every attacker device token", async () => {
    const { t, seed } = await fixture(true);
    const assertRevoked = await seed();
    const cookie = await otpSignIn(t);
    expect((await t.session(cookie))?.user?.email).toBe(VICTIM);
    expect(t.store.account).toHaveLength(0);
    expect(t.store.session).toHaveLength(1);
    await assertRevoked();
  });

  test("magic-link cleanup of an unverified account revokes every attacker device token", async () => {
    const { t, seed } = await fixture(true);
    const assertRevoked = await seed();
    expect((await t.post("/sign-in/magic-link", { email: VICTIM, callbackURL: "/courses" })).status).toBe(200);
    const recovery = await t.get(t.lastVerifyLink());
    expect(recovery.status).toBe(302);
    expect((await t.session(cookieFrom(recovery)))?.user?.email).toBe(VICTIM);
    expect(t.store.account).toHaveLength(0);
    expect(t.store.session).toHaveLength(1);
    await assertRevoked();
  });
});

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test("a persisted reset transition blocks new sign-ins and delayed old-password approvals", async () => {
  const store = new MemoryDeviceStore();
  const service = createDeviceGrants(store);
  const t = setup(undefined, service.bumpSecurityGeneration, service.readSecurityGeneration, {
    beginSecurityChange: service.beginSecurityChange, finishSecurityChange: service.finishSecurityChange,
  });
  const initialCookie = await otpSignIn(t);
  expect((await setPasswordHandler(t.auth, { sendEmail: t.send })(passwordRequest(initialCookie))).status).toBe(200);
  const userId = (t.store.user as { id: string }[])[0].id;
  const previousTokens = await devices(service, userId);
  const capturedGeneration = await service.readSecurityGeneration(userId);
  await t.post("/request-password-reset", { email: VICTIM, redirectTo: "/forgot-password" });
  const token = new URL(t.lastLink("password-reset")).pathname.split("/").pop()!;
  const ctx = await t.auth.$context;
  const originalHash = ctx.password.hash;
  const originalVerify = ctx.password.verify;
  const hashEntered = deferred(), releaseHash = deferred();
  const verifyEntered = deferred(), releaseVerify = deferred();
  ctx.password.hash = async (value) => {
    if (value === "reset-password-456") { hashEntered.resolve(); await releaseHash.promise; }
    return originalHash(value);
  };
  ctx.password.verify = async (value) => {
    const result = await originalVerify(value);
    verifyEntered.resolve();
    await releaseVerify.promise;
    return result;
  };
  const http = createDeviceHttp({
    grants: service, origin: BASE, extensionOrigins: [],
    session: (request) => t.auth.api.getSession({ headers: request.headers }),
  });
  const approve = (userCode: string, cookie: string) => http.handler("approve")(new Request(`${BASE}/api/device/approve`, {
    method: "POST", headers: { origin: BASE, "content-type": "application/json", "x-untangle-device": "1", cookie },
    body: JSON.stringify({ userCode, expectedUserId: userId, decision: "approve" }),
  }));
  const delayedLogin = t.post("/sign-in/email", { email: VICTIM, password });
  try {
    await verifyEntered.promise;
    const reset = t.post("/reset-password", { token, newPassword: "reset-password-456" });
    await hashEntered.promise;
    expect((await t.post("/sign-in/email", { email: VICTIM, password })).status).toBe(500);
    await expect(service.readSecurityGeneration(userId)).rejects.toMatchObject({ code: "invalid_token", status: 401 });
    const pending = await service.start({ clientKind: "mobile", codeChallenge: pkceChallenge(verifier), codeChallengeMethod: "S256" });
    expect((await approve(pending.userCode, initialCookie)).status).toBe(401);
    for (const tokens of previousTokens)
      await expect(service.authenticate(tokens.accessToken)).rejects.toMatchObject({ code: "invalid_token", status: 401 });
    releaseHash.resolve();
    expect((await reset).status).toBe(200);
    releaseVerify.resolve();
    const delayed = await delayedLogin;
    expect(delayed.status).toBe(200);
    const delayedCookie = cookieFrom(delayed);
    const delayedSession = await t.auth.api.getSession({ headers: new Headers({ cookie: delayedCookie }) });
    expect(delayedSession?.session.securityGeneration).toBe(capturedGeneration);
    expect(await service.readSecurityGeneration(userId)).toBe(capturedGeneration + 2);
    expect((await approve(pending.userCode, delayedCookie)).status).toBe(401);
    for (const tokens of previousTokens) {
      await expect(service.authenticate(tokens.accessToken)).rejects.toMatchObject({ code: "invalid_token" });
      await expect(service.refresh(tokens.refreshToken)).rejects.toMatchObject({ code: "invalid_token" });
    }
    const freshCookie = await otpSignIn(t);
    expect((await approve(pending.userCode, freshCookie)).status).toBe(200);
    const fresh = await service.exchange(pending.deviceCode, verifier);
    expect((await service.authenticate(fresh.accessToken)).userId).toBe(userId);
  } finally {
    releaseHash.resolve();
    releaseVerify.resolve();
    ctx.password.hash = originalHash;
    ctx.password.verify = originalVerify;
  }
});

test("a failed reset completion leaves device access blocked until the persisted transition is repaired", async () => {
  const service = createDeviceGrants(new MemoryDeviceStore());
  const t = setup(undefined, service.bumpSecurityGeneration, service.readSecurityGeneration, {
    beginSecurityChange: service.beginSecurityChange,
    finishSecurityChange: async () => { throw new Error("generation completion unavailable"); },
  });
  const cookie = await otpSignIn(t);
  expect((await setPasswordHandler(t.auth, { sendEmail: t.send })(passwordRequest(cookie))).status).toBe(200);
  const userId = (t.store.user as { id: string }[])[0].id;
  const previousTokens = await devices(service, userId);
  const bobTokens = await devices(service, "bob");
  await t.post("/request-password-reset", { email: VICTIM, redirectTo: "/forgot-password" });
  const token = new URL(t.lastLink("password-reset")).pathname.split("/").pop()!;
  expect((await t.post("/reset-password", { token, newPassword: "reset-password-456" })).status).toBe(500);
  await expect(service.readSecurityGeneration(userId)).rejects.toMatchObject({ code: "invalid_token", status: 401 });
  for (const tokens of previousTokens) {
    await expect(service.authenticate(tokens.accessToken)).rejects.toMatchObject({ code: "invalid_token", status: 401 });
    await expect(service.refresh(tokens.refreshToken)).rejects.toMatchObject({ code: "invalid_token", status: 401 });
  }
  expect((await t.post("/sign-in/email", { email: VICTIM, password: "reset-password-456" })).status).toBe(500);
  for (const tokens of bobTokens) expect((await service.authenticate(tokens.accessToken)).userId).toBe("bob");
  // An operator must verify the completed password/session writes before
  // finishing an interrupted transition. An ordinary sign-in cannot clear it.
  await service.finishSecurityChange(userId);
  const recovered = await t.post("/sign-in/email", { email: VICTIM, password: "reset-password-456" });
  expect(recovered.status).toBe(200);
  const current = await t.auth.api.getSession({ headers: new Headers({ cookie: cookieFrom(recovered) }) });
  expect(current?.session.securityGeneration).toBe(await service.readSecurityGeneration(userId));
});

test.each(["email-otp", "magic-link"] as const)("a failed %s cleanup completion never issues an owner session or unblocks attacker devices", async (method) => {
  const service = createDeviceGrants(new MemoryDeviceStore());
  const t = setup(undefined, service.bumpSecurityGeneration, service.readSecurityGeneration, {
    beginSecurityChange: service.beginSecurityChange,
    finishSecurityChange: async () => { throw new Error("generation completion unavailable"); },
  });
  const ctx = await t.auth.$context;
  const user = await ctx.internalAdapter.createUser({ email: VICTIM, name: "Victim", emailVerified: false });
  await ctx.internalAdapter.createAccount({ userId: user.id, providerId: "credential", accountId: user.id, password: await ctx.password.hash("attacker-password") });
  await ctx.internalAdapter.createSession(user.id);
  const previousTokens = await devices(service, user.id);
  let response: Response;
  if (method === "email-otp") {
    await t.post("/email-otp/send-verification-otp", { email: VICTIM, type: "sign-in" });
    response = await t.post("/sign-in/email-otp", { email: VICTIM, otp: t.lastLink("email-code") });
  } else {
    await t.post("/sign-in/magic-link", { email: VICTIM, callbackURL: "/courses" });
    response = await t.get(t.lastVerifyLink());
  }
  expect(response.status).toBe(500);
  expect(cookieFrom(response)).toBe("");
  expect(t.store.account).toHaveLength(0);
  expect(t.store.session).toHaveLength(0);
  await expect(service.readSecurityGeneration(user.id)).rejects.toMatchObject({ code: "invalid_token", status: 401 });
  for (const tokens of previousTokens) {
    await expect(service.authenticate(tokens.accessToken)).rejects.toMatchObject({ code: "invalid_token", status: 401 });
    await expect(service.refresh(tokens.refreshToken)).rejects.toMatchObject({ code: "invalid_token", status: 401 });
  }
});

test("a failed change-password start blocks the password write", async () => {
  const service = createDeviceGrants(new MemoryDeviceStore());
  let available = true;
  const t = setup(undefined, service.bumpSecurityGeneration, service.readSecurityGeneration, {
    beginSecurityChange: async (userId) => {
      if (!available) throw new Error("generation storage unavailable");
      await service.beginSecurityChange(userId);
    },
    finishSecurityChange: service.finishSecurityChange,
  });
  const cookie = await otpSignIn(t);
  expect((await setPasswordHandler(t.auth, { sendEmail: t.send })(passwordRequest(cookie))).status).toBe(200);
  available = false;
  expect((await t.post("/change-password", { currentPassword: password, newPassword: "changed-password-456" }, cookie)).status).toBe(500);
  expect((await t.post("/sign-in/email", { email: VICTIM, password })).status).toBe(200);
});

function credentialHash(t: ReturnType<typeof setup>) {
  return (t.store.account as { providerId: string; password: string | null }[]).find((row) => row.providerId === "credential")?.password;
}

test.each([false, true])("change-password blocks devices from before its write until after it (revokeOtherSessions: %p)", async (revokeOtherSessions) => {
  const service = createDeviceGrants(new MemoryDeviceStore());
  const begun = deferred(), release = deferred();
  let hashAtFinish: string | null | undefined;
  const t: ReturnType<typeof setup> = setup(undefined, service.bumpSecurityGeneration, service.readSecurityGeneration, {
    beginSecurityChange: async (userId) => { await service.beginSecurityChange(userId); begun.resolve(); await release.promise; },
    finishSecurityChange: async (userId) => { hashAtFinish = credentialHash(t); await service.finishSecurityChange(userId); },
  });
  const cookie = await otpSignIn(t);
  expect((await setPasswordHandler(t.auth, { sendEmail: t.send })(passwordRequest(cookie))).status).toBe(200);
  const userId = (t.store.user as { id: string }[])[0].id;
  const previousTokens = await devices(service, userId);
  const oldHash = credentialHash(t);
  const change = t.post("/change-password", { currentPassword: password, newPassword: "changed-password-456", revokeOtherSessions }, cookie);
  try {
    await begun.promise;
    expect(credentialHash(t)).toBe(oldHash);
    for (const tokens of previousTokens) {
      await expect(service.authenticate(tokens.accessToken)).rejects.toMatchObject({ code: "invalid_token", status: 401 });
      await expect(service.refresh(tokens.refreshToken)).rejects.toMatchObject({ code: "invalid_token", status: 401 });
    }
    const pending = await service.start({ clientKind: "mobile", codeChallenge: pkceChallenge(verifier), codeChallengeMethod: "S256" });
    await expect(service.approve(pending.userCode, userId, "approve", 0)).rejects.toMatchObject({ code: "invalid_token" });
  } finally { release.resolve(); }
  expect((await change).status).toBe(200);
  expect(hashAtFinish).not.toBe(oldHash);
  expect(hashAtFinish).toBe(credentialHash(t));
  expect(typeof await service.readSecurityGeneration(userId)).toBe("number");
});

test.each([false, true])("a failed change-password completion leaves device access blocked, like a reset (revokeOtherSessions: %p)", async (revokeOtherSessions) => {
  const service = createDeviceGrants(new MemoryDeviceStore());
  const t = setup(undefined, service.bumpSecurityGeneration, service.readSecurityGeneration, {
    beginSecurityChange: service.beginSecurityChange,
    finishSecurityChange: async () => { throw new Error("generation completion unavailable"); },
  });
  const cookie = await otpSignIn(t);
  expect((await setPasswordHandler(t.auth, { sendEmail: t.send })(passwordRequest(cookie))).status).toBe(200);
  const userId = (t.store.user as { id: string }[])[0].id;
  const previousTokens = await devices(service, userId);
  const oldHash = credentialHash(t);
  expect((await t.post("/change-password", { currentPassword: password, newPassword: "changed-password-456", revokeOtherSessions }, cookie)).status).toBe(500);
  // The password did change; only the completion failed, so the barrier stays closed.
  expect(credentialHash(t)).not.toBe(oldHash);
  await expect(service.readSecurityGeneration(userId)).rejects.toMatchObject({ code: "invalid_token", status: 401 });
  for (const tokens of previousTokens) {
    await expect(service.authenticate(tokens.accessToken)).rejects.toMatchObject({ code: "invalid_token", status: 401 });
    await expect(service.refresh(tokens.refreshToken)).rejects.toMatchObject({ code: "invalid_token", status: 401 });
  }
});

test("a password write outside reset and change-password fails loudly instead of skipping device revocation", async () => {
  const service = createDeviceGrants(new MemoryDeviceStore());
  const t = setup(undefined, service.bumpSecurityGeneration, service.readSecurityGeneration, {
    beginSecurityChange: service.beginSecurityChange, finishSecurityChange: service.finishSecurityChange,
  });
  const cookie = await otpSignIn(t);
  expect((await setPasswordHandler(t.auth, { sendEmail: t.send })(passwordRequest(cookie))).status).toBe(200);
  const userId = (t.store.user as { id: string }[])[0].id;
  const ctx = await t.auth.$context;
  await expect(ctx.internalAdapter.updatePassword(userId, await ctx.password.hash("server-side-789"))).rejects.toThrow("no device-revocation handling");
  const account = (t.store.account as { id: string; providerId: string }[]).find((row) => row.providerId === "credential")!;
  for (const cleared of [null, ""]) {
    await expect(ctx.internalAdapter.updateAccount(account.id, { password: cleared } as never)).rejects.toThrow("no device-revocation handling");
  }
  expect((await t.post("/sign-in/email", { email: VICTIM, password })).status).toBe(200);
});
