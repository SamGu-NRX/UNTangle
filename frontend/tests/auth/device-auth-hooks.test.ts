import { describe, expect, test } from "bun:test";
import { EmailBudgetExceeded, recipientBudget } from "@/lib/email-budget";
import { memoryStore } from "@/lib/rate-limit/store";
import { renderAuthEmail } from "@/lib/auth-email";
import { setPasswordHandler } from "@/lib/account-password";
import { BASE, VICTIM, cookieFrom, setup } from "./fixtures";

const passwordRequest = (cookie: string, newPassword = "owner-password-123") => new Request(`${BASE}/api/account/set-password`, {
  method: "POST", headers: { origin: BASE, "content-type": "application/json", cookie },
  body: JSON.stringify({ newPassword }),
});
async function otpSignIn(t: ReturnType<typeof setup>) {
  expect((await t.post("/email-otp/send-verification-otp", { email: VICTIM, type: "sign-in" })).status).toBe(200);
  return t.post("/sign-in/email-otp", { email: VICTIM, otp: t.lastLink("email-code") });
}

describe("device approval email codes", () => {
  test("the emailed code is hashed, has no link and signs in once", async () => {
    const t = setup();
    await t.post("/email-otp/send-verification-otp", { email: VICTIM, type: "sign-in" });
    const otp = t.lastLink("email-code");
    expect(otp).toMatch(/^\d{6}$/);
    expect(JSON.stringify(t.store.verification)).not.toContain(otp);
    expect(renderAuthEmail("email-code", otp).text).toContain(`Your sign-in code is ${otp}`);
    expect(renderAuthEmail("email-code", otp).html).not.toContain("href=");
    const response = await t.post("/sign-in/email-otp", { email: VICTIM, otp });
    expect(response.status).toBe(200);
    expect((await t.session(cookieFrom(response)))?.user?.email).toBe(VICTIM);
    expect((await t.post("/sign-in/email-otp", { email: VICTIM, otp })).status).toBe(400);
  });
  test("parallel use creates exactly one session", async () => {
    const t = setup();
    await t.post("/email-otp/send-verification-otp", { email: VICTIM, type: "sign-in" });
    const otp = t.lastLink("email-code");
    const results = await Promise.all(Array.from({ length: 6 }, () => t.post("/sign-in/email-otp", { email: VICTIM, otp })));
    expect(results.map((r) => r.status).filter((s) => s === 200)).toHaveLength(1);
    expect(t.store.session).toHaveLength(1);
  });
  test("wrong and expired codes fail, and repeated guesses exhaust the code", async () => {
    const t = setup();
    await t.post("/email-otp/send-verification-otp", { email: VICTIM, type: "sign-in" });
    const otp = t.lastLink("email-code");
    for (let i = 0; i < 3; i++) expect((await t.post("/sign-in/email-otp", { email: VICTIM, otp: "wrong" })).status).toBe(400);
    expect((await t.post("/sign-in/email-otp", { email: VICTIM, otp })).status).toBe(403);
    await t.post("/email-otp/send-verification-otp", { email: VICTIM, type: "sign-in" });
    for (const row of t.store.verification as { expiresAt: Date }[]) row.expiresAt = new Date(0);
    expect((await t.post("/sign-in/email-otp", { email: VICTIM, otp: t.lastLink("email-code") })).status).toBe(400);
    expect(t.store.session).toHaveLength(0);
  });
  test("the recipient email budget refuses the fourth code request", async () => {
    const budget = recipientBudget({ store: memoryStore(), secret: "test-recipient-budget" });
    const delivered: string[] = [];
    const t = setup(async (kind, to, code) => {
      if (!(await budget.take(to, kind))) throw new EmailBudgetExceeded(to);
      delivered.push(code);
    });
    for (let i = 0; i < 3; i++)
      expect((await t.post("/email-otp/send-verification-otp", { email: VICTIM, type: "sign-in" })).status).toBe(200);
    expect((await t.post("/email-otp/send-verification-otp", { email: VICTIM, type: "sign-in" })).status).toBe(429);
    expect(delivered).toHaveLength(3);
  });
  test("a failed concurrent guess cannot resurrect an already-used code", async () => {
    const t = setup();
    await t.post("/email-otp/send-verification-otp", { email: VICTIM, type: "sign-in" });
    const otp = t.lastLink("email-code");
    const row = { ...t.store.verification[0] as { identifier: string; value: string; expiresAt: Date } };
    expect((await t.post("/sign-in/email-otp", { email: VICTIM, otp })).status).toBe(200);
    // 1.5.5 recreates a verification row after an incorrect concurrent guess.
    const ctx = await t.auth.$context;
    await ctx.internalAdapter.createVerificationValue({ identifier: row.identifier, value: row.value, expiresAt: row.expiresAt });
    expect((await t.post("/sign-in/email-otp", { email: VICTIM, otp })).status).toBe(400);
    expect(t.store.session).toHaveLength(1);
  });
  test.each(["missing", "expired", "wrong-code", "exhausted"] as const)("a %s precheck cannot bypass the claim when the endpoint later sees a usable code", async (mode) => {
    const t = setup();
    await t.post("/email-otp/send-verification-otp", { email: VICTIM, type: "sign-in" });
    const otp = t.lastLink("email-code");
    const ctx = await t.auth.$context;
    const original = ctx.internalAdapter.findVerificationValue;
    let precheck = true;
    ctx.internalAdapter.findVerificationValue = async (identifier) => {
      const record = await original(identifier);
      if (identifier === `sign-in-otp-${VICTIM}` && precheck) {
        precheck = false;
        if (mode === "missing") return null;
        if (!record) throw new Error("Expected the issued email code");
        if (mode === "expired") return { ...record, expiresAt: new Date(0) };
        if (mode === "wrong-code") return { ...record, value: "different-hash:0" };
        return { ...record, value: record.value.replace(/:\d+$/, ":3") };
      }
      return record;
    };
    expect((await t.post("/sign-in/email-otp", { email: VICTIM, otp })).status).toBe(mode === "exhausted" ? 403 : 400);
    expect(t.store.session).toHaveLength(0);
    expect(t.store.user).toHaveLength(0);
  });
  test.each(["missing", "wrong-code"] as const)("a %s precheck cannot verify an unverified account's attacker password", async (mode) => {
    const t = setup();
    const ctx = await t.auth.$context;
    const user = await ctx.internalAdapter.createUser({ email: VICTIM, name: "Victim", emailVerified: false });
    await ctx.internalAdapter.createAccount({ userId: user.id, providerId: "credential", accountId: user.id, password: await ctx.password.hash("attacker-password") });
    await ctx.internalAdapter.createSession(user.id);
    const accounts = structuredClone(t.store.account);
    const sessions = structuredClone(t.store.session);
    expect((await t.post("/email-otp/send-verification-otp", { email: VICTIM, type: "sign-in" })).status).toBe(200);
    const otp = t.lastLink("email-code");
    const original = ctx.internalAdapter.findVerificationValue;
    let precheck = true;
    ctx.internalAdapter.findVerificationValue = async (identifier) => {
      const record = await original(identifier);
      if (identifier === `sign-in-otp-${VICTIM}` && precheck) {
        precheck = false;
        if (mode === "missing") return null;
        if (!record) throw new Error("Expected the issued email code");
        return { ...record, value: "different-hash:0" };
      }
      return record;
    };
    const refused = await t.post("/sign-in/email-otp", { email: VICTIM, otp });
    expect(refused.status).toBe(400);
    expect(cookieFrom(refused)).toBe("");
    expect((t.store.user as { emailVerified: boolean }[])[0].emailVerified).toBe(false);
    expect((await t.post("/sign-in/email", { email: VICTIM, password: "attacker-password" })).status).toBe(403);
    expect(t.store.account).toEqual(accounts);
    expect(t.store.session).toEqual(sessions);
    const recovered = await otpSignIn(t);
    expect(recovered.status).toBe(200);
    expect((await t.session(cookieFrom(recovered)))?.user?.email).toBe(VICTIM);
    expect(t.store.account).toHaveLength(0);
    expect(t.store.session).toHaveLength(1);
  });
  test("UNT gate covers send and verify, and unused plugin flows are unavailable", async () => {
    const t = setup();
    expect((await t.post("/email-otp/send-verification-otp", { email: "student@gmail.com", type: "sign-in" })).status).toBe(400);
    expect((await t.post("/sign-in/email-otp", { email: "student@gmail.com", otp: "123456" })).status).toBe(400);
    expect((await t.post("/email-otp/send-verification-otp", { email: VICTIM, type: "forget-password" })).status).toBe(400);
    expect((await t.post("/email-otp/request-password-reset", { email: VICTIM })).status).toBe(404);
    expect(t.mail).toHaveLength(0);
  });
});

describe("security generation hooks", () => {
  test("set-password, recovery, reset and sign-out everywhere bump; ordinary OTP does not", async () => {
    const bumped: string[] = [];
    const t = setup(undefined, async (id) => { bumped.push(id); });
    const login = await otpSignIn(t);
    expect(login.status).toBe(200);
    const cookie = cookieFrom(login);
    const userId = (t.store.user as { id: string }[])[0].id;
    expect(bumped).toEqual([]);
    const setPassword = setPasswordHandler(t.auth, { sendEmail: t.send });
    expect((await setPassword(passwordRequest(cookie, "short"))).status).toBe(400);
    expect(bumped).toEqual([]);
    expect((await setPassword(passwordRequest(cookie))).status).toBe(200);
    expect(bumped).toEqual([userId]);
    expect((await setPassword(passwordRequest(cookie))).status).toBe(400);
    expect(bumped).toEqual([userId]);
    await t.post("/sign-in/magic-link", { email: VICTIM, callbackURL: "/courses" });
    expect((await t.get(t.lastVerifyLink())).status).toBe(302);
    expect(bumped).toEqual([userId, userId]);
    await t.post("/request-password-reset", { email: VICTIM, redirectTo: "/forgot-password" });
    const token = new URL(t.lastLink("password-reset")).pathname.split("/").pop()!;
    expect((await t.post("/reset-password", { token: "wrong", newPassword: "new-password-456" })).status).toBe(400);
    expect((await t.post("/reset-password", { token, newPassword: "short" })).status).toBe(400);
    expect(bumped).toHaveLength(2);
    expect((await t.post("/reset-password", { token, newPassword: "new-password-456" })).status).toBe(200);
    expect(bumped).toEqual([userId, userId, userId, userId]);
    const second = await otpSignIn(t);
    expect(second.status).toBe(200);
    expect((await t.post("/revoke-sessions", {}, cookieFrom(second))).status).toBe(200);
    expect(bumped).toEqual([userId, userId, userId, userId, userId]);
    expect(await t.session(cookieFrom(second))).toBeNull();
  });
  test("a valid OTP cleans an unverified account before a new session; wrong OTP leaves it alone", async () => {
    const bumped: string[] = [];
    const t = setup(undefined, async (id) => { bumped.push(id); });
    const ctx = await t.auth.$context;
    const user = await ctx.internalAdapter.createUser({ email: VICTIM, name: "Victim", emailVerified: false });
    await ctx.internalAdapter.createAccount({ userId: user.id, providerId: "credential", accountId: user.id, password: await ctx.password.hash("attacker-password") });
    await ctx.internalAdapter.createSession(user.id);
    bumped.length = 0;
    await t.post("/email-otp/send-verification-otp", { email: VICTIM, type: "sign-in" });
    expect((await t.post("/sign-in/email-otp", { email: VICTIM, otp: "wrong" })).status).toBe(400);
    expect(bumped).toEqual([]);
    expect(t.store.account).toHaveLength(1);
    const response = await t.post("/sign-in/email-otp", { email: VICTIM, otp: t.lastLink("email-code") });
    expect(response.status).toBe(200);
    expect(bumped).toEqual([user.id, user.id]);
    expect(t.store.account).toHaveLength(0);
    expect(t.store.session).toHaveLength(1);
    expect((await t.session(cookieFrom(response)))?.user?.email).toBe(VICTIM);
  });
  test("failed revocation blocks reset and sign-out everywhere before their writes", async () => {
    let storageAvailable = true;
    const t = setup(undefined, async () => {
      if (!storageAvailable) throw new Error("generation storage unavailable");
    });
    const cookie = cookieFrom(await otpSignIn(t));
    expect((await setPasswordHandler(t.auth, { sendEmail: t.send })(passwordRequest(cookie))).status).toBe(200);
    await t.post("/request-password-reset", { email: VICTIM, redirectTo: "/forgot-password" });
    const token = new URL(t.lastLink("password-reset")).pathname.split("/").pop()!;
    storageAvailable = false;
    expect((await t.post("/reset-password", { token, newPassword: "new-password-456" })).status).toBe(500);
    expect((await t.post("/sign-in/email", { email: VICTIM, password: "owner-password-123" })).status).toBe(200);
    expect((await t.post("/revoke-sessions", {}, cookie)).status).toBe(500);
    expect((await t.session(cookie))?.user?.email).toBe(VICTIM);
  });
  test("failed revocation blocks unverified cleanup and recovery before a session is issued", async () => {
    let storageAvailable = true;
    const t = setup(undefined, async () => {
      if (!storageAvailable) throw new Error("generation storage unavailable");
    });
    const ctx = await t.auth.$context;
    const user = await ctx.internalAdapter.createUser({ email: VICTIM, name: "Victim", emailVerified: false });
    await ctx.internalAdapter.createAccount({ userId: user.id, providerId: "credential", accountId: user.id, password: await ctx.password.hash("attacker-password") });
    await ctx.internalAdapter.createSession(user.id);
    storageAvailable = false;
    expect((await otpSignIn(t)).status).toBe(500);
    expect(t.store.account).toHaveLength(1);
    expect(t.store.session).toHaveLength(1);
    expect((t.store.user as { emailVerified: boolean }[])[0].emailVerified).toBe(false);
    await t.post("/sign-in/magic-link", { email: VICTIM, callbackURL: "/courses" });
    expect((await t.get(t.lastVerifyLink())).status).toBe(500);
    expect(t.store.account).toHaveLength(1);
    expect(t.store.session).toHaveLength(1);
  });
  test("a failed generation bump blocks the password write", async () => {
    const t = setup(undefined, async () => { throw new Error("generation storage unavailable"); });
    const cookie = cookieFrom(await otpSignIn(t));
    await expect(setPasswordHandler(t.auth, { sendEmail: t.send })(passwordRequest(cookie))).rejects.toThrow("generation storage unavailable");
    expect(t.store.account).toHaveLength(0);
  });
});
