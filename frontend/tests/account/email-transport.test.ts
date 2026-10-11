import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Load the REAL transport module. A sibling suite in the full run registers a
// module mock for "@/lib/email" that would otherwise shadow it here; the
// versioned specifier resolves to a fresh, unmocked copy of the module.
const email = (await import("@/lib/email" + "?test-real")) as typeof import("@/lib/email");
const { outboxDirectory, readOutboxMessages, resolveEmailTransport } = email;

// The resend client is injected, so no test can reach the network and no
// module mocking is needed: the recorder only observes what would be sent.
function recorderClient() {
  const payloads: Array<Record<string, unknown>> = [];
  let nextError: { message: string } | null = null;
  return {
    payloads,
    factory: () => ({
      emails: {
        send: async (payload: Record<string, unknown>) => {
          payloads.push(payload);
          return { error: nextError };
        },
      },
    }),
    failNext: (message: string) => {
      nextError = { message };
    },
  };
}

const prevOutboxDir = process.env.UNT_OUTBOX_DIR;

async function withTempOutbox<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "unt-outbox-"));
  process.env.UNT_OUTBOX_DIR = dir;
  try {
    return await run(dir);
  } finally {
    if (prevOutboxDir === undefined) {
      delete process.env.UNT_OUTBOX_DIR;
    } else {
      process.env.UNT_OUTBOX_DIR = prevOutboxDir;
    }
  }
}

describe("email transport selection", () => {
  test("uses Resend in production when RESEND_API_KEY is configured", () => {
    const transport = resolveEmailTransport({ NODE_ENV: "production", RESEND_API_KEY: "re_test-key" });
    expect(transport.label).toBe("resend");
  });

  test("uses the local outbox in development when no key is configured", () => {
    const transport = resolveEmailTransport({ NODE_ENV: "development" });
    expect(transport.label).toBe("outbox");
  });

  test("keeps development on the local outbox even when a key is configured", async () => {
    await withTempOutbox(async (dir) => {
      const transport = resolveEmailTransport({ NODE_ENV: "development", RESEND_API_KEY: "re_test-key" });
      expect(transport.label).toBe("outbox");
      await transport.send("magic-link", "eval-1@my.unt.edu", "https://example.com/link");
      const messages = await readOutboxMessages(dir);
      expect(messages).toHaveLength(1);
      expect(messages[0].kind).toBe("magic-link");
    });
  });

  test("keeps the test environment on the local outbox even when a key is configured", () => {
    const transport = resolveEmailTransport({ NODE_ENV: "test", RESEND_API_KEY: "re_test-key" });
    expect(transport.label).toBe("outbox");
  });

  test("refuses to send in production without a key", () => {
    expect(() => resolveEmailTransport({ NODE_ENV: "production" })).toThrow(/RESEND_API_KEY/);
  });
});

describe("outbox transport", () => {
  test("writes a parseable message file that readOutboxMessages returns", async () => {
    await withTempOutbox(async (dir) => {
      const transport = resolveEmailTransport({ NODE_ENV: "development" });
      await transport.send("magic-link", "eval-1@my.unt.edu", "https://example.com/link");

      const messages = await readOutboxMessages(dir);
      expect(messages).toHaveLength(1);
      expect(messages[0].kind).toBe("magic-link");
      expect(messages[0].to).toBe("eval-1@my.unt.edu");
      expect(messages[0].url).toBe("https://example.com/link");
      expect(messages[0].createdAt).toBeTruthy();
      expect(outboxDirectory()).toBe(dir);
    });
  });

  test("returns an empty list when the outbox does not exist", async () => {
    const missing = path.join(tmpdir(), `unt-missing-${Date.now()}`);
    expect(await readOutboxMessages(missing)).toEqual([]);
  });
});

describe("resend transport", () => {
  test("sends the magic-link email with a branded subject and the url", async () => {
    const recorder = recorderClient();
    const transport = resolveEmailTransport({ NODE_ENV: "production", RESEND_API_KEY: "re_test-key" }, recorder.factory);
    await transport.send("magic-link", "eval-2@my.unt.edu", "https://example.com/magic");

    expect(recorder.payloads).toHaveLength(1);
    const payload = recorder.payloads[0];
    expect(payload.subject).toBe("Sign in to UNTangle");
    expect(payload.to).toBe("eval-2@my.unt.edu");
    expect(String(payload.html)).toContain("https://example.com/magic");
  });

  test("sends the password-reset email", async () => {
    const recorder = recorderClient();
    const transport = resolveEmailTransport({ NODE_ENV: "production", RESEND_API_KEY: "re_test-key" }, recorder.factory);
    await transport.send("password-reset", "eval-3@my.unt.edu", "https://example.com/reset");

    expect(recorder.payloads).toHaveLength(1);
    expect(recorder.payloads[0].subject).toBe("Reset your UNTangle password");
    expect(String(recorder.payloads[0].html)).toContain("https://example.com/reset");
  });

  test("surfaces provider errors instead of dropping the email", async () => {
    const recorder = recorderClient();
    recorder.failNext("provider down");
    const transport = resolveEmailTransport({ NODE_ENV: "production", RESEND_API_KEY: "re_test-key" }, recorder.factory);
    expect(
      transport.send("magic-link", "eval-4@my.unt.edu", "https://example.com/x"),
    ).rejects.toThrow(/provider down/);
  });
});
