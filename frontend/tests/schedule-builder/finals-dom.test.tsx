/**
 * Week's finals with a fake host (host.finals): the Finals line under the
 * grid, a clash named in the answer line with its fix, a final that isn't
 * known, the course panel's Final section, and the clash shown on a section
 * row before it is added. Without host.finals, Week shows none of it.
 */
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { answerFor, describeAlternative } from "@/components/schedule-builder/answer";
import { examDay, examLongDay, examStart, examTimes, finalsClashCount, weekFinals } from "@/components/schedule-builder/finals";
import type { BuilderFinals, BuilderHost, FinalExam, OptionsFeed, WeekCourse } from "@/components/schedule-builder/host";
import type { Section } from "@/lib/sections";
import type { SchedulePreferences } from "@/lib/types";
import { click, installDom, mount, removeDom } from "../ui/dom";
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
const csce = mwf("CSCE 2110", "001", "9:00", "9:50");
const math = tr("MATH 1710", "002", "9:30", "10:50");
const mathLate = tr("MATH 1710", "003", "14:00", "15:20");
const engl = mwf("ENGL 1310", "010", "13:00", "13:50");

const MON_8 = { date: "2027-05-03", start: 480, end: 600 };
const EXAMS: Record<string, FinalExam> = {
  [csce.id]: { kind: "known", exam: MON_8, projected: true },
  [math.id]: { kind: "known", exam: { date: "2027-05-03", start: 540, end: 660 }, projected: true },
  [mathLate.id]: { kind: "known", exam: { date: "2027-05-04", start: 930, end: 1050 }, projected: true },
  [engl.id]: { kind: "unknown", note: "It has no set meeting time, so the syllabus sets the final." },
};
const finals: BuilderFinals = {
  examOf: (s) => EXAMS[s.id],
  projected: { label: "Projected", source: "UNT hasn't published Spring 2027 finals." },
};

const preferences: SchedulePreferences = {
  constraints: { earliestStart: null, latestEnd: null, daysOff: [], blocked: [], maxCredits: null, walkingBufferMinutes: 0, excludedSections: [], openSeatsOnly: false, otherSites: false },
  weights: { fewerDays: 0, compact: 1, mornings: 0, evenings: 0, walking: 0, rating: 0 },
};
const OPTIONS: Record<string, Section[]> = { "CSCE 2110": [csce], "MATH 1710": [math, mathLate], "ENGL 1310": [engl] };
const course = (s: Section): WeekCourse => ({ code: s.courseCode, title: s.courseCode, credits: 3, section: s, state: "placed", locked: false });

function host(courses: WeekCourse[], withFinals: boolean) {
  const optimizer: OptionsFeed = { runId: null, status: "idle", options: [], stale: false, infeasible: null, error: null, explain: () => [], run: mock(() => {}), close: mock(() => {}) };
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
    walk: () => ({ seconds: 60, shuttle: false }),
    search: { find: () => [], suggestions: () => [], options: (code) => OPTIONS[code] ?? null, load: () => {}, classNumber: async () => null },
    edits: { place: mock((): string | null => null), remove: mock(() => {}), keep: mock(() => {}), use: mock((): string[] => []), clear: mock(() => {}), undo: mock(() => {}), canUndo: false },
    optimizer,
    browse: null,
    finals: withFinals ? finals : undefined,
    find: (code, id) => OPTIONS[code]?.find((s) => s.id === id),
    printHref: "/schedule/print",
    shareUrl: (encoded) => encoded,
  };
  return { value, optimizer };
}

async function render(h: BuilderHost) {
  const { ScheduleBuilder } = await import("@/components/schedule-builder/ScheduleBuilder");
  return mount(<ScheduleBuilder host={h} scheduleName="Main" searchRequest={null} shared={null} onSharedSeen={() => {}} />);
}
const pills = (root: ParentNode) => [...root.querySelectorAll<HTMLButtonElement>('[aria-labelledby="week-finals"] button[data-hue]')];

describe("finals model and words", () => {
  test("in exam order, unknown last, each naming its clashes", () => {
    const list = weekFinals([engl, math, csce], finals);
    expect(list.map((entry) => [entry.courseCode, entry.clashesWith])).toEqual([
      ["CSCE 2110", ["MATH 1710"]],
      ["MATH 1710", ["CSCE 2110"]],
      ["ENGL 1310", []],
    ]);
    expect(finalsClashCount(list)).toBe(1);
    expect(finalsClashCount(weekFinals([csce, mathLate, engl], finals))).toBe(0);
  });

  test("times read as people say them", () => {
    expect(examStart(MON_8)).toBe("Mon 8:00 AM");
    expect(examDay(MON_8)).toBe("Mon, May 3");
    expect(examLongDay(MON_8)).toBe("Monday, May 3");
    expect(examTimes(MON_8)).toBe("8:00 to 10:00 AM");
    expect(examTimes({ date: "2027-05-03", start: 630, end: 750 })).toBe("10:30 AM to 12:30 PM");
    expect(examTimes({ date: "2027-05-01", start: 1110, end: 1230 })).toBe("6:30 to 8:30 PM");
  });

  test("the answer names a projected clash as a check with a fix, after class clashes", () => {
    const courses = [csce, math].map((s) => ({ code: s.courseCode, credits: 3, state: "placed" as const }));
    const answer = answerFor({ courses, events: [], walks: [], preferences, termLabel: "Spring 2027", finals: weekFinals([csce, math], finals) });
    expect(answer).toEqual({ tone: "attention", text: "CSCE 2110 and MATH 1710 have finals at the same time on Monday, May 3.", action: "fix" });
    const published = { ...finals, examOf: (s: Section) => ({ ...(EXAMS[s.id] as Extract<FinalExam, { kind: "known" }>), projected: false }) };
    expect(answerFor({ courses, events: [], walks: [], preferences, termLabel: "Spring 2027", finals: weekFinals([csce, math], published) })?.tone).toBe("danger");
    expect(answerFor({ courses, events: [], walks: [], preferences, termLabel: "Spring 2027" })?.text).toBe("This week fits your preferences.");
  });

  test("an alternative that removes the clash says so", () => {
    expect(describeAlternative({ events: [], walks: [], finalsClashes: 1 }, { events: [], walks: [], finalsClashes: 0 })).toBe("Fixes the finals clash.");
    expect(describeAlternative({ events: [], walks: [], finalsClashes: 0 }, { events: [], walks: [], finalsClashes: 1 })).toBe("Two finals are at the same time.");
  });
});

describe("Week with finals", () => {
  test("the Finals line lists each course's final, outlines the clash and says the times are projected", async () => {
    const { value, optimizer } = host([course(csce), course(math), course(engl)], true);
    const view = await render(value);
    expect(pills(view.container).map((b) => [b.textContent, b.getAttribute("aria-label"), b.hasAttribute("data-clash")])).toEqual([
      ["CSCE 2110Mon 8:00 AM", "CSCE 2110 final, Monday, May 3, 8:00 to 10:00 AM, same time as MATH 1710", true],
      ["MATH 1710Mon 9:00 AM", "MATH 1710 final, Monday, May 3, 9:00 to 11:00 AM, same time as CSCE 2110", true],
      ["ENGL 1310Not known", "ENGL 1310 final, not known", false],
    ]);
    expect(view.container.querySelector('[aria-labelledby="week-finals"]')!.textContent).toContain("Projected");
    expect(view.container.textContent).toContain("CSCE 2110 and MATH 1710 have finals at the same time on Monday, May 3.");
    const fix = [...view.container.querySelectorAll("button")].find((b) => b.textContent === "Show a fix")!;
    await click(fix);
    expect(optimizer.run).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  test("a pill opens the course's panel with its final, and a row names a clashing final before it is added", async () => {
    const { value } = host([course(csce), course(mathLate), course(engl)], true);
    const view = await render(value);
    expect(pills(view.container).some((b) => b.hasAttribute("data-clash"))).toBe(false);
    await click(pills(view.container).find((b) => b.textContent?.startsWith("MATH 1710"))!);
    const panel = document.querySelector("aside")!;
    const final = panel.querySelector('[aria-labelledby="event-final"]')!;
    expect(final.textContent).toBe("FinalTuesday, May 4, 3:30 to 5:30 PMUNT hasn't published Spring 2027 finals.");
    // Section 002's final would land on CSCE 2110's.
    const move = [...panel.querySelectorAll("button")].find((b) => b.getAttribute("aria-label")?.startsWith("Move to section 002"))!;
    expect(move.getAttribute("aria-label")).toBe("Move to section 002, final at the same time as CSCE 2110");
    expect(panel.textContent).toContain("Final at the same time as CSCE 2110");
    expect(panel.textContent).toContain("Final Mon, May 3, 9:00 AM");
    await click(pills(view.container).find((b) => b.textContent?.startsWith("ENGL 1310"))!);
    expect(document.querySelector('aside [aria-labelledby="event-final"]')!.textContent).toBe("FinalIt has no set meeting time, so the syllabus sets the final.");
    await view.unmount();
  });

  test("without host finals, Week shows no Finals line", async () => {
    const { value } = host([course(csce), course(math)], false);
    const view = await render(value);
    expect(pills(view.container)).toHaveLength(0);
    expect(view.container.textContent).not.toContain("finals");
    await view.unmount();
  });
});
