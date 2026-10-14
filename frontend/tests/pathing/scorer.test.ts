import { expect, test } from "bun:test";
import { pathingScorer, recommendNextTerm, unlockAnalysis } from "../../src/lib/pathing";
import { suggestNext } from "../../src/lib/prereq";
import type { Major } from "../../src/lib/prereq";
import { assess, consent, corequisite, courseRef, pass, require, row } from "./fixtures";

test("defect 6: three unlocks off the longest chain beat two unlocks on it", () => {
  // s starts the longest chain (s, m, top: 3 terms) and unlocks 2 courses.
  // w unlocks 3 required courses, each one term after it.
  const catalog = [
    row("s"),
    row("m", courseRef("s")),
    row("top", courseRef("m")),
    row("w"),
    row("w1", courseRef("w")),
    row("w2", courseRef("w")),
    row("w3", courseRef("w")),
  ];
  const result = assess(catalog);
  const requirements = require("top", "w1", "w2", "w3");
  const analysis = unlockAnalysis(requirements, result);
  expect(analysis.remainingCriticalPath).toBe(3);
  expect(analysis.courses.get("s")!.unlocksTransitive).toEqual(["m", "top"]);
  expect(analysis.courses.get("s")!.onCriticalPath).toBe(true);
  expect(analysis.courses.get("w")!.unlocksTransitive).toEqual(["w1", "w2", "w3"]);
  expect(analysis.courses.get("w")!.onCriticalPath).toBe(false);

  const scorer = pathingScorer(requirements, result);
  const score = (id: string) => scorer(result.catalog.find((course) => course.id === id)!, result.statuses.get(id)!);
  // Scores are scaled by 2 * (catalog size + 1) = 16, so 3 unlocks and 2.5 become 48 and 40.
  expect(score("w")).toBe(48);
  expect(score("s")).toBe(40);
  expect(recommendNextTerm(requirements, result, { creditTarget: 6 }).map((rec) => rec.courseId)).toEqual(["w", "s"]);
});

test("with equal unlocks, the course on the longest chain goes first", () => {
  // Each of a and z unlocks one course. a1 only needs a alongside it (one
  // term), while z1 must follow z (two terms), so only z is critical.
  const catalog = [row("a"), row("a1", corequisite(courseRef("a"))), row("z"), row("z1", courseRef("z"))];
  const result = assess(catalog);
  const analysis = unlockAnalysis(require("a1", "z1"), result);
  expect(analysis.courses.get("a")!.unlocksTransitive).toEqual(["a1"]);
  expect(analysis.courses.get("a")!.onCriticalPath).toBe(false);
  expect(analysis.courses.get("z")!.onCriticalPath).toBe(true);
  expect(recommendNextTerm(require("a1", "z1"), result, { creditTarget: 3 }).map((rec) => rec.courseId)).toEqual(["z"]);
});

test("suggestNext keeps the plan's order even when catalog-wide dependents favor the other course", () => {
  // As above, plus three catalog courses that need s but are in no requirement.
  const catalog = [
    row("s"), row("m", courseRef("s")), row("top", courseRef("m")),
    row("w"), row("w1", courseRef("w")), row("w2", courseRef("w")), row("w3", courseRef("w")),
    row("x1", courseRef("s")), row("x2", courseRef("s")), row("x3", courseRef("s")),
  ];
  const result = assess(catalog);
  const requirements = require("top", "w1", "w2", "w3");
  const major: Major = { coreCourseCodes: ["s", "w"] };
  expect(suggestNext(major, result, { maxCredits: 3 }).map((suggestion) => suggestion.courseId)).toEqual(["s"]);
  expect(suggestNext(major, result, { maxCredits: 3, scorer: pathingScorer(requirements, result) }).map((suggestion) => suggestion.courseId)).toEqual(["w"]);
});

test("the scorer is finite for every universe course, including cycle-blocked ones", () => {
  const catalog = [row("r1", courseRef("p1")), row("p1", consent()), row("cycleA", courseRef("cycleB")), row("cycleB", courseRef("cycleA"))];
  const result = assess(catalog, { transcript: [pass("r1")] });
  const requirements = require("r1", "cycleA", "cycleB");
  const analysis = unlockAnalysis(requirements, result);
  expect(analysis.remainingCriticalPath).toBeNull();
  const scorer = pathingScorer(requirements, result);
  for (const course of result.catalog) {
    expect(Number.isFinite(scorer(course, result.statuses.get(course.id)!))).toBe(true);
  }
  expect(scorer(result.catalog.find((course) => course.id === "r1")!, result.statuses.get("r1")!)).toBe(0);
});

test("the scorer composes with suggestNext deterministically", () => {
  const catalog = [row("s1"), row("s2"), row("consumer", courseRef("s1"))];
  const result = assess(catalog);
  const requirements = require("s1", "s2", "consumer");
  const major: Major = { coreCourseCodes: ["s1", "s2"] };
  const first = suggestNext(major, result, { maxCredits: 12, scorer: pathingScorer(requirements, result) });
  const second = suggestNext(major, result, { maxCredits: 12, scorer: pathingScorer(requirements, result) });
  expect(first.map((suggestion) => suggestion.courseId)).toEqual(["s1", "s2"]);
  expect(first).toEqual(second);
});
