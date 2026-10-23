/**
 * The degree audit as Courses' source for what is left (model/degree.ts):
 * hours, requirements by area, advisor items, the waiver question, and the
 * one candidate set Auto plans from. Each student is a real record through
 * the real course model and the real 2026-2027 data.
 */
import { describe, expect, test } from "bun:test";
import type { ChoiceNode } from "@untangle/core/degree/types";
import { buildCourseModel } from "@/components/courses/model/course-model";
import { checkDegree, withDegree, type AuditedDegree } from "@/components/courses/model/degree";
import { buildGroups } from "@/components/courses/model/groups";
import { leftHeadline, leftNotes } from "@/components/courses/model/left-copy";
import { autoTransaction, nextTermSuggestions, planAuto, snapshotOf } from "@/components/courses/model/plan-edits";
import { untProfile } from "@/components/courses/school";
import { DEGREE_DATA } from "@/lib/degree/programs.generated";
import { getMajorById } from "@/lib/planner";
import type { PlannerState } from "@/lib/types";
import { completedPlan, finalTerm, journeyTranscript, plannerWith, row } from "./degree-students";

const profile = untProfile();
const cs = getMajorById("cs")!;
const run = { id: "auto-t", at: "2026-10-17T00:00:00.000Z" };

function degreeOf(plan: PlannerState): { degree: AuditedDegree; model: ReturnType<typeof buildCourseModel> } {
  const snapshot = snapshotOf(plan);
  const base = buildCourseModel(profile, snapshot);
  const degree = checkDegree(profile, snapshot, base, getMajorById(plan.selectedMajor!)!);
  if (degree.kind !== "audited") throw new Error(`expected an audited degree, got ${degree.kind}`);
  return { degree, model: withDegree(base, degree) };
}

/** The audit outcome behind a requirement row; fails for a rule row. */
function outcomeOf(row: AuditedDegree["areas"][number]["requirements"][number]) {
  if (row.source.kind !== "node") throw new Error(`${row.name} is a rule, not a requirement node`);
  return row.source.outcome;
}

const rows = (degree: AuditedDegree, area: "major" | "core") => degree.areas.find((entry) => entry.area === area)!.requirements.map((row) => [row.name, row.status, row.fact]);
const groupIds = (plan: PlannerState, key: string) => {
  const { degree, model } = degreeOf(plan);
  return buildGroups(model, cs, false, degree).find((group) => group.key === key)?.parts.flatMap((part) => part.ids) ?? [];
};

describe("the journey transcript: MATH 1710 B, ENGL 1310 A, CSCE 1040 A", () => {
  const plan = plannerWith(journeyTranscript, "cs");
  const { degree, model } = degreeOf(plan);

  test("111 of the 120 transcript credits are left, and what is left reads by area", () => {
    expect(degree.hours).toMatchObject({ required: 120, left: 111, fromCatalog: [], unknown: [], claimed: 0 });
    expect(leftHeadline(degree)).toBe("111 credits left");
    expect(rows(degree, "major")).toEqual([
      ["Required courses", "needed", "16 courses"],
      ["Other required courses", "needed", "EENG 2710 and TECM 2700"],
      ["CSCE core", "needed", "6 credits"],
      ["CSCE breadth courses", "needed", "6 credits"],
      ["Laboratory science", "needed", "2 selections"],
      // The major's rules the audit finds unmet stay on the list, in credits.
      ["Advanced credits: 42", "needed", "Not met yet"],
      ["Advanced credits at UNT: 24", "needed", "Not met yet"],
      ["Advanced credits in the major at UNT: 12", "needed", "Not met yet"],
    ]);
    // ENGL 1310 met Communication Group 1 and MATH 1710 met Mathematics, so neither area is listed.
    expect(rows(degree, "core").map(([name]) => name)).toEqual([
      "Communication Group 2",
      "Life and Physical Sciences",
      "Language, Philosophy and Culture",
      "Creative Arts",
      "American History",
      "Government/Political Science",
      "Social and Behavioral Sciences",
      "Component Area Option",
    ]);
  });

  test("each requirement carries the catalog heading it comes from", () => {
    const required = degree.areas[0]!.requirements[0]!;
    expect(required.citation).toMatchObject({ heading: "Major requirements", url: "https://catalog.unt.edu/preview_program.php?catoid=40&poid=21227", anchor: "MajorRequirements" });
  });

  test("advisor items carry the audit's reason, and the catalog's own words for a rule it does not check", () => {
    const electives = degree.advisor.find((item) => item.name === "CSCE advanced electives, 6 credits")!;
    expect(electives).toMatchObject({ area: "major", quote: false });
    expect(electives.text).toContain("3000- or 4000-level CSCE course");
    expect(degree.advisor.find((item) => item.name === "Minor")).toMatchObject({ quote: true, text: "Optional." });
    // A rule the audit cannot verify from the planner's record is the advisor's, with what the audit found.
    expect(degree.advisor.find((item) => item.name === "Overall GPA")?.text).toContain("Cannot verify.");
  });

  test("CSCE 1030 is still needed: covered for planning, so it is a question for an advisor, never done", () => {
    expect(degree.needed.has("CSCE 1030")).toBe(true);
    expect(degree.waivers.get("CSCE 1030")).toBe("CSCE 1040");
    expect(model.rows.get("CSCE 1030")).toMatchObject({ status: "check", waiver: "CSCE 1040", coveredBy: "CSCE 1040" });
    expect(groupIds(plan, "check")).toContain("CSCE 1030");
    expect(groupIds(plan, "done")).not.toContain("CSCE 1030");
    // Readiness is untouched: CSCE 1030 still counts toward CSCE 1040's dependents.
    expect(model.rows.get("CSCE 2100")?.status).toBe("available");
  });

  test("You can take lists only what the degree still needs, the major's first", () => {
    const { degree: audit, model: shown } = degreeOf(plan);
    const can = buildGroups(shown, cs, false, audit).find((group) => group.key === "can")!;
    expect(can.parts.map((part) => part.label)).toEqual(["For your major", "For the University Core"]);
    for (const id of can.parts.flatMap((part) => part.ids)) expect(audit.needed.has(id)).toBe(true);
    expect(can.parts[0]!.ids.slice(0, 3)).toEqual(expect.arrayContaining(["CSCE 2100", "CSCE 2110"]));
  });

  test("Auto plans only courses the degree still needs, and the preview is what the commit plans", () => {
    const preview = planAuto(profile, plan, cs).outcome;
    expect(preview.planned.length).toBeGreaterThan(0);
    for (const id of preview.planned) expect(degree.needed.has(id)).toBe(true);
    const { result } = autoTransaction(profile, cs, run)(plan);
    if (result === "major-changed") throw new Error("refused");
    expect(result.planned).toEqual(preview.planned);
  });

  test("Week's search suggests what Auto ranks first, only from what the degree still needs", () => {
    const suggestions = nextTermSuggestions(profile, plan);
    expect(suggestions.slice(0, 2)).toEqual(["MATH 1720", "CSCE 1010"]);
    for (const id of suggestions) expect(degree.needed.has(id)).toBe(true);
  });

  test("a pick that fills a requirement takes its other options out of Auto's set", () => {
    // A budget big enough for every eligible course: Social and Behavioral Sciences asks 3 credits, so one course.
    const wide = { ...profile, autoCreditBudget: 120 };
    const planned = planAuto(wide, plan, cs).outcome.planned;
    const social = degree.areas[1]!.requirements.find((row) => row.name === "Social and Behavioral Sciences")!;
    const options = outcomeOf(social).remaining.kind === "hours" ? (outcomeOf(social).remaining as { eligible: string[][] }).eligible.flat() : [];
    expect(planned.filter((id) => options.includes(id))).toHaveLength(1);
  });
});

describe("a first-year student with nothing on the record", () => {
  const plan = plannerWith([], "cs");
  const { degree } = degreeOf(plan);

  test("all 120 credits are left, and calculus counts as one course with its two routes", () => {
    expect(leftHeadline(degree)).toBe("120 credits left");
    expect(rows(degree, "major")[1]).toEqual(["Other required courses", "needed", "3 courses"]);
    const other = outcomeOf(degree.areas[0]!.requirements[1]!).remaining;
    expect(other).toMatchObject({ kind: "courses", courses: ["EENG 2710", "TECM 2700"], oneOf: [[["MATH 1710"], ["MATH 1810", "MATH 1820"]]] });
  });

  test("Auto plans only needed courses", () => {
    const outcome = planAuto(profile, plan, cs).outcome;
    for (const id of outcome.planned) expect(degree.needed.has(id)).toBe(true);
  });
});

describe("the finished 2026-2027 four-year plan", () => {
  const plan = plannerWith(completedPlan, "cs");
  const { degree } = degreeOf(plan);

  test("nothing is left; only the advisor's list remains", () => {
    expect(degree.hours.left).toBe(0);
    expect(degree.areas.flatMap((area) => area.requirements)).toEqual([]);
    expect(degree.needed.size).toBe(0);
    expect(leftHeadline(degree)).toBe("Nothing left to take");
    expect(leftNotes(degree)).toContain("Before you apply to graduate, go over the list below with an advisor.");
    expect(degree.advisor.find((item) => item.name.startsWith("CSCE advanced electives"))?.candidates).toEqual(["CSCE 4230", "CSCE 4240"]);
  });

  test("a D in a major course leaves the grade floor unmet: the page never says nothing is left", () => {
    const withD = completedPlan.map((record) => (record.code === "CSCE 1040" ? { ...record, grade: "D" } : record));
    const { degree: floor } = degreeOf(plannerWith(withD, "cs"));
    expect(rows(floor, "major")).toContainEqual(["Minimum grade of C (major courses)", "needed", "Not met yet"]);
    const row = floor.areas[0]!.requirements.find((entry) => entry.name.startsWith("Minimum grade"))!;
    expect(row.source).toEqual({ kind: "policy", detail: "Below C: CSCE 1040 (D)." });
    expect(leftHeadline(floor)).toBe("All 120 credits counted");
  });

  test("Auto plans nothing, and never MATH 1720", () => {
    const outcome = planAuto(profile, plan, cs).outcome;
    expect(outcome.planned).toEqual([]);
    expect(outcome.changes).toEqual([]);
    expect(autoTransaction(profile, cs, run)(plan).next).toBeUndefined();
  });

  test("You can take is empty, and Week's search suggests nothing: nothing the degree needs is left to take", () => {
    expect(groupIds(plan, "can")).toEqual([]);
    expect(nextTermSuggestions(profile, plan)).toEqual([]);
  });
});

describe("the final term: 105 credits finished, 15 in progress that print 0.000 earned", () => {
  const plan = plannerWith(finalTerm, "cs");
  const { degree } = degreeOf(plan);

  test("in-progress courses count at catalog credits, and ones the catalog lacks stay unknown", () => {
    expect(degree.hours).toMatchObject({ required: 120, left: null, atMost: 6, fromCatalog: ["CSCE 4240", "CSCE 4902", "PSCI 2305"], unknown: ["AGER 2250", "CSCE 4230"] });
    expect(leftHeadline(degree)).toBe("Up to about 6 credits left");
    expect(leftNotes(degree)).toEqual([
      "The 2026-2027 catalog asks 120 credits for Computer Science, BS.",
      "CSCE 4240, CSCE 4902 and PSCI 2305 count at catalog credits until grades post.",
      "UNTangle doesn't know the credits for AGER 2250 and CSCE 4230, so fewer may be left.",
    ]);
  });

  test("what this term finishes reads in progress, not needed", () => {
    // The audit's rules read finished courses only, so 39 of 42 advanced credits is not met until this term's grades post.
    expect(rows(degree, "major")).toEqual([
      ["Advanced credits: 42", "needed", "Not met yet"],
      ["Required courses", "inProgress", "Taking now"],
    ]);
    expect(rows(degree, "core")).toEqual([["Government/Political Science", "inProgress", "Taking now"]]);
    expect(degree.needed.size).toBe(0);
  });

  test("advanced credits are in progress when the known current courses reach 42", () => {
    const known = finalTerm.filter((record) => record.code !== "CSCE 4230");
    const { degree: partial } = degreeOf(plannerWith(known, "cs"));
    expect(rows(partial, "major")).toContainEqual(["Advanced credits: 42", "inProgress", "Taking now"]);
  });

  test("with every in-progress course in the catalog, the figure is exact but approximate", () => {
    const known = finalTerm.filter((record) => !["AGER 2250", "CSCE 4230"].includes(record.code));
    const { degree: partial } = degreeOf(plannerWith(known, "cs"));
    expect(partial.hours).toMatchObject({ unknown: [], fromCatalog: ["CSCE 4240", "CSCE 4902", "PSCI 2305"] });
    expect(leftHeadline(partial)).toBe(`About ${partial.hours.left} credits left`);
  });
});

describe("courses marked done by hand", () => {
  const plan = plannerWith(journeyTranscript, "cs", { manualCredit: ["CSCE 1030", "ENGL 1320"], statuses: { "CSCE 1030": "completed", "ENGL 1320": "completed" } });
  const { degree, model } = degreeOf(plan);

  test("count as claims: the requirement they meet reads marked done, never satisfied", () => {
    expect(rows(degree, "core")).toContainEqual(["Communication Group 2", "claimed", "You marked this done"]);
    expect(degree.hours).toMatchObject({ claimed: 6, left: 105 });
    expect(leftNotes(degree)).toContain("Counts 6 credits you marked done.");
    expect(degree.needed.has("CSCE 1030")).toBe(false);
    expect(model.rows.get("CSCE 1030")).toMatchObject({ status: "done", override: true });
  });

  test("a mark on a course the transcript holds is set aside, and the page says so", () => {
    const marked = plannerWith(journeyTranscript, "cs", { manualCredit: ["MATH 1710"] });
    const { degree: withMark } = degreeOf(marked);
    expect(withMark.ignoredClaims).toEqual(["MATH 1710"]);
    expect(leftNotes(withMark)).toContain("Your transcript decides MATH 1710, so your mark doesn't count.");
  });
});

describe("Computer Engineering: a specialization the audit leaves to an advisor", () => {
  // CSCE 3610 is required, and it would also finish VLSI and Electronics with CSCE 4610 and CSCE 4730 (packages/ingest/tests/degree-audit.test.ts).
  const record = ["CSCE 3610", "CSCE 4610", "CSCE 4730"].map((code) => row(code, "Spring 2026", "B", 3));
  const plan = plannerWith(record, "ce");
  const { degree } = degreeOf(plan);

  test("is one advisor item with the audit's reason, not a row per specialization", () => {
    const item = degree.advisor.find((entry) => entry.name.startsWith("Specialization area"))!;
    expect(item.name).toBe("Specialization area");
    expect(item.text).toContain("met if CSCE 3610 also counts here");
    expect(degree.areas.flatMap((area) => area.requirements).map((entry) => entry.name)).not.toContain("Three courses from Communication and Networks");
  });

  test("and none of its specializations' courses joins Auto's candidates", () => {
    // CSCE 3420 is listed only under Communication and Networks.
    expect(degree.needed.has("CSCE 3420")).toBe(false);
    const ce = getMajorById("ce")!;
    expect(planAuto({ ...profile, autoCreditBudget: 120 }, plan, ce).outcome.planned).not.toContain("CSCE 3420");
  });
});

describe("a 5000-level CSCE course on the record", () => {
  test("is not an advanced elective; the advisor item asks about it by name", () => {
    const { degree } = degreeOf(plannerWith([...journeyTranscript, row("CSCE 5200", "Spring 2026", "A", 3)], "cs"));
    const electives = degree.advisor.find((item) => item.name === "CSCE advanced electives, 6 credits")!;
    expect(electives.candidates).toEqual([]);
    expect(electives.askAbout).toEqual(["CSCE 5200"]);
    expect(degree.askAbout.get("CSCE 5200")).toBe("CSCE advanced electives, 6 credits");
  });
});

describe("rules and claims shared or overruled", () => {
  test("a rule both the major and the core print shows once", () => {
    const withD = journeyTranscript.map((record) => (record.code === "ENGL 1310" ? { ...record, grade: "D" } : record));
    const { degree } = degreeOf(plannerWith(withD, "cs"));
    const named = [...degree.areas.flatMap((area) => area.requirements), ...degree.advisor].filter((entry) => entry.name === "Communication core grade");
    expect(named).toHaveLength(1);
  });

  test("a failed 5000-level attempt marked done by hand is the transcript's: the advisor isn't asked about it", () => {
    const failed = row("CSCE 5200", "Spring 2026", "F", 0);
    // The planner's own normalizing keeps marks to catalog courses, which CSCE 5200 is not, so the mark is set after it.
    const plan = plannerWith([...journeyTranscript, { ...failed, appliedStatus: "ignored" }], "cs");
    const { degree } = degreeOf({ ...plan, coursePlan: { ...plan.coursePlan!, manualCredit: ["CSCE 5200"] } });
    expect(degree.ignoredClaims).toEqual(["CSCE 5200"]);
    expect(degree.askAbout.has("CSCE 5200")).toBe(false);
  });
});

describe("a major the audit does not cover", () => {
  test("keeps the sample core list: Auto plans from it, and the check says it covers CS and CE only", () => {
    const plan = plannerWith(journeyTranscript, "math");
    const snapshot = snapshotOf(plan);
    expect(checkDegree(profile, snapshot, buildCourseModel(profile, snapshot), getMajorById("math")!)).toEqual({ kind: "unaudited" });
    expect(planAuto(profile, plan, getMajorById("math")!).outcome.planned).toEqual(["MATH 1720"]);
    expect(nextTermSuggestions(profile, plan)).toEqual(getMajorById("math")!.coreCourseCodes);
  });
});

describe("Computer Engineering: Auto keeps one specialization", () => {
  test("uses the catalog-first specialization when completed course counts tie", () => {
    const plan = plannerWith([
      row("CSCE 3444", "Spring 2026", "B", 3),
      row("CSCE 3420", "Spring 2026", "B", 3),
    ], "ce");
    const ce = getMajorById("ce")!;
    const planned = planAuto({ ...profile, autoCreditBudget: 120 }, plan, ce).outcome.planned;
    expect(planned).not.toContain("CSCE 3530");
    expect(planned).not.toContain("CSCE 3550");
    expect(planned).not.toContain("CSCE 3610");
  });

  test("follows the specialization with more completed courses", () => {
    const plan = plannerWith([
      row("CSCE 3420", "Spring 2026", "B", 3),
      row("CSCE 3530", "Spring 2026", "B", 3),
      row("CSCE 3444", "Spring 2026", "B", 3),
    ], "ce");
    const planned = planAuto({ ...profile, autoCreditBudget: 120 }, plan, getMajorById("ce")!).outcome.planned;
    expect(planned).not.toContain("CSCE 4440");
    expect(planned).not.toContain("CSCE 4600");
  });

  test("keeps one specialization when a branch name contains the separator the choice's name uses", () => {
    // The choice's display name is "<choice> — <branch>", so a branch named
    // with " — " cannot be read back out of it. Rename the catalog-first
    // branch for this test only and restore it after.
    const choice = DEGREE_DATA.programs.find((program) => program.id === "ce-bs")!.requirements.find((node): node is ChoiceNode => node.kind === "choice")!;
    const branch = choice.branches[0]!;
    const { name, node } = branch;
    expect(name).toBe("Real-Time and Embedded Systems");
    const renamed = "Real-Time — Embedded Systems";
    branch.name = renamed;
    branch.node = { ...node, citation: { ...node.citation, heading: renamed } };
    try {
      const plan = plannerWith([
        row("CSCE 3444", "Spring 2026", "B", 3),
        row("CSCE 3420", "Spring 2026", "B", 3),
      ], "ce");
      const planned = planAuto({ ...profile, autoCreditBudget: 120 }, plan, getMajorById("ce")!).outcome.planned;
      expect(planned).not.toContain("CSCE 3530");
      expect(planned).not.toContain("CSCE 3550");
      expect(planned).not.toContain("CSCE 3610");
    } finally {
      branch.name = name;
      branch.node = node;
    }
  });
});
