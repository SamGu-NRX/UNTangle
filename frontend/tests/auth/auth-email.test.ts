import { describe, expect, test } from "bun:test";
import {
  assertEmailConfigured,
  deliverAuthEmail,
  emailDelivery,
  renderAuthEmail,
  type ResendLike,
} from "@/lib/auth-email";

const URL_ = "https://untangle.example/api/auth/magic-link/verify?token=abc&callbackURL=%2Fcourses";

function recorder(error: { message: string } | null = null) {
  const sent: Parameters<ResendLike["emails"]["send"]>[0][] = [];
  const keys: string[] = [];
  const createClient = (apiKey: string): ResendLike => {
    keys.push(apiKey);
    return {
      emails: {
        send: async (payload) => {
          sent.push(payload);
          return { error };
        },
      },
    };
  };
  return { sent, keys, createClient };
}

describe("auth email template", () => {
  test("each kind has its subject", () => {
    expect(renderAuthEmail("magic-link", URL_).subject).toBe("Your UNTangle sign-in link");
    expect(renderAuthEmail("verify-email", URL_).subject).toBe("Verify your UNTangle email");
    expect(renderAuthEmail("password-reset", URL_).subject).toBe("Reset your UNTangle password");
  });

  test("one button, the link as plain text, and the didn't-request line, in HTML and text", () => {
    const { html, text } = renderAuthEmail("magic-link", URL_);
    const escaped = URL_.replaceAll("&", "&amp;");
    expect(html).toContain("UNTangle");
    expect(html.match(/<a /g)).toHaveLength(2); // the button and the pasteable link
    expect(html).toContain(`href="${escaped}"`);
    expect(html).toContain("Didn't request this?");
    expect(text).toContain(URL_);
    expect(text).toContain("Didn't request this?");
    expect(text).not.toContain("<");
  });

  test("a hostile URL can't break out of the attribute", () => {
    const { html } = renderAuthEmail("magic-link", 'https://x.test/?a="><script>alert(1)</script>');
    expect(html).not.toContain("<script>");
  });
});

describe("delivery", () => {
  test("development without a key writes the link to the server log instead of sending", async () => {
    const lines: string[] = [];
    const { sent, createClient } = recorder();
    const mode = await deliverAuthEmail("magic-link", "eagle@my.unt.edu", URL_, {
      env: { NODE_ENV: "development" },
      createClient,
      log: (line) => lines.push(line),
    });
    expect(mode).toBe("server-log");
    expect(sent).toHaveLength(0);
    expect(lines[0]).toContain("eagle@my.unt.edu");
    expect(lines[0]).toContain(URL_);
    expect(lines[0]).toContain("Email isn't set up here");
  });

  test("with a key, Resend gets the rendered email with a text alternative", async () => {
    const { sent, keys, createClient } = recorder();
    const mode = await deliverAuthEmail("verify-email", "eagle@my.unt.edu", URL_, {
      env: { NODE_ENV: "production", RESEND_API_KEY: "re_test", RESEND_FROM_EMAIL: "UNTangle <auth@untangle.example>" },
      createClient,
      log: () => {
        throw new Error("must not log a link when email is configured");
      },
    });
    expect(mode).toBe("resend");
    expect(keys).toEqual(["re_test"]);
    expect(sent[0]).toMatchObject({
      from: "UNTangle <auth@untangle.example>",
      to: ["eagle@my.unt.edu"],
      subject: "Verify your UNTangle email",
    });
    expect(sent[0].text).toContain(URL_);
  });

  test("a refusal from Resend fails the send, so the request fails visibly", async () => {
    const { createClient } = recorder({ message: "domain not verified" });
    await expect(
      deliverAuthEmail("magic-link", "eagle@my.unt.edu", URL_, {
        env: { NODE_ENV: "development", RESEND_API_KEY: "re_test" },
        createClient,
        log: () => {},
      }),
    ).rejects.toThrow("domain not verified");
  });

  test("a production server never falls back to the log", () => {
    expect(() => emailDelivery({ NODE_ENV: "production" })).toThrow("RESEND_API_KEY");
  });
});

describe("production configuration check", () => {
  test("a production server without the Resend variables refuses to start, naming them", () => {
    expect(() => assertEmailConfigured({ NODE_ENV: "production" })).toThrow("RESEND_API_KEY and RESEND_FROM_EMAIL");
    expect(() => assertEmailConfigured({ NODE_ENV: "production", RESEND_API_KEY: "re_x" })).toThrow("RESEND_FROM_EMAIL");
  });

  test("passes with both set, during the build, and outside production", () => {
    expect(() =>
      assertEmailConfigured({ NODE_ENV: "production", RESEND_API_KEY: "re_x", RESEND_FROM_EMAIL: "a@b.test" }),
    ).not.toThrow();
    expect(() => assertEmailConfigured({ NODE_ENV: "production", NEXT_PHASE: "phase-production-build" })).not.toThrow();
    expect(() => assertEmailConfigured({ NODE_ENV: "development" })).not.toThrow();
  });
});
