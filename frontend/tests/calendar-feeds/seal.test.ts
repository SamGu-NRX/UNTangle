import { describe, expect, test } from "bun:test";
import {
  CALENDAR_FEED_KEY_ENV,
  feedKeyFromEnv,
  FeedSealError,
  GUEST_TOKEN_LIFETIME_MS,
  GUEST_TOKEN_MAX_AGE_MS,
  guestIdFrom,
  openFeedToken,
  openFeedUrl,
  sealFeedUrl,
  tokenKind,
} from "@/lib/calendar-feeds/seal";
import { SealedFeedUrlSchema } from "../../../packages/contracts/src/documents";

const KEY = Buffer.alloc(32, 7);
const OTHER_KEY = Buffer.alloc(32, 9);
const SECRET_URL = "https://calendar.google.com/calendar/ical/student%40unt.edu/private-9f2c7f6a1d84b0e3a51c02bb77d4e5f1/basic.ics";
const student = { kind: "user", id: "student-1" } as const;
const browser = { kind: "guest", id: "AAAAAAAAAAAAAAAAAAAAAA" } as const;
const otherBrowser = { kind: "guest", id: "BBBBBBBBBBBBBBBBBBBBBB" } as const;

const failure = (open: () => unknown) => {
  try {
    open();
  } catch (error) {
    return error instanceof FeedSealError ? error.kind : `not a seal error: ${String(error)}`;
  }
  return "opened";
};

describe("sealing a feed address", () => {
  test("opens for the owner it was sealed for, and the token carries nothing readable", () => {
    const token = sealFeedUrl(SECRET_URL, student, KEY);
    expect(openFeedUrl(token, student, KEY)).toBe(SECRET_URL);
    expect(token).not.toContain("google");
    expect(token).not.toContain("9f2c7f6a");
    expect(SealedFeedUrlSchema.safeParse(token).success).toBe(true);
  });

  test("the document schema refuses the address itself", () => {
    expect(SealedFeedUrlSchema.safeParse(SECRET_URL).success).toBe(false);
  });

  test("two seals of one address differ, so tokens can't be compared to find a shared calendar", () => {
    expect(sealFeedUrl(SECRET_URL, student, KEY)).not.toBe(sealFeedUrl(SECRET_URL, student, KEY));
  });

  test("another account, or a guest, can't open a student's token", () => {
    const token = sealFeedUrl(SECRET_URL, student, KEY);
    expect(failure(() => openFeedUrl(token, { kind: "user", id: "student-2" }, KEY))).toBe("unreadable");
    expect(failure(() => openFeedUrl(token, browser, KEY))).toBe("unreadable");
    expect(failure(() => openFeedUrl(sealFeedUrl(SECRET_URL, browser, KEY), student, KEY))).toBe("unreadable");
  });

  test("a guest's token opens only on the browser it was sealed to", () => {
    const token = sealFeedUrl(SECRET_URL, browser, KEY);
    expect(tokenKind(token)).toBe("guest");
    expect(openFeedUrl(token, browser, KEY)).toBe(SECRET_URL);
    expect(failure(() => openFeedUrl(token, otherBrowser, KEY))).toBe("unreadable");
  });

  test("the guest id comes only from a well-formed cookie", () => {
    expect(guestIdFrom(`a=1; untangle-calendar-guest=${browser.id}; b=2`)).toBe(browser.id);
    expect(guestIdFrom("untangle-calendar-guest=short")).toBeNull();
    expect(guestIdFrom(null)).toBeNull();
  });

  test("a changed token is refused", () => {
    const token = sealFeedUrl(SECRET_URL, student, KEY);
    const parts = token.split(".");
    const flipped = parts[3][0] === "A" ? `B${parts[3].slice(1)}` : `A${parts[3].slice(1)}`;
    expect(failure(() => openFeedUrl([...parts.slice(0, 3), flipped].join("."), student, KEY))).toBe("unreadable");
    expect(failure(() => openFeedUrl("cf1.only.three", student, KEY))).toBe("unreadable");
    expect(failure(() => openFeedUrl(SECRET_URL, student, KEY))).toBe("unreadable");
  });

  test("a token from a key the server no longer has says so", () => {
    const token = sealFeedUrl(SECRET_URL, student, OTHER_KEY);
    expect(failure(() => openFeedUrl(token, student, KEY))).toBe("other-key");
  });

  test("without a key nothing seals or opens", () => {
    expect(failure(() => sealFeedUrl(SECRET_URL, student, null))).toBe("not-configured");
    expect(failure(() => openFeedUrl("cf1.a.b.c", student, null))).toBe("not-configured");
  });
});

describe("how long a token opens", () => {
  const issued = Date.parse("2026-10-15T12:00:00Z");
  const day = 24 * 60 * 60 * 1000;

  test("a guest's token stops opening 30 days after it was sealed", () => {
    const token = sealFeedUrl(SECRET_URL, browser, KEY, issued);
    expect(openFeedUrl(token, browser, KEY, issued + 29 * day)).toBe(SECRET_URL);
    expect(failure(() => openFeedUrl(token, browser, KEY, issued + GUEST_TOKEN_MAX_AGE_MS + 1000))).toBe("expired");
  });

  test("resealing keeps the first issue time, so a line of guest tokens stops 90 days after it began", () => {
    let token = sealFeedUrl(SECRET_URL, browser, KEY, issued);
    // Refreshed every 20 days, as a guest using Week would.
    for (let at = issued + 20 * day; at < issued + GUEST_TOKEN_LIFETIME_MS; at += 20 * day) {
      const opened = openFeedToken(token, browser, KEY, at);
      expect(opened.firstIssued).toBe(issued);
      token = sealFeedUrl(opened.url, browser, KEY, at, opened.firstIssued);
    }
    expect(failure(() => openFeedUrl(token, browser, KEY, issued + GUEST_TOKEN_LIFETIME_MS + 1000))).toBe("expired");
  });

  test("an account's token keeps opening for its account", () => {
    const token = sealFeedUrl(SECRET_URL, student, KEY, issued);
    expect(openFeedUrl(token, student, KEY, issued + 400 * day)).toBe(SECRET_URL);
  });
});

describe("the key from the environment", () => {
  test("absent or blank reads as not configured", () => {
    expect(feedKeyFromEnv({})).toBeNull();
    expect(feedKeyFromEnv({ [CALENDAR_FEED_KEY_ENV]: "  " })).toBeNull();
  });

  test("32 bytes of base64 is the key", () => {
    expect(feedKeyFromEnv({ [CALENDAR_FEED_KEY_ENV]: KEY.toString("base64") })?.equals(KEY)).toBe(true);
  });

  test("a mistyped key fails loudly instead of sealing tokens nobody can open", () => {
    expect(() => feedKeyFromEnv({ [CALENDAR_FEED_KEY_ENV]: Buffer.alloc(16).toString("base64") })).toThrow("must decode to 32 bytes");
    expect(() => feedKeyFromEnv({ [CALENDAR_FEED_KEY_ENV]: "not base64!" })).toThrow("must be base64");
  });
});
