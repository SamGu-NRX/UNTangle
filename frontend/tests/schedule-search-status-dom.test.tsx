/**
 * Week's course search on the real UNTangle host, against Courses' own
 * model: a course whose rule needs an advisor reads "check with an
 * advisor" in both lenses, and only a course with a readable, unmet
 * prerequisite reads "locked".
 */
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { GUEST_ID_KEY } from "@/components/schedule/preferences-store";
import { setupSeenKey } from "@/components/schedule/setup-store";
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
  // A returning guest, so Set up Auto doesn't cover the week.
  window.localStorage.setItem(GUEST_ID_KEY, "guest-search-0001");
  window.localStorage.setItem(setupSeenKey({ kind: "guest", id: "guest-search-0001" }), "2026-10-15T00:00:00.000Z");
});
afterAll(() => {
  removeDom();
  if (previousActEnvironment === undefined) delete environment.IS_REACT_ACT_ENVIRONMENT;
  else environment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch: async () => {} };
const shell = { openSearch() {}, setSearchProvider() {}, pageState: new Map<string, unknown>() };

test("Week's search says what Courses says about a course's prerequisites", async () => {
  const { WeekPage } = await import("@/app/schedule/week-page");
  const { ShellContext } = await import("@/components/shell/shell-context");
  const { buildCourseModel } = await import("@/components/courses/model/course-model");
  const { snapshotOf } = await import("@/components/courses/model/plan-edits");
  const { untProfile } = await import("@/components/courses/school");
  const planner = await mountPlanner(() => (
    <AppRouterContext.Provider value={router}>
      <ShellContext.Provider value={shell}>
        <WeekPage hostId="untangle" query="CSCE 10" week={null} />
      </ShellContext.Provider>
    </AppRouterContext.Provider>
  ));
  try {
    await planner.get().afterHydration();
    const hit = (code: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.startsWith(code));
    await waitFor(() => Boolean(hit("CSCE 1040")), "CSCE 1040 in the search results");
    const rows = buildCourseModel(untProfile(), snapshotOf(planner.get().plannerState)).rows;
    // CSCE 1030's rule is one UNTangle can't read ("for CSE majors only"); CSCE 1040 needs CSCE 1030.
    expect(rows.get("CSCE 1030")?.status).toBe("check");
    expect(rows.get("CSCE 1040")?.status).toBe("locked");
    expect(hit("CSCE 1030")?.textContent).toContain(", check with an advisor");
    expect(hit("CSCE 1030")?.textContent).not.toContain("locked");
    expect(hit("CSCE 1040")?.textContent).toContain(", locked");
    // A course Courses has no row for is one nobody can vouch for.
    const { requirementStatus } = await import("@/app/schedule/untangle-host");
    expect(requirementStatus(undefined)).toBe("check");
    // In progress by Courses' reading, though the transcript wrote the code another way.
    expect(requirementStatus({ status: "taking" })).toBe("taking");
  } finally {
    await planner.unmount();
  }
});
