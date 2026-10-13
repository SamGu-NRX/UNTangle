/**
 * WebMCP writes against the real PlannerProvider, with the student's edit
 * still queued when the tool acts: the tool reads the last render, so only
 * planner-provider's transact sees the edit. Each probe is from the Sol
 * review of 8e35224.
 */
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { installDom, mountPlanner, removeDom, setSession, waitFor, type PlannerValue } from "../planner/test-dom";
import { getSectionsForCourse } from "@/lib/planner";
import { createTools, type PlannerPort, type Tool } from "@/lib/webmcp/tools";
import { session } from "./fixture";

const mounted: Array<() => Promise<void>> = [];
beforeAll(() => {
  installDom();
});
afterAll(() => {
  removeDom();
});
beforeEach(() => {
  window.localStorage.clear();
  setSession(null);
});
afterEach(async () => {
  while (mounted.length) await mounted.pop()!();
});

const PLANNED = ["CSCE 1040", "ENGL 1310", "PSYC 1630"];

/** The real provider with three planned courses, and the bridge's port over its last render. */
async function plannerWithCourses() {
  const planner = await mountPlanner();
  mounted.push(planner.unmount);
  await planner.get().afterHydration();
  await planner.run((p) =>
    p.updateCoursePlan(({ courseStatuses, coursePlan }) => ({
      courseStatuses: { ...courseStatuses, ...Object.fromEntries(PLANNED.map((code) => [code, "inProgress" as const])) },
      coursePlan,
    })),
  );
  await waitFor(() => PLANNED.every((code) => planner.get().plannerState.selectedSections[code]), "sections shown");
  const { livePort } = await import("@/components/webmcp/WebMcpBridge");
  return { planner, port: livePort(planner.get) };
}

const named = (tools: Tool[], name: string) => tools.find((tool) => tool.name === name)!;
const planned = (planner: { get: () => PlannerValue }, code: string) => planner.get().plannerState.courseStatuses[code] === "inProgress";
const otherSection = (port: PlannerPort, code: string) => getSectionsForCourse(code).find((s) => s.id !== port.plan().selectedSections[code])!.id;

test("a lock queued while the student decides stops remove_course", async () => {
  const { planner, port } = await plannerWithCourses();
  const { ctx } = session(port, true, () => planner.get().setSectionLock("PSYC 1630", true));
  expect(await named(createTools(), "remove_course").run({ code: "PSYC 1630" }, ctx)).toMatchObject({ ok: false, reason: "course_locked" });
  await waitFor(() => Boolean(planner.get().plannerState.lockedSections?.["PSYC 1630"]), "lock rendered");
  expect(planned(planner, "PSYC 1630")).toBe(true);
});

test("a section change queued while the student decides stops apply_alternative", async () => {
  const { planner, port } = await plannerWithCourses();
  const tools = createTools();
  const built = await named(tools, "build_schedule").run({}, session(port, true).ctx);
  if (!built.ok) throw new Error(`build_schedule failed: ${built.reason}`);
  const option = (built.alternatives as Array<{ id: string; changes: number }>).find((alt) => alt.changes > 0)!;
  const queued = otherSection(port, "CSCE 1040");
  const { ctx } = session(port, true, () => planner.get().setSection("CSCE 1040", queued));
  expect(await named(tools, "apply_alternative").run({ id: option.id }, ctx)).toMatchObject({ ok: false, reason: "plan_changed" });
  await waitFor(() => planner.get().plannerState.selectedSections["CSCE 1040"] === queued, "queued section kept");
});

test("Undo with a section change still queued restores its course and keeps the change", async () => {
  const { planner, port } = await plannerWithCourses();
  const { ctx, undos } = session(port, true);
  expect(await named(createTools(), "remove_course").run({ code: "PSYC 1630" }, ctx)).toMatchObject({ ok: true });
  expect(planned(planner, "PSYC 1630")).toBe(false);
  const queued = otherSection(port, "ENGL 1310");
  planner.get().setSection("ENGL 1310", queued);
  expect(await undos[0]()).toBe(true);
  expect(planned(planner, "PSYC 1630")).toBe(true);
  expect(planner.get().plannerState.selectedSections["ENGL 1310"]).toBe(queued);
});

test("Undo is refused while a plan reset is still queued", async () => {
  const { planner, port } = await plannerWithCourses();
  const { ctx, undos } = session(port, true);
  expect(await named(createTools(), "remove_course").run({ code: "PSYC 1630" }, ctx)).toMatchObject({ ok: true });
  planner.get().resetPlanner();
  expect(await undos[0]()).toBe(false);
  expect(planned(planner, "PSYC 1630")).toBe(false);
});
