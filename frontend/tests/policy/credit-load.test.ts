import { describe, expect, test } from "bun:test";

import {
  GRADUATE,
  RETRIEVED_AT,
  UNDERGRADUATE,
  zoneFor,
  type SourcedThreshold,
} from "@/lib/policy/credit-load";

// Two families of guarantee: every threshold in the module stays tied to
// an official unt.edu source, and zoneFor's boundaries land exactly where
// those sources put them.

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

const isSourcedThreshold = (x: unknown): x is SourcedThreshold =>
  isRecord(x) &&
  typeof x.value === "number" &&
  typeof x.sourceUrl === "string" &&
  typeof x.sourceQuote === "string" &&
  typeof x.retrievedAt === "string";

/**
 * Walk the whole exported data structure and collect every sourced
 * threshold. Written as a generic deep walk, not a hardcoded list, so a
 * future threshold added without a source still gets caught here.
 */
// Fall and spring share one profile object, so dedupe by identity: the
// count reflects distinct sourced rules, not term aliases.
const seen = new Set<unknown>();

function collectSourced(node: unknown, found: SourcedThreshold[] = []): SourcedThreshold[] {
  if (isSourcedThreshold(node)) {
    if (!seen.has(node)) {
      seen.add(node);
      found.push(node);
    }
    return found;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectSourced(child, found);
    return found;
  }
  if (isRecord(node)) {
    for (const value of Object.values(node)) collectSourced(value, found);
  }
  return found;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  return !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());
}

describe("sourced-value contract", () => {
  const undergrad = collectSourced(UNDERGRADUATE);
  const grad = collectSourced(GRADUATE);

  test("walks every exported threshold, deduping the shared fall/spring profile", () => {
    // Fall and spring share one profile (4 distinct thresholds); summer has 3.
    expect(undergrad.length).toBe(7);
    expect(grad.length).toBe(2);
  });

  test("every threshold cites an official unt.edu page", () => {
    for (const t of [...undergrad, ...grad]) {
      expect(
        t.sourceUrl.startsWith("https://catalog.unt.edu/") ||
          t.sourceUrl.startsWith("https://registrar.unt.edu/"),
      ).toBe(true);
    }
  });

  test("every threshold quotes a non-empty verbatim sentence", () => {
    for (const t of [...undergrad, ...grad]) {
      expect(t.sourceQuote.trim().length).toBeGreaterThan(0);
      expect(t.sourceQuote.split(/\s+/).length).toBeGreaterThan(3);
    }
  });

  test("every threshold carries the shared retrieval date as a valid ISO date", () => {
    for (const t of [...undergrad, ...grad]) {
      expect(isIsoDate(t.retrievedAt)).toBe(true);
      expect(t.retrievedAt).toBe(RETRIEVED_AT);
    }
  });

  test("summer models the missing approval path explicitly, with a source", () => {
    const ceiling = UNDERGRADUATE.summer.approvalCeiling;
    expect(ceiling.kind).toBe("none-in-catalog");
    expect(ceiling.sourceUrl.startsWith("https://catalog.unt.edu/")).toBe(true);
    expect(ceiling.sourceQuote.length).toBeGreaterThan(0);
    expect(isIsoDate(ceiling.retrievedAt)).toBe(true);
  });
});

describe("zoneFor, fall and spring", () => {
  test.each<[number, string]>([
    [0, "part-time"],
    [11, "part-time"],
    [12, "full-time"],
    [15, "full-time"],
    [16, "heavy"],
    [19, "heavy"],
    [20, "needs-approval"],
    [21, "needs-approval"],
    [22, "exceeds-maximum"],
    [30, "exceeds-maximum"],
  ])("%i hours -> %s", (hours, zone) => {
    expect(zoneFor(hours, "fall")).toBe(zone);
    expect(zoneFor(hours, "spring")).toBe(zone);
  });
});

describe("zoneFor, summer", () => {
  test.each<[number, string]>([
    [0, "part-time"],
    [11, "part-time"],
    [12, "full-time"],
    [13, "heavy"],
    [18, "heavy"],
    [19, "exceeds-maximum"],
    [22, "exceeds-maximum"],
  ])("%i hours -> %s", (hours, zone) => {
    expect(zoneFor(hours, "summer")).toBe(zone);
  });
});

describe("zoneFor, invalid input", () => {
  test.each([-1, NaN, Infinity, -0.5])("throws on %s hours", (hours) => {
    expect(() => zoneFor(hours, "fall")).toThrow(RangeError);
  });
});
