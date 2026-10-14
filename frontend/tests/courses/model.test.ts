import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inferStatuses, untAdapter, type CatalogCourse, type Prerequisite } from "@/lib/prereq";
import { renderPrerequisiteTable } from "@/lib/course-catalog/build";
import { computeAuto, describeAuto, undoBlocker, undoStatuses } from "@/components/courses/model/auto";
import { getInitialPlannerState, getPlanningTermCourseCodes } from "@/lib/planner";
import { buildCourseModel, type PlanSnapshot } from "@/components/courses/model/course-model";
import {
  onlyCheckable,
  ruleFromPrerequisite,
  ruleTokens,
  splitUnparsed,
  tokensToString,
  unmetFromReason,
} from "@/components/courses/model/rules";
import { sampleTranscript } from "@/components/courses/model/sample-transcript";
import { instructorIndex, searchCatalog } from "@/components/courses/model/search";
import { untLinkOuts, untProfile } from "@/components/courses/school";
import type { AutoTransaction, CourseStatus } from "@/lib/types";

const course = (courseId: string): Prerequisite => ({ kind: "course", courseId, source: courseId });
const and = (...children: Prerequisite[]): Prerequisite => ({ kind: "and", children, source: "all" });
const or = (...children: Prerequisite[]): Prerequisite => ({ kind: "or", children, source: "either" });
const grade = (requirement: Prerequisite, minimum = "C"): Prerequisite => ({ kind: "minGrade", requirement, grade: minimum, source: "grade" });
const row = (id: string, prerequisite: Prerequisite = and()): CatalogCourse => ({ id, credits: 3, prerequisite });
const text = (node: Prerequisite) => tokensToString(ruleTokens(ruleFromPrerequisite(node)));

describe("rule text", () => {
  test("reads AND, OR and shared grade minimums as a sentence", () => {
    const rule = and(grade(course("CSCE 1030")), or(grade(course("MATH 1100")), grade(course("MATH 1650")), grade(course("MATH 1710"))));
    expect(text(rule)).toBe("CSCE 1030 (C or better) and (MATH 1100, MATH 1650 or MATH 1710) with C or better");
  });

  test("an empty requirement has no text", () => {
    expect(ruleFromPrerequisite(and())).toBeNull();
    expect(text(and())).toBe("");
  });

  test("co-requisites say they can be taken the same term", () => {
    expect(text({ kind: "corequisite", requirement: course("MATH 1710"), source: "c" })).toBe("MATH 1710 (same term is fine)");
  });

  test("unparsed clauses split out of the readable rule", () => {
    const node = ruleFromPrerequisite(and(course("CSCE 1040"), { kind: "unknown", detail: "x", source: "Can be taken concurrently with CSCE 2110 ." }));
    const { readable, unparsed } = splitUnparsed(node);
    expect(tokensToString(ruleTokens(readable))).toBe("CSCE 1040");
    expect(unparsed).toEqual(["Can be taken concurrently with CSCE 2110."]);
  });

  test("unmet keeps only blocking branches of an AND and every alternative of an OR", () => {
    const catalog = [row("a"), row("b"), row("c"), row("d"), row("x", and(course("a"), or(course("b"), course("c")), course("d")))];
    const result = inferStatuses(catalog, { transcript: [{ courseId: "a", grade: "A" }] }, untAdapter);
    const unmet = unmetFromReason(result.statuses.get("x")!.reason);
    expect(tokensToString(ruleTokens(unmet))).toBe("(b or c) and d");
  });

  test("the row summary never drops an alternative from an OR", () => {
    expect(onlyCheckable({ kind: "any", items: [{ kind: "course", id: "a" }, { kind: "unparsed", text: "or placement" }] })).toBeNull();
    expect(onlyCheckable({ kind: "all", items: [{ kind: "course", id: "a" }, { kind: "unparsed", text: "advisor" }] })).toEqual({ kind: "course", id: "a" });
  });
});

function sampleStatuses(): Record<string, CourseStatus> {
  const statuses: Record<string, CourseStatus> = {};
  for (const record of sampleTranscript) statuses[record.code] = record.appliedStatus === "completed" ? "completed" : "inProgress";
  return statuses;
}

/** Mirrors CoursesView: the plan is the planner's own planning-term selector. */
const plan = (
  statuses: Record<string, CourseStatus>,
  extra: { autoPlanned?: string[]; manualCredit?: string[] } = {},
): PlanSnapshot => ({
  statuses,
  transcript: sampleTranscript,
  planned: new Set(
    getPlanningTermCourseCodes({ ...getInitialPlannerState(), courseStatuses: statuses, transcriptRecords: sampleTranscript }),
  ),
  manualCredit: new Set(extra.manualCredit ?? []),
  autoPlanned: new Set(extra.autoPlanned ?? []),
});

describe("course model on the UNT catalog with the sample transcript", () => {
  const profile = untProfile();
  const csCore = ["CSCE 1030", "CSCE 1040", "CSCE 2100", "MATH 1710", "MATH 1720"];

  test("each inferred state appears where the evidence puts it", () => {
    const model = buildCourseModel(profile, plan(sampleStatuses()));
    const get = (id: string) => model.rows.get(id)!;
    expect(get("CSCE 1040")).toMatchObject({ status: "done", override: false, meta: { kind: "grade", term: "Spring 2026", grade: "A" } });
    expect(get("CSCE 1030")).toMatchObject({ status: "covered", coveredBy: "CSCE 1040", meta: { kind: "via", id: "CSCE 1040" } });
    expect(get("ENGL 1320")).toMatchObject({ status: "taking", inPlan: false, meta: { kind: "text", text: "This term" } });
    expect(get("MATH 1720").status).toBe("available");
    expect(get("CSCE 2100").status).toBe("available");
    expect(model.hasTranscript).toBe(true);
  });

  test("done without a transcript row is the student's override", () => {
    const model = buildCourseModel(profile, plan({ ...sampleStatuses(), "CSCE 1010": "completed" }));
    expect(model.rows.get("CSCE 1010")).toMatchObject({ status: "done", override: true, meta: { kind: "text", text: "You marked this" } });
  });

  test("manual credit wins over a transcript row that says the course is in progress", () => {
    const model = buildCourseModel(profile, plan({ ...sampleStatuses(), "ENGL 1320": "completed" }, { manualCredit: ["ENGL 1320"] }));
    expect(model.rows.get("ENGL 1320")).toMatchObject({ status: "done", override: true, meta: { kind: "text", text: "You marked this" } });
  });

  test("planning a course the engine has not cleared is marked as an override", () => {
    const model = buildCourseModel(
      profile,
      plan({ ...sampleStatuses(), "MATH 2700": "inProgress", "MATH 1720": "inProgress" }, { autoPlanned: ["MATH 1720"] }),
    );
    expect(model.rows.get("MATH 2700")).toMatchObject({ status: "planned", inPlan: true, override: true });
    expect(model.rows.get("MATH 1720")).toMatchObject({ status: "planned", override: false, auto: true, meta: { kind: "text", text: "Spring 2027" } });
  });

  test("locked rows name the blocking course", () => {
    const model = buildCourseModel(profile, plan(sampleStatuses()));
    const locked = model.rows.get("MATH 2700")!;
    expect(locked.status).toBe("locked");
    expect(locked.meta.kind).toBe("needs");
  });

  test("Auto plans eligible core courses and leaves unclear ones to the student", () => {
    const statuses = sampleStatuses();
    const model = buildCourseModel(profile, plan(statuses));
    const outcome = computeAuto(model, statuses, csCore, 15);
    expect(outcome.planned).toEqual(["MATH 1720", "CSCE 2100"]);
    expect(outcome.needsCheck).toEqual([]);
    expect(outcome.filled).toEqual({ done: 3, taking: 1, covered: 1 });
    expect(outcome.changes).toEqual([
      { code: "MATH 1720", from: "notTaken", to: "inProgress" },
      { code: "CSCE 2100", from: "notTaken", to: "inProgress" },
    ]);
    expect(describeAuto(outcome, true, "Spring 2027")).toBe("Filled 5 courses from your transcript, 1 through prerequisites. Planned 2 for Spring 2027.");
  });

  test("Auto never unplans a course the student is taking now", () => {
    const statuses = sampleStatuses();
    const outcome = computeAuto(buildCourseModel(profile, plan(statuses)), statuses, csCore, 15);
    expect(outcome.unplanned).not.toContain("ENGL 1320");
  });

  test("Auto removes a planned course the transcript now covers, and respects the credit budget", () => {
    const statuses = { ...sampleStatuses(), "CSCE 1030": "inProgress" as const };
    const model = buildCourseModel(profile, plan(statuses));
    const outcome = computeAuto(model, statuses, csCore, 2);
    expect(outcome.unplanned).toEqual(["CSCE 1030"]);
    expect(outcome.planned).toEqual([]);
    expect(outcome.changes).toContainEqual({ code: "CSCE 1030", from: "inProgress", to: "notTaken" });
  });
});

describe("Auto undo", () => {
  const run: AutoTransaction = {
    id: "auto-1",
    at: "2026-10-13T12:00:00.000Z",
    major: "cs",
    changes: [
      { code: "MATH 1720", from: "notTaken", to: "inProgress" },
      { code: "CSCE 1030", from: "inProgress", to: "notTaken" },
    ],
    autoPlannedBefore: [],
    summary: "",
    needsCheck: [],
  };
  const after = { "MATH 1720": "inProgress", "CSCE 1030": "notTaken", "ENGL 1310": "completed" } as const;

  test("restores every status Auto changed and nothing else", () => {
    expect(undoBlocker(run, after, "cs")).toBeNull();
    expect(undoStatuses(run, after)).toEqual({ "MATH 1720": "notTaken", "CSCE 1030": "inProgress", "ENGL 1310": "completed" });
  });

  test("is refused after the student edits a course Auto touched", () => {
    expect(undoBlocker(run, { ...after, "MATH 1720": "notTaken" }, "cs")).toBe("MATH 1720 changed after Auto-fill.");
  });

  test("is refused after a major switch", () => {
    expect(undoBlocker(run, after, "math")).toBe("The major changed after Auto-fill.");
  });

  test("ignores edits to courses Auto did not touch", () => {
    expect(undoBlocker(run, { ...after, "HIST 2610": "inProgress" }, "cs")).toBeNull();
  });
});

describe("search", () => {
  const courses = [
    { id: "CSCE 1030", title: "Computer Science I" },
    { id: "CSCE 3110", title: "Data Structures and Algorithms" },
    { id: "MATH 1030", title: "Mathematics for Elementary Teachers" },
  ];

  test("a code beats a title word and a bare number matches the number", () => {
    expect(searchCatalog("csce1030", courses, []).courses.map((c) => c.id)).toEqual(["CSCE 1030"]);
    expect(searchCatalog("1030", courses, []).courses.map((c) => c.id)).toEqual(["CSCE 1030", "MATH 1030"]);
    expect(searchCatalog("data str", courses, []).courses.map((c) => c.id)).toEqual(["CSCE 3110"]);
    expect(searchCatalog("  ", courses, []).courses).toEqual([]);
    expect(searchCatalog("1030", courses, [], new Set(["MATH 1030"])).courses.map((c) => c.id)).toEqual(["MATH 1030", "CSCE 1030"]);
  });

  test("instructors are indexed by name with their courses, linked components and co-teachers included", () => {
    const person = (display: string | null) => ({ display, raw: display ?? "Staff" });
    const option = (courseCode: string, primary: string | null, linked: string | null = null) => ({
      courseCode,
      instructor: person(primary),
      components: [{ instructor: person(primary) }, ...(linked === null ? [] : [{ instructor: person(linked) }])],
    });
    const index = instructorIndex([
      option("CSCE 1030", "Beilei Jiang"),
      option("CSCE 2610", "Beilei Jiang; Ana Ruiz", "Lab Leader"),
      option("CSCE 2610", null), // staff: no display name
    ]);
    expect(index).toEqual([
      { name: "Ana Ruiz", courseIds: ["CSCE 2610"] },
      { name: "Beilei Jiang", courseIds: ["CSCE 1030", "CSCE 2610"] },
      { name: "Lab Leader", courseIds: ["CSCE 2610"] },
    ]);
    expect(searchCatalog("jiang", courses, index).instructors).toHaveLength(1);
  });
});

test("link-outs use UNT's RateMyProfessors school and the Faculty Information System search", () => {
  expect(untLinkOuts({ name: "Beilei Jiang" }, "CSCE 1030").map((link) => [link.key, link.href])).toEqual([
    ["rmp", "https://www.ratemyprofessors.com/search/professors/1252?q=Beilei%20Jiang"],
    ["syllabi", "https://facultyinfo.unt.edu/faculty-search?name=Beilei%20Jiang"],
    ["spot", "https://facultyinfo.unt.edu/faculty-search?name=Beilei%20Jiang&course=CSCE%201030"],
  ]);
});

test("the bundled prerequisite table matches courses/*.json", () => {
  const bundled = readFileSync(resolve(import.meta.dir, "../../src/lib/course-catalog/prerequisites.json"), "utf8");
  expect(bundled).toBe(renderPrerequisiteTable());
});

test("hour thresholds read as completed hours", () => {
  expect(text({ kind: "standing", minimum: "credits:45", source: "45 hours" })).toBe("45 completed hours");
  expect(text({ kind: "standing", minimum: "junior", source: "junior standing" })).toBe("junior standing");
});
