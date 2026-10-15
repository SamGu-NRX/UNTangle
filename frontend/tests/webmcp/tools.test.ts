/**
 * The WebMCP tools on a fixture plan: what each read returns, that no
 * output depends on the student's grades, that a write needs the student's
 * yes and can be undone, and that bad input changes nothing.
 */
import { describe, expect, test } from "bun:test";
import { undoBlocker } from "@/components/courses/model/auto";
import { optionLabel, optionsConflict } from "@/lib/planner-sections";
import { createTools, type PlannerPort, type Tool, type ToolResult } from "@/lib/webmcp/tools";
import { fixturePlan, fixturePort, row, samplesOf, session } from "./fixture";

const named = (tools: Tool[], name: string) => tools.find((tool) => tool.name === name)!;
type Alternative = { id: string; changes: number };
/** Lets a call reach its optimizer search, past the section load it awaits first. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

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
    expect(items.map((item) => item.id)).toEqual(samplesOf("CSCE 1040").map((section) => section.id));
    expect(items[0].meetings).toMatch(/^(Mon|Tue|Wed|Thu|Fri)(\/(Mon|Tue|Wed|Thu|Fri))* \d\d:\d\d-\d\d:\d\d at \S+/);
    expect(await call("get_course", { code: "CSCE 9999" })).toEqual({ ok: false, reason: "unknown_course" });
  });

  test("check_eligibility separates met, unmet and unknown requirements", async () => {
    expect(await call("check_eligibility", { code: "MATH 1720" })).toMatchObject({ verdict: "eligible", met: ["MATH 1710"], unmet: [] });
    // Planning CSCE 1040 does not meet the completed C-or-better prerequisite.
    expect(await call("check_eligibility", { code: "CSCE 2110" })).toMatchObject({
      verdict: "not_eligible",
      met: [],
      unmet: ["CSCE 1040", "CSCE 1045"],
      unknown: [],
    });
  });

  test("get_schedule lists the planned week with credits and walking", async () => {
    const result = await call("get_schedule", {});
    expect(result).toMatchObject({ ok: true, credits: 9, overlaps: [] });
    const courses = result.courses as Array<{ code: string; state: string; section: string; provenance: string; locked: boolean }>;
    expect(courses.map((course) => course.code)).toEqual(["CSCE 1040", "ENGL 1310", "PSYC 1630"]);
    for (const course of courses) {
      // Nothing is picked yet, so the page shows the goal's recommendation for each course.
      expect(course).toMatchObject({ state: "recommended", provenance: "sample", locked: false });
      expect(samplesOf(course.code).some((s) => optionLabel(s) === course.section)).toBe(true);
    }
    expect(result.walking).toMatchObject({ unknownWalks: 0, estimated: false });
  });

  test("get_day flags a walk longer than the break, with the time to leave", async () => {
    // The map journey's Monday: ENV 9:30-10:50, GAB 12:00-12:50, GATE 13:00-13:50.
    const monday = { "ANTH 3700": "anth-3700-002", "ANTH 1010": "anth-1010-003", "BIOL 1720": "biol-1720-016" };
    const plan = fixturePlan({}, { "CSCE 1040": "notTaken", "ENGL 1310": "notTaken", "PSYC 1630": "notTaken", ...Object.fromEntries(Object.keys(monday).map((code) => [code, "inProgress" as const])) });
    const result = await call("get_day", { day: "Mon" }, fixturePort(plan, monday).port);
    expect(result.classes).toEqual([
      { code: "ANTH 3700", start: "09:30", end: "10:50", room: "Environmental Science Building" },
      { code: "ANTH 1010", start: "12:00", end: "12:50", room: "General Academic Building" },
      { code: "BIOL 1720", start: "13:00", end: "13:50", room: "Gateway Center" },
    ]);
    const [, late] = result.walks as Array<{ from: string; to: string; gapMinutes: number; minutes: number; leaveBy: string; fit: string }>;
    expect(late).toMatchObject({ from: "ANTH 1010", to: "BIOL 1720", gapMinutes: 10, travel: "walk", fit: "late" });
    expect(late.minutes).toBeGreaterThan(10);
    expect(late.leaveBy < "12:50").toBe(true);
  });

  test("build_schedule returns ranked alternatives and changes nothing", async () => {
    const { port, writes, snapshot } = fixturePort();
    const before = snapshot();
    const result = await call("build_schedule", { goal: "compact", daysOff: ["Fri"] }, port);
    expect(result).toMatchObject({ ok: true, status: "optimal" });
    const alternatives = result.alternatives as Array<{ id: string; sections: Record<string, string>; daysOnCampus: number }>;
    expect(alternatives.map((alt) => alt.id)).toEqual(["opt-1-A", "opt-1-B", "opt-1-C"].slice(0, alternatives.length));
    for (const alt of alternatives) expect(Object.keys(alt.sections).sort()).toEqual(["CSCE 1040", "ENGL 1310", "PSYC 1630"]);
    expect(snapshot()).toEqual(before);
    expect(writes).toEqual([]);
  });

  test("export_class_numbers lists courses with only sample sections as missing", async () => {
    expect(await call("export_class_numbers", {})).toEqual({ ok: true, lines: [], classNumbers: 0, missing: ["CSCE 1040", "ENGL 1310", "PSYC 1630"] });
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
      actions: ["commit"],
      setup: (tools, port) => named(tools, "build_schedule").run({}, session(port, true).ctx),
    },
    { name: "add_section", input: { code: "MATH 1720", sectionId: "001" }, actions: ["commit"] },
    { name: "remove_course", input: { code: "PSYC 1630" }, actions: ["commit"] },
    { name: "set_busy_times", input: { blocks: [{ day: "Tue", start: "09:00", end: "11:00", label: "Work" }] }, actions: ["preferences"] },
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
      expect(await undos[0]()).toBe(true);
      expect(snapshot()).toEqual(before);
    });
  }

  test("Undo is refused once the plan was replaced", async () => {
    const tools = createTools();
    const { port, snapshot, student } = fixturePort();
    const { ctx, undos } = session(port, true);
    await named(tools, "remove_course").run({ code: "PSYC 1630" }, ctx);
    const after = snapshot();
    student.replacePlan();
    expect(await undos[0]()).toBe(false);
    expect(snapshot()).toEqual(after);
  });

  test("an alternative found under other settings is refused without asking", async () => {
    const tools = createTools();
    const { port, writes, student } = fixturePort();
    await named(tools, "build_schedule").run({}, session(port, true).ctx);
    student.setPreferences((p) => ({ ...p, constraints: { ...p.constraints, maxCredits: 12 } }));
    const { ctx, asked } = session(port, true);
    expect(await named(tools, "apply_alternative").run({ id: "opt-1-B" }, ctx)).toMatchObject({ ok: false, reason: "cannot_apply" });
    expect(asked).toEqual([]);
    expect(writes).toEqual([]);
  });

  test("add_section names the overlap before asking", async () => {
    const { port } = fixturePort();
    const taken = port.sectionPlan().courses.flatMap((course) => (course.section ? [course.section] : []));
    const clashing = samplesOf("MATH 1720").find((section) => taken.some((other) => optionsConflict(section, other)))!;
    const { ctx, asked } = session(port, true);
    const result = await named(createTools(), "add_section").run({ code: "MATH 1720", sectionId: clashing.id }, ctx);
    const overlaps = /It overlaps (.+)\.$/.exec(asked[0])?.[1].split(" and ");
    expect(overlaps?.length).toBeGreaterThan(0);
    expect(result).toEqual({ ok: true, changed: true, overlapsWith: overlaps, notes: [] });
  });
});

describe("invalid input", () => {
  const bad: Array<[string, unknown]> = [
    ["get_course", {}],
    ["get_course", { code: 1030 }],
    ["get_course", { code: "CSCE 1030", extra: true }],
    ["search_courses", { query: "x".repeat(81) }],
    ["get_day", { day: "Monday" }],
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

describe("writes stay bound to what the student approved", () => {
  test("apply_alternative refuses when another tab moved a course while the student decided", async () => {
    const tools = createTools();
    const { port, writes, student } = fixturePort();
    await named(tools, "build_schedule").run({}, session(port, true).ctx);
    const alternative = port.plan().selectedSections;
    // Another tab picks a different ENGL 1310 section while the dialog is open.
    const other = samplesOf("ENGL 1310").find((s) => s.id !== alternative["ENGL 1310"])!;
    const { ctx } = session(port, true, () => student.setSection("ENGL 1310", other.id));
    expect(await named(tools, "apply_alternative").run({ id: "opt-1-B" }, ctx)).toMatchObject({ ok: false, reason: "plan_changed" });
    expect(writes).toEqual([]);
    expect(port.plan().selectedSections["ENGL 1310"]).toBe(other.id);
  });

  test("set_busy_times Undo puts back what it replaced at save time, not what was there before the question", async () => {
    const { port, student } = fixturePort();
    const tab = [{ id: "tab", label: "Practice", day: "Wed" as const, start: 900, end: 1000 }];
    const { ctx, undos } = session(port, true, () =>
      student.setPreferences((p) => ({ ...p, constraints: { ...p.constraints, blocked: tab } })),
    );
    await named(createTools(), "set_busy_times").run({ blocks: [{ day: "Tue", start: "09:00", end: "11:00" }] }, ctx);
    expect(await undos[0]()).toBe(true);
    expect(port.preferences().constraints.blocked).toEqual(tab);
  });

  test("set_busy_times Undo is refused once the busy times changed again", async () => {
    const { port, student } = fixturePort();
    const { ctx, undos } = session(port, true);
    await named(createTools(), "set_busy_times").run({ blocks: [{ day: "Tue", start: "09:00", end: "11:00" }] }, ctx);
    student.setPreferences((p) => ({ ...p, constraints: { ...p.constraints, blocked: [] } }));
    expect(await undos[0]()).toBe(false);
    expect(port.preferences().constraints.blocked).toEqual([]);
  });

  test("Undo restores only the course it changed and keeps later edits elsewhere", async () => {
    const { port, student } = fixturePort();
    const { ctx, undos } = session(port, true);
    await named(createTools(), "remove_course").run({ code: "PSYC 1630" }, ctx);
    const other = samplesOf("ENGL 1310").find((s) => s.id !== port.plan().selectedSections["ENGL 1310"])!;
    student.setSection("ENGL 1310", other.id);
    expect(await undos[0]()).toBe(true);
    expect(port.plan().courseStatuses["PSYC 1630"]).toBe("inProgress");
    expect(port.plan().selectedSections["ENGL 1310"]).toBe(other.id);
  });

  test("Undo gives Auto-fill its Undo back when the write is what took it away", async () => {
    const plan = fixturePlan();
    const run = { id: "auto-1", at: "2026-10-01T00:00:00.000Z", major: null, changes: [{ code: "PSYC 1630", from: "notTaken" as const, to: "inProgress" as const }], autoPlannedBefore: [], summary: "", needsCheck: [] };
    const { port } = fixturePort({ ...plan, coursePlan: { manualCredit: [], autoPlanned: ["PSYC 1630"], lastAuto: run } });
    const { ctx, undos } = session(port, true);
    await named(createTools(), "remove_course").run({ code: "PSYC 1630" }, ctx);
    expect(port.plan().coursePlan?.lastAuto?.invalidatedBy).toBe("PSYC 1630");
    expect(await undos[0]()).toBe(true);
    expect(port.plan().coursePlan).toEqual({ manualCredit: [], autoPlanned: ["PSYC 1630"], lastAuto: run });
  });

  test("Undo leaves Auto-fill's Undo off when the student edited another course of that run since", async () => {
    // One Auto run planned both PSYC 1630 and ENGL 1310; Auto Undo would unplan both.
    const plan = fixturePlan({}, { "PSYC 1630": "inProgress", "ENGL 1310": "inProgress" });
    const changes = ["PSYC 1630", "ENGL 1310"].map((code) => ({ code, from: "notTaken" as const, to: "inProgress" as const }));
    const run = { id: "auto-2", at: "2026-10-01T00:00:00.000Z", major: null, changes, autoPlannedBefore: [], summary: "", needsCheck: [] };
    const { port, student } = fixturePort({ ...plan, coursePlan: { manualCredit: [], autoPlanned: ["PSYC 1630", "ENGL 1310"], lastAuto: run } });
    const { ctx, undos } = session(port, true);
    await named(createTools(), "remove_course").run({ code: "PSYC 1630" }, ctx);
    // The student then picks another ENGL 1310 section by hand; invalidatedBy already names PSYC, so it records nothing new.
    student.setSection("ENGL 1310", samplesOf("ENGL 1310").find((s) => s.id !== port.plan().selectedSections["ENGL 1310"])!.id);
    expect(await undos[0]()).toBe(true);
    expect(port.plan().courseStatuses["PSYC 1630"]).toBe("inProgress");
    expect(undoBlocker(port.plan().coursePlan!.lastAuto!, port.plan().courseStatuses, port.plan().selectedMajor)).not.toBeNull();
  });

  test("Undo leaves Auto-fill's Undo off after another course of the run was changed and changed back", async () => {
    const plan = fixturePlan({}, { "PSYC 1630": "inProgress", "ENGL 1310": "inProgress" });
    const changes = ["PSYC 1630", "ENGL 1310"].map((code) => ({ code, from: "notTaken" as const, to: "inProgress" as const }));
    const run = { id: "auto-3", at: "2026-10-01T00:00:00.000Z", major: null, changes, autoPlannedBefore: [], summary: "", needsCheck: [] };
    const { port, student } = fixturePort({ ...plan, coursePlan: { manualCredit: [], autoPlanned: ["PSYC 1630", "ENGL 1310"], lastAuto: run } });
    const { ctx, undos } = session(port, true);
    await named(createTools(), "remove_course").run({ code: "PSYC 1630" }, ctx);
    const original = port.plan().selectedSections["ENGL 1310"];
    student.setSection("ENGL 1310", samplesOf("ENGL 1310").find((s) => s.id !== original)!.id);
    student.setSection("ENGL 1310", original);
    expect(await undos[0]()).toBe(true);
    expect(port.plan().coursePlan?.lastAuto?.invalidatedBy).toBe("PSYC 1630");
  });

  test("set_busy_times changes nothing when the call is cancelled after the student said yes", async () => {
    const { port, writes } = fixturePort();
    const controller = new AbortController();
    const { ctx, undos } = session(port, true, () => controller.abort());
    const result = await named(createTools(), "set_busy_times").run({ blocks: [{ day: "Tue", start: "09:00", end: "11:00" }] }, { ...ctx, signal: controller.signal });
    expect(result).toEqual({ ok: false, reason: "cancelled" });
    expect(writes).toEqual([]);
    expect(undos).toEqual([]);
    expect(port.preferences().constraints.blocked).toEqual([]);
  });

  test("add_section refuses a course already passed or in progress on the transcript", async () => {
    const plan = fixturePlan();
    const { port, writes } = fixturePort({ ...plan, transcriptRecords: [...plan.transcriptRecords, row("BIOL 1710", "IP", "inProgress")], courseStatuses: { ...plan.courseStatuses, "BIOL 1710": "inProgress" } });
    const tools = createTools();
    expect(await named(tools, "add_section").run({ code: "CSCE 1030", sectionId: "001" }, session(port, true).ctx)).toMatchObject({ reason: "not_plannable" });
    expect(await named(tools, "add_section").run({ code: "BIOL 1710", sectionId: "001" }, session(port, true).ctx)).toMatchObject({ reason: "not_plannable" });
    expect(writes).toEqual([]);
  });

});

describe("build_schedule runs one search at a time", () => {
  /** An optimizer that waits to be released and rejects when its signal aborts. */
  function heldPort() {
    const { port } = fixturePort();
    const held: Array<{ release: () => void; signal: AbortSignal }> = [];
    const holding: PlannerPort = {
      ...port,
      optimize: (request, signal) =>
        new Promise((resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason));
          held.push({ release: () => port.optimize(request, signal).then(resolve), signal });
        }),
    };
    return { port: holding, held };
  }

  test("a newer build cancels the older one, whose ids never become usable", async () => {
    const { port, held } = heldPort();
    const tools = createTools();
    const older = named(tools, "build_schedule").run({}, session(port, true).ctx);
    await tick();
    const newer = named(tools, "build_schedule").run({ goal: "compact" }, session(port, true).ctx);
    await tick();
    expect(held[0].signal.aborted).toBe(true);
    expect(await older).toEqual({ ok: false, reason: "cancelled" });
    held[1].release();
    const result = (await newer) as Record<string, unknown>;
    expect(result.alternatives).toContainEqual(expect.objectContaining({ id: "opt-2-A", unknownWalks: expect.any(Number) }));
    expect(await call("apply_alternative", { id: "opt-1-A" }, port, tools)).toMatchObject({ reason: "unknown_alternative" });
  });

  test("a build still loading sections when a newer one starts never replaces it", async () => {
    const { port } = fixturePort();
    let release = () => {};
    let held = true;
    // The first call's section load is held (a course still loading); later loads answer at once, as the live port does.
    const holding: PlannerPort = {
      ...port,
      load: (codes, signal) =>
        held
          ? ((held = false),
            new Promise<void>((resolve) => {
              release = resolve;
              signal.addEventListener("abort", () => resolve());
            }))
          : port.load(codes, signal),
    };
    const tools = createTools();
    const older = named(tools, "build_schedule").run({}, session(holding, true).ctx);
    await tick();
    const newer = (await named(tools, "build_schedule").run({ goal: "compact" }, session(holding, true).ctx)) as { ok: boolean; alternatives: Alternative[] };
    expect(newer.ok).toBe(true);
    release();
    expect(await older).toEqual({ ok: false, reason: "cancelled" });
    const id = newer.alternatives.find((alt) => alt.changes > 0)?.id ?? newer.alternatives[0].id;
    expect(await named(tools, "apply_alternative").run({ id }, session(holding, true).ctx)).toMatchObject({ ok: true });
  });

  test("the agent cancelling the call stops the search", async () => {
    const { port, held } = heldPort();
    const controller = new AbortController();
    const result = named(createTools(), "build_schedule").run({}, { ...session(port, true).ctx, signal: controller.signal });
    await tick();
    controller.abort();
    expect(held[0].signal.aborted).toBe(true);
    expect(await result).toEqual({ ok: false, reason: "cancelled" });
  });
});

test("check_eligibility names the requirement a closure proves, not the course that proves it", async () => {
  // ECON 3050 needs ECON 1100 and ECON 1110; passing ECON 4030 proves both through its own prerequisites.
  const port = fixturePort(fixturePlan({ "ECON 4030": "A" })).port;
  expect(await call("check_eligibility", { code: "ECON 3050" }, port)).toMatchObject({ verdict: "eligible", met: ["ECON 1100", "ECON 1110"], unmet: [], unknown: [] });
});
