import { describe, expect, test } from "bun:test";
import { buildCourseModel, type CourseRowModel, type PlanSnapshot } from "@/components/courses/model/course-model";
import { buildGroups, degreeScope, OPEN_AT_START, rowFact, visibleParts } from "@/components/courses/model/groups";
import { creditProgress, creditsLabel } from "@/components/courses/model/progress";
import type { RuleNode } from "@/components/courses/model/rules";
import { sampleTranscript } from "@/components/courses/model/sample-transcript";
import { untProfile } from "@/components/courses/school";
import { getInitialPlannerState, getPlanningTermCourseCodes } from "@/lib/planner";
import type { CourseStatus } from "@/lib/types";

const profile = untProfile();
const cs = { department: "CSCE", coreCourseCodes: ["CSCE 1030", "CSCE 1040", "CSCE 2100", "MATH 1710", "MATH 1720"] };

/** The sample transcript, with MATH 1720 planned for the term. */
function samplePlan(): PlanSnapshot {
  const statuses: Record<string, CourseStatus> = { "MATH 1720": "inProgress" };
  for (const record of sampleTranscript) statuses[record.code] = record.appliedStatus === "completed" ? "completed" : "inProgress";
  const planned = getPlanningTermCourseCodes({ ...getInitialPlannerState(), courseStatuses: statuses, transcriptRecords: sampleTranscript });
  return { statuses, transcript: sampleTranscript, planned: new Set(planned), manualCredit: new Set(), autoPlanned: new Set() };
}

describe("groups", () => {
  const model = buildCourseModel(profile, samplePlan());
  const groups = buildGroups(model, cs);
  const ids = (key: string) => groups.find((group) => group.key === key)?.parts.flatMap((part) => part.ids) ?? [];

  test("come in the order a student acts on them, empty ones left out", () => {
    expect(groups.map((group) => group.key)).toEqual(["check", "can", "taking", "later", "done"]);
    expect(groups.map((group) => OPEN_AT_START[group.key])).toEqual([true, true, false, false, false]);
  });

  test("planned courses live in the tray, not in a group", () => {
    expect(groups.flatMap((group) => group.parts.flatMap((part) => part.ids))).not.toContain("MATH 1720");
  });

  test("Done holds credit and coverage; core courses lead, in the degree plan's order", () => {
    expect(ids("done")).toEqual(["CSCE 1030", "CSCE 1040", "MATH 1710", "ENGL 1310"]);
    expect(ids("taking")).toEqual(["ENGL 1320"]);
    // CSCE 2100 is core and its course prerequisite is met, so it leads You can take.
    expect(ids("can")[0]).toBe("CSCE 2100");
  });

  test("the degree scope is the department plus what the student already has", () => {
    const scope = degreeScope(model, cs);
    expect(scope.has("ENGL 1310")).toBe(true);
    expect(scope.has("BIOL 1710")).toBe(false);
    expect([...scope].filter((id) => model.rows.get(id)!.department === "CSCE").length).toBe(
      [...model.rows.values()].filter((row) => row.department === "CSCE").length,
    );
  });

  test("asking for every department widens the scope to the whole catalog", () => {
    expect(degreeScope(model, cs, true).size).toBe(model.rows.size);
    const can = buildGroups(model, cs, true).find((group) => group.key === "can")!;
    expect(can.count).toBeGreaterThan(buildGroups(model, cs).find((group) => group.key === "can")!.count);
  });

  test("without a department every course is in scope", () => {
    expect(degreeScope(model, null).size).toBe(model.rows.size);
    expect(degreeScope(model, { department: "—", coreCourseCodes: [] }).size).toBe(model.rows.size);
  });

  test("counts match the rows", () => {
    for (const group of groups) expect(group.count).toBe(group.parts.reduce((sum, part) => sum + part.ids.length, 0));
  });

  test("You can take splits into the degree plan and the rest only when both have rows", () => {
    const fresh = buildCourseModel(profile, { statuses: {}, transcript: [], planned: new Set(), manualCredit: new Set(), autoPlanned: new Set() });
    const can = buildGroups(fresh, { department: "CSCE", coreCourseCodes: ["CSCE 1010"] }).find((group) => group.key === "can")!;
    expect(can.parts.map((part) => part.label)).toEqual(["In your degree plan", "More CSCE courses"]);
    expect(can.parts[0].ids).toEqual(["CSCE 1010"]);
    const sample = buildGroups(model, cs).find((group) => group.key === "can")!;
    expect(sample.parts.map((part) => part.label)).toEqual(["In your degree plan", "More CSCE courses"]);
    expect(sample.parts[0].ids).toEqual(["CSCE 2100"]);
    // With no core course to take, the group has one unlabeled part.
    const noCore = buildGroups(model, { department: "CSCE", coreCourseCodes: [] }).find((group) => group.key === "can")!;
    expect(noCore.parts.map((part) => part.label)).toEqual([null]);
  });
});

describe("visibleParts", () => {
  const parts = [
    { label: "a", ids: ["1", "2", "3"] },
    { label: "b", ids: ["4", "5"] },
  ];
  test("cuts across parts and reports what it held back", () => {
    expect(visibleParts(parts, 4)).toEqual({ parts: [{ label: "a", ids: ["1", "2", "3"] }, { label: "b", ids: ["4"] }], hidden: 1 });
    expect(visibleParts(parts, 3)).toEqual({ parts: [{ label: "a", ids: ["1", "2", "3"] }], hidden: 2 });
    expect(visibleParts(parts, 10)).toEqual({ parts, hidden: 0 });
  });
});

describe("rowFact", () => {
  const base = buildCourseModel(profile, samplePlan()).rows.get("CSCE 3444")!;
  const with_ = (status: CourseRowModel["status"], unmet: RuleNode | null, extra: Partial<CourseRowModel> = {}): CourseRowModel => ({
    ...base,
    status,
    unmet,
    ...extra,
  });
  const course = (id: string, together = false): RuleNode => ({ kind: "course", id, ...(together ? { together } : {}) });
  const fact = (row: CourseRowModel) => rowFact(row)?.text ?? null;

  test("To check leads with the consent the student must ask for", () => {
    expect(fact(with_("check", { kind: "all", items: [course("CSCE 2100"), { kind: "unparsed", text: "Consent of department" }] }))).toBe(
      "Needs department consent",
    );
    expect(fact(with_("check", { kind: "unparsed", text: "instructor consent required" }))).toBe("Needs instructor consent");
    expect(fact(with_("check", { kind: "unparsed", text: "Consent of Honors College dean" }))).toBe("Needs consent of the Honors College dean");
    expect(rowFact(with_("check", null))).toEqual({ text: "Catalog rule needs an advisor", tone: "attention" });
  });

  test("a consent that is only an alternative stays an alternative", () => {
    const consent: RuleNode = { kind: "unparsed", text: "consent of instructor" };
    expect(fact(with_("check", { kind: "any", items: [course("MATH 1650"), consent] }))).toBe("Needs MATH 1650 or instructor consent");
    expect(fact(with_("check", { kind: "any", items: [course("A 1"), { kind: "unparsed", text: "placement exam" }] }))).toBe("Needs A 1 or another");
  });

  test("a nested group counts as one more requirement instead of disappearing", () => {
    const nested: RuleNode = { kind: "all", items: [course("CSCE 1030"), { kind: "any", items: [course("MATH 1100"), course("MATH 1650")] }] };
    expect(fact(with_("locked", nested))).toBe("Needs CSCE 1030 and 1 more");
    expect(fact(with_("locked", { kind: "all", items: [course("A 1"), { kind: "unparsed", text: "Can be taken concurrently" }] }))).toBe("Needs A 1");
    expect(fact(with_("locked", { kind: "any", items: [{ kind: "all", items: [course("A 1"), course("B 2")] }, course("C 3")] }))).toBe("Needs C 3 or another");
  });

  test("courses read as a short list with the right joining word", () => {
    expect(fact(with_("locked", course("CSCE 2110")))).toBe("Needs CSCE 2110");
    expect(fact(with_("locked", { kind: "all", items: [course("A 1"), course("B 2")] }))).toBe("Needs A 1 and B 2");
    expect(fact(with_("locked", { kind: "all", items: [course("A 1"), course("B 2"), course("C 3"), course("D 4")] }))).toBe("Needs A 1, B 2 and 2 more");
    expect(fact(with_("locked", { kind: "any", items: [course("A 1"), course("B 2"), course("C 3")] }))).toBe("Needs A 1, B 2 or another");
    expect(fact(with_("check", course("BIOL 1710", true)))).toBe("Take with BIOL 1710");
    expect(fact(with_("locked", { kind: "standing", text: "Junior Standing" }))).toBe("Needs junior standing");
    expect(fact(with_("locked", null))).toBe("Prerequisites not met");
  });

  test("Done shows the grade, coverage names the course, the rest show nothing", () => {
    expect(fact(with_("done", null, { meta: { kind: "grade", term: "Fall 2025", grade: "A" } }))).toBe("Grade A");
    expect(fact(with_("done", null, { meta: { kind: "text", text: "You marked this" } }))).toBe("Marked done by you");
    expect(fact(with_("covered", null, { coveredBy: "CSCE 1040" }))).toBe("Covered by CSCE 1040");
    for (const status of ["available", "taking", "planned"] as const) expect(rowFact(with_(status, null))).toBeNull();
  });
});

test("credit counts read as English", () => {
  expect([0, 1, 3].map(creditsLabel)).toEqual(["0 credits", "1 credit", "3 credits"]);
});

describe("creditProgress", () => {
  test("counts done, taking and planned credit, never coverage", () => {
    // CSCE 1040, MATH 1710 and ENGL 1310 done, ENGL 1320 taking, MATH 1720 planned; CSCE 1030 is covered.
    expect(creditProgress(buildCourseModel(profile, samplePlan()), sampleTranscript, profile)).toBe(15);
  });

  test("a transcript row flagged for review adds nothing until it is accepted", () => {
    const flagged = { ...sampleTranscript[0], id: "z", code: "ZZZZ 2000", credits: 3, grade: "A", reviewRequired: true };
    const transcript = [...sampleTranscript, flagged];
    const model = buildCourseModel(profile, { ...samplePlan(), transcript });
    expect(creditProgress(model, transcript, { ...profile, normalizeId: (code) => code })).toBe(15);
  });

  test("a passed course outside the catalog still counts, once", () => {
    const extra = { ...sampleTranscript[0], id: "x", code: "ZZZZ 1000", credits: 4, grade: "A" };
    const transcript = [...sampleTranscript, extra, { ...extra, id: "y" }];
    const model = buildCourseModel(profile, { ...samplePlan(), transcript });
    expect(creditProgress(model, transcript, { ...profile, normalizeId: (code) => code })).toBe(19);
  });
});
