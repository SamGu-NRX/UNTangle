import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { SectionReleaseSchema } from "../../contracts/src/section-release";
import {
  SECTION_PARSER_VERSION,
  buildSectionRelease,
  type CourseRecord,
  type SectionRelease,
  type SectionReleaseInput,
} from "../src/section-release";

/**
 * vsb-spring-2027.json is frontend/tests/sections/fixtures/spring-2027.json,
 * copied on 2026-10-14: a real vsb.untgrades.app schema v2 term file cut
 * down to seven courses. Read as text, so its exact bytes are the body.
 */
const body = readFileSync(path.join(import.meta.dir, "fixtures", "vsb-spring-2027.json"), "utf8");
const input: SectionReleaseInput = {
  body,
  sourceId: "vsb-untgrades",
  institutionId: "unt",
  termId: "spring-2027",
  fetchedAt: "2026-10-14T18:00:00.000Z",
};

type Raw = {
  courses: Record<string, { sections: Array<Record<string, unknown> & { linked_sections: Record<string, unknown>[]; meetings: Record<string, unknown>[] }> }>;
} & Record<string, unknown>;

/** The fixture as JSON, edited, as a new body. */
function edited(edit: (raw: Raw) => void): string {
  const raw = JSON.parse(body) as Raw;
  edit(raw);
  return JSON.stringify(raw);
}

function release(overrides: Partial<SectionReleaseInput> = {}): SectionRelease {
  const result = buildSectionRelease({ ...input, ...overrides });
  if (!result.ok) throw new Error(`expected a release, got ${result.reason}: ${result.message}`);
  return result.release;
}

function course(built: SectionRelease, code: string): CourseRecord {
  const found = built.courses.find((entry) => entry.courseCode === code);
  if (!found) throw new Error(`${code} is missing`);
  return found;
}

function firstSection(built: SectionRelease, code: string) {
  const record = course(built, code);
  if (record.availability !== "sections") throw new Error(`${code} is ${record.availability}`);
  return record.sections[0];
}

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** JSON with every object's keys sorted and no whitespace. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Every object's keys in reverse order, arrays untouched. */
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverseKeys(child)]));
  return value;
}

const at = (code: string, rest: string) => `$.courses[${JSON.stringify(code)}]${rest}`;
const known = <T>(value: T, from: string) => ({ state: "known" as const, value, from });
const unknown = (raw: string | null, from: string) => ({ state: "unknown" as const, raw, from });

// Building a release never touches the network; a fetch here fails the test that made it.
const fetchSpy = spyOn(globalThis, "fetch");
beforeAll(() => {
  const refuse = () => Promise.reject(new Error("buildSectionRelease must not fetch"));
  fetchSpy.mockImplementation(Object.assign(refuse, { preconnect: globalThis.fetch.preconnect }));
});
afterAll(() => {
  fetchSpy.mockRestore();
});

describe("buildSectionRelease", () => {
  test("the manifest names the source, term, times, hashes, parser and counts", () => {
    const built = release();
    expect(built.manifest).toEqual({
      releaseId: `vsb-untgrades-spring-2027-${built.manifest.contentSha256.slice(0, 12)}`,
      sourceId: "vsb-untgrades",
      institutionId: "unt",
      termId: "spring-2027",
      fetchedAt: "2026-10-14T18:00:00.000Z",
      sourceObservedAt: "2026-10-04T19:02:54.758921+00:00",
      sourceNote:
        "Partial scrape: only MATH 1680 was collected from the live cloud browser. Run class_scraper.py to resume all remaining courses.",
      rawSha256: sha256(body),
      contentSha256: sha256(canonicalJson(built.courses)),
      parserVersion: SECTION_PARSER_VERSION,
      counts: { courses: 7, coursesWithSections: 6, coursesWithNoClasses: 1, invalidCourses: 0, sections: 6, components: 7, meetings: 16 },
    });
  });

  test("the release matches the contract's schema", () => {
    expect(() => SectionReleaseSchema.parse(release())).not.toThrow();
  });

  test("courses come sorted by course code", () => {
    expect(release().courses.map((entry) => entry.courseCode)).toEqual([
      "AARS 6810",
      "ACCT 5120",
      "ADES 5510",
      "ART 5450",
      "BCIS 4740",
      "DBAS 6003",
      "MATH 1680",
    ]);
  });

  test("a linked option keeps each component, its seats and its meetings, with the path each value came from", () => {
    const option = (rest: string) => at("MATH 1680", `.sections[0]${rest}`);
    const meeting = (line: number, day: "Mon" | "Tue" | "Thu", start: number, end: number, room: string) => ({
      day: known(day, option(`.meetings[${line}].days`)),
      startMinutes: known(start, option(`.meetings[${line}].start_time`)),
      endMinutes: known(end, option(`.meetings[${line}].end_time`)),
      room: known(room, option(`.meetings[${line}].room`)),
      dates: known({ start: "2027-01-11", end: "2027-05-07" }, option(`.meetings[${line}].meeting_dates`)),
    });
    expect(firstSection(release(), "MATH 1680")).toEqual({
      optionId: "vsb:spring-2027:MATH 1680:6862+6863",
      classNumbers: ["6862", "6863"],
      sectionCode: "110 + 111",
      status: known("open", option(".status")),
      session: known("Regular Academic Session", option(".session")),
      dates: known({ start: "2027-01-11", end: "2027-05-07" }, option(".meeting_dates")),
      components: [
        {
          classNumber: "6862",
          sectionCode: "110",
          role: "primary",
          instructor: known("Mann,Allen", option(".linked_sections[0].instructor")),
          openSeats: known(99, option(".linked_sections[0].open_seats")),
          totalSeats: known(99, option(".linked_sections[0].total_seats")),
          meetings: [meeting(0, "Tue", 575, 655, "Cury 203"), meeting(0, "Thu", 575, 655, "Cury 203")],
        },
        {
          classNumber: "6863",
          sectionCode: "111",
          role: "required-linked",
          instructor: unknown("None", option(".linked_sections[1].instructor")),
          openSeats: known(33, option(".linked_sections[1].open_seats")),
          totalSeats: known(33, option(".linked_sections[1].total_seats")),
          meetings: [meeting(1, "Mon", 480, 530, "Gab 511")],
        },
      ],
    });
  });

  test("values the source doesn't give are unknown, with the text it gave instead", () => {
    const closed = firstSection(release(), "ADES 5510");
    const option = (rest: string) => at("ADES 5510", `.sections[0]${rest}`);
    expect(closed.status).toEqual(known("closed", option(".status")));
    const [component] = closed.components;
    expect([component.instructor, component.openSeats, component.totalSeats]).toEqual([
      unknown("Closed", option(".linked_sections[0].instructor")),
      unknown(null, option(".linked_sections[0].open_seats")),
      unknown(null, option(".linked_sections[0].total_seats")),
    ]);
    expect(component.meetings).toEqual([
      {
        day: unknown("", option(".meetings[0].days")),
        startMinutes: unknown("", option(".meetings[0].start_time")),
        endMinutes: unknown("", option(".meetings[0].end_time")),
        room: unknown("None", option(".meetings[0].room")),
        dates: known({ start: "2027-01-11", end: "2027-05-07" }, option(".meetings[0].meeting_dates")),
      },
    ]);
    const waitlisted = firstSection(release(), "ART 5450");
    expect(waitlisted.status.state === "known" && waitlisted.status.value).toBe("waitlist");
    expect(waitlisted.components[0].meetings[0].room).toEqual(unknown("No Facility Assigned", at("ART 5450", ".sections[0].meetings[0].room")));
  });

  test("an online option with no set time keeps its room text and has no day or time", () => {
    const [meeting] = firstSection(release(), "ACCT 5120").components[0].meetings;
    const line = (field: string) => at("ACCT 5120", `.sections[0].meetings[0].${field}`);
    expect(meeting).toEqual({
      day: unknown("", line("days")),
      startMinutes: unknown("", line("start_time")),
      endMinutes: unknown("", line("end_time")),
      room: known("UNT Internet Course", line("room")),
      dates: known({ start: "2027-03-15", end: "2027-05-07" }, line("meeting_dates")),
    });
  });

  test("a known day with no time keeps its day", () => {
    const [noTime, timed] = firstSection(release(), "BCIS 4740").components[0].meetings;
    const line = (index: number, field: string) => at("BCIS 4740", `.sections[0].meetings[${index}].${field}`);
    expect([noTime.day, noTime.startMinutes, noTime.endMinutes]).toEqual([
      known("Thu", line(0, "days")),
      unknown("", line(0, "start_time")),
      unknown("", line(0, "end_time")),
    ]);
    expect([timed.day, timed.startMinutes, timed.endMinutes, timed.room]).toEqual([
      known("Thu", line(1, "days")),
      known(1050, line(1, "start_time")),
      known(1130, line(1, "end_time")),
      known("SAGE 333", line(1, "room")),
    ]);
  });

  test("a line that meets on two days gives one meeting per day, both pointing at that line", () => {
    const meetings = firstSection(release(), "DBAS 6003").components[0].meetings;
    expect(meetings).toHaveLength(8);
    expect(meetings.slice(0, 2).map((meeting) => meeting.day)).toEqual([
      known("Sat", at("DBAS 6003", ".sections[0].meetings[0].days")),
      known("Sun", at("DBAS 6003", ".sections[0].meetings[0].days")),
    ]);
  });

  test("a class ending at 12:00AM ends at 1440", () => {
    const built = release({ body: edited((raw) => void (raw.courses["MATH 1680"].sections[0].meetings[1].end_time = "12:00AM")) });
    expect(firstSection(built, "MATH 1680").components[1].meetings[0].endMinutes).toEqual(
      known(1440, at("MATH 1680", ".sections[0].meetings[1].end_time")),
    );
  });

  test("a status the parser doesn't know is unknown, with its text kept", () => {
    const built = release({ body: edited((raw) => void (raw.courses["MATH 1680"].sections[0].status = "Reserved")) });
    expect(firstSection(built, "MATH 1680").status).toEqual(unknown("Reserved", at("MATH 1680", ".sections[0].status")));
  });

  test("a course with no options is no-classes", () => {
    expect(course(release(), "AARS 6810")).toEqual({ courseCode: "AARS 6810", availability: "no-classes" });
  });

  test("a course the parser can't read is invalid-data, never no-classes, and the rest still load", () => {
    const built = release({ body: edited((raw) => void (raw.courses["ACCT 5120"].sections[0].meetings[0].start_time = "25:00PM")) });
    const broken = course(built, "ACCT 5120");
    expect(broken.availability).toBe("invalid-data");
    expect(broken.availability === "invalid-data" && broken.problem).toContain(at("ACCT 5120", ""));
    expect(built.manifest.counts).toEqual({
      courses: 7,
      coursesWithSections: 5,
      coursesWithNoClasses: 1,
      invalidCourses: 1,
      sections: 5,
      components: 6,
      meetings: 15,
    });
    expect(firstSection(built, "MATH 1680").optionId).toBe("vsb:spring-2027:MATH 1680:6862+6863");
  });

  test("a refetch of unchanged data keeps the courses, content hash and release id", () => {
    const first = release();
    const later = release({ fetchedAt: "2026-10-14T18:15:00.000Z" });
    expect(later.courses).toEqual(first.courses);
    expect(later.manifest.contentSha256).toBe(first.manifest.contentSha256);
    expect(later.manifest.releaseId).toBe(first.manifest.releaseId);
    expect(later.manifest.fetchedAt).toBe("2026-10-14T18:15:00.000Z");
  });

  test("reordering the response's object keys changes the raw hash but not the content", () => {
    const reordered = JSON.stringify(reverseKeys(JSON.parse(body)));
    const first = release();
    const second = release({ body: reordered });
    expect(second.manifest.rawSha256).toBe(sha256(reordered));
    expect(second.manifest.rawSha256).not.toBe(first.manifest.rawSha256);
    expect(second.courses).toEqual(first.courses);
    expect(second.manifest.contentSha256).toBe(first.manifest.contentSha256);
    expect(second.manifest.releaseId).toBe(first.manifest.releaseId);
  });

  test("a changed seat count changes the content hash and the release id", () => {
    const first = release();
    const changed = release({ body: edited((raw) => void (raw.courses["MATH 1680"].sections[0].linked_sections[1].open_seats = 32)) });
    expect(changed.manifest.contentSha256).not.toBe(first.manifest.contentSha256);
    expect(changed.manifest.releaseId).not.toBe(first.manifest.releaseId);
  });

  test.each([
    ["invalid-json", "the body isn't JSON", () => body.slice(0, 200)],
    ["unsupported-schema", "schema_version isn't 2", () => edited((raw) => void (raw.schema_version = 3))],
    ["wrong-term", "the file is for another term", () => edited((raw) => void (raw.term = "2027 Fall"))],
    ["partial", "the scrape says it is incomplete", () => edited((raw) => void (raw.coverage = { catalog_courses: 7, completed_courses: 6, courses_with_options: 5 }))],
    ["partial", "the file lists no courses", () => edited((raw) => void (raw.courses = {}))],
    ["invalid-data", "the file has no updated_at", () => edited((raw) => void delete raw.updated_at)],
  ])("returns %s, not a release, when %s", (reason, _why, makeBody) => {
    const result = buildSectionRelease({ ...input, body: makeBody() });
    expect(result).toMatchObject({ ok: false, reason, message: expect.stringMatching(/./) });
  });

  test("a caller mistake throws instead of returning a failure", () => {
    expect(buildSectionRelease(input).ok).toBe(true);
    expect(() => buildSectionRelease({ ...input, sourceId: "ratemyprofessors" })).toThrow();
    expect(() => buildSectionRelease({ ...input, termId: "Spring 2027" })).toThrow();
    expect(() => buildSectionRelease({ ...input, fetchedAt: "yesterday" })).toThrow();
  });

  test("building a release makes no request", () => {
    release();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
