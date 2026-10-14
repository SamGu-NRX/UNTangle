import { describe, expect, test } from "bun:test";

import {
  GRADUATE,
  RETRIEVED_AT,
  UNDERGRADUATE,
  zoneFor,
  type CreditLoadZone,
  type SourcedThreshold,
} from "@/lib/policy/credit-load";

// Two families of guarantee: every threshold in the module stays tied to
// an official unt.edu source, and zoneFor's boundaries land exactly where
// those sources put them.

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

/**
 * Anything shaped like a threshold: a record with a numeric value. Caught
 * even when its source fields are missing or mistyped, so an added
 * `{ value: 24 }` fails here instead of slipping past the checks.
 */
const looksLikeThreshold = (x: unknown): x is Record<string, unknown> =>
  isRecord(x) && typeof x.value === "number";

function toSourced(x: Record<string, unknown>): SourcedThreshold | null {
  if (typeof x.value !== "number") return null;
  if (typeof x.sourceUrl !== "string") return null;
  if (typeof x.sourceQuote !== "string") return null;
  if (typeof x.retrievedAt !== "string") return null;
  const condition =
    typeof x.condition === "string" && x.condition.trim().length > 0
      ? x.condition
      : null;
  return {
    value: x.value,
    sourceUrl: x.sourceUrl,
    sourceQuote: x.sourceQuote,
    retrievedAt: x.retrievedAt,
    condition,
  };
}

/**
 * Walk the whole exported data structure and collect every threshold-
 * shaped object. Written as a generic deep walk, not a hardcoded list,
 * and keyed on the numeric value rather than the source fields, so a
 * future threshold added without a source is still caught here.
 */
// Fall and spring share one profile object, so dedupe by identity: the
// count reflects distinct sourced rules, not term aliases.
const seen = new Set<unknown>();

function collectThresholds(
  node: unknown,
  found: Record<string, unknown>[] = [],
): Record<string, unknown>[] {
  if (looksLikeThreshold(node)) {
    if (!seen.has(node)) {
      seen.add(node);
      found.push(node);
    }
    return found;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectThresholds(child, found);
    return found;
  }
  if (isRecord(node)) {
    for (const value of Object.values(node)) collectThresholds(value, found);
  }
  return found;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  return !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());
}

describe("sourced-value contract", () => {
  const undergrad = collectThresholds(UNDERGRADUATE);
  const grad = collectThresholds(GRADUATE);
  const all = [...undergrad, ...grad].map((t, i) => {
    const sourced = toSourced(t);
    if (!sourced) {
      throw new Error(
        `threshold at index ${i} (value ${t.value}) is missing its source fields (sourceUrl, sourceQuote, retrievedAt)`,
      );
    }
    return sourced;
  });

  test("walks every exported threshold, deduping the shared fall/spring profile", () => {
    // Fall and spring share one profile (4 distinct thresholds); summer has 3.
    expect(undergrad.length).toBe(7);
    expect(grad.length).toBe(2);
  });

  test("every threshold cites an official unt.edu page", () => {
    for (const t of all) {
      expect(
        t.sourceUrl.startsWith("https://catalog.unt.edu/") ||
          t.sourceUrl.startsWith("https://registrar.unt.edu/"),
      ).toBe(true);
    }
  });

  test("every threshold quotes a full sentence", () => {
    for (const t of all) {
      expect(t.sourceQuote.trim().length).toBeGreaterThan(0);
      expect(t.sourceQuote.split(/\s+/).length).toBeGreaterThan(3);
    }
  });

  test("every GPA-conditional maximum keeps its condition wording", () => {
    for (const term of ["fall", "spring", "summer"] as const) {
      const max = UNDERGRADUATE[term].standardMaximum;
      expect(max.condition).not.toBeNull();
      expect(max.condition).toContain("3.000");
    }
    const ceiling = UNDERGRADUATE.fall.conditionalCeiling;
    if (ceiling.kind !== "with-conditions") {
      throw new Error("Expected fall to have a with-conditions ceiling");
    }
    expect(ceiling.maximum.condition).toContain("3.000");
  });

  test("every threshold carries the shared retrieval date as a valid ISO date", () => {
    for (const t of all) {
      expect(isIsoDate(t.retrievedAt)).toBe(true);
      expect(t.retrievedAt).toBe(RETRIEVED_AT);
    }
  });

  test("summer models the missing conditional path explicitly, with a source", () => {
    const ceiling = UNDERGRADUATE.summer.conditionalCeiling;
    expect(ceiling.kind).toBe("none-in-catalog");
    if (ceiling.kind !== "none-in-catalog") {
      throw new Error("Expected summer to have no conditional path");
    }
    expect(ceiling.sourceUrl.startsWith("https://catalog.unt.edu/")).toBe(true);
    expect(ceiling.sourceQuote.trim().length).toBeGreaterThan(0);
    expect(isIsoDate(ceiling.retrievedAt)).toBe(true);
  });
});

describe("zoneFor, fall and spring", () => {
  test.each<[number, CreditLoadZone]>([
    [0, "part-time"],
    [11, "part-time"],
    [12, "full-time"],
    [15, "full-time"],
    [16, "heavy"],
    [19, "heavy"],
    [20, "gpa-conditions"],
    [21, "gpa-conditions"],
    [22, "exceeds-maximum"],
    [30, "exceeds-maximum"],
  ])("%i hours -> %s", (hours, zone) => {
    expect(zoneFor(hours, "fall")).toBe(zone);
    expect(zoneFor(hours, "spring")).toBe(zone);
  });
});

describe("zoneFor, summer", () => {
  test.each<[number, CreditLoadZone]>([
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
