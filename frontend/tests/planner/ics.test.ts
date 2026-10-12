import { describe, expect, test } from "bun:test";
import { buildPlanIcs, checkTermDates, foldLine } from "@/lib/planner-ics";
import { buildScheduleEvents, getInitialPlannerState, recommendSections } from "@/lib/planner";
import type { PlannerState, ScheduleEvent } from "@/lib/types";

/**
 * A strict, independent reader for the subset of RFC 5545 the export uses.
 * It shares no code with planner-ics.ts: it checks line endings and lengths,
 * unfolds, checks BEGIN/END nesting, and unescapes TEXT values.
 */
type Component = { name: string; props: Map<string, string[]>; children: Component[] };

function parseIcs(raw: string): Component {
  expect(raw.endsWith("\r\n")).toBe(true);
  expect(/[^\r]\n/.test(raw)).toBe(false); // no bare LF
  const physical = raw.slice(0, -2).split("\r\n");
  for (const line of physical) {
    expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  }
  const logical: string[] = [];
  for (const line of physical) {
    if (line.startsWith(" ")) {
      logical[logical.length - 1] += line.slice(1);
    } else {
      logical.push(line);
    }
  }
  const stack: Component[] = [];
  let root: Component | null = null;
  for (const line of logical) {
    const colon = line.indexOf(":");
    expect(colon).toBeGreaterThan(0);
    const name = line.slice(0, colon);
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
      expect(top).toBeDefined();
      top.props.set(name, [...(top.props.get(name) ?? []), value]);
    }
  }
  expect(stack).toHaveLength(0);
  return root!;
}

const unescape = (value: string) =>
  value.replace(/\\(\\|n|N|;|,)/g, (_, ch: string) => (ch === "n" || ch === "N" ? "\n" : ch));
const one = (c: Component, name: string) => {
  const values = c.props.get(name) ?? [];
  expect(values).toHaveLength(1);
  return values[0];
};

const dayIndex: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5 };

function planWithCourses(codes: string[]): PlannerState {
  const base = getInitialPlannerState();
  const courseStatuses = { ...base.courseStatuses };
  codes.forEach((code) => {
    courseStatuses[code] = "inProgress";
  });
  return { ...base, courseStatuses, selectedSections: recommendSections("compact", codes) };
}

const term = { start: "2027-01-19", end: "2027-05-14" }; // typed by the user, not inferred

describe(".ics export", () => {
  const state = planWithCourses(["MATH 1710", "ANTH 1010", "CSCE 1030"]);
  const events = buildScheduleEvents(state);
  const now = new Date("2026-10-11T15:04:05.000Z");
  const result = buildPlanIcs(events, term, now);
  const calendar = parseIcs(result.ics);

  test("parses as one VCALENDAR with the required properties", () => {
    expect(calendar.name).toBe("VCALENDAR");
    expect(one(calendar, "VERSION")).toBe("2.0");
    expect(one(calendar, "PRODID")).toContain("UNTangle");
    expect(calendar.children.every((child) => child.name === "VEVENT")).toBe(true);
  });

  test("has exactly one VEVENT per plan meeting, matching day, time, course and room", () => {
    expect(events.length).toBeGreaterThan(3);
    expect(calendar.children).toHaveLength(events.length);
    expect(result.eventCount).toBe(events.length);
    expect(result.skipped).toEqual([]);

    const remaining = [...calendar.children];
    for (const event of events) {
      const index = remaining.findIndex((vevent) => {
        const start = one(vevent, "DTSTART");
        const date = new Date(`${start.slice(0, 4)}-${start.slice(4, 6)}-${start.slice(6, 8)}T00:00:00Z`);
        return (
          unescape(one(vevent, "SUMMARY")).startsWith(`${event.courseCode} `) &&
          date.getUTCDay() === dayIndex[event.day] &&
          start.slice(9, 13) === event.start.replace(":", "") &&
          one(vevent, "DTEND").slice(9, 13) === event.end.replace(":", "") &&
          unescape(one(vevent, "LOCATION")) === event.location
        );
      });
      expect(index).toBeGreaterThanOrEqual(0);
      remaining.splice(index, 1);
    }
    expect(remaining).toHaveLength(0);
  });

  test("each meeting starts in the first week of the term and repeats weekly until the last day", () => {
    const termStart = Date.parse(`${term.start}T00:00:00Z`);
    for (const vevent of calendar.children) {
      const start = one(vevent, "DTSTART");
      expect(start).toMatch(/^\d{8}T\d{6}$/); // floating local time
      const date = Date.parse(`${start.slice(0, 4)}-${start.slice(4, 6)}-${start.slice(6, 8)}T00:00:00Z`);
      expect(date).toBeGreaterThanOrEqual(termStart);
      expect(date - termStart).toBeLessThan(7 * 86_400_000);
      expect(one(vevent, "DTEND").slice(0, 8)).toBe(start.slice(0, 8));
      expect(one(vevent, "RRULE")).toMatch(/^FREQ=WEEKLY;BYDAY=(MO|TU|WE|TH|FR);UNTIL=20270514T235959$/);
      expect(one(vevent, "DTSTAMP")).toBe("20261011T150405Z");
      expect(unescape(one(vevent, "DESCRIPTION"))).toContain("Sample data");
    }
    const uids = calendar.children.map((vevent) => one(vevent, "UID"));
    expect(new Set(uids).size).toBe(uids.length);
  });

  test("escapes commas, semicolons, backslashes and newlines and folds long lines", () => {
    const tricky: ScheduleEvent = {
      ...events[0],
      title: "Signals; Systems, and \\ Noise\nLab — a very long title that will certainly need folding past seventy-five octets",
      location: "Room 1, Wing; B",
    };
    const parsed = parseIcs(buildPlanIcs([tricky], term, now).ics);
    const vevent = parsed.children[0];
    expect(unescape(one(vevent, "SUMMARY"))).toBe(`${tricky.courseCode} ${tricky.title} (sample)`);
    expect(unescape(one(vevent, "LOCATION"))).toBe("Room 1, Wing; B");
    expect(foldLine("x".repeat(200)).split("\r\n ").join("")).toBe("x".repeat(200));
  });

  test("a meeting whose weekday never falls inside a short term is reported, not invented", () => {
    const fridayOnly = events.find((event) => event.day === "Fri") ?? { ...events[0], day: "Fri" as const };
    // 2027-01-19 is a Tuesday; a Tue–Wed term has no Friday.
    const short = buildPlanIcs([fridayOnly], { start: "2027-01-19", end: "2027-01-20" }, now);
    expect(short.eventCount).toBe(0);
    expect(short.skipped).toHaveLength(1);
    expect(parseIcs(short.ics).children).toHaveLength(0);
  });
});

/**
 * Checks every VEVENT against the plan's meetings, one to one: weekday
 * (RRULE BYDAY and the DTSTART date), start and end wall-clock time, duration,
 * and the term bounds. Times are floating local (no TZID, no Z), which is
 * the event's timezone: the UNT wall clock the plan is written in.
 */
function assertIcsMatchesMeetings(calendar: Component, meetings: ScheduleEvent[], termDates: { start: string; end: string }) {
  const byDayCode: Record<string, string> = { Mon: "MO", Tue: "TU", Wed: "WE", Thu: "TH", Fri: "FR" };
  const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(2, 4));
  const termStart = termDates.start.replaceAll("-", "");
  const termEnd = termDates.end.replaceAll("-", "");
  expect(calendar.children).toHaveLength(meetings.length);
  const remaining = [...calendar.children];
  for (const meeting of meetings) {
    const index = remaining.findIndex((vevent) => {
      const start = one(vevent, "DTSTART");
      return (
        unescape(one(vevent, "SUMMARY")).startsWith(`${meeting.courseCode} `) &&
        one(vevent, "RRULE").includes(`BYDAY=${byDayCode[meeting.day]};`) &&
        start.slice(9, 13) === meeting.start.replace(":", "")
      );
    });
    expect(index).toBeGreaterThanOrEqual(0);
    const vevent = remaining.splice(index, 1)[0];
    // Floating local time: no TZID parameter, no UTC suffix.
    expect([...vevent.props.keys()].filter((key) => key.startsWith("DTSTART") || key.startsWith("DTEND"))).toEqual([
      "DTSTART",
      "DTEND",
    ]);
    const start = one(vevent, "DTSTART");
    const end = one(vevent, "DTEND");
    expect(start).toMatch(/^\d{8}T\d{6}$/);
    expect(end).toMatch(/^\d{8}T\d{6}$/);
    const date = new Date(`${start.slice(0, 4)}-${start.slice(4, 6)}-${start.slice(6, 8)}T00:00:00Z`);
    expect(date.getUTCDay()).toBe(dayIndex[meeting.day]);
    expect(end.slice(0, 8)).toBe(start.slice(0, 8));
    expect(start.slice(9)).toBe(`${meeting.start.replace(":", "")}00`);
    expect(end.slice(9)).toBe(`${meeting.end.replace(":", "")}00`);
    const planMinutes =
      minutes(meeting.end.replace(":", "")) - minutes(meeting.start.replace(":", ""));
    expect(minutes(end.slice(9, 13)) - minutes(start.slice(9, 13))).toBe(planMinutes);
    expect(planMinutes).toBeGreaterThan(0);
    // Term bounds: first occurrence on or after the first day, and within the first week.
    expect(start.slice(0, 8) >= termStart).toBe(true);
    expect(date.getTime() - Date.parse(`${termDates.start}T00:00:00Z`)).toBeLessThan(7 * 86_400_000);
    const rule = Object.fromEntries(one(vevent, "RRULE").split(";").map((part) => part.split("=")));
    expect(rule.FREQ).toBe("WEEKLY");
    expect(rule.BYDAY).toBe(byDayCode[meeting.day]);
    expect(rule.UNTIL.slice(0, 8) <= termEnd).toBe(true);
    expect(rule.UNTIL).toBe(`${termEnd}T235959`);
    expect(unescape(one(vevent, "LOCATION"))).toBe(meeting.location);
  }
  expect(remaining).toHaveLength(0);
}

describe(".ics depth: weekday, times, duration and term bounds per meeting", () => {
  const now = new Date("2026-10-11T15:04:05.000Z");
  const base = buildScheduleEvents(planWithCourses(["MATH 1710"]))[0];
  // One section meeting on two weekdays, and one in a late-afternoon slot.
  const twoDays: ScheduleEvent[] = [
    { ...base, courseCode: "TEST 1000", title: "Two-day course", sectionId: "test-1000-001", day: "Tue", start: "09:30", end: "10:50", location: "Life Sciences" },
    { ...base, courseCode: "TEST 1000", title: "Two-day course", sectionId: "test-1000-001", day: "Thu", start: "09:30", end: "10:50", location: "Life Sciences" },
  ];
  const lateAfternoon: ScheduleEvent = {
    ...base,
    courseCode: "TEST 2000",
    title: "Late course",
    sectionId: "test-2000-002",
    day: "Wed",
    start: "16:00",
    end: "17:20",
    location: "Gateway Center",
  };

  test("a two-weekday section and a late-afternoon class", () => {
    const meetings = [...twoDays, lateAfternoon];
    const calendar = parseIcs(buildPlanIcs(meetings, term, now).ics);
    assertIcsMatchesMeetings(calendar, meetings, term);
    const late = calendar.children.find((v) => unescape(one(v, "SUMMARY")).startsWith("TEST 2000"))!;
    expect(one(late, "DTSTART")).toBe("20270120T160000");
    expect(one(late, "DTEND")).toBe("20270120T172000");
    const tuesday = calendar.children.find((v) => one(v, "RRULE").includes("BYDAY=TU"))!;
    expect(one(tuesday, "DTSTART")).toBe("20270119T093000"); // the term starts on that Tuesday
    const thursday = calendar.children.find((v) => one(v, "RRULE").includes("BYDAY=TH"))!;
    expect(one(thursday, "DTSTART")).toBe("20270121T093000");
  });

  test("the real plan's meetings, for a term that starts mid-week", () => {
    const meetings = buildScheduleEvents(planWithCourses(["MATH 1710", "ANTH 1010", "CSCE 1030"]));
    const midWeek = { start: "2027-01-21", end: "2027-05-12" }; // Thursday to Wednesday
    assertIcsMatchesMeetings(parseIcs(buildPlanIcs(meetings, midWeek, now).ics), meetings, midWeek);
  });
});

describe("term dates are entered, never inferred", () => {
  test("accepts a valid range", () => {
    expect(checkTermDates(term)).toEqual({ ok: true, ...term });
  });
  test("rejects missing, malformed and impossible dates", () => {
    expect(checkTermDates({ start: "", end: "2027-05-14" })).toMatchObject({ ok: false, field: "start" });
    expect(checkTermDates({ start: "2027-02-30", end: "2027-05-14" })).toMatchObject({ ok: false, field: "start" });
    expect(checkTermDates({ start: "2027-01-19", end: "05/14/2027" })).toMatchObject({ ok: false, field: "end" });
  });
  test("rejects an end before the start and a range longer than a year", () => {
    expect(checkTermDates({ start: "2027-05-14", end: "2027-01-19" })).toMatchObject({ ok: false, field: "end" });
    expect(checkTermDates({ start: "2027-01-01", end: "2028-06-01" })).toMatchObject({ ok: false, field: "end" });
  });
  test("refuses to build without valid dates", () => {
    expect(() => buildPlanIcs([], { start: "", end: "" })).toThrow(/valid term dates/);
  });
});
