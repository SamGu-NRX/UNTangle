import { describe, expect, test } from "bun:test";
import { evaluateFilter, evaluateFilters, type FilterContext, type SectionFilter } from "../../src/filters";
import {
  acctAsync,
  acctTimed,
  adesClosed,
  artWaitlist,
  bcisTba,
  context,
  dbasFrisco,
  math,
  mathAtDiscoveryPark,
  mathCancelled,
  mathCoTaught,
  mathHybrid,
  mathInMha,
  mathLabFull,
  mathLabSeatsUnknown,
  mathLectureFullLabUnknown,
  mathStatusUnknown,
} from "./fixtures";

const seats = (minimum: number): SectionFilter => ({ kind: "open-seats", minimum });
const days = (...allowed: Extract<SectionFilter, { kind: "days" }>["allowed"]): SectionFilter => ({ kind: "days", allowed });
const modes = (...allowed: Extract<SectionFilter, { kind: "modality" }>["allowed"]): SectionFilter => ({ kind: "modality", allowed });
const sites = (...allowed: string[]): SectionFilter => ({ kind: "site", allowed });
const hours = (earliestStart: number | null, latestEnd: number | null): SectionFilter => ({ kind: "time-window", earliestStart, latestEnd });
const weekdays = days("Mon", "Tue", "Wed", "Thu", "Fri");
const everyDay = days("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun");

/** MATH 1680 plus ADES 5510's meeting, which has no day, time or room. */
const mathPlusDayless = { ...math, meetings: [...math.meetings, ...adesClosed.meetings] };
const noMeetings = { ...math, meetings: [] };

describe("open seats", () => {
  test("passes at the minimum on every component and fails one seat above it", () => {
    expect(evaluateFilter(math, seats(1), context)).toBe("pass");
    expect(evaluateFilter(math, seats(33), context)).toBe("pass");
    expect(evaluateFilter(math, seats(34), context)).toBe("fail");
  });

  test("a full linked component fails the whole option", () => {
    expect(evaluateFilter(mathLabFull, seats(1), context)).toBe("fail");
  });

  test("unknown seats never pass", () => {
    expect(evaluateFilter(mathLabSeatsUnknown, seats(1), context)).toBe("unknown");
  });

  test("a known full component fails even when another's seats are unknown", () => {
    expect(evaluateFilter(mathLectureFullLabUnknown, seats(1), context)).toBe("fail");
  });

  test("closed, wait-listed and cancelled options fail whatever their seat counts say", () => {
    expect(evaluateFilter(artWaitlist, seats(1), context)).toBe("fail");
    expect(evaluateFilter(adesClosed, seats(1), context)).toBe("fail");
    expect(evaluateFilter(mathCancelled, seats(1), context)).toBe("fail");
  });

  test("a status the parser doesn't know is unknown, even with seats open", () => {
    expect(evaluateFilter(mathStatusUnknown, seats(1), context)).toBe("unknown");
  });
});

describe("modality", () => {
  test("an option held in rooms is in person", () => {
    expect(evaluateFilter(math, modes("in-person"), context)).toBe("pass");
    expect(evaluateFilter(math, modes("online-timed", "online-async"), context)).toBe("fail");
  });

  test("an online option with no set time is async, not timed", () => {
    expect(evaluateFilter(acctAsync, modes("online-async"), context)).toBe("pass");
    expect(evaluateFilter(acctAsync, modes("online-timed"), context)).toBe("fail");
    expect(evaluateFilter(acctAsync, modes("in-person"), context)).toBe("fail");
  });

  test("an online option at a set time is timed, not async", () => {
    expect(evaluateFilter(acctTimed, modes("online-timed"), context)).toBe("pass");
    expect(evaluateFilter(acctTimed, modes("online-async"), context)).toBe("fail");
  });

  test("a room the campus catalogue can't place is still in person", () => {
    expect(evaluateFilter(dbasFrisco, modes("in-person"), context)).toBe("pass");
  });

  test("an unassigned room is unknown unless every mode is allowed", () => {
    expect(evaluateFilter(artWaitlist, modes("in-person"), context)).toBe("unknown");
    expect(evaluateFilter(artWaitlist, modes("in-person", "online-timed"), context)).toBe("unknown");
    expect(evaluateFilter(artWaitlist, modes("in-person", "online-timed", "online-async"), context)).toBe("pass");
  });

  test("an option fails when any one meeting's mode isn't allowed", () => {
    expect(evaluateFilter(mathHybrid, modes("in-person"), context)).toBe("fail");
    expect(evaluateFilter(mathHybrid, modes("in-person", "online-timed"), context)).toBe("pass");
  });
});

describe("site", () => {
  test("passes when every placed meeting is at an allowed site, and fails at another", () => {
    expect(evaluateFilter(math, sites("unt-denton"), context)).toBe("pass");
    expect(evaluateFilter(dbasFrisco, sites("unt-denton"), context)).toBe("fail");
    expect(evaluateFilter(dbasFrisco, sites("unt-denton", "unt-frisco"), context)).toBe("pass");
  });

  test("a catalogue building takes its site from the directory, off campus or not", () => {
    expect(evaluateFilter(mathAtDiscoveryPark, sites("unt-denton"), context)).toBe("pass");
    expect(evaluateFilter(mathAtDiscoveryPark, sites("unt-frisco"), context)).toBe("fail");
  });

  test("online meetings don't place an option anywhere", () => {
    expect(evaluateFilter(acctAsync, sites("unt-frisco"), context)).toBe("pass");
    expect(evaluateFilter(mathHybrid, sites("unt-denton"), context)).toBe("pass");
  });

  test("a place the directory can't name is unknown", () => {
    expect(evaluateFilter(artWaitlist, sites("unt-denton"), context)).toBe("unknown");
    expect(evaluateFilter(mathInMha, sites("unt-denton"), context)).toBe("unknown");
    const withoutGab: FilterContext = { ...context, sites: { ...context.sites, byBuildingId: { cury: "unt-denton" } } };
    expect(evaluateFilter(math, sites("unt-denton"), withoutGab)).toBe("unknown");
  });

  test("a meeting at a known other site fails the option even beside an unknown place", () => {
    const friscoPlusUnassigned = { ...dbasFrisco, meetings: [...dbasFrisco.meetings, ...artWaitlist.meetings] };
    expect(evaluateFilter(friscoPlusUnassigned, sites("unt-denton"), context)).toBe("fail");
  });
});

describe("days", () => {
  test("passes when every meeting falls on an allowed day", () => {
    expect(evaluateFilter(math, days("Mon", "Tue", "Thu"), context)).toBe("pass");
    expect(evaluateFilter(math, days("Tue", "Thu"), context)).toBe("fail");
  });

  test("a known day with no time is still judged by its day", () => {
    expect(evaluateFilter(bcisTba, days("Thu"), context)).toBe("pass");
    expect(evaluateFilter(bcisTba, days("Mon", "Tue", "Wed", "Fri"), context)).toBe("fail");
  });

  test("an async meeting has no day to judge, so it passes any day filter", () => {
    expect(evaluateFilter(acctAsync, days("Mon"), context)).toBe("pass");
  });

  test("a meeting whose day is TBA is unknown, never a pass", () => {
    expect(evaluateFilter(adesClosed, everyDay, context)).toBe("unknown");
    expect(evaluateFilter(artWaitlist, weekdays, context)).toBe("unknown");
  });

  test("weekend meetings are judged like any other", () => {
    expect(evaluateFilter(dbasFrisco, weekdays, context)).toBe("fail");
    expect(evaluateFilter(dbasFrisco, days("Sat", "Sun"), context)).toBe("pass");
  });

  test("a failing meeting outweighs a TBA one", () => {
    expect(evaluateFilter(mathPlusDayless, days("Wed"), context)).toBe("fail");
    expect(evaluateFilter(mathPlusDayless, days("Mon", "Tue", "Thu"), context)).toBe("unknown");
  });
});

describe("time window", () => {
  test("bounds are inclusive: a class from 8:00 to 10:55 fits 8:00 to 10:55 and nothing tighter", () => {
    expect(evaluateFilter(math, hours(480, 655), context)).toBe("pass");
    expect(evaluateFilter(math, hours(481, 655), context)).toBe("fail");
    expect(evaluateFilter(math, hours(480, 654), context)).toBe("fail");
  });

  test("a null bound leaves that side open", () => {
    expect(evaluateFilter(math, hours(480, null), context)).toBe("pass");
    expect(evaluateFilter(math, hours(null, 655), context)).toBe("pass");
    expect(evaluateFilter(math, hours(540, null), context)).toBe("fail");
  });

  test("a meeting with no time is unknown even when its day is known", () => {
    expect(evaluateFilter(bcisTba, hours(600, 1200), context)).toBe("unknown");
    expect(evaluateFilter(bcisTba, hours(1100, 1200), context)).toBe("fail");
  });

  test("an async meeting has no time to judge, so it passes any window", () => {
    expect(evaluateFilter(acctAsync, hours(720, 780), context)).toBe("pass");
  });

  test("an online meeting at a set time is judged by its time", () => {
    expect(evaluateFilter(acctTimed, hours(480, 540), context)).toBe("pass");
    expect(evaluateFilter(acctTimed, hours(540, null), context)).toBe("fail");
  });

  test("a meeting with no day or time is unknown", () => {
    expect(evaluateFilter(adesClosed, hours(0, 1440), context)).toBe("unknown");
  });
});

describe("instructor", () => {
  test("'only' passes when a listed instructor teaches the option, matching case and spacing loosely", () => {
    expect(evaluateFilter(math, { kind: "instructor", match: "only", names: ["Allen Mann"] }, context)).toBe("pass");
    expect(evaluateFilter(math, { kind: "instructor", match: "only", names: ["allen  MANN"] }, context)).toBe("pass");
    expect(evaluateFilter(math, { kind: "instructor", match: "only", names: ["Jose Lineros"] }, context)).toBe("fail");
  });

  test("'not' fails when a listed instructor teaches the option and passes otherwise", () => {
    expect(evaluateFilter(math, { kind: "instructor", match: "not", names: ["Allen Mann"] }, context)).toBe("fail");
    expect(evaluateFilter(math, { kind: "instructor", match: "not", names: ["Jose Lineros"] }, context)).toBe("pass");
  });

  test("each co-teacher counts", () => {
    expect(evaluateFilter(mathCoTaught, { kind: "instructor", match: "only", names: ["Jose Lineros"] }, context)).toBe("pass");
    expect(evaluateFilter(mathCoTaught, { kind: "instructor", match: "not", names: ["Jose Lineros"] }, context)).toBe("fail");
  });

  test("a name only part of another doesn't match", () => {
    expect(evaluateFilter(math, { kind: "instructor", match: "only", names: ["Mann"] }, context)).toBe("fail");
  });

  test("an option with no named instructor is unknown either way", () => {
    expect(evaluateFilter(adesClosed, { kind: "instructor", match: "only", names: ["Allen Mann"] }, context)).toBe("unknown");
    expect(evaluateFilter(adesClosed, { kind: "instructor", match: "not", names: ["Allen Mann"] }, context)).toBe("unknown");
  });
});

describe("credit hours", () => {
  test("bounds are inclusive and a null bound is open", () => {
    expect(evaluateFilter(math, { kind: "credit-hours", min: 3, max: 3 }, context)).toBe("pass");
    expect(evaluateFilter(math, { kind: "credit-hours", min: 4, max: null }, context)).toBe("fail");
    expect(evaluateFilter(math, { kind: "credit-hours", min: null, max: 2 }, context)).toBe("fail");
    expect(evaluateFilter(math, { kind: "credit-hours", min: null, max: 3 }, context)).toBe("pass");
  });

  test("a course the catalogue doesn't list is unknown", () => {
    expect(evaluateFilter(math, { kind: "credit-hours", min: 1, max: null }, { ...context, creditHours: null })).toBe("unknown");
  });
});

describe("an option with no meetings", () => {
  test.each([
    ["days", weekdays],
    ["time window", hours(0, 1440)],
    ["modality", modes("in-person", "online-timed", "online-async")],
    ["site", sites("unt-denton", "unt-frisco")],
  ] as const)("is unknown under a %s filter", (_name, filter) => {
    expect(evaluateFilter(noMeetings, filter, context)).toBe("unknown");
  });
});

describe("a list of filters", () => {
  test("passes only when every filter passes", () => {
    expect(evaluateFilters(math, [seats(1), days("Mon", "Tue", "Thu"), sites("unt-denton")], context)).toBe("pass");
    expect(evaluateFilters(math, [seats(1), days("Tue", "Thu"), sites("unt-denton")], context)).toBe("fail");
  });

  test("a failure outweighs an unknown, and an unknown outweighs passes, in any order", () => {
    const failing = [seats(1), days("Wed"), sites("unt-denton")];
    const unknowns = [seats(1), modes("in-person"), sites("unt-denton")];
    expect(evaluateFilters(artWaitlist, failing, context)).toBe("fail");
    expect(evaluateFilters(artWaitlist, [...failing].reverse(), context)).toBe("fail");
    expect(evaluateFilters(mathLabSeatsUnknown, unknowns, context)).toBe("unknown");
    expect(evaluateFilters(mathLabSeatsUnknown, [...unknowns].reverse(), context)).toBe("unknown");
  });

  test("no filters pass every option, even one with unknown facts", () => {
    expect(evaluateFilters(adesClosed, [], context)).toBe("pass");
  });

  test("a filter kind it doesn't know throws instead of passing", () => {
    // A filter persisted by a newer client, decoded without its schema.
    const unknownKind = JSON.parse('{ "kind": "attendance-optional" }') as SectionFilter;
    expect(evaluateFilters(math, [seats(1)], context)).toBe("pass");
    expect(() => evaluateFilter(math, unknownKind, context)).toThrow();
    expect(() => evaluateFilters(math, [unknownKind], context)).toThrow();
  });
});
