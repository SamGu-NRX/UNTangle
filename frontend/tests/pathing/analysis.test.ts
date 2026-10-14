import { expect, test } from "bun:test";
import { recommendNextTerm, unlockAnalysis } from "../../src/lib/pathing";
import { and, assess, consent, corequisite, courseRef, minGrade, or, pass, require, row } from "./fixtures";

test("the universe is the required courses plus their downward prerequisite closure only", () => {
  const catalog = [
    row("r1", courseRef("p1")),
    row("p1", courseRef("p2")),
    row("p2"),
    // d1 needs e1: both stay OUT of the universe because nothing required needs them.
    row("d1", courseRef("e1")),
    row("e1"),
  ];
  const result = assess(catalog, {});
  const analysis = unlockAnalysis(require("r1"), result);
  expect(analysis.universe).toEqual(["p1", "p2", "r1"]);
  expect(analysis.courses.get("r1")!.group).toBe("required");
  expect(analysis.courses.get("p1")!.group).toBe("prerequisite");
  expect(analysis.courses.get("p2")!.group).toBe("prerequisite");
  expect(analysis.courses.has("d1")).toBe(false);
  expect(analysis.courses.has("e1")).toBe(false);
});

test("required courses missing from the catalog are skipped with a warning", () => {
  const result = assess([row("r1")], {});
  const analysis = unlockAnalysis(require("r1", "ghost 9999"), result);
  expect(analysis.warnings).toEqual(["Required course ghost 9999 is not in the catalog and is skipped."]);
  expect(analysis.universe).toEqual(["r1"]);
});

test("OR follows the shortest viable branch: C costs 2 through B, and a satisfied alternative stops unlocking", () => {
  // X and B have no prerequisites; A needs X; C needs A OR B.
  const catalog = [
    row("x"),
    row("b"),
    row("a", courseRef("x")),
    row("c", or(courseRef("a"), courseRef("b"))),
  ];
  const result = assess(catalog, {});
  const analysis = unlockAnalysis(require("c"), result);
  // Terms: X then A is two terms, B is one, so C's cheapest branch is B: 1 + 1 = 2, never 3.
  expect(analysis.courses.get("c")!.remainingChain).toBe(2);
  expect(analysis.courses.get("a")!.remainingChain).toBe(2);
  expect(analysis.courses.get("b")!.remainingChain).toBe(1);
  expect(analysis.remainingCriticalPath).toBe(2);
  // The cheapest branch needs B, not A: A does not list C as an unlock.
  expect(analysis.courses.get("b")!.unlocksDirect).toEqual(["c"]);
  expect(analysis.courses.get("a")!.unlocksDirect).toEqual([]);
  expect(analysis.courses.get("x")!.unlocksTransitive).toEqual(["a"]);

  // With B done the alternative is satisfied: C costs one term and A unlocks nothing.
  const resolved = assess(catalog, { transcript: [pass("b")] });
  const resolvedAnalysis = unlockAnalysis(require("c"), resolved);
  expect(resolvedAnalysis.courses.get("c")!.remainingChain).toBe(1);
  expect(resolvedAnalysis.courses.get("a")!.unlocksDirect).toEqual([]);
  expect(resolvedAnalysis.remainingCriticalPath).toBe(1);
});

test("plain corequisites add no term, while grade-wrapped corequisites must be completed first", () => {
  const catalog = [
    row("a"),
    row("b", corequisite(courseRef("a"))),
    row("b2", minGrade("C", corequisite(courseRef("a")))),
  ];
  const planned = assess(catalog, { inProgress: ["a"] });
  const plannedAnalysis = unlockAnalysis(require("b", "b2"), planned);
  // A is in progress: the plain corequisite of B costs nothing extra, so B is one term away.
  expect(plannedAnalysis.courses.get("b")!.remainingChain).toBe(1);
  // The grade-wrapped corequisite demands a COMPLETED A, which adds A's own term.
  expect(plannedAnalysis.courses.get("b2")!.remainingChain).toBe(2);
  expect(plannedAnalysis.remainingCriticalPath).toBe(2);

  // Nothing started: B still costs one term (co-enroll A alongside it), but the
  // grade-wrapped B2 must wait for A to finish first.
  const fresh = assess(catalog, {});
  const freshAnalysis = unlockAnalysis(require("b", "b2"), fresh);
  expect(freshAnalysis.courses.get("b")!.remainingChain).toBe(1);
  expect(freshAnalysis.courses.get("b2")!.remainingChain).toBe(2);
});

test("an unresolved cycle yields null chains, a null critical path, and a warning", () => {
  const catalog = [row("a", courseRef("b")), row("b", courseRef("a"))];
  const result = assess(catalog, {});
  const analysis = unlockAnalysis(require("a"), result);
  expect(analysis.courses.get("a")!.remainingChain).toBeNull();
  expect(analysis.courses.get("b")!.remainingChain).toBeNull();
  expect(analysis.remainingCriticalPath).toBeNull();
  expect(analysis.warnings).toEqual(["Unresolved prerequisite cycle blocks: a; remainingCriticalPath is null."]);
});

test("a cycle resolved by evidence is not blocked", () => {
  const catalog = [row("a", courseRef("b")), row("b", courseRef("a"))];
  const result = assess(catalog, { transcript: [pass("a")] });
  const analysis = unlockAnalysis(require("a"), result);
  expect(analysis.courses.get("a")!.remainingChain).toBe(0);
  expect(analysis.courses.get("b")!.remainingChain).toBe(1);
  expect(analysis.remainingCriticalPath).toBe(0);
  expect(analysis.warnings).toEqual([]);
});

test("a cycle avoided by an OR alternative does not block the required course", () => {
  const catalog = [
    row("a", courseRef("b")),
    row("b", courseRef("a")),
    row("d"),
    row("c", or(courseRef("a"), courseRef("d"))),
  ];
  const result = assess(catalog, {});
  const analysis = unlockAnalysis(require("c"), result);
  // The cheapest viable branch runs through D: C resolves in two terms even
  // though A and B stay cycle-blocked on their own.
  expect(analysis.courses.get("c")!.remainingChain).toBe(2);
  expect(analysis.remainingCriticalPath).toBe(2);
  expect(analysis.warnings).toEqual([]);
  expect(analysis.courses.get("a")!.remainingChain).toBeNull();
  // The chosen branch is D, so C lists no unlock on A. But B still needs A: the
  // cycle link itself is a real need, so A unlocks B directly.
  expect(analysis.courses.get("d")!.unlocksDirect).toEqual(["c"]);
  expect(analysis.courses.get("a")!.unlocksDirect).toEqual(["b"]);
  expect(analysis.courses.get("a")!.unlocksTransitive).toEqual(["b"]);
});

test("unlock lists count only needed courses, and satisfied requirements unlock nothing", () => {
  const catalog = [
    row("k0"),
    row("f1", courseRef("k0")),
    row("f1b", courseRef("f1")),
    row("f2", courseRef("k0")),
    row("f3", and(courseRef("k0"), courseRef("m"))),
    row("m"),
  ];
  const result = assess(catalog, { transcript: [pass("f1")], inProgress: ["f2"] });
  const analysis = unlockAnalysis(require("f1b", "f2", "f3"), result);
  // f3 still needs both k0 and m, so k0's only unfinished in-universe consumer
  // is f3. The done f1 and the taking f2 appear as no one's unlock, and the
  // done f1 does not bridge k0 to f1b: that requirement is already satisfied.
  expect(analysis.courses.get("k0")!.unlocksDirect).toEqual(["f3"]);
  expect(analysis.courses.get("k0")!.unlocksTransitive).toEqual(["f3"]);
  expect(analysis.courses.get("m")!.unlocksDirect).toEqual(["f3"]);
  expect(analysis.courses.get("f1")!.unlocksDirect).toEqual([]);
  expect(analysis.courses.get("f1")!.unlocksTransitive).toEqual([]);
  expect(analysis.courses.get("f2")!.unlocksDirect).toEqual([]);
});

test("AND runs in parallel terms: the deep chain and the wide fanout disagree", () => {
  const catalog = [
    row("d1", courseRef("d2")),
    row("d2", courseRef("d3")),
    row("d3"),
    row("fan", and(courseRef("g1"), courseRef("g2"), courseRef("g3"), courseRef("g4"), courseRef("g5"))),
    row("g1"),
    row("g2"),
    row("g3"),
    row("g4"),
    row("g5"),
  ];
  const result = assess(catalog, {});
  const analysis = unlockAnalysis(require("d1", "fan"), result);
  // One pass per term: the three-course chain is three terms, the five parallel
  // prerequisites of fan fit in a single term after nothing, so fan is two terms.
  expect(analysis.courses.get("d1")!.remainingChain).toBe(3);
  expect(analysis.courses.get("d2")!.remainingChain).toBe(2);
  expect(analysis.courses.get("d3")!.remainingChain).toBe(1);
  expect(analysis.courses.get("fan")!.remainingChain).toBe(2);
  expect(analysis.remainingCriticalPath).toBe(3);
  // Each g unlocks fan directly; the chain unlocks nothing.
  expect(analysis.courses.get("g1")!.unlocksDirect).toEqual(["fan"]);
  expect(analysis.courses.get("g1")!.unlocksTransitive).toEqual(["fan"]);
  expect(analysis.courses.get("d3")!.unlocksDirect).toEqual(["d2"]);
  expect(analysis.courses.get("d3")!.unlocksTransitive).toEqual(["d1", "d2"]);
});

test("advisor-check and locked courses are never available and carry no reasons", () => {
  const catalog = [
    row("k0"),
    row("u1", and(courseRef("k0"), consent())),
    row("l1", courseRef("absent")),
  ];
  const result = assess(catalog, { transcript: [pass("k0")] });
  const analysis = unlockAnalysis(require("k0", "u1", "l1"), result);
  expect(analysis.courses.get("u1")!.status).toBe("unknown");
  expect(analysis.courses.get("u1")!.available).toBe(false);
  expect(analysis.courses.get("u1")!.reasons).toEqual([]);
  expect(analysis.courses.get("l1")!.status).toBe("locked");
  expect(analysis.courses.get("l1")!.available).toBe(false);
  expect(analysis.courses.get("l1")!.reasons).toEqual([]);
  expect(recommendNextTerm(require("u1", "l1"), result, { creditTarget: 15 })).toEqual([]);
});

test("the credit target skips an overflowing candidate and keeps packing", () => {
  const catalog = [
    row("big", and(), 5),
    row("small", and(), 3),
    row("tiny", and(), 2),
    row("consumer", courseRef("big")),
  ];
  const result = assess(catalog, {});
  const requirements = require("big", "small", "tiny");
  // consumer needs big, so big carries the only transitive unlock and ranks first.
  expect(recommendNextTerm(requirements, result, { creditTarget: 7 }).map((rec) => rec.courseId)).toEqual(["big", "tiny"]);
  const full = recommendNextTerm(requirements, result, { creditTarget: 10 });
  expect(full.map((rec) => rec.courseId)).toEqual(["big", "small", "tiny"]);
  expect(full.reduce((total, rec) => total + rec.credits, 0)).toBe(10);
});

test("all ranking ties resolve by course id", () => {
  const catalog = [row("beta"), row("alpha"), row("gamma")];
  const result = assess(catalog, {});
  const plan = recommendNextTerm(require("gamma", "beta", "alpha"), result, { creditTarget: 15 });
  expect(plan.map((rec) => rec.courseId)).toEqual(["alpha", "beta", "gamma"]);
});

test("a zero credit target plans nothing, and a bad one throws", () => {
  const result = assess([row("r1")], {});
  expect(recommendNextTerm(require("r1"), result, { creditTarget: 0 })).toEqual([]);
  expect(() => recommendNextTerm(require("r1"), result, { creditTarget: -1 })).toThrow("creditTarget must be finite and nonnegative.");
  expect(() => recommendNextTerm(require("r1"), result, { creditTarget: Number.NaN })).toThrow("creditTarget must be finite and nonnegative.");
  expect(() => recommendNextTerm(require("r1"), result, { creditTarget: Number.POSITIVE_INFINITY })).toThrow("creditTarget must be finite and nonnegative.");
});

test("choose-N groups are echoed for reports but stay off the critical path", () => {
  const result = assess([row("r1"), row("e1"), row("e2")], {});
  const analysis = unlockAnalysis(
    {
      requiredCourseIds: ["r1"],
      chooseNGroups: [{ name: "Select 3 hours from:", options: ["e2", "e1"], choose: 1 }],
    },
    result,
  );
  expect(analysis.chooseNGroups).toEqual([{ name: "Select 3 hours from:", options: ["e1", "e2"], choose: 1 }]);
  expect(analysis.universe).toEqual(["r1"]);
  expect(analysis.remainingCriticalPath).toBe(1);
});
