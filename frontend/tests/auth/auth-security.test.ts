import { describe, expect, test } from "bun:test";
import { toNextJsHandler } from "better-auth/next-js";
import { BASE, VICTIM, cookieFrom, setup, signed } from "./fixtures";
import { deliverAuthEmail } from "@/lib/auth-email";
import { recipientBudget } from "@/lib/email-budget";
import { memoryStore } from "@/lib/rate-limit/store";
import { createRateLimitWrapper } from "@/lib/rate-limit/wrapper";
import { authGetHandler } from "@/lib/auth-get";
import { SET_PASSWORD_MAX_SESSION_AGE_MS, setPasswordHandler } from "@/lib/account-password";

// Attacks on the real auth flows (fixtures.ts: better-auth on an in-memory
// database). Each test reproduces an attack the fix has to stop.

/** Asks for a sign-in link to `email` and opens it; returns the session cookie it set. */
async function signInByLink(t: ReturnType<typeof setup>, email: string): Promise<string> {
  expect((await t.post("/sign-in/magic-link", { email, callbackURL: "/courses" })).status).toBe(200);
  const verify = await t.get(t.lastVerifyLink());
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
    const setPassword = setPasswordHandler(t.auth, { sendEmail: t.send });
    const set = await setPassword(passwordRequest("owner-password-123", cookie));
    expect(set.status).toBe(200);
    // The owner is told a password was added.
    expect(t.mail.filter((m) => m.kind === "password-added").map((m) => m.to)).toEqual([VICTIM]);
    const signIn = await t.post("/sign-in/email", { email: VICTIM, password: "owner-password-123" });
    expect(signIn.status).toBe(200);
    expect(cookieFrom(signIn)).not.toBe("");
    // A second "set" can't replace it.
    expect((await setPassword(passwordRequest("another-password-1", cookie))).status).toBe(400);
  });

  test("setting a password needs a session from this site", async () => {
    const t = setup();
    const cookie = await signInByLink(t, VICTIM);
    const setPassword = setPasswordHandler(t.auth, { sendEmail: t.send });
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
    expect((await setPasswordHandler(t.auth, { sendEmail: t.send })(passwordRequest("attacker-password", ""))).status).toBe(401);
  });

  test("an owner with a password keeps it when they also use a sign-in link", async () => {
    const t = setup();
    const first = await signInByLink(t, VICTIM);
    expect((await setPasswordHandler(t.auth, { sendEmail: t.send })(passwordRequest("owner-password-123", first))).status).toBe(200);
    await signInByLink(t, VICTIM);
    expect((await t.post("/sign-in/email", { email: VICTIM, password: "owner-password-123" })).status).toBe(200);
  });
});

describe("a password is added only right after signing in", () => {
  test("a session older than 10 minutes is refused, with a reason; a fresh one works", async () => {
    const t = setup();
    const cookie = await signInByLink(t, VICTIM);
    let clock = Date.now() + SET_PASSWORD_MAX_SESSION_AGE_MS + 60_000;
    const later = setPasswordHandler(t.auth, { sendEmail: t.send, now: () => clock });
    const stale = await later(passwordRequest("owner-password-123", cookie));
    expect(stale.status).toBe(403);
    expect(await stale.json()).toMatchObject({ code: "SESSION_TOO_OLD" });
    expect(t.mail.some((m) => m.kind === "password-added")).toBe(false);
    clock = Date.now();
    expect((await later(passwordRequest("owner-password-123", cookie))).status).toBe(200);
  });

  test("the body must be JSON by media type, not by a substring", async () => {
    const t = setup();
    const cookie = await signInByLink(t, VICTIM);
    const request = new Request(`${BASE}/api/account/set-password`, {
      method: "POST",
      headers: { "content-type": "text/plain; note=application/json", origin: BASE, cookie },
      body: JSON.stringify({ newPassword: "owner-password-123" }),
    });
    expect((await setPasswordHandler(t.auth, { sendEmail: t.send })(request)).status).toBe(415);
  });
});

describe("a password reset ends other sessions", () => {
  test("after a reset from the inbox, a session from before it no longer works", async () => {
    const t = setup();
    const before = await signInByLink(t, VICTIM);
    expect((await setPasswordHandler(t.auth, { sendEmail: t.send })(passwordRequest("owner-password-123", before))).status).toBe(200);
    expect((await t.post("/request-password-reset", { email: VICTIM, redirectTo: "/forgot-password" })).status).toBe(200);
    const token = new URL(t.lastLink("password-reset")).pathname.split("/").pop()!;
    expect((await t.post("/reset-password", { newPassword: "new-password-456", token })).status).toBe(200);
    expect(await t.session(before)).toBeNull();
    expect((await t.post("/sign-in/email", { email: VICTIM, password: "new-password-456" })).status).toBe(200);
  });
});

describe("a refused sign-in link never sends the browser off-site", () => {
  async function usedLink(t: ReturnType<typeof setup>) {
    await t.post("/sign-in/magic-link", { email: VICTIM, callbackURL: "/courses" });
    const link = t.lastVerifyLink();
    expect(cookieFrom(await t.get(link))).not.toBe("");
    return new URL(link);
  }

  test("errorCallbackURL to another site, on a used token, is refused without a redirect", async () => {
    const t = setup();
    const link = await usedLink(t);
    link.searchParams.set("errorCallbackURL", "https://evil.example/phish");
    const response = await t.get(link.toString());
    expect(response.status).toBe(403);
    expect(response.headers.get("location")).toBeNull();
  });

  test("a malformed escape in errorCallbackURL is refused, not a server error", async () => {
    const t = setup();
    const link = await usedLink(t);
    link.searchParams.set("errorCallbackURL", "%E0%A4%A");
    const response = await t.get(link.toString());
    expect(response.status).toBe(403);
  });

  test("a bad callback on a fresh link is refused before the link is claimed or any cleanup runs", async () => {
    const t = setup();
    // A never-verified account with a password (only possible from before sign-up was disabled).
    const ctx = await t.auth.$context;
    const user = await ctx.internalAdapter.createUser({ email: VICTIM, name: "Old", emailVerified: false });
    await ctx.internalAdapter.linkAccount({ userId: user.id, providerId: "credential", accountId: user.id, password: await ctx.password.hash("old-password-1") });
    await t.post("/sign-in/magic-link", { email: VICTIM, callbackURL: "/courses" });
    const good = new URL(t.lastVerifyLink());
    for (const [name, value] of [["callbackURL", "https://evil.example/"], ["newUserCallbackURL", "https://evil.example/"], ["errorCallbackURL", "%E0%A4%A"]]) {
      const bad = new URL(good);
      bad.searchParams.set(name, value);
      expect((await t.get(bad.toString())).status).toBe(403);
    }
    // Nothing was claimed or cleaned up: the password is still there, and the link still works.
    expect((t.store.account as { providerId: string }[]).filter((a) => a.providerId === "credential")).toHaveLength(1);
    expect(cookieFrom(await t.get(good.toString()))).not.toBe("");
  });

  test("better-auth's own origin check is on in these tests: a sign-in link with an off-site callback is refused", async () => {
    const t = setup();
    const response = await t.post("/sign-in/magic-link", { email: VICTIM, callbackURL: "https://evil.example/" });
    expect(response.status).toBe(403);
    expect(t.mail).toHaveLength(0);
  });
});

describe("sign-in links can't be used across sites", () => {
  const verifyWith = (t: ReturnType<typeof setup>, url: string, site?: string) =>
    t.auth.handler(new Request(url, { headers: site ? { "sec-fetch-site": site } : {} }));

  test("a cross-site verify (another site signing this browser in) is refused, and the token stays unused", async () => {
    const t = setup();
    await t.post("/sign-in/magic-link", { email: VICTIM, callbackURL: "/courses" });
    const link = t.lastVerifyLink();
    const crossSite = await verifyWith(t, link, "cross-site");
    expect(crossSite.status).toBe(403);
    expect(cookieFrom(crossSite)).toBe("");
    expect(cookieFrom(await verifyWith(t, link, "same-origin"))).not.toBe("");
  });

  test("a verify without Sec-Fetch-Site (older browsers, other clients) is allowed", async () => {
    const t = setup();
    await t.post("/sign-in/magic-link", { email: VICTIM, callbackURL: "/courses" });
    expect(cookieFrom(await verifyWith(t, t.lastVerifyLink()))).not.toBe("");
  });
});

describe("better-auth's origin check guards its own endpoints", () => {
  async function signedIn() {
    const t = setup();
    return { t, cookie: await signInByLink(t, VICTIM) };
  }
  const signOut = (t: ReturnType<typeof setup>, cookie: string, origin?: string) =>
    t.auth.handler(
      new Request(`${BASE}/api/auth/sign-out`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie, ...(origin ? { origin } : {}) },
        body: "{}",
      }),
    );

  test("a cookie-bearing POST from a foreign Origin is refused", async () => {
    const { t, cookie } = await signedIn();
    expect((await signOut(t, cookie, "https://evil.example")).status).toBe(403);
    expect((await t.session(cookie))?.user?.email).toBe(VICTIM);
  });

  test("a cookie-bearing POST with no Origin is refused", async () => {
    const { t, cookie } = await signedIn();
    expect((await signOut(t, cookie)).status).toBe(403);
    expect((await t.session(cookie))?.user?.email).toBe(VICTIM);
    expect((await signOut(t, cookie, BASE)).status).toBe(200);
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
    const { post, get, lastVerifyLink, store } = setup();
    await post("/sign-in/magic-link", { email: VICTIM, callbackURL: "/courses", errorCallbackURL: "/auth?link=failed" });
    const link = lastVerifyLink();
    const responses = await Promise.all([get(link), get(link), get(link)]);
    const withSession = responses.filter((r) => cookieFrom(r) !== "");
    expect(withSession).toHaveLength(1);
    const refused = responses.filter((r) => cookieFrom(r) === "");
    for (const r of refused) expect(r.headers.get("location")).toContain("error=");
    expect(store.session).toHaveLength(1);
  });

  test("a link used once is refused afterwards", async () => {
    const { post, get, lastVerifyLink } = setup();
    await post("/sign-in/magic-link", { email: VICTIM, callbackURL: "/courses", errorCallbackURL: "/auth?link=failed" });
    const link = lastVerifyLink();
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

  test("an exhausted magic-link IP budget answers 429 for a recipient with room left", async () => {
    const logged: string[] = [];
    const { link } = wrapped(logged);
    for (let i = 0; i < 5; i++) expect((await link(`student${i}@my.unt.edu`)).status).toBe(200);
    const blocked = await link("fresh@my.unt.edu");
    expect(blocked.status).toBe(429);
    expect(logged).toHaveLength(5);
  });
});


test("concurrent GET magic-link verification requests stop at the atomic path budget", async () => {
  const t = setup();
  const handler = toNextJsHandler(t.auth).GET;
  let admitted = 0;
  const GET = authGetHandler(
    (request: Request) => { admitted++; return handler(request); },
    createRateLimitWrapper({ store: memoryStore(), session: async () => null, secret: "test", now: () => 30_000 }),
  );
  const replies = await Promise.all(Array.from({ length: 12 }, () => GET(new Request(`${BASE}/api/auth/magic-link/verify?token=missing&callbackURL=/courses`))));
  expect(replies.filter(r => r.status === 429)).toHaveLength(7);
  expect(replies.filter(r => r.status === 302)).toHaveLength(5);
  expect(admitted).toBe(5);
});

test("session GETs leave the shared auth bucket untouched, even when verification is exhausted", async () => {
  const t = setup();
  const cookie = await signInByLink(t, VICTIM);
  const store = memoryStore();
  const hits: string[] = [];
  const GET = authGetHandler(toNextJsHandler(t.auth).GET, createRateLimitWrapper({
    store: {
      hitLastRequest: (route, ...args) => {
        hits.push(route);
        return store.hitLastRequest(route, ...args);
      },
      hit: (route, ...args) => {
        hits.push(route);
        return store.hit(route, ...args);
      },
    },
    session: async () => null,
    secret: "test",
    now: () => 30_000,
  }));
  const readSession = () => GET(new Request(`${BASE}/api/auth/get-session`, { headers: { cookie } }));

  // More reads than the shared 30/minute budget, all from the same IP.
  for (let i = 0; i < 40; i++) {
    const response = await readSession();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ user: { email: VICTIM } });
  }
  expect(hits).toEqual([]);

  for (let i = 0; i < 6; i++) {
    const response = await GET(new Request(`${BASE}/api/auth/magic-link/verify?token=missing&callbackURL=/courses`));
    expect(response.status).toBe(i < 5 ? 302 : 429);
  }
  expect(hits.filter(route => route === "auth")).toHaveLength(6);
  expect(hits.filter(route => route === "auth:/magic-link/verify")).toHaveLength(6);

  const after = await readSession();
  expect(after.status).toBe(200);
  expect(await after.json()).toMatchObject({ user: { email: VICTIM } });
  expect(hits).toHaveLength(12);
});
