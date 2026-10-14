import { describe, expect, expectTypeOf, test } from "bun:test";
import type { z } from "zod";
import type { Fact, SectionRelease, SectionRecord } from "../../ingest/src/section-release";
import { SectionReleaseSchema } from "../src/section-release";
import { decoded, rejections } from "./helpers";

const option = (rest: string) => `$.courses["MATH 1680"].sections[0]${rest}`;
const known = <T>(value: T, from: string): Fact<T> => ({ state: "known", value, from });
const unknown = <T>(raw: string | null, from: string): Fact<T> => ({ state: "unknown", raw, from });
const term = { start: "2027-01-11", end: "2027-05-07" };

/** MATH 1680's first option as a release records it: frontend/tests/sections/fixtures/spring-2027.json. */
const math1680: SectionRecord = {
  optionId: "vsb:spring-2027:MATH 1680:6862+6863",
  classNumbers: ["6862", "6863"],
  sectionCode: "110 + 111",
  status: known("open", option(".status")),
  session: known("Regular Academic Session", option(".session")),
  dates: known(term, option(".meeting_dates")),
  components: [
    {
      classNumber: "6862",
      sectionCode: "110",
      role: "primary",
      instructor: known("Mann,Allen", option(".linked_sections[0].instructor")),
      openSeats: known(99, option(".linked_sections[0].open_seats")),
      totalSeats: known(99, option(".linked_sections[0].total_seats")),
      meetings: (["Tue", "Thu"] as const).map((day) => ({
        day: known(day, option(".meetings[0].days")),
        startMinutes: known(575, option(".meetings[0].start_time")),
        endMinutes: known(655, option(".meetings[0].end_time")),
        room: known("Cury 203", option(".meetings[0].room")),
        dates: known(term, option(".meetings[0].meeting_dates")),
      })),
    },
    {
      classNumber: "6863",
      sectionCode: "111",
      role: "required-linked",
      instructor: unknown("None", option(".linked_sections[1].instructor")),
      openSeats: unknown(null, option(".linked_sections[1].open_seats")),
      totalSeats: known(33, option(".linked_sections[1].total_seats")),
      meetings: [
        {
          day: known("Mon", option(".meetings[1].days")),
          startMinutes: known(480, option(".meetings[1].start_time")),
          endMinutes: known(530, option(".meetings[1].end_time")),
          room: known("Gab 511", option(".meetings[1].room")),
          dates: known(term, option(".meetings[1].meeting_dates")),
        },
      ],
    },
  ],
};

const contentSha256 = "f0a468162c8782a350720bf2df04b5fab15e718632a1446eaa3cb2060bcc1091";

const release: SectionRelease = {
  manifest: {
    releaseId: `vsb-untgrades-spring-2027-${contentSha256.slice(0, 12)}`,
    sourceId: "vsb-untgrades",
    institutionId: "unt",
    termId: "spring-2027",
    fetchedAt: "2026-10-14T18:00:00.000Z",
    sourceObservedAt: "2026-10-04T19:02:54.758921+00:00",
    sourceNote: "Partial scrape: only MATH 1680 was collected from the live cloud browser.",
    rawSha256: "cbd02369152e900429e57408d80828920ceaea0c1f63522beb695d50804989db",
    contentSha256,
    parserVersion: "vsb-v2-release-1",
    counts: { courses: 3, coursesWithSections: 1, coursesWithNoClasses: 1, invalidCourses: 1, sections: 1, components: 2, meetings: 3 },
  },
  courses: [
    { courseCode: "AARS 6810", availability: "no-classes" },
    { courseCode: "ACCT 5120", availability: "invalid-data", problem: '$.courses["ACCT 5120"].sections[0].meetings[0].start_time: invalid time "25:00PM"' },
    { courseCode: "MATH 1680", availability: "sections", sections: [math1680] },
  ],
};

const withSection = (edit: Partial<SectionRecord>): SectionRelease => ({
  ...release,
  courses: [release.courses[0], release.courses[1], { courseCode: "MATH 1680", availability: "sections", sections: [{ ...math1680, ...edit }] }],
});

describe("SectionReleaseSchema", () => {
  test("a release round-trips", () => {
    expect(decoded(SectionReleaseSchema, release)).toEqual(release);
  });

  test("an unknown value keeps its key: a fact without its raw text is rejected", () => {
    const [primary, lab] = math1680.components;
    const missingRaw = { ...lab, openSeats: { state: "unknown", from: option(".linked_sections[1].open_seats") } };
    // Deliberately not a ComponentRecord: the schema is what has to catch it.
    expect(rejections(SectionReleaseSchema, withSection({ components: [primary, missingRaw as never] }))).not.toEqual([]);
  });

  test("a fact must say where it came from", () => {
    expect(rejections(SectionReleaseSchema, withSection({ status: { state: "known", value: "open", from: "status" } }))).toEqual([
      'courses.2.sections.0.status.from: A source path looks like $.courses["MATH 1680"].sections[0].status.',
    ]);
  });

  test("counts must match the courses", () => {
    const counts = { ...release.manifest.counts, meetings: 4 };
    expect(rejections(SectionReleaseSchema, { ...release, manifest: { ...release.manifest, counts } })).toEqual([
      "manifest.counts.meetings: The manifest counts 4; the release holds 3.",
    ]);
  });

  test("courses are sorted by code and listed once", () => {
    const courses = [release.courses[1], release.courses[0], release.courses[2]];
    expect(rejections(SectionReleaseSchema, { ...release, courses })).toEqual(["courses.1.courseCode: Courses are sorted by code, each once."]);
  });

  test("the release id is the source, term and content hash", () => {
    expect(rejections(SectionReleaseSchema, { ...release, manifest: { ...release.manifest, releaseId: "vsb-untgrades-spring-2027-latest" } })).toEqual([
      "manifest.releaseId: A release id is <sourceId>-<termId>-<first 12 digits of contentSha256>.",
    ]);
  });

  test("components follow the option's class numbers, primary first", () => {
    const [primary, lab] = math1680.components;
    expect(rejections(SectionReleaseSchema, withSection({ components: [lab, primary] }))).not.toEqual([]);
  });

  test.each([
    ["another term", "vsb:fall-2026:MATH 1680:6862+6863"],
    ["another course", "vsb:spring-2027:BIOL 1710:6862+6863"],
    ["other class numbers", "vsb:spring-2027:MATH 1680:6863"],
    ["unsorted class numbers", "vsb:spring-2027:MATH 1680:6863+6862"],
  ])("an option id naming %s is rejected", (_why, optionId) => {
    expect(rejections(SectionReleaseSchema, withSection({ optionId }))).toEqual([
      "courses.2.sections.0.optionId: The option id is vsb:spring-2027:MATH 1680:6862+6863: the release's term, the course and the sorted class numbers.",
    ]);
  });

  test("a class number listed twice is rejected", () => {
    const [primary] = math1680.components;
    const twice = withSection({
      optionId: "vsb:spring-2027:MATH 1680:6862+6862",
      classNumbers: ["6862", "6862"],
      components: [primary, { ...primary, role: "required-linked" }],
    });
    expect(rejections(SectionReleaseSchema, { ...twice, manifest: { ...release.manifest, counts: { ...release.manifest.counts, meetings: 4 } } })).toEqual([
      "courses.2.sections.0.classNumbers.1: Class 6862 is listed twice.",
    ]);
  });

  test.each([
    ["a known start with an unknown end", { endMinutes: unknown<number>("", option(".meetings[1].end_time")) }, "A meeting's start and end are both known or both unknown."],
    ["an end before the start", { endMinutes: known(470, option(".meetings[1].end_time")) }, "A meeting ends after it starts."],
    ["an end equal to the start", { endMinutes: known(480, option(".meetings[1].end_time")) }, "A meeting ends after it starts."],
  ])("a meeting with %s is rejected", (_why, edit, message) => {
    const [primary, lab] = math1680.components;
    const meetings = [{ ...lab.meetings[0], ...edit }];
    expect(rejections(SectionReleaseSchema, withSection({ components: [primary, { ...lab, meetings }] }))).toEqual([
      `courses.2.sections.0.components.1.meetings.0.endMinutes: ${message}`,
    ]);
  });

  test("a course with sections lists at least one", () => {
    const courses = [release.courses[0], release.courses[1], { courseCode: "MATH 1680", availability: "sections", sections: [] }];
    expect(rejections(SectionReleaseSchema, { ...release, courses })).not.toEqual([]);
  });

  test("decodes to ingest's SectionRelease", () => {
    expectTypeOf<z.output<typeof SectionReleaseSchema>>().toEqualTypeOf<SectionRelease>();
  });
});
