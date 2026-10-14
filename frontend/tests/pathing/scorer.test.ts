import { expect, test } from "bun:test";
import { pathingScorer, unlockAnalysis } from "../../src/lib/pathing";
import { suggestNext } from "../../src/lib/prereq";
import type { Major } from "../../src/lib/prereq";
import { assess, consent, courseRef, pass, require, row } from "./fixtures";

test("one more transitive unlock outweighs the longest-chain bonus", () => {
  // deep sits on the longest chain (three terms through its prerequisites) and
  // therefore unlocks nothing; wide carries one in-universe consumer.
  const catalog = [
    row("deep", courseRef("d1")),
    row("d1", courseRef("d2")),
    row("d2"),
    row("wide"),
    row("wideconsumer", courseRef("wide")),
  ];
  const result = assess(catalog, {});
  const requirements = require("deep", "wide", "wideconsumer");
  const analysis = unlockAnalysis(requirements, result);
  expect(analysis.remainingCriticalPath).toBe(3);
  expect(analysis.courses.get("deep")!.remainingChain).toBe(3);
  expect(analysis.courses.get("wide")!.remainingChain).toBe(1);
  expect(analysis.courses.get("wide")!.unlocksTransitive).toEqual(["wideconsumer"]);
  const scorer = pathingScorer(requirements, result);
  const byId = new Map(result.catalog.map((course) => [course.id, course]));
  expect(scorer(byId.get("wide")!, result.statuses.get("wide")!)).toBe(1);
  expect(scorer(byId.get("deep")!, result.statuses.get("deep")!)).toBe(0.5);
  // One more unlock (1) beats the on-chain bonus (0.5): the wider course ranks higher.
  expect(scorer(byId.get("wide")!, result.statuses.get("wide")!)).toBeGreaterThan(
    scorer(byId.get("deep")!, result.statuses.get("deep")!),
  );
});

test("the scorer is finite for every universe course, including cycle-blocked ones", () => {
  const catalog = [
    row("r1", courseRef("p1")),
    row("p1", consent()),
    row("cycleA", courseRef("cycleB")),
    row("cycleB", courseRef("cycleA")),
  ];
  const result = assess(catalog, { transcript: [pass("r1")] });
  const requirements = require("r1", "cycleA", "cycleB");
  const analysis = unlockAnalysis(requirements, result);
  expect(analysis.remainingCriticalPath).toBeNull();
  const scorer = pathingScorer(requirements, result);
  const byId = new Map(result.catalog.map((course) => [course.id, course]));
  for (const id of analysis.universe) {
    const assessment = result.statuses.get(id)!;
    expect(Number.isFinite(scorer(byId.get(id)!, assessment))).toBe(true);
  }
  // Finished courses score zero regardless of any unlock evidence.
  expect(scorer(byId.get("r1")!, result.statuses.get("r1")!)).toBe(0);
});

test("the scorer composes with suggestNext deterministically", () => {
  const catalog = [row("s1"), row("s2"), row("consumer", courseRef("s1"))];
  const result = assess(catalog, {});
  const requirements = require("s1", "s2", "consumer");
  const major: Major = { coreCourseCodes: ["s1", "s2"] };
  const first = suggestNext(major, result, { maxCredits: 12, scorer: pathingScorer(requirements, result) });
  const second = suggestNext(major, result, { maxCredits: 12, scorer: pathingScorer(requirements, result) });
  // s1 unlocks the required consumer, s2 unlocks nothing: same inputs, same output, twice.
  expect(first.map((suggestion) => suggestion.courseId)).toEqual(["s1", "s2"]);
  expect(first).toEqual(second);
});
