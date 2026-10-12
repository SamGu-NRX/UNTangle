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
