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

describe("a copy that holds preferences (guest-sync.md: kept when signing in replaced them)", () => {
  async function withPreferences() {
    const { defaultSchedulePreferences } = await import("@/lib/planner");
    const { createSavedPlanStore } = await import("@/lib/saved-plans/store");
    const { rerender, main } = await page();
    const own = defaultSchedulePreferences(main.optimization);
    plannerValue.schedulePreferences = own;
    plannerValue.setSchedulePreferences = (update: (current: typeof own) => typeof own) => {
      plannerValue.schedulePreferences = update(plannerValue.schedulePreferences as typeof own);
    };
    // "Use these preferences" sets the goal through applySchedule, which moves no section (adopt.ts).
    plannerValue.applySchedule = (_byCourse: Record<string, string>, goal?: PlannerState["optimization"] | null) => {
      if (goal) plannerValue.plannerState = { ...(plannerValue.plannerState as PlannerState), optimization: goal };
    };
    const kept = { goal: "clusterNight" as const, constraints: { ...own.constraints, daysOff: ["Fri" as const] }, weights: own.weights };
    expect(createSavedPlanStore().savePlan({ state: main, name: "From this browser, Oct 22", preferences: kept }).ok).toBe(true);
    await rerender();
    return { rerender, own, kept };
  }
  async function openMenu(name: string) {
    const trigger = button(`More for ${name}`);
    const { act } = await import("react");
    await act(async () => trigger.focus());
    await press(trigger, "Enter");
    const menu = document.querySelector(`[role="menu"][aria-label="More for ${name}"]`)!;
    return [...menu.querySelectorAll('[role="menuitem"]')].map((item) => item as HTMLElement);
  }
  const liveText = () => document.querySelector("[data-ui-live]")?.textContent;

  test("its row offers Use these preferences, which replaces them with Undo", async () => {
    const { own, kept } = await withPreferences();
    const items = await openMenu("From this browser, Oct 22");
    await click(items.find((item) => item.textContent === "Use these preferences")!);
    expect(plannerValue.schedulePreferences).toEqual({ constraints: kept.constraints, weights: kept.weights });
    expect((plannerValue.plannerState as PlannerState).optimization).toBe("clusterNight");
    expect(liveText()).toBe("Now using the preferences from “From this browser, Oct 22”");
    await click(button("Undo"));
    expect(plannerValue.schedulePreferences).toEqual(own);
    expect((plannerValue.plannerState as PlannerState).optimization).toBe("clusterMorning");
    expect(liveText()).toBe("Your preferences are back to how they were");
  });

  test("a copy without preferences doesn't offer them", async () => {
    await withPreferences();
    const items = await openMenu("Saved copy");
    expect(items.map((item) => item.textContent)).not.toContain("Use these preferences");
  });
});

describe("naming a copy (PR #62 review: two rows called Main)", () => {
  const nameField = () => document.querySelector<HTMLInputElement>('[role="dialog"][data-state="open"] input')!;
  /** The naming dialog is open; a closing one stays mounted through its exit. */
  const naming = () => document.querySelector('[role="dialog"][data-state="open"]') !== null;
  const fieldError = () => {
    const id = nameField().getAttribute("aria-describedby");
    return id ? document.getElementById(id)?.textContent : undefined;
  };
  const rowNames = () => [...document.querySelectorAll<HTMLButtonElement>("button[aria-label^='Open ']")].map((row) => row.getAttribute("aria-label"));
  async function type(value: string) {
    const { act } = await import("react");
    await act(async () => {
      const input = nameField();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  async function submit() {
    const { act } = await import("react");
    await act(async () => {
      nameField().form!.requestSubmit();
    });
  }

  test("saving as Main is refused under the field; the dialog stays open until a free name saves", async () => {
    await page();
    await click(button("Save a copy"));
    await type(" main");
    await submit();
    expect(naming()).toBe(true);
    expect(fieldError()).toBe("Main is your plan. Name this copy something else.");
    expect(nameField().getAttribute("aria-invalid")).toBe("true");
    expect(rowNames()).toEqual(["Open Main, active", "Open Saved copy"]);
    // Editing the name clears the message; a free name saves and closes.
    await type("Lighter week");
    expect(fieldError()).toBeUndefined();
    await submit();
    expect(naming()).toBe(false);
    expect(rowNames()).toEqual(["Open Main, active", "Open Lighter week", "Open Saved copy"]);
  });

  test("saving under another copy's name is refused with that copy's name", async () => {
    await page();
    await click(button("Save a copy"));
    await type("SAVED COPY");
    await submit();
    expect(fieldError()).toBe("You already have a copy called Saved copy.");
    expect(rowNames()).toEqual(["Open Main, active", "Open Saved copy"]);
  });

  test("renaming to Main or a taken name is refused the same way", async () => {
    await page();
    await click(button("Save a copy"));
    await type("Other");
    await submit();
    const trigger = button("More for Other");
    const { act } = await import("react");
    await act(async () => trigger.focus());
    await press(trigger, "Enter");
    const menu = document.querySelector('[role="menu"][aria-label="More for Other"]')!;
    await click([...menu.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent === "Rename")!);
    await type("Main");
    await submit();
    expect(fieldError()).toBe("Main is your plan. Name this copy something else.");
    await type("saved copy");
    await submit();
    expect(fieldError()).toBe("You already have a copy called Saved copy.");
    expect(rowNames()).toEqual(["Open Main, active", "Open Other", "Open Saved copy"]);
  });

  // PR #172 review (discussion_r4305797876): Enter on "Main" spoke its refusal through the live region;
  // a second refusal reported by moving focus left that old reason there, under a field showing the new one.
  test("the live region never keeps an earlier refusal: Enter on Main, then Save on a taken name", async () => {
    const { act } = await import("react");
    const liveRegion = () => document.querySelector('[role="dialog"][data-state="open"] [aria-live="assertive"]')!;
    await page();
    await click(button("Save a copy"));
    await type("Main");
    await act(async () => nameField().focus());
    await submit();
    expect(liveRegion().textContent?.trim()).toBe("Main is your plan. Name this copy something else.");
    await type("saved copy");
    expect(liveRegion().textContent).toBe("");
    // Save pressed from its button: focus is off the field, so the refusal is heard as the field's description.
    await act(async () => button("Save").focus());
    await submit();
    expect(fieldError()).toBe("You already have a copy called Saved copy.");
    expect(document.activeElement).toBe(nameField());
    expect(liveRegion().textContent).not.toContain("Main is your plan");
  });

  test("a blank name still saves, as the numbered placeholder", async () => {
    await page();
    await click(button("Save a copy"));
    expect(nameField().placeholder).toBe("Copy of Main");
    await submit();
    expect(naming()).toBe(false);
    expect(rowNames()).toContain("Open Copy of Main");
  });
});
