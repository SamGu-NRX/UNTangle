import { describe, expect, test } from "bun:test";
import { instructorGpaFor } from "@/lib/instructors/gradeHistory";
import { normalizeCourse } from "@/lib/grades-history/normalize";
import type { CourseHistory, GradeCounts, InstructorIdentity } from "@/lib/grades-history/types";

const ada: InstructorIdentity = { id: "ada", firstName: "Ada", lastName: "Byron", name: "Ada Byron" };
const initial: InstructorIdentity = { id: "j", firstName: "J", lastName: "Smith", name: "J Smith" };
const full: InstructorIdentity = { id: "john", firstName: "John", lastName: "Smith", name: "John Smith" };

const course = { subject: "BIOL", number: "2040", title: "Genetics" };

const source = (instructor: InstructorIdentity, counts: GradeCounts, year: string) => ({
  sectionNumber: "001",
  instructor,
  year,
  term: "Fall",
  counts,
});

/** Three past sections of (3 A + 1 B) each: a pooled gpa of 3.75. */
const strongHistory = (instructor: InstructorIdentity): CourseHistory[] => [
  normalizeCourse(course, [source(instructor, { A: 3, B: 1 }, "2024"), source(instructor, { A: 3, B: 1 }, "2025"), source(instructor, { A: 3, B: 1 }, "2026")]),
];

describe("instructorGpaFor", () => {
  test("a confident match with enough graded sections returns the history's gpa", () => {
    expect(instructorGpaFor("Ada Byron", strongHistory(ada))).toBe(3.75);
  });

  test("an ambiguous field abstains and says nothing", () => {
    // "Smith,John" fits both "John Smith" and "J Smith" at the default
    // threshold, so the matcher abstains and the join must not pick either.
    const histories = [...strongHistory(full), ...strongHistory(initial)];
    expect(instructorGpaFor("Smith,John", histories)).toBeNull();
  });

  test("fewer than three graded sections say nothing", () => {
    // Two graded sections is below the minimum; a withdrawal-only section
    // does not count toward the graded total.
    const thin = normalizeCourse(course, [source(ada, { W: 30 }, "2024"), source(ada, { A: 3, B: 1 }, "2025"), source(ada, { A: 3, B: 1 }, "2026")]);
    expect(instructorGpaFor("Ada Byron", [thin])).toBeNull();
  });

  test("a history with no graded students has no gpa to return", () => {
    const withdrawn = normalizeCourse(course, [source(ada, { W: 30 }, "2024"), source(ada, { W: 25 }, "2025"), source(ada, { W: 28 }, "2026")]);
    expect(withdrawn.gpa).toBeNull();
    expect(instructorGpaFor("Ada Byron", [withdrawn])).toBeNull();
  });

  test("a pooled history mixing instructors attributes its gpa to no one", () => {
    // One CourseHistory whose sections carry two identities: its pooled gpa
    // cannot be quoted for either, so the join abstains.
    const mixed = normalizeCourse(course, [source(ada, { A: 3, B: 1 }, "2024"), source(initial, { A: 3, B: 1 }, "2025"), source(initial, { A: 3, B: 1 }, "2026")]);
    expect(instructorGpaFor("Ada Byron", [mixed])).toBeNull();
  });

  test("no candidates says nothing", () => {
    expect(instructorGpaFor("Ada Byron", [])).toBeNull();
  });
});
