import { createHash } from "node:crypto";
import { sourcePolicy } from "./source-policies";

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
  /** Minutes after midnight; a class ending at 12:00AM ends at 1440. Both known or both unknown, and a known end is after the start. */
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
  const policy = sourcePolicy(input.sourceId);
  if (policy.acquisition !== "server" || policy.approval !== "allowed") {
    throw new Error(`Source "${input.sourceId}" has no allowed server policy.`);
  }
  if (input.institutionId !== policy.institutionId) {
    throw new Error(`Source "${input.sourceId}" belongs to institution "${policy.institutionId}", not "${input.institutionId}".`);
  }
  const term = /^(spring|summer|fall|winter)-(\d{4})$/.exec(input.termId);
  if (!term) throw new Error(`Malformed termId "${input.termId}"; expected spring-2027.`);
  if (!isInstant(input.fetchedAt, false)) throw new Error("fetchedAt must be an ISO 8601 UTC instant.");

  let raw: unknown;
  try {
    raw = JSON.parse(input.body);
  } catch {
    return { ok: false, reason: "invalid-json", message: "The response body is not JSON." };
  }
  try {
    const root = object(raw, "$");
    if (root.schema_version !== 2) {
      return { ok: false, reason: "unsupported-schema", message: "$.schema_version: expected 2." };
    }
    if (text(root, "term", "$").toLowerCase() !== `${term[2]} ${term[1]}`) {
      return { ok: false, reason: "wrong-term", message: `$.term: does not match ${input.termId}.` };
    }
    const sourceObservedAt = text(root, "updated_at", "$");
    if (!isInstant(sourceObservedAt, true)) fail("$.updated_at", "expected an ISO timestamp with a time zone");
    const sourceNote = text(root, "note", "$", 2000);
    const entries = Object.entries(object(root.courses, "$.courses"))
      .filter(([code]) => /^[A-Z]{3,4} \d{3,4}[A-Z]?$/.test(code))
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    const coverageProblem = checkCoverage(root, entries);
    if (coverageProblem) return { ok: false, reason: "partial", message: coverageProblem };
    const courses = entries.map(([code, value]) => parseCourse(value, `$.courses[${JSON.stringify(code)}]`, input.termId, code));
    const sections = courses.flatMap(course => course.availability === "sections" ? course.sections : []);
    const components = sections.flatMap(section => section.components);
    const contentSha256 = sha256(canonicalJson(courses));
    return {
      ok: true,
      release: {
        manifest: {
          releaseId: `${input.sourceId}-${input.termId}-${contentSha256.slice(0, 12)}`,
          sourceId: input.sourceId,
          institutionId: input.institutionId,
          termId: input.termId,
          fetchedAt: input.fetchedAt,
          sourceObservedAt,
          sourceNote,
          rawSha256: sha256(input.body),
          contentSha256,
          parserVersion: SECTION_PARSER_VERSION,
          counts: {
            courses: courses.length,
            coursesWithSections: courses.filter(course => course.availability === "sections").length,
            coursesWithNoClasses: courses.filter(course => course.availability === "no-classes").length,
            invalidCourses: courses.filter(course => course.availability === "invalid-data").length,
            sections: sections.length,
            components: components.length,
            meetings: components.reduce((sum, component) => sum + component.meetings.length, 0),
          },
        },
        courses,
      },
    };
  } catch (error) {
    if (!(error instanceof InvalidSourceData)) throw error;
    return { ok: false, reason: "invalid-data", message: error.message };
  }
}

type Row = Record<string, unknown>;
class InvalidSourceData extends Error {}

function fail(path: string, message: string): never {
  throw new InvalidSourceData(`${path}: ${message}`);
}

function object(value: unknown, path: string): Row {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(path, "expected an object");
  // SAFETY: null and arrays are excluded; each property is still unknown until parsed.
  return value as Row;
}

function text(row: Row, key: string, path: string, max = 500): string {
  const value = row[key];
  if (typeof value !== "string") fail(`${path}.${key}`, "expected a string");
  if (value.length > max) fail(`${path}.${key}`, `exceeds ${max} characters`);
  return value;
}

function list(row: Row, key: string, path: string): Row[] {
  const value = row[key];
  if (!Array.isArray(value)) fail(`${path}.${key}`, "expected an array");
  return value.map((item: unknown, index) => object(item, `${path}.${key}[${index}]`));
}

function count(row: Row, key: string, path: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail(`${path}.${key}`, "expected a nonnegative safe integer");
  return value;
}

function known<T>(value: T, from: string): Fact<T> {
  return { state: "known", value, from };
}

function unknown(raw: string | null, from: string): Fact<never> {
  if (raw !== null && raw.length > 200) fail(from, "unknown text exceeds 200 characters");
  return { state: "unknown", raw, from };
}

function sourceText(row: Row, key: string, path: string, max = 200): string | null {
  return row[key] == null ? null : text(row, key, path, max);
}

const blank = /^(?:|None|TBA)$/i;
const dayCodes = new Map<string, ClassDay>([
  ["M", "Mon"], ["T", "Tue"], ["W", "Wed"], ["R", "Thu"], ["F", "Fri"], ["S", "Sat"], ["U", "Sun"],
]);
const statuses = new Map<string, "open" | "closed" | "waitlist" | "cancelled">([
  ["Open", "open"], ["Closed", "closed"], ["Wait List", "waitlist"], ["Cancelled", "cancelled"], ["Canceled", "cancelled"],
]);

function isCalendarDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

function isInstant(value: string, offset: boolean): boolean {
  const match = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  return match !== null && (offset || match[2] === "Z") && isCalendarDate(match[1]) && Number.isFinite(Date.parse(value));
}

function dateFact(row: Row, path: string): Fact<DateSpan> {
  const raw = sourceText(row, "meeting_dates", path);
  const from = `${path}.meeting_dates`;
  if (raw === null || blank.test(raw.trim())) return unknown(raw, from);
  const match = /^(\d{2})\/(\d{2})\/(\d{4}) - (\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  const start = match && `${match[3]}-${match[1]}-${match[2]}`;
  const end = match && `${match[6]}-${match[4]}-${match[5]}`;
  if (!start || !end || !isCalendarDate(start) || !isCalendarDate(end) || start > end) fail(from, "invalid date range");
  return known({ start, end }, from);
}

function minuteFact(row: Row, key: "start_time" | "end_time", path: string): Fact<number> {
  const raw = sourceText(row, key, path);
  const from = `${path}.${key}`;
  if (raw === null || blank.test(raw.trim())) return unknown(raw, from);
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(raw.trim());
  const hours = Number(match?.[1]);
  const minutes = Number(match?.[2]);
  if (!match || hours < 1 || hours > 12 || minutes > 59) fail(from, "invalid time");
  const total = hours % 12 * 60 + minutes + (match[3].toUpperCase() === "PM" ? 720 : 0);
  // The source's midnight end means the end of this day, not its start.
  return known(key === "end_time" && total === 0 ? 1440 : total, from);
}

function instructorFact(row: Row, path: string): Fact<string> {
  const raw = sourceText(row, "instructor", path, 500);
  const from = `${path}.instructor`;
  const cleaned = raw?.replace(/\bNone\b/g, "").trim().replace(/\s+/g, " ");
  return cleaned && !/^(?:TBA|Staff|Closed)$/i.test(cleaned) ? known(cleaned, from) : unknown(raw, from);
}

function seatFact(row: Row, key: "open_seats" | "total_seats", path: string): Fact<number> {
  return row[key] == null ? unknown(null, `${path}.${key}`) : known(count(row, key, path), `${path}.${key}`);
}

function parseClassRow(row: Row, path: string) {
  const classNumber = text(row, "class_number", path, 100);
  if (!/^\d+$/.test(classNumber)) fail(`${path}.class_number`, "expected digits");
  const startMinutes = minuteFact(row, "start_time", path);
  const endMinutes = minuteFact(row, "end_time", path);
  if (startMinutes.state !== endMinutes.state) fail(path, "time range has one end");
  if (startMinutes.state === "known" && endMinutes.state === "known" && startMinutes.value >= endMinutes.value) {
    fail(path, "time range ends before it starts");
  }
  const rawRoom = sourceText(row, "room", path);
  const room = rawRoom !== null && !/^(?:|None|TBA|No Room|No Facility Assigned)$/i.test(rawRoom.trim())
    ? known(rawRoom.trim(), `${path}.room`) : unknown(rawRoom, `${path}.room`);
  const rawDays = sourceText(row, "days", path);
  const days: Fact<ClassDay>[] = rawDays === null || blank.test(rawDays.trim())
    ? [unknown(rawDays, `${path}.days`)]
    : [...rawDays].map(code => {
      const day = dayCodes.get(code);
      if (!day) fail(`${path}.days`, "unknown day code");
      return known(day, `${path}.days`);
    });
  const dates = dateFact(row, path);
  return {
    classNumber,
    sectionCode: text(row, "section", path, 100),
    instructor: instructorFact(row, path),
    openSeats: seatFact(row, "open_seats", path),
    totalSeats: seatFact(row, "total_seats", path),
    meetings: days.map(day => ({ day, startMinutes, endMinutes, room, dates })),
  };
}

function parseSection(row: Row, path: string, term: string, code: string): SectionRecord {
  const linked = list(row, "linked_sections", path).map((item, index) => parseClassRow(item, `${path}.linked_sections[${index}]`));
  const classNumbers = linked.map(component => component.classNumber);
  if (!classNumbers.length || new Set(classNumbers).size !== classNumbers.length) fail(`${path}.linked_sections`, "expected distinct class numbers");
  const detailed = list(row, "meetings", path).map((item, index) => parseClassRow(item, `${path}.meetings[${index}]`));
  if (detailed.some(line => !classNumbers.includes(line.classNumber))) fail(`${path}.meetings`, "a meeting belongs to a class outside this option");
  const rawStatus = sourceText(row, "status", path);
  const status = rawStatus === null ? undefined : statuses.get(rawStatus);
  const rawSession = sourceText(row, "session", path);
  // Validate option-level fields read by the existing VSB parser, even though components own these facts.
  text(row, "option", path);
  instructorFact(row, path);
  seatFact(row, "open_seats", path);
  seatFact(row, "total_seats", path);
  const optionId = `vsb:${term}:${code}:${[...classNumbers].sort().join("+")}`;
  if (optionId.length > 200) fail(path, "option id exceeds 200 characters");
  return {
    optionId, classNumbers,
    sectionCode: text(row, "section", path, 100),
    status: status === undefined ? unknown(rawStatus, `${path}.status`) : known(status, `${path}.status`),
    session: rawSession !== null && !blank.test(rawSession.trim()) ? known(rawSession.trim(), `${path}.session`) : unknown(rawSession, `${path}.session`),
    dates: dateFact(row, path),
    components: linked.map((component, index) => {
      const lines = detailed.filter(line => line.classNumber === component.classNumber);
      return { ...component, role: index === 0 ? "primary" : "required-linked", meetings: lines.length ? lines.flatMap(line => line.meetings) : component.meetings };
    }),
  };
}

function parseCourse(value: unknown, path: string, term: string, code: string): CourseRecord {
  try {
    const row = object(value, path);
    if (row.status !== "ok" && row.status !== "no_classes") fail(`${path}.status`, "expected ok or no_classes");
    const sections = list(row, "sections", path).map((section, index) => parseSection(section, `${path}.sections[${index}]`, term, code));
    if (new Set(sections.map(section => section.optionId)).size !== sections.length) fail(`${path}.sections`, "two options share one class-number set");
    if (row.status === "no_classes" && sections.length) fail(path, "no_classes contradicts nonempty sections");
    return sections.length ? { courseCode: code, availability: "sections", sections } : { courseCode: code, availability: "no-classes" };
  } catch (error) {
    if (!(error instanceof InvalidSourceData)) throw error;
    return { courseCode: code, availability: "invalid-data", problem: error.message };
  }
}

function checkCoverage(root: Row, entries: [string, unknown][]): string | null {
  if (!entries.length) return "$.courses: no course entries.";
  const coverage = object(root.coverage, "$.coverage");
  const catalog = count(coverage, "catalog_courses", "$.coverage");
  const completed = count(coverage, "completed_courses", "$.coverage");
  const withOptions = count(coverage, "courses_with_options", "$.coverage");
  // Count raw entries, not parsed successes: malformed courses still become explicit invalid-data records.
  const actualWithOptions = entries.filter(([, value]) => {
    return typeof value === "object" && value !== null && "sections" in value && Array.isArray(value.sections) && value.sections.length > 0;
  }).length;
  if (catalog !== completed || completed !== entries.length || withOptions !== actualWithOptions) {
    return `$.coverage: reported catalog=${catalog}, completed=${completed}, with options=${withOptions}; actual courses=${entries.length}, with options=${actualWithOptions}.`;
  }
  if (root.refresh_pending !== undefined) {
    if (!Array.isArray(root.refresh_pending)) fail("$.refresh_pending", "expected an array");
    if (root.refresh_pending.length) return "$.refresh_pending: the source still has pending courses.";
  }
  return null;
}

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
