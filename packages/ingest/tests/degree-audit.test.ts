import { describe, expect, test } from "bun:test";
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { auditProgram, type AuditCourse, type AuditResult, type NodeOutcome } from "@untangle/core/degree/audit";
import type { ProgramData, RequirementNode } from "@untangle/core/degree/types";
import { buildDegreeData } from "../src/degree/build";
import { readFourYearPlan, type PlanEntry } from "../src/degree/plan";

/**
 * The audit against the real derived trees. The centerpiece audits each
 * program's own published four-year plan, read from the captured page, as a
 * finished student: every requirement the audit tracks must come back
 * satisfied, or the derivation or the engine is wrong about the catalog.
 */

const dataDir = path.resolve(import.meta.dir, "../data/catalog/unt-2026-27");
const data = buildDegreeData(dataDir, "2026-10-15T00:00:00.000Z");
const COMPLETE = { gradeHistoryComplete: true };

function program(id: string): ProgramData {
  const found = data.programs.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`missing program ${id}`);
  return found;
}

/** Codes a derived node lists, so every placeholder fill can be checked against the catalog. */
function listedCodes(programId: string, name: string): string[] {
  const walk = (nodes: RequirementNode[]): RequirementNode | null => {
    for (const node of nodes) {
      if (node.name === name) return node;
      const nested = node.kind === "group" ? walk(node.children) : node.kind === "choice" ? walk(node.branches.map((branch) => branch.node)) : null;
      if (nested) return nested;
    }
    return null;
  };
  const node = walk(program(programId).requirements);
  if (!node) throw new Error(`no node ${name} in ${programId}`);
  switch (node.kind) {
    case "all":
    case "choose":
      return node.items.flatMap((slot) => slot.alternatives.flatMap((option) => option.must));
    case "hours":
      return node.options.flatMap((option) => option.must);
    default:
      throw new Error(`${name} lists no courses`);
  }
}

/** A finished UNT attempt. */
function done(code: string, credits: number | null = 3, grade = "B", extra: Partial<AuditCourse> = {}): AuditCourse {
  return { code, grade, credits, sourceKind: "unt", inProgress: false, term: 1, ...extra };
}

/**
 * A code no UNT list names, standing in for an elective the plan leaves
 * open. Its subject matches no requirement, so it adds hours and nothing else.
 */
const FREE_ELECTIVE = "XFRE 1000";

type Fill = { code: string; hours: number }[];

/**
 * The plan as a finished record. Each placeholder cell ("American History
 * core", "Elective") takes the next fill listed for its label, and a fill must
 * add up to the hours the plan prints for the cell. A label without a fill,
 * or a fill left over, fails: the record must be exactly the plan.
 */
function planRecord(entries: PlanEntry[], fills: Record<string, Fill[]>, options: { inProgressFrom?: number } = {}): AuditCourse[] {
  const queues = new Map(Object.entries(fills).map(([label, list]) => [label, [...list]]));
  const courses: AuditCourse[] = [];
  for (const entry of entries) {
    const term = entry.year * 2 + entry.semester;
    const inProgress = options.inProgressFrom !== undefined && term >= options.inProgressFrom;
    const parts = entry.code ? [{ code: entry.code, hours: entry.hours }] : queues.get(entry.label)?.shift();
    if (!parts) throw new Error(`no fill for the plan's "${entry.label}" (year ${entry.year}, semester ${entry.semester})`);
    const sum = parts.reduce((total, part) => total + part.hours, 0);
    if (sum !== entry.hours) throw new Error(`the fill for "${entry.label}" is ${sum} hours; the plan prints ${entry.hours}`);
    for (const part of parts) {
      courses.push(inProgress
        ? { code: part.code, grade: null, credits: part.hours, sourceKind: "current", inProgress: true, term }
        : done(part.code, part.hours, "B", { term }));
    }
  }
  const unused = [...queues].filter(([, list]) => list.length > 0).map(([label]) => label);
  if (unused.length > 0) throw new Error(`fills left over for ${unused.join(", ")}`);
  return courses;
}

const one = (code: string, hours = 3): Fill => [{ code, hours }];

/**
 * Every node the audit tracks satisfied. A group or a choice is judged by its
 * parts: pools and prose notes are advisory by design, and a group holding
 * one reads advisory with every tracked part satisfied.
 */
function unmetTracked(outcomes: NodeOutcome[], path: string[] = []): string[] {
  return outcomes.flatMap((outcome) => {
    const here = [...path, outcome.name];
    if (outcome.kind === "pool" || outcome.kind === "note") return outcome.status === "advisory" ? [] : [`${here.join(" > ")}: ${outcome.status}`];
    if (outcome.kind === "group") {
      const inside = unmetTracked(outcome.children ?? [], here);
      const expected = (outcome.children ?? []).some((child) => child.kind === "pool" || child.kind === "note") ? "advisory" : "satisfied";
      return outcome.status === expected ? inside : [`${here.join(" > ")}: ${outcome.status}`, ...inside];
    }
    return outcome.status === "satisfied" ? [] : [`${here.join(" > ")}: ${outcome.status} (${outcome.detail})`];
  });
}

/** Policies other than residency, which the audit leaves to an advisor by design. */
function unmetPolicies(result: AuditResult): string[] {
  return result.policies.filter((outcome) => outcome.name !== "Residency" && outcome.status !== "satisfied").map((outcome) => `${outcome.name}: ${outcome.status} (${outcome.detail})`);
}

const csPlan = readFourYearPlan(readFileSync(path.join(dataDir, "cs-bs.html"), "utf8"));
const cePlan = readFourYearPlan(readFileSync(path.join(dataDir, "ce-bs.html"), "utf8"));

// Core placeholders take courses from the core page's own lists; each is
// checked against the derived area below. Where an area lists honors twins
// (PSCI 2315 beside PSCI 2305), the fill takes the two distinct courses a
// student takes, not the first two listed.
const coreFills = {
  history: [one("HIST 2610"), one("HIST 2620")],
  government: [one("PSCI 2305"), one("PSCI 2306")],
  communication: [one("ENGL 1310")],
  creativeArts: [one("ANTH 2400")],
  culture: [one("AGER 2250")],
  social: [one("ANTH 1010")],
};

const csFills: Record<string, Fill[]> = {
  "American History core": coreFills.history,
  "Communication Core": coreFills.communication,
  "Creative Arts Core": coreFills.creativeArts,
  "Government/Political Science core": coreFills.government,
  "Language, Philosophy and Culture core": coreFills.culture,
  "Social and Behavioral Sciences core": coreFills.social,
  // The CS plan's named courses leave the Component Area Option three hours
  // short (CSCE 1010 covers Option B; no named course is spare for Option A),
  // so one free elective must be an Option A course. ANTH 1150 is the first
  // Option A lists. The other two electives stay free.
  Elective: [one("ANTH 1150"), one(FREE_ELECTIVE, 2), one(FREE_ELECTIVE.replace("1000", "1001"))],
  "TECM 4000 Elective": [one("TECM 4180")],
  // The CS plan never schedules CSCE 4350, which Major requirements list as
  // required. Its "CSCE Elective" cell is the only CSCE cell without a named
  // list, and the plan's CSCE hours add up only with CSCE 4350 in it: the 49
  // listed hours plus 6 core, 6 breadth and 6 advanced elective hours.
  "CSCE Elective": [one("CSCE 4350")],
  "CSCE Core Elective": [one("CSCE 3530"), one("CSCE 4115")],
  "CSCE Breadth Elective": [one("CSCE 4201"), one("CSCE 4210")],
  // The CSCE Advanced Elective Courses list is not captured; two 4000-level
  // CSCE courses outside the core and breadth picks stand in for it.
  "CSCE Elective-advanced": [one("CSCE 4230"), one("CSCE 4240")],
};

const ceFills: Record<string, Fill[]> = {
  "American History core": coreFills.history,
  "Communication core": coreFills.communication,
  "Creative Arts core": coreFills.creativeArts,
  "Political Science core": coreFills.government,
  "Language, Philosophy and Culture core": coreFills.culture,
  "Social and Behavioral Sciences core": coreFills.social,
  // "*See Other required courses above": the first chemistry alternative there.
  "CHEM selection*": [[{ code: "CHEM 1410", hours: 3 }, { code: "CHEM 1430", hours: 1 }]],
  // The first three Communication and Networks courses the page lists.
  "Communication and Networks specialization selection": [one("CSCE 3420"), one("CSCE 3530")],
  "Communication and Networks Specialization": [one("CSCE 3550")],
  Elective: [one(FREE_ELECTIVE, 2)],
};

describe("placeholder fills come from the catalog's own lists", () => {
  test("core fills sit in their core areas", () => {
    expect(listedCodes("core", "American History, 6 hours")).toEqual(expect.arrayContaining(["HIST 2610", "HIST 2620"]));
    expect(listedCodes("core", "Government/Political Science, 6 hours")).toEqual(expect.arrayContaining(["PSCI 2305", "PSCI 2306"]));
    expect(listedCodes("core", "Communication Group 1")[0]).toBe("ENGL 1310");
    expect(listedCodes("core", "Creative Arts, 3 hours")[0]).toBe("ANTH 2400");
    expect(listedCodes("core", "Language, Philosophy and Culture, 3 hours")[0]).toBe("AGER 2250");
    expect(listedCodes("core", "Social and Behavioral Sciences, 3 hours")).toContain("ANTH 1010");
    expect(listedCodes("core", "Six hours from Component Area Option A")[0]).toBe("ANTH 1150");
  });

  test("major fills sit in their major lists", () => {
    expect(listedCodes("cs-bs", "CSCE core, 6 hours").slice(0, 2)).toEqual(["CSCE 3530", "CSCE 4115"]);
    expect(listedCodes("cs-bs", "CSCE breadth courses, 6 hours").slice(0, 4)).toEqual(["CSCE 4201", "CSCE 4210", "CSCE 4230", "CSCE 4240"]);
    expect(listedCodes("cs-bs", "Required courses")).toContain("CSCE 4350");
    expect(listedCodes("ce-bs", "Three courses from Communication and Networks").slice(0, 3)).toEqual(["CSCE 3420", "CSCE 3530", "CSCE 3550"]);
    expect(listedCodes("ce-bs", "Other required courses").slice(0, 2)).toEqual(["CHEM 1410", "CHEM 1430"]);
  });

  test("each plan adds up to the 120 hours its page prints", () => {
    expect(csPlan.reduce((total, entry) => total + entry.hours, 0)).toBe(120);
    expect(cePlan.reduce((total, entry) => total + entry.hours, 0)).toBe(120);
  });
});

describe("CS BS: the catalog's four-year plan, finished", () => {
  const record = planRecord(csPlan, csFills);

  test("every tracked major requirement and policy is satisfied", () => {
    const result = auditProgram(program("cs-bs"), record, COMPLETE);
    expect(unmetTracked(result.requirements)).toEqual([]);
    expect(unmetPolicies(result)).toEqual([]);
    // The two parts the audit cannot check stay with an advisor.
    expect(result.requirements.find((outcome) => outcome.name === "Major requirements")?.status).toBe("advisory");
    expect(result.requirements.find((outcome) => outcome.name === "Technical writing, 3 hours")?.detail).toContain("TECM 4180");
  });

  test("every core area is satisfied, through Option A plus Option B", () => {
    const result = auditProgram(program("core"), record, COMPLETE);
    expect(unmetTracked(result.requirements)).toEqual([]);
    expect(unmetPolicies(result)).toEqual([]);
    expect(result.requirements.find((outcome) => outcome.name.startsWith("Component Area Option, 6 hours"))?.name).toBe("Component Area Option, 6 hours — 3 hours from Option A and 3 hours from Option B");
    expect(result.policies.find((outcome) => outcome.name === "Core total: 42 hours")?.detail).toBe("43 completed hours of 42");
  });

  test("the plan as printed leaves CSCE 4350 unscheduled, and the audit says so", () => {
    const printed = planRecord(csPlan, { ...csFills, "CSCE Elective": [one(FREE_ELECTIVE.replace("1000", "1002"))] });
    const result = auditProgram(program("cs-bs"), printed, COMPLETE);
    expect(unmetTracked(result.requirements)).toEqual([
      "Major requirements: unsatisfied",
      "Major requirements > Required courses: unsatisfied (16/17 required courses or sequences complete)",
    ]);
  });

  test("with the final semester in progress, nothing reads unsatisfied", () => {
    const result = auditProgram(program("cs-bs"), planRecord(csPlan, csFills, { inProgressFrom: 4 * 2 + 2 }), COMPLETE);
    const statuses = result.requirements.map((outcome) => [outcome.name, outcome.status]);
    expect(statuses.filter(([, status]) => status === "unsatisfied")).toEqual([]);
    expect(result.requirements.find((outcome) => outcome.name === "CSCE breadth courses, 6 hours")?.status).toBe("satisfied");
    const major = result.requirements.find((outcome) => outcome.name === "Major requirements")!;
    expect(major.children?.find((child) => child.name === "Required courses")?.status).toBe("inProgress");
  });
});

describe("CE BS: the catalog's four-year plan, finished", () => {
  // The CE plan never schedules MATH 2730, which Other required courses list,
  // and its 120 hours fall short of the page's own 121-hour minimum. The test
  // adds the missing course; the next test pins the printed plan's gaps.
  const record = [...planRecord(cePlan, ceFills), done("MATH 2730", 3, "B", { term: 10 })];

  test("every tracked major requirement and policy is satisfied", () => {
    const result = auditProgram(program("ce-bs"), record, COMPLETE);
    expect(unmetTracked(result.requirements)).toEqual([]);
    expect(unmetPolicies(result)).toEqual([]);
    expect(result.requirements.find((outcome) => outcome.name.startsWith("Specialization area"))?.name).toBe("Specialization area, 9 hours — Communication and Networks");
  });

  test("every core area is satisfied, through six hours of Option A", () => {
    const result = auditProgram(program("core"), record, COMPLETE);
    expect(unmetTracked(result.requirements)).toEqual([]);
    expect(unmetPolicies(result)).toEqual([]);
    expect(result.requirements.find((outcome) => outcome.name.startsWith("Component Area Option, 6 hours"))?.name).toBe("Component Area Option, 6 hours — 6 hours from Component Area Option A");
  });

  test("the plan as printed misses MATH 2730 and the 121-hour minimum, and the audit says so", () => {
    const result = auditProgram(program("ce-bs"), planRecord(cePlan, ceFills), COMPLETE);
    expect(unmetTracked(result.requirements)).toEqual(["Other required courses: unsatisfied (9/10 required courses or sequences complete)"]);
    expect(unmetPolicies(result)).toEqual(["Total hours: 121: unsatisfied (120 completed hours of 121)"]);
  });
});

describe("the review's probe records against the real trees", () => {
  const status = (result: AuditResult, prefix: string) => result.requirements.find((outcome) => outcome.name.startsWith(prefix))!;

  test("CS lab science: BIOL 1710 without BIOL 1760 is not a lab science", () => {
    expect(status(auditProgram(program("cs-bs"), [done("BIOL 1710"), done("GEOL 1610")], COMPLETE), "Laboratory science").detail).toStartWith("1/2 chosen");
    expect(status(auditProgram(program("cs-bs"), [done("BIOL 1710"), done("BIOL 1760", 1), done("GEOL 1610")], COMPLETE), "Laboratory science").status).toBe("satisfied");
    expect(status(auditProgram(program("cs-bs"), [done("BIOL 1710"), done("BIOL 1720"), done("BIOL 1760", 1)], COMPLETE), "Laboratory science").status).toBe("satisfied");
  });

  test("CS lab science: equivalent chemistry pairs count once", () => {
    const record = [done("CHEM 1410"), done("CHEM 1430", 1), done("CHEM 1415"), done("CHEM 1435", 1)];
    expect(status(auditProgram(program("cs-bs"), record, COMPLETE), "Laboratory science").detail).toStartWith("1/2 chosen");
  });

  test("CE: required CSCE 3610 is not silently a VLSI specialization course; an advisor decides", () => {
    const result = auditProgram(program("ce-bs"), [done("CSCE 3610"), done("CSCE 4610"), done("CSCE 4730")], COMPLETE);
    expect(status(result, "Specialization area").name).toBe("Specialization area, 9 hours — VLSI and Electronics");
    expect(status(result, "Specialization area").status).toBe("advisory");
    const vlsi = status(result, "Specialization area").children!.find((child) => child.name === "Three courses from VLSI and Electronics")!;
    expect(vlsi.detail).toStartWith("2/3 chosen (CSCE 4610, CSCE 4730); met if CSCE 3610 also counts here");
    expect(status(auditProgram(program("ce-bs"), [done("CSCE 3610"), done("CSCE 4610"), done("CSCE 4730"), done("PHYS 4500")], COMPLETE), "Specialization area").status).toBe("satisfied");
  });

  test("CE: an unfinished specialization's courses keep the major's residence and C-floor checks open", () => {
    const policy = (record: AuditCourse[], name: string) => auditProgram(program("ce-bs"), record, COMPLETE).policies.find((outcome) => outcome.name === name)!;
    const required = [done("CSCE 3600"), done("CSCE 3612"), done("CSCE 3730")];
    // 9 placed advanced UNT hours, 15 if Communication and Networks is the specialization finished.
    const residence = policy([...required, done("CSCE 3420"), done("CSCE 3530")], "Advanced hours in the major at UNT: 12");
    expect(residence.status).toBe("unverifiable");
    expect(residence.detail).toStartWith("9 advanced UNT hours of 12. Counting CSCE 3420, CSCE 3530, from a choice no branch has met yet: 15 advanced UNT hours of 12.");
    const floor = policy([...required, done("CSCE 3420"), done("CSCE 3530", 3, "D")], "Minimum grade of C (major courses)");
    expect(floor.status).toBe("unverifiable");
    expect(floor.detail).toContain("Below C: CSCE 3530 (D).");
  });

  test("the core never shares: an area course does not fill Component Area Option A too", () => {
    const result = auditProgram(program("core"), [done("PADM 2100"), done("ANTH 1150")], COMPLETE);
    expect(status(result, "Social and Behavioral Sciences").status).toBe("satisfied");
    expect(status(result, "Component Area Option").status).toBe("unsatisfied");
  });

  test("a D beside passing alternatives does not fail the major's floor", () => {
    const floorOf = (record: AuditCourse[]) => auditProgram(program("cs-bs"), record, COMPLETE).policies.find((outcome) => outcome.name === "Minimum grade of C (major courses)")!;
    // The unclaimed CSCE 4115 D could still be one of the two advanced
    // electives, until two passing candidates fill those six hours.
    const csceCore = [done("CSCE 3530", 3, "B"), done("CSCE 4115", 3, "D"), done("CSCE 4430", 3, "B"), done("CSCE 4201", 3, "A"), done("CSCE 4210", 3, "A")];
    expect(floorOf(csceCore).detail).toContain("CSCE 4115 (D) may count toward CSCE advanced electives, 6 hours");
    expect(floorOf([...csceCore, done("CSCE 4230", 3, "B"), done("CSCE 4240", 3, "B")]).status).toBe("satisfied");
    expect(floorOf([done("GEOG 1710", 3, "B"), done("GEOL 1610", 3, "D"), done("PHYS 1052", 3, "B")]).status).toBe("satisfied");
    expect(floorOf([done("MATH 1710", 4, "D"), done("MATH 1810", 3, "B"), done("MATH 1820", 3, "B")]).status).toBe("satisfied");
  });

  test("a D that may be a CSCE advanced elective leaves the major's floor unverifiable", () => {
    const outcome = auditProgram(program("cs-bs"), [done("CSCE 4560", 3, "D")], COMPLETE).policies.find((entry) => entry.name === "Minimum grade of C (major courses)")!;
    expect(outcome.status).toBe("unverifiable");
    expect(outcome.detail).toContain("CSCE 4560 (D) may count toward CSCE advanced electives, 6 hours");
  });

  test("core: two math courses of unknown credit do not starve the Component Area Option", () => {
    const result = auditProgram(program("core"), [done("MATH 1650", null, "B", { sourceKind: "transfer" }), done("MATH 1710", null, "B", { sourceKind: "transfer" })], COMPLETE);
    expect(status(result, "Mathematics").status).toBe("advisory");
    expect(status(result, "Mathematics").detail).toContain("credit hours unknown for MATH 1650");
    expect(status(result, "Component Area Option").children![0]!.detail).toContain("MATH 1710");
  });

  test("an exam credit row does not stop the GPA", () => {
    const result = auditProgram(program("cs-bs"), [done("MATH 1710", 4, "CR", { sourceKind: "exam" }), done("CSCE 1030", 3, "A")], COMPLETE);
    expect(result.policies.find((outcome) => outcome.name === "Overall GPA")?.detail).toBe("4.00 over 1 graded attempt of 2.0 required");
  });

  test("CSCE core half done with nothing enrolled is unsatisfied", () => {
    expect(status(auditProgram(program("cs-bs"), [done("CSCE 3530")], COMPLETE), "CSCE core").status).toBe("unsatisfied");
  });

  test("required CSCE courses never appear as advanced elective candidates", () => {
    const required = listedCodes("cs-bs", "Required courses").map((code) => done(code, code === "CSCE 1015" ? 1 : 3));
    const major = status(auditProgram(program("cs-bs"), required, COMPLETE), "Major requirements");
    expect(major.status).toBe("advisory");
    expect(major.children!.find((child) => child.name.startsWith("CSCE advanced electives"))!.detail).toContain("matching the subject and level rule: none");
  });

  test("B, F, F is below a 2.0 GPA", () => {
    const result = auditProgram(program("cs-bs"), [done("CSCE 1030", 3, "B"), done("MATH 1710", 4, "F"), done("EENG 2710", 3, "F")], COMPLETE);
    expect(result.policies.find((outcome) => outcome.name === "Overall GPA")?.status).toBe("unsatisfied");
  });

  test("a D in a major course fails the major's C floor", () => {
    const result = auditProgram(program("cs-bs"), [done("CSCE 1030", 3, "D"), done("CSCE 1040", 3, "A")], COMPLETE);
    expect(result.policies.find((outcome) => outcome.name === "Minimum grade of C (major courses)")?.detail).toBe("Below C: CSCE 1030 (D).");
  });
});

/** Every requirement with work left, as [path, remaining kind]. */
function workLeft(outcomes: NodeOutcome[], path: string[] = []): [string, string][] {
  return outcomes.flatMap((outcome) => {
    const here = [...path, outcome.name];
    const below = workLeft(outcome.children ?? [], here);
    return outcome.remaining.kind === "none" ? below : [[here.join(" > "), outcome.remaining.kind], ...below];
  });
}

/** Every course code the remaining work names as needed or eligible. */
function codesNeeded(outcomes: NodeOutcome[]): string[] {
  const codes = outcomes.flatMap((outcome): string[] => {
    const own = outcome.remaining;
    const here =
      own.kind === "courses" ? [...own.courses, ...own.oneOf.flat(2)]
      : own.kind === "choose" ? own.eligible.flatMap((slot) => slot.options.flatMap((option) => option.courses))
      : own.kind === "hours" ? own.eligible.flat()
      : [];
    return [...here, ...codesNeeded(outcome.children ?? [])];
  });
  return [...new Set(codes)].sort();
}

const requirement = (result: AuditResult, prefix: string): NodeOutcome => {
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
};

/** What the CS BS audit leaves to an advisor for every student: the uncaptured lists and the prose rules. */
const CS_ADVISORY: [string, string][] = [
  ["Major requirements > 55-hour major minimum", "advisor"],
  ["Major requirements > CSCE advanced electives, 6 hours", "advisor"],
  ["Technical writing, 3 hours", "advisor"],
  ["Note", "advisor"],
  ["Minor", "advisor"],
  ["Electives", "advisor"],
];
const CORE_ADVISORY: [string, string][] = [
  ["Component Area Option double-dip rule", "advisor"],
  ["Option A other-core courses", "advisor"],
  ["Other ways to complete the core", "advisor"],
];

describe("remaining work for the degree-compare investigation's students", () => {
  // The student-auto journey's transcript (output/playwright/student-auto/fixtures/make-transcript.mjs).
  const journey = [done("MATH 1710", 3, "B", { term: 1 }), done("ENGL 1310", 3, "A", { term: 1 }), done("CSCE 1040", 3, "A", { term: 2 })];

  test("the journey transcript: 111 hours left, MATH 1710 fills the calculus slot, and the rest of the major is listed", () => {
    const major = auditProgram(program("cs-bs"), journey, COMPLETE);
    expect(major.totals).toEqual({ required: 120, finished: 9, inProgress: 0, claimed: 0, stillNeeded: 111, unknownHours: [] });
    expect(requirement(major, "Required courses").remaining).toEqual({ kind: "courses", courses: listedCodes("cs-bs", "Required courses").filter((code) => code !== "CSCE 1040"), oneOf: [] });
    expect(requirement(major, "Other required courses").remaining).toEqual({ kind: "courses", courses: ["EENG 2710", "TECM 2700"], oneOf: [] });
    expect(requirement(major, "CSCE core, 6 hours").remaining).toEqual({ kind: "hours", hours: 6, eligible: [["CSCE 3530"], ["CSCE 4115"], ["CSCE 4430"], ["CSCE 4600"], ["CSCE 4650"]] });
    expect(requirement(major, "Laboratory science").remaining).toMatchObject({ kind: "choose", picks: 2 });
    const core = auditProgram(program("core"), journey, COMPLETE);
    expect(core.totals).toEqual({ required: 42, finished: 6, inProgress: 0, claimed: 0, stillNeeded: 36, unknownHours: [] });
    expect(requirement(core, "Mathematics").remaining).toEqual({ kind: "none" });
    expect(requirement(core, "Communication Group 2").remaining).toMatchObject({ kind: "choose", picks: 1 });
  });

  test("a first-year student with nothing: every hour left, and calculus offered as both of its alternatives", () => {
    const major = auditProgram(program("cs-bs"), [], COMPLETE);
    expect(major.totals?.stillNeeded).toBe(120);
    expect(auditProgram(program("core"), [], COMPLETE).totals?.stillNeeded).toBe(42);
    expect(requirement(major, "Other required courses").remaining).toEqual({ kind: "courses", courses: ["EENG 2710", "TECM 2700"], oneOf: [[["MATH 1710"], ["MATH 1810", "MATH 1820"]]] });
  });

  test("the completed four-year plan: no course is needed anywhere, MATH 1720 included, and only advisory rules remain", () => {
    const record = planRecord(csPlan, csFills);
    const major = auditProgram(program("cs-bs"), record, COMPLETE);
    const core = auditProgram(program("core"), record, COMPLETE);
    expect(codesNeeded(major.requirements)).toEqual([]);
    expect(codesNeeded(core.requirements)).toEqual([]);
    expect(workLeft(major.requirements)).toEqual([["Major requirements", "parts"], ...CS_ADVISORY]);
    expect(workLeft(core.requirements)).toEqual(CORE_ADVISORY);
    expect(major.totals).toEqual({ required: 120, finished: 120, inProgress: 0, claimed: 0, stillNeeded: 0, unknownHours: [] });
    expect(core.totals).toEqual({ required: 42, finished: 43, inProgress: 0, claimed: 0, stillNeeded: 0, unknownHours: [] });
  });

  test("the final term in progress: 105 finished and 15 in progress leave no hours and no course needed", () => {
    const record = planRecord(csPlan, csFills, { inProgressFrom: 4 * 2 + 2 });
    const major = auditProgram(program("cs-bs"), record, COMPLETE);
    const core = auditProgram(program("core"), record, COMPLETE);
    expect(major.totals).toEqual({ required: 120, finished: 105, inProgress: 15, claimed: 0, stillNeeded: 0, unknownHours: [] });
    expect(core.totals).toEqual({ required: 42, finished: 37, inProgress: 6, claimed: 0, stillNeeded: 0, unknownHours: [] });
    expect(requirement(major, "Required courses")).toMatchObject({ status: "inProgress", remaining: { kind: "none" } });
    expect(codesNeeded(major.requirements)).toEqual([]);
    expect(codesNeeded(core.requirements)).toEqual([]);
    expect(workLeft(major.requirements)).toEqual([["Major requirements", "parts"], ...CS_ADVISORY]);
  });

  test("lab science: both chemistry pairs are one pick, so one pick is left and that chemistry slot is not offered again", () => {
    const record = [done("CHEM 1410"), done("CHEM 1430", 1), done("CHEM 1415"), done("CHEM 1435", 1)];
    const lab = requirement(auditProgram(program("cs-bs"), record, COMPLETE), "Laboratory science");
    expect(lab.remaining).toMatchObject({ kind: "choose", picks: 1 });
    const offered = codesNeeded([lab]);
    expect(offered.filter((code) => ["CHEM 1410", "CHEM 1415", "CHEM 1430", "CHEM 1435"].includes(code))).toEqual([]);
    expect(offered).toEqual(expect.arrayContaining(["CHEM 1420", "CHEM 1440"]));
  });

  test("advisory candidates read the fullest allocation: a claimed CSCE core course frees CSCE 4430 for the advanced electives", () => {
    const result = auditProgram(program("cs-bs"), [done("CSCE 4115"), done("CSCE 4430"), done("CSCE 4600"), { code: "CSCE 3530", credits: 3, sourceKind: "claimed" }], COMPLETE);
    expect(requirement(result, "CSCE advanced electives").remaining).toMatchObject({ kind: "advisor", candidates: ["CSCE 4430", "CSCE 4600"] });
    const inProgress = { code: "TECM 4180", grade: null, credits: 3, sourceKind: "current", inProgress: true, term: 9 } satisfies AuditCourse;
    expect(requirement(auditProgram(program("cs-bs"), [inProgress], COMPLETE), "Technical writing").remaining).toMatchObject({ kind: "advisor", candidates: ["TECM 4180"] });
  });

  test("core: a partly met Component Area Option still counts its hours, so the total stays a floor", () => {
    expect(auditProgram(program("core"), [done("ANTH 1150")], COMPLETE).totals).toEqual({ required: 42, finished: 3, inProgress: 0, claimed: 0, stillNeeded: 39, unknownHours: [] });
    expect(auditProgram(program("core"), [{ code: "ANTH 1150", credits: 3, sourceKind: "claimed" }], COMPLETE).totals).toEqual({ required: 42, finished: 0, inProgress: 0, claimed: 3, stillNeeded: 39, unknownHours: [] });
  });

  test("technical writing takes 4000-4999 TECM courses only: TECM 5000 is a graduate course", () => {
    const writing = (record: AuditCourse[]) => requirement(auditProgram(program("cs-bs"), record, COMPLETE), "Technical writing");
    expect(writing([done("TECM 5000")]).detail).toContain("matching the subject and level rule: none.");
    expect(writing([done("TECM 5000")]).remaining).toMatchObject({ kind: "advisor", candidates: [] });
    expect(writing([done("TECM 3700"), done("TECM 4180"), done("TECM 5000")]).remaining).toMatchObject({ kind: "advisor", candidates: ["TECM 4180"] });
  });

  test("CSCE advanced electives list 3000-4999 CSCE courses: a 5000-level graduate course is left to an advisor", () => {
    // CSCE 3214 and CSCE 4205 are on no required, core or breadth list, so only the elective pool can use them.
    const electives = requirement(auditProgram(program("cs-bs"), [done("CSCE 3214"), done("CSCE 4205"), done("CSCE 5200")], COMPLETE), "CSCE advanced electives");
    expect(electives.status).toBe("advisory");
    expect(electives.remaining).toMatchObject({ kind: "advisor", candidates: ["CSCE 3214", "CSCE 4205"] });
    expect(electives.remaining.kind === "advisor" && electives.remaining.reason).toContain("A 5000-level graduate course is not counted");
  });
});

describe("build guards", () => {
  test("policies deduplicate across the program and university scans", () => {
    const names = (nodes: RequirementNode[]): string[] =>
      nodes.flatMap((node) => (node.kind === "policy" ? [node.name] : node.kind === "group" ? names(node.children) : []));
    expect(names(program("cs-bs").requirements).filter((name) => name === "Total hours: 120")).toHaveLength(1);
    expect(names(program("core").requirements).filter((name) => name === "Communication core grade")).toHaveLength(1);
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

  test("the plan reader checks each semester against the page's printed total", () => {
    const html = readFileSync(path.join(dataDir, "cs-bs.html"), "utf8").replace("<td>16 hours</td>", "<td>17 hours</td>");
    expect(() => readFourYearPlan(html)).toThrow("year 1 semester 1: the page prints a total of 17 hours, the rows add up to 16");
  });
});
