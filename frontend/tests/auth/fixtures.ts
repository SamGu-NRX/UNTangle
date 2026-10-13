import { memoryAdapter } from "better-auth/adapters/memory";
import { createAuth } from "@/lib/auth-config";
import { memoryClaims } from "@/lib/magic-link-claims";
import { VERIFY_PATH } from "@/lib/magic-link-url";

// The real auth flows on an in-memory database, for tests that drive the
// better-auth handler with Requests the way a browser (or an attacker)
// would. No module mocks: each test builds its own instance.

export const BASE = "http://localhost:3000";
export const VICTIM = "victim@my.unt.edu";

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

export function setup(sendEmail?: Parameters<typeof createAuth>[0]["sendEmail"]) {
  const store: Record<string, unknown[]> = { user: [], session: [], account: [], verification: [] };
  const mail: { kind: string; to: string; url: string }[] = [];
  const record = async (kind: string, to: string, url: string) => {
    mail.push({ kind, to, url });
  };
  const auth = createAuth({
    database: withReadLatency(memoryAdapter(store)),
    baseURL: BASE,
    secret: "test-secret-at-least-32-characters-long",
    claims: memoryClaims(),
    sendEmail: sendEmail ?? record,
    // NODE_ENV=test makes better-auth skip its origin and CSRF checks; these tests run with them on.
    options: { advanced: { disableOriginCheck: false } },
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
  /** The URL the emailed sign-in link's landing page (/auth/link) submits to when the button is pressed. */
  const lastVerifyLink = () => verifyFromLanding(lastLink("magic-link"));
  return { auth, store, mail, post, get, session, lastLink, lastVerifyLink, send: record };
}

/** The session cookie a response set, as a Cookie header ("" if none). */
export function cookieFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .filter((c) => c.includes("session_token=") && !c.endsWith("="))
    .join("; ");
}

/** better-auth signs its session cookie; a raw token from the adapter needs the same signature to be presented. */
export async function signed(auth: ReturnType<typeof createAuth>, cookie: string): Promise<string> {
  const [name, token] = cookie.split("=");
  const ctx = await auth.$context;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(ctx.secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token))).toString("base64");
  return `${name}=${encodeURIComponent(`${token}.${signature}`)}`;
}

/** What /auth/link's form submits: the same parameters, at better-auth's verify path. */
export function verifyFromLanding(landing: string): string {
  const url = new URL(landing);
  const verify = new URL(VERIFY_PATH, url.origin);
  verify.search = url.hash.replace(/^#/, "");
  return verify.toString();
}
