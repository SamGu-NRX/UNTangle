import { beforeAll, describe, expect, mock, test } from "bun:test";

// Offline sign-up endpoint tests: the better-auth instance is driven through
// the real /api/auth/[...all] route handler, but its database and email
// delivery are mocked so nothing ever touches a real database or network.

type PostFn = (request: Request) => Promise<Response>;

/**
 * Fake drizzle query builder: every chainable call returns another builder,
 * and awaiting the chain resolves. Insert chains return the values they were
 * given (mimicking `.returning()`); fresh query roots (select/update/delete)
 * resolve to an empty result set, i.e. no pre-existing rows.
 */
function makeFakeDb(): unknown {
  let pendingValues: Record<string, unknown>[] = [];
  const makeBuilder = (): unknown => {
    const callable = () => makeBuilder();
    return new Proxy(callable, {
      get(_target, prop) {
        if (prop === "then") {
          return (
            onFulfilled?: (value: unknown) => unknown,
            onRejected?: (reason: unknown) => unknown,
          ) => Promise.resolve(pendingValues).then(onFulfilled, onRejected);
        }
        if (prop === "select" || prop === "update" || prop === "delete" || prop === "insert") {
          return () => {
            pendingValues = [];
            return makeBuilder();
          };
        }
        if (prop === "values") {
          return (data: Record<string, unknown>) => {
            pendingValues = Array.isArray(data) ? data : [data];
            return makeBuilder();
          };
        }
        if (prop === "returning") {
          return () => Promise.resolve(pendingValues);
        }
        return () => makeBuilder();
      },
      apply() {
        return makeBuilder();
      },
    });
  };
  return makeBuilder();
}

mock.module("@/lib/db", () => ({ db: makeFakeDb(), hasDatabaseUrl: true }));
type SentEmail = { kind: string; to: string; url: string };
const sentEmails: SentEmail[] = [];
let emailFailure: Error | null = null;
mock.module("@/lib/email", () => ({
  sendAuthEmail: async (kind: string, to: string, url: string) => {
    if (emailFailure) throw emailFailure;
    sentEmails.push({ kind, to, url });
    return "server-log";
  },
}));

let POST: PostFn;

beforeAll(async () => {
  ({ POST } = await import("@/app/api/auth/[...all]/route"));
});

function signUpRequest(email: string) {
  return new Request("http://localhost:3000/api/auth/sign-up/email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
    },
    body: JSON.stringify({
      email,
      password: "eagle-scrapper-2026",
      name: "Test Student",
    }),
  });
}

describe("POST /api/auth/sign-up/email (UNT-email gate)", () => {
  test("rejects a non-UNT email with 400 and the UNT requirement message", async () => {
    const response = await POST(signUpRequest("student@gmail.com"));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(JSON.stringify(body)).toContain("@unt.edu");
  });

  test("rejects lookalike domains that merely contain unt.edu", async () => {
    for (const email of ["student@unt.edu.evil.com", "student@unt.edu.some-tld.com"]) {
      const response = await POST(signUpRequest(email));
      expect(response.status).toBe(400);
    }
  });

  test("rejects emails with no recognizable UNT domain", async () => {
    for (const email of ["student@tx.edu", "student@unt.edu.com", "student@my.unt.edu.fake"]) {
      const response = await POST(signUpRequest(email));
      expect(response.status).toBe(400);
    }
  });

  test("accepts @unt.edu addresses, case-insensitively", async () => {
    for (const email of ["student@unt.edu", "Student@UNT.EDU", "FIRST.LAST@Unt.Edu"]) {
      const response = await POST(signUpRequest(email));
      expect(response.status).toBe(200);
    }
  });

  test("accepts @my.unt.edu addresses, case-insensitively", async () => {
    for (const email of ["student@my.unt.edu", "Student@MY.UNT.EDU"]) {
      const response = await POST(signUpRequest(email));
      expect(response.status).toBe(200);
    }
  });
});

function magicLinkRequest(email: string) {
  return new Request("http://localhost:3000/api/auth/sign-in/magic-link", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3000" },
    body: JSON.stringify({ email, callbackURL: "/courses", errorCallbackURL: "/auth?link=failed" }),
  });
}

describe("POST /api/auth/sign-in/magic-link", () => {
  test("a UNT address gets one sign-in link, pointing at the verify endpoint with the callback", async () => {
    sentEmails.length = 0;
    emailFailure = null;
    const response = await POST(magicLinkRequest("Eagle@My.UNT.edu"));
    expect(response.status).toBe(200);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].kind).toBe("magic-link");
    const url = new URL(sentEmails[0].url);
    expect(url.pathname).toBe("/api/auth/magic-link/verify");
    expect(url.searchParams.get("token")).toBeTruthy();
    expect(url.searchParams.get("callbackURL")).toBe("/courses");
  });

  test("a non-UNT address is refused before any link is made, so no account can be created for it", async () => {
    sentEmails.length = 0;
    for (const email of ["student@gmail.com", "student@unt.edu.evil.com"]) {
      const response = await POST(magicLinkRequest(email));
      expect(response.status).toBe(400);
      expect(JSON.stringify(await response.json())).toContain("@unt.edu");
    }
    expect(sentEmails).toHaveLength(0);
  });

  test("a failed send fails the request instead of reporting success", async () => {
    emailFailure = new Error("Resend refused the magic-link email: domain not verified");
    const response = await POST(magicLinkRequest("eagle@my.unt.edu"));
    emailFailure = null;
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});

describe("password sign-up email verification", () => {
  test("a password sign-up sends a verification link to the new address", async () => {
    sentEmails.length = 0;
    emailFailure = null;
    const response = await POST(signUpRequest("newstudent@my.unt.edu"));
    expect(response.status).toBe(200);
    // better-auth may send after responding; give it a turn.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const verification = sentEmails.find((email) => email.kind === "verify-email");
    expect(verification?.to).toBe("newstudent@my.unt.edu");
    expect(new URL(verification!.url).pathname).toBe("/api/auth/verify-email");
  });
});
