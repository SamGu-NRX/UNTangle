import { describe, expect, test } from "bun:test";
import fixture from "./fixtures/spring-2027.json";
import { resolveRoom } from "../../src/lib/sections/buildings";
import { normalizeInstructor, parseTerm } from "../../src/lib/sections/vsb";

type Input = typeof fixture;
const math = (input: Input) => input.courses["MATH 1680"].sections[0];

function parse(edit?: (input: Input) => void) {
  const input = structuredClone(fixture);
  edit?.(input);
  return parseTerm(input, "spring-2027");
}

function firstOption(code: string, edit?: (input: Input) => void) {
  const record = parse(edit).courses.get(code);
  if (!Array.isArray(record)) throw new Error(`${code} did not parse: ${JSON.stringify(record)}`);
  return record[0];
}

describe("vsb schema v2 parsing", () => {
  test("a linked option keeps each component and flattens their meetings once", () => {
    const option = firstOption("MATH 1680");
    expect(option.id).toBe("vsb:spring-2027:MATH 1680:6862+6863");
    expect(option.components.map(c => [c.classNumber, c.role, c.seats.open])).toEqual([
      ["6862", "primary", 99],
      ["6863", "required-linked", 33],
    ]);
    expect(option.meetings.map(m => [m.day, m.startMinutes, m.endMinutes, m.buildingId])).toEqual([
      ["Tue", 575, 655, "cury"],
      ["Thu", 575, 655, "cury"],
      ["Mon", 480, 530, "gab"],
    ]);
    expect(option.instructor).toEqual({ display: "Allen Mann", raw: "Mann,Allen" });
  });

  test("option numbers and labels do not change an option's id", () => {
    const renumbered = firstOption("MATH 1680", input => {
      math(input).option = "99";
      math(input).section = "renumbered";
    });
    expect(renumbered.id).toBe("vsb:spring-2027:MATH 1680:6862+6863");
  });

  test("a component without detail rows keeps its linked schedule beside one that has them", () => {
    const option = firstOption("MATH 1680", input => {
      const lines = math(input).meetings.filter(line => line.class_number === "6862");
      lines[0].start_time = "9:30AM";
      math(input).meetings = lines;
    });
    expect(option.components[0].meetings.map(m => [m.day, m.startMinutes])).toEqual([
      ["Tue", 570],
      ["Thu", 570],
    ]);
    expect(option.components[1].meetings.map(m => [m.day, m.startMinutes])).toEqual([["Mon", 480]]);
    expect(option.meetings).toHaveLength(3);
  });

  test("an online option with no day or time is async and keeps eight-week dates", () => {
    const option = firstOption("ACCT 5120");
    expect([option.online, option.async, option.tba]).toEqual([true, true, false]);
    const meetings = option.meetings.map(m => [m.day, m.startMinutes, m.kind]);
    expect(meetings).toEqual([[null, null, "online"]]);
    expect(option.session).toEqual({
      label: "Eight Week - Second",
      dates: { raw: "03/15/2027 - 05/07/2027", start: "2027-03-15", end: "2027-05-07" },
    });
  });

  test("a scheduled online meeting stays timed", () => {
    const option = firstOption("ACCT 5120", input => {
      const line = input.courses["ACCT 5120"].sections[0].meetings[0];
      Object.assign(line, { days: "M", start_time: "8:00AM", end_time: "9:00AM" });
    });
    expect([option.online, option.async, option.tba]).toEqual([true, false, false]);
    expect(option.meetings[0]).toMatchObject({ day: "Mon", startMinutes: 480, endMinutes: 540 });
  });

  test("a known day with no time is TBA, not async, and keeps its day", () => {
    const option = firstOption("BCIS 4740");
    expect(option.meetings.map(m => [m.day, m.startMinutes, m.tba])).toEqual([
      ["Thu", null, true],
      ["Thu", 1050, false],
    ]);
    expect(option.async).toBe(false);
  });

  test("weekend rows and repeated rows all survive", () => {
    const days = firstOption("DBAS 6003").meetings.map(m => m.day);
    expect(days).toEqual(["Sat", "Sun", "Sat", "Sun", "Sat", "Sun", "Sat", "Sun"]);
  });

  test("12:00AM starts at 0 and ends at 1440; 12:00PM is noon", () => {
    const times = (start: string, end: string) =>
      firstOption("MATH 1680", input => {
        Object.assign(math(input).meetings[0], { start_time: start, end_time: end });
      }).meetings[0];
    expect(times("12:00AM", "12:00PM")).toMatchObject({ startMinutes: 0, endMinutes: 720 });
    expect(times("10:00PM", "12:00AM")).toMatchObject({ startMinutes: 1320, endMinutes: 1440 });
  });

  test("instructor names are displayed First Last without losing the raw text", () => {
    expect(normalizeInstructor("Curran Jr,Anthony A").display).toBe("Anthony A Curran Jr");
    expect(normalizeInstructor("  Jane  Smith ").display).toBe("Jane Smith");
    expect(normalizeInstructor("Jimenez,Jaime Enrique, Ogden Jr,Samuel J").display)
      .toBe("Jaime Enrique Jimenez; Samuel J Ogden Jr");
    expect(normalizeInstructor("None, Lee,Annie Seong").display).toBe("Annie Seong Lee");
    expect(normalizeInstructor("None None")).toEqual({ display: null, raw: "None None" });
  });

  test("section statuses map to known values and keep unknown ones raw", () => {
    expect(firstOption("ADES 5510")).toMatchObject({ status: "closed", seats: { open: null } });
    expect(firstOption("ART 5450")).toMatchObject({ status: "waitlist", rawStatus: "Wait List" });
    const renamed = firstOption("MATH 1680", input => { math(input).status = "Reserved"; });
    expect(renamed).toMatchObject({ status: "unknown", rawStatus: "Reserved" });
    expect(parse().courses.get("AARS 6810")).toEqual([]);
  });
});

describe("tolerance", () => {
  test("unknown fields at every level are ignored", () => {
    const option = firstOption("MATH 1680", input => {
      Object.assign(input, { new_top_level: true });
      Object.assign(input.courses["MATH 1680"], { new_course_field: 1 });
      Object.assign(math(input), { new_section_field: "x" });
      Object.assign(math(input).meetings[0], { new_meeting_field: null });
    });
    expect(option.id).toBe("vsb:spring-2027:MATH 1680:6862+6863");
  });

  test("a course that fails to parse becomes a diagnostic without hiding the others", () => {
    const term = parse(input => { math(input).meetings[0].days = "H"; });
    expect(term.courses.get("MATH 1680")).toEqual({
      code: "schema_error",
      message: 'vsb schema v2: $.courses["MATH 1680"].sections[0].meetings[0].days: unknown days "H"',
    });
    expect(term.courses.get("ACCT 5120")).toHaveLength(1);
  });

  test("schema_version and the term label gate the whole file", () => {
    expect(() => parseTerm({ ...fixture, schema_version: 3 }, "spring-2027"))
      .toThrow("$.schema_version: unsupported version 3");
    expect(() => parseTerm(fixture, "fall-2027")).toThrow("$.term: does not match fall-2027");
  });
});

describe("room mapping", () => {
  test("exact catalogue codes and aliases map; nothing else is guessed", () => {
    expect(resolveRoom("Wh 316")).toMatchObject({ buildingId: "wh", kind: "building" });
    expect(resolveRoom("HKRY 101")).toMatchObject({ buildingId: "hick", kind: "building" });
    expect(resolveRoom("NTDP F100")).toMatchObject({ buildingId: "ntdp", offCampus: true });
    expect(resolveRoom("MGV P124")).toMatchObject({ buildingId: null, buildingCode: "MGV" });
    expect(resolveRoom("FRLD 458")).toMatchObject({ kind: "unknown", buildingId: null });
    expect(resolveRoom("No Room").kind).toBe("unassigned");
    expect(resolveRoom("UNT Internet Course").kind).toBe("online");
  });
});
