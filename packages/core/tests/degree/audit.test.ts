import { describe, expect, test } from "bun:test";
import { auditProgram, type AuditCourse } from "../../src/degree/audit";
import type { ProgramData, RequirementNode } from "../../src/degree/types";

/**
 * Engine-level tests over a hand-written tree, kept free of captured data:
 * packages/ingest owns the parser and the catalog pages, and its suite covers
 * the audit against the real derived trees. These tests pin the pure rules.
 */

const citation = { page: "synthetic.html", url: "https://example.test/synthetic", anchor: null, heading: "Synthetic program" };

const program: ProgramData = {
  id: "synthetic",
  name: "Synthetic program",
  catalogId: "catoid-test",
  sourceUrl: "https://example.test/synthetic",
  coreSharedCourses: [],
  requirements: [
    {
      kind: "all",
      name: "Required courses",
      citation,
      items: ["CSCE 1030", "CSCE 1035", "CSCE 1110", "CSCE 1120", "CSCE 2110"].map((code) => ({ alternatives: [{ must: [code] }] })),
    },
    {
      kind: "policy",
      name: "Minimum grade of C (major courses)",
      citation,
      quote: "A grade of C or better is required in each major course.",
      policy: { type: "minGrade", grade: "C", scope: "all courses required in the major" },
    },
  ] satisfies RequirementNode[],
};

const course = (code: string, grade: string): AuditCourse => ({ code, grade, credits: 3, sourceKind: "unt", inProgress: false });

const majorPolicy = (result: ReturnType<typeof auditProgram>) =>
  result.policies.find((policy) => policy.name === "Minimum grade of C (major courses)")!;

describe("minGrade policy against a C floor", () => {
  test("C+ meets the floor: a plus-grade sits above its letter, so it is never named as failing", () => {
    const result = auditProgram(program, [course("CSCE 1030", "C+")]);
    // Only C+ is in scope and nothing falls below C, so the floor holds.
    expect(majorPolicy(result).status).toBe("satisfied");
    expect(majorPolicy(result).detail).not.toContain("CSCE 1030");
  });

  test("C meets the floor exactly", () => {
    const result = auditProgram(program, [course("CSCE 1030", "C"), course("CSCE 1035", "C"), course("CSCE 1110", "C"), course("CSCE 1120", "C"), course("CSCE 2110", "C")]);
    expect(majorPolicy(result).status).toBe("satisfied");
  });

  test("C- falls below the floor", () => {
    const result = auditProgram(program, [course("CSCE 1030", "C-")]);
    expect(majorPolicy(result).detail).toContain("CSCE 1030 (C-)");
  });

  test("D+ falls below the floor: a plus-grade on D does not lift it above C", () => {
    const result = auditProgram(program, [course("CSCE 1030", "D+")]);
    expect(majorPolicy(result).detail).toContain("CSCE 1030 (D+)");
  });

  test("D falls below the floor", () => {
    const result = auditProgram(program, [course("CSCE 1030", "D")]);
    expect(majorPolicy(result).detail).toContain("CSCE 1030 (D)");
  });

  test("the full boundary across one record: C+ and C pass, C- and D+ and D fail", () => {
    const result = auditProgram(program, [
      course("CSCE 1030", "C+"),
      course("CSCE 1035", "C"),
      course("CSCE 1110", "C-"),
      course("CSCE 1120", "D+"),
      course("CSCE 2110", "D"),
    ]);
    const detail = majorPolicy(result).detail;
    expect(majorPolicy(result).status).toBe("unsatisfied");
    expect(detail).toContain("Below C:");
    expect(detail).toContain("CSCE 1110 (C-)");
    expect(detail).toContain("CSCE 1120 (D+)");
    expect(detail).toContain("CSCE 2110 (D)");
    expect(detail).not.toContain("CSCE 1030 (C+)");
    expect(detail).not.toContain("CSCE 1035 (C)");
  });
});
