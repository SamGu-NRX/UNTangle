/**
 * Builds a published section release from one fetched class-search
 * response: steps 2 and 4 of "Reference data: published releases" in
 * docs/architecture/README.md. Fetching, comparing with the last good
 * release and uploading are separate steps; this module never touches the
 * network, the disk or a clock.
 *
 * The input today is a vsb.untgrades.app schema v2 term file, the format
 * frontend/src/lib/sections/vsb.ts parses. A release keeps each value as the
 * source gave it, normalized (times to minutes, dates to ISO, day letters to
 * day names), with the JSON path it came from. Interpreting values, such as
 * mapping a room to a campus building, happens downstream.
 *
 * SectionReleaseSchema in @untangle/contracts/section-release is the same
 * shape, and its tests pin it to the types here.
 */

/**
 * One value read from the source. `from` is the JSON path of the field in
 * the raw response, as `$.courses["MATH 1680"].sections[0].linked_sections[1].open_seats`.
 * "unknown" means the source didn't give a value; `raw` is the text it gave
 * instead ("", "TBA", "None"), or null when the field was null or absent.
 * The key is always there: a missing value is a state, never a missing key.
 */
export type Fact<T> = { state: "known"; value: T; from: string } | { state: "unknown"; raw: string | null; from: string };

export type ClassDay = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";

/** Inclusive ISO dates, YYYY-MM-DD. */
export type DateSpan = { start: string; end: string };

/** One meeting line for one day. A line that meets on several days ("TR") gives one record per day. */
export type MeetingRecord = {
  day: Fact<ClassDay>;
  /** Minutes after midnight; a class ending at 12:00AM ends at 1440. */
  startMinutes: Fact<number>;
  endMinutes: Fact<number>;
  /** The room as written, trimmed ("Cury 203", "UNT Internet Course"); unknown for "", "None", "TBA", "No Room" and "No Facility Assigned". */
  room: Fact<string>;
  dates: Fact<DateSpan>;
};

/** One class number of an enrollment option. */
export type ComponentRecord = {
  classNumber: string;
  sectionCode: string;
  /** The first linked row is the primary; the rest are required linked components. */
  role: "primary" | "required-linked";
  /** The instructor field with stray "None" placeholders removed and spaces collapsed ("Mann,Allen"); unknown for "", "TBA", "Staff" and "Closed". */
  instructor: Fact<string>;
  openSeats: Fact<number>;
  totalSeats: Fact<number>;
  /** The component's detailed meeting lines, or its linked row's schedule when it has none. */
  meetings: MeetingRecord[];
};

/** One enrollment option: a primary component plus its required linked components. */
export type SectionRecord = {
  /** `vsb:<term>:<course>:<class numbers sorted and joined with +>`, the app's option id. */
  optionId: string;
  /** In source order, primary first. */
  classNumbers: string[];
  /** The option's label as written ("110 + 111"). */
  sectionCode: string;
  /** Unknown, with the text kept in `raw`, for a status other than Open, Closed, Wait List, Cancelled or Canceled. */
  status: Fact<"open" | "closed" | "waitlist" | "cancelled">;
  /** The session label ("Regular Academic Session"). */
  session: Fact<string>;
  dates: Fact<DateSpan>;
  components: ComponentRecord[];
};

/**
 * One course in the response. "no-classes" is the source saying the course
 * has no options this term. "invalid-data" is a course the parser couldn't
 * read; it never turns into "no-classes".
 */
export type CourseRecord =
  | { courseCode: string; availability: "sections"; sections: SectionRecord[] }
  | { courseCode: string; availability: "no-classes" }
  | { courseCode: string; availability: "invalid-data"; problem: string };

export type ReleaseManifest = {
  /** `<sourceId>-<termId>-<first 12 hex digits of contentSha256>`, so unchanged content keeps its id. */
  releaseId: string;
  sourceId: string;
  institutionId: string;
  termId: string;
  /** When our job fetched the response. Never shown as "updated". */
  fetchedAt: string;
  /** The response's own `updated_at`: when the source says its data was current. */
  sourceObservedAt: string;
  /** The response's `note`, verbatim. */
  sourceNote: string;
  /** Lowercase hex SHA-256 of the response body's UTF-8 bytes, exactly as fetched. */
  rawSha256: string;
  /** Lowercase hex SHA-256 of `courses` as canonical JSON: object keys sorted, no whitespace. */
  contentSha256: string;
  parserVersion: string;
  counts: {
    courses: number;
    coursesWithSections: number;
    coursesWithNoClasses: number;
    invalidCourses: number;
    sections: number;
    components: number;
    meetings: number;
  };
};

/** Courses are sorted by course code. */
export type SectionRelease = { manifest: ReleaseManifest; courses: CourseRecord[] };

/**
 * Why a response can't become a release. None of these may replace a good
 * release:
 * - "invalid-json": the body isn't JSON;
 * - "unsupported-schema": `schema_version` isn't 2;
 * - "wrong-term": the response is for another term;
 * - "partial": the response says its scrape is incomplete, or lists no courses;
 * - "invalid-data": a field the whole file depends on is missing or malformed.
 */
export type SectionReleaseFailure = {
  ok: false;
  reason: "invalid-json" | "unsupported-schema" | "wrong-term" | "partial" | "invalid-data";
  message: string;
};

export type SectionReleaseResult = { ok: true; release: SectionRelease } | SectionReleaseFailure;

export type SectionReleaseInput = {
  /** The response body exactly as fetched. */
  body: string;
  /** A source in SOURCE_POLICIES that a server job may fetch. */
  sourceId: string;
  institutionId: string;
  /** "spring-2027". */
  termId: string;
  /** An ISO 8601 UTC instant. */
  fetchedAt: string;
};

/** Changes whenever the same response would build different records. */
export const SECTION_PARSER_VERSION = "vsb-v2-release-1";

/**
 * Turns one response into a release, or says why it can't.
 *
 * Reads what frontend/src/lib/sections/vsb.ts reads and applies the same
 * checks. A course that fails them becomes an "invalid-data" record and the
 * rest still load; a failure of the file as a whole returns a
 * SectionReleaseFailure. Keys under `courses` that aren't course codes are
 * skipped, as vsb.ts skips them.
 *
 * Deterministic: the same body, source, institution and term always give the
 * same courses, contentSha256 and releaseId, whatever `fetchedAt` is and
 * whatever order the response lists its object keys in.
 *
 * Throws, instead of returning a failure, on a caller mistake: a source
 * without an allowed server policy, a malformed termId or fetchedAt.
 */
export function buildSectionRelease(input: SectionReleaseInput): SectionReleaseResult {
  void input;
  throw new Error("Not built yet: docs/tasks/section-release.md");
}
