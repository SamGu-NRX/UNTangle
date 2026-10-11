import { describe, expect, test } from "bun:test";
import { ImportReadGuard } from "@/lib/course-import-state";
import { parseCourseImportText } from "@/lib/course-import";

/**
 * Import boundary behavior (milestone 3): stale async reads are discarded,
 * and the apply diff only ever touches catalog-matched codes.
 */

describe("import read guard (mid-request supersede)", () => {
  test("a fresh token is not stale", () => {
    const guard = new ImportReadGuard();
    const token = guard.begin();
    expect(guard.isStale(token)).toBe(false);
  });

  test("a token goes stale when a newer read begins", () => {
    const guard = new ImportReadGuard();
    const first = guard.begin();
    const second = guard.begin();
    expect(guard.isStale(first)).toBe(true);
    expect(guard.isStale(second)).toBe(false);
  });
});

describe("import boundary", () => {
  test("unknown codes never enter matched courses", () => {
    const result = parseCourseImportText("CSCE 9999 and CSCE 3444");
    expect(result.matched.map((m) => m.code)).toEqual(["CSCE 3444"]);
    expect(result.unknownCodes).toEqual(["CSCE 9999"]);
    expect(result.totalCodesFound).toBe(2);
  });

  test("duplicate codes are reported once", () => {
    const result = parseCourseImportText("CSCE 3444 CSCE3444");
    expect(result.matched.map((m) => m.code)).toEqual(["CSCE 3444"]);
    expect(result.duplicateCodes.length).toBe(1);
  });

  test("malformed digit groups do not match", () => {
    const result = parseCourseImportText("CSCE 344 CSCE 34 CSCE 34445 3444");
    expect(result.totalCodesFound).toBe(0);
    expect(result.matched).toEqual([]);
    expect(result.unknownCodes).toEqual([]);
  });
});
