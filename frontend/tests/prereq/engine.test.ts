import { describe, expect, test } from "bun:test";
import { inferStatuses, detectCycles, untAdapter } from "../../src/lib/prereq";
import type { CatalogCourse, CourseStatus, Evidence, Prerequisite, SchoolAdapter } from "../../src/lib/prereq";

const course = (courseId: string): Prerequisite => ({ kind: "course", courseId, source: courseId });
const and = (...children: Prerequisite[]): Prerequisite => ({ kind: "and", children, source: "all" });
const or = (...children: Prerequisite[]): Prerequisite => ({ kind: "or", children, source: "either" });
const grade = (requirement: Prerequisite, minimum = "C"): Prerequisite => ({ kind: "minGrade", requirement, grade: minimum, source: "minimum grade" });
const coreq = (requirement: Prerequisite): Prerequisite => ({ kind: "corequisite", requirement, source: "concurrent" });
const row = (id: string, prerequisite = and()): CatalogCourse => ({ id, credits: 3, prerequisite });
const pass = (courseId: string, grade = "B") => ({ courseId, grade });
const assess = (catalog: CatalogCourse[], evidence: Evidence = {}) => inferStatuses(catalog, evidence, untAdapter);
const status = (result: ReturnType<typeof assess>, id: string) => result.statuses.get(id)?.status;

test("completion, enrollment, eligibility and locks have separate evidence", () => {
  const result = assess([row("a"), row("b"), row("c", course("b")), row("d")], { transcript: [pass("a")], inProgress: ["b"] });
  expect([...result.statuses.values()].map(row => row.status)).toEqual(["done", "taking", "locked", "eligible"]);
});

test("closure is transitive eligibility evidence without invented credit", () => {
  const catalog = [row("a"), row("b", course("a")), row("c", course("b")), row("d", course("a"))];
  const result = assess(catalog, { transcript: [pass("c")] });
  expect(status(result, "a")).toBe("eligible");
  expect(status(result, "b")).toBe("eligible");
  expect(status(result, "c")).toBe("done");
  expect(status(result, "d")).toBe("eligible");
  const reason = result.statuses.get("d")!.reason;
  expect(JSON.stringify(reason)).toContain('"kind":"closure"');
  expect(JSON.stringify(reason)).toContain('"courseId":"c"');
  expect(catalog).toHaveLength(4);
});

test("in-progress evidence does not close prerequisite chains", () => {
  const result = assess([row("a"), row("b", course("a")), row("c", course("a"))], { inProgress: ["b"] });
  expect(status(result, "c")).toBe("locked");
});

test("OR closure satisfies the expression without choosing an alternative", () => {
  const catalog = [row("a"), row("b"), row("c", or(course("a"), course("b"))), row("d", or(course("b"), course("a"))), row("e", course("a")), row("f", course("b"))];
  const result = assess(catalog, { transcript: [pass("c")] });
  expect(status(result, "d")).toBe("eligible");
  expect(status(result, "e")).toBe("locked");
  expect(status(result, "f")).toBe("locked");
});

test("closure can witness a minimum requirement without inventing a transcript grade", () => {
  const result = assess([row("a"), row("b", grade(course("a"))), row("c", grade(course("a"))), row("d", grade(course("a"), "B"))], { transcript: [pass("b")] });
  expect(status(result, "c")).toBe("eligible");
  expect(status(result, "d")).toBe("locked");
  expect(status(result, "a")).toBe("eligible");
});

test("a grade wrapper around an AND closes each mandatory course", () => {
  const result = assess([row("a"), row("b"), row("c", grade(and(course("a"), course("b")))), row("d", course("a")), row("e", grade(course("b")))], { transcript: [pass("c")] });
  expect(status(result, "d")).toBe("eligible");
  expect(status(result, "e")).toBe("eligible");
});

describe("grade thresholds", () => {
  for (const [actual, expected] of [["A", "eligible"], ["B", "eligible"], ["C", "eligible"], ["D", "locked"], ["F", "locked"], ["P", "unknown"], ["CR", "unknown"], ["mystery", "unknown"]] as const) test(actual, () => {
    const result = assess([row("a"), row("b", grade(course("a")))], { transcript: [pass("a", actual)] });
    expect(status(result, "b")).toBe(expected);
  });
});

test("a low direct grade outweighs closure", () => {
  for (const actual of ["D", "F"]) {
    const result = assess([row("a"), row("b", grade(course("a"))), row("c", grade(course("a")))], { transcript: [pass("b"), pass("a", actual)] });
    expect(status(result, "c")).toBe("locked");
  }
});

test("failed direct evidence stops transitive expansion of inferred completion", () => {
  const result = assess([row("a"), row("b", course("a")), row("c", course("b")), row("d", course("a"))], { transcript: [pass("c"), pass("b", "F")] });
  expect(status(result, "d")).toBe("locked");
});

test("nested minimum wrappers enforce both thresholds", () => {
  const result = assess([row("a"), row("b", grade(grade(course("a"), "C"), "B"))], { transcript: [pass("a", "C")] });
  expect(status(result, "b")).toBe("locked");
});

test("an unrecognized minimum never falls back to a plain course requirement", () => {
  const result = assess([row("a"), row("b", grade(course("a"), ""))], { transcript: [pass("a", "A")] });
  expect(status(result, "b")).toBe("unknown");
});

test("retakes use a qualifying passed attempt", () => {
  const result = assess([row("a"), row("b", grade(course("a")))], { transcript: [pass("a", "D"), pass("a", "A")] });
  expect(status(result, "b")).toBe("eligible");
});

test("corequisite accepts taking evidence but never infers its completion", () => {
  const catalog = [row("a"), row("b", coreq(course("a"))), row("c", course("a"))];
  expect(status(assess(catalog, { inProgress: ["a"] }), "b")).toBe("eligible");
  expect(status(assess(catalog, { transcript: [pass("b")] }), "c")).toBe("locked");
});

test("ungraded enrollment cannot assert a required minimum grade", () => {
  const result = assess([row("a"), row("b", coreq(grade(course("a"))))], { inProgress: ["a"] });
  expect(status(result, "b")).toBe("unknown");
});

test("standing is adapter-owned and missing standing needs review", () => {
  const catalog = [row("a", { kind: "standing", minimum: "junior", source: "junior standing" })];
  expect(status(assess(catalog), "a")).toBe("unknown");
  expect(status(assess(catalog, { standing: "sophomore" }), "a")).toBe("locked");
  expect(status(assess(catalog, { standing: "senior" }), "a")).toBe("unknown");
  expect(status(assess(catalog, { standing: "senior", earnedHours: 90 }), "a")).toBe("eligible");
});

test("explicit standing outranks a standing witness from completion history", () => {
  const requirement: Prerequisite = { kind: "standing", minimum: "senior", source: "senior standing" };
  const catalog = [row("a", requirement), row("b", and(requirement))];
  expect(status(assess(catalog, { transcript: [pass("a")], standing: "freshman" }), "b")).toBe("locked");
});

test("review-required course evidence blocks closure and its transitive expansion", () => {
  const catalog = [row("a"), row("b", course("a")), row("c", course("b")), row("d", course("a")), row("e", course("b"))];
  const result = assess(catalog, { transcript: [pass("c")], needsReview: ["b"] });
  expect(status(result, "d")).toBe("locked");
  expect(status(result, "e")).toBe("unknown");
});

test("consent and unknown clauses always carry advisor review", () => {
  for (const requirement of [ { kind: "unknown", source: "placement", detail: "unparsed" }, { kind: "consent", source: "consent of department", authority: "department" } ] satisfies Prerequisite[]) {
    const catalog = [row("a"), row("b", or(course("a"), requirement)), row("c", requirement), row("d", requirement)];
    const result = assess(catalog, { transcript: [pass("a"), pass("c")] });
    expect(status(result, "b")).toBe("unknown");
    expect(status(result, "d")).toBe("unknown");
    expect(result.statuses.get("b")?.reason.message).toContain("Check with advisor");
  }
});

test("each explicit status overrides transcript, enrollment, and eligibility", () => {
  const choices: CourseStatus[] = ["done", "taking", "eligible", "locked", "unknown"];
  for (const choice of choices) {
    const result = assess([row("a")], { transcript: [pass("a")], inProgress: ["a"], overrides: new Map([["a", { status: choice, reason: "Sam selected this status" }]]) });
    expect(status(result, "a")).toBe(choice);
    expect(result.statuses.get("a")?.reason).toMatchObject({ kind: "override", message: "Sam selected this status" });
  }
});

test("negative overrides prevent both direct and transitive closure", () => {
  const result = assess([row("a"), row("b", course("a")), row("c", course("b")), row("d", course("a"))], { transcript: [pass("c")], overrides: new Map([["b", { status: "locked", reason: "Not accepted" }]]) });
  expect(status(result, "b")).toBe("locked");
  expect(status(result, "d")).toBe("locked");
});

test("done override implies closure but does not invent a grade", () => {
  const result = assess([row("a"), row("b", course("a")), row("c", grade(course("b")))], { overrides: new Map([["b", { status: "done", reason: "Accepted credit" }]]) });
  expect(status(result, "a")).toBe("eligible");
  expect(status(result, "c")).toBe("unknown");
});

test("cycle detection includes every member of overlapping cycles", () => {
  const catalog = [row("a", and(course("b"), course("c"))), row("b", course("a")), row("c", course("b")), row("self", course("self"))];
  expect(detectCycles(catalog)).toEqual([["a", "b", "c"], ["self"]]);
  const result = assess(catalog);
  expect([...result.statuses.values()].every(row => row.status === "unknown")).toBe(true);
  expect(status(assess(catalog, { transcript: [pass("a")] }), "b")).toBe("eligible");
});

test("unknown external courses need evidence but are valid opaque ids", () => {
  const catalog = [row("__proto__", course("campus/course:001"))];
  expect(status(assess(catalog), "__proto__")).toBe("locked");
  expect(status(assess(catalog, { transcript: [pass("campus/course:001")] }), "__proto__")).toBe("eligible");
});

test("a second school's grade and standing policy requires no engine edits", () => {
  const adapter: SchoolAdapter = {
    isPassingGrade: value => Number(value) >= 50,
    meetsMinimumGrade: (value, minimum) => Number(value) >= Number(minimum),
    meetsStanding: (value, minimum) => Number(value) >= Number(minimum),
  };
  const result = inferStatuses([row("campus:pre"), row("campus:next", grade(course("campus:pre"), "70"))], { transcript: [pass("campus:pre", "80")] }, adapter);
  expect(result.statuses.get("campus:next")?.status).toBe("eligible");
});

test("duplicate ids, invalid credits, and unexplained overrides fail loudly", () => {
  expect(() => assess([row("a"), row("a")])).toThrow("Duplicate course id: a");
  expect(() => assess([{ ...row("a"), credits: NaN }])).toThrow("Invalid credits for a");
  expect(() => assess([row("a")], { overrides: new Map([["a", { status: "done", reason: " " }]]) })).toThrow("requires a reason");
});

test("review evidence cannot become an eligible retake automatically", () => {
  expect(status(assess([row("a")], { needsReview: ["a"] }), "a")).toBe("unknown");
});
