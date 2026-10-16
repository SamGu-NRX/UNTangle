/**
 * Courses before a major is chosen, on the real planner: a student who built
 * a week in Week sees their term and one way forward, choosing a major, and
 * not the whole catalog under "To check". Choosing one brings the groups.
 */
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { installDom, mountPlanner, removeDom, setSession, waitFor } from "../planner/test-dom";

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
});
afterAll(() => {
  removeDom();
  if (previousActEnvironment === undefined) delete environment.IS_REACT_ACT_ENVIRONMENT;
  else environment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch: async () => {} };
const shell = { openSearch() {}, setSearchProvider() {}, pageState: new Map<string, unknown>() };
const headings = (root: ParentNode) => [...root.querySelectorAll("h2, h3")].map((h) => h.textContent?.trim());

test("no major: the term, then one way to choose a major, and no catalog of warnings", async () => {
  const { CoursesView } = await import("@/components/courses/CoursesView");
  const { ShellContext } = await import("@/components/shell/shell-context");
  const planner = await mountPlanner(() => (
    <AppRouterContext.Provider value={router}>
      <ShellContext.Provider value={shell}>
        <CoursesView />
      </ShellContext.Provider>
    </AppRouterContext.Provider>
  ));
  try {
    await planner.get().afterHydration();
    await planner.run((p) => {
      p.setCourseStatus("CSCE 1030", "inProgress");
      p.setCourseStatus("ENGL 1310", "inProgress");
    });
    const page = planner.container;
    await waitFor(() => headings(page).includes("See your degree's courses"), "the choose-a-major section");
    expect(headings(page)).not.toContain("To check");
    expect(page.textContent).not.toContain("Catalog rule needs an advisor");
    const choose = [...page.querySelectorAll<HTMLButtonElement>("section button")].filter((b) => b.textContent === "Choose your major");
    expect(choose.length).toBe(1);
    // The term the student planned in Week is still there.
    expect(page.textContent).toContain("CSCE 1030");

    await planner.run((p) => p.setSelectedMajor("cs"));
    await waitFor(() => !headings(page).includes("See your degree's courses"), "the groups after choosing a major");
    expect(headings(page).some((h) => h === "To check" || h === "You can take")).toBe(true);
  } finally {
    await planner.unmount();
  }
});
