import { describe, expect, test } from "bun:test";
import { memoryAdapter } from "better-auth/adapters/memory";
import { createAuth } from "@/lib/auth-config";
import { memoryClaims } from "@/lib/magic-link-claims";
import { deliverAuthEmail } from "@/lib/auth-email";
import { memoryBudgetStore } from "@/lib/email-budget";

// The real auth flows on an in-memory database: each test drives the
// better-auth handler with Requests, the way a browser (or an attacker)
// would, and reads the emails it would have sent.

const BASE = "http://localhost:3000";
const VICTIM = "victim@my.unt.edu";

/**
 * The memory adapter answers in the same tick, which hides races. Reads of
 * a verification row here take a few milliseconds, like a database round
 * trip, so concurrent verifies interleave the way they do in production.
 */
function withReadLatency(adapter: ReturnType<typeof memoryAdapter>): ReturnType<typeof memoryAdapter> {
  return ((options: Parameters<ReturnType<typeof memoryAdapter>>[0]) => {
    const inner = adapter(options);
    const pause = (model: string) => (model === "verification" ? new Promise((r) => setTimeout(r, 15)) : undefined);
    return {
      ...inner,
      findOne: async (args: Parameters<typeof inner.findOne>[0]) => {
        const row = await inner.findOne(args);
        await pause(args.model);
        return row;
      },
      findMany: async (args: Parameters<typeof inner.findMany>[0]) => {
        const rows = await inner.findMany(args);
        await pause(args.model);
        return rows;
      },
    };
  }) as ReturnType<typeof memoryAdapter>;
}

function setup(sendEmail?: Parameters<typeof createAuth>[0]["sendEmail"]) {
  const store: Record<string, unknown[]> = { user: [], session: [], account: [], verification: [] };
  const mail: { kind: string; to: string; url: string }[] = [];
  const auth = createAuth({
    database: withReadLatency(memoryAdapter(store)),
    baseURL: BASE,
    secret: "test-secret-at-least-32-characters-long",
    claims: memoryClaims(),
    sendEmail:
      sendEmail ??
      (async (kind, to, url) => {
        mail.push({ kind, to, url });
      }),
  });
  const post = (path: string, body: unknown, cookie?: string) =>
    auth.handler(
      new Request(`${BASE}/api/auth${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: BASE, ...(cookie ? { cookie } : {}) },
        body: JSON.stringify(body),
      }),
    );
  const get = (url: string, cookie?: string) =>
    auth.handler(new Request(url, { headers: cookie ? { cookie, origin: BASE } : { origin: BASE } }));
  const session = async (cookie: string) => (await (await get(`${BASE}/api/auth/get-session`, cookie)).json()) as { user?: { email: string } } | null;
  const lastLink = (kind: string) => [...mail].reverse().find((m) => m.kind === kind)?.url ?? "";
  return { auth, store, mail, post, get, session, lastLink };
}

/** The session cookie a response set, as a Cookie header ("" if none). */
function cookieFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .filter((c) => c.includes("session_token=") && !c.endsWith("="))
    .join("; ");
}

describe("account pre-hijacking", () => {
  test("a password sign-up gets no session, and can't sign in until the address is verified", async () => {
    const { post } = setup();
    const signUp = await post("/sign-up/email", { email: VICTIM, password: "attacker-password", name: "Attacker" });
    expect(signUp.status).toBe(200);
    expect(cookieFrom(signUp)).toBe("");
    const signIn = await post("/sign-in/email", { email: VICTIM, password: "attacker-password" });
    expect(signIn.status).toBe(403);
    expect(cookieFrom(signIn)).toBe("");
  });

  test("attacker signs up with the victim's address; the victim's sign-in link removes the attacker's password and sessions", async () => {
    const { auth, post, get, session, lastLink, store } = setup();
    // 1. The attacker creates an unverified account with their own password.
    await post("/sign-up/email", { email: VICTIM, password: "attacker-password", name: "Attacker" });
    const user = (store.user as { id: string; email: string }[]).find((u) => u.email === VICTIM)!;
    // 2. Suppose the attacker holds a session anyway (one made before this fix, or any other way).
    const ctx = await auth.$context;
    const planted = await ctx.internalAdapter.createSession(user.id);
    const attackerCookie = `better-auth.session_token=${planted.token}`;
    expect((await session(await signed(auth, attackerCookie)))?.user?.email).toBe(VICTIM);

    // 3. The victim asks for a sign-in link and opens it.
    expect((await post("/sign-in/magic-link", { email: VICTIM, callbackURL: "/courses" })).status).toBe(200);
    const verify = await get(lastLink("magic-link"));
    expect(verify.status).toBe(302);
    const victimCookie = cookieFrom(verify);
    expect((await session(victimCookie))?.user?.email).toBe(VICTIM);

    // 4. The attacker's password and session no longer work.
    const attackerSignIn = await post("/sign-in/email", { email: VICTIM, password: "attacker-password" });
    expect(attackerSignIn.status).toBe(401);
    expect(cookieFrom(attackerSignIn)).toBe("");
    expect(await session(await signed(auth, attackerCookie))).toBeNull();
    expect((store.account as { providerId: string }[]).filter((a) => a.providerId === "credential")).toHaveLength(0);
  });

  test("a verified account keeps its password when its owner also uses a sign-in link", async () => {
    const { post, get, lastLink } = setup();
    await post("/sign-up/email", { email: VICTIM, password: "owner-password", name: "Owner" });
    // The owner opens their verification email.
    expect((await get(lastLink("verify-email"))).status).toBe(302);
    await post("/sign-in/magic-link", { email: VICTIM, callbackURL: "/courses" });
    expect((await get(lastLink("magic-link"))).status).toBe(302);
    expect((await post("/sign-in/email", { email: VICTIM, password: "owner-password" })).status).toBe(200);
  });
});

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

describe("email bombing", () => {
  test("12 parallel sign-in link requests for one inbox send 3 emails; the rest get 429", async () => {
    const logged: string[] = [];
    const budget = memoryBudgetStore();
    const { post } = setup((kind, to, url) =>
      deliverAuthEmail(kind, to, url, {
        env: { NODE_ENV: "development" },
        createClient: () => {
          throw new Error("no Resend in this test");
        },
        log: (line) => logged.push(line),
        budget,
      }),
    );
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

/** better-auth signs its session cookie; a raw token from the adapter needs the same signature to be presented. */
async function signed(auth: ReturnType<typeof createAuth>, cookie: string): Promise<string> {
  const [name, token] = cookie.split("=");
  const ctx = await auth.$context;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(ctx.secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token))).toString("base64");
  return `${name}=${encodeURIComponent(`${token}.${signature}`)}`;
}
