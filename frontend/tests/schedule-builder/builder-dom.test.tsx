/**
 * Week through the DOM with a fake host: the answer line, one-tap add with
 * the clash shown first, the side-by-side conflict, Undo and ⌘Z, the
 * alternatives strip that never moves a previewed grid on its own, and
 * Keep this section.
 */
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import type { BuilderHost, OptionsFeed, WeekCourse } from "@/components/schedule-builder/host";
import type { Section } from "@/lib/sections";
import type { SchedulePreferences } from "@/lib/types";
import { click, installDom, mount, press, removeDom } from "../ui/dom";
import { meeting, section } from "./fixtures";

beforeAll(() => {
  installDom();
});
// Toasts with an action stay until dismissed, in a module-level store other test files share.
afterEach(async () => {
  const { dismissToast } = await import("@/components/ui/Toast");
  dismissToast();
});
afterAll(() => {
  removeDom();
});

const mwf = (code: string, sectionCode: string, at: string, until: string, building: string) =>
  section({ courseCode: code, sectionCode, open: 12, meetings: (["Mon", "Wed", "Fri"] as const).map((day) => meeting({ day, at, until, building })) });
const csce = mwf("CSCE 2110", "001", "9:00", "9:50", "gab");
const csceLate = mwf("CSCE 2110", "002", "14:00", "14:50", "gab");
const math = mwf("MATH 2700", "003", "10:00", "10:50", "cury");
const phys = section({ courseCode: "PHYS 2220", sectionCode: "002", open: 7, meetings: (["Mon", "Wed"] as const).map((day) => meeting({ day, at: "11:00", until: "11:50", building: "phys" })) });
const stats = mwf("MATH 3680", "001", "10:00", "10:50", "cury");
const statsTr = section({ courseCode: "MATH 3680", sectionCode: "002", open: 6, meetings: (["Tue", "Thu"] as const).map((day) => meeting({ day, at: "9:30", until: "10:50", building: "gab" })) });
const OPTIONS: Record<string, Section[]> = { "CSCE 2110": [csce, csceLate], "MATH 2700": [math], "PHYS 2220": [phys], "MATH 3680": [stats, statsTr] };
const MINUTES: Record<string, number> = { "gab|cury": 4, "cury|phys": 8 };

const preferences: SchedulePreferences = {
  constraints: { earliestStart: null, latestEnd: null, daysOff: [], blocked: [], maxCredits: null, walkingBufferMinutes: 0, excludedSections: [], openSeatsOnly: false, otherSites: false },
  weights: { fewerDays: 0, compact: 1, mornings: 4, evenings: 0, walking: 0, rating: 0 },
};

const course = (s: Section, locked = false): WeekCourse => ({ code: s.courseCode, title: s.courseCode, credits: 3, section: s, state: "placed", locked });

function host(courses: WeekCourse[], feed: Partial<OptionsFeed> = {}) {
  const edits = { place: mock(() => {}), remove: mock(() => {}), keep: mock(() => {}), use: mock(() => {}), clear: mock(() => {}), undo: mock(() => {}), canUndo: true };
  const optimizer: OptionsFeed = {
    runId: null,
    status: "idle",
    options: [],
    stale: false,
    infeasible: null,
    error: null,
    explain: () => [],
    run: mock(() => {}),
    close: mock(() => {}),
    ...feed,
  };
  const value: BuilderHost = {
    brand: { id: "untangle", primaryLabel: "Auto", primaryShort: "Auto", suggestions: false },
    term: { id: "spring-2027", label: "Spring 2027" },
    courses,
    provenance: "real",
    preferences,
    defaults: preferences,
    setPreferences: () => {},
    preferencesReady: true,
    walk: (a, b) => {
      const minutes = MINUTES[`${a}|${b}`] ?? MINUTES[`${b}|${a}`];
      return minutes === undefined ? null : { minutes, shuttle: false };
    },
    search: {
      find: (query) => (query.toUpperCase().startsWith("MATH 36") ? [{ code: "MATH 3680", title: "Applied Statistics" }] : []),
      suggestions: () => [],
      options: (code) => OPTIONS[code] ?? null,
      load: () => {},
      classNumber: async () => null,
    },
    edits,
    optimizer,
    find: (code, id) => OPTIONS[code]?.find((s) => s.id === id),
    printHref: "/schedule/print",
    shareUrl: (encoded) => `http://localhost/schedule?week=${encoded}`,
  };
  return { value, edits, optimizer };
}

async function render(builderHost: BuilderHost, searchRequest: { nonce: number; query: string } | null = null) {
  const { ScheduleBuilder } = await import("@/components/schedule-builder/ScheduleBuilder");
  const node = (h: BuilderHost, request = searchRequest) => <ScheduleBuilder host={h} scheduleName="Main" searchRequest={request} shared={null} onSharedSeen={() => {}} />;
  const view = await mount(node(builderHost));
  return { ...view, update: (h: BuilderHost, request = searchRequest) => view.rerender(node(h, request)) };
}

const buttons = (root: ParentNode, name: RegExp) =>
  [...root.querySelectorAll<HTMLButtonElement>("button")].filter((b) => name.test(b.getAttribute("aria-label") ?? b.textContent ?? ""));
const events = (root: ParentNode) => [...root.querySelectorAll<HTMLButtonElement>("[data-event]")].map((b) => b.textContent);

describe("Week", () => {
  test("the answer line names the tight walk once, with a fix that runs Auto", async () => {
    const { value, optimizer } = host([course(csce), course(math), course(phys)]);
    const view = await render(value);
    expect(view.container.textContent).toContain("The walk to PHYS 2220 on Monday and Wednesday is tight.");
    await click(buttons(view.container, /^Show a fix$/)[0]);
    expect(optimizer.run).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  test("one tap adds from search; the clash shows before the tap; the added conflict sits side by side", async () => {
    const week = [course(csce), course(math)];
    const { value, edits } = host(week);
    const view = await render(value, { nonce: 1, query: "MATH 36" });
    const panel = document.querySelector("aside")!;
    await click(buttons(panel, /^MATH 3680/)[0]);
    const add = buttons(panel, /^Add section 001/)[0];
    expect(add.getAttribute("aria-label")).toBe("Add section 001, overlaps MATH 2700");
    expect(panel.textContent).toContain("Overlaps MATH 2700 on Mon, Wed and Fri");
    expect(buttons(panel, /^Add section 002$/)).toHaveLength(1);
    await click(add);
    expect(edits.place).toHaveBeenCalledWith("MATH 3680", stats.id);

    // The host's answer: MATH 3680 is on the week, overlapping MATH 2700.
    await view.update(host([...week, course(stats)]).value);
    const labels = events(view.container);
    expect(labels.filter((label) => label?.endsWith("overlaps another class"))).toHaveLength(6);
    const monday = [...view.container.querySelectorAll<HTMLElement>('[data-day="Mon"] [data-event]')].filter((e) => e.dataset.conflict !== undefined);
    expect(monday.map((e) => e.style.width)).toEqual(["calc((100% - 8px) / 2 - 2px)", "calc((100% - 8px) / 2 - 2px)"]);
    await view.unmount();
  });

  test("Undo and ⌘Z both undo; ⌘Z inside a text field is the field's own", async () => {
    const { value, edits } = host([course(csce)]);
    const view = await render(value);
    await click(buttons(view.container, /^Undo$/)[0]);
    await press(document.body, "z", { metaKey: true });
    expect(edits.undo).toHaveBeenCalledTimes(2);
    const input = document.createElement("input");
    document.body.append(input);
    await press(input, "z", { metaKey: true });
    expect(edits.undo).toHaveBeenCalledTimes(2);
    input.remove();
    await view.unmount();
  });

  test("Auto previews option 1; a better answer to the same run waits for Show; Use this applies what's on screen", async () => {
    const week = [course(csce), course(math), course(phys)];
    const first = host(week);
    const view = await render(first.value);
    await click(buttons(view.container, /^Auto/)[0]);
    expect(first.optimizer.run).toHaveBeenCalledTimes(1);

    const option1 = { "CSCE 2110": csceLate.id, "MATH 2700": math.id, "PHYS 2220": phys.id };
    await view.update(host(week, { runId: 7, status: "refining", options: [option1, { ...option1, "CSCE 2110": csce.id }] }).value);
    const strip = view.container.querySelector('[aria-label="Other weeks Auto found"]')!;
    expect(strip.textContent).toContain("1 of 2");
    expect(events(view.container).some((label) => label?.startsWith("CSCE 2110 2:00–2:50, Monday"))).toBe(true);

    // The final answer to run 7 ranks a different week first: the grid stays, Show is offered.
    const better = { ...option1, "CSCE 2110": csce.id };
    const upgraded = host(week, { runId: 7, status: "done", options: [better, option1] });
    await view.update(upgraded.value);
    expect(view.container.textContent).toContain("A better option is ready.");
    expect(events(view.container).some((label) => label?.startsWith("CSCE 2110 2:00–2:50, Monday"))).toBe(true);
    await click(buttons(view.container, /^Use this$/)[0]);
    expect(upgraded.edits.use).toHaveBeenCalledWith(option1);
    await view.unmount();
  });

  test("a result from settings that changed since can't be used", async () => {
    const week = [course(csce), course(math)];
    const view = await render(host(week).value);
    await click(buttons(view.container, /^Auto/)[0]);
    await view.update(host(week, { runId: 3, status: "done", options: [{ "CSCE 2110": csceLate.id, "MATH 2700": math.id }], stale: true }).value);
    expect(buttons(view.container, /^Use this$/)[0].disabled).toBe(true);
    await view.unmount();
  });

  test("selecting an event opens its panel; Keep this section keeps it", async () => {
    const { value, edits } = host([course(csce), course(math)]);
    const view = await render(value);
    await click(view.container.querySelector('[data-key="CSCE 2110#0"]')!);
    const panel = document.querySelector("aside")!;
    expect(panel.getAttribute("aria-labelledby")).toBeTruthy();
    const keep = panel.querySelector<HTMLButtonElement>('[role="switch"]')!;
    expect(keep.getAttribute("aria-checked")).toBe("false");
    await click(keep);
    expect(edits.keep).toHaveBeenCalledWith("CSCE 2110", true);
    // The course's other section is offered on the grid as a dotted outline.
    expect(buttons(view.container, /^Move CSCE 2110 to §002/)).toHaveLength(3);
    await view.unmount();
  });

  test("nothing fits: the reason and its fix, in one strip", async () => {
    const apply = mock(() => {});
    const view = await render(host([course(csce)]).value);
    await click(buttons(view.container, /^Auto/)[0]);
    await view.update(host([course(csce)], { runId: 2, status: "done", infeasible: { sentence: "Every section of CSCE 2110 meets on Monday.", fixes: [{ label: "Allow classes on Mondays", apply }] } }).value);
    expect(view.container.textContent).toContain("Nothing fits these preferences. Every section of CSCE 2110 meets on Monday.");
    await click(buttons(view.container, /^Allow classes on Mondays$/)[0]);
    expect(apply).toHaveBeenCalledTimes(1);
    await view.unmount();
  });
});
