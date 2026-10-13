/**
 * Transition ordering through the real bridge, dialog, provider and
 * Toaster, rendered without `act` so React's scheduler orders the work as
 * in the page: an ordinary-priority update renders before an earlier
 * transition. Probes from the Sol review of 064b52f.
 */
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { installDom, removeDom, setSession, sleep, waitFor, type PlannerValue } from "../planner/test-dom";
import type { ToolResult } from "@/lib/webmcp/tools";

let unmount: (() => void) | null = null;
beforeAll(() => {
  const win = installDom();
  // The dialog and toast need a few globals the planner harness does not install.
  Object.assign(globalThis, { PointerEvent: win.PointerEvent, HTMLButtonElement: win.HTMLButtonElement, matchMedia: win.matchMedia.bind(win) });
});
afterAll(() => {
  removeDom();
});
beforeEach(() => {
  window.localStorage.clear();
  setSession(null);
});
afterEach(async () => {
  unmount?.();
  unmount = null;
  const { dismissToast } = await import("@/components/ui/Toast");
  dismissToast();
  await sleep(20);
});

type Execute = (input: unknown, second?: unknown) => Promise<ToolResult>;

/** The page: provider, bridge and Toaster, with three planned courses and the tools registered on a stub. */
async function page() {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { PlannerProvider, usePlanner } = await import("@/components/planner-provider");
  const { WebMcpBridge } = await import("@/components/webmcp/WebMcpBridge");
  const { Toaster } = await import("@/components/ui/Toast");
  const tools = new Map<string, Execute>();
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: {
      registerTool: (definition: { name: string; execute: Execute }) => {
        tools.set(definition.name, definition.execute);
        return Promise.resolve();
      },
    },
  });
  let latest: PlannerValue | null = null;
  function Probe() {
    const value = usePlanner();
    React.useEffect(() => {
      latest = value;
    });
    return null;
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  root.render(
    <PlannerProvider>
      <Probe />
      <WebMcpBridge />
      <Toaster />
    </PlannerProvider>,
  );
  unmount = () => {
    root.unmount();
    container.remove();
  };
  await waitFor(() => latest !== null, "first render");
  const get = () => latest!;
  await get().afterHydration();
  get().updateCoursePlan(({ courseStatuses, coursePlan }) => ({
    courseStatuses: { ...courseStatuses, "CSCE 1040": "inProgress", "ENGL 1310": "inProgress", "PSYC 1630": "inProgress" },
    coursePlan,
  }));
  await waitFor(() => Boolean(get().plannerState.selectedSections["PSYC 1630"]) && tools.size === 11, "planned and registered");
  return { get, tools, startTransition: React.startTransition };
}

const button = (scope: string, label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>(`${scope} button`)].find(
    (b) => (b.querySelector(".ui-btn__label")?.textContent ?? b.textContent) === label,
  );
const toastText = () => document.querySelector(".ui-toast__message")?.textContent ?? null;
const planned = (get: () => PlannerValue, code: string) => get().plannerState.courseStatuses[code] === "inProgress";

test("removal approved while a lock waits in a transition reports the lock, and no toast", async () => {
  const { get, tools, startTransition } = await page();
  const done = tools.get("remove_course")!({ code: "PSYC 1630" });
  await waitFor(() => Boolean(button('[role="alertdialog"]', "Remove")), "question shown");
  // Queue the lock as a transition, then approve: the transaction is dispatched at ordinary priority after it.
  startTransition(() => get().setSectionLock("PSYC 1630", true));
  button('[role="alertdialog"]', "Remove")!.click();
  expect(await done).toMatchObject({ ok: false, reason: "course_locked" });
  await waitFor(() => Boolean(get().plannerState.lockedSections?.["PSYC 1630"]), "lock committed");
  await sleep(50);
  expect(planned(get, "PSYC 1630")).toBe(true);
  expect(toastText()).toBeNull();
});

test("an ordinary update between the queued lock and the approval does not hide the lock", async () => {
  const { get, tools, startTransition } = await page();
  const done = tools.get("remove_course")!({ code: "PSYC 1630" });
  await waitFor(() => Boolean(button('[role="alertdialog"]', "Remove")), "question shown");
  startTransition(() => get().setSectionLock("PSYC 1630", true));
  get().setOptimization("compact");
  button('[role="alertdialog"]', "Remove")!.click();
  expect(await done).toMatchObject({ ok: false, reason: "course_locked" });
  await waitFor(() => Boolean(get().plannerState.lockedSections?.["PSYC 1630"]) && get().plannerState.optimization === "compact", "lock and goal committed");
  await sleep(50);
  expect(planned(get, "PSYC 1630")).toBe(true);
  expect(toastText()).toBeNull();
});

test("Undo clicked while a reset waits in a transition reports Undo off, and the plan stays reset", async () => {
  const { get, tools, startTransition } = await page();
  const done = tools.get("remove_course")!({ code: "PSYC 1630" });
  await waitFor(() => Boolean(button('[role="alertdialog"]', "Remove")), "question shown");
  button('[role="alertdialog"]', "Remove")!.click();
  expect(await done).toMatchObject({ ok: true });
  await waitFor(() => Boolean(button(".ui-toast", "Undo")), "Undo offered");
  startTransition(() => get().resetPlanner());
  button(".ui-toast", "Undo")!.click();
  await waitFor(() => toastText() === "Undo is off: your plan changed since then", `Undo refused (toast: ${toastText()})`);
  await sleep(50);
  expect(planned(get, "PSYC 1630")).toBe(false);
  expect(toastText()).toBe("Undo is off: your plan changed since then");
});
