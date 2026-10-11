import { describe, expect, test } from "bun:test";
import {
  MAGIC_LINK_GENERIC_ERROR,
  MAGIC_LINK_RATE_LIMIT_ERROR,
  magicLinkFlowReducer,
  signInErrorMessage,
  type MagicLinkFlowState,
} from "@/lib/magic-link-flow";
import { isUntEmail, untEmailRequirementMessage } from "@/lib/unt-auth";

// Offline tests for the sign-in page's flow state machine. No DOM, no
// network: the component owns the fetch, the reducer owns every visible
// state, so the states are exercised directly here.

const initialState: MagicLinkFlowState = { phase: "form", errorMessage: null };

describe("signInErrorMessage", () => {
  test("gives rate-limited sends their own honest copy", () => {
    // The endpoint rate-limits to five requests per minute.
    expect(signInErrorMessage(429, null)).toBe(MAGIC_LINK_RATE_LIMIT_ERROR);
    expect(signInErrorMessage(429, { message: "Too many requests" })).toBe(
      MAGIC_LINK_RATE_LIMIT_ERROR,
    );
  });

  test("surfaces the endpoint's validation message when present", () => {
    expect(
      signInErrorMessage(400, {
        message: "Use a UNT email address ending in @unt.edu or @my.unt.edu.",
      }),
    ).toContain("@my.unt.edu");
  });

  test("falls back to generic copy for blank or missing messages", () => {
    for (const payload of [null, {}, { message: "   " }]) {
      expect(signInErrorMessage(500, payload)).toBe(MAGIC_LINK_GENERIC_ERROR);
      expect(signInErrorMessage(503, payload)).toBe(MAGIC_LINK_GENERIC_ERROR);
    }
  });
});

describe("magic-link flow states", () => {
  test("a validation failure keeps the form and shows the UNT requirement", () => {
    // The page validates the address before any request is made, mirroring
    // the server's sign-up gate with the same message.
    const email = "student@gmail.com";
    const state = isUntEmail(email)
      ? initialState
      : magicLinkFlowReducer(initialState, {
          type: "sendFailed",
          message: untEmailRequirementMessage(),
        });

    expect(state.phase).toBe("form");
    if (state.phase === "form") {
      expect(state.errorMessage).toBe(untEmailRequirementMessage());
      expect(state.errorMessage).toContain("@my.unt.edu");
    }
  });

  test("a successful send lands on check-your-inbox with the address", () => {
    const sending = magicLinkFlowReducer(initialState, {
      type: "sendStart",
      email: "eagle@unt.edu",
    });
    expect(sending.phase).toBe("sending");

    const done = magicLinkFlowReducer(sending, {
      type: "sendSucceeded",
      email: "eagle@unt.edu",
    });
    expect(done.phase).toBe("checkInbox");
    if (done.phase === "checkInbox") {
      expect(done.sentTo).toBe("eagle@unt.edu");
    }
  });

  test("a resend keeps the check-your-inbox panel on screen while sending", () => {
    const inbox = magicLinkFlowReducer(initialState, {
      type: "sendStart",
      email: "eagle@unt.edu",
    });
    const done = magicLinkFlowReducer(inbox, {
      type: "sendSucceeded",
      email: "eagle@unt.edu",
    });
    const resending = magicLinkFlowReducer(done, {
      type: "sendStart",
      email: "eagle@unt.edu",
    });

    expect(resending.phase).toBe("sending");
    if (resending.phase === "sending") {
      expect(resending.from).toBe("checkInbox");
      expect(resending.sentTo).toBe("eagle@unt.edu");
    }
  });

  test("a failed send returns to the form with the fallback message", () => {
    const sending = magicLinkFlowReducer(initialState, {
      type: "sendStart",
      email: "eagle@unt.edu",
    });
    const failed = magicLinkFlowReducer(sending, { type: "sendFailed", message: null });

    expect(failed.phase).toBe("form");
    if (failed.phase === "form") {
      expect(failed.errorMessage).toBe(MAGIC_LINK_GENERIC_ERROR);
    }
  });

  test("restart clears any error and returns to a clean form", () => {
    const failed = magicLinkFlowReducer(initialState, {
      type: "sendFailed",
      message: "boom",
    });
    const restarted = magicLinkFlowReducer(failed, { type: "restart" });

    expect(restarted.phase).toBe("form");
    if (restarted.phase === "form") {
      expect(restarted.errorMessage).toBeNull();
    }
  });
});
