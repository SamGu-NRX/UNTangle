import { describe, expect, test } from "bun:test";
import {
  MAGIC_LINK_GENERIC_ERROR,
  MAGIC_LINK_RATE_LIMIT_ERROR,
  sendMagicLink,
} from "@/lib/magic-link-flow";

// The dialog component itself is thin React wiring over these pieces; its
// rendering and accessibility are covered by the Playwright browser run.

function jsonFetch(status: number, body: unknown, seen: { url: string; init: RequestInit }) {
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    seen.url = String(url);
    seen.init = init ?? {};
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
}

describe("sendMagicLink (dialog + link-error resend path)", () => {
  test("posts the email and a course callback to the existing magic-link endpoint", async () => {
    const seen = {} as { url: string; init: RequestInit };
    const fetchLike = jsonFetch(200, { status: true }, seen);
    const result = await sendMagicLink(fetchLike, "person@my.unt.edu");
    expect(result.ok).toBe(true);
    expect(seen.url).toBe("/api/auth/sign-in/magic-link");
    const body = JSON.parse(String(seen.init.body));
    expect(body.email).toBe("person@my.unt.edu");
    expect(body.callbackURL).toBe("/courses");
    expect(body.errorCallbackURL).toBe("/sign-in/link-error");
  });

  test("maps a rate limit to the honest rate-limit copy", async () => {
    const seen = {} as { url: string; init: RequestInit };
    const result = await sendMagicLink(jsonFetch(429, { message: "no" }, seen), "person@my.unt.edu");
    expect(result.ok).toBe(false);
    expect(result.message).toBe(MAGIC_LINK_RATE_LIMIT_ERROR);
  });

  test("keeps the server's own message when it explains the failure", async () => {
    const seen = {} as { url: string; init: RequestInit };
    const result = await sendMagicLink(
      jsonFetch(400, { message: "Sign-up with a UNT email." }, seen),
      "someone@example.com",
    );
    expect(result.ok).toBe(false);
    expect(result.message).toBe("Sign-up with a UNT email.");
  });

  test("falls back to generic copy when the network itself fails", async () => {
    const fetchLike = (async () => {
      throw new Error("connection refused");
    }) as unknown as typeof fetch;
    const result = await sendMagicLink(fetchLike, "person@my.unt.edu");
    expect(result.ok).toBe(false);
    expect(result.message).toBe(MAGIC_LINK_GENERIC_ERROR);
  });
});
