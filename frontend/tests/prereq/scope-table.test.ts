import { expect, test } from "bun:test";
import { inferStatuses, parseUntPrerequisite, untAdapter } from "../../src/lib/prereq";
import type { CatalogCourse, CourseStatus, Prerequisite } from "../../src/lib/prereq";

const A = "MATH 1710";
const B = "MATH 1720";
const C = "MATH 1830";
const course = (courseId: string): Prerequisite => ({ kind: "course", courseId, source: courseId });
const grade = (courseId: string, minimum: string): Prerequisite => ({ kind: "minGrade", grade: minimum, requirement: course(courseId), source: courseId });
const either = (...children: Prerequisite[]): Prerequisite => ({ kind: "or", children, source: "independent alternative probe" });

// These target trees and expected outcomes are authored here, not obtained from the parser.
const probes = {
  A: course(A), A_C: grade(A, "C"), A_D: grade(A, "D"), A_B: grade(A, "B"),
  B: course(B), B_C: grade(B, "C"), B_B: grade(B, "B"), B_D: grade(B, "D"),
  C: course(C), C_C: grade(C, "C"),
  AB_C: either(grade(A, "C"), grade(B, "C")),
  BC_C: either(grade(B, "C"), grade(C, "C")),
  CSCE_1030_C: grade("CSCE 1030", "C"), CSCE_1040_C: grade("CSCE 1040", "C"),
};
const keys = ["A", "A_C", "A_D", "A_B", "B", "B_C", "B_B", "B_D", "C", "C_C", "AB_C", "BC_C", "CSCE_1030_C", "CSCE_1040_C"] as const;
type ScopeCase = {
  name: string;
  text: string;
  transcript: readonly (readonly [string, string])[];
  eligibility: CourseStatus;
  closure: Partial<Record<keyof typeof probes, CourseStatus>>;
};
const E = "eligible";
const L = "locked";
const U = "unknown";

const cases: readonly ScopeCase[] = [
  { name: "their equivalents covers an AND list", text: "MATH 1710 and MATH 1720 or their equivalents", transcript: [[B, "A"]], eligibility: U, closure: { A: L, A_C: L, B: L } },
  { name: "these equivalents covers an AND list", text: "MATH 1710 and MATH 1720 or these equivalents", transcript: [[A, "A"]], eligibility: U, closure: { A: L, B: L } },
  { name: "the equivalents covers an AND list", text: "MATH 1710 and MATH 1720 or the equivalents", transcript: [], eligibility: U, closure: { A: L, B: L } },
  { name: "named courses directly satisfy a plural escape", text: "MATH 1710 and MATH 1720 or their equivalents", transcript: [[A, "D"], [B, "D"]], eligibility: E, closure: { A: L, B: L } },
  { name: "singular equivalent stays with the last course", text: "MATH 1710 and MATH 1720 or equivalent", transcript: [[B, "A"]], eligibility: L, closure: { A: E, A_C: L, B: L } },
  { name: "its equivalent stays with the last course", text: "MATH 1710 and MATH 1720 or its equivalent", transcript: [[A, "A"]], eligibility: U, closure: { A: E, B: L } },
  { name: "parenthesized singular escape preserves the sibling", text: "MATH 1710 and (MATH 1720 or equivalent)", transcript: [[B, "A"]], eligibility: L, closure: { A: E, B: L } },
  { name: "plural escape protects a parenthesized list", text: "(MATH 1710 and MATH 1720) or their equivalents", transcript: [[B, "A"]], eligibility: U, closure: { A: L, B: L } },
  { name: "plural list after a semicolon keeps the earlier group", text: "MATH 1710; MATH 1720 and MATH 1830 or their equivalents", transcript: [[B, "A"], [C, "A"]], eligibility: L, closure: { A: E, A_C: L, B: L, C: L } },
  { name: "an earlier group cannot satisfy the plural list", text: "MATH 1710; MATH 1720 and MATH 1830 or their equivalents", transcript: [[A, "A"]], eligibility: U, closure: { A: E, B: L, C: L } },
  { name: "following semicolon sibling remains mandatory", text: "(MATH 1710 and MATH 1720 or their equivalents); MATH 1830", transcript: [[C, "A"]], eligibility: U, closure: { A: L, B: L, C: E, C_C: L } },
  { name: "nested plural escape preserves outer sibling", text: "MATH 1710 and (MATH 1720 and MATH 1830 or their equivalents)", transcript: [[A, "A"]], eligibility: U, closure: { A: E, B: L, C: L } },
  { name: "both applies to a mandatory pair", text: "MATH 1710 and MATH 1720, both with a grade of C or better", transcript: [[A, "C"], [B, "C"]], eligibility: E, closure: { A: E, A_C: E, B: E, B_C: E } },
  { name: "both grades both OR alternatives", text: "MATH 1710 or MATH 1720, both with a grade of C or better", transcript: [[A, "D"]], eligibility: L, closure: { A: L, A_C: L, B: L, B_C: L, AB_C: E } },
  { name: "either graded OR alternative can qualify", text: "MATH 1710 or MATH 1720, both with a grade of C or better", transcript: [[B, "C"]], eligibility: E, closure: { A: L, B: L, AB_C: E } },
  { name: "both does not invent C across the earlier semicolon", text: "MATH 1710 with a grade of D or better; MATH 1720 or MATH 1830, both with a grade of C or better", transcript: [[A, "D"], [B, "C"]], eligibility: E, closure: { A: E, A_D: E, A_C: L, B: L, B_C: L, C: L, BC_C: E } },
  { name: "both grades a mandatory final pair", text: "MATH 1710 with a grade of D or better; MATH 1720 and MATH 1830, both with a grade of C or better", transcript: [[A, "D"], [B, "C"], [C, "C"]], eligibility: E, closure: { A_D: E, A_C: L, B_C: E, C_C: E } },
  { name: "both inside parentheses stays inside", text: "MATH 1710 with a grade of D or better and (MATH 1720 or MATH 1830, both with a grade of C or better)", transcript: [[A, "D"], [C, "C"]], eligibility: E, closure: { A_D: E, A_C: L, B: L, C: L, BC_C: E } },
  { name: "both combines explicit grades using the stricter minimum", text: "MATH 1710 with a grade of D or better and MATH 1720 with a grade of B or better, both with a grade of C or better", transcript: [[A, "D"], [B, "B"]], eligibility: L, closure: { A_D: E, A_C: E, B_B: E, B_C: E } },
  { name: "both preserves a stricter explicit grade", text: "MATH 1710 with a grade of B or better and MATH 1720, both with a grade of C or better", transcript: [[A, "C"], [B, "C"]], eligibility: L, closure: { A_B: E, B_C: E } },
  { name: "both after a bare three-course chain is uncertain", text: "MATH 1710 and MATH 1720 and MATH 1830, both with a grade of C or better", transcript: [[A, "C"], [B, "C"], [C, "C"]], eligibility: U, closure: { A: L, A_C: L, B: L, B_C: L, C: L, C_C: L } },
  { name: "both after three singleton groups is uncertain", text: "MATH 1710; MATH 1720; MATH 1830, both with a grade of C or better", transcript: [[A, "C"], [B, "C"], [C, "C"]], eligibility: U, closure: { A: L, B: L, C: L } },
  { name: "each crosses semicolons", text: "MATH 1710; MATH 1720 and MATH 1830, each with a grade of C or better", transcript: [[A, "D"], [B, "C"], [C, "C"]], eligibility: L, closure: { A_C: E, B_C: E, C_C: E } },
  { name: "all crosses semicolons and retains an OR", text: "MATH 1710; MATH 1720 or MATH 1830, all with a grade of C or better", transcript: [[A, "D"], [B, "C"]], eligibility: L, closure: { A_C: E, B: L, C: L, BC_C: E } },
  { name: "each grades a whole AND list", text: "MATH 1710 and MATH 1720 and MATH 1830, each with a grade of C or better", transcript: [[A, "C"], [B, "C"], [C, "C"]], eligibility: E, closure: { A_C: E, B_C: E, C_C: E } },
  { name: "all grades a whole AND list", text: "MATH 1710 and MATH 1720 and MATH 1830, all with a grade of C or better", transcript: [[A, "C"], [B, "D"], [C, "C"]], eligibility: L, closure: { A_C: E, B_C: E, C_C: E } },
  { name: "plural scope across singleton groups is uncertain", text: "MATH 1710; MATH 1720 or their equivalents", transcript: [[A, "A"], [B, "A"]], eligibility: U, closure: { A: L, B: L } },
  { name: "nonterminal plural leaves the following course mandatory", text: "MATH 1710 and MATH 1720 or their equivalents, MATH 1830", transcript: [[C, "A"]], eligibility: U, closure: { A: L, B: L, C: E } },
  { name: "plural scope before and leaves the following course mandatory", text: "MATH 1710 and MATH 1720 or their equivalents and MATH 1830", transcript: [[A, "A"], [B, "A"], [C, "A"]], eligibility: E, closure: { A: L, B: L, C: E } },
  { name: "both outside a parenthesized pair stays with that pair", text: "MATH 1710 with a grade of D or better and (MATH 1720 or MATH 1830), both with a grade of C or better", transcript: [[A, "D"], [C, "C"]], eligibility: E, closure: { A_D: E, A_C: L, B: L, C: L, BC_C: E } },
  { name: "both across exactly two singleton groups strengthens a weaker minimum", text: "MATH 1710 with a grade of D or better; MATH 1720, both with a grade of C or better", transcript: [[A, "D"], [B, "C"]], eligibility: L, closure: { A_D: E, A_C: E, B_C: E } },
  { name: "all adds a minimum across an earlier explicit grade", text: "MATH 1710 with a grade of D or better; MATH 1720 all with a grade of C or better", transcript: [[A, "D"], [B, "C"]], eligibility: L, closure: { A_D: E, A_C: E, B_C: E } },
  { name: "parenthesized all stays in its group", text: "MATH 1710 with a grade of D or better; (MATH 1720 and MATH 1830 all with a grade of C or better)", transcript: [[A, "D"], [B, "C"], [C, "C"]], eligibility: E, closure: { A_D: E, A_C: L, B_C: E, C_C: E } },
  { name: "parenthesized each stays in its group", text: "MATH 1710 with a grade of D or better; (MATH 1720 or MATH 1830 each with a grade of C or better)", transcript: [[A, "D"], [B, "C"]], eligibility: E, closure: { A_D: E, A_C: L, B: L, C: L, BC_C: E } },
  { name: "plural equivalents retains grade requirements for direct evidence", text: "C or better in MATH 1710 and MATH 1720 or their equivalents", transcript: [[A, "C"], [B, "C"]], eligibility: E, closure: { A: L, A_C: L, B: L, B_C: L } },
  { name: "singular parentheses after a semicolon retains the earlier course", text: "MATH 1710; (MATH 1720 or equivalent)", transcript: [[B, "A"]], eligibility: L, closure: { A: E, B: L } },
  { name: "both does not rewrite an ungrouped mixed-operator prefix", text: "MATH 1710 or MATH 1720 and (CSCE 1030 and CSCE 1040), both with a grade of C or better", transcript: [[A, "D"]], eligibility: U, closure: { A: L, B: L, CSCE_1030_C: L, CSCE_1040_C: L } },
  { name: "an explicitly grouped OR prefix keeps the final pair mandatory", text: "(MATH 1710 or MATH 1720) and (CSCE 1030 and CSCE 1040), both with a grade of C or better", transcript: [[A, "D"], ["CSCE 1030", "C"], ["CSCE 1040", "C"]], eligibility: E, closure: { A: L, B: L, CSCE_1030_C: E, CSCE_1040_C: E } },
  { name: "parenthesized both strengthens D to C within its pair only", text: "MATH 1710; (MATH 1720 with a grade of D or better and MATH 1830), both with a grade of C or better", transcript: [[A, "D"], [B, "D"], [C, "C"]], eligibility: L, closure: { A: E, A_C: L, B: E, B_D: E, B_C: E, C_C: E } },
  { name: "parenthesized both accepts the stronger shared minimum", text: "MATH 1710; (MATH 1720 with a grade of D or better and MATH 1830), both with a grade of C or better", transcript: [[A, "D"], [B, "C"], [C, "C"]], eligibility: E, closure: { A: E, A_C: L, B_C: E, C_C: E } },
  { name: "parenthesized both retains a stricter explicit B minimum", text: "MATH 1710; (MATH 1720 with a grade of B or better and MATH 1830), both with a grade of C or better", transcript: [[A, "D"], [B, "C"], [C, "C"]], eligibility: L, closure: { A: E, A_C: L, B: E, B_B: E, B_C: E, C_C: E } },
  { name: "parenthesized both accepts the stricter explicit minimum", text: "MATH 1710; (MATH 1720 with a grade of B or better and MATH 1830), both with a grade of C or better", transcript: [[A, "D"], [B, "B"], [C, "C"]], eligibility: E, closure: { A: E, A_C: L, B_B: E, B_C: E, C_C: E } },
];

for (const fixture of cases) test("scope table: " + fixture.name, () => {
  const source: CatalogCourse = { id: "admitted", credits: 3, prerequisite: parseUntPrerequisite(fixture.text).expression };
  const transcript = fixture.transcript.map(([courseId, grade]) => ({ courseId, grade, credits: 3 }));
  const direct = inferStatuses([source], { transcript }, untAdapter).statuses.get(source.id)!;
  expect(direct.status).toBe(fixture.eligibility);
  if (fixture.eligibility === U) expect(JSON.stringify(direct.reason)).toContain("Check with advisor");
  const catalog = [source, ...keys.map(key => ({ id: key, credits: 3, prerequisite: probes[key] }))];
  const inferred = inferStatuses(catalog, { transcript: [{ courseId: source.id, grade: "A" }] }, untAdapter);
  for (const key of keys) {
    const expected = fixture.closure[key];
    if (expected !== undefined) expect(inferred.statuses.get(key)?.status).toBe(expected);
  }
  expect(source.prerequisite.source).toBe(fixture.text);
});

test("independent scope table includes every required pattern", () => {
  expect(cases.length).toBeGreaterThanOrEqual(20);
  for (const pattern of ["their equivalents", "these equivalents", "the equivalents", "or equivalent)", "both", "each", "all", ";", "with a grade of D", "("]) expect(cases.some(fixture => fixture.text.includes(pattern))).toBe(true);
  console.info("Independent scope table: " + cases.length + " hand-written cases.");
});
