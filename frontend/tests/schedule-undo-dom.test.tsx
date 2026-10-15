import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { act, useLayoutEffect } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { BuilderHost } from "@/components/schedule-builder/host";
import { installDom, mountPlanner, removeDom, setSession, waitFor } from "./planner/test-dom";

let previousActEnvironment: boolean | undefined;
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
beforeAll(() => {
  installDom();
  setSession(null);
  previousActEnvironment = environment.IS_REACT_ACT_ENVIRONMENT;
  environment.IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  window.localStorage.clear();
  setSession(null);
});
afterEach(async () => {
  const { dismissToast } = await import("@/components/ui/Toast");
  await act(async () => { dismissToast(); });
  window.localStorage.clear();
  setSession(null);
});
afterAll(() => {
  removeDom();
  if (previousActEnvironment === undefined) delete environment.IS_REACT_ACT_ENVIRONMENT;
  else environment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch: async () => {} };
/** Week sits inside the app shell; this stands in for the shell's search hooks. */
const shell = { openSearch() {}, setSearchProvider() {}, pageState: new Map<string, unknown>() };
/** A button by its visible label, or by its accessible name for an icon button. */
const label = (button: HTMLButtonElement) => (button.querySelector(".ui-btn__label")?.textContent || button.textContent || button.getAttribute("aria-label") || "").trim();
const named = (root: Element, text: string) => [...root.querySelectorAll<HTMLButtonElement>("button")].find((button) => label(button) === text);

test("Undo control restores the student's stored picks in the rendered week", async () => {
  const { WeekPage } = await import("@/app/schedule/week-page");
  const { ShellContext } = await import("@/components/shell/shell-context");
  const planner = await mountPlanner(() => (
    <AppRouterContext.Provider value={router}>
      <ShellContext.Provider value={shell}>
        <WeekPage hostId="untangle" query={null} week={null} />
      </ShellContext.Provider>
    </AppRouterContext.Provider>
  ));
  try {
    await planner.get().afterHydration();
    await planner.run((p) => {
      p.setCourseStatus("ANTH 1010", "inProgress");
      p.setCourseStatus("MATH 1710", "inProgress");
      p.setOptimization("clusterNight");
      p.setSection("ANTH 1010", "anth-1010-003");
    });
    const grid = () => planner.container.querySelector<HTMLElement>('section[aria-label*="week" i]')!;
    const before = grid().textContent;
    expect(before).toContain("ANTH 1010");
    // Auto shows its alternatives one at a time; "Use this" puts the one on screen on the week.
    await act(async () => {
      named(planner.container, "Auto")!.click();
    });
    const usable = () => {
      const use = named(planner.container, "Use this");
      return use && !use.disabled ? use : undefined;
    };
    for (let attempt = 0; attempt < 200 && !usable(); attempt++) {
      await act(async () => {
        await Bun.sleep(10);
      });
    }
    const use = usable();
    expect(use).not.toBeUndefined();
    await act(async () => {
      use!.click();
    });
    expect(grid().textContent).not.toBe(before);
    expect(planner.get().sectionPicks).not.toEqual({ "ANTH 1010": "anth-1010-003" });
    const undo = named(planner.container, "Undo");
    expect(undo?.disabled).toBe(false);
    await act(async () => {
      undo!.click();
    });
    expect(grid().textContent).toBe(before);
    expect(planner.get().sectionPicks).toEqual({ "ANTH 1010": "anth-1010-003" });
    expect(named(planner.container, "Undo")?.disabled).toBe(true);
  } finally {
    await planner.unmount();
  }
});

/** Week's host on the real planner, without the page around it. */
async function mountHost() {
  const { useUntangleHost } = await import("@/app/schedule/untangle-host");
  const { brandFor } = await import("@/lib/brand");
  const box: { host: BuilderHost | null } = { host: null };
  function HostProbe({ onHost }: { onHost: (host: BuilderHost) => void }) {
    const host = useUntangleHost(brandFor("untangle"));
    useLayoutEffect(() => {
      onHost(host);
    });
    return null;
  }
  const planner = await mountPlanner(() => <HostProbe onHost={(host) => void (box.host = host)} />);
  await planner.get().afterHydration();
  return { planner, host: () => box.host! };
}

test("Clear takes the courses' Auto-filled mark with them, and Undo puts it back", async () => {
  const { planner, host } = await mountHost();
  try {
    await planner.run((p) =>
      p.updateCoursePlan(({ courseStatuses, coursePlan }) => ({
        courseStatuses: { ...courseStatuses, "MATH 1720": "inProgress", "ANTH 1010": "inProgress" },
        coursePlan: { ...coursePlan, autoPlanned: ["MATH 1720"] },
      })),
    );
    await planner.run(() => host().edits.clear());
    await waitFor(() => planner.get().plannerState.courseStatuses["MATH 1720"] === "notTaken", "plan cleared");
    expect(planner.get().plannerState.coursePlan?.autoPlanned).toEqual([]);
    await waitFor(() => host().edits.canUndo, "Undo ready");
    await planner.run(() => host().edits.undo());
    await waitFor(() => planner.get().plannerState.courseStatuses["MATH 1720"] === "inProgress", "clear undone");
    expect(planner.get().plannerState.coursePlan?.autoPlanned).toEqual(["MATH 1720"]);
  } finally {
    await planner.unmount();
  }
});

test("using a week says why it left a course out", async () => {
  const { planner, host } = await mountHost();
  try {
    await planner.run((p) => p.setCourseStatus("MATH 1710", "completed"));
    let refused: string[] = [];
    await planner.run(() => {
      refused = host().edits.use({ "MATH 1710": "math-1710-001", "ANTH 1010": "anth-1010-001" });
    });
    expect(refused).toEqual(["MATH 1710 is done already."]);
    await waitFor(() => planner.get().plannerState.selectedSections["ANTH 1010"] === "anth-1010-001", "ANTH 1010 used");
  } finally {
    await planner.unmount();
  }
});

test("walk times are whole seconds, rounded as Auto rounds them", async () => {
  const { planner, host } = await mountHost();
  try {
    // The campus data has 213.5 s from ART to AUD.
    expect(host().walk("art", "aud")).toEqual({ seconds: 214, shuttle: false });
  } finally {
    await planner.unmount();
  }
});

test("the other-campus action uses the shipped Day navigation label", async () => {
  const { OtherCampusHero } = await import("@/components/map/day-panel");
  const { mount } = await import("./ui/dom");
  const view = await mount(<OtherCampusHero campusName="UT Austin" homeName="UNT" />);
  try {
    const link = view.container.querySelector("a");
    expect(link?.textContent?.trim()).toBe("Day");
    expect(link?.getAttribute("href")).toBe("/day");
    expect(view.container.textContent).toContain("UT Austin map shows buildings only");
  } finally {
    await view.unmount();
  }
});
