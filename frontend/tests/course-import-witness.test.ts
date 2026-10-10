import { describe, expect, test } from "bun:test";
import {
  beginReview,
  computeImportApply,
  unresolvedCodes,
  type ImportReviewState,
} from "@/lib/course-import-state";
import type { CourseStatus } from "@/lib/types";

/**
 * Milestone 1 witnesses — malformed text import + unknown-code boundary.
 *
 * The parser/catalog are the only authorities for course identity. These
 * pin the review-state contract the import UI must satisfy:
 *
 * 1. Malformed text import: a review that finds nothing must keep the
 *    user's pasted text on screen with an explicit error — not wipe it.
 * 2. Unknown codes render as unresolved entries, never fabricated into
 *    matched courses, and never silently dropped.
 * 3. Duplicate submissions are idempotent: the apply step diffs against the
 *    planner statuses it was given, so applying twice changes nothing the
 *    second time.
 */

const initialState: ImportReviewState = { text: null, result: null, error: null };

describe("malformed text import (witness)", () => {
  test("keeps the user's text after a review that finds nothing", () => {
    const malformed = "totally unstructured prose ### with no course codes";
    const state = beginReview(initialState, malformed);
    expect(state.text).toBe(malformed);
    expect(state.error).not.toBeNull();
    expect(state.result?.totalCodesFound).toBe(0);
  });

  test("reports zero fabricated matches for garbage input", () => {
    const state = beginReview(initialState, "no codes here");
    expect(state.result?.matched).toEqual([]);
    expect(state.result?.unknownCodes).toEqual([]);
  });

  test("parses real codes into matches while preserving the source text", () => {
    const state = beginReview(initialState, "CSCE 3444");
    expect(state.error).toBeNull();
    expect(state.text).toBe("CSCE 3444");
    expect(state.result?.matched.map((m) => m.course.code)).toContain("CSCE 3444");
  });
});

describe("unknown-code boundary (witness)", () => {
  test("renders unknown codes as unresolved entries, never as matched courses", () => {
    const state = beginReview(initialState, "CSCE 9999");
    const unresolved = unresolvedCodes(state.result);
    expect(unresolved).toContainEqual({ code: "CSCE 9999", status: "unresolved" });
    expect(state.result?.matched.every((m) => m.course.code !== "CSCE 9999")).toBe(true);
  });
});

describe("duplicate submission (witness)", () => {
  test("applying the same review twice produces no second diff", () => {
    const state = beginReview(initialState, "CSCE 3444");
    const currentStatuses: Record<string, CourseStatus> = {};
    const first = computeImportApply(state.result, currentStatuses);
    expect(first.length).toBe(1);
    expect(first[0]?.courseCode).toBe("CSCE 3444");

    const updated: Record<string, CourseStatus> = { "CSCE 3444": "completed" };
    const second = computeImportApply(state.result, updated);
    expect(second).toEqual([]);
  });
});
