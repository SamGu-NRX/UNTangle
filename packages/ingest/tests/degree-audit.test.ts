import { describe, expect, test } from "bun:test";
import { cpSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { auditProgram, type AuditCourse } from "@untangle/core/degree/audit";
import { buildDegreeData } from "../src/degree/build";
import type { ProgramData, RequirementNode } from "@untangle/core/degree/types";

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

  test("Option A accepts another core area's course when that area did not use it", () => {
    // The allowance printed inside the Option A list: "Or any course included
    // in the other core areas listed above". ANTH 1010 satisfies Social and
    // Behavioral Sciences, which frees PADM 2100 — an SBS course reachable in
    // the A list only through the derived expansion — to fill Option A beside
    // PHIL 2500: three hours plus three hours makes the option satisfied.
    // Were PADM 2100 not an option at all, the walk would stop at 3/6.
    const record = [course("ANTH 1010"), course("PADM 2100"), course("PHIL 2500")];
    const result = auditProgram(program("core"), record);
    const sbs = result.requirements.find((node) => node.name === "Social and Behavioral Sciences, 3 hours");
    expect(sbs?.status).toBe("satisfied");
    expect(sbs?.detail).toContain("3/3");
    const option = result.requirements.find((node) => node.name.startsWith("Component Area Option"));
    expect(option?.status).toBe("satisfied");
    expect(option?.detail).toContain("2 courses, 6/6 hours");
    expect(option?.name).toContain("Option A");
  });

  test("oneCourseOneArea is what makes the audit count a course once", () => {
    // The same tree and record with and without the flag: without it every
    // node reads the full record, so MATH 1720 fills Mathematics and keeps
    // counting toward the option (major-style sharing). With it Mathematics
    // claims the course first and the option falls short at 3/6.
    const citation = { page: "core.html", url: "https://catalog.example/core.html", anchor: "x", heading: "h" };
    const requirements: RequirementNode[] = [
      { kind: "hours", name: "Mathematics, 3 hours", hours: 3, options: [{ must: ["MATH 1720"] }], citation },
      { kind: "hours", name: "Component Area Option A", hours: 6, options: [{ must: ["MATH 1720"] }, { must: ["PHIL 2500"] }], citation },
    ];
    const base = {
      id: "synthetic",
      name: "Synthetic",
      catalogId: "2026-2027",
      sourceUrl: "https://catalog.example/core.html",
      coreSharedCourses: [] as string[],
    } satisfies Omit<ProgramData, "requirements">;
    const record = [course("MATH 1720", "B", 4), course("PHIL 2500", "B", 3)];

    const shared = auditProgram({ ...base, requirements: structuredClone(requirements) } satisfies ProgramData, record);
    const sharedOption = shared.requirements.find((node) => node.name === "Component Area Option A");
    expect(sharedOption?.status).toBe("satisfied");
    expect(sharedOption?.detail).toContain("7/6");

    const allocated = auditProgram({ ...base, oneCourseOneArea: true, requirements: structuredClone(requirements) } satisfies ProgramData, record);
    const math = allocated.requirements.find((node) => node.name === "Mathematics, 3 hours");
    expect(math?.status).toBe("satisfied");
    const allocatedOption = allocated.requirements.find((node) => node.name === "Component Area Option A");
    expect(allocatedOption?.status).toBe("inProgress");
    expect(allocatedOption?.detail).toContain("1 course, 3/6 hours");
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

describe("typed grade scopes from the catalog wording", () => {
  test("the mathematics GPA floor reads only 3350+ mathematics courses", () => {
    const result = auditProgram(program("math-bsmth"), [
      course("MATH 1710", "F", 4),
      course("MATH 1720", "D-", 4),
      course("MATH 3350", "A", 3),
    ]);
    const gpaPolicy = result.policies.find((policy) => policy.name === "GPA 2.0 (mathematics courses 3350+ in the major)");
    expect(gpaPolicy?.status).toBe("satisfied");
    expect(gpaPolicy?.detail).toContain("4.00");
  });

  test("the Communication core grade floor sees only the core Communication area", () => {
    const result = auditProgram(program("math-bsmth"), [course("MATH 1710", "F", 4)]);
    const communication = result.policies.find((policy) => policy.name === "Communication core grade");
    // Zero courses in scope reads "nothing to check": an out-of-scope F must
    // neither fail the floor nor count as clearing it.
    expect(communication?.status).toBe("unverifiable");
    expect(communication?.detail ?? "").not.toContain("MATH 1710");
  });

  test("nested biology foundation policies resolve their subtree as the scope", () => {
    const foundation = findNode("Biology foundation courses", program("biology-bsbio").requirements);
    if (!foundation || foundation.kind !== "all") throw new Error("biology foundation node missing");
    const firstCourse = foundation.items[0]!.alternatives[0]!.must[0]!;
    const result = auditProgram(program("biology-bsbio"), [course(firstCourse, "D", 4)]);
    const rules = result.policies.find((policy) => policy.name === "Foundation grade rules");
    expect(rules?.status).toBe("unsatisfied");
    expect(rules?.detail).toContain(firstCourse);
    const foundationGpa = result.policies.find((policy) => policy.name === "Foundation GPA 2.5");
    expect(foundationGpa?.status).toBe("unsatisfied");
  });

  test("policies deduplicate across the program and university scans", () => {
    const names = (nodes: RequirementNode[]): string[] =>
      nodes.flatMap((node) =>
        node.kind === "policy" ? [node.name]
        : node.kind === "group" ? names(node.children)
        : node.kind === "choice" ? node.branches.flatMap((branch) => names([branch.node]))
        : [],
      );
    const totalHours = names(program("cs-bs").requirements).filter((name) => name === "Total hours: 120");
    expect(totalHours.length).toBe(1);
    const communication = names(program("core").requirements).filter((name) => name === "Communication core grade");
    expect(communication.length).toBe(1);
  });

  test("a catalog page that no longer matches its manifest hash stops the build", () => {
    const staging = path.join(os.tmpdir(), `untangle-manifest-check-${Date.now()}`);
    cpSync(dataDir, staging, { recursive: true });
    try {
      writeFileSync(path.join(staging, "cs-bs.html"), "<html>tampered</html>\n");
      expect(() => buildDegreeData(staging, "2026-10-15T00:00:00.000Z")).toThrow(/manifest hash/);
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  });

  test("an in-progress record can already reach Component Area Option A's hours", () => {
    const result = auditProgram(program("core"), [
      course("ANTH 1010", "A", 3),
      course("PADM 2100", null, 3, { inProgress: true }),
      course("PHIL 2500", null, 3, { inProgress: true }),
    ]);
    const option = result.requirements.find((node) => node.name.startsWith("Component Area Option"));
    expect(option?.status).toBe("inProgress");
    expect(option?.detail).toContain("6 planned");
  });
});

test("the generated core-total policy is scoped to the core's own courses", () => {
  const core = program("core");
  const totalHours = findNode("Core total: 42 hours", core.requirements);
  expect(totalHours).toBeDefined();
  if (totalHours?.kind !== "policy" || totalHours.policy.type !== "totalHours") throw new Error("unexpected node shape");
  const scope = totalHours.policy.courseScope;
  expect(scope?.kind).toBe("codes");
  if (scope?.kind !== "codes") throw new Error("missing codes scope");
  expect(scope.codes).toContain("PHIL 2500");
  // Major-only courses stay out of the core's hour total.
  expect(scope.codes).not.toContain("CSCE 2110");
  expect(scope.codes).not.toContain("CSCE 1030");
  // The majors' degree totals still count the whole record.
  const cs = program("cs-bs");
  const degreeTotal = findNode("Total hours: 120", cs.requirements);
  expect(degreeTotal).toBeDefined();
  if (degreeTotal?.kind !== "policy" || degreeTotal.policy.type !== "totalHours") throw new Error("unexpected node shape");
  expect(degreeTotal.policy.courseScope).toBeUndefined();
});

