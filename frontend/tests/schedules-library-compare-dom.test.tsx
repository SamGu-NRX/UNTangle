/**
 * Compare in the Schedules library, through the page: pick three plans and
 * read each one's credits and figures in the compare table; a fourth pick
 * replaces the oldest. The planner is a fixed stub; saved copies live in
 * happy-dom's localStorage as in a guest's browser.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { click, installDom, mount, removeDom } from "./ui/dom";

// CSS modules have no loader under bun test: each class name is its own key.
mock.module("@/components/schedules-library/library.module.css", () => ({ default: new Proxy({}, { get: (_, key) => String(key) }) }));

let plannerValue: Record<string, unknown> = {};
mock.module("@/components/planner-provider", () => ({ usePlanner: () => plannerValue }));

beforeAll(() => {
  installDom();
});
afterAll(() => {
  removeDom();
});

async function page() {
  const { getInitialPlannerState } = await import("@/lib/planner");
  const { eventsOf } = await import("@/lib/plan-library/week");
  const { sampleCatalog } = await import("@/lib/planner-sections");
  const { createSavedPlanStore, setSavedPlanIdentity } = await import("@/lib/saved-plans/store");
  // Each of these is 3 credits in the bundled catalog.
  const taking = (codes: string[]) => {
    const initial = getInitialPlannerState();
    return { ...initial, courseStatuses: { ...initial.courseStatuses, ...Object.fromEntries(codes.map((code) => [code, "inProgress" as const])) } };
  };
  const main = taking(["ANTH 1010", "ENGL 1310"]);
  localStorage.clear();
  setSavedPlanIdentity(null);
  const store = createSavedPlanStore();
  for (const [name, codes] of [
    ["Lighter", ["ANTH 1010"]],
    ["Heavier", ["ANTH 1010", "ENGL 1310", "MATH 1710", "BIOL 1710"]],
    ["Middle", ["ANTH 1010", "ENGL 1310", "MATH 1710"]],
  ] as const) {
    const saved = store.savePlan({ state: taking([...codes]), name });
    if (!saved.ok) throw new Error(saved.failure.message);
  }
  plannerValue = {
    plannerState: main,
    scheduleEvents: eventsOf(main, sampleCatalog),
    sectionCatalog: sampleCatalog,
    loadSections: () => {},
    transact: async () => ({ status: "committed", result: null }),
    identityReady: true,
    afterHydration: async () => {},
    planStamp: 0,
    saveState: { status: "saved" },
    conflict: null,
    syncConflict: null,
  };
  const { SchedulesClient } = await import("@/components/schedules-library/schedules-client");
  return mount(<SchedulesClient />);
}

const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => (b.getAttribute("aria-label") ?? b.textContent) === name)!;
/** The compare table as rows of cell text, header row first. */
const figures = () =>
  [...document.querySelectorAll("aside table")][0] ? [...document.querySelectorAll("aside table")[0].querySelectorAll("tr")].map((tr) => [...tr.children].map((cell) => cell.textContent?.trim() ?? "")) : [];

describe("Compare", () => {
  test("three plans side by side, each with its credits", async () => {
    const view = await page();
    await click(button("Compare"));
    await click(button("Compare Main"));
    await click(button("Compare Lighter"));
    await click(button("Compare Heavier"));
    const rows = figures();
    expect(rows[0]).toEqual(["Figure", "Main", "Lighter", "Heavier"]);
    expect(rows[1]).toEqual(["Credits", "6", "3", "12"]);
    // Every figure has a value for every plan.
    expect(rows.slice(1).every((row) => row.length === 4)).toBe(true);
    expect(document.querySelector("aside h2")?.textContent).toBe("Main, Lighter and Heavier");
    // A, B and C ahead of the picked names, in the order they were picked.
    const letterOf = (name: string) => [...document.querySelectorAll("li")].find((li) => li.querySelector(`[aria-label^="Remove ${name},"]`))?.querySelector(".pick")?.textContent;
    expect(["Main", "Lighter", "Heavier"].map(letterOf)).toEqual(["A", "B", "C"]);
    // Screen readers hear the letter too.
    expect(button("Remove Lighter, B, from compare")).toBeDefined();
    // The week shows one plan at a time; "Both" is for two.
    expect([...document.querySelectorAll('aside [role="radio"]')].map((radio) => radio.textContent)).toEqual(["Main", "Lighter", "Heavier"]);
    await view.unmount();
  });

  test("a fourth pick replaces the oldest", async () => {
    const view = await page();
    await click(button("Compare"));
    for (const name of ["Main", "Lighter", "Heavier", "Middle"]) await click(button(`Compare ${name}`));
    expect(figures()[0]).toEqual(["Figure", "Lighter", "Heavier", "Middle"]);
    expect(figures()[1]).toEqual(["Credits", "3", "12", "9"]);
    await view.unmount();
  });

  test("two plans keep Both, and the credits row", async () => {
    const view = await page();
    await click(button("Compare"));
    await click(button("Compare Main"));
    await click(button("Compare Middle"));
    expect(figures()[1]).toEqual(["Credits", "6", "9"]);
    expect([...document.querySelectorAll('aside [role="radio"]')].map((radio) => radio.textContent)).toEqual(["Main", "Both", "Middle"]);
    await view.unmount();
  });
});
