import { expect, test } from "bun:test";
import { inferStatuses, suggestNext, untAdapter } from "../../src/lib/prereq";
import { majors } from "../../src/lib/seed-data";
import type { CatalogCourse, Prerequisite } from "../../src/lib/prereq";

const reference = (courseId: string): Prerequisite => ({ kind: "course", courseId, source: courseId });
const row = (id: string, credits = 3, prerequisite: Prerequisite = { kind: "and", children: [], source: "" }): CatalogCourse => ({ id, credits, prerequisite });
const catalog = [row("a"), row("b"), row("c", 3, reference("a")), row("d", 3, reference("c")), row("e", 3, reference("b")), row("optional")];
const major = { coreCourseCodes: ["b", "a", "a"] };

test("eligible core courses rank by unfinished transitive downstream dependents", () => {
  const result = suggestNext(major, inferStatuses(catalog, {}, untAdapter), { maxCredits: 3 });
  expect(result.map(row => row.courseId)).toEqual(["a"]);
  expect(result[0].downstream).toEqual(["c", "d"]);
  expect(result[0].reasons.join(" ")).toContain("other requirements still apply");
});

test("catalog, major, and evidence order do not change default suggestions", () => {
  const first = inferStatuses(catalog, { transcript: [{ courseId: "outside", grade: "B" }, { courseId: "other", grade: "C" }] }, untAdapter);
  const second = inferStatuses([...catalog].reverse(), { transcript: [{ courseId: "other", grade: "C" }, { courseId: "outside", grade: "B" }] }, untAdapter);
  expect(suggestNext(major, first, { maxCredits: 6 })).toEqual(suggestNext({ coreCourseCodes: [...major.coreCourseCodes].reverse() }, second, { maxCredits: 6 }));
});

test("equal scores use opaque course id order", () => {
  const result = inferStatuses([row("z"), row("A"), row("a")], {}, untAdapter);
  expect(suggestNext({ coreCourseCodes: ["z", "a", "A"] }, result, { maxCredits: 9 }).map(row => row.courseId)).toEqual(["A", "a", "z"]);
});

test("selection skips a course that exceeds remaining credits", () => {
  const result = inferStatuses([row("a", 4), row("b", 2), row("c", 1)], {}, untAdapter);
  const selection = suggestNext({ coreCourseCodes: ["a", "b", "c"] }, result, { maxCredits: 3 });
  expect(selection.map(row => row.courseId)).toEqual(["b", "c"]);
  expect(selection.reduce((sum, row) => sum + row.credits, 0)).toBe(3);
});

test("scorer provides a deterministic interest ranking seam", () => {
  const result = inferStatuses(catalog, {}, untAdapter);
  const options = { maxCredits: 3, scorer: (course: CatalogCourse) => course.id === "b" ? 10 : 0 };
  expect(suggestNext(major, result, options).map(row => row.courseId)).toEqual(["b"]);
  expect(suggestNext(major, result, options)).toEqual(suggestNext(major, result, options));
});

test("done, taking, locked and unknown courses are excluded", () => {
  const result = inferStatuses(catalog, { transcript: [{ courseId: "a", grade: "A" }], inProgress: ["b"] }, untAdapter);
  expect(suggestNext(major, result, { maxCredits: 30 })).toEqual([]);
});

test("real seed majors satisfy the portable major contract", () => {
  const result = inferStatuses([row("CSCE 1030"), row("CSCE 1040", 3, reference("CSCE 1030")), row("MATH 1710")], {}, untAdapter);
  const cs = majors.find(major => major.id === "cs")!;
  expect(suggestNext(cs, result, { maxCredits: 6 }).map(row => row.courseId)).toEqual(["CSCE 1030", "MATH 1710"]);
});

test("invalid budgets and scorer results fail specifically", () => {
  const result = inferStatuses(catalog, {}, untAdapter);
  for (const maxCredits of [-1, NaN, Infinity]) expect(() => suggestNext(major, result, { maxCredits })).toThrow("maxCredits");
  expect(() => suggestNext(major, result, { maxCredits: 6, scorer: () => NaN })).toThrow("nonfinite value for a");
});
