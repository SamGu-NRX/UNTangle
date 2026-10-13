/**
 * Real Spring 2027 options for planner tests, from the committed vsb fixture
 * (no network). `courseAs` re-files a fixture course under a planner catalog
 * code, so a plan can hold it: the fixture's courses other than MATH 1680
 * are not in the planner's catalog.
 */
import fixture from "./fixtures/spring-2027.json";
import type { SectionCatalog } from "@/lib/planner-sections";
import type { CourseSections } from "@/lib/sections";
import { sampleResult } from "@/lib/sections/sample";
import { courseResult, parseTerm } from "@/lib/sections/vsb";

export type FixtureInput = typeof fixture;
type FixtureCourse = FixtureInput["courses"][keyof FixtureInput["courses"]];
type FixtureRow = FixtureCourse["sections"][number];

export const checkedAt = "2026-10-13T19:00:00.000Z";

export function fixtureInput(): FixtureInput {
  return structuredClone(fixture);
}

/** Files a copy of fixture course `from` as `to`, with its rows edited. */
export function courseAs(input: FixtureInput, from: keyof FixtureInput["courses"], to: string, edit?: (row: FixtureRow) => void) {
  const course = structuredClone(input.courses[from]) as FixtureCourse;
  course.course_code = to;
  course.sections.forEach((row) => edit?.(row));
  (input.courses as Record<string, FixtureCourse>)[to] = course;
}

/** Every meeting line of a row (linked and detailed) gets these dates. */
export function setDates(row: FixtureRow, dates: string) {
  row.meeting_dates = dates;
  row.linked_sections.forEach((line) => (line.meeting_dates = dates));
  row.meetings.forEach((line) => (line.meeting_dates = dates));
}

/** Gives a row new class numbers, so it is a different option with a different id. */
export function renumber(row: FixtureRow, numbers: string[]) {
  row.class_numbers = numbers;
  row.class_number = numbers.join("+");
  row.linked_sections.forEach((line, i) => {
    const old = line.class_number;
    line.class_number = numbers[i];
    row.meetings.filter((meeting) => meeting.class_number === old).forEach((meeting) => (meeting.class_number = numbers[i]));
  });
}

/**
 * A catalog over a parsed fixture, answering like the proxy: a course the
 * file lacks gets the labeled samples. Codes in `loading` stay loading.
 */
export function fixtureCatalog(input: FixtureInput = fixtureInput(), loading: readonly string[] = []): SectionCatalog {
  const term = parseTerm(input, "spring-2027");
  const file = { data: term, status: "ok" as const, checkedAt, diagnostic: null };
  return (courseCode) => {
    if (loading.includes(courseCode)) return { status: "loading" };
    const result = courseResult(file, courseCode);
    const answer: CourseSections = result && "sections" in result ? result : sampleResult("spring-2027", courseCode, null);
    return { status: "ready", result: answer };
  };
}

export function optionsOf(catalog: SectionCatalog, courseCode: string) {
  const answer = catalog(courseCode);
  if (answer.status !== "ready") throw new Error(`${courseCode} is still loading`);
  return answer.result.sections;
}
