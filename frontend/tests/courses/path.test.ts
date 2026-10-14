import { describe, expect, test } from "bun:test";
import type { RowStatus } from "@/components/courses/model/course-model";
import { isMet, pathStops } from "@/components/courses/model/path";
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
