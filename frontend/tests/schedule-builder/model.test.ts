import { describe, expect, test } from "bun:test";
import { answerFor, describeAlternative, type AnswerCourse } from "@/components/schedule-builder/answer";
import { meetTogether, sectionConflicts } from "@/components/schedule-builder/conflicts";
import { busyGroups, preferenceSummary, withFewerDays, withLunch, withShortWalks } from "@/components/schedule-builder/preferences";
import { decodeFile, decodeShare, encodeFile, encodeShare } from "@/components/schedule-builder/share";
import { daysShown, eventsOf, hourRange, placeEvents, sectionLabel, walksOf, type WalkFn } from "@/components/schedule-builder/week";
import type { Section } from "@/lib/sections";
import type { SchedulePreferences } from "@/lib/types";
import { asyncMeeting, meeting, section } from "./fixtures";

// The mockup's week (03-schedule-builder.html): Main, and the sections its alternatives move to.
const mwf = (code: string, sectionCode: string, at: string, until: string, building: string) =>
  section({ courseCode: code, sectionCode, meetings: (["Mon", "Wed", "Fri"] as const).map((day) => meeting({ day, at, until, building })) });
const two = (code: string, sectionCode: string, days: ["Mon", "Wed"] | ["Tue", "Thu"], at: string, until: string, building: string) =>
  section({ courseCode: code, sectionCode, meetings: days.map((day) => meeting({ day, at, until, building })) });

const csce2110 = mwf("CSCE 2110", "001", "9:00", "9:50", "gab");
const csce2110tr = two("CSCE 2110", "002", ["Tue", "Thu"], "9:30", "10:50", "ntdp");
const math2700 = mwf("MATH 2700", "003", "10:00", "10:50", "cury");
const math2700late = two("MATH 2700", "001", ["Mon", "Wed"], "15:30", "16:50", "lang");
const phys2220 = two("PHYS 2220", "002", ["Mon", "Wed"], "11:00", "11:50", "phys");
const phys2220pm = two("PHYS 2220", "001", ["Mon", "Wed"], "13:00", "13:50", "phys");
const csce2610 = two("CSCE 2610", "002", ["Tue", "Thu"], "12:30", "13:50", "essc");
const tecm = section({ courseCode: "TECM 2700", sectionCode: "900", online: true, meetings: [asyncMeeting] });

const MINUTES: Record<string, number> = { "gab|cury": 4, "cury|phys": 8, "gab|phys": 7, "phys|essc": 6 };
const walk: WalkFn = (a, b) => {
  const minutes = MINUTES[`${a}|${b}`] ?? MINUTES[`${b}|${a}`];
  return minutes === undefined ? null : { minutes, shuttle: false };
};
const week = (sections: Section[]) => {
  const events = eventsOf(sections);
  return { events, walks: walksOf(events, walk) };
};
const main = week([csce2110, math2700, phys2220, csce2610, tecm]);

const defaults: SchedulePreferences = {
  constraints: {
    earliestStart: null,
    latestEnd: null,
    daysOff: [],
    blocked: [],
    maxCredits: null,
    walkingBufferMinutes: 0,
    excludedSections: [],
    openSeatsOnly: false,
    otherSites: false,
  },
  weights: { fewerDays: 0, compact: 1, mornings: 4, evenings: 0, walking: 0, rating: 0 },
};
const placed = (codes: string[]): AnswerCourse[] => codes.map((code) => ({ code, credits: 3, state: "placed" }));

describe("conflicts", () => {
  test("a section clashes with other courses on the days they overlap, never with its own course", () => {
    const math3680 = mwf("MATH 3680", "001", "10:00", "10:50", "cury");
    expect(sectionConflicts([csce2110, math2700, phys2220], math3680)).toEqual([{ courseCode: "MATH 2700", days: ["Mon", "Wed", "Fri"] }]);
    expect(sectionConflicts([csce2110, math2700], math2700late)).toEqual([]);
    // Back to back is not a clash.
    expect(sectionConflicts([csce2110], mwf("ECON 1100", "001", "9:50", "10:40", "blb"))).toEqual([]);
  });

  test("eight-week halves at the same hour never meet", () => {
    const first = { start: "2027-01-11", end: "2027-03-05" };
    const second = { start: "2027-03-15", end: "2027-05-07" };
    expect(meetTogether("Tue", first, second)).toBe(false);
    expect(meetTogether("Tue", first, null)).toBe(true);
    // Jan 11–17 and Jan 17–24 share only a Sunday.
    expect(meetTogether("Mon", { start: "2027-01-11", end: "2027-01-17" }, { start: "2027-01-17", end: "2027-01-24" })).toBe(false);
    expect(meetTogether("Sun", { start: "2027-01-11", end: "2027-01-17" }, { start: "2027-01-17", end: "2027-01-24" })).toBe(true);
  });
});

describe("the grid", () => {
  test("events are keyed by course and occurrence, so MWF to TR moves occurrences 0 and 1", () => {
    expect(eventsOf([csce2110]).map((e) => [e.key, e.day])).toEqual([["CSCE 2110#0", "Mon"], ["CSCE 2110#1", "Wed"], ["CSCE 2110#2", "Fri"]]);
    expect(eventsOf([csce2110tr]).map((e) => [e.key, e.day])).toEqual([["CSCE 2110#0", "Tue"], ["CSCE 2110#1", "Thu"]]);
    expect(eventsOf([tecm])).toEqual([]);
  });

  test("an added conflict sits side by side, both flagged; separate classes keep the full width", () => {
    const math3680 = mwf("MATH 3680", "001", "10:00", "10:50", "cury");
    const place = placeEvents(eventsOf([csce2110, math2700, math3680]));
    expect(place.get("MATH 2700#0")).toEqual({ lane: 0, lanes: 2, conflict: true });
    expect(place.get("MATH 3680#0")).toEqual({ lane: 1, lanes: 2, conflict: true });
    expect(place.get("CSCE 2110#0")).toEqual({ lane: 0, lanes: 1, conflict: false });
  });

  test("eight-week halves at the same hour sit side by side without a conflict", () => {
    const dated = (code: string, dates: { start: string; end: string }) =>
      section({ courseCode: code, meetings: [meeting({ day: "Tue", at: "9:35", until: "10:55", dates })] });
    const place = placeEvents(eventsOf([dated("SPAN 2040", { start: "2027-01-11", end: "2027-03-05" }), dated("SPAN 2050", { start: "2027-03-15", end: "2027-05-07" })]));
    expect([...place.values()]).toEqual([{ lane: 0, lanes: 2, conflict: false }, { lane: 1, lanes: 2, conflict: false }]);
  });

  test("walk chips: tight within the 2-minute buffer, late when longer than the break, none past 30 minutes", () => {
    expect(main.walks.map((w) => [w.day, w.toCourse, w.minutes, w.kind])).toEqual([
      ["Mon", "MATH 2700", 4, "ok"],
      ["Mon", "PHYS 2220", 8, "tight"],
      ["Wed", "MATH 2700", 4, "ok"],
      ["Wed", "PHYS 2220", 8, "tight"],
      ["Fri", "MATH 2700", 4, "ok"],
    ]);
    const late = walksOf(eventsOf([csce2110, mwf("PHYS 1710", "001", "9:55", "10:45", "phys")]), walk);
    expect(late.map((w) => w.kind)).toEqual(["late", "late", "late"]);
    expect(walksOf(eventsOf([csce2110, mwf("BIOL 1710", "001", "9:55", "10:45", "life")]), walk)).toEqual([]);
  });

  test("a class's predecessor depends on the week: a first-half class doesn't hide the second-half walk", () => {
    const full = (code: string, at: string, until: string, building: string) => section({ courseCode: code, meetings: [meeting({ day: "Mon", at, until, building })] });
    const a = full("HIST 2610", "9:30", "10:20", "gab");
    const b = section({ courseCode: "SPAN 2040", meetings: [meeting({ day: "Mon", at: "9:45", until: "10:35", building: "cury", dates: { start: "2027-01-11", end: "2027-03-05" } })] });
    const c = full("PHYS 1710", "10:40", "11:30", "phys");
    const legs = walksOf(eventsOf([a, b, c]), () => ({ minutes: 25, shuttle: false }));
    expect(legs.map((w) => [w.fromKey, w.toKey, w.to - w.from, w.kind])).toEqual([
      ["HIST 2610#0", "PHYS 1710#0", 20, "late"],
      ["SPAN 2040#0", "PHYS 1710#0", 5, "late"],
    ]);
    // A full-term class in between hides the earlier one in every week.
    const between = full("ECON 1100", "9:45", "10:35", "blb");
    expect(walksOf(eventsOf([a, between, c]), () => ({ minutes: 4, shuttle: false })).map((w) => w.fromKey)).toEqual(["ECON 1100#0"]);
  });

  test("a shuttle leg says so", () => {
    const legs = walksOf(eventsOf([csce2110, mwf("CSCE 3110", "001", "10:10", "11:00", "ntdp")]), () => ({ minutes: 20, shuttle: true }));
    expect(legs[0]).toMatchObject({ minutes: 20, shuttle: true, kind: "tight" });
  });

  test("a section's label: its code, a linked pair as printed, a sample's number", () => {
    expect(sectionLabel({ sectionCode: "001" })).toBe("001");
    expect(sectionLabel({ sectionCode: "110 + 111" })).toBe("110 + 111");
    expect(sectionLabel({ sectionCode: "math-3680-001" })).toBe("001");
    expect(sectionLabel({ sectionCode: "csce-1030l-901" })).toBe("901");
  });

  test("hours run 8 to 5 at least, widened around classes and busy times; weekends only when used", () => {
    expect(hourRange([])).toEqual({ first: 8, last: 17 });
    expect(hourRange([{ start: 450, end: 500 }, { start: 1080, end: 1170 }])).toEqual({ first: 7, last: 20 });
    expect(daysShown(main.events)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri"]);
    expect(daysShown([{ day: "Sat" }])).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
  });
});

describe("the answer line", () => {
  const answer = (sections: Section[], preferences = defaults, courses?: AnswerCourse[]) => {
    const { events, walks } = week(sections);
    return answerFor({ courses: courses ?? placed(sections.map((s) => s.courseCode)), events, walks, preferences, termLabel: "Spring 2027" });
  };

  test("the mockup's week: the tight walk, with a fix", () => {
    expect(answer([csce2110, math2700, phys2220, csce2610, tecm])).toEqual({
      tone: "attention",
      text: "The walk to PHYS 2220 on Monday and Wednesday is tight.",
      action: "fix",
    });
  });

  test("a clash comes first and names each course once", () => {
    const math3680 = mwf("MATH 3680", "001", "10:00", "10:50", "cury");
    expect(answer([csce2110, math2700, phys2220, math3680])).toEqual({
      tone: "danger",
      text: "MATH 2700 overlaps MATH 3680 on Monday, Wednesday and Friday.",
      action: "fix",
    });
  });

  test("a course that needs a pick opens it", () => {
    const courses: AnswerCourse[] = [...placed(["CSCE 2110"]), { code: "MATH 2700", credits: 3, state: "pick", note: "MATH 2700 §003 isn't offered in Spring 2027 anymore." }];
    expect(answer([csce2110], defaults, courses)).toEqual({
      tone: "attention",
      text: "MATH 2700 §003 isn't offered in Spring 2027 anymore.",
      action: "pick",
      courseCode: "MATH 2700",
    });
  });

  test("a broken preference, then the all-clear", () => {
    const early = { ...defaults, constraints: { ...defaults.constraints, earliestStart: 600 } };
    expect(answer([csce2110, csce2610], early)?.text).toBe("CSCE 2110 starts before 10 AM on Monday, Wednesday and Friday.");
    const fridays = { ...defaults, constraints: { ...defaults.constraints, daysOff: ["Fri" as const] } };
    expect(answer([csce2110], fridays)?.text).toBe("CSCE 2110 meets on Friday, a day you keep off.");
    expect(answer([csce2110, csce2610])).toEqual({ tone: "quiet", text: "This week fits your preferences.", action: null, fits: true });
  });

  test("the saved spare-minutes setting is a preference the week can break", () => {
    const buffered = { ...defaults, constraints: { ...defaults.constraints, walkingBufferMinutes: 10 } };
    // GAB to CURY is 4 minutes in a 10-minute break: fine at 2 spare minutes, short of 10.
    expect(answer([csce2110, math2700], buffered)?.text).toBe("The walk to MATH 2700 on Monday leaves less than your 10 spare minutes.");
  });

  test("nothing while empty; a quiet line while sections load", () => {
    expect(answer([])).toBeNull();
    expect(answer([], defaults, [{ code: "CSCE 2110", credits: 3, state: "loading" }])?.text).toBe("Loading Spring 2027 sections.");
  });
});

describe("an alternative in one sentence", () => {
  test("the mockup's option 2", () => {
    expect(describeAlternative(main, week([csce2110tr, math2700late, phys2220, csce2610, tecm]))).toBe(
      "Frees Friday, but Monday and Wednesday end at 4:50.",
    );
  });

  test("one course moving names the course when nothing gets worse", () => {
    const phys2220later = two("PHYS 2220", "004", ["Mon", "Wed"], "11:10", "12:00", "phys");
    expect(describeAlternative(main, week([csce2110, math2700, phys2220later, csce2610, tecm]))).toBe(
      "Removes the tight walk by moving PHYS 2220 to 11:10.",
    );
  });

  test("a cost is named after the gain", () => {
    expect(describeAlternative(main, week([csce2110, math2700, phys2220pm, csce2610, tecm]))).toBe(
      "Removes the tight walk, but Monday and Wednesday end at 1:50.",
    );
  });

  test("more tight walks to a course already walked to tightly is still one sentence, not a crash", () => {
    const fewer = week([csce2110, two("PHYS 2220", "002", ["Mon", "Wed"], "10:00", "10:50", "phys")]);
    const more = week([csce2110, mwf("PHYS 2220", "009", "10:00", "10:50", "phys")]);
    expect(describeAlternative(fewer, more)).toBe("Friday end at 10:50.");
    const sameDays = week([csce2110, mwf("PHYS 2220", "010", "10:00", "10:50", "phys"), mwf("PHYS 2221", "001", "11:00", "11:50", "gab")]);
    expect(() => describeAlternative(more, sameDays)).not.toThrow();
  });

  test("no gain names the cost, or what moves; no change says so", () => {
    const now = week([csce2110, math2700, csce2610]);
    expect(describeAlternative(now, week([csce2110, math2700, two("CSCE 2610", "003", ["Tue", "Thu"], "16:00", "16:50", "essc")]))).toBe(
      "Tuesday and Thursday end at 4:50.",
    );
    expect(describeAlternative(now, week([csce2110, math2700, two("CSCE 2610", "004", ["Tue", "Thu"], "12:40", "13:55", "essc")]))).toBe(
      "Moves CSCE 2610 to 12:40.",
    );
    expect(describeAlternative(main, main)).toBe("Same days and times, with different sections.");
  });
});

describe("preferences", () => {
  test("the line names only what differs from the defaults", () => {
    expect(preferenceSummary(defaults, defaults)).toBe("");
    const mine: SchedulePreferences = {
      ...defaults,
      constraints: {
        ...defaults.constraints,
        earliestStart: 540,
        blocked: [
          { id: "w1", label: "Work", day: "Tue", start: 900, end: 1020 },
          { id: "w2", label: "Work", day: "Thu", start: 900, end: 1020 },
        ],
      },
    };
    expect(preferenceSummary(mine, defaults)).toBe("Nothing before 9 AM, work Tue and Thu 3:00–5:00");
  });

  test("every choice in its fixed order", () => {
    let p: SchedulePreferences = { ...defaults, constraints: { ...defaults.constraints, daysOff: ["Fri", "Mon"], maxCredits: 15 } };
    p = withFewerDays(withShortWalks(withLunch(p, true), false, defaults), true);
    expect(preferenceSummary(p, defaults)).toBe("Mondays and Fridays off, 15 credits at most, a lunch break, long walks are fine, fewer days on campus");
    expect(busyGroups(p)).toEqual([]);
    expect(preferenceSummary(withShortWalks(p, true, defaults), defaults)).not.toContain("walks");
  });
});

describe("share links and files", () => {
  const shared = { term: "spring-2027", sections: { "MATH 1680": "vsb:spring-2027:MATH 1680:6862+6863", "CSCE 2110": "sample-csce-2110-001" } };

  test("round trip, URL-safe", () => {
    const text = encodeShare(shared);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeShare(text)).toEqual(shared);
    expect(decodeFile(encodeFile(shared))).toEqual(shared);
  });

  test("anything malformed is refused with a reason", () => {
    expect(decodeShare("not base64!")).toEqual({ error: "The link is cut off or changed." });
    expect(decodeShare(encodeShare(shared).slice(0, 20))).toHaveProperty("error");
    expect(decodeShare(btoa(JSON.stringify([2, "spring-2027", []])))).toEqual({ error: "The link is from a different version." });
    expect(decodeShare(btoa(JSON.stringify([1, "spring-2027", [["csce 2110", "x"]]])))).toEqual({ error: "One of its course codes is unreadable." });
    expect(decodeShare(btoa(JSON.stringify([1, "spring-2027", [["CSCE 2110", "x"], ["CSCE 2110", "y"]]])))).toEqual({ error: "It lists CSCE 2110 twice." });
    expect(decodeFile("{}")).toEqual({ error: "That file isn't a saved schedule." });
  });
});
