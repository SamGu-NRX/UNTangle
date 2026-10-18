/**
 * Compare in the Schedules library, through the page: pick three plans and
 * read each one's credits and figures in the compare table; a fourth pick
 * replaces the oldest. The planner is a fixed stub; saved copies live in
 * happy-dom's localStorage as in a guest's browser.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import type { CandidateFilter, SectionCatalog } from "@/lib/planner-sections";
import type { Section } from "@/lib/sections";
import type { CourseSections, Meeting } from "@/lib/sections/model";
import { fixtureCatalog, fixtureInput, renumber } from "./sections/real-term";
import { click, installDom, mount, removeDom } from "./ui/dom";

// CSS modules have no loader under bun test: each class name is its own key.
mock.module("@/components/schedules-library/library.module.css", () => ({ default: new Proxy({}, { get: (_, key) => String(key) }) }));

// The stub replaces the provider module for this file only: bun keeps a module mock for the rest of
// the run, so afterAll puts the real module back for the files that mount the real provider.
const realPlanner = { ...(await import("@/components/planner-provider")) };
let plannerValue: Record<string, unknown> = {};
/** The sections Week places for the stub's Main. */
let mainSections: Section[] = [];
mock.module("@/components/planner-provider", () => ({ ...realPlanner, usePlanner: () => plannerValue }));

beforeAll(() => {
  installDom();
});
afterAll(() => {
  mock.module("@/components/planner-provider", () => realPlanner);
  removeDom();
});

type PageOptions = {
  copies?: boolean;
  hydrated?: boolean;
  /** Copies to save instead of the default four: a name and the courses it takes. */
  saved?: ReadonlyArray<readonly [string, readonly string[]]>;
  /** The loaded options; the bundled samples by default. */
  catalog?: SectionCatalog;
  /** Main's open-seats and other-sites settings; the defaults by default. */
  filter?: CandidateFilter;
  /** Main's instructor evidence, per course and section id; none by default. */
  evidence?: Evidence;
};
type Evidence = Readonly<Record<string, Record<string, number | null>>>;

async function page({ copies = true, hydrated = true, saved, catalog, filter, evidence = {} }: PageOptions = {}) {
  const { DEFAULT_CANDIDATE_FILTER, getInitialPlannerState, normalizePlannerState, resolveSectionPlan } = await import("@/lib/planner");
  const { eventsOf } = await import("@/lib/plan-library/week");
  const { sampleCatalog } = await import("@/lib/planner-sections");
  const sectionCatalog = catalog ?? sampleCatalog;
  const candidateFilter = filter ?? DEFAULT_CANDIDATE_FILTER;
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
  for (const [name, codes] of saved ?? (copies
    ? ([
        ["Lighter", ["ANTH 1010"]],
        ["Heavier", ["ANTH 1010", "ENGL 1310", "MATH 1710", "BIOL 1710"]],
        ["Middle", ["ANTH 1010", "ENGL 1310", "MATH 1710"]],
        ["Same as Main", ["ANTH 1010", "ENGL 1310"]],
      ] as const)
    : [])) {
    const result = store.savePlan({ state: taking([...codes]), name });
    if (!result.ok) throw new Error(result.failure.message);
  }
  const sectionPlan = resolveSectionPlan(normalizePlannerState(main), sectionCatalog, candidateFilter, undefined, evidence);
  mainSections = sectionPlan.courses.flatMap((course) => (course.section ? [course.section] : []));
  plannerValue = {
    plannerState: main,
    scheduleEvents: eventsOf(main, sectionCatalog, candidateFilter, evidence),
    sectionCatalog,
    sectionPlan,
    candidateFilter,
    evidenceHundredths: evidence,
    loadSections: () => {},
    transact: async () => ({ status: "committed", result: null }),
    identityReady: true,
    hydrated,
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

  test("walking reads as Week's Details counts it, never Unknown", async () => {
    const { figuresOf } = await import("@/components/schedule-builder/answer");
    const { eventsOf: gridEvents, walksOf } = await import("@/components/schedule-builder/week");
    const { weekTravel } = await import("@/lib/planner-walking");
    const view = await page();
    await click(button("Compare"));
    await click(button("Compare Main"));
    await click(button("Compare Heavier"));
    // Week's own figures for Main: the sections it places, timed by the walk function Week's host uses.
    const events = gridEvents(mainSections);
    const week = figuresOf(events, walksOf(events, weekTravel));
    const rows = figures();
    expect(rows.find((row) => row[0] === "Walking a week")?.[1]).toBe(`${week.walkMinutes} min`);
    expect(rows.find((row) => row[0] === "Tight or late walks")?.[1]).toBe(String(week.badWalks));
    expect(rows.flat()).not.toContain("Unknown");
    // Heavier's sample sections meet MWF at 8:00, 9:00 and 10:00 in three buildings, ten minutes apart: two walks a
    // day that add up to 12 minutes, one of them tight, three days a week. Both are more than Main's, said in words too.
    expect(rows.find((row) => row[0] === "Walking a week")?.[2]).toBe("36 min, worse");
    expect(rows.find((row) => row[0] === "Tight or late walks")?.[2]).toBe("3, worse");
    await view.unmount();
  });

  test("a copy that holds what Main holds isn't offered for use; a different one is", async () => {
    const view = await page();
    await click(button("Compare"));
    await click(button("Compare Main"));
    await click(button("Compare Same as Main"));
    expect(document.querySelector("aside")?.textContent).toContain("Every section is the same in both.");
    expect(button("Use Same as Main in Main")).toBeUndefined();
    await click(button("Remove Same as Main, B, from compare"));
    await click(button("Compare Middle"));
    expect(button("Use Middle in Main")).toBeDefined();
    await view.unmount();
  });

  test("with only Main there is nothing to compare; a copy saved with no name is Copy of Main, and Compare appears", async () => {
    const { act } = await import("react");
    const view = await page({ copies: false });
    expect(button("Compare")).toBeUndefined();
    await click(button("Save a copy"));
    const field = document.querySelector<HTMLInputElement>('[role="dialog"] input')!;
    // The field says what a blank name saves.
    expect(field.placeholder).toBe("Copy of Main");
    await act(async () => {
      document.querySelector<HTMLFormElement>("#schedule-name-form")!.requestSubmit();
    });
    expect([...document.querySelectorAll("li")].some((li) => li.textContent?.includes("Copy of Main"))).toBe(true);
    expect(button("Compare")).toBeDefined();
    await click(button("Save a copy"));
    expect(document.querySelector<HTMLInputElement>('[role="dialog"] input')!.placeholder).toBe("Copy of Main 2");
    // Leave nothing open for the files after this one: the dialog's modal layer and the saved toast are shared.
    await click(button("Cancel"));
    const { dismissToast } = await import("@/components/ui/Toast");
    await act(async () => dismissToast());
    // The closed dialog's layer is released: the page scrolls again (modal-layer.ts holds the lock while any layer is open).
    expect(document.documentElement.style.overflow).toBe("");
    await view.unmount();
  });

  test("Main says nothing about when it was edited until the stored plan has loaded", async () => {
    const mainRow = () => [...document.querySelectorAll("li")].find((li) => li.textContent?.includes("Main"))?.textContent ?? "";
    const loading = await page({ copies: false, hydrated: false });
    expect(mainRow()).not.toContain("Nothing planned yet");
    expect(mainRow()).not.toContain("Edited");
    await loading.unmount();
    // Loaded, this Main plans two courses, so it was edited.
    const loaded = await page({ copies: false });
    expect(mainRow()).toContain("Edited");
    await loaded.unmount();
  });

  test("Use in Main says first when Main has no saved copy, as a copy's detail does", async () => {
    const note = () => [...document.querySelectorAll("aside p")].find((p) => p.textContent?.startsWith("Main has no saved copy yet."));
    // No copy holds what Main holds.
    const unsaved = await page({ saved: [["Lighter", ["ANTH 1010"]]] });
    await click(button("Compare"));
    await click(button("Compare Main"));
    await click(button("Compare Lighter"));
    expect(button("Use Lighter in Main")).toBeDefined();
    expect(note()).toBeDefined();
    // Its link opens the same Save a copy dialog.
    await click(button("Save a copy first"));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Save a copy of Main");
    await click(button("Cancel"));
    await unsaved.unmount();
    // "Same as Main" is a saved copy of Main, so the line goes.
    const saved = await page();
    await click(button("Compare"));
    await click(button("Compare Main"));
    await click(button("Compare Lighter"));
    expect(button("Use Lighter in Main")).toBeDefined();
    expect(note()).toBeUndefined();
    await saved.unmount();
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

/**
 * MATH 1680 with two real options: the bundled one (TR 9:35, M 8:00), closed, and a copy of it at
 * TR 2:00, M 3:00 with seats. The goal prefers the closed one, so it is what the default filter
 * recommends; Open seats only recommends the other.
 */
function closedFirstCatalog(): SectionCatalog {
  const input = fixtureInput();
  const rows = input.courses["MATH 1680"].sections;
  const later = structuredClone(rows[0]);
  renumber(later, ["7100", "7101"]);
  const LATER: Record<string, [string, string]> = { "9:35AM": ["2:00PM", "3:20PM"], "8:00AM": ["3:00PM", "3:50PM"] };
  for (const line of [later, ...later.linked_sections, ...later.meetings]) {
    const moved = LATER[line.start_time];
    if (moved) [line.start_time, line.end_time] = moved;
  }
  rows.push(later);
  rows[0].status = "Closed";
  return fixtureCatalog(input);
}

describe("a saved copy previews what Use in Main would pick", () => {
  // PR #62 review (discussion_r4274437603): previews resolved unpicked courses with the default
  // filter while Main uses the student's, so Use in Main could land on a section the preview never showed.
  const OPEN_SEATS: CandidateFilter = { openSeatsOnly: true, otherSites: false };

  /** The meetings Main shows for MATH 1680 once it holds the copy, as the detail's meeting list words them. */
  async function mainWouldShow(catalog: SectionCatalog) {
    const { DEFAULT_CANDIDATE_FILTER, getInitialPlannerState, normalizePlannerState, resolveSectionPlan } = await import("@/lib/planner");
    const { scheduleEventsOf } = await import("@/lib/planner-sections");
    const { spokenClock, toMinutes } = await import("@/lib/plan-library/week");
    const initial = getInitialPlannerState();
    const copy = normalizePlannerState({ ...initial, courseStatuses: { ...initial.courseStatuses, "MATH 1680": "inProgress" } });
    const words = (filter: CandidateFilter) => {
      const section = resolveSectionPlan(copy, catalog, filter).courses.find((course) => course.code === "MATH 1680")?.section;
      if (!section) throw new Error("MATH 1680 has no recommended section");
      return scheduleEventsOf(section).map((event) => `${spokenClock(toMinutes(event.start))} to ${spokenClock(toMinutes(event.end))}`);
    };
    const shown = words(OPEN_SEATS);
    // The test means something only while the two filters disagree.
    expect(shown).not.toEqual(words(DEFAULT_CANDIDATE_FILTER));
    return { shown, notShown: words(DEFAULT_CANDIDATE_FILTER) };
  }
  const meetings = () => [...document.querySelectorAll('aside [aria-label="Meetings"] li')].map((li) => li.textContent ?? "").filter((text) => text.startsWith("MATH 1680"));

  test("the detail draws the section Main's Open seats would recommend", async () => {
    const catalog = closedFirstCatalog();
    const { shown, notShown } = await mainWouldShow(catalog);
    const view = await page({ saved: [["Calculus", ["MATH 1680"]]], catalog, filter: OPEN_SEATS });
    await click(button("Open Calculus"));
    const lines = meetings();
    expect(lines.length).toBe(shown.length);
    for (const time of shown) expect(lines.some((line) => line.includes(time))).toBe(true);
    for (const time of notShown) expect(lines.some((line) => line.includes(time))).toBe(false);
    await view.unmount();
  });

  test("Compare's sections and figures use the same section", async () => {
    const catalog = closedFirstCatalog();
    await mainWouldShow(catalog);
    const view = await page({ saved: [["Calculus", ["MATH 1680"]]], catalog, filter: OPEN_SEATS });
    await click(button("Compare"));
    await click(button("Compare Main"));
    await click(button("Compare Calculus"));
    const change = [...document.querySelectorAll('aside [aria-labelledby="changes-title"] li')].find((li) => li.textContent?.includes("MATH 1680"))?.textContent ?? "";
    // The open option meets at 2:00 and 3:00; the closed one at 9:35 and 8:00.
    expect(change).toContain("TR 2:00");
    expect(change).not.toContain("9:35");
    // Its last class ends at 3:50 on Monday, against Main's sample sections.
    expect(figures().find((row) => row[0] === "Last class ends")?.[2]).toStartWith("3:50");
    await view.unmount();
  });
});

/**
 * ANTH 1010 with two real options alike but for the day, Monday or Tuesday 9:00 to 10:00, so the
 * goal scores them the same: the exact tie #134's instructor evidence breaks. Other courses stay loading.
 */
function tiedCatalog(): SectionCatalog {
  const code = "ANTH 1010";
  const option = (id: string, day: Meeting["day"]): Section => ({
    id, term: "spring-2027", courseCode: code, sectionCode: id.slice(-3), classNumbers: [id.slice(-3)], option: "1",
    instructor: { display: "Jane Doe", raw: "Doe,Jane" }, seats: { open: 25, total: 40 }, status: "open", rawStatus: "Open",
    session: { label: "Full Term", dates: { start: null, end: null, raw: "" } }, components: [], online: false, async: false, tba: false,
    meetings: [{
      room: "204", buildingCode: "NTDP", buildingId: "ntdp", buildingName: "Discovery Park", kind: "building", offCampus: false,
      day, startMinutes: 540, endMinutes: 600, dates: { start: null, end: null, raw: "" },
      instructor: { display: "Jane Doe", raw: "Doe,Jane" }, async: false, tba: false,
    }],
  });
  const result: CourseSections = {
    status: "ok", availability: "sections", term: "spring-2027", courseCode: code, diagnostic: null,
    provenance: { kind: "real", source: "vsb.untgrades.app", updatedAt: "2026-10-15T00:00:00Z", note: "" }, checkedAt: "2026-10-15T00:00:00Z",
    sections: [option("anth-1010-001", "Mon"), option("anth-1010-002", "Tue")],
  };
  return (course) => (course === code ? { status: "ready", result } : { status: "loading" });
}

describe("a saved copy breaks ties with Main's instructor evidence", () => {
  // #134's tie-break: Main resolves with the evidence it has read, so a preview without it could
  // show the Monday option while Use in Main lands on Tuesday's stronger instructor.
  const evidence: Evidence = { "ANTH 1010": { "anth-1010-001": 280, "anth-1010-002": 350 } };
  const meetings = () => [...document.querySelectorAll('aside [aria-label="Meetings"] li')].map((li) => li.textContent ?? "").filter((text) => text.startsWith("ANTH 1010"));

  test("the detail draws the section Main's evidence picks", async () => {
    const { DEFAULT_CANDIDATE_FILTER, getInitialPlannerState, resolveSectionPlan } = await import("@/lib/planner");
    const catalog = tiedCatalog();
    const initial = getInitialPlannerState();
    const copy = { ...initial, courseStatuses: { ...initial.courseStatuses, "ANTH 1010": "inProgress" as const } };
    // The test means something only while evidence decides: without it the tie falls to Monday's id.
    expect(resolveSectionPlan(copy, catalog, DEFAULT_CANDIDATE_FILTER).selections["ANTH 1010"]).toBe("anth-1010-001");
    expect(resolveSectionPlan(copy, catalog, DEFAULT_CANDIDATE_FILTER, undefined, evidence).selections["ANTH 1010"]).toBe("anth-1010-002");

    const view = await page({ saved: [["Anthropology", ["ANTH 1010"]]], catalog, evidence });
    await click(button("Open Anthropology"));
    expect(meetings()).toEqual(["ANTH 1010, Tuesday 9:00 AM to 10:00 AM"]);
    await view.unmount();
  });
});
