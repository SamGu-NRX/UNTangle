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
import { newBusyId, paint } from "@/components/schedule-builder/limits";
import { asyncMeeting, meeting, section } from "./fixtures";

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
  const edits = { place: mock((): string | null => null), remove: mock(() => {}), keep: mock(() => {}), use: mock((): string[] => []), clear: mock(() => {}), undo: mock(() => {}), canUndo: true };
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
    setup: null,
    browse: null,
    walk: (a, b) => {
      const minutes = MINUTES[`${a}|${b}`] ?? MINUTES[`${b}|${a}`];
      return minutes === undefined ? null : { seconds: minutes * 60, shuttle: false };
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
    calendars: null,
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
  test("a class that meets during a calendar's busy time is marked with the date, and the busy time shows beside it", async () => {
    const { value } = host([course(statsTr)]);
    const work = {
      id: "cal-work",
      name: "Work",
      sealedUrl: "cf1.k.i.s",
      feedId: "WorkFeedIdAAAAAAAAAAAA",
      termId: "spring-2027",
      checkedAt: "2026-10-15T12:00:00.000Z",
      busy: [{ start: 540, end: 600, dates: ["2027-02-16"] }],
      allDayDates: [],
      countAllDay: false,
    };
    const calendars = { term: { id: "spring-2027", label: "Spring 2027", start: "2027-01-11", end: "2027-05-07" }, check: async () => ({ ok: false as const, problem: { kind: "offline" as const, message: "" } }), connect: async () => ({ ok: false as const, problem: { kind: "offline" as const, message: "" } }), problems: {} };
    const view = await render({ ...value, preferences: { ...preferences, calendars: [work] }, calendars });
    const tuesday = view.container.querySelector<HTMLElement>('[data-key="MATH 3680#0"]')!;
    const thursday = view.container.querySelector<HTMLElement>('[data-key="MATH 3680#1"]')!;
    expect(tuesday.hasAttribute("data-conflict")).toBe(true);
    expect(tuesday.textContent).toContain("Work, Feb 16");
    expect(tuesday.textContent).toContain("meets during Work, Feb 16");
    expect(thursday.hasAttribute("data-conflict")).toBe(false);
    const band = view.container.querySelector<HTMLElement>('[data-kind="calendar"]')!;
    expect(band.hasAttribute("data-beside")).toBe(true);
    expect(band.textContent).toContain("Feb 16 only");
    expect(view.container.textContent?.replace(/\u00a0/g, " ")).toContain("MATH 3680 meets during work on Tuesday, Feb 16.");
    await view.unmount();
  });

  test("the answer line names the tight walk once, with a fix that runs Auto", async () => {
    const { value, optimizer } = host([course(csce), course(math), course(phys)]);
    const view = await render(value);
    // Course codes are joined by a no-break space so they never split across lines.
    expect(view.container.textContent).toContain("The walk to PHYS\u00a02220 on Monday and Wednesday is tight.");
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

  test("Auto's sentence and Details follow the student's time of day", async () => {
    // Option 1 moves CSCE 2110 from 2:00 to 9:00, so the week starts at 9:00 instead of 10:00.
    const week = [course(csceLate), course(math)];
    const option1 = { "CSCE 2110": csce.id, "MATH 2700": math.id };
    const cases = [
      { mornings: 4, sentence: "Starts at 9:00 instead of 10:00 by moving CSCE 2110 to 9:00.", firstClass: "better" },
      // With no lean, the week ending at 10:50 instead of 2:50 is the gain, and the earlier start the cost.
      { mornings: 0, sentence: "Ends by 10:50, but Monday, Wednesday and Friday start at 9:00.", firstClass: "worse" },
    ];
    for (const { mornings, sentence, firstClass } of cases) {
      const leaning = { ...preferences, weights: { ...preferences.weights, mornings } };
      const start = host(week);
      const view = await render({ ...start.value, preferences: leaning });
      await click(buttons(view.container, /^Auto/)[0]);
      await view.update({ ...host(week, { runId: 1, status: "done", options: [option1] }).value, preferences: leaning });
      // The strip keeps course codes whole with a no-break space.
      // The strip's text is its count, the sentence, then its buttons.
      expect(view.container.querySelector('[aria-label="Other weeks Auto found"]')!.textContent?.replace(/\u00a0/g, " ")).toBe(`1 of 1${sentence}DetailsUse this`);
      await click(buttons(view.container, /^Details$/)[0]);
      const row = [...document.querySelectorAll("aside tr")].find((tr) => tr.querySelector("th")?.textContent === "First class")!;
      expect(row.querySelectorAll("td")[1].getAttribute("data-change")).toBe(firstClass);
      await view.unmount();
    }
  });

  test("on a phone a class's sheet and an option's Details sheet have their title and a Close button", async () => {
    const realMatch = window.matchMedia;
    // The phone layout (PHONE_QUERY in use-media-query.ts); everything else stays as happy-dom answers.
    const phoneList = (media: string) =>
      ({ matches: true, media, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }) as unknown as MediaQueryList;
    window.matchMedia = ((query: string) => (query === "(max-width: 759px)" ? phoneList(query) : realMatch.call(window, query))) as typeof window.matchMedia;
    try {
      const week = [course(csceLate), course(math)];
      const view = await render(host(week).value);
      await click(view.container.querySelector('[data-key="CSCE 2110#0"]')!);
      let sheet = document.querySelector<HTMLElement>('[role="dialog"]')!;
      expect(sheet.querySelector("h2")?.textContent).toBe("CSCE 2110");
      expect(buttons(sheet, /^Close CSCE 2110$/)).toHaveLength(1);
      await click(buttons(sheet, /^Close CSCE 2110$/)[0]);

      await click(buttons(view.container, /^Auto/)[0]);
      await view.update(host(week, { runId: 1, status: "done", options: [{ "CSCE 2110": csce.id, "MATH 2700": math.id }] }).value);
      await click(buttons(view.container, /^Details$/)[0]);
      sheet = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1)!;
      expect(sheet.querySelector("h2")?.textContent).toBe("Option 1 next to your week");
      expect(buttons(sheet, /^Close Option 1 next to your week$/)).toHaveLength(1);
      await view.unmount();
    } finally {
      window.matchMedia = realMatch;
    }
  });

  test("on a phone, Export says inside its sheet when the browser blocks copying, where a toast couldn't show", async () => {
    const realMatch = window.matchMedia;
    const phoneList = (media: string) =>
      ({ matches: true, media, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }) as unknown as MediaQueryList;
    window.matchMedia = ((query: string) => (query === "(max-width: 759px)" ? phoneList(query) : realMatch.call(window, query))) as typeof window.matchMedia;
    const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    // The refusal Safari gives a write it doesn't allow.
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => Promise.reject(new DOMException("Not allowed", "NotAllowedError")) } });
    try {
      const numbered = section({ courseCode: "CSCE 2110", sectionCode: "001", classNumbers: ["12345"], meetings: [meeting({ day: "Mon", at: "9:00", until: "9:50" })] });
      const view = await render(host([course(numbered)]).value);
      await click(buttons(view.container, /^Export$/)[0]);
      const sheet = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1)!;
      await click(buttons(sheet, /^Copy all 1$/)[0]);
      const { act } = await import("react");
      await act(async () => {
        await Bun.sleep(0);
      });
      const alert = sheet.querySelector('[role="alert"]');
      expect(alert?.textContent).toBe("This browser blocked copying. Select the text and copy it instead.");
      // Said beside the control that failed, in the class numbers part.
      expect(alert?.closest("section")?.querySelector("h3")?.textContent).toContain("Class numbers for myUNT");
      expect(document.querySelector(".ui-toast")).toBeNull();
      await view.unmount();
    } finally {
      window.matchMedia = realMatch;
      if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
      else delete (navigator as { clipboard?: unknown }).clipboard;
    }
  });

  test("Export says a picture downloaded, and shows the share link to select when copying is blocked", async () => {
    // A canvas that draws nothing and hands back an empty PNG, as tests/schedule-builder/week-png-dom.test.ts does.
    const context = new Proxy({} as Record<string | symbol, unknown>, { get: () => () => {}, set: () => true });
    const canvas = { width: 0, height: 0, getContext: () => context, toBlob: (done: (blob: Blob) => void) => done(new Blob()) };
    const createElement = document.createElement.bind(document);
    document.createElement = ((tag: string) => (tag === "canvas" ? canvas : createElement(tag))) as typeof document.createElement;
    Object.defineProperty(document, "fonts", { value: { ready: Promise.resolve() }, configurable: true });
    const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => Promise.reject(new DOMException("Not allowed", "NotAllowedError")) } });
    const { act } = await import("react");
    try {
      const view = await render(host([course(csce)]).value);
      await click(buttons(view.container, /^Export$/)[0]);
      const sheet = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1)!;
      const part = (title: string) => [...sheet.querySelectorAll("section")].find((section) => section.querySelector("h3")?.textContent?.includes(title))!;

      await click(buttons(sheet, /^Download \.png$/)[0]);
      await act(async () => {
        await Bun.sleep(0);
      });
      expect(part("Picture of the week").querySelector('[role="status"]')?.textContent).toBe("Downloaded a picture of your week");

      await click(buttons(sheet, /^Copy share link$/)[0]);
      await act(async () => {
        await Bun.sleep(0);
      });
      const share = part("Share and back up");
      expect(share.querySelector('[role="alert"]')?.textContent).toBe("This browser blocked copying. Select the link and copy it instead.");
      const link = share.querySelector<HTMLInputElement>('input[aria-label="Share link"]');
      expect(link?.readOnly).toBe(true);
      expect(link?.value.startsWith("http://localhost/schedule?week=")).toBe(true);
      await view.unmount();
    } finally {
      document.createElement = createElement;
      if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
      else delete (navigator as { clipboard?: unknown }).clipboard;
    }
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
    expect(buttons(view.container, /^Move CSCE 2110 to section 002/)).toHaveLength(3);
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

describe("Week's review fixes", () => {
  const hist = (sectionCode: string, overrides: Partial<Section> = {}, meetings = [meeting({ day: "Mon", at: "13:00", until: "13:50" })]) => ({
    ...section({ courseCode: "HIST 2610", sectionCode, open: 20, meetings }),
    ...overrides,
  });
  const lecture = hist("002");
  const tba = { ...meeting({ day: "Mon", at: "9:00", until: "9:50" }), day: null, startMinutes: null, endMinutes: null, tba: true };
  const HIST = [
    hist("001", {}, [meeting({ day: "Sat", at: "9:00", until: "11:50" })]),
    // Linked to a lab with no seats: the lecture's own count says open.
    { ...lecture, components: [lecture.components[0], { ...lecture.components[0], id: "HIST 2610-lab", role: "required-linked" as const, seats: { open: 0, total: 20 } }] },
    hist("003", { status: "waitlist" }),
    hist("004", {}, [tba]),
    hist("005", { online: true }, [asyncMeeting]),
  ];
  const withHistory = (base: BuilderHost, find: BuilderHost["search"]["find"] = () => [{ code: "HIST 2610", title: "American History" }]): BuilderHost => ({
    ...base,
    search: { ...base.search, find, options: (code) => (code === "HIST 2610" ? HIST : (OPTIONS[code] ?? null)) },
  });
  const rows = () => [...document.querySelectorAll('aside [aria-label="HIST 2610 sections"] button')].map((b) => /section (\d+)/.exec(b.getAttribute("aria-label")!)![1]);
  const searchHistory = async (h: BuilderHost) => {
    const view = await render(h, { nonce: 1, query: "HIST" });
    await click(buttons(document.querySelector("aside")!, /^HIST 2610/)[0]);
    return view;
  };
  // The live region announces a toast at once; the visible one waits for its predecessor's exit.
  const toastText = () => document.querySelector("[data-ui-live]")?.textContent ?? null;
  const withToaster = async () => {
    const { Toaster } = await import("@/components/ui/Toast");
    return mount(<Toaster />);
  };

  test("search shows weekend sections with no filter on", async () => {
    const view = await searchHistory(withHistory(host([]).value));
    expect(rows()).toEqual(["001", "002", "003", "004", "005"]);
    await view.unmount();
  });

  test("Open seats hides wait-listed sections and those whose linked lab is full", async () => {
    const view = await searchHistory(withHistory(host([]).value));
    await click(buttons(document.querySelector("aside")!, /^Open seats$/)[0]);
    expect(rows()).toEqual(["001", "004", "005"]);
    await view.unmount();
  });

  test("a section with no set time counts as online only when it meets online", async () => {
    const view = await searchHistory(withHistory(host([]).value));
    await click(buttons(document.querySelector("aside")!, /^Online$/)[0]);
    expect(rows()).toEqual(["001", "002", "003", "004"]);
    await view.unmount();
  });

  test("a four-digit query is a course number when a course matches it, else a class number", async () => {
    const base = host([]).value;
    const classNumber = mock(async (n: string) => (n === "6862" ? { courseCode: "HIST 2610", sectionId: HIST[1].id } : null));
    const find = (query: string) => (query === "2110" ? [{ code: "CSCE 2110", title: "Foundations of Data Structures" }] : query === "HIST 2610" ? [{ code: "HIST 2610", title: "American History" }] : []);
    const h = withHistory({ ...base, search: { ...base.search, classNumber } }, find);
    const view = await render(h, { nonce: 1, query: "2110" });
    expect(buttons(document.querySelector("aside")!, /^CSCE 2110/)).toHaveLength(1);
    await view.update(h, { nonce: 2, query: "6862" });
    expect(classNumber.mock.calls.map(([n]) => n)).toEqual(["6862"]);
    expect(rows()).toContain("002");
    await view.unmount();
  });

  test("the toast's Undo works once the edit that showed it has committed", async () => {
    const toaster = await withToaster();
    const h = host([course(csce), course(math)]);
    const view = await render({ ...h.value, edits: { ...h.edits, canUndo: false } }, { nonce: 1, query: "MATH 36" });
    const panel = document.querySelector("aside")!;
    await click(buttons(panel, /^MATH 3680/)[0]);
    await click(buttons(panel, /^Add section 002$/)[0]);
    // The edit commits: the host now has something to undo.
    await view.update({ ...h.value, edits: { ...h.edits, canUndo: true } });
    await click(document.querySelector(".ui-toast__action")!);
    expect(h.edits.undo).toHaveBeenCalledTimes(1);
    await view.unmount();
    await toaster.unmount();
  });

  test("Use this names the courses it left out, and keeps the preview when it used none", async () => {
    const toaster = await withToaster();
    const { ScheduleBuilder } = await import("@/components/schedule-builder/ScheduleBuilder");
    const shared = { term: "spring-2027", sections: { "CSCE 2110": csceLate.id, "MATH 2700": math.id } };
    const h = host([course(csce)]);
    const node = (edits: BuilderHost["edits"]) => <ScheduleBuilder host={{ ...h.value, edits }} scheduleName="Main" searchRequest={null} shared={shared} onSharedSeen={() => {}} />;
    const refuseAll = { ...h.edits, use: mock(() => ["You're taking CSCE 2110 now, so it isn't planned for Spring 2027.", "MATH 2700 is done already."]) };
    const view = await mount(node(refuseAll));
    await click(buttons(view.container, /^Use this$/)[0]);
    expect(toastText()).toBe("Nothing from the shared week was used. You're taking CSCE 2110 now, so it isn't planned for Spring 2027. MATH 2700 is done already.");
    expect(view.container.querySelector('[aria-label="Shared week"]')).not.toBeNull();

    await view.rerender(node({ ...h.edits, use: mock(() => ["MATH 2700 is done already."]) }));
    await click(buttons(view.container, /^Use this$/)[0]);
    expect(toastText()).toBe("Using the shared week. MATH 2700 is done already.");
    expect(view.container.querySelector('[aria-label="Shared week"]')).toBeNull();
    await view.unmount();
    await toaster.unmount();
  });

  test("Export ranks a linked section by its scarcest component", async () => {
    const roomy = section({ courseCode: "MATH 2700", sectionCode: "003", open: 12, classNumbers: ["2200"], meetings: math.meetings });
    const linked = section({ courseCode: "CSCE 2110", sectionCode: "001", open: 99, classNumbers: ["1100"], meetings: csce.meetings });
    const lab = { ...linked.components[0], id: "lab", classNumber: "1101", role: "required-linked" as const, seats: { open: 1, total: 20 } };
    const view = await render(host([course(roomy), course({ ...linked, components: [...linked.components, lab] })]).value);
    await click(buttons(view.container, /^Export$/)[0]);
    const items = [...document.querySelectorAll("ol li")].map((li) => li.textContent);
    expect(items).toEqual(["1100 1101CSCE 2110 §001Few seats", "2200MATH 2700 §003"]);
    await view.unmount();
  });

  test("Undo on a painted busy time removes that time and keeps later preference changes, time painted on to it included", async () => {
    const toaster = await withToaster();
    let prefs = preferences;
    const h = host([course(csce)]);
    const view = await render({ ...h.value, setPreferences: (update) => void (prefs = update(prefs)) });
    const tuesday = view.container.querySelector<HTMLElement>('[data-day="Tue"]')!;
    tuesday.getBoundingClientRect = () => ({ top: 0, height: 900, left: 0, width: 100, right: 100, bottom: 900, x: 0, y: 0, toJSON: () => ({}) });
    tuesday.setPointerCapture = () => {};
    const { act } = await import("react");
    // The grid runs 8 AM to 5 PM over 900px: 1 PM is 500px down, 3 PM 700px.
    for (const [type, y] of [["pointerdown", 500], ["pointermove", 700], ["pointerup", 700]] as const) {
      await act(async () => {
        tuesday.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: "mouse", button: 0, clientY: y, pointerId: 1 }));
      });
    }
    expect(prefs.constraints.blocked.map(({ day, start, end }) => `${day} ${start}-${end}`)).toEqual(["Tue 780-900"]);
    // Later, in Preferences: Fridays off, and 3:00–3:30 painted on, which grows the same block.
    prefs = paint({ ...prefs, constraints: { ...prefs.constraints, daysOff: ["Fri"] } }, ["Tue"], 900, 930, "busy", newBusyId);
    expect(prefs.constraints.blocked.map(({ day, start, end }) => `${day} ${start}-${end}`)).toEqual(["Tue 780-930"]);
    await click(document.querySelector(".ui-toast__action")!);
    expect(prefs.constraints.blocked.map(({ day, start, end }) => `${day} ${start}-${end}`)).toEqual(["Tue 900-930"]);
    expect(prefs.constraints.daysOff).toEqual(["Fri"]);
    await view.unmount();
    await toaster.unmount();
  });
});
