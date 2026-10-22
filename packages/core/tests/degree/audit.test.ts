import { describe, expect, test } from "bun:test";
import { auditProgram, type AuditCourse, type AuditResult, type NodeOutcome } from "../../src/degree/audit";
import type { CourseScope, CourseSlot, PolicyNode, ProgramData, RequirementNode } from "../../src/degree/types";

/**
 * Engine rules over hand-written trees, kept free of captured data:
 * packages/ingest owns the parser and the catalog pages, and its suite audits
 * the real derived trees. Each test here pins one rule with one answer.
 */

const citation = { page: "synthetic.html", url: "https://example.test/synthetic", anchor: null, heading: "Synthetic program" };
const COMPLETE = { gradeHistoryComplete: true };

function program(requirements: RequirementNode[], courseSharing: ProgramData["courseSharing"] = "forbidden"): ProgramData {
  return { id: "synthetic", name: "Synthetic program", catalogId: "unt-test", sourceUrl: citation.url, coreSharedCourses: [], requirements, courseSharing };
}

/** A finished UNT attempt; options override any field. */
function done(code: string, grade = "A", extra: Partial<AuditCourse> = {}): AuditCourse {
  return { code, grade, credits: 3, sourceKind: "unt", inProgress: false, term: 1, ...extra };
}

/** An in-progress attempt, as the importer saves a current-term row. */
function current(code: string, extra: Partial<AuditCourse> = {}): AuditCourse {
  return { code, grade: null, credits: 3, sourceKind: "current", inProgress: true, term: 9, ...extra };
}

const singles = (...codes: string[]): CourseSlot[] => codes.map((code) => ({ alternatives: [{ must: [code] }] }));
const all = (name: string, ...codes: string[]): RequirementNode => ({ kind: "all", name, citation, items: singles(...codes) });
const hours = (name: string, total: number, ...codes: string[]): RequirementNode => ({ kind: "hours", name, citation, hours: total, options: codes.map((code) => ({ must: [code] })) });
const choose = (name: string, count: number, items: CourseSlot[]): RequirementNode => ({ kind: "choose", name, citation, count, items });
const pool = (name: string): RequirementNode => ({ kind: "pool", name, citation, hours: 6, match: { subjects: ["CSCE"], minLevel: 4000, maxLevel: null } });
const policy = (name: string, value: PolicyNode["policy"]): PolicyNode => ({ kind: "policy", name, citation, quote: name, policy: value });
const floor = (courseScope: CourseScope = { kind: "applied" }) => policy("C floor", { type: "minGrade", grade: "C", scope: "major", courseScope });
const gpa = (courseScope: CourseScope = { kind: "overall" }) => policy("GPA", { type: "gpa", minimum: 2, scope: "overall", courseScope });

const node = (result: AuditResult, name: string): NodeOutcome => {
  const found = result.requirements.find((outcome) => outcome.name.startsWith(name));
  if (!found) throw new Error(`no outcome named ${name}: ${result.requirements.map((outcome) => outcome.name).join(", ")}`);
  return found;
};
const policyOutcome = (result: AuditResult, name: string) => result.policies.find((outcome) => outcome.name === name)!;

describe("in progress means met once in-progress courses earn credit, for every node kind", () => {
  const tree = program([all("Required", "CSCE 1030", "CSCE 1040"), hours("Core", 6, "CSCE 3530", "CSCE 4115", "CSCE 4430"), choose("Lab", 2, singles("PHYS 1710", "PHYS 2220", "GEOL 1610"))]);

  test("a slot node with the rest in progress is in progress", () => {
    expect(node(auditProgram(tree, [done("CSCE 1030"), current("CSCE 1040")], COMPLETE), "Required").status).toBe("inProgress");
  });

  test("a slot node with one slot missing is unsatisfied even while another is in progress", () => {
    expect(node(auditProgram(tree, [current("CSCE 1040")], COMPLETE), "Required").status).toBe("unsatisfied");
  });

  test("an hours node half done with nothing enrolled is unsatisfied, not in progress", () => {
    const outcome = node(auditProgram(tree, [done("CSCE 3530")], COMPLETE), "Core");
    expect(outcome.status).toBe("unsatisfied");
    expect(outcome.detail).toContain("3/6 hours");
  });

  test("an hours node whose in-progress course reaches the hours is in progress", () => {
    expect(node(auditProgram(tree, [done("CSCE 3530"), current("CSCE 4115")], COMPLETE), "Core").status).toBe("inProgress");
  });

  test("an hours node whose in-progress course still falls short is unsatisfied", () => {
    expect(node(auditProgram(tree, [current("CSCE 4115")], COMPLETE), "Core").status).toBe("unsatisfied");
  });

  test("a choose node reaching its count only with in-progress courses is in progress, and short of it unsatisfied", () => {
    expect(node(auditProgram(tree, [done("PHYS 1710"), current("PHYS 2220")], COMPLETE), "Lab").status).toBe("inProgress");
    expect(node(auditProgram(tree, [current("PHYS 2220")], COMPLETE), "Lab").status).toBe("unsatisfied");
  });
});

describe("a group's status accounts for parts the audit cannot check", () => {
  const tree = program([{ kind: "group", name: "Major", citation, children: [all("Required", "CSCE 1030"), pool("Advanced electives"), floor()] }]);

  test("met tracked parts beside an unchecked pool leave the group to an advisor, never satisfied", () => {
    const outcome = node(auditProgram(tree, [done("CSCE 1030")], COMPLETE), "Major");
    expect(outcome.status).toBe("advisory");
    expect(outcome.detail).toContain("needs advisor review: Advanced electives");
    expect(outcome.children?.map((child) => [child.name, child.status])).toEqual([["Required", "satisfied"], ["Advanced electives", "advisory"]]);
  });

  test("an unmet tracked part makes the group unsatisfied whatever the pool says", () => {
    expect(node(auditProgram(tree, [], COMPLETE), "Major").status).toBe("unsatisfied");
  });

  test("a nested policy is reported with the policies, not as a part the group lacks", () => {
    const result = auditProgram(program([{ kind: "group", name: "Area", citation, children: [all("Required", "CSCE 1030"), floor()] }]), [done("CSCE 1030")], COMPLETE);
    expect(node(result, "Area").status).toBe("satisfied");
    expect(policyOutcome(result, "C floor").status).toBe("satisfied");
  });
});

describe("each course counts toward one requirement node", () => {
  const specialization = [
    all("Required", "CSCE 3610"),
    { kind: "choice", name: "Specialization", citation, branches: [{ name: "VLSI", node: choose("VLSI", 3, singles("CSCE 3610", "CSCE 4610", "CSCE 4730", "PHYS 4500")) }] },
  ] satisfies RequirementNode[];
  const shortRecord = [done("CSCE 3610"), done("CSCE 4610"), done("CSCE 4730")];

  test("where sharing is forbidden, a required course is not also a specialization pick", () => {
    const short = auditProgram(program(specialization), shortRecord, COMPLETE);
    expect(node(short, "Required").status).toBe("satisfied");
    expect(node(short, "Specialization").status).toBe("unsatisfied");
    expect(node(short, "Specialization").detail).toContain("2/3 chosen");
    const full = auditProgram(program(specialization), [...shortRecord, done("PHYS 4500")], COMPLETE);
    expect(node(full, "Specialization").status).toBe("satisfied");
  });

  test("where an advisor decides sharing, a node met only by a claimed course is advisory", () => {
    const outcome = node(auditProgram(program(specialization, "advisor"), shortRecord, COMPLETE), "Specialization");
    expect(outcome.status).toBe("advisory");
    expect(outcome.children![0]!.detail).toBe("2/3 chosen (CSCE 4610, CSCE 4730); met if CSCE 3610 also counts here, though it already counts toward an earlier requirement. One course may meet several requirements with an advisor's approval.");
    expect(node(auditProgram(program(specialization, "advisor"), [done("CSCE 4610")], COMPLETE), "Specialization").status).toBe("unsatisfied");
  });

  test("an advisory pool lists only courses no tracked node claimed, wherever it sits in the tree", () => {
    const tree = program([{ kind: "group", name: "Major", citation, children: [all("Required", "CSCE 4110"), pool("Advanced electives")] }, hours("Core", 3, "CSCE 4600")]);
    const result = auditProgram(tree, [done("CSCE 4110"), done("CSCE 4600"), done("CSCE 4201")], COMPLETE);
    const electives = node(result, "Major").children!.find((child) => child.name === "Advanced electives")!;
    expect(electives.detail).toContain("matching the subject and level rule: CSCE 4201 (3 hours of 6)");
  });

  test("an hours node claims no more than it needs, so the extra course stays free", () => {
    const tree = program([hours("Core", 3, "CSCE 3530", "CSCE 4115"), hours("Electives", 3, "CSCE 4115")]);
    const result = auditProgram(tree, [done("CSCE 3530"), done("CSCE 4115")], COMPLETE);
    expect(node(result, "Electives").status).toBe("satisfied");
  });

  test("a choice left to an advisor by an in-progress course is named for the branch that needs the advisor", () => {
    const tree = program([
      all("Required", "CSCE 3610"),
      { kind: "choice", name: "Specialization", citation, branches: [
        { name: "Real-Time", node: choose("Real-Time", 3, singles("CSCE 4610", "CSCE 4730", "CSCE 4440")) },
        { name: "VLSI", node: choose("VLSI", 3, singles("CSCE 3610", "CSCE 4610", "CSCE 4730")) },
      ] },
    ], "advisor");
    const outcome = node(auditProgram(tree, [done("CSCE 4610"), done("CSCE 4730"), current("CSCE 3610")], COMPLETE), "Specialization");
    expect(outcome.status).toBe("advisory");
    expect(outcome.name).toBe("Specialization — VLSI");
    expect(outcome.shownBranch).toBe(1);
  });

  test("an unmet choice names its closest branch", () => {
    const tree = program([
      { kind: "choice", name: "Track", citation, branches: [{ name: "First", node: all("First", "CSCE 1030", "CSCE 1040") }, { name: "Second", node: all("Second", "CSCE 2100", "CSCE 2110", "CSCE 2120") }] },
    ]);
    const outcome = node(auditProgram(tree, [done("CSCE 2100"), done("CSCE 2110")], COMPLETE), "Track");
    expect(outcome.name).toBe("Track — Second");
    expect(outcome.shownBranch).toBe(1);
  });

  test("an unmet choice whose first branch is closest points at index 0", () => {
    const tree = program([
      { kind: "choice", name: "Track", citation, branches: [{ name: "First — Systems", node: all("First", "CSCE 1030", "CSCE 1040") }, { name: "Second", node: all("Second", "CSCE 2100", "CSCE 2110", "CSCE 2120") }] },
    ]);
    const outcome = node(auditProgram(tree, [done("CSCE 1030")], COMPLETE), "Track");
    expect(outcome.name).toBe("Track — First — Systems");
    expect(outcome.shownBranch).toBe(0);
  });

  test("a choice keeps the claims of the branch it settles on and releases the rest", () => {
    const tree = program([
      { kind: "choice", name: "Track", citation, branches: [{ name: "First", node: all("First", "CSCE 1030", "CSCE 9999") }, { name: "Second", node: all("Second", "CSCE 1040") }] },
      hours("Later", 3, "CSCE 1030"),
    ]);
    const result = auditProgram(tree, [done("CSCE 1030"), done("CSCE 1040")], COMPLETE);
    expect(node(result, "Track").name).toBe("Track — Second");
    expect(node(result, "Track").status).toBe("satisfied");
    expect(node(result, "Later").status).toBe("satisfied");
  });
});

describe("allocation prefers courses that meet the major's floor", () => {
  const withFloor = (nodes: RequirementNode[]) => program([...nodes, floor()]);

  test("an hours node takes the passing courses over a D listed between them", () => {
    const result = auditProgram(withFloor([hours("Core", 6, "CSCE 3530", "CSCE 4115", "CSCE 4430")]), [done("CSCE 3530", "B"), done("CSCE 4115", "D"), done("CSCE 4430", "B")], COMPLETE);
    expect(node(result, "Core").detail).toBe("2 courses, 6/6 hours (CSCE 3530, CSCE 4430)");
    expect(policyOutcome(result, "C floor").status).toBe("satisfied");
  });

  test("a choose node takes the passing courses over a D", () => {
    const result = auditProgram(withFloor([choose("Lab", 2, singles("GEOG 1710", "GEOL 1610", "PHYS 1052"))]), [done("GEOG 1710", "B"), done("GEOL 1610", "D"), done("PHYS 1052", "B")], COMPLETE);
    expect(node(result, "Lab").detail).toBe("2/2 chosen (GEOG 1710, PHYS 1052)");
    expect(policyOutcome(result, "C floor").status).toBe("satisfied");
  });

  test("a slot takes the passing alternative over a D in the first one", () => {
    const tree = withFloor([{ kind: "all", name: "Calculus", citation, items: [{ alternatives: [{ must: ["MATH 1710"] }, { must: ["MATH 1810", "MATH 1820"] }] }] }]);
    const result = auditProgram(tree, [done("MATH 1710", "D"), done("MATH 1810", "B"), done("MATH 1820", "B")], COMPLETE);
    expect(node(result, "Calculus").status).toBe("satisfied");
    expect(policyOutcome(result, "C floor").status).toBe("satisfied");
  });

  test("a passing course of unknown credit is taken before a D of known credit", () => {
    const result = auditProgram(withFloor([hours("Core", 6, "CSCE 3530", "CSCE 4115", "CSCE 4430")]), [done("CSCE 3530", "B"), done("CSCE 4115", "D"), done("CSCE 4430", "B", { credits: null })], COMPLETE);
    expect(node(result, "Core").detail).toBe("2 courses, 3/6 hours (CSCE 3530, CSCE 4430); credit hours unknown for CSCE 4430");
    expect(policyOutcome(result, "C floor").status).not.toBe("unsatisfied");
  });

  test("a D still fails the floor when no passing course can take its place", () => {
    const result = auditProgram(withFloor([hours("Core", 6, "CSCE 3530", "CSCE 4115")]), [done("CSCE 3530", "B"), done("CSCE 4115", "D")], COMPLETE);
    expect(policyOutcome(result, "C floor").detail).toBe("Below C: CSCE 4115 (D).");
  });

  test("a floor scoped to listed codes still fails a D among them: the Communication D must be repeated", () => {
    const tree = program([choose("Group 1", 1, singles("ENGL 1310", "ENGL 1315")), floor({ kind: "codes", codes: ["ENGL 1310", "ENGL 1315"] })]);
    const result = auditProgram(tree, [done("ENGL 1310", "D"), done("ENGL 1315", "B")], COMPLETE);
    expect(policyOutcome(result, "C floor").detail).toBe("Below C: ENGL 1310 (D).");
  });

  test("a D that may be an advisory pool's elective leaves the floor unverifiable, unless passing candidates fill the pool", () => {
    const tree = program([{ kind: "group", name: "Major", citation, children: [all("Required", "CSCE 1030"), pool("Advanced electives")] }, floor()]);
    const risky = policyOutcome(auditProgram(tree, [done("CSCE 1030", "A"), done("CSCE 4201", "D"), done("CSCE 4230", "B")], COMPLETE), "C floor");
    expect(risky.status).toBe("unverifiable");
    expect(risky.detail).toContain("CSCE 4201 (D) may count toward Advanced electives; if it does, it falls below C.");
    const covered = policyOutcome(auditProgram(tree, [done("CSCE 1030", "A"), done("CSCE 4201", "D"), done("CSCE 4230", "B"), done("CSCE 4240", "B")], COMPLETE), "C floor");
    expect(covered.status).toBe("satisfied");
  });
});

describe("choose slots: equivalents fill one pick, and/or sets can fill two", () => {
  const lab = program([
    choose("Lab", 2, [
      { alternatives: [{ must: ["BIOL 1710", "BIOL 1760"] }, { must: ["BIOL 1720", "BIOL 1760"] }, { must: ["BIOL 1710", "BIOL 1720", "BIOL 1760"], counts: 2 }] },
      { alternatives: [{ must: ["CHEM 1410", "CHEM 1430"] }, { must: ["CHEM 1415", "CHEM 1435"] }] },
      { alternatives: [{ must: ["GEOL 1610"] }] },
    ]),
  ]);

  test("two equivalent chemistry pairs are one lab science", () => {
    const outcome = node(auditProgram(lab, ["CHEM 1410", "CHEM 1430", "CHEM 1415", "CHEM 1435"].map((code) => done(code)), COMPLETE), "Lab");
    expect(outcome.status).toBe("unsatisfied");
    expect(outcome.detail).toStartWith("1/2 chosen");
  });

  test("a biology lecture without its lab is no lab science", () => {
    expect(node(auditProgram(lab, [done("BIOL 1710"), done("GEOL 1610")], COMPLETE), "Lab").detail).toStartWith("1/2 chosen");
  });

  test("both biology lectures with the one lab are two lab sciences", () => {
    expect(node(auditProgram(lab, [done("BIOL 1710"), done("BIOL 1720"), done("BIOL 1760", "A", { credits: 1 })], COMPLETE), "Lab").status).toBe("satisfied");
  });
});

describe("unknown credit hours", () => {
  test("an hours node stops claiming at a course of unknown credit, leaving the rest for later nodes", () => {
    const tree = program([
      hours("Mathematics", 3, "MATH 1650", "MATH 1710"),
      { kind: "choice", name: "Option", citation, branches: [{ name: "A", node: hours("Option A", 3, "MATH 1710", "ANTH 1150") }] },
    ]);
    const result = auditProgram(tree, [done("MATH 1650", "B", { credits: null, sourceKind: "transfer" }), done("MATH 1710", "B", { credits: null, sourceKind: "transfer" })], COMPLETE);
    expect(node(result, "Mathematics").status).toBe("advisory");
    expect(node(result, "Mathematics").detail).toContain("credit hours unknown for MATH 1650");
    expect(node(result, "Option").children![0]!.detail).toContain("MATH 1710");
  });

  test("known-credit courses are claimed before unknown ones", () => {
    const tree = program([hours("History", 6, "HIST 2610", "HIST 2620", "HIST 2675")]);
    const outcome = node(auditProgram(tree, [done("HIST 2610", "B", { credits: null }), done("HIST 2620"), done("HIST 2675")], COMPLETE), "History");
    expect(outcome.status).toBe("satisfied");
    expect(outcome.detail).toContain("(HIST 2620, HIST 2675)");
  });
});

describe("attempts and retakes", () => {
  const tree = program([all("Required", "CSCE 1030"), floor()]);

  test("an in-progress retake does not erase a completed attempt", () => {
    const result = auditProgram(tree, [done("CSCE 1030", "C", { term: 1 }), current("CSCE 1030", { term: 2 })], COMPLETE);
    expect(node(result, "Required").status).toBe("satisfied");
  });

  test("an F earns no credit, and a later passing attempt does", () => {
    expect(node(auditProgram(tree, [done("CSCE 1030", "F")], COMPLETE), "Required").status).toBe("unsatisfied");
    expect(node(auditProgram(tree, [done("CSCE 1030", "F", { term: 1 }), done("CSCE 1030", "B", { term: 2 })], COMPLETE), "Required").status).toBe("satisfied");
  });

  test("W, I, NP and Z earn no credit", () => {
    for (const grade of ["W", "I", "NP", "Z"]) expect(node(auditProgram(tree, [done("CSCE 1030", grade)], COMPLETE), "Required").status).toBe("unsatisfied");
  });
});

describe("grade floors on UNT's letter scale", () => {
  const tree = program([all("Required", "CSCE 1030", "MATH 1710"), floor()]);
  const floorOf = (courses: AuditCourse[]) => policyOutcome(auditProgram(tree, courses, COMPLETE), "C floor");

  test("a D fails the C floor and is named", () => {
    const outcome = floorOf([done("CSCE 1030", "D"), done("MATH 1710", "A")]);
    expect(outcome.status).toBe("unsatisfied");
    expect(outcome.detail).toBe("Below C: CSCE 1030 (D).");
  });

  test("a C meets the floor", () => {
    expect(floorOf([done("CSCE 1030", "C"), done("MATH 1710", "B")]).status).toBe("satisfied");
  });

  test("a D raised to a C on a retake passes", () => {
    expect(floorOf([done("CSCE 1030", "D", { term: 1 }), done("CSCE 1030", "C", { term: 2 })]).status).toBe("satisfied");
  });

  test("exam credit carries no letter: it is listed, not failed", () => {
    const outcome = floorOf([done("CSCE 1030", "B"), done("MATH 1710", "CR", { sourceKind: "exam" })]);
    expect(outcome.status).toBe("satisfied");
    expect(outcome.detail).toContain("Not checked, no letter grade: MATH 1710 (CR).");
  });

  test("a floor with nothing but credit-only courses in scope checked nothing, so it cannot read satisfied", () => {
    const outcome = floorOf([done("CSCE 1030", "CR", { sourceKind: "exam" }), done("MATH 1710", "CR", { sourceKind: "transfer" })]);
    expect(outcome.status).toBe("unverifiable");
    expect(outcome.detail).toContain("every course in scope is credit without a letter grade");
  });

  test("a P on a major course needs an advisor", () => {
    expect(floorOf([done("CSCE 1030", "P"), done("MATH 1710", "A")]).status).toBe("unverifiable");
  });

  test("a grade off UNT's scale is not read as a letter", () => {
    expect(floorOf([done("CSCE 1030", "C-"), done("MATH 1710", "A")]).status).toBe("unverifiable");
  });

  test("an unclaimed course is outside the major scope", () => {
    expect(floorOf([done("CSCE 1030", "A"), done("HIST 2610", "D")]).status).toBe("satisfied");
  });
});

describe("policies over an unmet choice's courses", () => {
  // Two of three Networks courses done: the choice is unmet, so its branch
  // releases them, yet they count if Networks is the branch finished.
  const specialization: RequirementNode = {
    kind: "choice",
    name: "Specialization",
    citation,
    branches: [
      { name: "Networks", node: choose("Networks", 3, singles("CSCE 3420", "CSCE 3530", "CSCE 3550")) },
      { name: "AI", node: choose("AI", 3, singles("CSCE 4200", "CSCE 4201", "CSCE 4205")) },
    ],
  };
  const atUnt = (hours: number) => policy("Major at UNT", { type: "advancedHoursAtUnt", hours, courseScope: { kind: "applied" } });
  const audit = (policies: PolicyNode[], courses: AuditCourse[]) => auditProgram(program([all("Required", "CSCE 3600"), specialization, ...policies]), courses, COMPLETE);

  test("a residence total the unmet branch's courses could close is unverifiable, not short", () => {
    const outcome = policyOutcome(audit([atUnt(6)], [done("CSCE 3600"), done("CSCE 3420"), done("CSCE 3530")]), "Major at UNT");
    expect(outcome.status).toBe("unverifiable");
    expect(outcome.detail).toBe("3 advanced UNT hours of 6. Counting CSCE 3420, CSCE 3530, from a choice no branch has met yet: 9 advanced UNT hours of 6. Cannot verify until a branch is met.");
  });

  test("a D in the unmet branch keeps the C floor from reading satisfied, and is named", () => {
    const outcome = policyOutcome(audit([floor()], [done("CSCE 3600"), done("CSCE 3420"), done("CSCE 3530", "D")]), "C floor");
    expect(outcome.status).toBe("unverifiable");
    expect(outcome.detail).toBe(
      "No completed course in scope (major) falls below C. Counting CSCE 3420, CSCE 3530, from a choice no branch has met yet: Below C: CSCE 3530 (D). Cannot verify until a branch is met.",
    );
  });

  test("a reading that holds either way keeps its status and names the branch's courses too", () => {
    const outcome = policyOutcome(audit([floor()], [done("CSCE 3600", "D"), done("CSCE 3420"), done("CSCE 3530", "D")]), "C floor");
    expect(outcome.status).toBe("unsatisfied");
    expect(outcome.detail).toBe("Below C: CSCE 3600 (D). Counting CSCE 3420, CSCE 3530, from a choice no branch has met yet: Below C: CSCE 3600 (D), CSCE 3530 (D).");
    expect(policyOutcome(audit([atUnt(3)], [done("CSCE 3600"), done("CSCE 3420")]), "Major at UNT").status).toBe("satisfied");
  });

  test("a met choice ignores a nested unmet choice in a branch the student did not take", () => {
    const track: RequirementNode = { kind: "choice", name: "Track", citation, branches: [{ name: "Systems", node: all("Systems", "CSCE 4600") }, { name: "Specialized", node: specialization }] };
    const outcome = policyOutcome(auditProgram(program([all("Required", "CSCE 3600"), track, floor()]), [done("CSCE 3600"), done("CSCE 4600"), done("CSCE 3420"), done("CSCE 3530", "D")], COMPLETE), "C floor");
    expect(outcome.status).toBe("satisfied");
    expect(outcome.detail).toBe("No completed course in scope (major) falls below C.");
  });

  test("once the branch is met its courses are placed, and its D fails the floor", () => {
    const outcome = policyOutcome(audit([floor()], [done("CSCE 3600"), done("CSCE 3420"), done("CSCE 3530", "D"), done("CSCE 3550")]), "C floor");
    expect(outcome.status).toBe("unsatisfied");
    expect(outcome.detail).toBe("Below C: CSCE 3530 (D).");
  });
});

describe("GPA counts failed attempts and skips credit-only rows", () => {
  const tree = program([gpa(), policy("UNT GPA", { type: "gpa", minimum: 2, scope: "unt", courseScope: { kind: "unt" } })]);
  const gpaOf = (courses: AuditCourse[], options = COMPLETE) => policyOutcome(auditProgram(tree, courses, options), "GPA");

  test("B, F, F is a 1.00 GPA, below 2.0", () => {
    const outcome = gpaOf([done("CSCE 1030", "B"), done("MATH 1710", "F"), done("HIST 2610", "F")]);
    expect(outcome.status).toBe("unsatisfied");
    expect(outcome.detail).toBe("1.00 over 3 graded attempts of 2.0 required");
  });

  test("hours weight the points", () => {
    expect(gpaOf([done("MATH 1710", "A", { credits: 4 }), done("CSCE 1015", "F", { credits: 1 })]).detail).toBe("3.20 over 2 graded attempts of 2.0 required");
  });

  test("CR, P, W, I and NP rows are skipped, not a reason to give up", () => {
    const outcome = gpaOf([done("CSCE 1030", "B"), done("MATH 1710", "CR", { sourceKind: "exam" }), done("ENGL 1310", "P"), done("HIST 2610", "W"), done("PSCI 2305", "I"), done("ART 1300", "NP")]);
    expect(outcome.status).toBe("satisfied");
    expect(outcome.detail).toBe("3.00 over 1 graded attempt of 2.0 required");
  });

  test("a record that may be missing attempts reports the figure but cannot verify it", () => {
    const outcome = gpaOf([done("CSCE 1030", "B")], { gradeHistoryComplete: false });
    expect(outcome.status).toBe("unverifiable");
    expect(outcome.detail).toStartWith("3.00 over 1 graded attempt of 2.0 required, but the record holds only");
  });

  test("a repeated course makes the GPA unverifiable: the repeat rule is not captured", () => {
    const outcome = gpaOf([done("CSCE 1030", "F", { term: 1 }), done("CSCE 1030", "B", { term: 2 })]);
    expect(outcome.status).toBe("unverifiable");
    expect(outcome.detail).toStartWith("CSCE 1030 was attempted more than once");
  });

  test("unknown credit hours on a graded attempt make the GPA unverifiable", () => {
    expect(gpaOf([done("CSCE 1030", "B", { credits: null })]).status).toBe("unverifiable");
  });

  test("an F stored with the 0 hours it earned has unknown attempted hours, so it cannot be dropped silently", () => {
    const outcome = gpaOf([done("CSCE 1030", "B"), done("MATH 1710", "F", { credits: 0 })]);
    expect(outcome.status).toBe("unverifiable");
    expect(outcome.detail).toContain("attempted hours unknown for MATH 1710 (F)");
  });

  test("the UNT GPA reads only UNT attempts", () => {
    const outcome = policyOutcome(auditProgram(tree, [done("CSCE 1030", "A"), done("MATH 1710", "F", { sourceKind: "transfer" })], COMPLETE), "UNT GPA");
    expect(outcome.detail).toBe("4.00 over 1 graded attempt of 2.0 required");
  });
});

describe("hour totals", () => {
  test("a residence rule scoped to applied courses counts only the claimed advanced UNT hours", () => {
    const tree = program([all("Required", "CSCE 3600", "CSCE 4010"), policy("Major at UNT", { type: "advancedHoursAtUnt", hours: 6, courseScope: { kind: "applied" } })]);
    const outcome = policyOutcome(auditProgram(tree, [done("CSCE 3600"), done("CSCE 4010", "A", { sourceKind: "transfer" }), done("HIST 4000")], COMPLETE), "Major at UNT");
    expect(outcome.status).toBe("unsatisfied");
    expect(outcome.detail).toStartWith("3 advanced UNT hours of 6");
  });

  test("an unclaimed advanced UNT pool candidate may close the major's residence gap, so a short total is unverifiable", () => {
    const tree = program([{ kind: "group", name: "Major", citation, children: [all("Required", "CSCE 3600"), pool("Advanced electives")] }, policy("Major at UNT", { type: "advancedHoursAtUnt", hours: 6, courseScope: { kind: "applied" } })]);
    const outcome = policyOutcome(auditProgram(tree, [done("CSCE 3600"), done("CSCE 4560")], COMPLETE), "Major at UNT");
    expect(outcome.status).toBe("unverifiable");
    expect(outcome.detail).toBe("3 advanced UNT hours of 6 from courses the audit placed; CSCE 4560 may count as major electives too. Cannot verify.");
  });

  test("a total scoped to applied courses counts only what the nodes claimed", () => {
    const tree = program([hours("Mathematics", 3, "MATH 1650", "MATH 1710"), policy("Core total", { type: "totalHours", hours: 6, courseScope: { kind: "applied" } })]);
    const outcome = policyOutcome(auditProgram(tree, [done("MATH 1650"), done("MATH 1710")], COMPLETE), "Core total");
    expect(outcome.status).toBe("unsatisfied");
    expect(outcome.detail).toBe("3 completed hours of 6");
  });

  test("a repeated course counts its hours once", () => {
    const tree = program([policy("Total", { type: "totalHours", hours: 6 })]);
    const outcome = policyOutcome(auditProgram(tree, [done("CSCE 1030", "D", { term: 1 }), done("CSCE 1030", "B", { term: 2 })], COMPLETE), "Total");
    expect(outcome.detail).toBe("3 completed hours of 6");
  });

  test("in-progress hours are noted but never count", () => {
    const tree = program([policy("Total", { type: "totalHours", hours: 6 })]);
    const outcome = policyOutcome(auditProgram(tree, [done("CSCE 1030"), current("CSCE 1040")], COMPLETE), "Total");
    expect(outcome.status).toBe("unsatisfied");
    expect(outcome.detail).toBe("3 completed hours of 6 (3 more in progress)");
  });
});

test("top-level policies are reported once, among the policies", () => {
  const result = auditProgram(program([all("Required", "CSCE 1030"), floor()]), [done("CSCE 1030")], COMPLETE);
  expect(result.requirements.map((outcome) => outcome.name)).toEqual(["Required"]);
  expect(result.policies.map((outcome) => outcome.name)).toEqual(["C floor"]);
});
