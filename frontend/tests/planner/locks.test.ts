import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  FakePlannerServer,
  installDom,
  mountPlanner,
  removeDom,
  setSession,
  sleep,
  waitFor,
} from "./test-dom";
import {
  getActiveCourseCodes,
  getInitialPlannerState,
  normalizePlannerState,
  recommendSections,
  sectionNumber,
} from "@/lib/planner";
import { validatePlannerStatePayload } from "@/lib/planner-validation";
import { oracleConflictingPairs } from "@/lib/schedule-oracle";
import { sections } from "@/lib/seed-data";

// Section locks: a locked section is a fixed selection for every optimize,
// persists through save/reload, and older plans load with no locks.

const COURSES = ["MATH 1710", "ANTH 1010", "CSCE 1030"];
const sectionById = (id: string) => sections.find((section) => section.id === id)!;
const conflictsIn = (selection: Record<string, string>) =>
  oracleConflictingPairs(Object.values(selection).map(sectionById));

describe("recommendSections with a locked section", () => {
  const morning = recommendSections("clusterMorning", COURSES);
  const night = recommendSections("clusterNight", COURSES);
  const lockedCourse = COURSES.find((code) => morning[code] !== night[code])!;

  test("the scenario is informative: without a lock, switching goals moves the course", () => {
    expect(lockedCourse).toBeDefined();
    expect(night[lockedCourse]).not.toBe(morning[lockedCourse]);
  });

  test("optimizing keeps the locked section, may change the others, and stays conflict-free per the oracle", () => {
    const locked = recommendSections("clusterNight", COURSES, { [lockedCourse]: morning[lockedCourse] });
    expect(locked[lockedCourse]).toBe(morning[lockedCourse]);
    const changed = COURSES.filter((code) => code !== lockedCourse && locked[code] !== morning[code]);
    expect(changed.length).toBeGreaterThan(0);
    expect(Object.keys(locked).sort()).toEqual([...COURSES].sort());
    expect(conflictsIn(locked)).toEqual([]);
  });

  test("every goal keeps every single locked section across the three courses", () => {
    for (const goal of ["clusterMorning", "clusterNight", "compact", "minimizeDistance", "maximizeProfessor"] as const) {
      for (const code of COURSES) {
        const fixed = { [code]: morning[code] };
        const result = recommendSections(goal, COURSES, fixed);
        expect(result[code]).toBe(morning[code]);
        expect(conflictsIn(result)).toEqual([]);
      }
    }
  });
});

describe("lockedSections in planner state", () => {
  const base = () => ({
    ...getInitialPlannerState(),
    courseStatuses: { ...getInitialPlannerState().courseStatuses, "ANTH 1010": "inProgress" as const },
    selectedSections: { "ANTH 1010": "anth-1010-003" },
  });

  test("a plan saved before locks existed normalizes to no locks", () => {
    const old = base() as Record<string, unknown>;
    delete old.lockedSections;
    expect(normalizePlannerState(old as never).lockedSections).toEqual({});
  });

  test("a lock that does not match the selected section, or names an inactive course, is released", () => {
    const normalized = normalizePlannerState({
      ...base(),
      lockedSections: { "ANTH 1010": "anth-1010-001", "CSCE 1030": "csce-1030-001" },
    });
    expect(normalized.lockedSections).toEqual({});
    expect(normalizePlannerState({ ...base(), lockedSections: { "ANTH 1010": "anth-1010-003" } }).lockedSections).toEqual({
      "ANTH 1010": "anth-1010-003",
    });
  });

  test("payload validation accepts a missing field and rejects a malformed one", () => {
    const old = base() as Record<string, unknown>;
    delete old.lockedSections;
    expect(validatePlannerStatePayload(old).ok).toBe(true);
    expect(validatePlannerStatePayload({ ...base(), lockedSections: { "ANTH 1010": 3 } }).ok).toBe(false);
    expect(validatePlannerStatePayload({ ...base(), lockedSections: ["anth-1010-003"] }).ok).toBe(false);
  });

  test("sectionNumber is the last dash-separated token", () => {
    expect(sectionNumber("csce-2100-002")).toBe("002");
  });
});

const user = { id: "u-locks", email: "locks@my.unt.edu", name: "Lock Test" };
let server: FakePlannerServer;
let previousFetch: typeof fetch;
const mounted: Array<() => Promise<void>> = [];

describe("lock control in the planner", () => {
  beforeAll(() => {
    installDom();
  });
  afterAll(() => {
    removeDom();
  });
  beforeEach(() => {
    window.localStorage.clear();
    server = new FakePlannerServer();
    previousFetch = globalThis.fetch;
    globalThis.fetch = server.fetch as typeof fetch;
    setSession(null);
  });
  afterEach(async () => {
    while (mounted.length) await mounted.pop()!();
    globalThis.fetch = previousFetch;
    setSession(null);
  });

  async function mountWithLocks() {
    const { SectionLockButton } = await import("@/components/schedule-section-locks");
    const React = await import("react");
    const { usePlanner } = await import("@/components/planner-provider");
    function Locks() {
      const { plannerState } = usePlanner();
      return React.createElement(
        "div",
        null,
        Object.entries(plannerState.selectedSections).map(([courseCode, sectionId]) =>
          React.createElement(SectionLockButton, { key: courseCode, courseCode, sectionId }),
        ),
      );
    }
    const planner = await mountPlanner(() => React.createElement(Locks));
    mounted.push(planner.unmount);
    await planner.get().afterHydration();
    await waitFor(() => planner.get().hydrated, "hydrated");
    return planner;
  }

  async function takeCourses(planner: Awaited<ReturnType<typeof mountWithLocks>>) {
    await planner.run((p) => {
      p.setCourseStatus("ANTH 1010", "inProgress");
      p.setCourseStatus("CSCE 1030", "inProgress");
    });
    await planner.run((p) => p.setOptimization("clusterMorning"));
  }

  const button = (container: HTMLElement, courseCode: string) =>
    [...container.querySelectorAll("button")].find((b) =>
      b.getAttribute("aria-label")?.startsWith(`Lock ${courseCode} section `),
    )!;

  test("the toggle is named Lock {COURSE} section {NNN} and exposes its state with aria-pressed", async () => {
    const planner = await mountWithLocks();
    await takeCourses(planner);
    const sectionId = planner.get().plannerState.selectedSections["MATH 1710"];
    const toggle = button(planner.container, "MATH 1710");
    expect(toggle.getAttribute("aria-label")).toBe(`Lock MATH 1710 section ${sectionNumber(sectionId)}`);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    toggle.click();
    await waitFor(() => button(planner.container, "MATH 1710").getAttribute("aria-pressed") === "true", "pressed");
    expect(planner.get().plannerState.lockedSections).toEqual({ "MATH 1710": sectionId });
    button(planner.container, "MATH 1710").click();
    await waitFor(() => button(planner.container, "MATH 1710").getAttribute("aria-pressed") === "false", "released");
    expect(planner.get().plannerState.lockedSections).toEqual({});
  });

  test("changing goal and Optimize schedule keep the locked section and can change the others", async () => {
    const planner = await mountWithLocks();
    await takeCourses(planner);
    const before = { ...planner.get().plannerState.selectedSections };
    await planner.run((p) => p.setSectionLock("MATH 1710", true));
    await planner.run((p) => p.setOptimization("clusterNight"));
    const after = planner.get().plannerState.selectedSections;
    expect(after["MATH 1710"]).toBe(before["MATH 1710"]);
    const active = getActiveCourseCodes(planner.get().plannerState);
    expect([...active].sort()).toEqual([...COURSES].sort());
    expect(after).toEqual(recommendSections("clusterNight", active, { "MATH 1710": before["MATH 1710"] }));
    expect(COURSES.some((code) => code !== "MATH 1710" && after[code] !== before[code])).toBe(true);
    expect(conflictsIn(after)).toEqual([]);

    await planner.run((p) => p.optimizeSchedule());
    expect(planner.get().plannerState.selectedSections["MATH 1710"]).toBe(before["MATH 1710"]);
    expect(button(planner.container, "MATH 1710").getAttribute("aria-pressed")).toBe("true");
  });

  test("picking a section by hand for a locked course moves the lock to it", async () => {
    const planner = await mountWithLocks();
    await takeCourses(planner);
    await planner.run((p) => p.setSectionLock("ANTH 1010", true));
    const other = sections.find(
      (s) => s.courseCode === "ANTH 1010" && s.id !== planner.get().plannerState.selectedSections["ANTH 1010"],
    )!;
    await planner.run((p) => p.setSection("ANTH 1010", other.id));
    expect(planner.get().plannerState.lockedSections?.["ANTH 1010"]).toBe(other.id);
  });

  test("guest: a lock survives reload", async () => {
    const first = await mountWithLocks();
    await takeCourses(first);
    await first.run((p) => p.setSectionLock("MATH 1710", true));
    const locked = first.get().plannerState.selectedSections["MATH 1710"];
    await waitFor(() => first.get().saveState.label === "Saved", "saved");
    await first.unmount();
    mounted.splice(mounted.indexOf(first.unmount), 1);

    const second = await mountWithLocks();
    expect(second.get().plannerState.lockedSections).toEqual({ "MATH 1710": locked });
    expect(button(second.container, "MATH 1710").getAttribute("aria-pressed")).toBe("true");
    await second.run((p) => p.setOptimization("clusterNight"));
    expect(second.get().plannerState.selectedSections["MATH 1710"]).toBe(locked);
  });

  test("registered: a lock is sent to the server and survives reload", async () => {
    setSession(user);
    const first = await mountWithLocks();
    await takeCourses(first);
    await first.run((p) => p.setSectionLock("MATH 1710", true));
    const locked = first.get().plannerState.selectedSections["MATH 1710"];
    await waitFor(() => first.get().saveState.label === "Saved", "saved");
    await sleep(50);
    expect(server.row?.state.lockedSections).toEqual({ "MATH 1710": locked });
    await first.unmount();
    mounted.splice(mounted.indexOf(first.unmount), 1);

    const second = await mountWithLocks();
    await waitFor(() => second.get().saveState.label === "Saved", "loaded");
    expect(second.get().plannerState.lockedSections).toEqual({ "MATH 1710": locked });
    expect(button(second.container, "MATH 1710").getAttribute("aria-pressed")).toBe("true");
  });
});
