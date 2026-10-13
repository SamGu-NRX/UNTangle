import { gradeGpa } from "./normalize";
import { object } from "./client";
import { malformed, GradesError } from "./errors";
import type { GradeCounts, CourseIdentity, GradeSearch, InstructorIdentity } from "./types";

export function text(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) malformed(path, "a nonempty string");
  return value;
}
export function integer(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) malformed(path, "a nonnegative safe integer");
  return value;
}
function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) malformed(path, "an array");
  return value;
}
export function counts(value: unknown, path: string): GradeCounts {
  const record = object(value, path);
  const parsed: GradeCounts = {};
  for (const [grade, count] of Object.entries(record)) {
    if (!grade.trim() || ["__proto__", "constructor", "prototype"].includes(grade)) malformed(`${path}.${grade}`, "a grade label");
    parsed[grade] = integer(count, `${path}.${grade}`);
  }
  for (const required of ["A", "B", "C", "D", "F", "W"]) if (!(required in parsed)) malformed(`${path}.${required}`, "a grade count");
  integer(Object.values(parsed).reduce((sum, n) => sum + n, 0), `${path} total`);
  return parsed;
}
export function instructor(value: unknown, path: string): InstructorIdentity {
  const record = object(value, path);
  const firstName = text(record.firstName, `${path}.firstName`);
  const lastName = text(record.lastName, `${path}.lastName`);
  return { id: JSON.stringify([firstName, lastName]), firstName, lastName, name: `${firstName} ${lastName}` };
}
export function course(value: unknown, path: string): CourseIdentity {
  const record = object(value, path);
  const subject = text(record.prefix, `${path}.prefix`);
  const number = text(record.number, `${path}.number`);
  if (!/^[A-Z]{1,12}$/.test(subject)) malformed(`${path}.prefix`, "1-12 uppercase letters");
  if (!/^[0-9A-Z]{1,12}$/.test(number)) malformed(`${path}.number`, "1-12 uppercase letters or digits");
  return { subject, number, title: text(record.title, `${path}.title`) };
}
export type SourceSection = { sectionNumber: string; instructor: InstructorIdentity; year: string; term: string; counts: GradeCounts };
export type CoursePage = { course: CourseIdentity; totalSections: number; offset: number; nextOffset: number | null; total: number; counts: GradeCounts; gpa: number | null; sections: SourceSection[] };
export type InstructorPage = { instructor: InstructorIdentity; totalCourses: number; offset: number; nextOffset: number | null; courses: CourseIdentity[] };

function pagination(record: Record<string, unknown>, size: number, total: number, path: string) {
  const offset = integer(record.offset, `${path}.offset`);
  const nextOffset = record.nextOffset === null ? null : integer(record.nextOffset, `${path}.nextOffset`);
  if (offset + size > total || (nextOffset === null ? offset + size !== total : size === 0 || nextOffset !== offset + size || nextOffset >= total)) malformed(`${path}.pagination`, "contiguous pages ending at the declared total");
  return { offset, nextOffset };
}
export function parseCoursePage(value: unknown): CoursePage {
  const record = object(value, "course");
  const sections = array(record.sections, "course.sections").map((value, i) => {
    const section = object(value, `sections[${i}]`);
    const year = text(section.year, `sections[${i}].year`);
    if (!/^\d{4}$/.test(year)) malformed(`sections[${i}].year`, "a four-digit year");
    return { sectionNumber: text(section.sectionNumber, `sections[${i}].sectionNumber`), instructor: instructor(section.instructor, `sections[${i}].instructor`), year, term: text(section.term, `sections[${i}].term`), counts: counts(section.grades, `sections[${i}].grades`) };
  });
  const totalSections = integer(record.totalSections, "course.totalSections");
  const aggregate = counts(record.aggregateGrades, "course.aggregateGrades");
  const total = integer(record.totalGrades, "course.totalGrades");
  if (Object.values(aggregate).reduce((sum, n) => sum + n, 0) !== total) malformed("course.totalGrades", "the sum of aggregateGrades");
  if (record.gpa !== null && (typeof record.gpa !== "number" || !Number.isFinite(record.gpa) || record.gpa < 0 || record.gpa > 4)) malformed("course.gpa", "null or a number from 0 to 4");
  if (record.gpa !== gradeGpa(aggregate)) malformed("course.gpa", "the A-F weighted mean rounded to two decimal places");
  return { course: course(record, "course"), totalSections, ...pagination(record, sections.length, totalSections, "course"), total, counts: aggregate, gpa: record.gpa, sections };
}
export function parseInstructorPage(value: unknown): InstructorPage {
  const record = object(value, "instructor");
  const courses = array(record.courses, "instructor.courses").map((value, i) => course(value, `courses[${i}]`));
  const totalCourses = integer(record.totalCourses, "instructor.totalCourses");
  return { instructor: instructor(record, "instructor"), totalCourses, ...pagination(record, courses.length, totalCourses, "instructor"), courses };
}
export function parseSearch(value: unknown): GradeSearch {
  const record = object(value, "search");
  return { courses: array(record.courses, "search.courses").map((value, i) => course(value, `courses[${i}]`)), instructors: array(record.instructors, "search.instructors").map((value, i) => instructor(value, `instructors[${i}]`)) };
}

function input(value: string, label: string, min: number, max: number) {
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max || /[\x00-\x1f\x7f]/.test(trimmed)) throw new GradesError("invalid-request", `${label} must contain ${min}-${max} characters without control characters`);
  return trimmed;
}
export function courseInput(subject: string, number: string) {
  const prefix = input(subject, "subject", 1, 12).toUpperCase();
  const normalizedNumber = input(number, "number", 1, 12).toUpperCase();
  // Course numbers are digits with an optional letter suffix (1030, 1030L); "abcd" must not reach upstream.
  if (!/^[A-Z]+$/.test(prefix) || !/^[0-9]{3,5}[A-Z]?$/.test(normalizedNumber)) throw new GradesError("invalid-request", "subject must contain letters; number must be digits with an optional letter suffix");
  return { prefix, number: normalizedNumber };
}
export function instructorInput(firstName: string, lastName: string) {
  return { firstName: input(firstName, "firstName", 1, 100), lastName: input(lastName, "lastName", 1, 100) };
}
export function searchInput(query: string) { return input(query, "query", 2, 100); }

export function decodeInstructorId(id: string) {
  let value: unknown;
  try { value = JSON.parse(id); } catch { throw new GradesError("invalid-request", "Instructor id must be the JSON name pair returned by search"); }
  if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== "string" || typeof value[1] !== "string") throw new GradesError("invalid-request", "Instructor id must contain exactly two name strings");
  return instructorInput(value[0], value[1]);
}
