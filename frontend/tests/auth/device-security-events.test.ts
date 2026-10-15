import { describe, expect, test } from "bun:test";
import { setPasswordHandler } from "@/lib/account-password";
import { createDeviceGrants, pkceChallenge, securityChangeTimeout } from "@/server/auth/device-grants";
import { createV1Auth } from "@/server/auth/v1-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { createAuth } from "@/lib/auth-config";
import { memoryClaims } from "@/lib/magic-link-claims";
import { createDeviceHttp } from "@/server/auth/device-http";
import type { DeviceGrants } from "@/server/auth/device-grants";
import { MemoryDeviceStore } from "../device-grants/memory-store";
import { BASE, VICTIM, cookieFrom, setup } from "./fixtures";

const stores = new WeakMap<object, MemoryDeviceStore>();
/** createDeviceGrants, remembering the store so storeDeps can hand it to the auth fixture. */
function grantsWithStore(store: MemoryDeviceStore, clock?: () => number) {
  const service = createDeviceGrants(store, clock);
  stores.set(service, store);
  return service;
}
/** The device store's credential and session functions, and the store itself for the fixture to wire up. */
function storeDeps(service: DeviceGrants) {
  const devices = stores.get(service);
  if (!devices) throw new Error("Create the service with grantsWithStore.");
  return { writeCredential: service.writeCredential, endStaleSession: service.endStaleSession, deviceStore: devices };
}
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
  const service = grantsWithStore(store);
  const t = setup(undefined, service.bumpSecurityGeneration, service.readSecurityGeneration, { ...storeDeps(service), beginSecurityChange: service.beginSecurityChange, finishSecurityChange: service.finishSecurityChange });
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

  test("sign out everywhere ends every mobile and extension token, and also ends the current browser session", async () => {
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
  const service = grantsWithStore(store);
  const t = setup(undefined, service.bumpSecurityGeneration, service.readSecurityGeneration, {
    ...storeDeps(service), beginSecurityChange: service.beginSecurityChange, finishSecurityChange: service.finishSecurityChange,
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
  // Only the delayed sign-in pauses; a later sign-in still checks its password.
  let pauseVerify = true;
  ctx.password.verify = async (value) => {
    const result = await originalVerify(value);
    if (pauseVerify) { pauseVerify = false; verifyEntered.resolve(); await releaseVerify.promise; }
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
    // The same answer as a wrong password: a refusal mustn't reveal the account or the change.
    expect((await t.post("/sign-in/email", { email: VICTIM, password })).status).toBe(401);
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
  const service = grantsWithStore(new MemoryDeviceStore(() => time), () => time);
  const t = setup(undefined, service.bumpSecurityGeneration, service.readSecurityGeneration, {
    ...storeDeps(service), beginSecurityChange: service.beginSecurityChange,
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
  expect((await t.post("/sign-in/email", { email: VICTIM, password: "reset-password-456" })).status).toBe(401);
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
  const service = grantsWithStore(new MemoryDeviceStore());
  const t = setup(undefined, service.bumpSecurityGeneration, service.readSecurityGeneration, {
    ...storeDeps(service), beginSecurityChange: service.beginSecurityChange,
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
  const service = grantsWithStore(new MemoryDeviceStore());
  let available = true;
  const t = setup(undefined, service.bumpSecurityGeneration, service.readSecurityGeneration, {
    ...storeDeps(service), beginSecurityChange: async (userId, expected) => {
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
  const service = grantsWithStore(new MemoryDeviceStore());
  const begun = deferred(), release = deferred();
  let hashAtFinish: string | null | undefined;
  let pauseNextBegin = false;
  const t: ReturnType<typeof setup> = setup(undefined, service.bumpSecurityGeneration, service.readSecurityGeneration, {
    ...storeDeps(service),
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
  const service = grantsWithStore(new MemoryDeviceStore());
  let failFinish = false;
  const t = setup(undefined, service.bumpSecurityGeneration, service.readSecurityGeneration, {
    ...storeDeps(service), beginSecurityChange: service.beginSecurityChange,
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
  const service = grantsWithStore(new MemoryDeviceStore());
  const t = setup(undefined, service.bumpSecurityGeneration, service.readSecurityGeneration, {
    ...storeDeps(service), beginSecurityChange: service.beginSecurityChange, finishSecurityChange: service.finishSecurityChange,
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
    const service = grantsWithStore(new MemoryDeviceStore());
    const t = setup(undefined, service.bumpSecurityGeneration, service.readSecurityGeneration, {
      ...storeDeps(service), beginSecurityChange: service.beginSecurityChange, finishSecurityChange: service.finishSecurityChange,
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
    const service = grantsWithStore(new MemoryDeviceStore(clock), clock);
    let pauseNextBegin = false;
    const paused = { begun: deferred(), release: deferred() };
    const t = setup(undefined, service.bumpSecurityGeneration, service.readSecurityGeneration, {
      ...storeDeps(service), finishSecurityChange: service.finishSecurityChange,
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
    // The stale session is deleted before the endpoint's session check, which then refuses it.
    for (const path of ["/revoke-other-sessions", "/revoke-sessions"]) expect((await t.post(path, {}, second)).status).toBe(401);
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

/** The device store's security functions, as auth-config takes them; `at` names pause points for race tests. */
function securityDeps(service: DeviceGrants, at: (name: string) => Promise<void>) {
  return {
    ...storeDeps(service),
    beginSecurityChange: service.beginSecurityChange,
    finishSecurityChange: async (...args: Parameters<DeviceGrants["finishSecurityChange"]>) => { await at("finish"); return service.finishSecurityChange(...args); },
    writeCredential: async (...args: Parameters<DeviceGrants["writeCredential"]>) => { await at("credential-write"); return service.writeCredential(...args); },
  };
}

describe("third review: credential writes, stale sessions and refusals", () => {
  /** A device store wired into auth, plus pause points for the race tests. */
  async function harness(clock?: () => number) {
    const store = new MemoryDeviceStore(clock);
    const service = grantsWithStore(store, clock);
    const pauses = new Map<string, { hit: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> }>();
    const arm = (name: string) => { const pause = { hit: deferred(), release: deferred() }; pauses.set(name, pause); return pause; };
    const at = async (name: string) => { const pause = pauses.get(name); if (pause) { pauses.delete(name); pause.hit.resolve(); await pause.release.promise; } };
    const t: ReturnType<typeof setup> = setup(undefined, service.bumpSecurityGeneration, async (userId) => { await at("read"); return service.readSecurityGeneration(userId); }, securityDeps(service, at));
    const cookie = await otpSignIn(t);
    const userId = (t.store.user as { id: string }[])[0].id;
    const credentials = () => (t.store.account as { providerId: string; password: string | null }[]).filter((row) => row.providerId === "credential");
    const hasSession = (cookie: string) => (t.store.session as { token: string }[]).some((session) => cookie.includes(session.token));
    async function resetToken() {
      expect((await t.post("/request-password-reset", { email: VICTIM, redirectTo: "/forgot-password" })).status).toBe(200);
      return new URL(t.lastLink("password-reset")).pathname.split("/").pop()!;
    }
    return { store, service, t, cookie, userId, arm, at, credentials, hasSession, resetToken, ctx: await t.auth.$context };
  }

  test("a reset that stalls past the timeout can't write over the reset that replaced its change", async () => {
    let time = Date.now();
    const { t, cookie, ctx, resetToken } = await harness(() => time);
    expect((await setPasswordHandler(t.auth, { sendEmail: t.send })(passwordRequest(cookie))).status).toBe(200);
    const slow = await resetToken(), fast = await resetToken();
    const originalHash = ctx.password.hash;
    const hashing = deferred(), release = deferred();
    ctx.password.hash = async (value) => {
      if (value === "slow-reset-111") { hashing.resolve(); await release.promise; }
      return originalHash(value);
    };
    const delayed = t.post("/reset-password", { token: slow, newPassword: "slow-reset-111" });
    try {
      await hashing.promise;
      time += securityChangeTimeout;
      expect((await t.post("/reset-password", { token: fast, newPassword: "fast-reset-222" })).status).toBe(200);
    } finally { release.resolve(); ctx.password.hash = originalHash; }
    expect((await delayed).status).not.toBe(200);
    expect((await t.post("/sign-in/email", { email: VICTIM, password: "slow-reset-111" })).status).toBe(401);
    expect((await t.post("/sign-in/email", { email: VICTIM, password: "fast-reset-222" })).status).toBe(200);
  });

  test("set-password and a reset racing for an account without a password leave one credential", async () => {
    const { t, cookie, ctx, arm, at, credentials, resetToken } = await harness();
    const token = await resetToken();
    // Pause the password write wherever it happens: better-auth's own insert,
    // or the device store's locked write.
    const pause = arm("credential-write");
    const adapter = ctx.adapter as unknown as { create: (input: { model: string }) => Promise<unknown> };
    const originalCreate = adapter.create;
    adapter.create = async (input) => {
      if (input.model === "account") await at("credential-write");
      return originalCreate(input);
    };
    const setPassword = setPasswordHandler(t.auth, { sendEmail: t.send })(passwordRequest(cookie));
    let reset: Response;
    try {
      await pause.hit.promise;
      reset = await t.post("/reset-password", { token, newPassword: "reset-password-456" });
    } finally { pause.release.resolve(); adapter.create = originalCreate; }
    expect((await setPassword).status).toBe(200);
    expect(credentials()).toHaveLength(1);
    if (reset.status !== 200) {
      expect(reset.status).toBe(409);
      expect((await t.post("/reset-password", { token, newPassword: "reset-password-456" })).status).toBe(200);
    }
    expect(credentials()).toHaveLength(1);
    expect((await t.post("/sign-in/email", { email: VICTIM, password: "reset-password-456" })).status).toBe(200);
  });

  test("a reset whose precheck opened no change can't write the password", async () => {
    const { t, cookie, ctx, service, userId, resetToken } = await harness();
    expect((await setPasswordHandler(t.auth, { sendEmail: t.send })(passwordRequest(cookie))).status).toBe(200);
    const tokens = await devices(service, userId);
    const token = await resetToken();
    const original = ctx.internalAdapter.findVerificationValue;
    let precheck = true;
    ctx.internalAdapter.findVerificationValue = async (identifier) => {
      if (identifier === `reset-password:${token}` && precheck) { precheck = false; return null; }
      return original(identifier);
    };
    try {
      expect((await t.post("/reset-password", { token, newPassword: "reset-password-456" })).status).not.toBe(200);
    } finally { ctx.internalAdapter.findVerificationValue = original; }
    expect((await t.post("/sign-in/email", { email: VICTIM, password: "reset-password-456" })).status).toBe(401);
    expect((await t.post("/sign-in/email", { email: VICTIM, password })).status).toBe(200);
    expect((await service.authenticate(tokens[3].accessToken)).userId).toBe(userId);
  });

  test("a stale session is signed out on every session route, not only get-session", async () => {
    const { t, cookie, hasSession } = await harness();
    const stale = [await otpSignIn(t), await otpSignIn(t), await otpSignIn(t)];
    expect((await setPasswordHandler(t.auth, { sendEmail: t.send })(passwordRequest(cookie))).status).toBe(200);
    const calls = [
      () => t.get(`${BASE}/api/auth/list-sessions`, stale[0]),
      () => t.post("/revoke-session", { token: "anything" }, stale[1]),
      () => t.post("/update-user", { name: "Mallory" }, stale[2]),
    ];
    for (const [i, call] of calls.entries()) {
      expect((await call()).status).toBe(401);
      expect(hasSession(stale[i])).toBe(false);
    }
    expect((t.store.user as { name: string }[])[0].name).not.toBe("Mallory");
    expect(hasSession(cookie)).toBe(true);
  });

  // The race the single conditional DELETE removes (reading the session, then
  // the generation, around the caller's restamp) has no pause point inside one
  // statement. This checks the caller's session at the points a reader can see:
  // while its own change is open after the restamp, and after it finishes.
  test("the caller's session survives stale checks during and after its own sign-out of other sessions", async () => {
    const { t, cookie, arm, hasSession, service } = await harness();
    await otpSignIn(t);
    const pause = arm("finish");
    const signOut = t.post("/revoke-other-sessions", {}, cookie);
    await pause.hit.promise;
    try {
      expect(await t.session(cookie)).not.toBeNull();
      expect(hasSession(cookie)).toBe(true);
    } finally { pause.release.resolve(); }
    expect((await signOut).status).toBe(200);
    expect(await t.session(cookie)).not.toBeNull();
    expect(await documentAccess(t, service, cookie)).toBe(true);
  });

  test("an expired session on a sign-out route opens no change", async () => {
    const { t, cookie, service, userId } = await harness();
    const second = await otpSignIn(t);
    const before = await service.readSecurityGeneration(userId);
    for (const [path, session] of [["/revoke-sessions", cookie], ["/revoke-other-sessions", second]] as const) {
      const row = (t.store.session as { token: string; expiresAt: Date }[]).find((row) => session.includes(row.token))!;
      row.expiresAt = new Date(Date.now() - 1000);
      expect((await t.post(path, {}, session)).status).toBe(401);
    }
    expect(await service.readSecurityGeneration(userId)).toBe(before);
  });

  test("a sign-out during an open change answers 409, not 500", async () => {
    const { t, cookie, service, userId } = await harness();
    const change = await service.beginSecurityChange(userId);
    for (const path of ["/revoke-sessions", "/revoke-other-sessions"]) {
      const refused = await t.post(path, {}, cookie);
      expect(refused.status).toBe(409);
      expect(await refused.json()).toMatchObject({ code: "security_change_in_progress" });
    }
    await service.finishSecurityChange(userId, change.changeId);
  });

  test("set-password on an account with an empty legacy credential row answers PASSWORD_ALREADY_SET", async () => {
    const { t, cookie, userId, credentials } = await harness();
    (t.store.account as Record<string, unknown>[]).push({ id: "legacy", accountId: userId, providerId: "credential", userId, password: null, createdAt: new Date(), updatedAt: new Date() });
    const refused = await setPasswordHandler(t.auth, { sendEmail: t.send })(passwordRequest(cookie));
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ code: "PASSWORD_ALREADY_SET" });
    expect(credentials()).toHaveLength(1);
  });

  /**
   * better-auth 1.5.5 looks up the rows for its delete hooks inside a silent
   * try/catch: if that lookup fails, the hooks are skipped and the delete
   * still runs. This fails that lookup for sessions and reports when the
   * sessions are gone, so a sign-out can't rely on a delete hook.
   */
  function blindDeleteHooks(ctx: Awaited<ReturnType<typeof harness>>["ctx"]) {
    const adapter = ctx.adapter as unknown as {
      findMany: (input: { model: string; where?: { field: string }[] }) => Promise<unknown>;
      deleteMany: (input: { model: string }) => Promise<unknown>;
    };
    const { findMany, deleteMany } = adapter;
    const deleted = deferred(), release = deferred();
    let paused = false;
    adapter.findMany = async (input) => {
      if (input.model === "session" && input.where?.some((clause) => clause.field === "userId")) throw new Error("session lookup failed");
      return findMany(input);
    };
    adapter.deleteMany = async (input) => {
      const result = await deleteMany(input);
      if (input.model === "session" && !paused) { paused = true; deleted.resolve(); await release.promise; }
      return result;
    };
    return { deleted, release, restore: () => { adapter.findMany = findMany; adapter.deleteMany = deleteMany; release.resolve(); } };
  }

  test("a device token used after a sign-out deleted sessions, but before its after hook, is refused", async () => {
    const { t, cookie, service, userId, hasSession, ctx } = await harness();
    const tokens = await devices(service, userId);
    const blind = blindDeleteHooks(ctx);
    const signOut = t.post("/revoke-sessions", {}, cookie);
    try {
      await blind.deleted.promise;
      expect(hasSession(cookie)).toBe(false);
      for (const token of tokens) {
        await expect(service.authenticate(token.accessToken)).rejects.toMatchObject({ code: "invalid_token" });
        await expect(service.refresh(token.refreshToken)).rejects.toMatchObject({ code: "invalid_token" });
      }
    } finally { blind.restore(); }
    expect((await signOut).status).toBe(200);
  });

  test("a sign-out that fails after deleting sessions leaves no device token usable", async () => {
    const { t, cookie, service, userId, store, hasSession, ctx } = await harness();
    const tokens = await devices(service, userId);
    const blind = blindDeleteHooks(ctx);
    // Every security-store write fails from the moment the sessions are gone.
    const { beginSecurityChange, finishSecurityChange } = store;
    let failing = false;
    void blind.deleted.promise.then(() => { failing = true; blind.release.resolve(); });
    store.beginSecurityChange = async (...args) => { if (failing) throw new Error("generation store unavailable"); return beginSecurityChange.apply(store, args); };
    store.finishSecurityChange = async (...args) => { if (failing) throw new Error("generation store unavailable"); return finishSecurityChange.apply(store, args); };
    try {
      expect((await t.post("/revoke-sessions", {}, cookie)).status).toBeGreaterThanOrEqual(500);
    } finally { blind.restore(); store.beginSecurityChange = beginSecurityChange; store.finishSecurityChange = finishSecurityChange; }
    expect(hasSession(cookie)).toBe(false);
    for (const token of tokens) await expect(service.authenticate(token.accessToken)).rejects.toMatchObject({ code: "invalid_token" });
  });

  test.each(["/revoke-sessions", "/revoke-other-sessions"])("a %s whose change can't open deletes nothing", async (path) => {
    const { t, cookie, service, userId, store, hasSession } = await harness();
    const other = await otpSignIn(t);
    const tokens = await devices(service, userId);
    const before = await service.readSecurityGeneration(userId);
    const original = store.beginSecurityChange.bind(store);
    store.beginSecurityChange = async () => { throw new Error("generation store unavailable"); };
    try {
      expect((await t.post(path, {}, cookie)).status).toBe(500);
    } finally { store.beginSecurityChange = original; }
    expect(hasSession(cookie)).toBe(true);
    expect(hasSession(other)).toBe(true);
    expect(await service.readSecurityGeneration(userId)).toBe(before);
    for (const token of [tokens[1], tokens[3]]) expect((await service.authenticate(token.accessToken)).userId).toBe(userId);
  });

  test("a password write that fails closes its change instead of locking the account until the timeout", async () => {
    const { t, cookie, service, userId, store } = await harness();
    expect((await setPasswordHandler(t.auth, { sendEmail: t.send })(passwordRequest(cookie))).status).toBe(200);
    const original = store.writeCredential.bind(store);
    store.writeCredential = async () => { throw new Error("account table unavailable"); };
    try {
      expect((await t.post("/change-password", { currentPassword: password, newPassword: "changed-password-456" }, cookie)).status).toBe(500);
    } finally { store.writeCredential = original; }
    expect(typeof await service.readSecurityGeneration(userId)).toBe("number");
    expect(await documentAccess(t, service, cookie)).toBe(true);
    expect((await t.post("/sign-in/email", { email: VICTIM, password })).status).toBe(200);
  });

  test("the change store must come complete, with the generation reader, and can't be combined with custom ids", () => {
    const service = grantsWithStore(new MemoryDeviceStore());
    const { deviceStore, ...rest } = storeDeps(service);
    void deviceStore;
    const complete = { ...rest, beginSecurityChange: service.beginSecurityChange, finishSecurityChange: service.finishSecurityChange };
    expect(() => setup(undefined, service.bumpSecurityGeneration, undefined, complete)).toThrow("must be configured together");
    expect(() => createAuth({ database: memoryAdapter({}), baseURL: BASE, secret: "test-secret-at-least-32-characters-long", claims: memoryClaims(), sendEmail: async () => {},
      readSecurityGeneration: service.readSecurityGeneration, ...complete, options: { advanced: { database: { generateId: () => "id" } } } })).toThrow("generateId");
  });

  test("password sign-in gives the same answer for an unknown email and for an account with a change open", async () => {
    const { t, cookie, service, userId } = await harness();
    expect((await setPasswordHandler(t.auth, { sendEmail: t.send })(passwordRequest(cookie))).status).toBe(200);
    const unknown = await t.post("/sign-in/email", { email: "nobody@my.unt.edu", password: "whatever-password-1" });
    const change = await service.beginSecurityChange(userId);
    for (const attempt of ["whatever-password-1", password]) {
      const during = await t.post("/sign-in/email", { email: VICTIM, password: attempt });
      expect(during.status).toBe(unknown.status);
      expect(await during.json()).toEqual(await unknown.clone().json());
    }
    await service.finishSecurityChange(userId, change.changeId);
  });
});

describe("fourth review: refusals that change nothing, and errors that leak nothing", () => {
  async function harness(clock?: () => number) {
    const store = new MemoryDeviceStore(clock);
    const service = grantsWithStore(store, clock);
    let pauseBegin = false;
    const begun = deferred(), release = deferred();
    const t: ReturnType<typeof setup> = setup(undefined, service.bumpSecurityGeneration, service.readSecurityGeneration, {
      ...storeDeps(service), finishSecurityChange: service.finishSecurityChange,
      beginSecurityChange: async (userId, expected) => {
        const change = await service.beginSecurityChange(userId, expected);
        if (pauseBegin) { pauseBegin = false; begun.resolve(); await release.promise; }
        return change;
      },
    });
    const cookie = await otpSignIn(t);
    const userId = (t.store.user as { id: string }[])[0].id;
    const sessionRow = (cookie: string) => (t.store.session as { token: string; securityGeneration: number }[]).find((row) => cookie.includes(row.token));
    return { store, service, t, cookie, userId, sessionRow, pauseNextBegin: () => { pauseBegin = true; return { begun, release }; }, ctx: await t.auth.$context };
  }

  test("a change-password refused because a newer change replaced it doesn't move the caller's session", async () => {
    let time = Date.now();
    const { t, cookie, sessionRow, pauseNextBegin } = await harness(() => time);
    expect((await setPasswordHandler(t.auth, { sendEmail: t.send })(passwordRequest(cookie))).status).toBe(200);
    const stamp = sessionRow(cookie)!.securityGeneration;
    const pause = pauseNextBegin();
    const change = t.post("/change-password", { currentPassword: password, newPassword: "attacker-password-789" }, cookie);
    let reset: Promise<Response>;
    try {
      await pause.begun.promise;
      time += securityChangeTimeout;
      await t.post("/request-password-reset", { email: VICTIM, redirectTo: "/forgot-password" });
      const token = new URL(t.lastLink("password-reset")).pathname.split("/").pop()!;
      // The newer change opens and is left open, so a moved stamp would land on it.
      const ctx = await t.auth.$context;
      const originalHash = ctx.password.hash;
      const hashing = deferred(), finishReset = deferred();
      ctx.password.hash = async (value) => { if (value === "reset-password-456") { hashing.resolve(); await finishReset.promise; } return originalHash(value); };
      reset = t.post("/reset-password", { token, newPassword: "reset-password-456" });
      await hashing.promise;
      pause.release.resolve();
      expect((await change).status).toBe(401);
      const row = sessionRow(cookie);
      if (row) expect(row.securityGeneration).toBe(stamp);
      finishReset.resolve();
      ctx.password.hash = originalHash;
    } finally { pause.release.resolve(); }
    expect((await reset!).status).toBe(200);
  });

  test("set-password on an account with an empty legacy credential row refuses before ending any device", async () => {
    const { t, cookie, service, userId } = await harness();
    (t.store.account as Record<string, unknown>[]).push({ id: "legacy", accountId: userId, providerId: "credential", userId, password: null, createdAt: new Date(), updatedAt: new Date() });
    const tokens = await devices(service, userId);
    const before = await service.readSecurityGeneration(userId);
    const refused = await setPasswordHandler(t.auth, { sendEmail: t.send })(passwordRequest(cookie));
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ code: "PASSWORD_ALREADY_SET" });
    expect(await service.readSecurityGeneration(userId)).toBe(before);
    for (const token of [tokens[1], tokens[3]]) expect((await service.authenticate(token.accessToken)).userId).toBe(userId);
  });

  test("a sign-out that fails with a plain error still finishes its change", async () => {
    const { t, cookie, service, userId, ctx } = await harness();
    await otpSignIn(t);
    const original = ctx.internalAdapter.deleteSession;
    ctx.internalAdapter.deleteSession = async () => { throw new Error("session store unavailable"); };
    try {
      const response = await t.post("/revoke-other-sessions", {}, cookie).catch(() => null);
      expect(response?.status ?? 500).toBeGreaterThanOrEqual(500);
    } finally { ctx.internalAdapter.deleteSession = original; }
    expect(typeof await service.readSecurityGeneration(userId)).toBe("number");
    expect(await documentAccess(t, service, cookie)).toBe(true);
  });
});
