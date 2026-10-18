/**
 * Courses on the real planner, for the students the degree audit reads:
 * what's left comes first (credits, then requirements by area, then the
 * advisor's list), Auto plans only what the degree still needs, and a major
 * the audit doesn't cover says so and keeps its sample list.
 */
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { TranscriptCourseRecord } from "@/lib/types";
import { installDom, mountPlanner, removeDom, setSession, waitFor } from "../planner/test-dom";
import { completedPlan, finalTerm, journeyTranscript } from "./degree-students";

let previousActEnvironment: boolean | undefined;
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
beforeAll(() => {
  installDom();
  // The view escapes ids in selectors; happy-dom has no CSS.escape. Course codes and requirement keys need only quotes escaped.
  if (typeof globalThis.CSS?.escape !== "function") {
    Object.defineProperty(globalThis, "CSS", { configurable: true, value: { escape: (value: string) => value.replace(/["\\]/g, "\\$&") } });
  }
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
const text = (element: Element | null | undefined) => element?.textContent?.replace(/\s+/g, " ").trim() ?? "";

async function coursesFor(transcript: readonly TranscriptCourseRecord[], major: "cs" | "math", marked: string[] = []) {
  const { CoursesView } = await import("@/components/courses/CoursesView");
  const { ShellContext } = await import("@/components/shell/shell-context");
  const { manualEdit } = await import("@/components/courses/model/plan-edits");
  const planner = await mountPlanner(() => (
    <AppRouterContext.Provider value={router}>
      <ShellContext.Provider value={shell}>
        <CoursesView />
      </ShellContext.Provider>
    </AppRouterContext.Provider>
  ));
  await planner.get().afterHydration();
  if (transcript.length > 0) await planner.run((p) => p.applyTranscriptRecords([...transcript]));
  await planner.run((p) => p.setSelectedMajor(major));
  if (marked.length > 0) {
    await planner.run((p) =>
      p.updateCoursePlan(manualEdit(Object.fromEntries(marked.map((id) => [id, "completed" as const])), (plan) => ({ manualCredit: [...plan.manualCredit, ...marked] }))),
    );
  }
  const page = planner.container;
  const left = () => page.querySelector<HTMLElement>('section[aria-labelledby="left-title"]');
  /** The What's left groups after the term card: the areas, then the advisor's list. */
  const areaHeads = () => [...page.querySelectorAll('section[aria-labelledby^="left-"] > h2 button')].map((head) => text(head));
  const headings = () => [...page.querySelectorAll("h2, h3")].map((heading) => text(heading));
  const rowText = (id: string) => text(page.querySelector(`[data-row-open="${id}"]`));
  const trayIds = () => [...page.querySelectorAll<HTMLElement>('[data-flip^="tray:"]')].map((row) => row.dataset.flip!.slice(5));
  return { planner, page, left, areaHeads, headings, rowText, trayIds };
}

test("the journey transcript: credits left, the term, then what's left by area with reasons one step away, and CSCE 1030 as a question", async () => {
  const view = await coursesFor(journeyTranscript, "cs");
  try {
    await waitFor(() => view.left() !== null, "What's left");
    const left = view.left()!;
    expect(text(left.querySelector("h2"))).toBe("111 credits left");
    expect(text(left)).toContain("The 2026-2027 catalog asks 120 credits for Computer Science, BS.");
    // The catalog total is gone from the degree line; the audit's figure replaced it.
    expect(text(view.page.querySelector("[data-degree]")?.parentElement)).not.toContain("of 120 credits");
    // Desktop: the areas open, the advisor's list behind its disclosure.
    expect(view.areaHeads()).toEqual(["Computer Science, BS", "University Core Curriculum", "12 things to check with an advisor"]);
    expect(text(view.page)).toContain("Other required courses, EENG 2710 and TECM 2700");
    expect(view.page.querySelector('[data-requirement="advisor"]')).toBeNull();
    // The credits left, then the term card, then what's left by area, then the course groups.
    const order = view.headings();
    expect(order.indexOf("111 credits left")).toBeLessThan(order.indexOf("Spring 2027"));
    expect(order.indexOf("Spring 2027")).toBeLessThan(order.indexOf("Computer Science, BS"));
    expect(order.indexOf("12 things to check with an advisor")).toBeLessThan(order.indexOf("To check"));

    // CSCE 1030 is covered for planning but still needed: To check, with the waiver question, not Done.
    const toCheck = view.page.querySelector('section[aria-labelledby="group-check"]')!;
    expect(text(toCheck.querySelector('[data-flip="row:CSCE 1030"]'))).toContain("Ask an advisor if it's waived");
    expect(view.page.querySelector('[data-flip="row:CSCE 1030"]')?.getAttribute("data-status")).toBe("check");

    // A requirement opens its detail: what it still needs, and the catalog heading it comes from.
    view.page.querySelector<HTMLButtonElement>('[data-row-open^="req:"]')!.click();
    await waitFor(() => document.body.textContent?.includes("Still needed") ?? false, "the requirement detail");
    const detail = text(document.body);
    expect(detail).toContain("Still needs 16 courses");
    expect(detail).toContain("Computer Science, BS lists this under Major requirements in UNT's catalog.");
    expect(document.querySelector('a[href="https://catalog.unt.edu/preview_program.php?catoid=40&poid=21227#MajorRequirements"]')).not.toBeNull();

    // A degree rule the audit finds unmet opens what the audit found.
    view.page.querySelector<HTMLButtonElement>('[data-row-open^="req:cs-bs.policy."]')!.click();
    await waitFor(() => document.body.textContent?.includes("What the audit found") ?? false, "the rule's detail");
    const rule = text(document.querySelector("aside.ui-context"));
    expect(rule).toContain("Not met yet");
    expect(rule).not.toContain("Still needs Not met yet");
    expect(rule).toContain("0 advanced credits of 42");

    // Auto plans only what the audit still needs.
    view.page.querySelector<HTMLButtonElement>("[data-auto]")!.click();
    await waitFor(() => view.trayIds().length > 0, "Auto's picks in the tray");
    expect(view.trayIds().sort()).toEqual(["CSCE 1010", "CSCE 2100", "CSCE 2110", "MATH 1720", "PSYC 1630"]);
  } finally {
    await view.planner.unmount();
  }
});

test("a first-year student with nothing: every credit is left, and the empty tray says where Auto's courses come from", async () => {
  const view = await coursesFor([], "cs");
  try {
    await waitFor(() => view.left() !== null, "What's left");
    expect(text(view.left()!.querySelector("h2"))).toBe("120 credits left");
    expect(text(view.page)).toContain("Other required courses, 3 courses");
    expect(text(view.page)).toContain("Auto fills this term from courses your degree still needs.");
  } finally {
    await view.planner.unmount();
  }
});

test("the finished four-year plan: nothing left, the advisor's list, and Auto plans nothing, never MATH 1720", async () => {
  const view = await coursesFor(completedPlan, "cs");
  try {
    await waitFor(() => view.left() !== null, "What's left");
    const left = view.left()!;
    expect(text(left.querySelector("h2"))).toBe("Nothing left to take");
    expect(view.areaHeads()).toEqual(["12 things to check with an advisor"]);
    // The advisor's list is reference: closed until asked for, then each item with its reason.
    const advisorHead = view.page.querySelector<HTMLButtonElement>("#left-advisor")!;
    expect(advisorHead.getAttribute("aria-expanded")).toBe("false");
    advisorHead.click();
    await waitFor(() => view.page.querySelectorAll('[data-requirement="advisor"]').length === 12, "the advisor list open");
    expect(text(view.page.querySelector('[data-requirement="advisor"]'))).toContain("55-hour major minimum, A minimum of 55 semester hours");
    expect(view.page.querySelector('section[aria-labelledby="group-can"]')).toBeNull();

    view.page.querySelector<HTMLButtonElement>("[data-auto]")!.click();
    await waitFor(() => !view.page.querySelector("[data-auto]")?.hasAttribute("aria-busy"), "Auto to finish");
    expect(view.trayIds()).toEqual([]);
    expect(view.planner.get().plannerState.coursePlan?.lastAuto ?? null).toBeNull();
    expect(view.planner.get().plannerState.courseStatuses["MATH 1720"]).not.toBe("inProgress");
  } finally {
    await view.planner.unmount();
  }
});

test("the final term: in-progress rows that print 0.000 count at catalog credits, and the rest stay unknown", async () => {
  const view = await coursesFor(finalTerm, "cs");
  try {
    await waitFor(() => view.left() !== null, "What's left");
    const left = view.left()!;
    expect(text(left.querySelector("h2"))).toBe("Up to about 6 credits left");
    expect(text(left)).toContain("CSCE 4240, CSCE 4902 and PSCI 2305 count at catalog credits until grades post.");
    expect(text(left)).toContain("UNTangle doesn't know the credits for AGER 2250 and CSCE 4230, so fewer may be left.");
    expect(text(view.page)).toContain("Required courses, Taking now");
  } finally {
    await view.planner.unmount();
  }
});

test("courses marked done by hand: the requirement reads 'You marked this done', and the credits say they count on the student's word", async () => {
  const view = await coursesFor(journeyTranscript, "cs", ["CSCE 1030", "ENGL 1320"]);
  try {
    await waitFor(() => text(view.page).includes("Communication Group 2, You marked this done"), "the marked-done requirement");
    const left = view.left()!;
    expect(text(left.querySelector("h2"))).toBe("105 credits left");
    expect(text(left)).toContain("Counts 6 credits you marked done.");
    expect(text(view.page)).not.toMatch(/satisfied|verified/i);
  } finally {
    await view.planner.unmount();
  }
});

test("a major the audit doesn't cover keeps its sample list and says plainly the check covers CS and CE only", async () => {
  const view = await coursesFor(journeyTranscript, "math");
  try {
    await waitFor(() => text(view.page).includes("The degree check covers Computer Science and Computer Engineering only."), "the coverage line");
    expect(view.left()).toBeNull();
    expect(text(view.page)).toContain("For Mathematics, Courses lists a sample of its courses.");
    expect(text(view.page)).toContain("9 of 120 credits");
    expect(text(view.page)).toContain("Auto fills this term from courses you can take.");
  } finally {
    await view.planner.unmount();
  }
});

test("on a phone the areas start closed, each saying what is left, so the term card is a screen higher", async () => {
  const viewport = window as unknown as { happyDOM: { setViewport(size: { width: number; height: number }): void } };
  viewport.happyDOM.setViewport({ width: 390, height: 844 });
  const view = await coursesFor(journeyTranscript, "cs");
  try {
    await waitFor(() => view.areaHeads().length === 3, "the What's left groups");
    // Required 16, Other required 2 and Laboratory science 2 (selections, counted here as courses); CSCE core and breadth 6 credits each.
    expect(view.areaHeads()).toEqual(["Computer Science, BS, 20 courses, 12 credits left", "University Core Curriculum, 1 course, 33 credits left", "12 things to check with an advisor"]);
    expect(view.page.querySelector('[data-row-open^="req:"]')).toBeNull();
    // A header expands its area in place.
    view.page.querySelector<HTMLButtonElement>("#left-major")!.click();
    await waitFor(() => view.page.querySelector('[data-row-open="req:cs-bs.0.0"]') !== null, "the major's rows");
    expect(view.areaHeads()[0]).toBe("Computer Science, BS");
    expect(view.page.querySelector('[data-row-open^="req:core"]')).toBeNull();
  } finally {
    await view.planner.unmount();
    viewport.happyDOM.setViewport({ width: 1024, height: 768 });
  }
});
