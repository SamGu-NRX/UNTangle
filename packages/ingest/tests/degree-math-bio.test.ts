import { describe, expect, test } from "bun:test";
import path from "node:path";
import { auditProgram, type AuditCourse, type AuditResult, type NodeOutcome } from "@untangle/core/degree/audit";
import type { ProgramData } from "@untangle/core/degree/types";
import { buildDegreeData } from "../src/degree/build";

/**
 * Mathematics BSMTH and Biology BSBIO audited against hand-built transcripts:
 * one that meets every requirement the audit tracks, one that misses a named
 * requirement, and probes for the structure the pages print but the generic
 * reader would misread. Credit hours here are test inputs, not catalog facts.
 */

const dataDir = path.resolve(import.meta.dir, "../data/catalog/unt-2026-27");
const data = buildDegreeData(dataDir, "2026-10-15T00:00:00.000Z");
const COMPLETE = { gradeHistoryComplete: true };

const program = (id: string): ProgramData => data.programs.find((entry) => entry.id === id)!;
const done = (code: string, credits = 3): AuditCourse => ({ code, grade: "B", credits, sourceKind: "unt", inProgress: false, term: 1 });
/** Three-hour courses no requirement lists, adding hours and nothing else. */
const filler = (count: number, from: number): AuditCourse[] => Array.from({ length: count }, (_, index) => done(`ZZZ ${from + index}`));
const without = (record: AuditCourse[], code: string): AuditCourse[] => record.filter((course) => course.code !== code);

function requirement(result: AuditResult, prefix: string): NodeOutcome {
  const walk = (outcomes: NodeOutcome[]): NodeOutcome | null => {
    for (const outcome of outcomes) {
      if (outcome.name.startsWith(prefix)) return outcome;
      const nested = walk(outcome.children ?? []);
      if (nested) return nested;
    }
    return null;
  };
  const found = walk(result.requirements);
  if (!found) throw new Error(`no requirement starting ${prefix}`);
  return found;
}

/**
 * Every tracked node not satisfied. Notes and pools are advisory by design,
 * and a group holding one reads advisory with every tracked part satisfied.
 */
function unmetTracked(outcomes: NodeOutcome[], trail: string[] = []): string[] {
  return outcomes.flatMap((outcome) => {
    const here = [...trail, outcome.name];
    if (outcome.kind === "pool" || outcome.kind === "note") return outcome.status === "advisory" ? [] : [`${here.join(" > ")}: ${outcome.status}`];
    if (outcome.kind === "group") {
      const inside = unmetTracked(outcome.children ?? [], here);
      const expected = (outcome.children ?? []).some((child) => child.kind === "pool" || child.kind === "note") ? "advisory" : "satisfied";
      return outcome.status === expected ? inside : [`${here.join(" > ")}: ${outcome.status}`, ...inside];
    }
    return outcome.status === "satisfied" ? [] : [`${here.join(" > ")}: ${outcome.status} (${outcome.detail})`];
  });
}

const notSatisfiedPolicies = (result: AuditResult): string[] => result.policies.filter((outcome) => outcome.status !== "satisfied").map((outcome) => `${outcome.name}: ${outcome.status}`);

describe("Mathematics BSMTH", () => {
  const record = [
    // Mathematics core, 19 hours.
    done("MATH 1710", 4), done("MATH 1720"), done("MATH 2000"), done("MATH 2700"), done("MATH 2730"), done("MATH 3000"),
    // Analysis depth: MATH 3610 plus two; breadth: one Algebra, one Probability/statistics, one Geometry/topology course.
    done("MATH 3610"), done("MATH 3350"), done("MATH 3410"), done("MATH 3510"), done("STAT 3680"), done("MATH 4060"),
    // Two mathematics electives numbered 3350 or above.
    done("MATH 4200"), done("MATH 4430"),
    // Laboratory science Option 1: the biology sequence plus one physics lecture and laboratory.
    done("BIOL 1710"), done("BIOL 1720"), done("BIOL 1760", 2), done("PHYS 1710"), done("PHYS 1730", 1),
    // Foreign language Option 2 and computer programming.
    done("TECM 2700"), done("TECM 4180"), done("CSCE 1030"),
    ...filler(2, 3000), ...filler(18, 1000),
  ];

  test("a transcript that meets the program: every tracked requirement satisfied, only advisor items left", () => {
    const result = auditProgram(program("math-bsmth"), record, COMPLETE);
    expect(unmetTracked(result.requirements)).toEqual([]);
    expect(requirement(result, "Mathematics core, 19 hours").status).toBe("satisfied");
    expect(requirement(result, "Depth and breadth, 18 hours").name).toBe("Depth and breadth, 18 hours — Analysis");
    expect(requirement(result, "Depth and breadth, 18 hours").status).toBe("satisfied");
    expect(requirement(result, "Laboratory science").name).toBe("Laboratory science — Option 1, Biology emphasis");
    expect(requirement(result, "Laboratory science").status).toBe("satisfied");
    expect(requirement(result, "Foreign language").status).toBe("satisfied");
    expect(requirement(result, "Computer programming").status).toBe("satisfied");
    // The major group holds the elective pool and prose notes, so an advisor signs it off.
    expect(requirement(result, "Major requirements, 43 hours").status).toBe("advisory");
    expect(requirement(result, "Mathematics electives, 6 hours").remaining).toMatchObject({ kind: "advisor", candidates: ["MATH 4200", "MATH 4430"] });
    expect(notSatisfiedPolicies(result)).toEqual(["GPA 2.0 in major mathematics courses numbered 3350 or above: unverifiable", "Residency: unverifiable"]);
  });

  test("missing MATH 2730 leaves the Mathematics core unmet, and nothing else", () => {
    const result = auditProgram(program("math-bsmth"), without(record, "MATH 2730"), COMPLETE);
    expect(unmetTracked(result.requirements)).toEqual([
      "Major requirements, 43 hours: unsatisfied",
      "Major requirements, 43 hours > Mathematics core, 19 hours: unsatisfied (4/5 required courses or sequences complete)",
    ]);
    expect(requirement(result, "Mathematics core, 19 hours").remaining).toEqual({ kind: "courses", courses: ["MATH 2730"], oneOf: [] });
  });

  test("calculus: either footnote sequence replaces MATH 1710/1720, and a mix the footnote does not print does not", () => {
    const rest = ["MATH 2000", "MATH 2700", "MATH 2730", "MATH 3000"].map((code) => done(code));
    const core = (codes: string[]) => requirement(auditProgram(program("math-bsmth"), [...codes.map((code) => done(code)), ...rest], COMPLETE), "Mathematics core, 19 hours");
    expect(core(["MATH 1810", "MATH 1820", "MATH 1830"]).status).toBe("satisfied");
    expect(core(["MATH 1710", "MATH 1820", "MATH 1830"]).status).toBe("satisfied");
    const mixed = core(["MATH 1810", "MATH 1720"]);
    expect(mixed.status).toBe("unsatisfied");
    expect(mixed.remaining).toEqual({ kind: "courses", courses: [], oneOf: [[["MATH 1710"], ["MATH 1820", "MATH 1830"], ["MATH 1710", "MATH 1820", "MATH 1830"]]] });
  });

  test("a Probability/statistics depth needs MATH 3510 or MATH 3610 among the breadth courses", () => {
    const depth = [done("STAT 3680"), done("MATH 4610"), done("STAT 4650"), done("MATH 4060"), done("MATH 3400")];
    const withoutProof = requirement(auditProgram(program("math-bsmth"), [...depth, done("MATH 3410")], COMPLETE), "Depth and breadth, 18 hours");
    expect([withoutProof.name, withoutProof.status]).toEqual(["Depth and breadth, 18 hours — Probability/statistics", "unsatisfied"]);
    const withProof = requirement(auditProgram(program("math-bsmth"), [...depth, done("MATH 3610")], COMPLETE), "Depth and breadth, 18 hours");
    expect([withProof.name, withProof.status]).toEqual(["Depth and breadth, 18 hours — Probability/statistics", "satisfied"]);
  });

  test("laboratory science Option 3 takes one whole physics track, not a mix of the two", () => {
    const sequence = (codes: string[]) => requirement(auditProgram(program("math-bsmth"), codes.map((code) => done(code)), COMPLETE), "Calculus-based physics sequence").status;
    expect(sequence(["PHYS 1510", "PHYS 1530", "PHYS 2220", "PHYS 2240"])).toBe("unsatisfied");
    expect(sequence(["PHYS 1710", "PHYS 1730", "PHYS 2220", "PHYS 2240"])).toBe("satisfied");
  });
});

describe("Biology BSBIO", () => {
  const record = [
    // Foundation: biology, one 2000-level course, chemistry, math.
    done("BIOL 1710"), done("BIOL 1720"), done("BIOL 1760", 2), done("BIOL 2140"),
    done("CHEM 1410"), done("CHEM 1430", 1), done("CHEM 1420"), done("CHEM 1440", 1), done("CHEM 2370"), done("CHEM 3210", 1), done("MATH 1650", 5),
    // Biology requirements: a second 2000-level course, the advanced requirements, physiology with lab, 16+ elective hours.
    done("BIOL 2041"), done("BIOL 2042", 1),
    done("BIOL 3451"), done("BIOL 3452", 1), done("BIOL 3510"), done("BIOL 3520", 1),
    done("BIOL 4510", 1), done("BIOL 3800"),
    done("BIOL 4110"), done("BIOL 4201"), done("BIOL 4202", 1), done("BIOL 4260"), done("BIOL 4261", 1), done("BIOL 4300"), done("BIOL 4330"),
    // Other course requirements: calculus and algebra-based physics with labs.
    done("MATH 1710", 4), done("PHYS 1410"), done("PHYS 1430", 1), done("PHYS 1420"), done("PHYS 1440", 1),
    // Chemistry minor: CHEM 2380, CHEM 3220, and 4 advanced hours.
    done("CHEM 2380"), done("CHEM 3220", 1), done("BIOC 3621"), done("BIOC 3622", 1),
    done("ENGL 1310"), ...filler(1, 3000), ...filler(11, 1000),
  ];

  test("a transcript that meets the program: every tracked requirement satisfied, only advisor items left", () => {
    const result = auditProgram(program("biology-bsbio"), record, COMPLETE);
    expect(unmetTracked(result.requirements)).toEqual([]);
    expect(requirement(result, "Foundation course requirements").status).toBe("satisfied");
    expect(requirement(result, "Other course requirements").status).toBe("satisfied");
    expect(requirement(result, "Chemistry requirements").status).toBe("satisfied");
    // The two-lab-course rule for electives is an advisor's call, so the group reads advisory.
    expect(requirement(result, "Biology requirements").status).toBe("advisory");
    expect(requirement(result, "Advanced biology electives, 16 hours").status).toBe("satisfied");
    expect(requirement(result, "Physiology course with laboratory").detail).toBe("1/1 chosen (BIOL 4510, BIOL 3800)");
    expect(notSatisfiedPolicies(result)).toEqual([
      "Foundation courses: C or better and a 2.5 GPA: unverifiable",
      "Biology requirements: C or higher: unverifiable",
      "Chemistry minor: C or higher: unverifiable",
      "Department grade and attempt rules: unverifiable",
      "Residency: unverifiable",
    ]);
  });

  test("missing BIOL 3520 leaves the advanced biology requirements unmet, and nothing else", () => {
    const result = auditProgram(program("biology-bsbio"), without(record, "BIOL 3520"), COMPLETE);
    expect(unmetTracked(result.requirements)).toEqual([
      "Biology requirements: unsatisfied",
      "Biology requirements > Advanced biology requirements: unsatisfied (3/4 required courses or sequences complete)",
    ]);
    expect(requirement(result, "Advanced biology requirements").remaining).toEqual({ kind: "courses", courses: ["BIOL 3520"], oneOf: [] });
  });

  test("a laboratory alone is not a 2000-level biology course", () => {
    const statuses = (codes: string[]) => {
      const result = auditProgram(program("biology-bsbio"), codes.map((code) => done(code)), COMPLETE);
      return [requirement(result, "One 2000-level biology course").status, requirement(result, "Second 2000-level biology course").status];
    };
    expect(statuses(["BIOL 2042"])).toEqual(["unsatisfied", "unsatisfied"]);
    expect(statuses(["BIOL 2140", "BIOL 2041", "BIOL 2042"])).toEqual(["satisfied", "satisfied"]);
  });

  test("physiology needs a lecture with its laboratory: BIOL 4505 alone does not count", () => {
    const physiology = (codes: string[]) => requirement(auditProgram(program("biology-bsbio"), codes.map((code) => done(code)), COMPLETE), "Physiology course with laboratory").status;
    expect(physiology(["BIOL 4505"])).toBe("unsatisfied");
    expect(physiology(["BIOL 4510", "BIOL 4505"])).toBe("satisfied");
  });

  test("other course requirements keep each physics lecture with its own laboratory", () => {
    const other = (codes: string[]) => requirement(auditProgram(program("biology-bsbio"), codes.map((code) => done(code)), COMPLETE), "Other course requirements");
    expect(other(["MATH 1810", "PHYS 1410", "PHYS 1530", "PHYS 1520", "PHYS 1540"]).detail).toBe("2/3 required courses or sequences complete");
    expect(other(["MATH 1810", "PHYS 1510", "PHYS 1530", "PHYS 1420", "PHYS 1440"]).status).toBe("satisfied");
  });
});
