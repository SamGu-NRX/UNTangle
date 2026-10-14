import { expect, test } from "bun:test";
import { pathingScorer } from "../../src/lib/pathing";
import { suggestNext } from "../../src/lib/prereq";
import { assess, courseRef, pass, row } from "./fixtures";

const catalog = [
  row("k0", courseRef("p")),
  row("p"),
  row("a1", courseRef("k0")),
  row("b1", courseRef("a1")),
  row("b2", courseRef("a1")),
  row("a2", courseRef("k0")),
];
const major = { coreCourseCodes: ["k0"] };

test("the scorer is finite for every universe course and zero for finished courses", () => {
  const result = assess(catalog, { transcript: [pass("p")] });
  const scorer = pathingScorer(major, result);
  for (const course of result.catalog) {
    const assessment = result.statuses.get(course.id)!;
    expect(Number.isFinite(scorer(course, assessment))).toBe(true);
  }
  const courseOf = (id: string) => result.catalog.find((course) => course.id === id)!;
  expect(scorer(courseOf("p"), result.statuses.get("p")!)).toBe(0);
  // a1 unlocks two unfinished courses but is not on the longest chain (k0 is): 2, no bonus.
  expect(scorer(courseOf("a1"), result.statuses.get("a1")!)).toBe(2);
  // k0 unlocks four unfinished courses and sits on the longest chain: 4 + 1.
  expect(scorer(courseOf("k0"), result.statuses.get("k0")!)).toBe(5);
  expect(scorer(courseOf("a2"), result.statuses.get("a2")!)).toBe(0);
});

test("the scorer composes with suggestNext deterministically", () => {
  const result = assess(catalog, { transcript: [pass("p")] });
  const scorer = pathingScorer(major, result);
  const first = suggestNext(major, result, { maxCredits: 6, scorer });
  const second = suggestNext(major, result, { maxCredits: 6, scorer });
  expect(second).toEqual(first);
  // Only the core course is a candidate; downstream 4 + pathing score 5.
  expect(first).toHaveLength(1);
  expect(first[0].courseId).toBe("k0");
  expect(first[0].score).toBe(9);
});
