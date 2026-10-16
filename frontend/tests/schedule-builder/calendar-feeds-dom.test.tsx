/**
 * Calendars in Week's Preferences, through the DOM: check an address, name
 * the calendar and add it; pick one of its events instead; remove it with
 * Undo; and the week grid drawing a connected calendar's busy time apart
 * from classes and from the student's own busy time.
 */
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { useEffect, useState } from "react";
import type { BuilderCalendars } from "@/components/schedule-builder/host";
import type { CheckedFeed, Outcome } from "@/lib/calendar-busy";
import type { ConnectedCalendar, SchedulePreferences } from "@/lib/types";
import { click, installDom, mount, removeDom } from "../ui/dom";

beforeAll(() => {
  installDom();
});
const views: Array<() => Promise<void>> = [];
afterEach(async () => {
  const { dismissToast } = await import("@/components/ui/Toast");
  dismissToast();
  while (views.length) await views.pop()!();
});
afterAll(() => {
  removeDom();
});

const TERM = { id: "spring-2027", label: "Spring 2027", start: "2027-01-11", end: "2027-05-07" };
const start: SchedulePreferences = {
  constraints: { earliestStart: null, latestEnd: null, daysOff: [], blocked: [], maxCredits: null, walkingBufferMinutes: 0, excludedSections: [], openSeatsOnly: false, otherSites: false },
  weights: { fewerDays: 0, compact: 1, mornings: 0, evenings: 0, walking: 0, rating: 0 },
};
const work: ConnectedCalendar = {
  id: "cal-work",
  name: "Work",
  sealedUrl: "cf1.key.iv.sealed",
  termId: "spring-2027",
  checkedAt: "2026-10-15T12:00:00.000Z",
  busy: [
    { start: 480, end: 570, dates: ["2027-02-16"] },
    { start: 900, end: 1080, dates: ["2027-01-12", "2027-01-19"] },
  ],
  allDayDates: [],
  countAllDay: false,
};
const checked: CheckedFeed = {
  busyCount: 3,
  allDayEvents: 0,
  events: [{ key: "demo", summary: "Robot demo day", date: "2027-03-02", day: "Tue", start: 660, end: 750 }],
};

function fakeHost(overrides: Partial<BuilderCalendars> = {}) {
  const check = mock(async (): Promise<Outcome<CheckedFeed>> => ({ ok: true, value: checked }));
  const connect = mock(async (_url: string, name: string): Promise<Outcome<ConnectedCalendar>> => ({ ok: true, value: { ...work, name } }));
  const host: BuilderCalendars = { term: TERM, check, connect, problems: {}, ...overrides };
  return { host, check, connect };
}

async function render(host: BuilderCalendars, initial: SchedulePreferences = start) {
  const { CalendarFeeds } = await import("@/components/schedule-builder/CalendarFeeds");
  const { Toaster } = await import("@/components/ui/Toast");
  const seen: { current: SchedulePreferences } = { current: initial };
  function Harness() {
    const [preferences, setPreferences] = useState(initial);
    useEffect(() => {
      seen.current = preferences;
    }, [preferences]);
    return (
      <>
        <CalendarFeeds host={host} preferences={preferences} onChange={(update) => setPreferences((p) => update(p))} />
        <Toaster />
      </>
    );
  }
  const view = await mount(<Harness />);
  views.push(view.unmount);
  return { ...view, preferences: () => seen.current };
}

const button = (root: ParentNode, name: string) => {
  // A Button holds its loading label beside its label, so read the label alone.
  const nameOf = (b: HTMLButtonElement) => b.getAttribute("aria-label") ?? (b.querySelector(".ui-btn__label") ?? b).textContent ?? "";
  const found = [...root.querySelectorAll<HTMLButtonElement>("button")].find((b) => nameOf(b).trim() === name);
  if (!found) throw new Error(`No button named ${name}`);
  return found;
};
async function type(input: HTMLInputElement, value: string) {
  const { act } = await import("react");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const field = (root: ParentNode, label: string) => {
  const target = [...root.querySelectorAll("label")].find((l) => l.textContent === label);
  return document.getElementById(target!.htmlFor) as HTMLInputElement;
};
async function settle() {
  const { act } = await import("react");
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("connecting a calendar in Preferences", () => {
  test("starts empty, checks the pasted address, then adds it under its name", async () => {
    const { host, check, connect } = fakeHost();
    const view = await render(host);
    expect(view.container.textContent).toContain("None yet.");
    await click(button(view.container, "Add a calendar"));
    await type(field(view.container, "Calendar address"), "https://calendar.example.edu/work.ics");
    await click(button(view.container, "Check"));
    await settle();
    expect(check).toHaveBeenCalledWith("https://calendar.example.edu/work.ics");
    expect(view.container.textContent).toContain("It works. 3 busy times in Spring 2027.");
    await type(field(view.container, "Name"), "Night job");
    await click(button(view.container, "Add calendar"));
    await settle();
    expect(connect).toHaveBeenCalledWith("https://calendar.example.edu/work.ics", "Night job", { countAllDay: false });
    expect(view.preferences().calendars).toEqual([{ ...work, name: "Night job" }]);
    expect(view.container.textContent).toContain("Night job");
    expect(view.container.textContent).toContain("3 busy times in Spring 2027");
    expect(document.body.textContent).toContain("Added Night job. Auto keeps its busy times free.");
  });

  test("all-day events are skipped unless the student counts them, before adding and on the row after", async () => {
    const { host, connect } = fakeHost({ check: async () => ({ ok: true, value: { ...checked, busyCount: 36, allDayEvents: 4 } }) });
    const view = await render(host);
    await click(button(view.container, "Add a calendar"));
    await type(field(view.container, "Calendar address"), "https://calendar.example.edu/work.ics");
    await click(button(view.container, "Check"));
    await settle();
    expect(view.container.textContent).toContain("It works. 36 busy times in Spring 2027; 4 all-day events skipped.");
    const toggle = view.container.querySelector<HTMLButtonElement>('[role="switch"]')!;
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await click(toggle);
    expect(view.container.textContent).toContain("4 all-day events counted.");
    await click(button(view.container, "Add calendar"));
    await settle();
    expect(connect).toHaveBeenCalledWith("https://calendar.example.edu/work.ics", "Calendar", { countAllDay: true });

    const withDates = { ...work, allDayDates: ["2027-02-24"], countAllDay: false };
    const rows = await render(fakeHost().host, { ...start, calendars: [withDates] });
    const rowSwitch = rows.container.querySelector<HTMLButtonElement>('[role="switch"]')!;
    await click(rowSwitch);
    expect(rows.preferences().calendars?.[0].countAllDay).toBe(true);
  });

  test("an unreachable feed shows its error under the address and keeps what was typed", async () => {
    const { host } = fakeHost({
      check: async () => ({ ok: false, problem: { kind: "unreachable", message: "UNTangle couldn't reach that calendar. Check the address, or try again in a minute." } }),
    });
    const view = await render(host);
    await click(button(view.container, "Add a calendar"));
    const input = field(view.container, "Calendar address");
    await type(input, "https://calendar.example.edu/missing.ics");
    await click(button(view.container, "Check"));
    await settle();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const described = document.getElementById(input.getAttribute("aria-describedby")!.split(" ").at(-1)!);
    expect(described?.textContent).toContain("couldn't reach that calendar");
    expect(input.value).toBe("https://calendar.example.edu/missing.ics");
    expect(view.preferences().calendars).toBeUndefined();
  });

  test("a failed connect says so for the whole form, not under the name, and the form stays usable", async () => {
    const { host } = fakeHost({ connect: async () => ({ ok: false, problem: { kind: "unavailable", message: "Calendars can't be connected right now. Add busy times by hand for now." } }) });
    const view = await render(host);
    await click(button(view.container, "Add a calendar"));
    await type(field(view.container, "Calendar address"), "https://calendar.example.edu/work.ics");
    await click(button(view.container, "Check"));
    await settle();
    await click(button(view.container, "Add calendar"));
    await settle();
    expect(view.container.querySelector('[role="alert"]')?.textContent).toBe("Calendars can't be connected right now. Add busy times by hand for now.");
    expect(field(view.container, "Name").getAttribute("aria-invalid")).toBeNull();
    expect(button(view.container, "Add calendar").getAttribute("aria-busy")).not.toBe("true");
  });

  test("one event becomes a busy time on its date only, and the calendar isn't added", async () => {
    const { host, connect } = fakeHost();
    const view = await render(host);
    await click(button(view.container, "Add a calendar"));
    await type(field(view.container, "Calendar address"), "https://calendar.example.edu/club.ics");
    await click(button(view.container, "Check"));
    await settle();
    await click(button(view.container, "Or pick one event from it"));
    const event = [...view.container.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Robot demo day"))!;
    expect(event.textContent).toContain("Tue Mar 2, 11 AM to 12:30 PM");
    await click(event);
    expect(connect).not.toHaveBeenCalled();
    expect(view.preferences().calendars).toBeUndefined();
    expect(view.preferences().constraints.blocked).toEqual([
      { id: "event-2027-03-02-660-750", label: "Robot demo day", day: "Tue", start: 660, end: 750, dates: [{ start: "2027-03-02", end: "2027-03-02" }] },
    ]);
    expect(document.body.textContent).toContain("Added Robot demo day on Mar 2.");
  });

  test("removing a calendar takes it out of the preferences, and Undo puts it back", async () => {
    const { host } = fakeHost();
    const view = await render(host, { ...start, calendars: [work] });
    await click(button(view.container, "Remove Work"));
    expect("calendars" in view.preferences()).toBe(false);
    await click(button(document.body, "Undo"));
    expect(view.preferences().calendars).toEqual([work]);
  });

  test("a calendar that couldn't be refreshed says what to do on its row", async () => {
    const { host } = fakeHost({ problems: { "cal-work": "Paste this calendar's address again to refresh it." } });
    const view = await render(host, { ...start, calendars: [work] });
    expect(view.container.textContent).toContain("Paste this calendar's address again to refresh it.");
  });
});

describe("the week grid", () => {
  test("draws a connected calendar's busy time apart from the student's own, with the weeks it holds", async () => {
    const { WeekGrid } = await import("@/components/schedule-builder/WeekGrid");
    const view = await mount(
      <WeekGrid
        label="Spring 2027 week"
        events={[]}
        placements={new Map()}
        walks={[]}
        hueOf={() => 1}
        kept={new Set()}
        selectedCourse={null}
        outlines={[]}
        ghost={[]}
        busy={[
          { id: "lunch", label: "Lunch", day: "Mon", start: 720, end: 780 },
          { id: "calendar-cal-work-Tue-480", label: "Work", day: "Tue", start: 480, end: 570, kind: "calendar", note: "Feb 16 only" },
        ]}
        motion={{ key: "", instant: true }}
        interactive
        phone={false}
        onSelect={() => {}}
        onPick={() => false}
        onDrag={() => {}}
        footer={null}
      />,
    );
    views.push(view.unmount);
    const calendar = view.container.querySelector('[data-kind="calendar"]')!;
    expect(calendar.textContent).toContain("Work");
    expect(calendar.textContent).toContain("Feb 16 only");
    expect(calendar.querySelector(".sr-only-v2")?.textContent).toContain("from your calendar");
    const own = [...view.container.querySelectorAll("div")].find((el) => el.textContent?.startsWith("Lunch") && !el.hasAttribute("data-kind"));
    expect(own).toBeDefined();
  });
});
