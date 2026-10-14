import { expect, test } from "bun:test";
import { recommendNextTerm } from "../../src/lib/pathing";
import { and, assess, consent, courseRef, pass, plan, require, row } from "./fixtures";

const ids = (term: { courseId: string }[]) => term.map((rec) => rec.courseId);

test("the plan ranks by unlocks, then the critical path, then plan order, then credits, then id", () => {
  const catalog = [
    row("hub", and(), 4),
    row("leafy", and(), 3),
    row("plain", and(), 3),
    row("tiny", and(), 1),
    row("c1", courseRef("hub")),
    row("c2", courseRef("hub")),
  ];
  const term = recommendNextTerm(require("hub", "leafy", "plain", "tiny", "c1", "c2"), assess(catalog), { creditTarget: 11 });
  expect(term.map((rec) => [rec.courseId, rec.credits])).toEqual([["hub", 4], ["leafy", 3], ["plain", 3], ["tiny", 1]]);
  expect(term[0]).toEqual({
    courseId: "hub",
    credits: 4,
    group: "Required",
    unlocksDirect: ["c1", "c2"],
    unlocksTransitive: ["c1", "c2"],
    remainingChain: 1,
    onCriticalPath: true,
    reason: "Required (Required); unlocks c1 and c2; on the longest remaining chain (2 terms)",
  });
  expect(term[1]!.reason).toBe("Required (Required)");
});

test("an earlier requirement in the plan goes before a later one", () => {
  const catalog = [row("a1"), row("z1")];
  const twoLists = plan({ kind: "all", name: "Major", courses: ["z1"] }, { kind: "all", name: "Other", courses: ["a1"] });
  expect(ids(recommendNextTerm(twoLists, assess(catalog), { creditTarget: 15 }))).toEqual(["z1", "a1"]);
});

test("a candidate that would overflow the target is skipped and packing continues", () => {
  const catalog = [row("big", and(), 5), row("small", and(), 3), row("tiny", and(), 2)];
  const requirements = require("big", "small", "tiny");
  expect(ids(recommendNextTerm(requirements, assess(catalog), { creditTarget: 7 }))).toEqual(["big", "tiny"]);
  expect(ids(recommendNextTerm(requirements, assess(catalog), { creditTarget: 10 }))).toEqual(["big", "small", "tiny"]);
});

test("all ranking ties resolve by course id", () => {
  const catalog = [row("beta"), row("alpha"), row("gamma")];
  expect(ids(recommendNextTerm(require("gamma", "beta", "alpha"), assess(catalog), { creditTarget: 15 }))).toEqual(["alpha", "beta", "gamma"]);
});

test("a zero target plans nothing, and a non-finite or negative one throws", () => {
  const result = assess([row("r1")]);
  expect(recommendNextTerm(require("r1"), result, { creditTarget: 0 })).toEqual([]);
  for (const creditTarget of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() => recommendNextTerm(require("r1"), result, { creditTarget })).toThrow("creditTarget must be finite and nonnegative.");
  }
});

test("only eligible courses on the remaining path are planned", () => {
  const catalog = [row("k0"), row("gate", courseRef("k0")), row("u1", and(courseRef("k0"), consent()))];
  const term = recommendNextTerm(require("gate", "u1"), assess(catalog, { transcript: [pass("k0")] }), { creditTarget: 15 });
  expect(ids(term)).toEqual(["gate"]);
});
