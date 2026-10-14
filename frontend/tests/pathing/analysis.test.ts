import { expect, test } from "bun:test";
import { recommendNextTerm, unlockAnalysis } from "../../src/lib/pathing";
import type { InferenceResult } from "../../src/lib/prereq";
import { and, assess, consent, courseRef, pass, row } from "./fixtures";

test("direct unlocks list unfinished dependents while transitive bridges through done courses", () => {
  const catalog = [
    row("k0"),
    row("f1", courseRef("k0")),
    row("f1b", courseRef("f1")),
    row("f2", courseRef("k0")),
    row("f3", and(courseRef("k0"), courseRef("m"))),
    row("m"),
  ];
  const result = assess(catalog, { transcript: [pass("k0"), pass("f1")], inProgress: ["f2"] });
  const analysis = unlockAnalysis({ coreCourseCodes: ["k0"] }, result);
  const k0 = analysis.courses.get("k0")!;
  // f1 is done and f2 is taking: neither may appear as an unlock, but the done f1
  // still bridges traversal to its own dependent f1b. f3 is locked, so it counts.
  expect(k0.unlocksDirect).toEqual(["f3"]);
  expect(k0.unlocksTransitive).toEqual(["f1b", "f3"]);
  expect(k0.remainingChain).toBe(0);
  expect(analysis.courses.get("m")!.unlocksDirect).toEqual(["f3"]);
  expect(analysis.courses.get("m")!.unlocksTransitive).toEqual(["f3"]);
  expect(analysis.universe).toEqual(["f1", "f1b", "f2", "f3", "k0", "m"]);
});

test("groups separate core, upstream prerequisites, and downstream advanced courses", () => {
  const catalog = [
    row("k0", courseRef("p")),
    row("p"),
    row("k1"),
    row("adv", courseRef("k1")),
    row("ghostfeed", courseRef("ghost 1")),
  ];
  const result = assess(catalog, {});
  const analysis = unlockAnalysis({ coreCourseCodes: ["k0", "k1"] }, result);
  expect(analysis.courses.get("k0")!.group).toBe("core");
  expect(analysis.courses.get("k1")!.group).toBe("core");
  expect(analysis.courses.get("p")!.group).toBe("prerequisite");
  expect(analysis.courses.get("adv")!.group).toBe("advanced");
  // A reference to an id the catalog does not carry creates no edge, so ghostfeed stays isolated.
  expect(analysis.universe).toEqual(["adv", "k0", "k1", "p"]);
  expect(analysis.courses.has("ghostfeed")).toBe(false);
  expect(analysis.courses.get("p")!.unlocksTransitive).toEqual(["k0"]);
});

test("core courses missing from the catalog are skipped with a warning", () => {
  const result = assess([row("k0")], {});
  const analysis = unlockAnalysis({ coreCourseCodes: ["k0", "ghost 9999"] }, result);
  expect(analysis.warnings).toEqual(["Core course ghost 9999 is not in the catalog and is skipped."]);
  expect(analysis.universe).toEqual(["k0"]);
});

test("the longest chain and the widest fanout can disagree", () => {
  const catalog = [
    row("k0", courseRef("p")),
    row("p"),
    row("f1", courseRef("k0")),
    row("f2", courseRef("k0")),
    row("f3", courseRef("k0")),
    row("f4", courseRef("k0")),
    row("f5", courseRef("k0")),
    row("c1", courseRef("k0")),
    row("c2", courseRef("c1")),
    row("k1"),
    row("g1", courseRef("k1")),
    row("g2", courseRef("k1")),
    row("h1", courseRef("k1")),
    row("h2", courseRef("h1")),
    row("h3", courseRef("h2")),
    row("h4", courseRef("h3")),
  ];
  const result = assess(catalog, { transcript: [pass("p")] });
  const major = { coreCourseCodes: ["k0", "k1"] };
  const analysis = unlockAnalysis(major, result);
  // k0 feeds five leaves plus a two-course chain; k1 feeds two leaves plus a four-course chain.
  expect(analysis.remainingCriticalPath).toBe(5);
  expect(analysis.courses.get("k0")!.remainingChain).toBe(3);
  expect(analysis.courses.get("k1")!.remainingChain).toBe(5);
  expect(analysis.courses.get("k0")!.unlocksTransitive).toHaveLength(7);
  expect(analysis.courses.get("k1")!.unlocksTransitive).toHaveLength(6);
  // Unlock breadth ranks k0 first even though k1 holds the longest chain.
  expect(recommendNextTerm(major, result, { creditTarget: 15 }).map((rec) => rec.courseId)).toEqual(["k0", "k1"]);
  expect(analysis.courses.get("k0")!.reasons).toEqual(["Unlocks 7 courses"]);
  expect(analysis.courses.get("k1")!.reasons).toEqual(["Unlocks 6 courses", "On the longest chain to graduating"]);
});

test("advisor-check and locked courses are never available and carry no reasons", () => {
  const catalog = [
    row("k0"),
    row("u1", and(courseRef("k0"), consent())),
    row("l1", and(courseRef("k0"), courseRef("absent"))),
  ];
  const result = assess(catalog, { transcript: [pass("k0")] });
  const analysis = unlockAnalysis({ coreCourseCodes: ["k0"] }, result);
  expect(analysis.courses.get("u1")!.status).toBe("unknown");
  expect(analysis.courses.get("u1")!.available).toBe(false);
  expect(analysis.courses.get("u1")!.reasons).toEqual([]);
  expect(analysis.courses.get("l1")!.status).toBe("locked");
  expect(analysis.courses.get("l1")!.available).toBe(false);
  expect(analysis.courses.get("l1")!.reasons).toEqual([]);
  expect(recommendNextTerm({ coreCourseCodes: ["k0"] }, result, { creditTarget: 15 })).toEqual([]);
});

test("cycle members are chain sinks and the walk terminates", () => {
  const catalog = [
    row("k0"),
    row("a", and(courseRef("k0"), courseRef("c"))),
    row("b", courseRef("a")),
    row("c", courseRef("b")),
    row("d", courseRef("c")),
  ];
  const result = assess(catalog, {});
  expect(result.cycles.length).toBeGreaterThan(0);
  const analysis = unlockAnalysis({ coreCourseCodes: ["k0"] }, result);
  expect(analysis.courses.get("a")!.remainingChain).toBe(0);
  expect(analysis.courses.get("b")!.remainingChain).toBe(0);
  expect(analysis.courses.get("c")!.remainingChain).toBe(0);
  expect(analysis.courses.get("d")!.remainingChain).toBe(1);
  // k0's only unfinished dependent is the cycle sink a, so its chain is 1 + 0.
  expect(analysis.courses.get("k0")!.remainingChain).toBe(1);
  expect(analysis.remainingCriticalPath).toBe(1);
});

test("a hand-built result that omits the cycles field still terminates with the same sinks", () => {
  const catalog = [
    row("k0"),
    row("a", and(courseRef("k0"), courseRef("c"))),
    row("b", courseRef("a")),
    row("c", courseRef("b")),
    row("d", courseRef("c")),
  ];
  const result = assess(catalog, {});
  const handBuilt: InferenceResult = { catalog, statuses: result.statuses, cycles: [], coverage: new Map() };
  const analysis = unlockAnalysis({ coreCourseCodes: ["k0"] }, handBuilt);
  expect(analysis.courses.get("a")!.remainingChain).toBe(0);
  expect(analysis.courses.get("k0")!.remainingChain).toBe(1);
  expect(analysis.remainingCriticalPath).toBe(1);
});

test("courses outside the major universe are ignored even when eligible", () => {
  const result = assess([row("k0"), row("zz")], { transcript: [pass("k0")] });
  const analysis = unlockAnalysis({ coreCourseCodes: ["k0"] }, result);
  expect(analysis.universe).toEqual(["k0"]);
  expect(analysis.courses.has("zz")).toBe(false);
  expect(recommendNextTerm({ coreCourseCodes: ["k0"] }, result, { creditTarget: 15 })).toEqual([]);
});
