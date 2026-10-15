import { describe, expect, test } from "bun:test";
import { setPasswordHandler } from "@/lib/account-password";
import { createDeviceGrants, pkceChallenge, securityChangeTimeout } from "@/server/auth/device-grants";
import { createV1Auth } from "@/server/auth/v1-auth";
import { createDeviceHttp } from "@/server/auth/device-http";
import type { DeviceGrants } from "@/server/auth/device-grants";
import { MemoryDeviceStore } from "../device-grants/memory-store";
import { BASE, VICTIM, cookieFrom, setup } from "./fixtures";

const verifier = "x".repeat(43);
const inProgress = { code: "security_change_in_progress", status: 409 };
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

/** Whether this cookie passes the document routes' check (authorizeV1's browser branch). */
async function documentAccess(t: ReturnType<typeof setup>, service: DeviceGrants, cookie: string) {
  const authorize = createV1Auth(service, (request) => t.auth.api.getSession({ headers: request.headers }));
  try {
    await authorize(new Request(`${BASE}/api/v1/sync`, { headers: { cookie } }), "documents:read");
    return true;
  } catch (error) {
    expect(error).toMatchObject({ code: "unauthorized", status: 401 });
    return false;
  }
}

async function fixture(unverified = false) {
  const store = new MemoryDeviceStore();
  const service = createDeviceGrants(store);
  const t = setup(undefined, service.bumpSecurityGeneration, service.readSecurityGeneration, { holdsSecurityChange: service.holdsSecurityChange, beginSecurityChange: service.beginSecurityChange, finishSecurityChange: service.finishSecurityChange });
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
  test("setting a password revokes every mobile and extension token, and the caller keeps document access", async () => {
    const { t, cookie, seed, service } = await fixture();
    const other = await otpSignIn(t);
    const assertRevoked = await seed();
    expect((await setPasswordHandler(t.auth, { sendEmail: t.send })(passwordRequest(cookie))).status).toBe(200);
    await assertRevoked();
    expect(await documentAccess(t, service, cookie)).toBe(true);
    expect(await documentAccess(t, service, other)).toBe(false);
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

  test("a magic-link sign-in to a verified account is ordinary sign-in and leaves device tokens working", async () => {
    const { t, seed, service, userId } = await fixture();
    await seed();
    const before = await service.readSecurityGeneration(userId);
    const tokens = await devices(service, userId);
    expect((await t.post("/sign-in/magic-link", { email: VICTIM, callbackURL: "/courses" })).status).toBe(200);
    const signIn = await t.get(t.lastVerifyLink());
    expect(signIn.status).toBe(302);
    expect((await t.session(cookieFrom(signIn)))?.user?.email).toBe(VICTIM);
    expect(await service.readSecurityGeneration(userId)).toBe(before);
    for (const token of [tokens[1], tokens[3]]) expect((await service.authenticate(token.accessToken)).userId).toBe(userId);
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
    expect(await documentAccess(t, service, revokeOtherSessions ? cookieFrom(changed) : cookie)).toBe(true);
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

  test("sign out other sessions revokes every mobile and extension token, and the caller keeps document access", async () => {
    const { t, cookie, seed, service } = await fixture();
    const other = await otpSignIn(t);
    const assertRevoked = await seed();
    expect((await t.post("/revoke-other-sessions", {}, cookie)).status).toBe(200);
    expect(await t.session(other)).toBeNull();
    await assertRevoked();
    expect(await documentAccess(t, service, cookie)).toBe(true);
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

test("a reset refuses an old-password sign-in that was checked before it and finishes after it", async () => {
  const store = new MemoryDeviceStore();
  const service = createDeviceGrants(store);
  const t = setup(undefined, service.bumpSecurityGeneration, service.readSecurityGeneration, {
    holdsSecurityChange: service.holdsSecurityChange, beginSecurityChange: service.beginSecurityChange, finishSecurityChange: service.finishSecurityChange,
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
    expect((await t.post("/sign-in/email", { email: VICTIM, password })).status).toBe(409);
    await expect(service.readSecurityGeneration(userId)).rejects.toMatchObject(inProgress);
    const pending = await service.start({ clientKind: "mobile", codeChallenge: pkceChallenge(verifier), codeChallengeMethod: "S256" });
    expect((await approve(pending.userCode, initialCookie)).status).toBe(401);
    for (const tokens of previousTokens)
      await expect(service.authenticate(tokens.accessToken)).rejects.toMatchObject({ code: "invalid_token", status: 401 });
    releaseHash.resolve();
    expect((await reset).status).toBe(200);
    releaseVerify.resolve();
    // The old password was checked before the reset, but the session would be
    // made after it: refused, with no session left behind.
    const delayed = await delayedLogin;
    expect(delayed.status).toBe(401);
    expect(cookieFrom(delayed)).toBe("");
    expect(t.store.session).toHaveLength(0);
    expect(await service.readSecurityGeneration(userId)).toBe(capturedGeneration + 2);
    expect((await approve(pending.userCode, initialCookie)).status).toBe(401);
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

test("a failed reset completion blocks the account until the change times out, and old device tokens stay ended", async () => {
  let time = Date.now();
  let failFinish = false;
  const service = createDeviceGrants(new MemoryDeviceStore(() => time), () => time);
  const t = setup(undefined, service.bumpSecurityGeneration, service.readSecurityGeneration, {
    holdsSecurityChange: service.holdsSecurityChange, beginSecurityChange: service.beginSecurityChange,
    finishSecurityChange: async (userId, id) => {
      if (failFinish) throw new Error("generation completion unavailable");
      return service.finishSecurityChange(userId, id);
    },
  });
  const cookie = await otpSignIn(t);
  expect((await setPasswordHandler(t.auth, { sendEmail: t.send })(passwordRequest(cookie))).status).toBe(200);
  failFinish = true;
  const userId = (t.store.user as { id: string }[])[0].id;
  const previousTokens = await devices(service, userId);
  const bobTokens = await devices(service, "bob");
  await t.post("/request-password-reset", { email: VICTIM, redirectTo: "/forgot-password" });
  const token = new URL(t.lastLink("password-reset")).pathname.split("/").pop()!;
  expect((await t.post("/reset-password", { token, newPassword: "reset-password-456" })).status).toBe(500);
  await expect(service.readSecurityGeneration(userId)).rejects.toMatchObject(inProgress);
  expect((await t.post("/sign-in/email", { email: VICTIM, password: "reset-password-456" })).status).toBe(409);
  for (const tokens of bobTokens) expect((await service.authenticate(tokens.accessToken)).userId).toBe("bob");
  time += securityChangeTimeout;
  const recovered = await t.post("/sign-in/email", { email: VICTIM, password: "reset-password-456" });
  expect(recovered.status).toBe(200);
  const current = await t.auth.api.getSession({ headers: new Headers({ cookie: cookieFrom(recovered) }) });
  expect(current?.session.securityGeneration).toBe(await service.readSecurityGeneration(userId));
  for (const tokens of previousTokens) {
    await expect(service.authenticate(tokens.accessToken)).rejects.toMatchObject({ code: "invalid_token", status: 401 });
    await expect(service.refresh(tokens.refreshToken)).rejects.toMatchObject({ code: "invalid_token", status: 401 });
  }
});

test.each(["email-otp", "magic-link"] as const)("a failed %s cleanup completion never issues an owner session or unblocks attacker devices", async (method) => {
  const service = createDeviceGrants(new MemoryDeviceStore());
  const t = setup(undefined, service.bumpSecurityGeneration, service.readSecurityGeneration, {
    holdsSecurityChange: service.holdsSecurityChange, beginSecurityChange: service.beginSecurityChange,
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
  await expect(service.readSecurityGeneration(user.id)).rejects.toMatchObject(inProgress);
  for (const tokens of previousTokens) {
    await expect(service.authenticate(tokens.accessToken)).rejects.toMatchObject({ code: "invalid_token", status: 401 });
    await expect(service.refresh(tokens.refreshToken)).rejects.toMatchObject({ code: "invalid_token", status: 401 });
  }
});

test("a failed change-password start blocks the password write", async () => {
  const service = createDeviceGrants(new MemoryDeviceStore());
  let available = true;
  const t = setup(undefined, service.bumpSecurityGeneration, service.readSecurityGeneration, {
    holdsSecurityChange: service.holdsSecurityChange, beginSecurityChange: async (userId, expected) => {
      if (!available) throw new Error("generation storage unavailable");
      return service.beginSecurityChange(userId, expected);
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
  let pauseNextBegin = false;
  const t: ReturnType<typeof setup> = setup(undefined, service.bumpSecurityGeneration, service.readSecurityGeneration, {
    holdsSecurityChange: service.holdsSecurityChange,
    beginSecurityChange: async (userId, expected) => {
      const change = await service.beginSecurityChange(userId, expected);
      if (pauseNextBegin) { pauseNextBegin = false; begun.resolve(); await release.promise; }
      return change;
    },
    finishSecurityChange: async (userId, id) => { hashAtFinish = credentialHash(t); return service.finishSecurityChange(userId, id); },
  });
  const cookie = await otpSignIn(t);
  expect((await setPasswordHandler(t.auth, { sendEmail: t.send })(passwordRequest(cookie))).status).toBe(200);
  const userId = (t.store.user as { id: string }[])[0].id;
  const previousTokens = await devices(service, userId);
  const oldHash = credentialHash(t);
  pauseNextBegin = true;
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
  let failFinish = false;
  const t = setup(undefined, service.bumpSecurityGeneration, service.readSecurityGeneration, {
    holdsSecurityChange: service.holdsSecurityChange, beginSecurityChange: service.beginSecurityChange,
    finishSecurityChange: async (userId, id) => {
      if (failFinish) throw new Error("generation completion unavailable");
      return service.finishSecurityChange(userId, id);
    },
  });
  const cookie = await otpSignIn(t);
  expect((await setPasswordHandler(t.auth, { sendEmail: t.send })(passwordRequest(cookie))).status).toBe(200);
  failFinish = true;
  const userId = (t.store.user as { id: string }[])[0].id;
  const previousTokens = await devices(service, userId);
  const oldHash = credentialHash(t);
  expect((await t.post("/change-password", { currentPassword: password, newPassword: "changed-password-456", revokeOtherSessions }, cookie)).status).toBe(500);
  // The password did change; only the completion failed, so the barrier stays closed.
  expect(credentialHash(t)).not.toBe(oldHash);
  await expect(service.readSecurityGeneration(userId)).rejects.toMatchObject(inProgress);
  for (const tokens of previousTokens) {
    await expect(service.authenticate(tokens.accessToken)).rejects.toMatchObject({ code: "invalid_token", status: 401 });
    await expect(service.refresh(tokens.refreshToken)).rejects.toMatchObject({ code: "invalid_token", status: 401 });
  }
});

test("a password write outside reset and change-password fails loudly instead of skipping device revocation", async () => {
  const service = createDeviceGrants(new MemoryDeviceStore());
  const t = setup(undefined, service.bumpSecurityGeneration, service.readSecurityGeneration, {
    holdsSecurityChange: service.holdsSecurityChange, beginSecurityChange: service.beginSecurityChange, finishSecurityChange: service.finishSecurityChange,
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

describe("races between a password reset and an attacker who knows the old password", () => {
  async function prepared() {
    const service = createDeviceGrants(new MemoryDeviceStore());
    const t = setup(undefined, service.bumpSecurityGeneration, service.readSecurityGeneration, {
      holdsSecurityChange: service.holdsSecurityChange, beginSecurityChange: service.beginSecurityChange, finishSecurityChange: service.finishSecurityChange,
    });
    const cookie = await otpSignIn(t);
    expect((await setPasswordHandler(t.auth, { sendEmail: t.send })(passwordRequest(cookie))).status).toBe(200);
    const attacker = await t.post("/sign-in/email", { email: VICTIM, password });
    expect(attacker.status).toBe(200);
    async function reset() {
      await t.post("/request-password-reset", { email: VICTIM, redirectTo: "/forgot-password" });
      const token = new URL(t.lastLink("password-reset")).pathname.split("/").pop()!;
      return t.post("/reset-password", { token, newPassword: "reset-password-456" });
    }
    return { t, attacker: cookieFrom(attacker), reset, ctx: await t.auth.$context };
  }

  test("a password change that checked the old password before a reset can't overwrite the reset", async () => {
    const { t, attacker, reset, ctx } = await prepared();
    const originalVerify = ctx.password.verify;
    const verified = deferred(), release = deferred();
    ctx.password.verify = async (input) => {
      const result = await originalVerify(input);
      verified.resolve();
      await release.promise;
      return result;
    };
    const change = t.post("/change-password", { currentPassword: password, newPassword: "attacker-password-789" }, attacker);
    try {
      await verified.promise;
      ctx.password.verify = originalVerify;
      expect((await reset()).status).toBe(200);
    } finally { release.resolve(); ctx.password.verify = originalVerify; }
    const refused = await change;
    expect(refused.status).toBe(401);
    expect(await refused.json()).toMatchObject({ code: "stale_session" });
    expect((await t.post("/sign-in/email", { email: VICTIM, password: "attacker-password-789" })).status).toBe(401);
    expect((await t.post("/sign-in/email", { email: VICTIM, password: "reset-password-456" })).status).toBe(200);
  });

  test("a sign-in whose session is written after a reset deleted sessions is refused", async () => {
    const { t, reset, ctx } = await prepared();
    const adapter = ctx.adapter as unknown as { create: (input: { model: string }) => Promise<unknown> };
    const originalCreate = adapter.create;
    const inserting = deferred(), release = deferred();
    let paused = false;
    adapter.create = async (input) => {
      if (input.model === "session" && !paused) { paused = true; inserting.resolve(); await release.promise; }
      return originalCreate(input);
    };
    const signIn = t.post("/sign-in/email", { email: VICTIM, password });
    try {
      await inserting.promise;
      expect((await reset()).status).toBe(200);
    } finally { release.resolve(); adapter.create = originalCreate; }
    const response = await signIn;
    expect(response.status).toBe(401);
    expect(t.store.session).toHaveLength(0);
  });
});

describe("sessions and security changes after the second review", () => {
  async function owner(clock?: () => number) {
    const service = createDeviceGrants(new MemoryDeviceStore(clock), clock);
    let pauseNextBegin = false;
    const paused = { begun: deferred(), release: deferred() };
    const t = setup(undefined, service.bumpSecurityGeneration, service.readSecurityGeneration, {
      holdsSecurityChange: service.holdsSecurityChange, finishSecurityChange: service.finishSecurityChange,
      beginSecurityChange: async (userId, expected) => {
        const change = await service.beginSecurityChange(userId, expected);
        if (pauseNextBegin) { pauseNextBegin = false; paused.begun.resolve(); await paused.release.promise; }
        return change;
      },
    });
    const cookie = await otpSignIn(t);
    const userId = (t.store.user as { id: string }[])[0].id;
    const row = (cookie: string) => (t.store.session as { token: string; expiresAt: Date }[]).find((session) => cookie.includes(session.token));
    return { service, t, cookie, userId, row, paused, pauseNextBegin: () => { pauseNextBegin = true; } };
  }

  test("a session due for refresh survives get-session, a document route, change-password and sign out other sessions", async () => {
    const { t, service, cookie, row } = await owner();
    expect((await setPasswordHandler(t.auth, { sendEmail: t.send })(passwordRequest(cookie))).status).toBe(200);
    // better-auth 1.5.5 refreshes a session older than updateAge (1 day of its 7).
    const dueForRefresh = () => { row(cookie)!.expiresAt = new Date(Date.now() + 6 * 86400_000 - 60_000); };
    dueForRefresh();
    expect((await t.session(cookie))?.user?.email).toBe(VICTIM);
    dueForRefresh();
    expect(await documentAccess(t, service, cookie)).toBe(true);
    dueForRefresh();
    expect((await t.post("/change-password", { currentPassword: password, newPassword: "changed-password-456" }, cookie)).status).toBe(200);
    dueForRefresh();
    expect((await t.post("/revoke-other-sessions", {}, cookie)).status).toBe(200);
    expect(row(cookie)).toBeDefined();
    expect(await documentAccess(t, service, cookie)).toBe(true);
  });

  test("a stale session can't sign out the others or set a password, and moves nothing", async () => {
    const { t, service, cookie, userId } = await owner();
    const second = await otpSignIn(t);
    expect((await setPasswordHandler(t.auth, { sendEmail: t.send })(passwordRequest(cookie))).status).toBe(200);
    const generation = await service.readSecurityGeneration(userId);
    for (const path of ["/revoke-other-sessions", "/revoke-sessions"]) {
      const refused = await t.post(path, {}, second);
      expect(refused.status).toBe(401);
      expect(await refused.json()).toMatchObject({ code: "stale_session" });
    }
    expect(await service.readSecurityGeneration(userId)).toBe(generation);
    expect(await documentAccess(t, service, cookie)).toBe(true);
    expect(await documentAccess(t, service, second)).toBe(false);
  });

  test("a stale session can't set a password", async () => {
    const { t, service, userId } = await owner();
    const second = await otpSignIn(t);
    await service.bumpSecurityGeneration(userId);
    const generation = await service.readSecurityGeneration(userId);
    const refused = await setPasswordHandler(t.auth, { sendEmail: t.send })(passwordRequest(second));
    expect(refused.status).toBe(401);
    expect(t.store.account).toHaveLength(0);
    expect(await service.readSecurityGeneration(userId)).toBe(generation);
  });

  test("a change-password that stalls past the timeout can't write over the reset that replaced its change", async () => {
    let time = Date.now();
    const { t, service, cookie, userId, paused, pauseNextBegin } = await owner(() => time);
    expect((await setPasswordHandler(t.auth, { sendEmail: t.send })(passwordRequest(cookie))).status).toBe(200);
    pauseNextBegin();
    const change = t.post("/change-password", { currentPassword: password, newPassword: "attacker-password-789" }, cookie);
    try {
      await paused.begun.promise;
      time += securityChangeTimeout;
      await t.post("/request-password-reset", { email: VICTIM, redirectTo: "/forgot-password" });
      const token = new URL(t.lastLink("password-reset")).pathname.split("/").pop()!;
      expect((await t.post("/reset-password", { token, newPassword: "reset-password-456" })).status).toBe(200);
    } finally { paused.release.resolve(); }
    const refused = await change;
    expect(refused.status).toBe(401);
    expect((await t.post("/sign-in/email", { email: VICTIM, password: "attacker-password-789" })).status).toBe(401);
    expect((await t.post("/sign-in/email", { email: VICTIM, password: "reset-password-456" })).status).toBe(200);
    expect(typeof await service.readSecurityGeneration(userId)).toBe("number");
  });

  test("an emailed code or link refused during a security change isn't used up", async () => {
    const { t, service, userId } = await owner();
    expect((await t.post("/email-otp/send-verification-otp", { email: VICTIM, type: "sign-in" })).status).toBe(200);
    const otp = t.lastLink("email-code");
    expect((await t.post("/sign-in/magic-link", { email: VICTIM, callbackURL: "/courses" })).status).toBe(200);
    const link = t.lastVerifyLink();
    const change = await service.beginSecurityChange(userId);
    const otpRefused = await t.post("/sign-in/email-otp", { email: VICTIM, otp });
    expect(otpRefused.status).toBe(409);
    expect(await otpRefused.json()).toMatchObject({ code: "security_change_in_progress" });
    expect((await t.get(link)).status).toBe(409);
    await service.finishSecurityChange(userId, change.changeId);
    expect((await t.post("/sign-in/email-otp", { email: VICTIM, otp })).status).toBe(200);
    expect((await t.get(link)).status).toBe(302);
  });

  test("a session left behind by a security change is deleted when get-session or a document route sees it", async () => {
    const { t, service, cookie, row } = await owner();
    const viaGetSession = await otpSignIn(t);
    const viaDocuments = await otpSignIn(t);
    expect((await setPasswordHandler(t.auth, { sendEmail: t.send })(passwordRequest(cookie))).status).toBe(200);
    const signedOut = await t.get(`${BASE}/api/auth/get-session`, viaGetSession);
    expect(await signedOut.json()).toBeNull();
    expect(signedOut.headers.getSetCookie().some((header) => /session_token=;/.test(header))).toBe(true);
    expect(row(viaGetSession)).toBeUndefined();
    expect(await documentAccess(t, service, viaDocuments)).toBe(false);
    expect(row(viaDocuments)).toBeUndefined();
    expect(row(cookie)).toBeDefined();
  });
});
