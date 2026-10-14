import { describe, expect, test } from "bun:test";
import { termDatesFor } from "@/lib/export/term-dates";
import { buildWeekIcs, chicagoOffsetHours, foldLine, icsFileName } from "@/lib/planner-ics";
import { asyncMeeting, meeting, section } from "../schedule-builder/fixtures";

/**
 * A strict, independent reader for the subset of RFC 5545 the export uses.
 * It shares no code with planner-ics.ts: it checks line endings and lengths,
 * unfolds, checks BEGIN/END nesting, and keeps each property's parameters.
 */
type Prop = { params: string; value: string };
type Component = { name: string; props: Map<string, Prop[]>; children: Component[] };

function parseIcs(raw: string): Component {
  expect(raw.endsWith("\r\n")).toBe(true);
  expect(/[^\r]\n/.test(raw)).toBe(false); // no bare LF
  const physical = raw.slice(0, -2).split("\r\n");
  for (const line of physical) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  const logical: string[] = [];
  for (const line of physical) {
    if (line.startsWith(" ")) logical[logical.length - 1] += line.slice(1);
    else logical.push(line);
  }
  const stack: Component[] = [];
  let root: Component | null = null;
  for (const line of logical) {
    const colon = line.indexOf(":");
    expect(colon).toBeGreaterThan(0);
    const [name, ...params] = line.slice(0, colon).split(";");
    const value = line.slice(colon + 1);
    if (name === "BEGIN") {
      const component: Component = { name: value, props: new Map(), children: [] };
      stack[stack.length - 1]?.children.push(component);
      stack.push(component);
      root ??= component;
    } else if (name === "END") {
      expect(stack.pop()?.name).toBe(value);
    } else {
      const top = stack[stack.length - 1];
      top.props.set(name, [...(top.props.get(name) ?? []), { params: params.join(";"), value }]);
    }
  }
  expect(stack).toHaveLength(0);
  return root!;
}

const one = (c: Component, name: string) => {
  const values = c.props.get(name) ?? [];
  expect(values).toHaveLength(1);
  return values[0];
};
const events = (calendar: Component) => calendar.children.filter((c) => c.name === "VEVENT");

/**
 * Every date an imported event occurs on, the way a calendar app expands it:
 * weekly from DTSTART while the start instant is not after UNTIL, minus
 * EXDATEs. Written from the RFC, not from planner-ics.ts.
 */
function occurrences(event: Component): string[] {
  const start = one(event, "DTSTART").value; // 20270111T090000, Chicago
  const rule = Object.fromEntries(one(event, "RRULE").value.split(";").map((part) => part.split("=")));
  expect(rule.FREQ).toBe("WEEKLY");
  const until = Date.UTC(+rule.UNTIL.slice(0, 4), +rule.UNTIL.slice(4, 6) - 1, +rule.UNTIL.slice(6, 8), +rule.UNTIL.slice(9, 11), +rule.UNTIL.slice(11, 13), +rule.UNTIL.slice(13, 15));
  const excluded = new Set((event.props.get("EXDATE") ?? []).flatMap((prop) => prop.value.split(",")));
  const out: string[] = [];
  const [y, mo, d, h, mi] = [+start.slice(0, 4), +start.slice(4, 6) - 1, +start.slice(6, 8), +start.slice(9, 11), +start.slice(11, 13)];
  for (let week = 0; week < 60; week += 1) {
    const local = Date.UTC(y, mo, d + week * 7, h, mi);
    // Chicago is UTC-5 from mid-March to early November and UTC-6 otherwise: enough for a spring term.
    const date = new Date(local);
    const month = date.getUTCMonth();
    const daylight = (month > 2 && month < 10) || (month === 2 && date.getUTCDate() >= 14);
    const instant = local + (daylight ? 5 : 6) * 3_600_000;
    if (instant > until) break;
    const stamp = `${date.toISOString().slice(0, 10).replaceAll("-", "")}T${start.slice(9)}`;
    if (!excluded.has(stamp)) out.push(date.toISOString().slice(0, 10));
  }
  return out;
}

const SPRING = termDatesFor("Spring 2027")!;
const NOW = new Date("2026-10-13T12:00:00Z");

const csce = section({
  courseCode: "CSCE 2110",
  meetings: (["Mon", "Wed", "Fri"] as const).map((day) => meeting({ day, at: "9:00", until: "9:50", room: "GAB 535" })),
});
const math = section({
  courseCode: "MATH 2700",
  sectionCode: "003",
  meetings: (["Tue", "Thu"] as const).map((day) => meeting({ day, at: "14:00", until: "15:20", room: "CURY 202" })),
});
const online = section({ courseCode: "TECM 2700", sectionCode: "900", online: true, meetings: [asyncMeeting] });
/** Online, but at a set weekly time: a real class time, so it goes in the file. */
const liveOnline = section({ courseCode: "CSCE 1030", online: true, meetings: [meeting({ day: "Tue", at: "18:00", until: "19:20", building: null, room: "Online" })] });

describe("term dates", () => {
  test("Spring 2027, from the registrar's calendar: first to last day of regular classes, its sessions and breaks", () => {
    expect(SPRING).toEqual({
      term: "Spring 2027",
      sessionId: "2027-spring-full",
      first: "2027-01-11",
      last: "2027-04-29",
      sessions: [
        { id: "2026-winter-3w1", begin: "2026-12-14", end: "2027-01-08" },
        { id: "2027-spring-full", begin: "2027-01-11", end: "2027-05-07" },
        { id: "2027-spring-8w1", begin: "2027-01-11", end: "2027-03-05" },
        { id: "2027-spring-8w2", begin: "2027-03-15", end: "2027-05-07" },
      ],
      breaks: [
        { name: "Martin Luther King Jr. Holiday", begin: "2027-01-18", end: "2027-01-18" },
        { name: "Spring Break", begin: "2027-03-08", end: "2027-03-14" },
      ],
    });
  });

  test("a term with no calendar has no dates, rather than guessed ones", () => {
    expect(termDatesFor("Fall 2031")).toBeNull();
  });
});

describe("calendar file", () => {
  const result = buildWeekIcs([csce, math, online, liveOnline], SPRING, { now: NOW, titleOf: (code) => (code === "CSCE 2110" ? "Foundations of Data Structures" : undefined) });
  const calendar = parseIcs(result.ics);

  test("one VCALENDAR with a Chicago VTIMEZONE", () => {
    expect(calendar.name).toBe("VCALENDAR");
    expect(one(calendar, "VERSION").value).toBe("2.0");
    const zone = calendar.children.find((c) => c.name === "VTIMEZONE")!;
    expect(one(zone, "TZID").value).toBe("America/Chicago");
    expect(zone.children.map((c) => [c.name, one(c, "TZOFFSETTO").value, one(c, "RRULE").value])).toEqual([
      ["DAYLIGHT", "-0500", "FREQ=YEARLY;BYMONTH=3;BYDAY=2SU"],
      ["STANDARD", "-0600", "FREQ=YEARLY;BYMONTH=11;BYDAY=1SU"],
    ]);
  });

  test("one weekly event per timed meeting, in Chicago time, starting the first week of the term", () => {
    expect(result.eventCount).toBe(6);
    const starts = events(calendar).map((e) => [one(e, "DTSTART").params, one(e, "DTSTART").value, one(e, "DTEND").value]);
    expect(starts).toEqual([
      ["TZID=America/Chicago", "20270111T090000", "20270111T095000"],
      ["TZID=America/Chicago", "20270113T090000", "20270113T095000"],
      ["TZID=America/Chicago", "20270115T090000", "20270115T095000"],
      ["TZID=America/Chicago", "20270112T140000", "20270112T152000"],
      ["TZID=America/Chicago", "20270114T140000", "20270114T152000"],
      ["TZID=America/Chicago", "20270112T180000", "20270112T192000"],
    ]);
  });

  test("UNTIL is 23:59:59 Chicago time on the last day of classes, written in UTC", () => {
    // Apr 29 is in daylight time (UTC-5), so 23:59:59 local is 04:59:59Z on Apr 30.
    for (const e of events(calendar)) expect(one(e, "RRULE").value).toMatch(/;UNTIL=20270430T045959Z$/);
  });

  test("EXDATE removes the holiday and every spring break day the class meets", () => {
    const exdates = events(calendar).map((e) => (e.props.get("EXDATE") ?? []).map((p) => `${p.params}:${p.value}`));
    expect(exdates).toEqual([
      ["TZID=America/Chicago:20270118T090000,20270308T090000"],
      ["TZID=America/Chicago:20270310T090000"],
      ["TZID=America/Chicago:20270312T090000"],
      ["TZID=America/Chicago:20270309T140000"],
      ["TZID=America/Chicago:20270311T140000"],
      ["TZID=America/Chicago:20270309T180000"],
    ]);
  });

  test("imported, no class falls on spring break or MLK Day, and none outside the term", () => {
    const dates = events(calendar).flatMap(occurrences);
    expect(dates.filter((date) => date >= "2027-03-08" && date <= "2027-03-14")).toEqual([]);
    expect(dates).not.toContain("2027-01-18");
    expect(dates.every((date) => date >= "2027-01-11" && date <= "2027-04-29")).toBe(true);
    // Monday classes: 16 Mondays from Jan 11 to Apr 26, minus MLK Day and spring break.
    expect(occurrences(events(calendar)[0])).toHaveLength(14);
  });

  test("an online class with a set time is in the file; one with no set time is left out and named", () => {
    const live = events(calendar).find((e) => one(e, "SUMMARY").value === "CSCE 1030")!;
    expect([one(live, "DTSTART").value, one(live, "LOCATION").value]).toEqual(["20270112T180000", "Online"]);
    expect(events(calendar).some((e) => one(e, "SUMMARY").value.includes("TECM 2700"))).toBe(false);
    expect(result.leftOut).toEqual(["TECM 2700"]);
  });

  test("summary, location and description", () => {
    const first = events(calendar)[0];
    expect(one(first, "SUMMARY").value).toBe("CSCE 2110 Foundations of Data Structures");
    expect(one(first, "LOCATION").value).toBe("GAB 535");
    expect(one(events(calendar)[3], "SUMMARY").value).toBe("MATH 2700");
    expect(one(first, "DTSTAMP").value).toBe("20261013T120000Z");
  });
});

describe("dates per meeting", () => {
  test("an eight-week class keeps its own dates; UNTIL in standard time is six hours ahead", () => {
    const firstHalf = section({ courseCode: "SPAN 2040", meetings: [meeting({ day: "Tue", at: "9:35", until: "10:55", dates: { start: "2027-01-11", end: "2027-03-05" } })] });
    const secondHalf = section({ courseCode: "SPAN 2050", meetings: [meeting({ day: "Tue", at: "9:35", until: "10:55", dates: { start: "2027-03-15", end: "2027-05-07" } })] });
    const calendar = parseIcs(buildWeekIcs([firstHalf, secondHalf], SPRING, { now: NOW }).ics);
    const [a, b] = events(calendar);
    expect(one(a, "DTSTART").value).toBe("20270112T093500");
    expect(one(a, "RRULE").value).toBe("FREQ=WEEKLY;BYDAY=TU;UNTIL=20270306T055959Z");
    expect(a.props.get("EXDATE")).toBeUndefined();
    // Its own dates run into finals week; weekly classes stop at the last day of classes.
    expect(one(b, "DTSTART").value).toBe("20270316T093500");
    expect(one(b, "RRULE").value).toBe("FREQ=WEEKLY;BYDAY=TU;UNTIL=20270430T045959Z");
  });

  test("two records of one section at the same day and time get their own UIDs", () => {
    const split = section({
      courseCode: "CHEM 1410",
      meetings: [
        meeting({ day: "Mon", at: "9:00", until: "9:50", dates: { start: "2027-01-11", end: "2027-03-05" } }),
        meeting({ day: "Mon", at: "9:00", until: "9:50", room: "CHEM 352", dates: { start: "2027-03-15", end: "2027-04-29" } }),
      ],
    });
    const uids = events(parseIcs(buildWeekIcs([split], SPRING, { now: NOW }).ics)).map((e) => one(e, "UID").value);
    expect(new Set(uids).size).toBe(2);
  });

  test("each date is asked of the calendar for the meeting's own session: a first-half Friday class skips its finals day", () => {
    const firstHalf = section({ courseCode: "SPAN 2040", meetings: [meeting({ day: "Fri", at: "9:00", until: "9:50", dates: { start: "2027-01-11", end: "2027-03-05" } })] });
    const event = events(parseIcs(buildWeekIcs([firstHalf], SPRING, { now: NOW }).ics))[0];
    // Mar 5 is the 8-week session's final-exam day; nothing in it falls on spring break.
    expect(one(event, "EXDATE").value).toBe("20270305T090000");
    expect(occurrences(event).at(-1)).toBe("2027-02-26");
  });

  test("weekend meetings and a class ending at midnight", () => {
    const late = section({
      courseCode: "MUJS 1000",
      meetings: [meeting({ day: "Sat", at: "11:30", until: "12:20" }), meeting({ day: "Sun", at: "22:00", until: "24:00" })],
    });
    const calendar = parseIcs(buildWeekIcs([late], SPRING, { now: NOW }).ics);
    const [sat, sun] = events(calendar);
    expect(one(sat, "DTSTART").value).toBe("20270116T113000");
    expect(one(sat, "EXDATE").value).toBe("20270313T113000");
    expect(one(sun, "DTEND").value).toBe("20270118T000000");
    expect(one(sun, "EXDATE").value).toBe("20270314T220000");
  });

  test("a section that meets only outside the term is left out, not stretched into it", () => {
    const winter = section({ courseCode: "HIST 2610", meetings: [meeting({ day: "Mon", at: "9:00", until: "11:00", dates: { start: "2026-12-14", end: "2027-01-08" } })] });
    const result = buildWeekIcs([winter], SPRING, { now: NOW });
    expect(result.eventCount).toBe(0);
    expect(result.leftOut).toEqual(["HIST 2610"]);
  });

  test("a sample section says so", () => {
    const sample = section({ courseCode: "CSCE 2110", term: null, meetings: [meeting({ day: "Mon", at: "9:00", until: "9:50" })] });
    const calendar = parseIcs(buildWeekIcs([sample], SPRING, { now: NOW }).ics);
    expect(one(events(calendar)[0], "DESCRIPTION").value).toContain("Sample section");
  });
});

describe("Chicago offset at the daylight-time changes", () => {
  const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
  test("2027: daylight time from Sunday Mar 14 to Sunday Nov 7", () => {
    expect(chicagoOffsetHours(day("2027-03-13"))).toBe(6);
    expect(chicagoOffsetHours(day("2027-03-14"))).toBe(5);
    expect(chicagoOffsetHours(day("2027-11-06"))).toBe(5);
    expect(chicagoOffsetHours(day("2027-11-07"))).toBe(6);
  });
});

describe("text", () => {
  test("escapes and folds", () => {
    const odd = section({ courseCode: "CSCE 2110", meetings: [meeting({ day: "Mon", at: "9:00", until: "9:50", room: "GAB 535; Lab, back\\room" })] });
    const raw = buildWeekIcs([odd], SPRING, { now: NOW, titleOf: () => "A very long course title that will certainly need folding across lines" }).ics;
    expect(raw).toContain("LOCATION:GAB 535\\; Lab\\, back\\\\room");
    parseIcs(raw);
    expect(foldLine("x".repeat(80))).toBe(`${"x".repeat(75)}\r\n ${"x".repeat(5)}`);
  });

  test("file name", () => {
    expect(icsFileName(SPRING)).toBe("spring-2027-classes.ics");
  });
});
