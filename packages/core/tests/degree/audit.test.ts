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

const inProgressCourse = (code: string, credits = 3): AuditCourse => ({ code, grade: null, credits, sourceKind: "unt", inProgress: true });

const base = { id: "synthetic-scopes", name: "Synthetic scopes", catalogId: "catoid-test", sourceUrl: "https://example.test/synthetic", coreSharedCourses: [] };

const floorPolicy: RequirementNode = {
  kind: "policy",
  name: "Minimum grade of C (major courses)",
  citation,
  quote: "A grade of C or better is required in each major course.",
  policy: { type: "minGrade", grade: "C", scope: "all courses required in the major" },
};

const floorOf = (result: ReturnType<typeof auditProgram>) =>
  result.policies.find((policy) => policy.name === "Minimum grade of C (major courses)")!;

describe("review round six: typed scopes, planned progress, and no-guessing", () => {
  test("a completed lecture with an in-progress lab keeps the slot in progress", () => {
    const science: ProgramData = {
      ...base,
      requirements: [{
        kind: "all",
        name: "Science",
        citation,
        items: [{ alternatives: [{ must: ["CHEM 2370", "CHEM 2380"] }] }],
      }],
    };
    const result = auditProgram(science, [course("CHEM 2370", "A"), inProgressCourse("CHEM 2380")]);
    expect(result.requirements[0]!.status).toBe("inProgress");
  });

  test("an hours node met only by in-progress courses reads in progress with planned hours", () => {
    const electives: ProgramData = {
      ...base,
      requirements: [{
        kind: "hours",
        name: "Advanced electives",
        hours: 6,
        citation,
        options: [{ must: ["CSCE 4110"] }, { must: ["CSCE 4210"] }],
      }],
    };
    const result = auditProgram(electives, [inProgressCourse("CSCE 4110"), inProgressCourse("CSCE 4210")]);
    expect(result.requirements[0]!.status).toBe("inProgress");
    expect(result.requirements[0]!.detail).toContain("6 planned");
  });

  test("a choice whose best branch is advisory reads advisory, not unsatisfied", () => {
    const language: ProgramData = {
      ...base,
      requirements: [{
        kind: "choice",
        name: "Foreign language",
        citation,
        branches: [
          { name: "Proficiency", node: { kind: "note", name: "Proficiency", text: "Equivalent to 1020 proficiency is required.", citation } },
          { name: "Coursework", node: { kind: "choose", name: "Two courses", count: 2, citation, options: [{ must: ["FREN 1010"] }, { must: ["FREN 1020"] }] } },
        ],
      }],
    };
    const result = auditProgram(language, []);
    expect(result.requirements[0]!.status).toBe("advisory");
  });

  test("an in-scope course without a letter grade makes the floor unverifiable", () => {
    const result = auditProgram(program, [course("CSCE 1030", "CR")]);
    expect(floorOf(result).status).toBe("unverifiable");
  });

  test("a no-credit course makes the GPA unverifiable instead of assuming 3 credits", () => {
    const gpaProgram: ProgramData = {
      ...base,
      requirements: [
        { kind: "policy", name: "Overall GPA", citation, quote: "A minimum 2.0 overall GPA.", policy: { type: "gpa", minimum: 2, scope: "overall" } },
      ],
    };
    const result = auditProgram(gpaProgram, [{ ...course("CSCE 1030", "A"), credits: null }]);
    expect(result.policies[0]!.status).toBe("unverifiable");
  });

  test("completed courses matching an advisory pool count toward the major floor", () => {
    const pooled: ProgramData = {
      ...base,
      requirements: [
        { kind: "pool", name: "CSCE advanced electives, 6 hours", hours: 6, citation, match: { subjects: ["CSCE"], minLevel: 4000, maxLevel: null } },
        floorPolicy,
      ],
    };
    const result = auditProgram(pooled, [course("CSCE 4110", "D")]);
    expect(floorOf(result).status).toBe("unsatisfied");
    expect(floorOf(result).detail).toContain("CSCE 4110");
  });

  test("the floor names only the alternatives the audit used", () => {
    const depth: ProgramData = {
      ...base,
      requirements: [
        { kind: "choose", name: "Depth", count: 1, citation, options: [{ must: ["CSCE 4110"] }, { must: ["CSCE 4250"] }] },
        floorPolicy,
      ],
    };
    const result = auditProgram(depth, [course("CSCE 4110", "D"), course("CSCE 4250", "D")]);
    const floor = floorOf(result);
    expect(floor.status).toBe("unsatisfied");
    expect(floor.detail).toContain("CSCE 4110");
    expect(floor.detail).not.toContain("CSCE 4250");
  });

  test("policies nested in groups get outcomes, and an unresolvable scope is never guessed", () => {
    const grouped: ProgramData = {
      ...base,
      requirements: [{
        kind: "group",
        name: "Foundation course requirements",
        citation,
        children: [
          { kind: "policy", name: "Foundation grade rules", citation, quote: "C or better and 2.5 GPA in foundation courses.", policy: { type: "minGrade", grade: "C", scope: "foundation courses" } },
          { kind: "all", name: "Foundation courses", citation, items: [{ alternatives: [{ must: ["BIOL 1710"] }] }] },
        ],
      }],
    };
    const result = auditProgram(grouped, [course("BIOL 1710", "D")]);
    const rules = result.policies.find((policy) => policy.name === "Foundation grade rules");
    expect(rules).toBeDefined();
    expect(rules!.status).toBe("unverifiable");
  });
});
