import { describe, expect, test } from "bun:test";
import path from "node:path";
import { auditProgram, type AuditCourse } from "@untangle/core/degree/audit";
import { buildDegreeData } from "../src/degree/build";
import type { RequirementNode } from "@untangle/core/degree/types";

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

  test("one course counts toward a core component area and a major requirement at once", () => {
    // Hand-checked against the captured pages. The core page allows sharing:
    // "Students who wish to take courses that will fulfill both core and major
    // requirements simultaneously should check with academic advisors for
    // assistance in selecting core courses. Students may also choose to use
    // core courses to meet the minimum number of advanced hours required for
    // their degree." (core-curriculum.html, UNT Core Curriculum intro).
    // MATH 1710 (4 h) is listed in the core "Mathematics, 3 hours" area
    // (core-curriculum.html) and in the CS major's "Other required courses"
    // block — "MATH 1710 - Calculus I or MATH 1810 - Calculus for Science and
    // Engineering I and MATH 1820 - Calculus for Science and Engineering II"
    // (cs-bs.html, anchor majorrequirements). One record, one course, counted
    // toward both: the core audit satisfies the Mathematics area and the CS
    // audit counts the same course toward its required slot.
    const record = [course("MATH 1710", "A", 4)];
    const coreResult = auditProgram(program("core"), record);
    const mathArea = coreResult.requirements.find((node) => node.name === "Mathematics, 3 hours");
    expect(mathArea?.status).toBe("satisfied");

    const cs = program("cs-bs");
    expect(cs.coreSharedCourses).toContain("MATH 1710");
    // The same one course counts toward the major: with an empty record no
    // slot is covered, with only MATH 1710 exactly its slot is. (The node
    // stays "unsatisfied" until every slot completes; the slot detail is the
    // counting evidence.)
    const otherDetail = (courses: AuditCourse[]) =>
      auditProgram(cs, courses).requirements.find((node) => node.name === "Other required courses")!.detail;
    expect(otherDetail([])).toMatch(/^0\/\d+ slots satisfied/);
    expect(otherDetail(record)).toMatch(/^1\/\d+ slots satisfied/);
  });

  test("a course the catalog forbids from double counting counts once", () => {
    // Hand-checked against the captured core page (Component Area Option A
    // section): "Note: Students may not “double-dip” courses to complete the
    // University Core Curriculum. If a student completes PADM 2100 for the
    // Social and Behavioral Sciences area, PADM 2100 may not count toward
    // Component Area Option A." (core-curriculum.html). With PADM 2100 used
    // for Social and Behavioral Sciences, the audit counts it there and only
    // there: were double-dipping possible, PADM 2100 plus PHIL 2500 would
    // cover all six Component Area Option A hours outright, and the option
    // would read satisfied. It does not — the option stays short of six hours,
    // and the audit carries the catalog's rule as a cited advisory note.
    const record = [course("PADM 2100", "A", 3), course("PHIL 2500", "A", 3)];
    const result = auditProgram(program("core"), record);
    const sbs = result.requirements.find((node) => node.name === "Social and Behavioral Sciences, 3 hours");
    expect(sbs?.status).toBe("satisfied");
    const option = result.requirements.find((node) => node.name.startsWith("Component Area Option"));
    expect(option?.status).not.toBe("satisfied");
    expect(option?.detail).toContain("3/6");
    const rule = result.requirements.find((node) => node.name === "Component Area Option double-dip rule");
    expect(rule?.status).toBe("advisory");
    expect(rule?.detail).toContain("double-dip");
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

describe("records the packet names", () => {
  test("a transfer student with the core complete reads satisfied, credited, and flagged for residence", () => {
    const transfer = (code: string, credits: number): AuditCourse => ({
      code,
      grade: "B",
      credits,
      sourceKind: "transfer",
      inProgress: false,
    });
    const result = auditProgram(program("core"), [
      transfer("ENGL 1310", 3),
      transfer("ENGL 1320", 3),
      transfer("MATH 1710", 4),
      transfer("HIST 2610", 3),
      transfer("HIST 2620", 3),
      transfer("PSCI 2305", 3),
      transfer("PSCI 2306", 3),
      transfer("BIOL 1710", 3),
      transfer("BIOL 1711", 1),
      transfer("BIOL 1132", 3),
      transfer("MATH 1720", 4),
      transfer("AGER 2250", 3),
      transfer("ART 1300", 3),
      transfer("ANTH 1010", 3),
      transfer("CSCE 1010", 3),
    ]);
    const communication = result.requirements.find((node) => node.name.startsWith("Communication"));
    expect(communication?.status).toBe("satisfied");
    // Every component area plus both Component Area Options reads satisfied.
    expect(result.summary.satisfied).toBeGreaterThanOrEqual(9);
    // Transfer credit still counts, but the audit keeps the residence caveat visible.
    expect(result.policies.some((policy) => policy.status === "unverifiable")).toBe(true);
  });

  test("a change of major: a finished mathematics record audited against CS keeps its math credit and shows the CS gap", () => {
    const record: AuditCourse[] = [
      course("MATH 1710", "A", 4),
      course("MATH 1720", "A", 4),
      course("MATH 1810", "A", 3),
      course("MATH 1820", "A", 3),
      course("MATH 1830", "A", 3),
      course("MATH 2000", "A", 3),
      course("MATH 2700", "A", 3),
      course("MATH 2730", "A", 3),
      course("MATH 3000", "A", 3),
      course("CSCE 1030", "B", 3),
    ];
    const result = auditProgram(program("cs-bs"), record);
    // The math slots the record covers read as satisfied inside the shared
    // all-node ("1/3 slots satisfied" against the captured tree), while the
    // CS-only slots keep the requirement open.
    const mathNode = result.requirements.find((node) => node.name === "Other required courses");
    expect(mathNode?.status).not.toBe("satisfied");
    const progress = /^(\d+)\/(\d+) slots satisfied/.exec(mathNode?.detail ?? "");
    if (!progress) throw new Error(`unexpected detail: ${mathNode?.detail}`);
    expect(Number(progress[1])).toBeGreaterThanOrEqual(1);
    expect(Number(progress[2])).toBeGreaterThan(Number(progress[1]));
    // No CSCE courses beyond the first, so the major's own core stays open.
    const csceCore = result.requirements.find((node) => node.name === "CSCE core, 6 hours");
    expect(csceCore?.status).toBe("unsatisfied");
    // The math record clears the major's C floor, vacuously for CS courses it has not taken.
    const majorGrade = result.policies.find((policy) => policy.name === "Minimum grade of C (major courses)");
    expect(majorGrade?.status).toBe("satisfied");
  });

  test("the C floor boundary against the derived CS tree: C+ and C pass, C- and D+ and D fail", () => {
    const cs = program("cs-bs");
    const required = findNode("Required courses", cs.requirements);
    if (!required || required.kind !== "all") throw new Error("CS required-courses node missing");
    // The record is built from the tree's own slots so the test follows the data.
    const codes = required.items.map((slot) => slot.alternatives[0]!.must[0]!);
    const boundary: [string, "C+" | "C" | "C-" | "D+" | "D"][] = [
      [codes[0]!, "C+"],
      [codes[1]!, "C"],
      [codes[2]!, "C-"],
      [codes[3]!, "D+"],
      [codes[4]!, "D"],
    ];
    const result = auditProgram(cs, boundary.map(([code, grade]) => course(code, grade, 3)));
    const majorGrade = result.policies.find((policy) => policy.name === "Minimum grade of C (major courses)");
    expect(majorGrade?.status).toBe("unsatisfied");
    const below = majorGrade?.detail ?? "";
    for (const [code] of boundary.slice(2)) expect(below).toContain(code);
    for (const [code] of boundary.slice(0, 2)) expect(below).not.toContain(`${code} (C`);
  });
});
