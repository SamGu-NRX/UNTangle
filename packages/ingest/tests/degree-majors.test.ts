import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { auditProgram, type AuditCourse, type AuditResult } from "@untangle/core/degree/audit";
import type { DegreeData, ProgramData } from "@untangle/core/degree/types";
import { buildDegreeData } from "../src/degree/build";

const dataDir = path.resolve(import.meta.dir, "../data/catalog/unt-2026-27");
const data: DegreeData = buildDegreeData(dataDir, "2026-10-15T00:00:00.000Z");
const complete = { gradeHistoryComplete: true };
const done = (code: string, credits = 3): AuditCourse => ({ code, grade: "B", credits, sourceKind: "unt", inProgress: false, term: 1 });
const program = (id: string): ProgramData => data.programs.find((entry) => entry.id === id)!;
const named = (result: AuditResult, prefix: string) => result.requirements.find((outcome) => outcome.name.startsWith(prefix))!;
const filler = (count: number) => Array.from({ length: count }, (_, index) => done(`ZZZ ${3000 + index}`));

const itRequired = [
  "TECM 2700", "MATH 1710", "CSCE 1010", "CSCE 1015", "CSCE 1030", "CSCE 1040", "CSCE 2100", "CSCE 2110", "CSCE 2130", "CSCE 3055", "CSCE 3220", "CSCE 3420", "CSCE 3444", "CSCE 3530", "CSCE 3550", "CSCE 3600", "CSCE 3605", "CSCE 4010", "CSCE 4350", "CSCE 4355", "CSCE 4535", "CSCE 4905", "CSCE 4925",
];
const itRecord = [done("TECM 2700"), done("MATH 1710", 4), done("BIOL 1112"), done("GEOL 1610"), ...itRequired.slice(2).map((code) => done(code, code === "CSCE 1015" ? 1 : 3)), ...filler(16)];

const cyberRequired = [
  "CSCE 1010", "CSCE 1015", "CSCE 1030", "CSCE 1040", "CSCE 2100", "CSCE 2110", "CSCE 2120", "CSCE 2130", "CSCE 3530", "CSCE 3550", "CSCE 3560", "CSCE 3600", "CSCE 4010", "CSCE 4535", "CSCE 4555", "CSCE 4560", "CSCE 4565", "CSCE 4575", "CSCE 4907", "CSCE 4927",
];
const cyberRecord = [
  ...cyberRequired.map((code) => done(code, code === "CSCE 1015" ? 1 : 3)),
  ...["CSCE 4050", "CSCE 4350", "CSCE 4357", "CSCE 4520"].map((code) => done(code)),
  done("MATH 1710", 4), done("TECM 2700"), done("BIOL 1112"), done("GEOL 1610"), ...filler(13),
];

const eeRequired = ["EENG 2610", "EENG 2620", "EENG 2710", "EENG 3410", "EENG 3510", "EENG 3520", "EENG 3710", "EENG 3810"];
const eeElectives = ["EENG 4010", "EENG 4210", "EENG 4310", "EENG 4320", "EENG 4330"];
const eeProjects = ["EENG 1910", "EENG 2611", "EENG 2621", "EENG 2711", "EENG 2905", "EENG 2920", "EENG 3411", "EENG 3511", "EENG 3811", "EENG 3910", "EENG 3920", "EENG 4910", "EENG 4990"];
const eeOther = ["CHEM 1410", "CHEM 1430", "CSCE 1030", "CSCE 1015", "MATH 1710", "MATH 1720", "MATH 1820", "MATH 1830", "MATH 2700", "MATH 2730", "MATH 3180", "MATH 3410", "PHYS 1710", "PHYS 1730", "PHYS 2220", "PHYS 2240", "TECM 2700"];
const eeHours = (code: string) => ["EENG 2611", "EENG 2621", "EENG 2711", "EENG 3411", "EENG 3511", "EENG 3811", "PHYS 1730", "PHYS 2240", "CSCE 1015", "CHEM 1430"].includes(code) ? 1 : ["MATH 1710", "MATH 1720", "MATH 1820", "MATH 1830"].includes(code) ? 4 : 3;
const eeRecord = [...eeRequired, ...eeElectives, ...eeProjects, ...eeOther].map((code) => done(code, eeHours(code)));

describe("new 2026-27 major audits", () => {
  test("Information Technology: the hand-built transcript satisfies named requirements", () => {
    const result = auditProgram(program("it-bs"), itRecord, complete);
    expect(named(result, "Required courses").status).toBe("satisfied");
    expect(named(result, "Laboratory science").status).toBe("satisfied");
    expect(named(result, "Major requirements").status).toBe("satisfied");
  });

  test("Information Technology: missing CSCE 4350 fails the named major", () => {
    const result = auditProgram(program("it-bs"), itRecord.filter((course) => course.code !== "CSCE 4350"), complete);
    expect(named(result, "Major requirements").status).toBe("unsatisfied");
  });

  test("Cybersecurity: the hand-built transcript satisfies named requirements", () => {
    const result = auditProgram(program("cybersecurity-bs"), cyberRecord, complete);
    expect(named(result, "Major requirements").status).toBe("satisfied");
    expect(named(result, "Major electives").status).toBe("satisfied");
    expect(named(result, "Laboratory science").status).toBe("satisfied");
  });

  test("Cybersecurity: missing CSCE 4565 fails the named major", () => {
    const result = auditProgram(program("cybersecurity-bs"), cyberRecord.filter((course) => course.code !== "CSCE 4565"), complete);
    expect(named(result, "Major requirements").status).toBe("unsatisfied");
  });

  test("Electrical Engineering: the hand-built transcript satisfies named requirements", () => {
    const result = auditProgram(program("ee-bs"), eeRecord, complete);
    expect(named(result, "Major requirements").children?.find((child) => child.name === "Required EENG courses")?.status).toBe("satisfied");
    expect(named(result, "EENG 4000-level electives").status).toBe("satisfied");
    expect(named(result, "Project and Laboratory").status).toBe("satisfied");
    expect(named(result, "Other required courses").status).toBe("satisfied");
  });

  test("Electrical Engineering: missing EENG 4990 fails the project/lab requirement", () => {
    const result = auditProgram(program("ee-bs"), eeRecord.filter((course) => course.code !== "EENG 4990"), complete);
    expect(named(result, "Project and Laboratory").status).toBe("unsatisfied");
  });
});
