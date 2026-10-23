import { describe, expect, test } from "bun:test";
import type { AuditCourse, ClaimedCourse } from "../../src/degree/audit";
import { nextTerm, planRoadmap, type PlanCourse, type Requires, type Roadmap, type RoadmapInput, type Season } from "../../src/degree/roadmap";
import type { CourseSlot, ProgramData, RequirementNode } from "../../src/degree/types";

/**
 * The roadmap over hand-written programs and catalogs. Each test pins one
 * behavior with exact terms; the real UNT programs run through the Courses
 * adapter in frontend/tests/courses/roadmap.test.ts.
 */

const citation = { page: "synthetic.html", url: "https://example.test/synthetic", anchor: null, heading: "Synthetic program" };
const SPRING_27 = { season: "spring", year: 2027 } as const;

const singles = (...codes: string[]): CourseSlot[] => codes.map((code) => ({ alternatives: [{ must: [code] }] }));
const all = (name: string, ...codes: string[]): RequirementNode => ({ kind: "all", name, citation, items: singles(...codes) });

function program(requirements: RequirementNode[], id = "major"): ProgramData {
  return { id, name: `Program ${id}`, catalogId: "unt-test", sourceUrl: citation.url, coreSharedCourses: [], requirements, courseSharing: "forbidden" };
}

const none: Requires = { kind: "and", children: [] };
const needs = (code: string): Requires => ({ kind: "course", code });
const alongside = (code: string): Requires => ({ kind: "concurrent", requirement: needs(code) });
const both = (...children: Requires[]): Requires => ({ kind: "and", children });
const either = (...children: Requires[]): Requires => ({ kind: "or", children });

function course(code: string, requires: Requires = none, credits = 3, offered?: Season[]): PlanCourse {
  return offered ? { code, credits, requires, offered } : { code, credits, requires };
}
const catalogOf = (...courses: PlanCourse[]) => new Map(courses.map((entry) => [entry.code, entry]));

function done(code: string, grade = "A", credits = 3): AuditCourse {
  return { code, grade, credits, sourceKind: "unt", inProgress: false, term: 1 };
}
function taking(code: string, credits = 3): AuditCourse {
  return { code, grade: null, credits, sourceKind: "current", inProgress: true, term: 2 };
}
function claimed(code: string, credits = 3): ClaimedCourse {
  return { code, credits, sourceKind: "claimed" };
}

function plan(input: Partial<RoadmapInput> & Pick<RoadmapInput, "programs" | "catalog">): Roadmap {
  return planRoadmap({ record: [], start: SPRING_27, creditLimit: 15, ...input });
}

/** Each term as "Spring 2027: A, B". */
const layout = (roadmap: Roadmap) => roadmap.terms.map((entry) => `${entry.term.season} ${entry.term.year}: ${entry.courses.map((placed) => placed.code).join(", ")}`);
const placed = (roadmap: Roadmap, code: string) => roadmap.terms.flatMap((entry) => entry.courses).find((entry) => entry.code === code);

describe("terms", () => {
  test("spring and fall alternate, and summer joins only when asked for", () => {
    expect(nextTerm({ season: "spring", year: 2027 }, ["spring", "fall"])).toEqual({ season: "fall", year: 2027 });
    expect(nextTerm({ season: "fall", year: 2027 }, ["spring", "fall"])).toEqual({ season: "spring", year: 2028 });
    expect(nextTerm({ season: "spring", year: 2027 }, ["fall", "summer", "spring"])).toEqual({ season: "summer", year: 2027 });
  });
});

describe("prerequisite chains", () => {
  test("each course goes in the term after the one it needs", () => {
    const roadmap = plan({
      programs: [program([all("Major", "A 1000", "B 2000", "C 3000")])],
      catalog: catalogOf(course("A 1000"), course("B 2000", needs("A 1000")), course("C 3000", needs("B 2000"))),
    });
    expect(layout(roadmap)).toEqual(["spring 2027: A 1000", "fall 2027: B 2000", "spring 2028: C 3000"]);
    expect(placed(roadmap, "C 3000")?.after).toEqual(["B 2000"]);
    expect(placed(roadmap, "A 1000")?.after).toEqual([]);
  });

  test("the longest chain goes first when the credit limit forces a choice, then the lower level", () => {
    // Limit 3 fits one course a term. X has nothing after it; A starts a chain of three. Once the
    // chain is down to C, C and X tie on length, and X's 1000 level goes before C's 3000.
    const roadmap = plan({
      programs: [program([all("Major", "X 1000", "A 1000", "B 2000", "C 3000")])],
      catalog: catalogOf(course("X 1000"), course("A 1000"), course("B 2000", needs("A 1000")), course("C 3000", needs("B 2000"))),
      creditLimit: 3,
    });
    expect(layout(roadmap)).toEqual(["spring 2027: A 1000", "fall 2027: B 2000", "spring 2028: X 1000", "fall 2028: C 3000"]);
    expect(placed(roadmap, "X 1000")?.waited).toEqual({ since: SPRING_27, for: "credits" });
    expect(placed(roadmap, "C 3000")?.waited).toEqual({ since: { season: "spring", year: 2028 }, for: "credits" });
  });

  test("a prerequisite no requirement names joins the roadmap, marked as such", () => {
    const roadmap = plan({
      programs: [program([all("Major", "B 2000")])],
      catalog: catalogOf(course("A 1000"), course("B 2000", needs("A 1000"))),
    });
    expect(layout(roadmap)).toEqual(["spring 2027: A 1000", "fall 2027: B 2000"]);
    expect(placed(roadmap, "A 1000")?.why).toEqual({ kind: "prerequisite", for: ["B 2000"] });
    expect(placed(roadmap, "B 2000")?.why).toEqual({ kind: "requirement", program: "major", requirement: "Major" });
  });

  test("an \"or\" takes the alternative already on the roadmap instead of adding a course", () => {
    const roadmap = plan({
      programs: [program([all("Major", "M 1710", "C 1040")])],
      catalog: catalogOf(course("M 1100"), course("M 1710"), course("C 1040", either(needs("M 1100"), needs("M 1710")))),
    });
    expect(roadmap.left.map((entry) => entry.code)).toEqual(["C 1040", "M 1710"]);
    expect(layout(roadmap)).toEqual(["spring 2027: M 1710", "fall 2027: C 1040"]);
  });

  test("a real course beats \"or consent\", and consent alone is a check, not a block", () => {
    const roadmap = plan({
      programs: [program([all("Major", "B 2000", "D 2000")])],
      catalog: catalogOf(
        course("A 1000"),
        course("B 2000", either(needs("A 1000"), { kind: "check", text: "consent of instructor" })),
        course("D 2000", { kind: "check", text: "consent of department" }),
      ),
    });
    expect(layout(roadmap)).toEqual(["spring 2027: A 1000, D 2000", "fall 2027: B 2000"]);
    expect(placed(roadmap, "D 2000")?.checks).toEqual(["consent of department"]);
  });
});

describe("corequisites", () => {
  test("a lecture and the lab it must be taken with go in the same term", () => {
    const roadmap = plan({
      programs: [program([all("Major", "P 1710", "P 1730")])],
      catalog: catalogOf(course("P 1710", alongside("P 1730"), 3), course("P 1730", alongside("P 1710"), 1)),
    });
    expect(layout(roadmap)).toEqual(["spring 2027: P 1710, P 1730"]);
    expect(placed(roadmap, "P 1710")?.with).toEqual(["P 1730"]);
    expect(placed(roadmap, "P 1730")?.with).toEqual(["P 1710"]);
  });

  test("a corequisite already done counts, and one taken earlier counts too", () => {
    const roadmap = plan({
      programs: [program([all("Major", "M 1710", "C 2100")])],
      catalog: catalogOf(course("M 1710"), course("C 2100", alongside("M 1710"))),
      creditLimit: 3,
    });
    // One course a term: M 1710 first, C 2100 after it; "this term or earlier" allows that.
    expect(layout(roadmap)).toEqual(["spring 2027: M 1710", "fall 2027: C 2100"]);
  });

  test("a pair that can't fit together waits for a term with room for both", () => {
    // X 1000 leads a chain (Y 2000 needs it), so it takes spring first. P 1710 and its lab are 4
    // credits together; beside X 1000's 4 they'd pass the limit of 5, so neither goes in alone.
    const roadmap = plan({
      programs: [program([all("Major", "X 1000", "Y 2000", "P 1710", "P 1730")])],
      catalog: catalogOf(course("X 1000", none, 4), course("Y 2000", needs("X 1000"), 1), course("P 1710", alongside("P 1730"), 3), course("P 1730", alongside("P 1710"), 1)),
      creditLimit: 5,
    });
    expect(layout(roadmap)).toEqual(["spring 2027: X 1000", "fall 2027: P 1710, P 1730, Y 2000"]);
    expect(roadmap.terms.map((entry) => entry.credits)).toEqual([4, 5]);
  });

  test("courses that need each other alongside are not a loop, and a pair over the limit isn't split", () => {
    const roadmap = plan({
      programs: [program([all("Major", "P 1710", "P 1730")])],
      catalog: catalogOf(course("P 1710", alongside("P 1730"), 3), course("P 1730", alongside("P 1710"), 3)),
      creditLimit: 4,
    });
    expect(roadmap.terms).toEqual([]);
    expect(roadmap.unplaced.map((entry) => [entry.code, entry.reason])).toEqual([
      ["P 1710", { kind: "over-limit", credits: 6 }],
      ["P 1730", { kind: "over-limit", credits: 6 }],
    ]);
  });
});

describe("the credit limit", () => {
  test("no term goes over it, and courses spill into later terms", () => {
    const codes = ["A 1000", "B 1000", "C 1000", "D 1000", "E 1000", "F 1000", "G 1000"];
    const roadmap = plan({ programs: [program([all("Major", ...codes)])], catalog: catalogOf(...codes.map((code) => course(code))), creditLimit: 9 });
    expect(roadmap.terms.map((entry) => entry.credits)).toEqual([9, 9, 3]);
    expect(layout(roadmap)).toEqual(["spring 2027: A 1000, B 1000, C 1000", "fall 2027: D 1000, E 1000, F 1000", "spring 2028: G 1000"]);
  });

  test("a smaller course fills the room a bigger one leaves", () => {
    const roadmap = plan({
      programs: [program([all("Major", "A 1000", "B 1000", "C 1000")])],
      catalog: catalogOf(course("A 1000", none, 4), course("B 1000", none, 4), course("C 1000", none, 1)),
      creditLimit: 5,
    });
    expect(layout(roadmap)).toEqual(["spring 2027: A 1000, C 1000", "fall 2027: B 1000"]);
  });

  test("a course over the limit on its own is reported with its credits", () => {
    const roadmap = plan({ programs: [program([all("Major", "BIG 4000")])], catalog: catalogOf(course("BIG 4000", none, 6)), creditLimit: 4 });
    expect(roadmap.unplaced).toEqual([{ code: "BIG 4000", credits: 6, why: { kind: "requirement", program: "major", requirement: "Major" }, reason: { kind: "over-limit", credits: 6 } }]);
  });

  test("a pinned course stays in the first term even past the limit", () => {
    const roadmap = plan({
      programs: [program([all("Major", "A 1000", "B 1000")])],
      catalog: catalogOf(course("A 1000", none, 4), course("B 1000", none, 4), course("ELEC 1000", none, 4)),
      creditLimit: 4,
      pinned: ["ELEC 1000", "A 1000"],
    });
    expect(layout(roadmap)).toEqual(["spring 2027: A 1000, ELEC 1000", "fall 2027: B 1000"]);
    expect(roadmap.terms[0]!.credits).toBe(8);
    expect(placed(roadmap, "ELEC 1000")?.why).toEqual({ kind: "pinned" });
  });

  test("a pinned course whose prerequisite isn't done says so", () => {
    const roadmap = plan({
      programs: [program([all("Major", "B 2000")])],
      catalog: catalogOf(course("A 1000"), course("B 2000", needs("A 1000"))),
      pinned: ["B 2000"],
    });
    expect(placed(roadmap, "B 2000")?.ruleMet).toBe(false);
  });

  test("standing counts the record's credits and each earlier term's", () => {
    const roadmap = plan({
      programs: [program([all("Major", "A 1000", "B 1000", "S 4000")])],
      catalog: catalogOf(course("A 1000"), course("B 1000"), course("S 4000", { kind: "credits", min: 9 })),
      record: [done("OLD 1000")],
      creditLimit: 3,
    });
    // 3 on record, then 3 a term: 9 earned only once A and B are both done.
    expect(layout(roadmap)).toEqual(["spring 2027: A 1000", "fall 2027: B 1000", "spring 2028: S 4000"]);
  });

  test("with full terms counted, standing grows by the limit each term, electives filling the rest", () => {
    const input = {
      programs: [program([all("Major", "A 1000", "S 4000")])],
      catalog: catalogOf(course("A 1000"), course("S 4000", { kind: "credits", min: 30 })),
      creditLimit: 15,
    };
    // Named courses alone reach 3 credits, so S 4000 never goes in.
    expect(plan(input).unplaced.map((entry) => entry.reason)).toEqual([{ kind: "standing", credits: 30, reaches: 3 }]);
    // Counted as full, spring and fall make 30 by the next spring, with the empty fall kept between.
    expect(layout(plan({ ...input, fullTermsForStanding: true }))).toEqual(["spring 2027: A 1000", "fall 2027: ", "spring 2028: S 4000"]);
  });

  test("with full terms counted, a course waiting on standing outlasts a turn of empty terms", () => {
    const roadmap = plan({
      programs: [program([all("Major", "S 4000")])],
      catalog: catalogOf(course("S 4000", { kind: "credits", min: 60 })),
      fullTermsForStanding: true,
    });
    // 15 a term: 60 earned after four terms, so the fifth takes it.
    expect(layout(roadmap)).toEqual(["spring 2027: ", "fall 2027: ", "spring 2028: ", "fall 2028: ", "spring 2029: S 4000"]);
  });

  test("standing the roadmap never reaches is reported with what it does reach", () => {
    const roadmap = plan({
      programs: [program([all("Major", "A 1000", "S 4000")])],
      catalog: catalogOf(course("A 1000"), course("S 4000", { kind: "credits", min: 90 })),
    });
    expect(roadmap.unplaced.find((entry) => entry.code === "S 4000")?.reason).toEqual({ kind: "standing", credits: 90, reaches: 3 });
  });
});

describe("what can't be placed", () => {
  test("a prerequisite loop is reported for each member, and what needs it is blocked", () => {
    const roadmap = plan({
      programs: [program([all("Major", "X 1000", "Y 1000", "Z 2000", "OK 1000")])],
      catalog: catalogOf(course("X 1000", needs("Y 1000")), course("Y 1000", needs("X 1000")), course("Z 2000", needs("X 1000")), course("OK 1000")),
    });
    expect(layout(roadmap)).toEqual(["spring 2027: OK 1000"]);
    expect(roadmap.unplaced.map((entry) => [entry.code, entry.reason])).toEqual([
      ["X 1000", { kind: "cycle", with: ["Y 1000"] }],
      ["Y 1000", { kind: "cycle", with: ["X 1000"] }],
      ["Z 2000", { kind: "blocked", by: "X 1000" }],
    ]);
  });

  test("a course that lists itself is a loop of one", () => {
    const roadmap = plan({ programs: [program([all("Major", "S 1000")])], catalog: catalogOf(course("S 1000", needs("S 1000"))) });
    expect(roadmap.unplaced.map((entry) => entry.reason)).toEqual([{ kind: "cycle", with: [] }]);
  });

  test("a course missing from the catalog can't be placed, and neither can what needs it", () => {
    const roadmap = plan({
      programs: [program([all("Major", "GONE 1000", "NEXT 2000")])],
      catalog: catalogOf(course("NEXT 2000", needs("GONE 1000"))),
    });
    expect(roadmap.terms).toEqual([]);
    expect(roadmap.unplaced.map((entry) => [entry.code, entry.credits, entry.reason])).toEqual([
      ["GONE 1000", null, { kind: "no-data" }],
      ["NEXT 2000", 3, { kind: "blocked", by: "GONE 1000" }],
    ]);
  });

  test("an empty \"or\" can never be met", () => {
    const roadmap = plan({ programs: [program([all("Major", "E 1000")])], catalog: catalogOf(course("E 1000", either())) });
    expect(roadmap.unplaced.map((entry) => entry.reason)).toEqual([{ kind: "unmeetable" }]);
  });

  test("a course that runs only in a season the roadmap doesn't plan is reported", () => {
    const roadmap = plan({ programs: [program([all("Major", "SUM 1000")])], catalog: catalogOf(course("SUM 1000", none, 3, ["summer"])) });
    expect(roadmap.unplaced.map((entry) => entry.reason)).toEqual([{ kind: "not-offered", offered: ["summer"] }]);
  });

  test("the roadmap stops at maxTerms and says what didn't fit", () => {
    const roadmap = plan({
      programs: [program([all("Major", "A 1000", "B 2000", "C 3000")])],
      catalog: catalogOf(course("A 1000"), course("B 2000", needs("A 1000")), course("C 3000", needs("B 2000"))),
      maxTerms: 2,
    });
    expect(layout(roadmap)).toEqual(["spring 2027: A 1000", "fall 2027: B 2000"]);
    expect(roadmap.unplaced.map((entry) => [entry.code, entry.reason.kind])).toEqual([["C 3000", "out-of-terms"]]);
  });
});

describe("offering seasons", () => {
  test("a fall-only course waits for fall, and says the season held it", () => {
    const roadmap = plan({
      programs: [program([all("Major", "F 1000", "S 1000")])],
      catalog: catalogOf(course("F 1000", none, 3, ["fall"]), course("S 1000")),
    });
    expect(layout(roadmap)).toEqual(["spring 2027: S 1000", "fall 2027: F 1000"]);
    expect(placed(roadmap, "F 1000")?.waited).toEqual({ since: SPRING_27, for: "season" });
  });

  test("summer terms appear only when summer is planned", () => {
    const roadmap = plan({
      programs: [program([all("Major", "A 1000", "B 2000")])],
      catalog: catalogOf(course("A 1000"), course("B 2000", needs("A 1000"))),
      seasons: ["spring", "summer", "fall"],
    });
    expect(layout(roadmap)).toEqual(["spring 2027: A 1000", "summer 2027: B 2000"]);
  });

  test("an empty term between two is kept: nothing to take while a course waits for its season", () => {
    const roadmap = plan({
      programs: [program([all("Major", "A 1000", "B 2000")])],
      catalog: catalogOf(course("A 1000", none, 3, ["fall"]), course("B 2000", needs("A 1000"), 3, ["fall"])),
    });
    expect(layout(roadmap)).toEqual(["spring 2027: ", "fall 2027: A 1000", "spring 2028: ", "fall 2028: B 2000"]);
  });
});

describe("the record", () => {
  test("completed and in-progress courses count, and aren't planned again", () => {
    const roadmap = plan({
      programs: [program([all("Major", "A 1000", "B 2000", "C 3000")])],
      catalog: catalogOf(course("A 1000"), course("B 2000", needs("A 1000")), course("C 3000", needs("B 2000"))),
      record: [done("A 1000"), taking("B 2000")],
    });
    expect(layout(roadmap)).toEqual(["spring 2027: C 3000"]);
    expect(roadmap.left.map((entry) => entry.code)).toEqual(["C 3000"]);
  });

  test("a failed or withdrawn attempt doesn't count", () => {
    const roadmap = plan({
      programs: [program([all("Major", "A 1000", "B 2000")])],
      catalog: catalogOf(course("A 1000"), course("B 2000", needs("A 1000"))),
      record: [done("A 1000", "F"), done("B 2000", "W")],
    });
    expect(layout(roadmap)).toEqual(["spring 2027: A 1000", "fall 2027: B 2000"]);
  });

  test("a course the student marked done counts", () => {
    const roadmap = plan({
      programs: [program([all("Major", "A 1000", "B 2000")])],
      catalog: catalogOf(course("A 1000"), course("B 2000", needs("A 1000"))),
      record: [claimed("A 1000")],
    });
    expect(layout(roadmap)).toEqual(["spring 2027: B 2000"]);
  });

  test("with everything done there are no terms and nothing left", () => {
    const roadmap = plan({ programs: [program([all("Major", "A 1000")])], catalog: catalogOf(course("A 1000")), record: [done("A 1000")] });
    expect(roadmap).toMatchObject({ terms: [], unplaced: [], open: [], left: [] });
  });
});

describe("choosing courses", () => {
  test("a choose node takes options with catalog data before ones without", () => {
    const labs: RequirementNode = { kind: "choose", name: "Lab science", citation, count: 1, items: singles("NODATA 1000", "LAB 1000") };
    const roadmap = plan({ programs: [program([labs])], catalog: catalogOf(course("LAB 1000")) });
    expect(roadmap.left.map((entry) => entry.code)).toEqual(["LAB 1000"]);
  });

  test("a choose node takes the option needing fewer extra prerequisites", () => {
    const pickOne: RequirementNode = { kind: "choose", name: "Pick one", citation, count: 1, items: singles("DEEP 3000", "FLAT 3000") };
    const roadmap = plan({
      programs: [program([pickOne])],
      catalog: catalogOf(course("PRE 1000"), course("PRE 2000", needs("PRE 1000")), course("DEEP 3000", needs("PRE 2000")), course("FLAT 3000")),
    });
    expect(roadmap.left.map((entry) => entry.code)).toEqual(["FLAT 3000"]);
  });

  test("an hours node picks listed courses until the hours are covered", () => {
    const hours: RequirementNode = { kind: "hours", name: "Electives, 6 hours", citation, hours: 6, options: [{ must: ["E1 3000"] }, { must: ["E2 3000"] }, { must: ["E3 3000"] }] };
    const roadmap = plan({ programs: [program([hours])], catalog: catalogOf(course("E1 3000"), course("E2 3000"), course("E3 3000")) });
    expect(roadmap.left.map((entry) => entry.code)).toEqual(["E1 3000", "E2 3000"]);
  });

  test("a requirement the roadmap can't name courses for comes back open, with its credits", () => {
    const pool: RequirementNode = { kind: "pool", name: "Advanced electives", citation, hours: 6, match: { subjects: ["CSCE"], minLevel: 3000, maxLevel: 4999 }, note: "List not captured." };
    const roadmap = plan({ programs: [program([all("Major", "A 1000"), pool])], catalog: catalogOf(course("A 1000")) });
    expect(roadmap.open).toEqual([{ key: "major.1", viewKey: "major.1", program: "major", name: "Advanced electives", reason: "List not captured.", credits: 6 }]);
    expect(layout(roadmap)).toEqual(["spring 2027: A 1000"]);
  });

  test("a course two programs both need is taken once", () => {
    const roadmap = plan({
      programs: [program([all("Major", "M 1710", "C 1030")], "major"), program([all("Core math", "M 1710")], "core")],
      catalog: catalogOf(course("M 1710"), course("C 1030")),
    });
    expect(roadmap.left.map((entry) => [entry.code, entry.why])).toEqual([
      ["C 1030", { kind: "requirement", program: "major", requirement: "Major" }],
      ["M 1710", { kind: "requirement", program: "major", requirement: "Major" }],
    ]);
  });

  test("a choice follows the branch the audit shows", () => {
    const choice: RequirementNode = {
      kind: "choice",
      name: "Capstone",
      citation,
      branches: [
        { name: "Project", node: all("Project courses", "P 4901", "P 4902") },
        { name: "Thesis", node: all("Thesis course", "T 4999") },
      ],
    };
    const roadmap = plan({ programs: [program([choice])], catalog: catalogOf(course("P 4901"), course("P 4902"), course("T 4999")), record: [done("T 4999")] });
    // The thesis is done, so the choice is met and nothing more is planned.
    expect(roadmap.left).toEqual([]);
    const fresh = plan({ programs: [program([choice])], catalog: catalogOf(course("P 4901"), course("P 4902"), course("T 4999")) });
    expect(fresh.left.map((entry) => entry.code)).toEqual(["P 4901", "P 4902"]);
  });
});

describe("determinism and errors", () => {
  test("the same courses in any order give the same roadmap", () => {
    const courses = [
      course("A 1000"),
      course("B 2000", needs("A 1000")),
      course("C 1000", none, 4),
      course("D 2000", both(needs("C 1000"), alongside("E 1000"))),
      course("E 1000", none, 1),
      course("F 3000", either(needs("B 2000"), needs("D 2000"))),
    ];
    const codes = courses.map((entry) => entry.code);
    const forward = plan({ programs: [program([all("Major", ...codes)])], catalog: catalogOf(...courses), record: [done("OLD 1000"), claimed("OLD 2000")], creditLimit: 7 });
    const backward = plan({
      programs: [program([all("Major", ...[...codes].reverse())])],
      catalog: catalogOf(...[...courses].reverse()),
      record: [claimed("OLD 2000"), done("OLD 1000")],
      creditLimit: 7,
    });
    expect(layout(backward)).toEqual(layout(forward));
    expect(backward.unplaced).toEqual(forward.unplaced);
    expect(backward.left.map((entry) => entry.code)).toEqual(forward.left.map((entry) => entry.code));
  });

  test("bad input fails loudly", () => {
    const base = { programs: [program([all("Major", "A 1000")])], catalog: catalogOf(course("A 1000")) };
    expect(() => plan({ ...base, creditLimit: 0 })).toThrow("The credit limit must be a positive number, not 0.");
    expect(() => plan({ ...base, start: { season: "summer", year: 2027 } })).toThrow("The roadmap starts in summer, which isn't one of the seasons it plans (spring, fall).");
    expect(() => plan({ ...base, maxTerms: 0 })).toThrow("maxTerms must be a positive whole number, not 0.");
    expect(() => plan({ ...base, catalog: new Map([["A 1000", course("B 1000")]]) })).toThrow("The catalog lists B 1000 under A 1000.");
    expect(() => plan({ ...base, programs: [] })).toThrow("The roadmap needs at least one program.");
  });
});

/** UNT's letter scale for these tests: A highest, F lowest; anything else is unknown. */
const LETTERS = ["F", "D", "C", "B", "A"];
const meetsMinimum = (grade: string, minimum: string) => (LETTERS.includes(grade) && LETTERS.includes(minimum) ? LETTERS.indexOf(grade) >= LETTERS.indexOf(minimum) : undefined);
const atLeast = (code: string, minGrade: string): Requires => ({ kind: "course", code, minGrade });

describe("grade minimums", () => {
  test("a D on record doesn't meet \"C or better\": the course is retaken before what needs it", () => {
    const roadmap = plan({
      programs: [program([all("Major", "B 2000")])],
      catalog: catalogOf(course("A 1000"), course("B 2000", atLeast("A 1000", "C"))),
      record: [done("A 1000", "D")],
      meetsMinimum,
    });
    expect(layout(roadmap)).toEqual(["spring 2027: A 1000", "fall 2027: B 2000"]);
    expect(placed(roadmap, "A 1000")?.why).toEqual({ kind: "prerequisite", for: ["B 2000"] });
    expect(placed(roadmap, "A 1000")?.retake).toBe(true);
    expect(placed(roadmap, "B 2000")?.retake).toBe(false);
  });

  test("the best attempt counts: a C after a D meets it, and a D meets a rule with no minimum", () => {
    const catalog = catalogOf(course("A 1000"), course("B 2000", atLeast("A 1000", "C")), course("N 2000", needs("A 1000")));
    const retaken = plan({ programs: [program([all("Major", "B 2000")])], catalog, record: [done("A 1000", "D"), { ...done("A 1000", "C"), term: 2 }], meetsMinimum });
    expect(layout(retaken)).toEqual(["spring 2027: B 2000"]);
    const plain = plan({ programs: [program([all("Major", "N 2000")])], catalog, record: [done("A 1000", "D")], meetsMinimum });
    expect(layout(plain)).toEqual(["spring 2027: N 2000"]);
  });

  test("a course in progress meets a minimum: the roadmap assumes it passes", () => {
    const roadmap = plan({ programs: [program([all("Major", "B 2000")])], catalog: catalogOf(course("A 1000"), course("B 2000", atLeast("A 1000", "C"))), record: [taking("A 1000")], meetsMinimum });
    expect(layout(roadmap)).toEqual(["spring 2027: B 2000"]);
  });

  test("a catalog with minimums and no way to compare grades fails loudly", () => {
    expect(() => plan({ programs: [program([all("Major", "B 2000")])], catalog: catalogOf(course("A 1000"), course("B 2000", atLeast("A 1000", "C"))) })).toThrow(
      "B 2000's rule has a grade minimum, so the roadmap needs meetsMinimum to compare grades.",
    );
  });
});

describe("the record, as the audit reads it", () => {
  test("a course marked done doesn't count when the transcript holds an attempt at it, even a failed one", () => {
    const roadmap = plan({
      programs: [program([all("Major", "A 1000", "B 2000")])],
      catalog: catalogOf(course("A 1000"), course("B 2000", needs("A 1000"))),
      record: [done("A 1000", "F"), claimed("A 1000")],
    });
    expect(layout(roadmap)).toEqual(["spring 2027: A 1000", "fall 2027: B 2000"]);
  });
});

describe("nothing is dropped silently", () => {
  test("a requirement the roadmap's courses still leave unmet comes back open", () => {
    // P fills the choose first (tree order), so "all [P]" can't have it; the roadmap has nothing else to give.
    const pickOne: RequirementNode = { kind: "choose", name: "Pick one", citation, count: 1, items: singles("P 1000", "Q 1000") };
    const roadmap = plan({ programs: [program([pickOne, all("Needs P", "P 1000")])], catalog: catalogOf(course("P 1000"), course("Q 1000")) });
    expect(roadmap.open.map((item) => [item.key, item.name])).toEqual([["major.1", "Needs P"]]);
  });

  test("an \"or\" whose cheaper alternative loops back takes the other one", () => {
    // X needs Y or Z; Y needs X (a loop), Z needs W. Y looks cheaper, one course against two, but can never go first.
    const roadmap = plan({
      programs: [program([all("Major", "X 3000")])],
      catalog: catalogOf(course("X 3000", either(needs("Y 2000"), needs("Z 2000"))), course("Y 2000", needs("X 3000")), course("Z 2000", needs("W 1000")), course("W 1000")),
    });
    expect(layout(roadmap)).toEqual(["spring 2027: W 1000", "fall 2027: Z 2000", "spring 2028: X 3000"]);
    expect(roadmap.unplaced).toEqual([]);
  });

  test("a course the record covers as a prerequisite stays out of every term, and what needs it still goes in", () => {
    const roadmap = plan({
      programs: [program([all("Major", "C 1030", "C 2000")])],
      catalog: catalogOf(course("C 1030"), course("C 2000", needs("C 1030"))),
      covered: new Map([["C 1030", "C 1040"]]),
    });
    expect(layout(roadmap)).toEqual(["spring 2027: C 2000"]);
    expect(roadmap.unplaced.map((entry) => [entry.code, entry.reason])).toEqual([["C 1030", { kind: "covered", by: "C 1040" }]]);
  });
});

describe("electives", () => {
  test("with full terms counted, each term says how many credits electives fill", () => {
    const roadmap = plan({
      programs: [program([all("Major", "A 1000", "S 4000")])],
      catalog: catalogOf(course("A 1000"), course("S 4000", { kind: "credits", min: 30 })),
      fullTermsForStanding: true,
    });
    expect(roadmap.terms.map((entry) => [entry.credits, entry.electives])).toEqual([
      [3, 12],
      [0, 15],
      [3, 12],
    ]);
    // Without the assumption no term claims electives.
    const plain = plan({ programs: [program([all("Major", "A 1000")])], catalog: catalogOf(course("A 1000")) });
    expect(plain.terms.map((entry) => entry.electives)).toEqual([0]);
  });
});
