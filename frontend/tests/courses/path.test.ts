import { describe, expect, test } from "bun:test";
import type { RowStatus } from "@/components/courses/model/course-model";
import { buildCourseModel } from "@/components/courses/model/course-model";
import { isMet, pathStops, ruleVerdict, withoutSentence } from "@/components/courses/model/path";
import { sampleTranscript } from "@/components/courses/model/sample-transcript";
import { untProfile } from "@/components/courses/school";
import type { TranscriptCourseRecord } from "@/lib/types";
import type { RuleNode } from "@/components/courses/model/rules";

const course = (id: string, grade?: string): RuleNode => ({ kind: "course", id, ...(grade ? { grade } : {}) });
const rows = (statuses: Record<string, RowStatus>) => new Map(Object.entries(statuses).map(([id, status]) => [id, { status }]));

describe("pathStops", () => {
  test("alternatives are one choice, met by the course the student has, never a sequence", () => {
    const rule: RuleNode = { kind: "any", items: [course("A 1"), course("B 2"), course("C 3")] };
    expect(pathStops(rule, rows({ "C 3": "done" }))).toEqual([{ kind: "choice", ids: ["A 1", "B 2", "C 3"], options: 3, chosen: "C 3", state: "done" }]);
    expect(pathStops(rule, rows({}))).toEqual([{ kind: "choice", ids: ["A 1", "B 2", "C 3"], options: 3, chosen: null, state: "todo" }]);
  });

  test("a course in progress is underway, not met", () => {
    const stops = pathStops({ kind: "all", items: [course("A 1", "C"), course("B 2")] }, rows({ "A 1": "taking", "B 2": "done" }));
    expect(stops).toEqual([
      { kind: "course", id: "A 1", state: "taking" },
      { kind: "course", id: "B 2", state: "done" },
    ]);
    expect(stops.map((stop) => isMet(stop.state))).toEqual([false, true]);
    expect(isMet("covered")).toBe(true);
    expect(isMet("planned")).toBe(false);
  });

  test("a choice prefers a met course over one underway, and one underway over a planned one", () => {
    const rule: RuleNode = { kind: "any", items: [course("A 1"), course("B 2"), course("C 3")] };
    expect(pathStops(rule, rows({ "A 1": "planned", "B 2": "taking" }))[0]).toMatchObject({ chosen: "B 2", state: "taking" });
    expect(pathStops(rule, rows({ "A 1": "planned", "B 2": "taking", "C 3": "covered" }))[0]).toMatchObject({ chosen: "C 3", state: "covered" });
  });

  test("an alternative that is itself a group is met only when all of it is", () => {
    const rule: RuleNode = { kind: "any", items: [{ kind: "all", items: [course("A 1"), course("B 2")] }, course("C 3")] };
    expect(pathStops(rule, rows({ "A 1": "done" }))).toEqual([{ kind: "choice", ids: ["A 1", "B 2", "C 3"], options: 2, chosen: null, state: "todo" }]);
    // The group meets it, but it isn't one course, so nothing is named as the one taken.
    expect(pathStops(rule, rows({ "A 1": "done", "B 2": "done" }))[0]).toMatchObject({ chosen: null, state: "done" });
  });

  test("each requirement of an AND is its own stop; standing, consent and unread text are left to the rule line", () => {
    const rule: RuleNode = {
      kind: "all",
      items: [course("A 1"), { kind: "any", items: [course("B 2"), course("C 3")] }, { kind: "standing", text: "junior standing" }, { kind: "unparsed", text: "x" }],
    };
    expect(pathStops(rule, rows({ "C 3": "done" }))).toEqual([
      { kind: "course", id: "A 1", state: "todo" },
      { kind: "choice", ids: ["B 2", "C 3"], options: 2, chosen: "C 3", state: "done" },
    ]);
    expect(pathStops(null, rows({}))).toEqual([]);
  });
});

describe("the catalog-rule line and the path agree", () => {
  const profile = untProfile();
  const record = (code: string, status: "completed" | "inProgress", grade: string): TranscriptCourseRecord => ({
    ...sampleTranscript[0],
    id: `rec-${code}`,
    code,
    grade,
    appliedStatus: status,
    sourceKind: status === "inProgress" ? "current" : "unt",
  });
  const modelOf = (records: TranscriptCourseRecord[]) =>
    buildCourseModel(profile, { statuses: {}, transcript: records, planned: new Set(), manualCredit: new Set(), autoPlanned: new Set() });

  test("taking a course without its prerequisites: the line says so and no path stop is met", () => {
    const model = modelOf([record("CSCE 1040", "inProgress", "IP")]);
    const row = model.rows.get("CSCE 1040")!;
    expect(row.status).toBe("taking");
    const verdict = ruleVerdict(row, model);
    expect(verdict).toEqual({ kind: "without", missing: "CSCE 1030 and 1 more" });
    if (verdict.kind !== "without") throw new Error(verdict.kind);
    expect(withoutSentence(verdict)).toBe("You're taking it without CSCE 1030 and 1 more on record.");
    expect(pathStops(row.rule, model.rows).map((stop) => isMet(stop.state))).toEqual([false, false]);
  });

  test("taking a course whose prerequisites are on record: the line says it's met and every stop is met", () => {
    const model = modelOf([record("CSCE 1030", "completed", "B"), record("MATH 1710", "completed", "B"), record("CSCE 1040", "inProgress", "IP")]);
    const row = model.rows.get("CSCE 1040")!;
    expect(ruleVerdict(row, model)).toEqual({ kind: "meets" });
    expect(pathStops(row.rule, model.rows).every((stop) => isMet(stop.state))).toBe(true);
  });

  test("credit makes no claim about the rule, since passing it covers some of its own prerequisites", () => {
    const model = modelOf([record("CSCE 1040", "completed", "A")]);
    const row = model.rows.get("CSCE 1040")!;
    expect(ruleVerdict(row, model)).toEqual({ kind: "credit" });
    // CSCE 1030 is proven by passing CSCE 1040, so a "without CSCE 1030" line would contradict this stop.
    expect(pathStops(row.rule, model.rows)[0]).toEqual({ kind: "course", id: "CSCE 1030", state: "covered" });
  });
});
