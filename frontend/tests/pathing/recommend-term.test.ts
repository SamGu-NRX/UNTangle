import { expect, test } from "bun:test";
import { recommendNextTerm } from "../../src/lib/pathing";
import { and, assess, consent, courseRef, pass, require, row } from "./fixtures";

test("the plan ranks by transitive unlocks, then chain, then credits, then id, and respects the target", () => {
  const catalog = [
    row("hub", and(), 4),
    row("leafy", and(), 3),
    row("plain", and(), 3),
    row("tiny", and(), 1),
    // Required consumers keep hub's unlocks inside the universe; leafy, plain,
    // and tiny have no in-universe consumers at all.
    row("c1", courseRef("hub")),
    row("c2", courseRef("hub")),
  ];
  const result = assess(catalog, {});
  const requirements = require("hub", "leafy", "plain", "tiny", "c1", "c2");
  const plan = recommendNextTerm(requirements, result, { creditTarget: 11 });
  expect(plan.map((rec) => [rec.courseId, rec.credits])).toEqual([
    ["hub", 4],
    ["leafy", 3],
    ["plain", 3],
    ["tiny", 1],
  ]);
  expect(plan.reduce((total, rec) => total + rec.credits, 0)).toBe(11);
  // hub's locked required consumers are exactly its transitive unlocks; the
  // locked consumers themselves are never planned.
  expect(plan[0]!.unlocksTransitive).toEqual(["c1", "c2"]);
  expect(plan[1]!.unlocksTransitive).toEqual([]);
});

test("a candidate that would overflow the target is skipped and packing continues", () => {
  const catalog = [row("big", and(), 5), row("small", and(), 3), row("tiny", and(), 2)];
  const result = assess(catalog, {});
  const requirements = require("big", "small", "tiny");
  // No in-universe consumers exist, so every candidate ties on unlocks and
  // chain and credits order them: big, then small, then tiny. small would
  // overflow the 7-credit target, so the walk skips it and packs tiny,
  // landing exactly on 7.
  const plan = recommendNextTerm(requirements, result, { creditTarget: 7 });
  expect(plan.map((rec) => rec.courseId)).toEqual(["big", "tiny"]);
  expect(plan.reduce((total, rec) => total + rec.credits, 0)).toBe(7);
  // With more room, small fits and the plan fills to 10.
  expect(recommendNextTerm(requirements, result, { creditTarget: 10 }).map((rec) => rec.courseId)).toEqual([
    "big",
    "small",
    "tiny",
  ]);
});

test("all ranking ties resolve by course id", () => {
  const catalog = [row("beta"), row("alpha"), row("gamma")];
  const result = assess(catalog, {});
  const plan = recommendNextTerm(require("gamma", "beta", "alpha"), result, { creditTarget: 15 });
  expect(plan.map((rec) => rec.courseId)).toEqual(["alpha", "beta", "gamma"]);
});

test("a zero target plans nothing, and a non-finite or negative one throws", () => {
  const result = assess([row("r1")], {});
  expect(recommendNextTerm(require("r1"), result, { creditTarget: 0 })).toEqual([]);
  expect(() => recommendNextTerm(require("r1"), result, { creditTarget: -1 })).toThrow("creditTarget must be finite and nonnegative.");
  expect(() => recommendNextTerm(require("r1"), result, { creditTarget: Number.NaN })).toThrow("creditTarget must be finite and nonnegative.");
  expect(() => recommendNextTerm(require("r1"), result, { creditTarget: Number.POSITIVE_INFINITY })).toThrow("creditTarget must be finite and nonnegative.");
});

test("only eligible universe courses are planned; unknown and locked never are", () => {
  const catalog = [
    row("k0"),
    row("gate", courseRef("k0")),
    // The advisor-check clause surfaces as unknown, never as takeable.
    row("u1", and(courseRef("k0"), consent())),
  ];
  const result = assess(catalog, { transcript: [pass("k0")] });
  const plan = recommendNextTerm(require("gate", "u1"), result, { creditTarget: 15 });
  expect(plan.map((rec) => rec.courseId)).toEqual(["gate"]);
});
