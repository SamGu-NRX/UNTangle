import { expect, test } from "bun:test";
import { recommendNextTerm } from "../../src/lib/pathing";
import { assess, courseRef, pass, row } from "./fixtures";

test("greedy skips an overflowing candidate and keeps looking", () => {
  const catalog = [
    row("k0"),
    row("a1", courseRef("k0")),
    row("b1", courseRef("a1")),
    row("big", courseRef("k0"), 4),
    row("a2", courseRef("k0")),
    row("small", courseRef("k0"), 2),
  ];
  const result = assess(catalog, { transcript: [pass("k0")] });
  const major = { coreCourseCodes: ["k0"] };
  // Ranking: a1 (1 transitive unlock, chain 2), then big, a2, small by credits desc.
  // Under 9 credits the 3-credit a2 overflows after big and the 2-credit small still fits.
  expect(recommendNextTerm(major, result, { creditTarget: 9 }).map((rec) => rec.courseId)).toEqual(["a1", "big", "small"]);
  expect(recommendNextTerm(major, result, { creditTarget: 5 }).map((rec) => rec.courseId)).toEqual(["a1", "small"]);
  expect(recommendNextTerm(major, result, { creditTarget: 3 }).map((rec) => rec.courseId)).toEqual(["a1"]);
  // A target below the top pick's credits still reaches the lighter candidate.
  expect(recommendNextTerm(major, result, { creditTarget: 2 }).map((rec) => rec.courseId)).toEqual(["small"]);
});

test("all ties resolve by course id, never by insertion order", () => {
  const catalog = [row("k0"), row("t2", courseRef("k0")), row("t1", courseRef("k0"))];
  const result = assess(catalog, { transcript: [pass("k0")] });
  const plan = recommendNextTerm({ coreCourseCodes: ["k0"] }, result, { creditTarget: 9 });
  expect(plan.map((rec) => rec.courseId)).toEqual(["t1", "t2"]);
});

test("recommendations carry the analysis fields and reasons", () => {
  const catalog = [row("k0"), row("a1", courseRef("k0")), row("b1", courseRef("a1"))];
  const result = assess(catalog, { transcript: [pass("k0")] });
  const [rec] = recommendNextTerm({ coreCourseCodes: ["k0"] }, result, { creditTarget: 6 });
  expect(rec.courseId).toBe("a1");
  expect(rec.credits).toBe(3);
  expect(rec.group).toBe("advanced");
  expect(rec.unlocksDirect).toEqual(["b1"]);
  expect(rec.unlocksTransitive).toEqual(["b1"]);
  expect(rec.remainingChain).toBe(2);
  expect(rec.reasons).toEqual(["Unlocks 1 course", "On the longest chain to graduating"]);
});

test("creditTarget validation mirrors the engine and zero plans nothing", () => {
  const result = assess([row("k0")], {});
  const major = { coreCourseCodes: ["k0"] };
  for (const creditTarget of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() => recommendNextTerm(major, result, { creditTarget })).toThrow("creditTarget must be finite and nonnegative.");
  }
  expect(recommendNextTerm(major, result, { creditTarget: 0 })).toEqual([]);
});
