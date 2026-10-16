/**
 * Browse all through the DOM with a fake host: the button beside Auto's
 * options, the list and its figures, pointing at a row to preview it on the
 * grid, choosing one with the pointer or the keyboard (exactly its sections,
 * with Undo), a list too long to render whole, a list whose settings
 * changed, and nothing fitting.
 */
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import type { BrowseFeed, BrowseRow, BuilderHost, OptionsFeed, WeekCourse } from "@/components/schedule-builder/host";
import type { Section } from "@/lib/sections";
import type { SchedulePreferences } from "@/lib/types";
import { click, installDom, mount, press, removeDom } from "../ui/dom";
import { meeting, section } from "./fixtures";

beforeAll(() => {
  installDom();
});
afterEach(async () => {
  const { dismissToast } = await import("@/components/ui/Toast");
  dismissToast();
});
afterAll(() => {
  removeDom();
});

const mwf = (code: string, sectionCode: string, at: string, until: string) =>
  section({ courseCode: code, sectionCode, open: 12, meetings: (["Mon", "Wed", "Fri"] as const).map((day) => meeting({ day, at, until, building: "gab" })) });
const tr = (code: string, sectionCode: string, at: string, until: string) =>
  section({ courseCode: code, sectionCode, open: 12, meetings: (["Tue", "Thu"] as const).map((day) => meeting({ day, at, until, building: "gab" })) });
const csce1 = mwf("CSCE 2110", "001", "9:00", "9:50");
const csce2 = tr("CSCE 2110", "002", "9:30", "10:50");
const csce3 = mwf("CSCE 2110", "003", "9:00", "9:50"); // same times as 001: a twin
const math1 = mwf("MATH 2700", "001", "10:00", "10:50");
const math2 = tr("MATH 2700", "002", "14:00", "15:20");
const ALL: Section[] = [csce1, csce2, csce3, math1, math2];

const preferences: SchedulePreferences = {
  constraints: { earliestStart: null, latestEnd: null, daysOff: [], blocked: [], maxCredits: null, walkingBufferMinutes: 0, excludedSections: [], openSeatsOnly: false, otherSites: false },
  weights: { fewerDays: 1, compact: 1, mornings: 0, evenings: 0, walking: 0, rating: 0 },
};
const course = (s: Section): WeekCourse => ({ code: s.courseCode, title: s.courseCode, credits: 3, section: s, state: "placed", locked: false });
const row = (csce: Section, math: Section, days: number): BrowseRow => ({
  byCourse: { "CSCE 2110": csce.id, "MATH 2700": math.id },
  daysOnCampus: days,
  earliestStart: 540,
  latestEnd: 920,
});
const ROWS: BrowseRow[] = [row(csce1, math1, 3), row(csce3, math1, 3), row(csce2, math1, 5), row(csce1, math2, 5)];

function host(feed: Partial<BrowseFeed> = {}, options: Partial<OptionsFeed> = {}) {
  const edits = { place: mock((): string | null => null), remove: mock(() => {}), keep: mock(() => {}), use: mock((): string[] => []), clear: mock(() => {}), undo: mock(() => {}), canUndo: true };
  const optimizer: OptionsFeed = {
    runId: 1,
    status: "done",
    options: [ROWS[0].byCourse, ROWS[3].byCourse],
    stale: false,
    infeasible: null,
    error: null,
    explain: () => [],
    run: mock(() => {}),
    close: mock(() => {}),
    ...options,
  };
  const browse: BrowseFeed = {
    status: "done",
    rows: ROWS,
    total: ROWS.length,
    totalExact: true,
    proven: true,
    stale: false,
    infeasible: null,
    timedOut: false,
    error: null,
    run: mock(() => {}),
    close: mock(() => {}),
    ...feed,
  };
  const value: BuilderHost = {
    brand: { id: "untangle", primaryLabel: "Auto", primaryShort: "Auto", suggestions: false },
    term: { id: "spring-2027", label: "Spring 2027" },
    // The week as it is: CSCE 2110 002 and MATH 2700 001 overlap nothing.
    courses: [course(csce2), course(math1)],
    provenance: "real",
    preferences,
    defaults: preferences,
    setPreferences: () => {},
    preferencesReady: true,
    setup: null,
    walk: () => null,
    search: { find: () => [], suggestions: () => [], options: (code) => ALL.filter((s) => s.courseCode === code), load: () => {}, classNumber: async () => null },
    edits,
    optimizer,
    browse,
    find: (code, id) => ALL.find((s) => s.courseCode === code && s.id === id),
    printHref: "/schedule/print",
    shareUrl: (encoded) => `http://localhost/schedule?week=${encoded}`,
    calendars: null,
  };
  return { value, edits, optimizer, browse };
}

async function render(builderHost: BuilderHost) {
  const { ScheduleBuilder } = await import("@/components/schedule-builder/ScheduleBuilder");
  const { Toaster } = await import("@/components/ui/Toast");
  const node = (h: BuilderHost) => (
    <>
      <ScheduleBuilder host={h} scheduleName="Main" searchRequest={null} shared={null} onSharedSeen={() => {}} />
      <Toaster />
    </>
  );
  const view = await mount(node(builderHost));
  return { ...view, update: (h: BuilderHost) => view.rerender(node(h)) };
}

const buttons = (root: ParentNode, name: RegExp) =>
  [...root.querySelectorAll<HTMLButtonElement>("button")].filter((b) => name.test(b.getAttribute("aria-label") ?? b.textContent ?? ""));
const gridEvents = (root: ParentNode) => [...root.querySelectorAll<HTMLButtonElement>("[data-event]")].map((b) => b.textContent ?? "");
const listbox = () => document.querySelector<HTMLElement>('[role="listbox"]')!;
const option = (index: number) => document.getElementById(`combination-${index}`)!;
const toastText = () => document.querySelector(".ui-toast")?.textContent ?? "";

async function hover(target: Element) {
  const { act } = await import("react");
  await act(async () => {
    target.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
  });
}

/** Auto's strip is up; Browse all opens the list. */
async function openBrowse(h: ReturnType<typeof host>) {
  const view = await render(h.value);
  await click(buttons(view.container, /^Auto/)[0]);
  await view.update(h.value);
  await click(buttons(view.container, /^Browse all$/)[0]);
  return view;
}

describe("Browse all", () => {
  test("beside Auto's options; opens every combination with its figures and section names", async () => {
    const h = host();
    const view = await openBrowse(h);
    expect(h.browse.run).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("4 combinations fit. Ranked by your preferences.");
    const options = [...listbox().querySelectorAll('[role="option"]')];
    expect(options).toHaveLength(4);
    expect(options[0].getAttribute("aria-label")).toBe(
      "Combination 1: 3 days, 9:00 to 3:20. CSCE 2110 section 001; MATH 2700 section 001, same as your week.",
    );
    // The twin row is its own row, named by its own section.
    expect(options[1].getAttribute("aria-label")).toContain("CSCE 2110 section 003");
    // The row that is the week as it is says so.
    expect(options[2].getAttribute("aria-label")).toContain("your week");
    expect(options.map((o) => o.getAttribute("aria-posinset"))).toEqual(["1", "2", "3", "4"]);
    expect(options.every((o) => o.getAttribute("aria-setsize") === "4")).toBe(true);
    await view.unmount();
  });

  test("pointing at a row previews it on the grid and in the strip", async () => {
    const h = host();
    const view = await openBrowse(h);
    // The list lands on the option the strip showed: row 1.
    expect(option(0).getAttribute("aria-selected")).toBe("true");
    await hover(option(3));
    expect(gridEvents(view.container).filter((label) => label.startsWith("MATH 2700 2:00–3:20"))).toHaveLength(2);
    expect(gridEvents(view.container).filter((label) => label.startsWith("CSCE 2110 9:00–9:50"))).toHaveLength(3);
    expect(view.container.querySelector('[aria-label="Combination on the grid"]')!.textContent).toContain("4 of 4");
    await view.unmount();
  });

  test("choosing a row uses exactly its sections, with Undo; Auto can run again", async () => {
    const h = host();
    const view = await openBrowse(h);
    await click(option(1));
    expect(h.edits.use).toHaveBeenCalledTimes(1);
    expect(h.edits.use).toHaveBeenCalledWith(ROWS[1].byCourse);
    expect(toastText()).toContain("Using combination 2");
    expect(h.browse.close).toHaveBeenCalled();
    expect(listbox()).toBeNull();
    await click(buttons(document.body, /^Undo$/).find((b) => b.closest(".ui-toast"))!);
    expect(h.edits.undo).toHaveBeenCalledTimes(1);
    // Auto again: a fresh run from the plan the host now holds.
    await click(buttons(view.container, /^Auto/)[0]);
    expect(h.optimizer.run).toHaveBeenCalledTimes(2);
    await view.unmount();
  });

  test("from the keyboard: arrows move through the rows, Enter uses one", async () => {
    const h = host();
    const view = await openBrowse(h);
    await press(listbox(), "ArrowDown");
    await press(listbox(), "ArrowDown");
    expect(listbox().getAttribute("aria-activedescendant")).toBe("combination-2");
    expect(view.container.querySelector('[aria-label="Combination on the grid"]')!.textContent).toContain("This is your week.");
    await press(listbox(), "End");
    expect(listbox().getAttribute("aria-activedescendant")).toBe("combination-3");
    await press(listbox(), "Enter");
    expect(h.edits.use).toHaveBeenCalledWith(ROWS[3].byCourse);
    await view.unmount();
  });

  test("opened from the keyboard, focus goes into the list and comes back to Browse all on Escape", async () => {
    const h = host();
    // A click with detail 0 is a keyboard press (Enter or Space on the button).
    const view = await openBrowse(h);
    expect(document.activeElement).toBe(listbox());
    await press(listbox(), "Escape");
    expect(listbox()).toBeNull();
    expect(document.activeElement?.textContent).toBe("Browse all");
    await view.unmount();
  });

  test("a huge list renders only the rows near the view, and says how many fit", async () => {
    const many = Array.from({ length: 500 }, (_, i) => ROWS[i % ROWS.length]);
    const h = host({ rows: many, total: 937_570, totalExact: false, proven: false });
    const view = await openBrowse(h);
    expect(document.body.textContent).toContain(
      "At least 937,570 combinations fit. Showing the best 500, ranked by your preferences. Best found within the time limit; a better one may exist.",
    );
    const rendered = listbox().querySelectorAll('[role="option"]');
    expect(rendered.length).toBeLessThan(40);
    expect(rendered[0].getAttribute("aria-setsize")).toBe("500");
    await press(listbox(), "End");
    expect(option(499).getAttribute("aria-posinset")).toBe("500");
    expect(view.container.querySelector('[aria-label="Combination on the grid"]')!.textContent).toContain("500 of 937,570+");
    await view.unmount();
  });

  test("a list from settings that changed since can't be used, and runs again", async () => {
    const h = host();
    const view = await openBrowse(h);
    const changed = host({ stale: true });
    await view.update(changed.value);
    expect(changed.browse.run).toHaveBeenCalled();
    expect(listbox().getAttribute("aria-disabled")).toBe("true");
    await click(option(1));
    expect(changed.edits.use).not.toHaveBeenCalled();
    await view.unmount();
  });

  test("an error after the settings changed stays, with Try again, and is not retried on its own", async () => {
    const h = host();
    const view = await openBrowse(h);
    const failed = host({ stale: true, status: "error", error: "The optimizer stopped unexpectedly." });
    await view.update(failed.value);
    await view.update(failed.value);
    expect(failed.browse.run).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Browse all stopped before it listed any weeks. The optimizer stopped unexpectedly.");
    await click(buttons(document.body, /^Try again$/)[0]);
    expect(failed.browse.run).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  test("nothing fits: the reason and its fixes", async () => {
    const apply = mock(() => {});
    const h = host({ rows: [], total: 0, infeasible: { sentence: "Every section of CSCE 2110 meets on Monday.", fixes: [{ label: "Allow classes on Mondays", apply }] } });
    const view = await openBrowse(h);
    expect(document.body.textContent).toContain("Nothing fits these preferences. Every section of CSCE 2110 meets on Monday.");
    await click(buttons(document.body, /^Allow classes on Mondays$/)[0]);
    expect(apply).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  test("Auto pressed while the list is open stops the list and closes it", async () => {
    const h = host();
    const view = await openBrowse(h);
    await click(buttons(view.container, /^Auto/)[0]);
    expect(h.browse.close).toHaveBeenCalled();
    expect(listbox()).toBeNull();
    expect(view.container.querySelector('[aria-label="Other weeks Auto found"]')).not.toBeNull();
    await view.unmount();
  });

  test("on a phone the list's sheet has its title and a Close button, and opening it focuses the title", async () => {
    const realMatch = window.matchMedia;
    // The phone layout (PHONE_QUERY in use-media-query.ts); everything else stays as happy-dom answers.
    const phoneList = (media: string) =>
      ({ matches: true, media, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }) as unknown as MediaQueryList;
    window.matchMedia = ((query: string) => (query === "(max-width: 759px)" ? phoneList(query) : realMatch.call(window, query))) as typeof window.matchMedia;
    try {
      const h = host();
      const view = await openBrowse(h);
      const sheet = document.querySelector<HTMLElement>('[role="dialog"]')!;
      expect(sheet.querySelector("h2")?.textContent).toBe("All combinations");
      expect(buttons(sheet, /^Close All combinations$/)).toHaveLength(1);
      // A tap opened it: focus starts on the title, not in the list.
      expect(document.activeElement).toBe(sheet.querySelector("h2"));
      await click(buttons(sheet, /^Close All combinations$/)[0]);
      expect(h.browse.close).toHaveBeenCalled();
      await view.unmount();
    } finally {
      window.matchMedia = realMatch;
    }
  });

  test("closing the list goes back to Auto's strip", async () => {
    const h = host();
    const view = await openBrowse(h);
    await click(buttons(document.body, /^Close All combinations$/)[0]);
    expect(h.browse.close).toHaveBeenCalled();
    expect(view.container.querySelector('[aria-label="Other weeks Auto found"]')).not.toBeNull();
    await view.unmount();
  });
});
