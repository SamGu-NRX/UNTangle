import { resolveRoom } from "./buildings";
import { coursePattern, diagnose, SchemaError } from "./config";
import type {
  DateRange,
  Day,
  Diagnostic,
  Instructor,
  LinkedComponent,
  Meeting,
  RealCourseSections,
  RealProvenance,
  Seats,
  Section,
  SectionStatus,
} from "./model";

/**
 * A parsed vsb term or subject file. Each course holds its options, or the diagnostic
 * that kept that one course from loading.
 */
export type VsbTerm = {
  term: string;
  provenance: RealProvenance;
  subjects: Set<string>;
  courses: Map<string, Section[] | Diagnostic>;
};

/** A parsed file plus when it was last confirmed against vsb. */
export type VsbFile = {
  data: VsbTerm;
  status: "ok" | "stale";
  checkedAt: string;
  diagnostic: Diagnostic | null;
};

type Row = Record<string, unknown>;

const blank = /^(?:|None|TBA)$/i;
const dayCodes: Record<string, Day> = {
  M: "Mon", T: "Tue", W: "Wed", R: "Thu", F: "Fri", S: "Sat", U: "Sun",
};
const statuses = new Map<string, SectionStatus>([
  ["Open", "open"],
  ["Closed", "closed"],
  ["Wait List", "waitlist"],
  ["Cancelled", "cancelled"],
  ["Canceled", "cancelled"],
]);

function fail(path: string, reason: string): never {
  throw new SchemaError(`vsb schema v2: ${path}: ${reason}`);
}

function object(value: unknown, path: string): Row {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(path, "expected object");
  }
  // SAFETY: null and arrays are excluded; every field stays unknown until read below.
  return value as Row;
}

function text(row: Row, key: string, path: string): string {
  const value = row[key];
  if (typeof value !== "string") fail(`${path}.${key}`, "expected string");
  return value;
}

function list(row: Row, key: string, path: string): Row[] {
  const value = row[key];
  if (!Array.isArray(value)) fail(`${path}.${key}`, "expected array");
  return value.map((item, i) => object(item, `${path}.${key}[${i}]`));
}

function count(row: Row, key: string, path: string): number | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail(`${path}.${key}`, "expected a nonnegative integer or null");
  }
  return value;
}

function seats(row: Row, path: string): Seats {
  return { open: count(row, "open_seats", path), total: count(row, "total_seats", path) };
}

function minutes(row: Row, key: "start_time" | "end_time", path: string): number | null {
  const raw = text(row, key, path).trim();
  if (blank.test(raw)) return null;
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(raw);
  const hours = Number(match?.[1]);
  const mins = Number(match?.[2]);
  if (!match || hours < 1 || hours > 12 || mins > 59) {
    fail(`${path}.${key}`, `invalid time ${JSON.stringify(raw)}`);
  }
  const total = (hours % 12) * 60 + mins + (match[3].toUpperCase() === "PM" ? 720 : 0);
  // A class ending at 12:00AM ends at midnight, the end of its day.
  return key === "end_time" && total === 0 ? 1440 : total;
}

function days(row: Row, path: string): (Day | null)[] {
  const raw = text(row, "days", path);
  if (blank.test(raw.trim())) return [null];
  if (!/^[MTWRFSU]+$/.test(raw)) fail(`${path}.days`, `unknown days ${JSON.stringify(raw)}`);
  return [...raw].map(code => dayCodes[code]);
}

function isCalendarDate(date: string) {
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().startsWith(date);
}

function dates(row: Row, path: string): DateRange {
  const raw = text(row, "meeting_dates", path);
  if (blank.test(raw.trim())) return { raw, start: null, end: null };
  const match = /^(\d{2})\/(\d{2})\/(\d{4}) - (\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  const start = match && `${match[3]}-${match[1]}-${match[2]}`;
  const end = match && `${match[6]}-${match[4]}-${match[5]}`;
  if (!start || !end || !isCalendarDate(start) || !isCalendarDate(end) || start > end) {
    fail(`${path}.meeting_dates`, `invalid dates ${JSON.stringify(raw)}`);
  }
  return { raw, start, end };
}

export function normalizeInstructor(raw: string): Instructor {
  // The feed concatenates comma-paired names and stray None placeholders. Keep the raw
  // text and display each complete Last,First pair as First Last.
  const cleaned = raw.replace(/\bNone\b/g, "").trim().replace(/\s+/g, " ");
  // "Closed" appears in the instructor field of closed ADES 5510 rows.
  if (/^(?:|TBA|Staff|Closed)$/i.test(cleaned)) return { raw, display: null };
  const parts = cleaned.split(",").map(part => part.trim()).filter(Boolean);
  if (parts.length < 2 || parts.length % 2) return { raw, display: cleaned };
  const names: string[] = [];
  for (let i = 0; i < parts.length; i += 2) names.push(`${parts[i + 1]} ${parts[i]}`);
  return { raw, display: names.join("; ") };
}

/** One class row: a linked component or a detailed meeting line. */
function parseClassRow(row: Row, path: string) {
  const classNumber = text(row, "class_number", path);
  if (!/^\d+$/.test(classNumber)) fail(`${path}.class_number`, "expected digits");
  const startMinutes = minutes(row, "start_time", path);
  const endMinutes = minutes(row, "end_time", path);
  if ((startMinutes === null) !== (endMinutes === null)) fail(path, "time range has one end");
  if (startMinutes !== null && endMinutes !== null && startMinutes >= endMinutes) {
    fail(path, "time range ends before it starts");
  }
  const location = resolveRoom(text(row, "room", path));
  const instructor = normalizeInstructor(text(row, "instructor", path));
  const range = dates(row, path);
  const meetings = days(row, path).map((day): Meeting => {
    const isAsync = location.kind === "online" && day === null && startMinutes === null;
    const tba = !isAsync && (day === null || startMinutes === null);
    return {
      ...location, day, startMinutes, endMinutes, dates: range, instructor, async: isAsync, tba,
    };
  });
  const sectionCode = text(row, "section", path);
  return { classNumber, sectionCode, instructor, seats: seats(row, path), meetings };
}

/** Class numbers define enrollment identity; option numbers and labels can change. */
export function vsbSectionId(term: string, courseCode: string, classNumbers: readonly string[]): string {
  return `vsb:${term}:${courseCode}:${[...classNumbers].sort().join("+")}`;
}

function parseSection(row: Row, path: string, term: string, courseCode: string): Section {
  // linked_sections lists every component, primary first.
  const linked = list(row, "linked_sections", path)
    .map((item, i) => parseClassRow(item, `${path}.linked_sections[${i}]`));
  const classNumbers = linked.map(component => component.classNumber);
  if (!classNumbers.length || new Set(classNumbers).size < classNumbers.length) {
    fail(`${path}.linked_sections`, "expected distinct class numbers");
  }
  const detailed = list(row, "meetings", path)
    .map((item, i) => parseClassRow(item, `${path}.meetings[${i}]`));
  if (detailed.some(line => !classNumbers.includes(line.classNumber))) {
    fail(`${path}.meetings`, "a meeting belongs to a class outside this option");
  }
  const components = linked.map((component, i): LinkedComponent => {
    const lines = detailed.filter(line => line.classNumber === component.classNumber);
    return {
      id: `vsb-component:${term}:${courseCode}:${component.classNumber}`,
      classNumber: component.classNumber,
      sectionCode: component.sectionCode,
      role: i === 0 ? "primary" : "required-linked",
      instructor: component.instructor,
      seats: component.seats,
      // A component without detailed lines keeps the schedule on its linked row.
      meetings: lines.length ? lines.flatMap(line => line.meetings) : component.meetings,
    };
  });
  const meetings = components.flatMap(component => component.meetings);
  const rawStatus = text(row, "status", path);
  return {
    id: vsbSectionId(term, courseCode, classNumbers),
    term,
    courseCode,
    sectionCode: text(row, "section", path),
    classNumbers,
    option: text(row, "option", path),
    instructor: normalizeInstructor(text(row, "instructor", path)),
    seats: seats(row, path),
    status: statuses.get(rawStatus) ?? "unknown",
    rawStatus,
    session: { label: text(row, "session", path), dates: dates(row, path) },
    components,
    meetings,
    online: meetings.every(meeting => meeting.kind === "online"),
    async: meetings.every(meeting => meeting.async),
    tba: meetings.some(meeting => meeting.tba),
  };
}

function parseCourse(value: unknown, path: string, term: string, code: string) {
  try {
    const course = object(value, path);
    if (text(course, "course_code", path) !== code) fail(`${path}.course_code`, `does not match ${code}`);
    // An unknown status (a failed scrape, say) must not read as an authoritative empty list.
    if (course.status !== "ok" && course.status !== "no_classes") {
      fail(`${path}.status`, `unknown course status ${JSON.stringify(course.status)}`);
    }
    const sections = list(course, "sections", path)
      .map((row, i) => parseSection(row, `${path}.sections[${i}]`, term, code));
    if ((course.status === "ok") !== (sections.length > 0)) {
      fail(`${path}.status`, "ok requires sections; no_classes requires an empty list");
    }
    if (new Set(sections.map(section => section.id)).size < sections.length) {
      fail(`${path}.sections`, "two options share one class-number set");
    }
    return sections;
  } catch (error) {
    if (!(error instanceof SchemaError)) throw error;
    return diagnose(error);
  }
}

/**
 * Parses a schema v2 file. `schema_version` is the compatibility gate: unknown fields are
 * ignored, and a course that fails to parse becomes a diagnostic without hiding the rest.
 * Given a subject, courses from other subjects are skipped.
 */
export function parseTerm(value: unknown, term: string, subject?: string): VsbTerm {
  const root = object(value, "$");
  if (root.schema_version !== 2) {
    fail("$.schema_version", `unsupported version ${JSON.stringify(root.schema_version)}`);
  }
  const [season, year] = term.split("-");
  if (text(root, "term", "$").toLowerCase() !== `${year} ${season}`) {
    fail("$.term", `does not match ${term}`);
  }
  const updatedAt = text(root, "updated_at", "$");
  if (!/^\d{4}-\d\d-\d\dT/.test(updatedAt) || !Number.isFinite(Date.parse(updatedAt))) {
    fail("$.updated_at", "expected an ISO timestamp");
  }
  const provenance: RealProvenance = {
    kind: "real",
    source: "vsb.untgrades.app",
    updatedAt,
    note: text(root, "note", "$"),
  };
  const subjects = new Set<string>();
  const courses: VsbTerm["courses"] = new Map();
  for (const [code, course] of Object.entries(object(root.courses, "$.courses"))) {
    // Keys that are not course codes could never be requested, so they are skipped.
    const courseSubject = coursePattern.exec(code)?.[1];
    if (!courseSubject || (subject && courseSubject !== subject)) continue;
    subjects.add(courseSubject);
    courses.set(code, parseCourse(course, `$.courses[${JSON.stringify(code)}]`, term, code));
  }
  return { term, provenance, subjects, courses };
}

/** One course's real result, the diagnostic that kept it from loading, or null if absent. */
export function courseResult(
  file: VsbFile,
  courseCode: string,
): RealCourseSections | Diagnostic | null {
  const record = file.data.courses.get(courseCode);
  if (record === undefined) return null;
  if (!Array.isArray(record)) return record;
  return {
    term: file.data.term,
    courseCode,
    status: file.status,
    availability: record.length ? "sections" : "no_classes",
    provenance: file.data.provenance,
    checkedAt: file.checkedAt,
    diagnostic: file.diagnostic,
    sections: record,
  };
}
