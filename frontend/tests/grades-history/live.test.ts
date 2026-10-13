import { expect, test } from "bun:test";
import { GradesMcpClient } from "@/lib/grades-history/client";
import { parseCoursePage, parseInstructorPage, parseSearch } from "@/lib/grades-history/parse";

// Exactly three tool calls, no discovery, automatic retries, or pagination fanout.
test.skipIf(process.env.GRADES_LIVE !== "1")("live untgrades.app contract smoke, at most three calls", async () => {
  const client = new GradesMcpClient();
  const search = parseSearch(await client.call("search_grades", { query: "CSCE 1030" }));
  expect(search.courses).toContainEqual({ subject: "CSCE", number: "1030", title: "COMPUTER SCIENCE I" });
  const course = parseCoursePage(await client.call("get_course_grades", { prefix: "CSCE", number: "1030", limit: 2 }));
  expect(course.course.subject).toBe("CSCE");
  expect(course.sections).toHaveLength(2);
  expect(course.total).toBeGreaterThanOrEqual(course.sections.reduce((sum, section) => sum + Object.values(section.counts).reduce((a, b) => a + b, 0), 0));
  const instructor = parseInstructorPage(await client.call("get_instructor_courses", { firstName: "Pradhumna Lal", lastName: "Shrestha", limit: 2 }));
  expect(instructor.instructor.id).toBe('["Pradhumna Lal","Shrestha"]');
  expect(instructor.courses.some((course) => course.subject === "CSCE")).toBe(true);
}, 30_000);
