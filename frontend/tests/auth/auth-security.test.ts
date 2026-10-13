import { describe, expect, test } from "bun:test";
import { BASE, VICTIM, cookieFrom, setup, signed } from "./fixtures";
import { deliverAuthEmail } from "@/lib/auth-email";
import { recipientBudget } from "@/lib/email-budget";
import { memoryStore } from "@/lib/rate-limit/store";
import { createRateLimitWrapper } from "@/lib/rate-limit/wrapper";
import { budgets } from "@/lib/rate-limit/config";
import { setPasswordHandler } from "@/lib/account-password";

// Attacks on the real auth flows (fixtures.ts: better-auth on an in-memory
// database). Each test reproduces an attack the fix has to stop.

/** Asks for a sign-in link to `email` and opens it; returns the session cookie it set. */
async function signInByLink(t: ReturnType<typeof setup>, email: string): Promise<string> {
  expect((await t.post("/sign-in/magic-link", { email, callbackURL: "/courses" })).status).toBe(200);
  const verify = await t.get(t.lastLink("magic-link"));
  expect(verify.status).toBe(302);
  return cookieFrom(verify);
}

describe("accounts come only from sign-in links", () => {
  test("password sign-up through the API is refused and creates nothing, for UNT and other addresses", async () => {
    const { post, store } = setup();
    for (const email of [VICTIM, "someone@gmail.com"]) {
      const signUp = await post("/sign-up/email", { email, password: "attacker-password", name: "Attacker" });
      expect(signUp.status).toBe(400);
      expect(cookieFrom(signUp)).toBe("");
    }
    expect(store.user).toHaveLength(0);
    expect(store.account).toHaveLength(0);
  });

  test("a sign-in link creates the account, verified, with no password", async () => {
    const t = setup();
    const cookie = await signInByLink(t, VICTIM);
    expect((await t.session(cookie))?.user?.email).toBe(VICTIM);
    const user = (t.store.user as { email: string; emailVerified: boolean }[])[0];
    expect(user).toMatchObject({ email: VICTIM, emailVerified: true });
    expect((t.store.account as { providerId: string }[]).some((a) => a.providerId === "credential")).toBe(false);
    expect((await t.post("/sign-in/email", { email: VICTIM, password: "anything-at-all" })).status).toBe(401);
  });

  test("signed in, the owner sets a password; password sign-in then works", async () => {
    const t = setup();
    const cookie = await signInByLink(t, VICTIM);
    const setPassword = setPasswordHandler(t.auth);
    const set = await setPassword(passwordRequest("owner-password-123", cookie));
    expect(set.status).toBe(200);
    const signIn = await t.post("/sign-in/email", { email: VICTIM, password: "owner-password-123" });
    expect(signIn.status).toBe(200);
    expect(cookieFrom(signIn)).not.toBe("");
    // A second "set" can't replace it.
    expect((await setPassword(passwordRequest("another-password-1", cookie))).status).toBe(400);
  });

  test("setting a password needs a session from this site", async () => {
    const t = setup();
    const cookie = await signInByLink(t, VICTIM);
    const setPassword = setPasswordHandler(t.auth);
    expect((await setPassword(passwordRequest("attacker-password", ""))).status).toBe(401);
    expect((await setPassword(passwordRequest("attacker-password", cookie, "https://evil.example"))).status).toBe(403);
    expect((t.store.account as { providerId: string }[]).some((a) => a.providerId === "credential")).toBe(false);
  });

  test("the old attack can't start: no sign-up, and no password without the victim's session", async () => {
    const t = setup();
    // The attacker tries to create the victim's account with their own password.
    expect((await t.post("/sign-up/email", { email: VICTIM, password: "attacker-password", name: "A" })).status).toBe(400);
    // The victim signs in by link, later; the attacker has nothing to sign in with.
    const victim = await signInByLink(t, VICTIM);
    expect((await t.session(victim))?.user?.email).toBe(VICTIM);
    expect((await t.post("/sign-in/email", { email: VICTIM, password: "attacker-password" })).status).toBe(401);
    expect((await setPasswordHandler(t.auth)(passwordRequest("attacker-password", ""))).status).toBe(401);
  });

  test("an owner with a password keeps it when they also use a sign-in link", async () => {
    const t = setup();
    const first = await signInByLink(t, VICTIM);
    expect((await setPasswordHandler(t.auth)(passwordRequest("owner-password-123", first))).status).toBe(200);
    await signInByLink(t, VICTIM);
    expect((await t.post("/sign-in/email", { email: VICTIM, password: "owner-password-123" })).status).toBe(200);
  });
});

describe("defense in depth: an unverified account met by a sign-in link", () => {
  test("a password and session on a never-verified account are removed when the inbox owner's link is used", async () => {
    const t = setup();
    // Only possible for accounts from before sign-up was disabled: seed one directly.
    const ctx = await t.auth.$context;
    const user = await ctx.internalAdapter.createUser({ email: VICTIM, name: "Attacker", emailVerified: false });
    await ctx.internalAdapter.linkAccount({
      userId: user.id,
      providerId: "credential",
      accountId: user.id,
      password: await ctx.password.hash("attacker-password"),
    });
    const planted = await ctx.internalAdapter.createSession(user.id);
    const attackerCookie = await signed(t.auth, `better-auth.session_token=${planted.token}`);
    expect((await t.session(attackerCookie))?.user?.email).toBe(VICTIM);
    // Unverified, the password can't sign in.
    expect((await t.post("/sign-in/email", { email: VICTIM, password: "attacker-password" })).status).toBe(403);

    const victim = await signInByLink(t, VICTIM);
    expect((await t.session(victim))?.user?.email).toBe(VICTIM);
    expect((await t.post("/sign-in/email", { email: VICTIM, password: "attacker-password" })).status).toBe(401);
    expect(await t.session(attackerCookie)).toBeNull();
    expect((t.store.account as { providerId: string }[]).filter((a) => a.providerId === "credential")).toHaveLength(0);
  });
});

function passwordRequest(newPassword: string, cookie: string, origin = BASE) {
  return new Request(`${BASE}/api/account/set-password`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ newPassword }),
  });
}

describe("sign-in links work once", () => {
  test("two requests using the same link at the same moment: one session, one refusal", async () => {
    const { post, get, lastLink, store } = setup();
    await post("/sign-in/magic-link", { email: VICTIM, callbackURL: "/courses", errorCallbackURL: "/auth?link=failed" });
    const link = lastLink("magic-link");
    const responses = await Promise.all([get(link), get(link), get(link)]);
    const withSession = responses.filter((r) => cookieFrom(r) !== "");
    expect(withSession).toHaveLength(1);
    const refused = responses.filter((r) => cookieFrom(r) === "");
    for (const r of refused) expect(r.headers.get("location")).toContain("error=");
    expect(store.session).toHaveLength(1);
  });

  test("a link used once is refused afterwards", async () => {
    const { post, get, lastLink } = setup();
    await post("/sign-in/magic-link", { email: VICTIM, callbackURL: "/courses", errorCallbackURL: "/auth?link=failed" });
    const link = lastLink("magic-link");
    expect(cookieFrom(await get(link))).not.toBe("");
    const again = await get(link);
    expect(cookieFrom(again)).toBe("");
    expect(again.headers.get("location")).toContain("/auth?link=failed");
  });
});

/** A sender with the real recipient budget on lib/rate-limit's memory store; links go to `logged`. */
function budgetedSender(logged: string[], now = () => 1_000_000) {
  const budget = recipientBudget({ store: memoryStore(), secret: "test-secret", now });
  return (kind: Parameters<typeof deliverAuthEmail>[0], to: string, url: string) =>
    deliverAuthEmail(kind, to, url, {
      env: { NODE_ENV: "development" },
      createClient: () => {
        throw new Error("no Resend in this test");
      },
      log: (line) => logged.push(line),
      budget,
    });
}

describe("email bombing", () => {
  test("12 parallel sign-in link requests for one inbox send 3 emails; the rest get 429", async () => {
    const logged: string[] = [];
    const { post } = setup(budgetedSender(logged));
    const statuses = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        post("/sign-in/magic-link", { email: i % 2 ? "Victim+x@my.unt.edu" : VICTIM, callbackURL: "/courses" }).then((r) => r.status),
      ),
    );
    expect(statuses.filter((s) => s === 200)).toHaveLength(3);
    expect(statuses.filter((s) => s === 429)).toHaveLength(9);
    expect(logged).toHaveLength(3);
  });
});

describe("the auth route's IP budget and the recipient budget compose", () => {
  /** The auth POST as the app serves it: lib/rate-limit's "auth" IP budget around better-auth. */
  function wrapped(logged: string[]) {
    const t = setup(budgetedSender(logged));
    const withRateLimit = createRateLimitWrapper({
      store: memoryStore(),
      session: async () => null,
      secret: "test-secret",
      now: () => 1_000_000,
    });
    const POST = withRateLimit("auth", (request: Request) => t.auth.handler(request));
    const link = (email: string) =>
      POST(
        new Request(`${BASE}/api/auth/sign-in/magic-link`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: BASE },
          body: JSON.stringify({ email, callbackURL: "/courses" }),
        }),
      );
    return { link };
  }

  test("an exhausted recipient budget answers 429 while the IP still has room", async () => {
    const logged: string[] = [];
    const { link } = wrapped(logged);
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await link(VICTIM)).status);
    expect(statuses).toEqual([200, 200, 200, 429]);
    expect((await link("someone-else@my.unt.edu")).status).toBe(200);
    expect(logged).toHaveLength(4);
  });

  test("an exhausted IP budget answers 429 for a recipient with room left", async () => {
    const logged: string[] = [];
    const { link } = wrapped(logged);
    for (let i = 0; i < budgets.auth.ip; i++) expect((await link(`student${i}@my.unt.edu`)).status).toBe(200);
    const blocked = await link("fresh@my.unt.edu");
    expect(blocked.status).toBe(429);
    expect(logged).toHaveLength(budgets.auth.ip);
  });
});
