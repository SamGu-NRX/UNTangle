import { expect, test } from "bun:test";
import { recommendNextTerm, unlockAnalysis } from "../../src/lib/pathing";
import { assess, consent, courseRef, or, pass, plan, row } from "./fixtures";

const ids = (courses: { courseId: string }[]) => courses.map((course) => course.courseId);

test("a one-of requirement is met by either option and otherwise follows its shortest option", () => {
  const catalog = [row("p"), row("m1"), row("m2", courseRef("p"))];
  const oneOf = plan({ kind: "choose", name: "Statistics", count: 1, options: ["m1", "m2"] });
  const fresh = unlockAnalysis(oneOf, assess(catalog));
  expect(fresh.requirements[0]).toEqual({ name: "Statistics", kind: "choose", met: false, done: 0, target: 1, unit: "courses", remainingTerms: 1, tracked: true, branch: null });
  expect(fresh.courses.get("m1")!.reason).toBe("Counts toward Statistics, 0 of 1 course done");
  // m2 still counts toward the requirement, but p is not on the shortest route.
  expect(fresh.courses.get("m2")!.onRemainingPath).toBe(true);
  expect(fresh.courses.get("p")!.onRemainingPath).toBe(false);
  const done = unlockAnalysis(oneOf, assess(catalog, { transcript: [pass("m2")] }));
  expect(done.requirements[0]!.met).toBe(true);
  expect(done.courses.get("m1")!.onRemainingPath).toBe(false);
  expect(done.remainingCriticalPath).toBe(0);
});

test("a choose-hours group joins the critical path through its cheapest options and counts once its hours are met", () => {
  const catalog = [row("p"), row("q", courseRef("r")), row("r"), row("h1"), row("h2", courseRef("p")), row("h3", courseRef("q"))];
  const core = plan({ kind: "hours", name: "Core, 6 hours", hours: 6, options: ["h1", "h2", "h3"] });
  const fresh = unlockAnalysis(core, assess(catalog));
  // h1 alone gives 3 hours; adding h2 reaches 6 by term 2, before h3 could (term 3).
  expect(fresh.requirements[0]!.remainingTerms).toBe(2);
  expect(fresh.remainingCriticalPath).toBe(2);
  expect(fresh.courses.get("p")!.unlocksDirect).toEqual(["h2"]);
  expect(fresh.courses.get("p")!.onCriticalPath).toBe(true);
  expect(fresh.courses.get("q")!.onRemainingPath).toBe(false);
  expect(fresh.courses.get("h3")!.onRemainingPath).toBe(true);

  const halfway = unlockAnalysis(core, assess(catalog, { transcript: [pass("h3")] }));
  expect(halfway.requirements[0]!.done).toBe(3);
  expect(halfway.requirements[0]!.remainingTerms).toBe(1);

  const met = unlockAnalysis(core, assess(catalog, { transcript: [pass("h1"), pass("h2")] }));
  expect(met.requirements[0]).toEqual({ name: "Core, 6 hours", kind: "hours", met: true, done: 6, target: 6, unit: "hours", remainingTerms: 0, tracked: true, branch: null });
  expect(met.courses.get("h3")!.onRemainingPath).toBe(false);
  expect(recommendNextTerm(core, assess(catalog, { transcript: [pass("h1"), pass("h2")] }), { creditTarget: 15 })).toEqual([]);
});

test("filling hours takes the fewest courses, and options needing an advisor go last", () => {
  const catalog = [row("big", undefined, 4), row("y"), row("z"), row("gated", consent(), 4)];
  const analysis = unlockAnalysis(plan({ kind: "hours", name: "Four hours", hours: 4, options: ["gated", "y", "z", "big"] }), assess(catalog));
  // big covers the hours alone; gated would too but needs consent.
  expect(analysis.courses.get("big")!.onCriticalPath).toBe(true);
  expect(analysis.courses.get("gated")!.onCriticalPath).toBe(false);
  expect(analysis.courses.get("y")!.onCriticalPath).toBe(false);
});

test("the plan stops adding options once a group is covered", () => {
  const catalog = [row("e1"), row("e2"), row("e3")];
  const group = plan({ kind: "hours", name: "Electives, 6 hours", hours: 6, options: ["e3", "e2", "e1"] });
  expect(ids(recommendNextTerm(group, assess(catalog), { creditTarget: 15 }))).toEqual(["e1", "e2"]);
});

test("the plan takes one of two tied OR alternatives, not both", () => {
  const catalog = [row("e"), row("f"), row("t", or(courseRef("e"), courseRef("f")))];
  const fresh = unlockAnalysis(plan({ kind: "all", name: "Required", courses: ["t"] }), assess(catalog));
  expect(fresh.courses.get("e")!.unlocksDirect).toEqual(["t"]);
  expect(fresh.courses.get("f")!.unlocksDirect).toEqual(["t"]);
  const term = recommendNextTerm(plan({ kind: "all", name: "Required", courses: ["t"] }), assess(catalog), { creditTarget: 15 });
  expect(ids(term)).toEqual(["e"]);
  expect(term[0]!.reason).toBe("Needed for t; on the longest remaining chain (2 terms)");
});

test("a choice follows the first branch until the student starts another", () => {
  const catalog = [row("a1"), row("a2", courseRef("a1")), row("b1")];
  const choice = plan({
    kind: "choice",
    name: "Capstone or thesis",
    branches: [
      { name: "Capstone", requirements: [{ kind: "all", name: "Capstone courses", courses: ["a1", "a2"] }] },
      { name: "Thesis", requirements: [{ kind: "all", name: "Thesis", courses: ["b1"] }] },
    ],
  });
  const fresh = unlockAnalysis(choice, assess(catalog));
  // The thesis would be shorter, but the first branch is the default.
  expect(fresh.requirements[0]).toEqual({ name: "Capstone or thesis", kind: "choice", met: false, done: 0, target: 1, unit: "requirements", remainingTerms: 2, tracked: true, branch: "Capstone" });
  // Unstarted, both branches' courses count as options.
  expect(fresh.courses.get("b1")!.onRemainingPath).toBe(true);
  expect(fresh.courses.get("b1")!.reason).toBe("Counts toward Capstone or thesis (Thesis)");
  // Once a1 is picked the capstone is started, so b1 drops out of the term.
  expect(ids(recommendNextTerm(choice, assess(catalog), { creditTarget: 15 }))).toEqual(["a1"]);

  const thesis = unlockAnalysis(choice, assess(catalog, { transcript: [pass("b1")] }));
  expect(thesis.requirements[0]).toEqual({ name: "Capstone or thesis", kind: "choice", met: true, done: 1, target: 1, unit: "requirements", remainingTerms: 0, tracked: true, branch: "Thesis" });
  expect(thesis.courses.get("a1")!.onRemainingPath).toBe(false);
});

test("shared credit does not start a choice branch", () => {
  const catalog = [row("s"), row("a1"), row("b1")];
  const choice = plan({
    kind: "choice",
    name: "Capstone or thesis",
    branches: [
      { name: "Capstone", requirements: [{ kind: "all", name: "Shared + capstone", courses: ["s", "a1"] }] },
      { name: "Thesis", requirements: [{ kind: "all", name: "Shared + thesis", courses: ["s", "b1"] }] },
    ],
  });
  // Only the shared course is done: neither route has started, so both stay open.
  const shared = unlockAnalysis(choice, assess(catalog, { transcript: [pass("s")] }));
  expect(shared.requirements[0]!.branch).toBe("Capstone");
  expect(shared.courses.get("a1")!.onRemainingPath).toBe(true);
  expect(shared.courses.get("b1")!.onRemainingPath).toBe(true);
  // A branch-unique course starts its route and drops the other branch's courses.
  const started = unlockAnalysis(choice, assess(catalog, { transcript: [pass("s"), pass("a1")] }));
  expect(started.requirements[0]!.branch).toBe("Capstone");
  expect(started.courses.get("b1")!.onRemainingPath).toBe(false);
});

test("a choice prefers a branch that needs no advisor", () => {
  const catalog = [row("a1", consent()), row("b1")];
  const choice = plan({
    kind: "choice",
    name: "Either",
    branches: [
      { name: "A", requirements: [{ kind: "all", name: "A courses", courses: ["a1"] }] },
      { name: "B", requirements: [{ kind: "all", name: "B courses", courses: ["b1"] }] },
    ],
  });
  expect(unlockAnalysis(choice, assess(catalog)).requirements[0]!.branch).toBe("B");
});

test("a pool with a subject and level counts matching catalog courses, except those listed by name", () => {
  const catalog = [
    row("TECM 2700"),
    row("TECM 3010"),
    row("TECM 4180", courseRef("TECM 2700")),
    row("TECM 4700", courseRef("TECM 2700")),
    row("TECM 4900", undefined, 1),
  ];
  const writing = plan(
    { kind: "all", name: "Required", courses: ["TECM 2700", "TECM 4700"] },
    { kind: "pool", name: "4000-level TECM", hours: 3, match: { subject: "TECM", level: 4000 } },
  );
  const analysis = unlockAnalysis(writing, assess(catalog));
  expect(analysis.courses.get("TECM 4180")!.group).toBe("4000-level TECM");
  expect(analysis.courses.get("TECM 4700")!.group).toBe("Required");
  expect(analysis.courses.has("TECM 3010")).toBe(false);
  // The 1-hour TECM 4900 cannot cover 3 hours, so the pool waits on TECM 4180.
  expect(analysis.requirements[1]!.remainingTerms).toBe(2);
  expect(analysis.courses.get("TECM 2700")!.unlocksDirect).toEqual(["TECM 4180", "TECM 4700"]);
  const done = unlockAnalysis(writing, assess(catalog, { transcript: [pass("TECM 4180")] }));
  expect(done.requirements[1]!.met).toBe(true);
  expect(done.requirements[1]!.done).toBe(3);
});

test("a pool with no course rule is never met, adds no terms, and is flagged", () => {
  const analysis = unlockAnalysis(plan({ kind: "pool", name: "Advanced electives", hours: 6 }), assess([row("x")]));
  expect(analysis.requirements[0]).toEqual({ name: "Advanced electives", kind: "pool", met: false, done: 0, target: 6, unit: "hours", remainingTerms: 0, tracked: false, branch: null });
  expect(analysis.remainingCriticalPath).toBe(0);
  expect(analysis.warnings).toEqual([
    "Advanced electives: the plan data has no course list for this pool, so its hours are never counted; an advisor must confirm which courses apply.",
  ]);
});

test("a group the catalog cannot fill has no route and says so", () => {
  const analysis = unlockAnalysis(plan({ kind: "hours", name: "Core, 6 hours", hours: 6, options: ["c1", "ghost 1"] }), assess([row("c1")]));
  expect(analysis.requirements[0]!.remainingTerms).toBeNull();
  expect(analysis.remainingCriticalPath).toBeNull();
  expect(analysis.warnings).toEqual([
    "Not in the catalog, so never counted as done and left out of paths: ghost 1.",
    "Core, 6 hours cannot be met from the courses in the catalog.",
  ]);
});

test("malformed plans fail loudly", () => {
  const result = assess([row("x"), row("y")]);
  expect(() => unlockAnalysis(plan(), result)).toThrow('Plan "Test plan" has no requirements.');
  expect(() => unlockAnalysis(plan({ kind: "all", name: "A", courses: ["x"] }, { kind: "hours", name: "B", hours: 3, options: ["x", "y"] }), result))
    .toThrow('Course x is listed by both "A" and "B"; a course counts toward one requirement.');
  expect(() => unlockAnalysis(plan({ kind: "choose", name: "C", count: 3, options: ["x", "y"] }), result)).toThrow('Requirement "C" must choose between 1 and 2 courses.');
  expect(() => unlockAnalysis(plan({ kind: "hours", name: "D", hours: 0, options: ["x"] }), result)).toThrow('Requirement "D" needs a positive hour count.');
  expect(() => unlockAnalysis(plan({ kind: "all", name: " ", courses: ["x"] }), result)).toThrow("Every requirement needs a name.");
  // Inside one branch both groups are active together, so sharing x would count it twice.
  const sameBranch = plan({
    kind: "choice",
    name: "E",
    branches: [{ name: "Only", requirements: [{ kind: "all", name: "F", courses: ["x"] }, { kind: "choose", name: "G", count: 1, options: ["x", "y"] }] }],
  });
  expect(() => unlockAnalysis(sameBranch, result)).toThrow('Course x is listed by both "F" and "G"; a course counts toward one requirement.');
  // Rival branches may share a course, because only one of them is followed.
  const rivalBranches = plan({
    kind: "choice",
    name: "H",
    branches: [
      { name: "One", requirements: [{ kind: "all", name: "I", courses: ["x"] }] },
      { name: "Two", requirements: [{ kind: "all", name: "J", courses: ["x", "y"] }] },
    ],
  });
  expect(unlockAnalysis(rivalBranches, result).requirements[0]!.branch).toBe("One");
  expect(() => unlockAnalysis(plan({ kind: "choose", name: "K", count: 2, options: ["x", "x"] }), result)).toThrow('Requirement "K" lists x twice.');
});

test("an option cleared by an override needs no advisor, so its group follows it", () => {
  const catalog = [row("a", consent()), row("q"), row("b", courseRef("q"))];
  const result = assess(catalog, { overrides: new Map([["a", { status: "eligible" as const, reason: "Department consent on file" }]]) });
  const oneOf = plan({ kind: "choose", name: "Either", count: 1, options: ["a", "b"] });
  expect(unlockAnalysis(oneOf, result).requirements[0]!.remainingTerms).toBe(1);
  expect(ids(recommendNextTerm(oneOf, result, { creditTarget: 3 }))).toEqual(["a"]);
});

test("a lecture counts toward its group only with its lab", () => {
  const catalog = [row("lec"), row("lab", undefined, 1), row("solo"), row("phys")];
  const science = plan({
    kind: "choose",
    name: "Laboratory science",
    count: 2,
    options: ["lec", "solo", "phys"],
    companions: { lec: ["lab"], phys: ["phys lab"] },
  });
  const lectureOnly = unlockAnalysis(science, assess(catalog, { transcript: [pass("lec"), pass("solo")] }));
  expect(lectureOnly.requirements[0]!.done).toBe(1);
  expect(lectureOnly.requirements[0]!.met).toBe(false);
  // The missing lab keeps that lecture from ever counting, and the warning says so.
  expect(lectureOnly.warnings).toEqual(["Not in the catalog, so never counted as done and left out of paths: phys lab."]);
  expect(lectureOnly.courses.get("lab")!.onRemainingPath).toBe(true);
  // phys can never be confirmed, so it is no route and the group is only partly measurable.
  expect(lectureOnly.courses.get("phys")!.onRemainingPath).toBe(false);
  expect(lectureOnly.requirements[0]!.tracked).toBe(false);
  const withLab = unlockAnalysis(science, assess(catalog, { transcript: [pass("lec"), pass("lab"), pass("solo")] }));
  expect(withLab.requirements[0]!.met).toBe(true);
});

test("catalog rules the plan data does not check are repeated as warnings", () => {
  const analysis = unlockAnalysis({ ...plan({ kind: "all", name: "Required", courses: ["x"] }), notChecked: ["the C-or-better rule."] }, assess([row("x")]));
  expect(analysis.warnings).toEqual(["Not checked: the C-or-better rule."]);
});

test("two pools that match the same courses are rejected", () => {
  const twoPools = plan(
    { kind: "pool", name: "Upper TECM", hours: 3, match: { subject: "TECM", level: 4000 } },
    { kind: "pool", name: "More TECM", hours: 3, match: { subject: "TECM", level: 4000 } },
  );
  expect(() => unlockAnalysis(twoPools, assess([row("TECM 4180")])))
    .toThrow('Pools "Upper TECM" and "More TECM" match the same TECM courses; a course counts toward one requirement.');
});

test("a shared course names the branch the analysis follows", () => {
  const shared = plan({
    kind: "choice",
    name: "H",
    branches: [
      { name: "One", requirements: [{ kind: "all", name: "I", courses: ["x"] }] },
      { name: "Two", requirements: [{ kind: "all", name: "J", courses: ["x", "y"] }] },
    ],
  });
  const analysis = unlockAnalysis(shared, assess([row("x"), row("y")], { transcript: [pass("y")] }));
  expect(analysis.requirements[0]!.branch).toBe("Two");
  expect(analysis.courses.get("x")!.reason).toBe("Counts toward H (Two)");
});

test("a lecture passed without its lab marks its branch as started", () => {
  const catalog = [row("b1"), row("lec"), row("lab", undefined, 1)];
  const choice = plan({
    kind: "choice",
    name: "Either",
    branches: [
      { name: "Plain", requirements: [{ kind: "all", name: "Plain course", courses: ["b1"] }] },
      { name: "Science", requirements: [{ kind: "choose", name: "Lab course", count: 1, options: ["lec"], companions: { lec: ["lab"] } }] },
    ],
  });
  const result = assess(catalog, { transcript: [pass("lec")] });
  expect(unlockAnalysis(choice, result).requirements[0]!.branch).toBe("Science");
  expect(ids(recommendNextTerm(choice, result, { creditTarget: 15 }))).toEqual(["lab"]);
});

test("a group whose option is locked by an override reports the override, not a catalog gap", () => {
  const result = assess([row("q")], { overrides: new Map([["q", { status: "locked" as const, reason: "Not approved" }]]) });
  const analysis = unlockAnalysis(plan({ kind: "choose", name: "One of", count: 1, options: ["q"] }), result);
  expect(analysis.requirements[0]!.remainingTerms).toBeNull();
  expect(analysis.warnings).toEqual(["q is locked by an override: Not approved"]);
});
