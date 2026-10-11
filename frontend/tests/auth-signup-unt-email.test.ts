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
mock.module("@/lib/email", () => ({
  sendMagicLinkEmail: async () => {}, sendPasswordResetEmail: async () => {} }));

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
