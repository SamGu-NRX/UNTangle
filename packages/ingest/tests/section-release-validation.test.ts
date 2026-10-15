import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SectionReleaseSchema } from "../../contracts/src/section-release";
import { buildSectionRelease, type SectionReleaseInput } from "../src/section-release";

type RawSection = Record<string, unknown> & { linked_sections: Record<string, unknown>[]; meetings: Record<string, unknown>[] };
type Fixture = Record<string, unknown> & {
  coverage: Record<string, unknown>;
  courses: Record<string, { status: string; sections: RawSection[] }>;
};
const body = readFileSync(new URL("./fixtures/vsb-spring-2027.json", import.meta.url), "utf8");
const input: SectionReleaseInput = { body, sourceId: "vsb-untgrades", institutionId: "unt", termId: "spring-2027", fetchedAt: "2026-10-14T18:00:00.000Z" };

function edited(edit: (raw: Fixture) => void) {
  // SAFETY: this checked-in acceptance fixture has the structure read by the original acceptance tests.
  const raw = JSON.parse(body) as Fixture;
  edit(raw);
  return buildSectionRelease({ ...input, body: JSON.stringify(raw) });
}

function built(edit: (raw: Fixture) => void = () => {}) {
  const result = edited(edit);
  if (!result.ok) throw new Error(`${result.reason}: ${result.message}`);
  expect(SectionReleaseSchema.parse(result.release)).toEqual(result.release);
  return result.release;
}

function mathOption(edit: (raw: Fixture) => void = () => {}) {
  const course = built(edit).courses.find(course => course.courseCode === "MATH 1680");
  if (course?.availability !== "sections") throw new Error("Expected MATH 1680 sections");
  return course.sections[0];
}

describe("raw coverage validation", () => {
  test.each([["catalog_courses", 8], ["completed_courses", 8], ["courses_with_options", 7]] as const)("rejects a false %s claim", (key, value) => {
    expect(edited(raw => { raw.coverage[key] = value; })).toMatchObject({ ok: false, reason: "partial", message: expect.stringContaining("$.coverage") });
  });
  test("equal reported totals do not hide a missing course", () => {
    expect(edited(raw => { delete raw.courses["AARS 6810"]; })).toMatchObject({ ok: false, reason: "partial" });
    expect(edited(raw => { raw.coverage.catalog_courses = 100; raw.coverage.completed_courses = 100; })).toMatchObject({ ok: false, reason: "partial" });
  });
  test("counts courses with options, not the number of options", () => {
    const release = built(raw => {
      const option = structuredClone(raw.courses["ACCT 5120"].sections[0]);
      option.linked_sections[0].class_number = "1003";
      option.meetings[0].class_number = "1003";
      raw.courses["ACCT 5120"].sections.push(option);
    });
    expect(release.manifest.counts).toEqual({ courses: 7, coursesWithSections: 6, coursesWithNoClasses: 1, invalidCourses: 0, sections: 7, components: 8, meetings: 17 });
  });
  test("ignores non-course keys when checking coverage", () => {
    expect(built(raw => { raw.courses.metadata = { status: "ok", sections: [] }; }).manifest.counts.courses).toBe(7);
  });
  test.each([null, -1, 2.5, "7", Number.MAX_SAFE_INTEGER + 1])("rejects malformed coverage count %p", value => {
    expect(edited(raw => { raw.coverage.completed_courses = value; })).toMatchObject({ ok: false, reason: "invalid-data", message: expect.stringContaining("$.coverage.completed_courses") });
  });
  test("missing coverage cannot assert completeness", () => {
    expect(edited(raw => { raw.coverage = {}; })).toMatchObject({ ok: false, reason: "invalid-data" });
  });
  test("pending refreshes prevent publication", () => {
    expect(edited(raw => { raw.refresh_pending = ["MATH 1680"]; })).toMatchObject({ ok: false, reason: "partial", message: expect.stringContaining("$.refresh_pending") });
    expect(edited(raw => { raw.refresh_pending = "MATH 1680"; })).toMatchObject({ ok: false, reason: "invalid-data" });
  });
});

describe("course parsing failures stay local", () => {
  const cases: [string, (raw: Fixture) => void][] = [
    ["unknown course status", raw => { raw.courses["MATH 1680"].status = "failed"; }],
    ["contradictory no_classes status", raw => { raw.courses["MATH 1680"].status = "no_classes"; }],
    ["one-ended time", raw => { raw.courses["MATH 1680"].sections[0].meetings[0].start_time = "TBA"; }],
    ["inverted time", raw => { raw.courses["MATH 1680"].sections[0].meetings[0].end_time = "8:00AM"; }],
    ["equal times", raw => { raw.courses["MATH 1680"].sections[0].meetings[0].end_time = "9:35AM"; }],
    ["invalid day", raw => { raw.courses["MATH 1680"].sections[0].meetings[0].days = "X"; }],
    ["invalid calendar date", raw => { raw.courses["MATH 1680"].sections[0].meetings[0].meeting_dates = "02/29/2027 - 05/07/2027"; }],
    ["inverted dates", raw => { raw.courses["MATH 1680"].sections[0].meeting_dates = "05/07/2027 - 01/11/2027"; }],
    ["duplicate component", raw => { raw.courses["MATH 1680"].sections[0].linked_sections[1].class_number = "6862"; }],
    ["no components", raw => { raw.courses["MATH 1680"].sections[0].linked_sections = []; }],
    ["outside meeting", raw => { raw.courses["MATH 1680"].sections[0].meetings[0].class_number = "9999"; }],
    ["duplicate option", raw => { raw.courses["MATH 1680"].sections.push(structuredClone(raw.courses["MATH 1680"].sections[0])); }],
    ["negative seats", raw => { raw.courses["MATH 1680"].sections[0].linked_sections[0].open_seats = -1; }],
    ["fractional seats", raw => { raw.courses["MATH 1680"].sections[0].linked_sections[0].total_seats = 3.5; }],
  ];
  test.each(cases)("%s becomes invalid-data", (_name, edit) => {
    const release = built(edit);
    expect(release.courses.find(course => course.courseCode === "MATH 1680")).toMatchObject({
      courseCode: "MATH 1680", availability: "invalid-data", problem: expect.stringContaining('$.courses["MATH 1680"]'),
    });
    expect(release.courses.find(course => course.courseCode === "AARS 6810")).toEqual({ courseCode: "AARS 6810", availability: "no-classes" });
    expect(release.manifest.counts).toEqual({ courses: 7, coursesWithSections: 5, coursesWithNoClasses: 1, invalidCourses: 1, sections: 5, components: 5, meetings: 13 });
  });
});

describe("evidence normalization", () => {
  test("a component without detailed lines retains linked-row evidence", () => {
    const option = mathOption(raw => { raw.courses["MATH 1680"].sections[0].meetings.splice(1); });
    expect(option.components[1].meetings[0]).toEqual({
      day: { state: "known", value: "Mon", from: '$.courses["MATH 1680"].sections[0].linked_sections[1].days' },
      startMinutes: { state: "known", value: 480, from: '$.courses["MATH 1680"].sections[0].linked_sections[1].start_time' },
      endMinutes: { state: "known", value: 530, from: '$.courses["MATH 1680"].sections[0].linked_sections[1].end_time' },
      room: { state: "known", value: "Gab 511", from: '$.courses["MATH 1680"].sections[0].linked_sections[1].room' },
      dates: { state: "known", value: { start: "2027-01-11", end: "2027-05-07" }, from: '$.courses["MATH 1680"].sections[0].linked_sections[1].meeting_dates' },
    });
  });
  test("unknowns preserve source text, missing seats stay unknown, and zero seats stay known", () => {
    const option = mathOption(raw => {
      const section = raw.courses["MATH 1680"].sections[0];
      section.linked_sections[0].instructor = "  None Mann,Allen   None ";
      section.linked_sections[0].open_seats = 0;
      delete section.linked_sections[0].total_seats;
      section.meetings[0].days = " TBA ";
      section.meetings[0].start_time = null;
      delete section.meetings[0].end_time;
      section.meetings[0].room = " No Room ";
      section.meetings[0].meeting_dates = " None ";
    });
    const prefix = '$.courses["MATH 1680"].sections[0]';
    expect(option.components[0].instructor).toEqual({ state: "known", value: "Mann,Allen", from: `${prefix}.linked_sections[0].instructor` });
    expect(option.components[0].openSeats).toEqual({ state: "known", value: 0, from: `${prefix}.linked_sections[0].open_seats` });
    expect(option.components[0].totalSeats).toEqual({ state: "unknown", raw: null, from: `${prefix}.linked_sections[0].total_seats` });
    expect(option.components[0].meetings).toEqual([{
      day: { state: "unknown", raw: " TBA ", from: `${prefix}.meetings[0].days` },
      startMinutes: { state: "unknown", raw: null, from: `${prefix}.meetings[0].start_time` },
      endMinutes: { state: "unknown", raw: null, from: `${prefix}.meetings[0].end_time` },
      room: { state: "unknown", raw: " No Room ", from: `${prefix}.meetings[0].room` },
      dates: { state: "unknown", raw: " None ", from: `${prefix}.meetings[0].meeting_dates` },
    }]);
  });
  test.each(["Cancelled", "Canceled"])("recognizes %s status", status => {
    expect(mathOption(raw => { raw.courses["MATH 1680"].sections[0].status = status; }).status).toEqual({
      state: "known", value: "cancelled", from: '$.courses["MATH 1680"].sections[0].status',
    });
  });
  test("preserves the source note without interpreting its prose as coverage", () => {
    const note = "x".repeat(1500);
    expect(built(raw => { raw.note = note; }).manifest.sourceNote).toBe(note);
  });
});

describe("caller and file timestamps", () => {
  test("VSB cannot supply another institution's identities", () => {
    expect(buildSectionRelease(input).ok).toBe(true);
    expect(() => buildSectionRelease({ ...input, institutionId: "ut-austin" })).toThrow('belongs to institution "unt"');
  });
  test.each(["2026-02-30T18:00:00Z", "2026-10-14T25:00:00Z", "2026-10-14T18:00:00+01:00"])("rejects fetchedAt %s", fetchedAt => {
    expect(() => buildSectionRelease({ ...input, fetchedAt })).toThrow("ISO 8601 UTC instant");
  });
  test.each(["2026-02-30T18:00:00Z", "2026-10-14T18:00:00", "yesterday"])("rejects source timestamp %s", updatedAt => {
    expect(edited(raw => { raw.updated_at = updatedAt; })).toMatchObject({ ok: false, reason: "invalid-data", message: expect.stringContaining("$.updated_at") });
  });
});
