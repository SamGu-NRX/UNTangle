import { expect, test } from "bun:test";
import { recommendNextTerm, unlockAnalysis } from "../../src/lib/pathing";
import { and, assess, consent, corequisite, courseRef, equivalent, minGrade, or, pass, require, row } from "./fixtures";

const ids = (plan: { courseId: string }[]) => plan.map((course) => course.courseId);

test("defect 1: the universe is the listed courses plus their downward prerequisite closure only", () => {
  const catalog = [
    row("r1", courseRef("p1")),
    row("p1", courseRef("p2")),
    row("p2"),
    // d1 needs e1, but nothing listed needs either, so both stay out.
    row("d1", courseRef("e1")),
    row("e1"),
  ];
  const analysis = unlockAnalysis(require("r1"), assess(catalog));
  expect(analysis.universe).toEqual(["p1", "p2", "r1"]);
  expect(analysis.courses.get("r1")!.group).toBe("Required");
  expect(analysis.courses.get("p1")!.group).toBeNull();
  expect(analysis.courses.has("d1")).toBe(false);
  expect(analysis.courses.has("e1")).toBe(false);
});

test("listed courses missing from the catalog are warned about and keep their requirement unmet", () => {
  const analysis = unlockAnalysis(require("r1", "ghost 9999"), assess([row("r1")], { transcript: [pass("r1")] }));
  expect(analysis.warnings).toEqual(["Not in the catalog, so never counted as done and left out of paths: ghost 9999."]);
  expect(analysis.universe).toEqual(["r1"]);
  expect(analysis.requirements).toEqual([
    // ghost 9999 can never be confirmed, so the 0 terms cover only what the catalog can measure.
    { name: "Required", kind: "all", met: false, done: 1, target: 2, unit: "courses", remainingTerms: 0, tracked: false, branch: null },
  ]);
});

test("defect 2: an OR follows its shortest branch, and a satisfied alternative unlocks nothing", () => {
  // X and B have no prerequisites; A needs X; C needs A or B.
  const catalog = [row("x"), row("b"), row("a", courseRef("x")), row("c", or(courseRef("a"), courseRef("b")))];
  const fresh = unlockAnalysis(require("c"), assess(catalog));
  // B then C is two terms; X, A, C would be three.
  expect(fresh.courses.get("c")!.remainingChain).toBe(2);
  expect(fresh.courses.get("a")!.remainingChain).toBe(2);
  expect(fresh.courses.get("b")!.remainingChain).toBe(1);
  expect(fresh.remainingCriticalPath).toBe(2);
  expect(fresh.courses.get("b")!.unlocksDirect).toEqual(["c"]);
  // A is off the shortest route, so neither A nor X opens anything.
  expect(fresh.courses.get("a")!.unlocksDirect).toEqual([]);
  expect(fresh.courses.get("a")!.onRemainingPath).toBe(false);
  expect(fresh.courses.get("x")!.unlocksTransitive).toEqual([]);
  expect(ids(recommendNextTerm(require("c"), assess(catalog), { creditTarget: 15 }))).toEqual(["b"]);

  const withB = assess(catalog, { transcript: [pass("b")] });
  const resolved = unlockAnalysis(require("c"), withB);
  expect(resolved.courses.get("c")!.remainingChain).toBe(1);
  expect(resolved.courses.get("a")!.unlocksDirect).toEqual([]);
  expect(resolved.courses.get("a")!.onRemainingPath).toBe(false);
  expect(resolved.remainingCriticalPath).toBe(1);
  expect(ids(recommendNextTerm(require("c"), withB, { creditTarget: 15 }))).toEqual(["c"]);
});

test("defect 3: a corequisite adds no term, but its own prerequisites still count", () => {
  // B needs corequisite A; A needs D; D has no prerequisites. D, then A with B.
  const catalog = [row("d"), row("a", courseRef("d")), row("b", corequisite(courseRef("a")))];
  const analysis = unlockAnalysis(require("b"), assess(catalog));
  expect(analysis.courses.get("d")!.remainingChain).toBe(1);
  expect(analysis.courses.get("a")!.remainingChain).toBe(2);
  expect(analysis.courses.get("b")!.remainingChain).toBe(2);
  expect(analysis.remainingCriticalPath).toBe(2);
  expect(analysis.courses.get("d")!.unlocksDirect).toEqual(["a"]);
  expect(analysis.courses.get("d")!.unlocksTransitive).toEqual(["a", "b"]);
  expect(analysis.courses.get("a")!.unlocksDirect).toEqual(["b"]);
  expect(analysis.courses.get("d")!.onCriticalPath).toBe(true);
});

test("defect 3: with corequisite A planned and free of prerequisites, B is one term away", () => {
  const catalog = [row("a"), row("b", corequisite(courseRef("a")))];
  const planned = assess(catalog, { planned: ["a"] });
  expect(planned.statuses.get("b")!.status).toBe("eligible");
  expect(unlockAnalysis(require("b"), planned).courses.get("b")!.remainingChain).toBe(1);
  // Unplanned, the engine locks B, but the path still takes A and B together.
  const unplanned = assess(catalog);
  expect(unplanned.statuses.get("b")!.status).toBe("locked");
  expect(unlockAnalysis(require("b"), unplanned).courses.get("b")!.remainingChain).toBe(1);
});

test("defect 3: a grade-wrapped corequisite needs a finished grade, so it costs a full term", () => {
  const catalog = [
    row("a"),
    row("b", corequisite(courseRef("a"))),
    row("b2", minGrade("C", corequisite(courseRef("a")))),
    row("b3", corequisite(minGrade("C", courseRef("a")))),
  ];
  const fresh = unlockAnalysis(require("b", "b2", "b3"), assess(catalog));
  expect(fresh.courses.get("b")!.remainingChain).toBe(1);
  expect(fresh.courses.get("b2")!.remainingChain).toBe(2);
  expect(fresh.courses.get("b3")!.remainingChain).toBe(2);
  // A in progress finishes this term, so all three can follow next term. The
  // engine cannot know A's grade yet, so the grade-wrapped two stay unknown.
  const taking = assess(catalog, { inProgress: ["a"] });
  const analysis = unlockAnalysis(require("b", "b2", "b3"), taking);
  expect([analysis.courses.get("b")!.remainingChain, analysis.courses.get("b2")!.remainingChain, analysis.courses.get("b3")!.remainingChain]).toEqual([1, 1, 1]);
  expect([taking.statuses.get("b")!.status, taking.statuses.get("b2")!.status, taking.statuses.get("b3")!.status]).toEqual(["eligible", "unknown", "unknown"]);
});

test("defect 4: an unresolved cycle gives a null path and a warning, never 0", () => {
  const catalog = [row("a", courseRef("b")), row("b", courseRef("a"))];
  const result = assess(catalog);
  const analysis = unlockAnalysis(require("a"), result);
  expect(analysis.courses.get("a")!.remainingChain).toBeNull();
  expect(analysis.courses.get("b")!.remainingChain).toBeNull();
  expect(analysis.remainingCriticalPath).toBeNull();
  expect(analysis.requirements[0]!.remainingTerms).toBeNull();
  expect(analysis.warnings).toEqual(["No prerequisite route to a: an unbroken prerequisite cycle or an empty list of alternatives blocks it."]);
  expect(recommendNextTerm(require("a"), result, { creditTarget: 15 })).toEqual([]);
});

test("defect 4: a cycle that an OR alternative breaks comes out as C, B, A, Z in 4 terms", () => {
  // Required B and Z; A needs B; B needs A or C; C has nothing; Z needs A.
  const catalog = [row("a", courseRef("b")), row("b", or(courseRef("a"), courseRef("c"))), row("c"), row("z", courseRef("a"))];
  const result = assess(catalog);
  const analysis = unlockAnalysis(require("b", "z"), result);
  const chain = (id: string) => analysis.courses.get(id)!.remainingChain;
  expect([chain("c"), chain("b"), chain("a"), chain("z")]).toEqual([1, 2, 3, 4]);
  expect(analysis.remainingCriticalPath).toBe(4);
  expect(analysis.warnings).toEqual([]);
  expect(analysis.courses.get("c")!.unlocksTransitive).toEqual(["a", "b", "z"]);
  expect(analysis.courses.get("c")!.onCriticalPath).toBe(true);
  expect(ids(recommendNextTerm(require("b", "z"), result, { creditTarget: 15 }))).toEqual(["c"]);
});

test("defect 4: the same broken cycle entered from the other side gives the same terms", () => {
  // Mirror image: A needs B or C, B needs A, Z needs B. Id order now reaches
  // the OR first, which is where the old memoized walk froze a null.
  const catalog = [row("a", or(courseRef("b"), courseRef("c"))), row("b", courseRef("a")), row("c"), row("z", courseRef("b"))];
  const analysis = unlockAnalysis(require("a", "z"), assess(catalog));
  const chain = (id: string) => analysis.courses.get(id)!.remainingChain;
  expect([chain("c"), chain("a"), chain("b"), chain("z")]).toEqual([1, 2, 3, 4]);
  expect(analysis.remainingCriticalPath).toBe(4);
});

test("a cycle that evidence resolves is not blocked", () => {
  const catalog = [row("a", courseRef("b")), row("b", courseRef("a"))];
  const analysis = unlockAnalysis(require("a"), assess(catalog, { transcript: [pass("a")] }));
  expect(analysis.courses.get("a")!.remainingChain).toBe(0);
  expect(analysis.courses.get("b")!.remainingChain).toBe(1);
  expect(analysis.courses.get("b")!.onRemainingPath).toBe(false);
  expect(analysis.remainingCriticalPath).toBe(0);
  expect(analysis.warnings).toEqual([]);
});

test("defect 5: a finished requirement's prerequisite is never recommended", () => {
  // Required A is done and needed P; required R is still open.
  const catalog = [row("p"), row("a", courseRef("p")), row("r")];
  const result = assess(catalog, { transcript: [pass("a")] });
  const analysis = unlockAnalysis(require("a", "r"), result);
  expect(analysis.courses.get("p")!.available).toBe(true);
  expect(analysis.courses.get("p")!.onRemainingPath).toBe(false);
  expect(analysis.courses.get("p")!.reason).toBeNull();
  expect(ids(recommendNextTerm(require("a", "r"), result, { creditTarget: 15 }))).toEqual(["r"]);
});

test("a prerequisite that closure already proves unlocks nothing", () => {
  const catalog = [
    row("k0"),
    row("f1", courseRef("k0")),
    row("f1b", courseRef("f1")),
    row("f2", courseRef("k0")),
    row("f3", and(courseRef("k0"), courseRef("m"))),
    row("m"),
  ];
  // Passing f1 proves k0 was met, so f3 waits only on m.
  const analysis = unlockAnalysis(require("f1b", "f2", "f3"), assess(catalog, { transcript: [pass("f1")], inProgress: ["f2"] }));
  expect(analysis.courses.get("k0")!.unlocksDirect).toEqual([]);
  expect(analysis.courses.get("k0")!.onRemainingPath).toBe(false);
  expect(analysis.courses.get("m")!.unlocksDirect).toEqual(["f3"]);
  expect(analysis.courses.get("f1")!.unlocksDirect).toEqual([]);
  expect(analysis.courses.get("f2")!.remainingChain).toBe(0);
});

test("AND prerequisites run in parallel terms: a deep chain outlasts a wide fan", () => {
  const catalog = [
    row("d1", courseRef("d2")),
    row("d2", courseRef("d3")),
    row("d3"),
    row("fan", and(courseRef("g1"), courseRef("g2"), courseRef("g3"), courseRef("g4"), courseRef("g5"))),
    ...["g1", "g2", "g3", "g4", "g5"].map((id) => row(id)),
  ];
  const analysis = unlockAnalysis(require("d1", "fan"), assess(catalog));
  expect(analysis.courses.get("d1")!.remainingChain).toBe(3);
  expect(analysis.courses.get("fan")!.remainingChain).toBe(2);
  expect(analysis.remainingCriticalPath).toBe(3);
  expect(analysis.courses.get("g1")!.unlocksTransitive).toEqual(["fan"]);
  expect(analysis.courses.get("d3")!.unlocksTransitive).toEqual(["d1", "d2"]);
  expect(analysis.courses.get("d3")!.onCriticalPath).toBe(true);
  expect(analysis.courses.get("g1")!.onCriticalPath).toBe(false);
});

test("OR branches that name no course never shorten a path", () => {
  const catalog = [
    row("p"),
    row("a", courseRef("p")),
    row("c", or(courseRef("a"), consent())),
    row("e", or(courseRef("p"), equivalent())),
    row("f", or(consent(), consent("department consent"))),
  ];
  const analysis = unlockAnalysis(require("c", "e", "f"), assess(catalog));
  expect(analysis.courses.get("c")!.remainingChain).toBe(3);
  expect(analysis.courses.get("e")!.remainingChain).toBe(2);
  // With no course branch at all, consent is the only route.
  expect(analysis.courses.get("f")!.remainingChain).toBe(1);
});

test("unknown and locked courses are never available; one-term unknowns become advisor checks", () => {
  const catalog = [row("k0"), row("u1", and(courseRef("k0"), consent())), row("l1", courseRef("absent"))];
  const result = assess(catalog, { transcript: [pass("k0")] });
  const analysis = unlockAnalysis(require("u1", "l1"), result);
  expect(analysis.courses.get("u1")!.status).toBe("unknown");
  expect(analysis.courses.get("u1")!.available).toBe(false);
  expect(analysis.courses.get("l1")!.status).toBe("locked");
  expect(analysis.courses.get("l1")!.available).toBe(false);
  expect(analysis.advisorChecks).toEqual(["u1"]);
  expect(analysis.warnings).toEqual(["Prerequisites not in the catalog, assumed to take one term with nothing before them: absent."]);
  expect(recommendNextTerm(require("u1", "l1"), result, { creditTarget: 15 })).toEqual([]);
});

test("an unknown course with a clause the engine knows is unmet is not an advisor check", () => {
  const catalog = [row("t", and({ kind: "standing", minimum: "senior", source: "Senior standing." }, consent()))];
  const result = assess(catalog, { transcript: [], earnedHours: 30 });
  expect(result.statuses.get("t")!.status).toBe("unknown");
  const analysis = unlockAnalysis(require("t"), result);
  expect(analysis.courses.get("t")!.remainingChain).toBe(1);
  expect(analysis.advisorChecks).toEqual([]);
});

test("a grade below a prerequisite's minimum means a retake, not a free pass", () => {
  // R needs B or better in P; the transcript shows P passed with a D.
  const catalog = [row("p"), row("r", minGrade("B", courseRef("p")))];
  const result = assess(catalog, { transcript: [pass("p", "D")] });
  expect(result.statuses.get("r")!.status).toBe("locked");
  const analysis = unlockAnalysis(require("p", "r"), result);
  expect(analysis.courses.get("r")!.remainingChain).toBe(2);
  expect(analysis.warnings).toEqual(["Grade below the minimum on record, so a retake or advisor review comes first: r needs a higher grade in p."]);
  expect(recommendNextTerm(require("p", "r"), result, { creditTarget: 15 })).toEqual([]);
});

test("closure proves a prerequisite but not its grade", () => {
  // Passing q proves p was met, but r needs a B in p, which closure cannot show.
  const catalog = [row("p"), row("q", courseRef("p")), row("r", minGrade("B", courseRef("p")))];
  const result = assess(catalog, { transcript: [pass("q")] });
  const analysis = unlockAnalysis(require("q", "r"), result);
  expect(analysis.courses.get("r")!.remainingChain).toBe(2);
  expect(ids(recommendNextTerm(require("q", "r"), result, { creditTarget: 15 }))).toEqual(["p"]);
});

test("an alternative the engine proves through closure is not recommended again", () => {
  // Passing q proves "a or b" as a whole without naming either, so r waits only on consent.
  const either = () => or(courseRef("a"), courseRef("b"));
  const catalog = [row("a"), row("b"), row("q", either()), row("r", and(either(), consent()))];
  const result = assess(catalog, { transcript: [pass("q")] });
  const analysis = unlockAnalysis(require("q", "r"), result);
  expect(analysis.courses.get("r")!.remainingChain).toBe(1);
  expect(analysis.courses.get("a")!.onRemainingPath).toBe(false);
  expect(analysis.advisorChecks).toEqual(["r"]);
  expect(recommendNextTerm(require("q", "r"), result, { creditTarget: 15 })).toEqual([]);
});
