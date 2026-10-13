import { describe, expect, test } from "bun:test";
import {
  assertEmailConfigured,
  deliverAuthEmail,
  emailDelivery,
  renderAuthEmail,
  type ResendLike,
} from "@/lib/auth-email";
import { budgetKey, EmailBudgetExceeded, memoryBudgetStore } from "@/lib/email-budget";

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
      budget: memoryBudgetStore(),
    });
    expect(mode).toBe("server-log");
    expect(sent).toHaveLength(0);
    expect(lines[0]).toContain("eagle@my.unt.edu");
    expect(lines[0]).toContain(URL_);
    expect(lines[0]).toContain("Email isn't set up here");
  });

  test("with a key, Resend gets the rendered email with a text alternative", async () => {
    const { sent, keys, createClient } = recorder();
    const mode = await deliverAuthEmail("password-reset", "eagle@my.unt.edu", URL_, {
      env: { NODE_ENV: "production", RESEND_API_KEY: "re_test", RESEND_FROM_EMAIL: "UNTangle <auth@untangle.example>" },
      createClient,
      log: () => {
        throw new Error("must not log a link when email is configured");
      },
      budget: memoryBudgetStore(),
    });
    expect(mode).toBe("resend");
    expect(keys).toEqual(["re_test"]);
    expect(sent[0]).toMatchObject({
      from: "UNTangle <auth@untangle.example>",
      to: ["eagle@my.unt.edu"],
      subject: "Reset your UNTangle password",
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
        budget: memoryBudgetStore(),
      }),
    ).rejects.toThrow("domain not verified");
  });

  test("production never falls back to the log, build phase included", () => {
    expect(() => emailDelivery({ NODE_ENV: "production" })).toThrow("RESEND_API_KEY");
    // The build-phase exemption is for the startup check only.
    expect(() => emailDelivery({ NODE_ENV: "production", NEXT_PHASE: "phase-production-build" })).toThrow("RESEND_API_KEY");
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

describe("the per-inbox send budget", () => {
  const deps = (budget = memoryBudgetStore(), now = () => 1_000_000) => {
    const lines: string[] = [];
    return { lines, deps: { env: { NODE_ENV: "development" }, createClient: recorder().createClient, log: (l: string) => lines.push(l), budget, now } };
  };

  test("12 parallel sends to one address deliver 3; the rest are refused", async () => {
    const { lines, deps: d } = deps();
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () => deliverAuthEmail("magic-link", "eagle@my.unt.edu", URL_, d)),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    const refused = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(refused).toHaveLength(9);
    for (const r of refused) expect(r.reason).toBeInstanceOf(EmailBudgetExceeded);
    expect(lines).toHaveLength(3);
  });

  test("case, spaces and +tags reach the same inbox, so they share one budget", async () => {
    const { lines, deps: d } = deps();
    for (const to of ["Eagle@My.UNT.edu", " eagle+1@my.unt.edu", "eagle+2@MY.unt.edu", "eagle@my.unt.edu"]) {
      await deliverAuthEmail("magic-link", to, URL_, d).catch(() => {});
    }
    expect(lines).toHaveLength(3);
    expect(budgetKey(" Eagle+x@My.UNT.edu ")).toBe("eagle@my.unt.edu");
  });

  test("another address has its own budget, and a new window refills it", async () => {
    let clock = 1_000_000;
    const { lines, deps: d } = deps(memoryBudgetStore(), () => clock);
    for (let i = 0; i < 4; i++) await deliverAuthEmail("magic-link", "a@my.unt.edu", URL_, d).catch(() => {});
    await deliverAuthEmail("magic-link", "b@my.unt.edu", URL_, d);
    expect(lines).toHaveLength(4);
    clock += 10 * 60 * 1000;
    await deliverAuthEmail("magic-link", "a@my.unt.edu", URL_, d);
    expect(lines).toHaveLength(5);
  });
});
