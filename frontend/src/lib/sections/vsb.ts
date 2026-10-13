import { resolveRoom } from "./buildings";
import type { DateRange, Day, Instructor, LinkedComponent, Meeting, Provenance, Section, SectionStatus } from "./model";

export class SectionSchemaError extends Error {
  constructor(path: string, reason: string) {
    super(`vsb schema v2: ${path}: ${reason}`);
    this.name = "SectionSchemaError";
  }
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new SectionSchemaError(path, "expected object");
  // SAFETY: the boundary has excluded null and arrays; each property remains
  // unknown and is validated by its field parser below.
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, required: string[], optional: string[], path: string) {
  for (const key of required) if (!(key in value)) throw new SectionSchemaError(`${path}.${key}`, "missing required field");
  for (const key of Object.keys(value)) if (!required.includes(key) && !optional.includes(key)) throw new SectionSchemaError(`${path}.${key}`, "unknown field");
}
function string(value: unknown, path: string): string {
  if (typeof value !== "string") throw new SectionSchemaError(path, "expected string");
  return value;
}
function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new SectionSchemaError(path, "expected array");
  return value;
}
function integer(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new SectionSchemaError(path, "expected nonnegative integer");
  return value;
}
function seats(value: unknown, path: string): number | null {
  return value === null ? null : integer(value, path);
}
function timestamp(value: unknown, path: string): string {
  const text = string(value, path);
  if (!/^\d{4}-\d\d-\d\dT/.test(text) || !Number.isFinite(Date.parse(text))) throw new SectionSchemaError(path, "expected ISO timestamp");
  return text;
}
function classNumber(value: unknown, path: string): string {
  const text = string(value, path);
  if (!/^\d+$/.test(text)) throw new SectionSchemaError(path, "expected numeric class-number string");
  return text;
}
export function normalizeInstructor(raw: string): Instructor {
  // The feed concatenates comma-paired instructors and stray None placeholders.
  // Preserve raw text while displaying each complete Last,First pair separately.
  const text = raw.replace(/\bNone\b/g, "").trim().replace(/\s+/g, " ");
  // Closed appears in the instructor field of closed ADES 5510 source rows.
  if (/^(?:|None|TBA|Staff|Closed)$/i.test(text)) return { raw, display: null };
  const parts = text.split(",").map(part => part.trim()).filter(Boolean);
  if (parts.length < 2 || parts.length % 2) return { raw, display: text };
  const names: string[] = [];
  for (let i = 0; i < parts.length; i += 2) names.push(`${parts[i + 1]} ${parts[i]}`);
  return { raw, display: names.join("; ") };
}
function minutes(value: string, path: string): number | null {
  if (/^(?:|None|TBA)$/i.test(value.trim())) return null;
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(value.trim());
  if (!match || +match[1] < 1 || +match[1] > 12 || +match[2] > 59) throw new SectionSchemaError(path, `invalid time ${JSON.stringify(value)}`);
  return (+match[1] % 12) * 60 + +match[2] + (match[3].toUpperCase() === "PM" ? 720 : 0);
}
const dayCodes: Record<string, Day> = { M: "Mon", T: "Tue", W: "Wed", R: "Thu", F: "Fri", S: "Sat", U: "Sun" };
function days(value: string, path: string): (Day | null)[] {
  if (/^(?:|None|TBA)$/i.test(value.trim())) return [null];
  if (!/^[MTWRFSU]+$/.test(value) || new Set(value).size !== value.length) throw new SectionSchemaError(path, `unknown days ${JSON.stringify(value)}`);
  return [...value].map(code => dayCodes[code]);
}
function dates(raw: string, path: string): DateRange {
  if (/^(?:|None|TBA)$/i.test(raw.trim())) return { raw, start: null, end: null };
  const match = /^(\d{2})\/(\d{2})\/(\d{4}) - (\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  if (!match) throw new SectionSchemaError(path, `invalid meeting dates ${JSON.stringify(raw)}`);
  const start = `${match[3]}-${match[1]}-${match[2]}`;
  const end = `${match[6]}-${match[4]}-${match[5]}`;
  for (const date of [start, end]) {
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new SectionSchemaError(path, `invalid calendar date ${date}`);
  }
  if (start > end) throw new SectionSchemaError(path, "session ends before it starts");
  return { raw, start, end };
}
const meetingKeys = ["days_and_times", "days", "start_time", "end_time", "room", "instructor", "meeting_dates", "section", "class_number"];
type RawMeeting = {
  classNumber: string; sectionCode: string; instructor: Instructor;
  seats: { open: number | null; total: number | null }; meetings: Meeting[];
};
function parseMeeting(value: unknown, path: string, linked: boolean): RawMeeting {
  const row = object(value, path);
  keys(row, linked ? [...meetingKeys, "open_seats", "total_seats"] : meetingKeys, linked ? [] : ["open_seats", "total_seats"], path);
  string(row.days_and_times, `${path}.days_and_times`);
  const startMinutes = minutes(string(row.start_time, `${path}.start_time`), `${path}.start_time`);
  const endMinutes = minutes(string(row.end_time, `${path}.end_time`), `${path}.end_time`);
  if ((startMinutes === null) !== (endMinutes === null) || (startMinutes !== null && endMinutes !== null && startMinutes >= endMinutes)) throw new SectionSchemaError(path, "invalid or incomplete time range");
  const meetingDays = days(string(row.days, `${path}.days`), `${path}.days`);
  const location = resolveRoom(string(row.room, `${path}.room`));
  const instructor = normalizeInstructor(string(row.instructor, `${path}.instructor`));
  const range = dates(string(row.meeting_dates, `${path}.meeting_dates`), `${path}.meeting_dates`);
  return {
    classNumber: classNumber(row.class_number, `${path}.class_number`), sectionCode: string(row.section, `${path}.section`), instructor,
    seats: { open: row.open_seats === undefined ? null : seats(row.open_seats, `${path}.open_seats`), total: row.total_seats === undefined ? null : seats(row.total_seats, `${path}.total_seats`) },
    meetings: meetingDays.map(day => {
      const online = location.kind === "online";
      const isAsync = online && day === null && startMinutes === null;
      return { ...location, day, startMinutes, endMinutes, dates: range, instructor,
        online, async: isAsync, tba: !isAsync && (day === null || startMinutes === null) };
    }),
  };
}
const statusNames = new Map<string, SectionStatus>([["Open", "open"], ["Closed", "closed"], ["Wait List", "waitlist"], ["Cancelled", "cancelled"], ["Canceled", "cancelled"]]);
function parseSection(value: unknown, path: string, term: string, courseCode: string): Section {
  const row = object(value, path);
  keys(row, [...meetingKeys, "open_seats", "total_seats", "class_numbers", "linked_sections", "option", "component", "status", "session", "meetings"], [], path);
  if (row.component !== "Enrollment option") throw new SectionSchemaError(`${path}.component`, "expected Enrollment option");
  const classNumbers = array(row.class_numbers, `${path}.class_numbers`).map((n, i) => classNumber(n, `${path}.class_numbers[${i}]`));
  if (!classNumbers.length || new Set(classNumbers).size !== classNumbers.length) throw new SectionSchemaError(`${path}.class_numbers`, "expected nonempty unique class numbers");
  if (string(row.class_number, `${path}.class_number`) !== classNumbers.join("+")) throw new SectionSchemaError(`${path}.class_number`, "does not match class_numbers order");
  const linked = array(row.linked_sections, `${path}.linked_sections`).map((s, i) => parseMeeting(s, `${path}.linked_sections[${i}]`, true));
  if (linked.length !== classNumbers.length || linked.some((s, i) => s.classNumber !== classNumbers[i])) throw new SectionSchemaError(`${path}.linked_sections`, "expected one component per class_numbers entry, in source order");
  const rawMeetings = array(row.meetings, `${path}.meetings`).map((m, i) => parseMeeting(m, `${path}.meetings[${i}]`, false));
  if (rawMeetings.some(m => !classNumbers.includes(m.classNumber))) throw new SectionSchemaError(`${path}.meetings`, "meeting references a class outside enrollment option");
  const components: LinkedComponent[] = linked.map((component, i) => {
    const meetings = rawMeetings.filter(m => m.classNumber === component.classNumber);
    return { id: `vsb-component:${term}:${courseCode}:${component.classNumber}`, classNumber: component.classNumber,
      sectionCode: component.sectionCode, role: i === 0 ? "primary" : "required-linked", componentType: "unspecified",
      instructor: component.instructor, seats: component.seats,
      // A linked row supplies its schedule when detailed meetings are absent.
      meetings: meetings.length ? meetings.flatMap(m => m.meetings) : component.meetings,
    };
  });
  const rawStatus = string(row.status, `${path}.status`);
  const status = statusNames.get(rawStatus);
  if (!status) throw new SectionSchemaError(`${path}.status`, `unknown status ${JSON.stringify(rawStatus)}`);
  // Validate the summary row too; detailed meetings above are authoritative.
  for (const key of ["days_and_times", "days", "start_time", "end_time", "room"]) string(row[key], `${path}.${key}`);
  days(string(row.days, `${path}.days`), `${path}.days`);
  minutes(string(row.start_time, `${path}.start_time`), `${path}.start_time`);
  minutes(string(row.end_time, `${path}.end_time`), `${path}.end_time`);
  const meetings = components.flatMap(c => c.meetings);
  return {
    // Option numbers and section labels can reorder; class numbers define enrollment identity.
    id: `vsb:${term}:${courseCode}:${[...classNumbers].sort().join("+")}`, term, courseCode,
    sectionCode: string(row.section, `${path}.section`), classNumbers, option: string(row.option, `${path}.option`),
    instructor: normalizeInstructor(string(row.instructor, `${path}.instructor`)),
    seats: { open: seats(row.open_seats, `${path}.open_seats`), total: seats(row.total_seats, `${path}.total_seats`) },
    status, rawStatus, session: { label: string(row.session, `${path}.session`), dates: dates(string(row.meeting_dates, `${path}.meeting_dates`), `${path}.meeting_dates`) },
    components, meetings, online: meetings.every(m => m.online), async: meetings.every(m => m.async), tba: meetings.some(m => m.tba),
  };
}
export type VsbTerm = {
  id: string; label: string; provenance: Extract<Provenance, { kind: "real" }>;
  coverage: { catalogCourses: number; completedCourses: number; coursesWithOptions: number };
  refreshPending: string[];
  courses: Map<string, { status: "ok" | "no_classes"; message: string; fetchedAt: string; sections: Section[] }>;
};
export function parseVsbTerm(value: unknown, termId: string): VsbTerm {
  const row = object(value, "$");
  if (row.schema_version !== 2) throw new SectionSchemaError("$.schema_version", `unsupported version ${JSON.stringify(row.schema_version)}; expected 2`);
  keys(row, ["schema_version", "term", "updated_at", "coverage", "note", "courses", "refresh_pending"], [], "$");
  const label = string(row.term, "$.term");
  const match = /^(spring|summer|fall)-(\d{4})$/.exec(termId);
  if (!match || label.toLowerCase() !== `${match[2]} ${match[1]}`) throw new SectionSchemaError("$.term", `term label does not match ${termId}`);
  const coverage = object(row.coverage, "$.coverage");
  keys(coverage, ["catalog_courses", "completed_courses", "courses_with_options"], [], "$.coverage");
  const courses: VsbTerm["courses"] = new Map();
  for (const [code, value] of Object.entries(object(row.courses, "$.courses"))) {
    const path = `$.courses[${JSON.stringify(code)}]`;
    // The supplied catalogue includes legacy MATH 340 and suffixed MEEN 5940Z.
    if (!/^[A-Z]+ \d{3,4}[A-Z]?$/.test(code)) throw new SectionSchemaError(path, "invalid course code");
    const course = object(value, path);
    keys(course, ["course_code", "status", "message", "section_count", "fetched_at", "sections"], [], path);
    if (course.course_code !== code) throw new SectionSchemaError(`${path}.course_code`, "does not match course key");
    if (course.status !== "ok" && course.status !== "no_classes") throw new SectionSchemaError(`${path}.status`, `unknown course status ${JSON.stringify(course.status)}`);
    const sections = array(course.sections, `${path}.sections`).map((s, i) => parseSection(s, `${path}.sections[${i}]`, termId, code));
    if (integer(course.section_count, `${path}.section_count`) !== sections.length || (course.status === "no_classes" && sections.length > 0) || (course.status === "ok" && sections.length === 0)) throw new SectionSchemaError(path, "section_count/status contradict sections");
    if (new Set(sections.map(s => s.id)).size !== sections.length) throw new SectionSchemaError(`${path}.sections`, "duplicate enrollment option identity");
    courses.set(code, { status: course.status, sections, message: string(course.message, `${path}.message`), fetchedAt: timestamp(course.fetched_at, `${path}.fetched_at`) });
  }
  return { id: termId, label, courses,
    coverage: { catalogCourses: integer(coverage.catalog_courses, "$.coverage.catalog_courses"), completedCourses: integer(coverage.completed_courses, "$.coverage.completed_courses"), coursesWithOptions: integer(coverage.courses_with_options, "$.coverage.courses_with_options") },
    refreshPending: array(row.refresh_pending, "$.refresh_pending").map((s, i) => string(s, `$.refresh_pending[${i}]`)),
    provenance: { kind: "real", source: "vsb.untgrades.app", term: termId, updated_at: timestamp(row.updated_at, "$.updated_at"), note: string(row.note, "$.note") },
  };
}
