import { describe, expect, test } from "bun:test";
import { auditProgram, type AuditCourse, type AuditResult, type ClaimedCourse, type NodeOutcome } from "../../src/degree/audit";
import type { CourseSlot, PolicyNode, ProgramData, RequirementNode } from "../../src/degree/types";

/**
 * The structured remaining-work result, claims, and hour totals, over
 * hand-written trees. Each test pins one answer; the real catalog trees are
 * covered in packages/ingest/tests/degree-audit.test.ts.
 */

const citation = { page: "synthetic.html", url: "https://example.test/synthetic", anchor: null, heading: "Synthetic program" };
const COMPLETE = { gradeHistoryComplete: true };

function program(requirements: RequirementNode[], courseSharing: ProgramData["courseSharing"] = "forbidden"): ProgramData {
  return { id: "synthetic", name: "Synthetic program", catalogId: "unt-test", sourceUrl: citation.url, coreSharedCourses: [], requirements, courseSharing };
}

function done(code: string, grade = "A", extra: Partial<AuditCourse> = {}): AuditCourse {
  return { code, grade, credits: 3, sourceKind: "unt", inProgress: false, term: 1, ...extra };
}

function current(code: string, extra: Partial<AuditCourse> = {}): AuditCourse {
  return { code, grade: null, credits: 3, sourceKind: "current", inProgress: true, term: 9, ...extra };
}

function claimed(code: string, credits: number | null = 3): ClaimedCourse {
  return { code, credits, sourceKind: "claimed" };
}

const singles = (...codes: string[]): CourseSlot[] => codes.map((code) => ({ alternatives: [{ must: [code] }] }));
const all = (name: string, ...codes: string[]): RequirementNode => ({ kind: "all", name, citation, items: singles(...codes) });
const hours = (name: string, total: number, ...codes: string[]): RequirementNode => ({ kind: "hours", name, citation, hours: total, options: codes.map((code) => ({ must: [code] })) });
const choose = (name: string, count: number, items: CourseSlot[]): RequirementNode => ({ kind: "choose", name, citation, count, items });
const pool = (name: string): RequirementNode => ({ kind: "pool", name, citation, hours: 6, match: { subjects: ["CSCE"], minLevel: 4000, maxLevel: 4999 } });
const policy = (name: string, value: PolicyNode["policy"]): PolicyNode => ({ kind: "policy", name, citation, quote: name, policy: value });
const total = (name: string, value: number, courseScope?: { kind: "applied" }): PolicyNode => policy(name, { type: "totalHours", hours: value, ...(courseScope ? { courseScope } : {}) });

const node = (result: AuditResult, name: string): NodeOutcome => {
  const found = result.requirements.find((outcome) => outcome.name.startsWith(name));
  if (!found) throw new Error(`no outcome named ${name}: ${result.requirements.map((outcome) => outcome.name).join(", ")}`);
  return found;
};
const child = (outcome: NodeOutcome, name: string): NodeOutcome => {
  const found = outcome.children?.find((entry) => entry.name.startsWith(name));
  if (!found) throw new Error(`no child named ${name} under ${outcome.name}`);
  return found;
};
const policyOutcome = (result: AuditResult, name: string) => result.policies.find((outcome) => outcome.name === name)!;

describe("a course list names what is still needed", () => {
  const other = program([{ kind: "all", name: "Other", citation, items: [...singles("EENG 2710"), { alternatives: [{ must: ["MATH 1710"] }, { must: ["MATH 1810", "MATH 1820"] }] }, ...singles("TECM 2700")] }]);

  test("single courses are listed, and an alternative slot gives every course set without picking one", () => {
    expect(node(auditProgram(other, [], COMPLETE), "Other").remaining).toEqual({
      kind: "courses",
      courses: ["EENG 2710", "TECM 2700"],
      oneOf: [[["MATH 1710"], ["MATH 1810", "MATH 1820"]]],
    });
  });

  test("courses already on the record leave each set", () => {
    expect(node(auditProgram(other, [done("MATH 1810"), done("TECM 2700")], COMPLETE), "Other").remaining).toEqual({
      kind: "courses",
      courses: ["EENG 2710"],
      oneOf: [[["MATH 1710"], ["MATH 1820"]]],
    });
  });

  test("a met list needs nothing", () => {
    expect(node(auditProgram(other, ["EENG 2710", "MATH 1710", "TECM 2700"].map((code) => done(code)), COMPLETE), "Other").remaining).toEqual({ kind: "none" });
  });
});

describe("a choose node counts picks left, and a slot's equivalents fill one pick", () => {
  const lab = program([
    choose("Lab", 2, [
      { alternatives: [{ must: ["BIOL 1710", "BIOL 1760"] }, { must: ["BIOL 1720", "BIOL 1760"] }, { must: ["BIOL 1710", "BIOL 1720", "BIOL 1760"], counts: 2 }] },
      { alternatives: [{ must: ["CHEM 1410", "CHEM 1430"] }, { must: ["CHEM 1415", "CHEM 1435"] }] },
      { alternatives: [{ must: ["GEOL 1610"] }] },
    ]),
  ]);
  const biologyOptions = [
    { courses: ["BIOL 1710", "BIOL 1760"], picks: 1 },
    { courses: ["BIOL 1720", "BIOL 1760"], picks: 1 },
    { courses: ["BIOL 1710", "BIOL 1720", "BIOL 1760"], picks: 2 },
  ];

  test("nothing taken: two picks from every slot", () => {
    expect(node(auditProgram(lab, [], COMPLETE), "Lab").remaining).toEqual({
      kind: "choose",
      picks: 2,
      eligible: [
        { options: biologyOptions },
        { options: [{ courses: ["CHEM 1410", "CHEM 1430"], picks: 1 }, { courses: ["CHEM 1415", "CHEM 1435"], picks: 1 }] },
        { options: [{ courses: ["GEOL 1610"], picks: 1 }] },
      ],
    });
  });

  test("both chemistry pairs count once: one pick left, and chemistry is no longer offered", () => {
    const outcome = node(auditProgram(lab, ["CHEM 1410", "CHEM 1430", "CHEM 1415", "CHEM 1435"].map((code) => done(code)), COMPLETE), "Lab");
    expect(outcome.status).toBe("unsatisfied");
    expect(outcome.remaining).toEqual({ kind: "choose", picks: 1, eligible: [{ options: biologyOptions }, { options: [{ courses: ["GEOL 1610"], picks: 1 }] }] });
  });

  test("a picked slot stays open only through an option worth more picks", () => {
    const outcome = node(auditProgram(lab, [done("BIOL 1710"), done("BIOL 1760", "A", { credits: 1 })], COMPLETE), "Lab");
    expect(outcome.remaining).toEqual({
      kind: "choose",
      picks: 1,
      eligible: [
        { options: [{ courses: ["BIOL 1720"], picks: 1 }] },
        { options: [{ courses: ["CHEM 1410", "CHEM 1430"], picks: 1 }, { courses: ["CHEM 1415", "CHEM 1435"], picks: 1 }] },
        { options: [{ courses: ["GEOL 1610"], picks: 1 }] },
      ],
    });
  });
});

describe("an hours node counts hours left", () => {
  test("the hours short and the listed courses not yet taken", () => {
    const tree = program([hours("Core", 6, "CSCE 3530", "CSCE 4115", "CSCE 4430")]);
    expect(node(auditProgram(tree, [done("CSCE 3530")], COMPLETE), "Core").remaining).toEqual({ kind: "hours", hours: 3, eligible: [["CSCE 4115"], ["CSCE 4430"]] });
  });

  test("a course an earlier requirement counted is not offered again", () => {
    const tree = program([hours("Core", 3, "CSCE 3530", "CSCE 4115"), hours("Electives", 6, "CSCE 4115", "CSCE 4430")]);
    expect(node(auditProgram(tree, [done("CSCE 4115")], COMPLETE), "Electives").remaining).toEqual({ kind: "hours", hours: 6, eligible: [["CSCE 4430"]] });
  });

  test("in-progress hours that reach the total leave nothing needed", () => {
    const outcome = node(auditProgram(program([hours("Core", 6, "CSCE 3530", "CSCE 4115")]), [done("CSCE 3530"), current("CSCE 4115")], COMPLETE), "Core");
    expect([outcome.status, outcome.remaining]).toEqual(["inProgress", { kind: "none" }]);
  });

  test("a course of unknown credit leaves the count to an advisor instead of guessing it", () => {
    const outcome = node(auditProgram(program([hours("Mathematics", 3, "MATH 1650")]), [done("MATH 1650", "B", { credits: null })], COMPLETE), "Mathematics");
    expect(outcome.status).toBe("advisory");
    expect(outcome.remaining).toEqual({ kind: "advisor", reason: "The credit hours of MATH 1650 are unknown, so the audit cannot tell how many of the 3 hours are left.", candidates: ["MATH 1650"] });
  });
});

describe("advisory requirements say why, and never give a count", () => {
  const major = program([{ kind: "group", name: "Major", citation, children: [all("Required", "CSCE 1030"), pool("Advanced electives"), { kind: "note", name: "Minimum", citation, text: "A minimum of 55 semester hours, including:" }] }]);

  test("a pool names the uncaptured list and the record's courses that may count", () => {
    const result = auditProgram(major, [done("CSCE 1030"), done("CSCE 4201")], COMPLETE);
    expect(node(result, "Major").remaining).toEqual({ kind: "parts" });
    expect(child(node(result, "Major"), "Advanced electives").remaining).toEqual({ kind: "advisor", reason: "Advisory: the catalog's course list for this requirement is not captured.", candidates: ["CSCE 4201"] });
  });

  test("a prose rule quotes the catalog passage it cannot check", () => {
    expect(child(node(auditProgram(major, [], COMPLETE), "Major"), "Minimum").remaining).toEqual({
      kind: "advisor",
      reason: "The audit does not check this catalog passage: A minimum of 55 semester hours, including:",
      candidates: [],
    });
  });

  test("a requirement met only by sharing a course names the shared course", () => {
    const tree = program([
      all("Required", "CSCE 3610"),
      { kind: "choice", name: "Specialization", citation, branches: [{ name: "VLSI", node: choose("VLSI", 3, singles("CSCE 3610", "CSCE 4610", "CSCE 4730", "PHYS 4500")) }] },
    ], "advisor");
    const outcome = node(auditProgram(tree, [done("CSCE 3610"), done("CSCE 4610"), done("CSCE 4730")], COMPLETE), "Specialization");
    expect(outcome.remaining).toEqual({ kind: "branch" });
    expect(child(outcome, "VLSI").remaining).toEqual({
      kind: "advisor",
      reason: "This requirement is met if CSCE 3610 also counts here, though it already counts toward an earlier requirement. One course may meet several requirements with an advisor's approval.",
      candidates: ["CSCE 3610"],
    });
  });
});

describe("a choice lists each branch's needs, and a settled choice needs nothing", () => {
  const track = program([{ kind: "choice", name: "Track", citation, branches: [{ name: "First", node: all("First", "CSCE 1030", "CSCE 1040") }, { name: "Second", node: all("Second", "CSCE 2100") }] }]);

  test("unmet: every branch says what it lacks, unpicked", () => {
    const outcome = node(auditProgram(track, [done("CSCE 1030")], COMPLETE), "Track");
    expect(outcome.remaining).toEqual({ kind: "branch" });
    expect(outcome.children?.map((entry) => entry.remaining)).toEqual([
      { kind: "courses", courses: ["CSCE 1040"], oneOf: [] },
      { kind: "courses", courses: ["CSCE 2100"], oneOf: [] },
    ]);
  });

  test("met: the branch the student did not take is not work left", () => {
    const outcome = node(auditProgram(track, [done("CSCE 2100")], COMPLETE), "Track");
    expect(outcome.status).toBe("satisfied");
    expect(child(outcome, "First").status).toBe("unsatisfied");
    expect(child(outcome, "First").remaining).toEqual({ kind: "none" });
  });
});

describe("manual claims count toward remaining work but are never verified", () => {
  const required = program([all("Required", "CSCE 1030", "CSCE 1040")]);

  test("a requirement met only through claims reads claimed, not satisfied", () => {
    const result = auditProgram(required, [claimed("CSCE 1030"), claimed("CSCE 1040")], COMPLETE);
    expect(node(result, "Required")).toMatchObject({ status: "claimed", remaining: { kind: "none" } });
    expect(result.summary).toMatchObject({ satisfied: 0, claimed: 1, unsatisfied: 0 });
  });

  test("a claim beside a finished course still leaves the requirement claimed, and the detail says what the claim adds", () => {
    const outcome = node(auditProgram(required, [done("CSCE 1030"), claimed("CSCE 1040")], COMPLETE), "Required");
    expect(outcome.status).toBe("claimed");
    expect(outcome.detail).toBe("1/2 required courses or sequences complete. Counting courses marked done: 2/2 required courses or sequences complete");
  });

  test("a claimed course is not listed as needed", () => {
    const outcome = node(auditProgram(program([all("Required", "CSCE 1030", "CSCE 1040", "CSCE 2100")]), [done("CSCE 1030"), claimed("CSCE 1040")], COMPLETE), "Required");
    expect([outcome.status, outcome.remaining]).toEqual(["unsatisfied", { kind: "courses", courses: ["CSCE 2100"], oneOf: [] }]);
  });

  test("the transcript wins: a credited course stays satisfied, and the claim is reported set aside", () => {
    const result = auditProgram(required, [done("CSCE 1030"), claimed("CSCE 1030"), done("CSCE 1040")], COMPLETE);
    expect(node(result, "Required").status).toBe("satisfied");
    expect(result.ignoredClaims).toEqual(["CSCE 1030"]);
  });

  test("the transcript wins: a failed attempt is not overruled by a claim", () => {
    const result = auditProgram(required, [done("CSCE 1030", "F"), claimed("CSCE 1030"), done("CSCE 1040")], COMPLETE);
    expect(node(result, "Required")).toMatchObject({ status: "unsatisfied", remaining: { kind: "courses", courses: ["CSCE 1030"], oneOf: [] } });
    expect(result.ignoredClaims).toEqual(["CSCE 1030"]);
  });

  test("an in-progress course is not overruled by a claim", () => {
    expect(node(auditProgram(required, [done("CSCE 1030"), current("CSCE 1040"), claimed("CSCE 1040")], COMPLETE), "Required").status).toBe("inProgress");
  });

  test("no policy reads a claim: the floor, the GPA and the total see the transcript only", () => {
    const tree = program([
      all("Required", "CSCE 1030", "CSCE 1040"),
      policy("C floor", { type: "minGrade", grade: "C", scope: "major", courseScope: { kind: "applied" } }),
      policy("GPA", { type: "gpa", minimum: 2, scope: "overall", courseScope: { kind: "overall" } }),
      total("Total", 6),
    ]);
    const result = auditProgram(tree, [done("CSCE 1030"), claimed("CSCE 1040")], COMPLETE);
    expect(policyOutcome(result, "C floor")).toMatchObject({ status: "satisfied", detail: "No completed course in scope (major) falls below C." });
    expect(policyOutcome(result, "GPA").detail).toBe("4.00 over 1 graded attempt of 2.0 required");
    expect(policyOutcome(result, "Total")).toMatchObject({ status: "unsatisfied", detail: "3 completed hours of 6" });
  });

  test("a course claimed twice is refused rather than guessed between", () => {
    expect(() => auditProgram(required, [claimed("CSCE 1030", 3), claimed("CSCE 1030", 4)], COMPLETE)).toThrow("CSCE 1030 is claimed twice; pass each claimed course once.");
  });
});

describe("hour totals toward the program's total", () => {
  test("finished, in-progress and claimed hours, each course once, and the floor still needed", () => {
    const record = [done("CSCE 1030", "D", { term: 1 }), done("CSCE 1030", "B", { term: 2 }), done("CSCE 1040"), current("CSCE 1040"), current("CSCE 2100"), claimed("MATH 1710", 4)];
    expect(auditProgram(program([total("Total", 20)]), record, COMPLETE).totals).toEqual({ required: 20, finished: 6, inProgress: 3, claimed: 4, stillNeeded: 7, unknownHours: [] });
  });

  test("more hours than the total leave none needed, not a negative count", () => {
    expect(auditProgram(program([total("Total", 3)]), [done("CSCE 1030"), done("CSCE 1040")], COMPLETE).totals?.stillNeeded).toBe(0);
  });

  test("a course of unknown hours leaves the figure unknown, naming the course", () => {
    expect(auditProgram(program([total("Total", 12)]), [done("CSCE 1030"), current("CSCE 2100", { credits: null })], COMPLETE).totals).toEqual({ required: 12, finished: 3, inProgress: 0, claimed: 0, stillNeeded: null, unknownHours: ["CSCE 2100"] });
  });

  test("a total over applied courses counts only what the requirements took, in-progress included", () => {
    const tree = program([hours("Mathematics", 3, "MATH 1650", "MATH 1710"), hours("History", 3, "HIST 2610"), total("Core total", 9, { kind: "applied" })]);
    const record = [done("MATH 1650"), done("MATH 1710"), current("HIST 2610"), claimed("ANTH 1010")];
    expect(auditProgram(tree, record, COMPLETE).totals).toEqual({ required: 9, finished: 3, inProgress: 3, claimed: 0, stillNeeded: 3, unknownHours: [] });
  });

  test("the largest of several totals over the same courses binds", () => {
    expect(auditProgram(program([total("Program total", 121), total("University total", 120)]), [], COMPLETE).totals?.required).toBe(121);
  });

  test("totals over different courses have no single figure, so the audit refuses", () => {
    expect(() => auditProgram(program([total("Total", 120), total("Core total", 42, { kind: "applied" })]), [], COMPLETE)).toThrow("synthetic's total-hours rules count different courses");
  });

  test("a program without a total-hours rule has no totals", () => {
    expect(auditProgram(program([all("Required", "CSCE 1030")]), [], COMPLETE).totals).toBeNull();
  });
});
