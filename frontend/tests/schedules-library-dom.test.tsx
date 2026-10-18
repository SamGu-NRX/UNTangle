import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import type { PlanStamp, PlanTransaction } from "@/lib/planner-transaction";
import type { PlannerState } from "@/lib/types";
import { click, installDom, mount, press, removeDom } from "./ui/dom";

mock.module("@/components/schedules-library/library.module.css", () => ({ default: new Proxy({}, { get: (_, key) => String(key) }) }));

// Bun keeps module mocks across files, so restore the provider for later tests.
const realPlanner = { ...(await import("@/components/planner-provider")) };
let plannerValue: Record<string, unknown> = {};
mock.module("@/components/planner-provider", () => ({ ...realPlanner, usePlanner: () => plannerValue }));

let view: Awaited<ReturnType<typeof mount>> | null = null;
beforeAll(() => installDom());
afterEach(async () => {
  const { act } = await import("react");
  const { dismissToast } = await import("@/components/ui/Toast");
  await act(async () => dismissToast());
  await view?.unmount();
  view = null;
});
afterAll(() => {
  mock.module("@/components/planner-provider", () => realPlanner);
  removeDom();
});

const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => (node.getAttribute("aria-label") ?? node.textContent) === name)!;
const restoredToast = () => [...document.querySelectorAll(".ui-toast__message")].find((node) => node.textContent === "Restored Before Auto")?.textContent;

async function page() {
  const { DEFAULT_CANDIDATE_FILTER, getInitialPlannerState, normalizePlannerState, resolveSectionPlan } = await import("@/lib/planner");
  const { beforeAuto } = await import("@/lib/plan-library/versions");
  const { eventsOf } = await import("@/lib/plan-library/week");
  const { sampleCatalog } = await import("@/lib/planner-sections");
  const { createSavedPlanStore, setSavedPlanIdentity } = await import("@/lib/saved-plans/store");
  const { SchedulesClient } = await import("@/components/schedules-library/schedules-client");
  const { Toaster } = await import("@/components/ui/Toast");
  const initial = getInitialPlannerState();
  const main = normalizePlannerState({
    ...initial,
    courseStatuses: { ...initial.courseStatuses, "ANTH 1010": "inProgress" },
    coursePlan: {
      manualCredit: [],
      autoPlanned: ["ANTH 1010"],
      lastAuto: {
        id: "auto-test",
        at: initial.updatedAt,
        major: initial.selectedMajor,
        changes: [{ code: "ANTH 1010", from: "notTaken", to: "inProgress" }],
        autoPlannedBefore: [],
        summary: "Added ANTH 1010",
        needsCheck: [],
      },
    },
  });
  expect(beforeAuto(main)?.state.courseStatuses["ANTH 1010"]).toBe("notTaken");
  localStorage.clear();
  setSavedPlanIdentity(null);
  const saved = createSavedPlanStore().savePlan({ state: main, name: "Saved copy" });
  if (!saved.ok) throw new Error(saved.failure.message);
  const stamp: PlanStamp = { identity: "user:test", epoch: 0 };
  const transactionStamps: PlanStamp[] = [];
  plannerValue = {
    plannerState: main,
    scheduleEvents: eventsOf(main, sampleCatalog, DEFAULT_CANDIDATE_FILTER, {}),
    sectionCatalog: sampleCatalog,
    sectionPlan: resolveSectionPlan(main, sampleCatalog, DEFAULT_CANDIDATE_FILTER),
    candidateFilter: DEFAULT_CANDIDATE_FILTER,
    evidenceHundredths: {},
    loadSections: () => {},
    transact: async <R,>(transaction: (current: PlannerState) => PlanTransaction<R>, expected: PlanStamp) => {
      transactionStamps.push(expected);
      const result = transaction(plannerValue.plannerState as PlannerState);
      if (result.next) plannerValue.plannerState = normalizePlannerState(result.next);
      return { status: "committed", result: result.result, runEdits: 0 };
    },
    identityReady: true,
    hydrated: true,
    afterHydration: async () => {},
    planStamp: stamp,
    saveState: { status: "saving" },
    conflict: null,
    syncConflict: null,
    storeNotices: [],
  };
  const content = () => <><SchedulesClient /><Toaster /></>;
  view = await mount(content());
  const rerender = () => view!.rerender(content());
  return { rerender, main, stamp, transactionStamps };
}

async function restore() {
  await click(button("Open Main, active"));
  await click(button("Restore Before Auto"));
  expect((plannerValue.plannerState as PlannerState).courseStatuses["ANTH 1010"]).toBe("notTaken");
}

describe("restoring Main waits for storage", () => {
  test("saving does not announce; saved announces with a working Undo and the original stamp", async () => {
    const { rerender, main, stamp, transactionStamps } = await page();
    await restore();
    await rerender();
    expect(restoredToast()).toBeUndefined();
    plannerValue.saveState = { status: "saved" };
    await rerender();
    expect(restoredToast()).toBeDefined();
    await click(button("Undo"));
    expect(plannerValue.plannerState).toEqual(main);
    expect(transactionStamps).toEqual([stamp, stamp]);
  });

  test("a failed save drops the restore announcement, even if a later save succeeds", async () => {
    const { rerender } = await page();
    await restore();
    plannerValue.saveState = { status: "failed", label: "Not saved" };
    await rerender();
    expect(restoredToast()).toBeUndefined();
    expect(document.querySelector('[aria-label="Save state"]')?.textContent).toContain("Not saved");
    plannerValue.saveState = { status: "saved" };
    await rerender();
    expect(restoredToast()).toBeUndefined();
  });

  test("a newer version drops the restore announcement, even after the conflict clears", async () => {
    const { rerender } = await page();
    await restore();
    plannerValue.conflict = { mine: plannerValue.plannerState, theirs: null };
    plannerValue.syncConflict = true;
    await rerender();
    expect(restoredToast()).toBeUndefined();
    plannerValue.conflict = null;
    plannerValue.syncConflict = null;
    plannerValue.saveState = { status: "saved" };
    await rerender();
    expect(restoredToast()).toBeUndefined();
  });

  test("Undo refuses to replace edits made after the restore", async () => {
    const { rerender } = await page();
    await restore();
    plannerValue.saveState = { status: "saved" };
    await rerender();
    const restored = plannerValue.plannerState as PlannerState;
    const edited = { ...restored, courseStatuses: { ...restored.courseStatuses, "ENGL 1310": "inProgress" as const } };
    plannerValue.plannerState = edited;
    await rerender();
    await click(button("Undo"));
    expect(plannerValue.plannerState).toBe(edited);
    expect(document.querySelector("[data-ui-live]")?.textContent).toBe("Main has changed since, so it was left as it is.");
  });
});

for (const open of [true, false]) {
  test(`Archive focuses the Archived toggle when the row ${open ? "is open" : "is not open"}`, async () => {
    await page();
    if (open) await click(button("Open Saved copy"));
    const trigger = button("More for Saved copy");
    const { act } = await import("react");
    await act(async () => trigger.focus());
    await press(trigger, "Enter");
    const menu = document.querySelector('[role="menu"][aria-label="More for Saved copy"]')!;
    await press(menu, "End");
    expect(document.activeElement?.textContent).toBe("Archive");
    await press(document.activeElement!, "Enter");
    const toggle = document.querySelector<HTMLButtonElement>("button.groupToggle")!;
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(button("Open Saved copy")).toBeUndefined();
    expect(document.activeElement === toggle).toBe(true);
    expect(document.querySelector('aside:not([inert])')).toBeNull();
  });
}
