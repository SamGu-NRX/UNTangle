import { describe, expect, test } from "bun:test";
import path from "node:path";
import { auditProgram, type AuditCourse } from "../src/degree/audit";
import { buildDegreeData } from "../src/degree/build";
import type { RequirementNode } from "../src/degree/types";

const dataDir = path.resolve(import.meta.dir, "../data/catalog/unt-2026-27");
const data = buildDegreeData(dataDir, "2026-10-15T00:00:00.000Z");
const program = (id: string) => {
  const found = data.programs.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`missing program ${id}`);
  return found;
};

/** Depth-first find, since interesting nodes often sit inside groups. */
const findNode = (name: string, nodes: RequirementNode[]): RequirementNode | null => {
  for (const node of nodes) {
    if (node.name === name) return node;
    if (node.kind === "group") {
      const nested = findNode(name, node.children);
      if (nested) return nested;
    }
    if (node.kind === "choice") {
      for (const branch of node.branches) {
        const nested = findNode(name, [branch.node]);
        if (nested) return nested;
      }
    }
  }
  return null;
};

const course = (code: string, grade: string | null = "A", credits: number | null = 3, extra: Partial<AuditCourse> = {}): AuditCourse => ({
  code,
  grade,
  credits,
  sourceKind: "unt",
  inProgress: false,
  ...extra,
});

describe("auditProgram on synthetic records", () => {
  test("an empty record leaves tracked nodes unsatisfied, not errored", () => {
    const result = auditProgram(program("cs-bs"), []);
    expect(result.summary.satisfied).toBe(0);
    expect(result.summary.unsatisfied).toBeGreaterThan(0);
    expect(result.summary.advisory).toBeGreaterThan(0);
  });

  test("in-progress courses mark a node in progress, not satisfied", () => {
    const math = program("math-bsmth");
    const coreName = "Mathematics core, 19 hours";
    const coreNode = findNode(coreName, math.requirements);
    if (!coreNode) throw new Error("math core node missing");
    const status = (courses: AuditCourse[]) => auditProgram({ ...math, requirements: [coreNode] }, courses).requirements[0]!.status;
    const done = ["MATH 1710", "MATH 1720", "MATH 1810", "MATH 1820", "MATH 1830", "MATH 2000", "MATH 2700", "MATH 2730", "MATH 3000"].map((code) => course(code, "A", 3));
    const started: AuditCourse[] = [{ code: "MATH 1710", grade: null, credits: 4, sourceKind: "current", inProgress: true }];
    expect(status(done)).toBe("satisfied");
    expect(status(started)).toBe("inProgress");
    expect(status([])).toBe("unsatisfied");
  });

  test("choose counts distinct courses, not one course twice", () => {
    const cs = program("cs-bs");
    const lab = cs.requirements.find((node) => node.name === "Laboratory science, 6-8 hours (choose 2)");
    if (lab?.kind !== "choose") throw new Error("lab science node missing");
    // Build the record from the node's own options so the test follows the data.
    const [first, second] = lab.options;
    const single = auditProgram(cs, [course(first.must[0]!)]);
    const pair = auditProgram(cs, [course(first.must[0]!), course(second!.must[0]!)]);
    const status = (result: ReturnType<typeof auditProgram>) => result.requirements.find((node) => node.name === lab.name)?.status;
    expect(status(single)).not.toBe("satisfied");
    expect(status(pair)).toBe("satisfied");
  });

  test("or-alternatives satisfy a slot through either option", () => {
    const cs = program("cs-bs");
    const track = auditProgram(cs, [course("MATH 1810"), course("MATH 1820")]);
    const other = track.requirements.find((node) => node.name === "Other required courses");
    expect(other).toBeDefined();
    expect(other!.status).not.toBe("satisfied");
    const canonical = auditProgram(cs, [course("MATH 1710"), course("MATH 1720")]);
    // Neither pair alone completes all of "Other required courses", but each
    // slot the pair covers must read as satisfied rather than unsatisfied.
    expect(canonical.requirements.find((node) => node.name === "Other required courses")!.detail).toMatch(/\d+\/\d+ slots satisfied/);
  });

  test("policy checks: total hours, advanced hours, and grade floors from the record", () => {
    const filler: AuditCourse[] = Array.from({ length: 36 }, (_, index) => course(`MATH 1${String(index).padStart(3, "0")}`, "A", 3));
    const advanced: AuditCourse[] = Array.from({ length: 14 }, (_, index) => course(`CSCE 4${String(index).padStart(3, "0")}`, "A", 3));
    const result = auditProgram(program("cs-bs"), [...filler, ...advanced]);
    const totalHours = result.policies.find((policy) => policy.name === "Total hours: 120");
    expect(totalHours?.status).toBe("satisfied");
    const advancedHours = result.policies.find((policy) => policy.name === "Advanced hours: 42");
    expect(advancedHours?.status).toBe("satisfied");

    const failingGrade = auditProgram(program("cs-bs"), [course("CSCE 1030", "D", 3)]);
    const majorGrade = failingGrade.policies.find((policy) => policy.name === "Minimum grade of C (major courses)");
    expect(majorGrade?.status).toBe("unsatisfied");
    expect(majorGrade?.detail).toContain("CSCE 1030");
  });

  test("checks that need data the record lacks come back unverifiable, never guessed", () => {
    const result = auditProgram(program("cs-bs"), [course("CSCE 1030", null, 3)]);
    const gpa = result.policies.find((policy) => policy.name === "Overall GPA");
    expect(gpa?.status).toBe("unverifiable");
    const residency = result.policies.find((policy) => policy.name === "Residency");
    expect(residency?.status).toBe("unverifiable");
  });

  test("core Component Area Option stays a choice between its two branches", () => {
    const core = program("core");
    const option = core.requirements.find((node) => node.kind === "choice" && node.name.startsWith("Component Area Option"));
    expect(option).toBeDefined();
    const satisfied = auditProgram(core, [course("MATH 1720", "B", 4), course("PHIL 2500", "B", 3)]);
    const coa = satisfied.requirements.find((node) => node.name.startsWith("Component Area Option"));
    expect(coa?.status).toBe("satisfied");
    expect(coa?.name).toContain("Option A");
  });

  test("the summary counts every outcome", () => {
    const result = auditProgram(program("core"), [course("ENGL 1310", "B"), course("MATH 1710", "B", 4), course("BIOL 1710", "B", 3), course("BIOL 1711", "B", 1)]);
    expect(result.summary.satisfied + result.summary.inProgress + result.summary.unsatisfied + result.summary.advisory).toBe(result.requirements.length);
  });
});
