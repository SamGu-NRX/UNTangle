/**
 * The WebMCP tools on a fixture plan: what each read returns, that no
 * output depends on the student's grades, that a write needs the student's
 * yes and can be undone, and that bad input changes nothing.
 */
import { describe, expect, test } from "bun:test";
import { findSection } from "@/components/schedule/week-model";
import { optimize } from "@/lib/optimizer/optimize";
import { defaultSchedulePreferences, getInitialPlannerState, getSectionsForCourse, normalizePlannerState, sectionConflicts } from "@/lib/planner";
import type { CourseStatus, PlannerState, SchedulePreferences, TranscriptCourseRecord } from "@/lib/types";
import { createTools, type PlannerPort, type Tool, type ToolResult } from "@/lib/webmcp/tools";

const row = (code: string, grade: string): TranscriptCourseRecord => ({
  id: `t-${code}`,
  code,
  title: code,
  term: "Fall 2025",
  grade,
  credits: 3,
  sourceKind: "unt",
  confidence: 1,
  rationale: "fixture",
  duplicateExcluded: false,
  appliedStatus: "completed",
  prerequisiteSatisfied: true,
  reviewRequired: false,
});

/** Passed MATH 1710 and CSCE 1030; plans CSCE 1040, ENGL 1310 and PSYC 1630. */
function fixturePlan(grades: Record<string, string> = { "MATH 1710": "A", "CSCE 1030": "B" }, extra: Record<string, CourseStatus> = {}): PlannerState {
  const initial = getInitialPlannerState();
  return {
    ...initial,
    transcriptRecords: Object.entries(grades).map(([code, grade]) => row(code, grade)),
    courseStatuses: {
      ...initial.courseStatuses,
      ...Object.fromEntries(Object.keys(grades).map((code) => [code, "completed" as const])),
      "CSCE 1040": "inProgress",
      "ENGL 1310": "inProgress",
      "PSYC 1630": "inProgress",
      ...extra,
    },
  };
}

/** The provider's actions on plain state, recording which ran. */
function fixturePort(start: PlannerState = fixturePlan(), selected: Record<string, string> = {}) {
  let plan = normalizePlannerState({ ...start, selectedSections: { ...start.selectedSections, ...selected } });
  let preferences: SchedulePreferences = defaultSchedulePreferences(plan.optimization);
  let epoch = 1;
  const writes: string[] = [];
  const set = (next: PlannerState) => (plan = normalizePlannerState(next));
  const port: PlannerPort = {
    plan: () => plan,
    preferences: () => preferences,
    epoch: () => epoch,
    // A node budget instead of the clock, so every run gives the same answer.
    optimize: async (request) => optimize({ ...request, timeBudgetMs: Number.POSITIVE_INFINITY, maxNodes: 200_000 }),
    applySchedule: (byCourse, goal) => {
      writes.push("applySchedule");
      set({ ...plan, selectedSections: { ...plan.selectedSections, ...byCourse }, optimization: goal ?? plan.optimization });
    },
    restoreSchedule: ({ sections, goal }) => {
      writes.push("restoreSchedule");
      set({ ...plan, selectedSections: { ...sections }, optimization: goal });
    },
    setSection: (code, sectionId) => {
      writes.push("setSection");
      set({ ...plan, selectedSections: { ...plan.selectedSections, [code]: sectionId } });
    },
    updateCoursePlan: (update) => {
      writes.push("updateCoursePlan");
      const next = update({ courseStatuses: plan.courseStatuses, coursePlan: plan.coursePlan! });
      set({ ...plan, courseStatuses: next.courseStatuses ?? plan.courseStatuses, coursePlan: next.coursePlan ?? plan.coursePlan });
    },
    setSchedulePreferences: (update) => {
      writes.push("setSchedulePreferences");
      preferences = update(preferences);
    },
  };
  return { port, writes, snapshot: () => structuredClone({ plan, preferences }), replacePlan: () => (epoch += 1) };
}

function session(port: PlannerPort, answer: boolean) {
  const asked: string[] = [];
  const undos: Array<() => boolean> = [];
  return {
    asked,
    undos,
    ctx: {
      port,
      confirm: async (question: string) => {
        asked.push(question);
        return answer;
      },
      applied: (_message: string, undo: () => boolean) => undos.push(undo),
    },
  };
}

const named = (tools: Tool[], name: string) => tools.find((tool) => tool.name === name)!;

async function call(name: string, input: unknown, port: PlannerPort = fixturePort().port, tools = createTools()): Promise<Record<string, unknown>> {
  return (await named(tools, name).run(input, session(port, true).ctx)) as Record<string, unknown>;
}

describe("read tools", () => {
  test("search_courses ranks a typed code first and gives the student's status", async () => {
    const result = await call("search_courses", { query: "csce 1030" });
    expect(result).toMatchObject({ ok: true, courses: [{ code: "CSCE 1030", title: "Computer Science I", credits: 3, status: "done" }] });
  });

  test("get_course normalizes the code and marks bundled sections as samples", async () => {
    const result = await call("get_course", { code: "csce1040" });
    expect(result).toMatchObject({
      ok: true,
      code: "CSCE 1040",
      credits: 3,
      status: "planned",
      inPlan: true,
      prerequisites: "CSCE 1030 (C or better) and (MATH 1100, MATH 1650 or MATH 1710) with C or better",
      sections: { provenance: "sample", total: 6 },
    });
    const items = (result.sections as { items: Array<{ id: string; meetings: string }> }).items;
    expect(items.map((item) => item.id)).toEqual(getSectionsForCourse("CSCE 1040").map((section) => section.id));
    expect(items[0].meetings).toMatch(/^(Mon|Tue|Wed|Thu|Fri)(\/(Mon|Tue|Wed|Thu|Fri))* \d\d:\d\d-\d\d:\d\d at \S+/);
    expect(await call("get_course", { code: "CSCE 9999" })).toEqual({ ok: false, reason: "unknown_course" });
  });

  test("check_eligibility separates met, unmet and unknown requirements", async () => {
    expect(await call("check_eligibility", { code: "MATH 1720" })).toMatchObject({ verdict: "eligible", met: ["MATH 1710"], unmet: [] });
    // Planning CSCE 1040 is not passing it; the corequisite clause is catalog prose the engine cannot check.
    expect(await call("check_eligibility", { code: "CSCE 2110" })).toMatchObject({
      verdict: "check_with_advisor",
      met: [],
      unmet: ["CSCE 1040", "CSCE 1045"],
      unknown: ["This course can be taken concurrently with CSCE 2100"],
    });
  });

  test("get_schedule lists the planned week with credits and walking", async () => {
    const result = await call("get_schedule", {});
    expect(result).toMatchObject({ ok: true, provenance: "sample", credits: 9, overlaps: [], withoutSections: [] });
    const courses = result.courses as Array<{ code: string; sectionId: string; locked: boolean }>;
    expect(courses.map((course) => course.code)).toEqual(["CSCE 1040", "ENGL 1310", "PSYC 1630"]);
    for (const course of courses) expect(getSectionsForCourse(course.code).some((s) => s.id === course.sectionId)).toBe(true);
    expect(result.walking).toMatchObject({ unknownWalks: 0, estimated: false });
  });

  test("get_day flags a walk longer than the break, with the time to leave", async () => {
    // The map journey's Monday: ENV 9:30-10:50, GAB 12:00-12:50, GATE 13:00-13:50.
    const monday = { "ANTH 3700": "anth-3700-002", "ANTH 1010": "anth-1010-003", "BIOL 1720": "biol-1720-016" };
    const plan = fixturePlan({}, { "CSCE 1040": "notTaken", "ENGL 1310": "notTaken", "PSYC 1630": "notTaken", ...Object.fromEntries(Object.keys(monday).map((code) => [code, "inProgress" as const])) });
    const result = await call("get_day", { day: "Mon" }, fixturePort(plan, monday).port);
    expect(result.classes).toEqual([
      { code: "ANTH 3700", start: "09:30", end: "10:50", building: "ENV" },
      { code: "ANTH 1010", start: "12:00", end: "12:50", building: "GAB" },
      { code: "BIOL 1720", start: "13:00", end: "13:50", building: "GATE" },
    ]);
    const [, late] = result.walks as Array<{ from: string; to: string; gapMinutes: number; walkMinutes: number; leaveBy: string; fit: string }>;
    expect(late).toMatchObject({ from: "ANTH 1010", to: "BIOL 1720", gapMinutes: 10, fit: "late" });
    expect(late.walkMinutes).toBeGreaterThan(10);
    expect(late.leaveBy < "12:50").toBe(true);
  });

  test("build_schedule returns ranked alternatives and changes nothing", async () => {
    const { port, writes, snapshot } = fixturePort();
    const before = snapshot();
    const result = await call("build_schedule", { goal: "compact", daysOff: ["Fri"] }, port);
    expect(result).toMatchObject({ ok: true, status: "optimal", provenance: "sample" });
    const alternatives = result.alternatives as Array<{ id: string; sections: Record<string, string>; daysOnCampus: number }>;
    expect(alternatives.map((alt) => alt.id)).toEqual(["opt-1-A", "opt-1-B", "opt-1-C"].slice(0, alternatives.length));
    for (const alt of alternatives) expect(Object.keys(alt.sections).sort()).toEqual(["CSCE 1040", "ENGL 1310", "PSYC 1630"]);
    expect(snapshot()).toEqual(before);
    expect(writes).toEqual([]);
  });

  test("export_class_numbers says sample sections have no class numbers", async () => {
    const result = await call("export_class_numbers", {});
    expect(result).toMatchObject({ ok: true, provenance: "sample" });
    expect(result.courses).toHaveLength(3);
    for (const course of result.courses as Array<{ classNumber: unknown }>) expect(course.classNumber).toBeNull();
  });
});

describe("grades never reach the agent", () => {
  const reads = async (grades: Record<string, string>, codes: string[]) => {
    const port = fixturePort(fixturePlan(grades)).port;
    const tools = createTools();
    return Promise.all(codes.flatMap((code) => ["check_eligibility", "get_course"].map((name) => call(name, { code }, port, tools))));
  };

  test("swapping two passing grades leaves every answer the same", async () => {
    const codes = ["MATH 1720", "CSCE 1040", "CSCE 2110", "CSCE 1030", "MATH 1710"];
    const first = await reads({ "MATH 1710": "A", "CSCE 1030": "B" }, codes);
    expect(await reads({ "MATH 1710": "B", "CSCE 1030": "A" }, codes)).toEqual(first);
    expect(JSON.stringify(first)).not.toMatch(/recorded grade/i);
  });

  test("two grades below the minimum give the same answer", async () => {
    const [low] = await reads({ "MATH 1710": "D" }, ["MATH 1720"]);
    expect(low).toMatchObject({ verdict: "not_eligible", unmet: ["MATH 1710"] });
    expect((await reads({ "MATH 1710": "F" }, ["MATH 1720"]))[0]).toEqual(low);
  });
});

describe("write tools", () => {
  /** Each write with input that changes the fixture plan, and the actions it should run once approved. */
  const cases: Array<{ name: string; input: unknown; actions: string[]; setup?: (tools: Tool[], port: PlannerPort) => Promise<unknown> }> = [
    {
      name: "apply_alternative",
      input: { id: "opt-1-B" },
      actions: ["applySchedule"],
      setup: (tools, port) => named(tools, "build_schedule").run({}, session(port, true).ctx),
    },
    { name: "add_section", input: { code: "MATH 1720", sectionId: "001" }, actions: ["updateCoursePlan", "setSection"] },
    { name: "remove_course", input: { code: "PSYC 1630" }, actions: ["updateCoursePlan"] },
    { name: "set_busy_times", input: { blocks: [{ day: "Tue", start: "09:00", end: "11:00", label: "Work" }] }, actions: ["setSchedulePreferences"] },
  ];

  for (const { name, input, actions, setup } of cases) {
    test(`${name} does nothing when the student says no`, async () => {
      const tools = createTools();
      const { port, writes, snapshot } = fixturePort();
      await setup?.(tools, port);
      const before = snapshot();
      const { ctx, asked, undos } = session(port, false);
      expect(await named(tools, name).run(input, ctx)).toEqual({ ok: false, reason: "declined" });
      expect(asked).toHaveLength(1);
      expect(writes).toEqual([]);
      expect(undos).toEqual([]);
      expect(snapshot()).toEqual(before);
    });

    test(`${name} acts once when the student says yes, and Undo puts the plan back`, async () => {
      const tools = createTools();
      const { port, writes, snapshot } = fixturePort();
      await setup?.(tools, port);
      const before = snapshot();
      const { ctx, asked, undos } = session(port, true);
      expect((await named(tools, name).run(input, ctx)).ok).toBe(true);
      expect(asked).toHaveLength(1);
      expect(writes).toEqual(actions);
      expect(snapshot()).not.toEqual(before);
      expect(undos).toHaveLength(1);
      expect(undos[0]()).toBe(true);
      expect(snapshot()).toEqual(before);
    });
  }

  test("Undo is refused once the plan was replaced", async () => {
    const tools = createTools();
    const { port, snapshot, replacePlan } = fixturePort();
    const { ctx, undos } = session(port, true);
    await named(tools, "remove_course").run({ code: "PSYC 1630" }, ctx);
    const after = snapshot();
    replacePlan();
    expect(undos[0]()).toBe(false);
    expect(snapshot()).toEqual(after);
  });

  test("an alternative found under other settings is refused without asking", async () => {
    const tools = createTools();
    const { port, writes } = fixturePort();
    await named(tools, "build_schedule").run({}, session(port, true).ctx);
    port.setSchedulePreferences((p) => ({ ...p, constraints: { ...p.constraints, maxCredits: 12 } }));
    const { ctx, asked } = session(port, true);
    expect(await named(tools, "apply_alternative").run({ id: "opt-1-B" }, ctx)).toMatchObject({ ok: false, reason: "cannot_apply" });
    expect(asked).toEqual([]);
    expect(writes).toEqual(["setSchedulePreferences"]);
  });

  test("add_section names the overlap before asking", async () => {
    const { port } = fixturePort();
    const taken = Object.values(port.plan().selectedSections).map((id) => findSection(id)!);
    const clashing = getSectionsForCourse("MATH 1720").find((section) => sectionConflicts(section, taken))!;
    const { ctx, asked } = session(port, true);
    const result = await named(createTools(), "add_section").run({ code: "MATH 1720", sectionId: clashing.id }, ctx);
    const overlaps = /It overlaps (.+)\.$/.exec(asked[0])?.[1].split(" and ");
    expect(overlaps?.length).toBeGreaterThan(0);
    expect(result).toEqual({ ok: true, changed: true, overlapsWith: overlaps });
  });
});

describe("invalid input", () => {
  const bad: Array<[string, unknown]> = [
    ["get_course", {}],
    ["get_course", { code: 1030 }],
    ["get_course", { code: "CSCE 1030", extra: true }],
    ["search_courses", { query: "x".repeat(81) }],
    ["get_day", { day: "Sat" }],
    ["build_schedule", { earliestStart: "7am" }],
    ["build_schedule", { maxCredits: 2.5 }],
    ["apply_alternative", { id: "opt-1-D" }],
    ["add_section", { code: "CSCE 1030" }],
    ["set_busy_times", { blocks: Array.from({ length: 21 }, () => ({ day: "Mon", start: "09:00", end: "10:00" })) }],
    ["set_busy_times", { blocks: [{ day: "Mon", start: "11:00", end: "10:00" }] }],
  ];

  for (const [name, input] of bad) {
    test(`${name} rejects ${JSON.stringify(input).slice(0, 60)}`, async () => {
      const { port, writes } = fixturePort();
      const { ctx, asked } = session(port, true);
      const result: ToolResult = await named(createTools(), name).run(input, ctx);
      expect(result).toMatchObject({ ok: false, reason: "invalid_input" });
      expect(asked).toEqual([]);
      expect(writes).toEqual([]);
    });
  }
});
