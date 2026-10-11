import { beforeAll, describe, expect, mock, test } from "bun:test";
import { users } from "@/lib/db/schema";

// Offline magic-link endpoint tests: the better-auth instance is driven
// through the real /api/auth/[...all] route handler, but its database and
// email delivery are mocked. No test touches a real database or network, and
// no email ever leaves the process.

type PostFn = (request: Request) => Promise<Response>;

type ChainState = { pendingValues: Record<string, unknown>[]; table?: unknown };

/**
 * Fake drizzle query builder, extended from the shared pattern in
 * tests/auth-signup-unt-email.test.ts: awaiting a `select` chain resolves to
 * a user row only when the shared `state.userExists` flag is set and the
 * chain queried the user table; everything else resolves empty (or to the
 * values an insert was given, mimicking `.returning()`).
 */
function makeFakeDb(state: { userExists: boolean }): unknown {
  const makeBuilder = (chain: ChainState): unknown => {
    const callable = () => makeBuilder(chain);
    return new Proxy(callable, {
      get(_target, prop) {
        if (prop === "then") {
          return (
            onFulfilled?: (value: unknown) => unknown,
            onRejected?: (reason: unknown) => unknown,
          ) => {
            const value =
              chain.table === users
                ? state.userExists
                  ? [{ id: "u_existing" }]
                  : []
                : chain.pendingValues;
            return Promise.resolve(value).then(onFulfilled, onRejected);
          };
        }
        if (prop === "select" || prop === "update" || prop === "delete" || prop === "insert") {
          return () => makeBuilder({ pendingValues: [], table: undefined });
        }
        if (prop === "from") {
          return (table: unknown) => makeBuilder({ ...chain, table });
        }
        if (prop === "values") {
          return (data: Record<string, unknown>) =>
            makeBuilder({
              ...chain,
              pendingValues: Array.isArray(data) ? data : [data],
            });
        }
        if (prop === "returning") {
          return () => Promise.resolve(chain.pendingValues);
        }
        return () => makeBuilder(chain);
      },
      apply() {
        return makeBuilder(chain);
      },
    });
  };
  return makeBuilder({ pendingValues: [] });
}

const gateDbState: { userExists: boolean } = { userExists: false };
mock.module("@/lib/db", () => ({ db: makeFakeDb(gateDbState), hasDatabaseUrl: true }));

const magicLinkSends: Array<{ email: string; url: string }> = [];
mock.module("@/lib/email", () => ({
  sendPasswordResetEmail: async () => {},
  sendMagicLinkEmail: async (email: string, url: string) => {
    magicLinkSends.push({ email, url });
  },
}));

let POST: PostFn;

beforeAll(async () => {
  ({ POST } = await import("@/app/api/auth/[...all]/route"));
});

function magicLinkRequest(body: Record<string, unknown>) {
  return new Request("http://localhost:3000/api/auth/sign-in/magic-link", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
    },
    body: JSON.stringify({
      callbackURL: "/courses",
      errorCallbackURL: "/auth",
      newUserCallbackURL: "/courses",
      ...body,
    }),
  });
}

describe("POST /api/auth/sign-in/magic-link", () => {
  test("refuses a magic link that would create a non-UNT account", async () => {
    const response = await POST(magicLinkRequest({ email: "student@gmail.com", name: "S" }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(JSON.stringify(body)).toContain("@unt.edu");
    expect(magicLinkSends).toHaveLength(0);
  });

  test("sends a single-use verification link for a UNT address", async () => {
    const response = await POST(
      magicLinkRequest({ email: "eval-gate@my.unt.edu", name: "Eval Gate" }),
    );
    expect(response.status).toBe(200);

    expect(magicLinkSends).toHaveLength(1);
    const { email, url } = magicLinkSends[0];
    expect(email).toBe("eval-gate@my.unt.edu");
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/api/auth/magic-link/verify");
    expect(parsed.searchParams.get("token")).toBeTruthy();
    expect(parsed.searchParams.get("callbackURL")).toBe("/courses");
  });

  test("still allows sign-in for an existing account with a non-UNT address", async () => {
    // A legacy account (pre-gate) must not be locked out: the gate is a
    // sign-up gate. The shared fake db reports the user row as existing.
    gateDbState.userExists = true;

    const response = await POST(magicLinkRequest({ email: "legacy@gmail.com", name: "Legacy" }));
    expect(response.status).toBe(200);
    expect(magicLinkSends.at(-1)?.email).toBe("legacy@gmail.com");
    gateDbState.userExists = false;
  });
});
