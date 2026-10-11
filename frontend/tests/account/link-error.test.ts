import { describe, expect, test } from "bun:test";
import {
  LINK_EXPIRED_ERROR,
  LINK_INVALID_ERROR,
  LINK_UNKNOWN_ERROR,
  LINK_USED_ERROR,
  linkErrorMessage,
} from "@/lib/magic-link-flow";

// Codes verified against better-auth 1.5.5's magic-link plugin: the verify
// endpoint redirects to the error callback URL with ?error=<CODE>, where an
// expired link is EXPIRED_TOKEN and an already-used link is ATTEMPTS_EXCEEDED
// (the plugin's one-attempt limit).

describe("linkErrorMessage", () => {
  test("an expired link says it expired and how long links last", () => {
    expect(linkErrorMessage("EXPIRED_TOKEN")).toBe(LINK_EXPIRED_ERROR);
    expect(LINK_EXPIRED_ERROR).toContain("five minutes");
  });

  test("an already-used link says each link works once", () => {
    expect(linkErrorMessage("ATTEMPTS_EXCEEDED")).toBe(LINK_USED_ERROR);
  });

  test("an invalid token gets its own honest copy", () => {
    expect(linkErrorMessage("INVALID_TOKEN")).toBe(LINK_INVALID_ERROR);
  });

  test("unknown and missing codes fall back to generic copy", () => {
    expect(linkErrorMessage("failed_to_create_session")).toBe(LINK_UNKNOWN_ERROR);
    expect(linkErrorMessage(null)).toBe(LINK_UNKNOWN_ERROR);
    expect(linkErrorMessage("SOMETHING_NEW")).toBe(LINK_UNKNOWN_ERROR);
  });
});
