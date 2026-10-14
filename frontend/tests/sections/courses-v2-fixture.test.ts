import { expect, test } from "bun:test";
import raw from "../../../output/playwright/courses-v2/fixtures/vsb-spring-2027.json";
import responses from "../../../output/playwright/courses-v2/fixtures/spring-2027-sections.json";
import { parseTerm } from "../../src/lib/sections/vsb";
import { optionsConflict } from "../../src/lib/planner-sections";

function options(code: string) {
  const result = parseTerm(raw, "spring-2027").courses.get(code);
  if (!Array.isArray(result)) throw new Error(`Recorded fixture did not parse for ${code}`);
  return result;
}

test("recorded sections retain the class identities and Monday overlap used by the journey", () => {
  const math = options("MATH 1720").find((section) => section.sectionCode === "501");
  const cs = options("CSCE 1030").find((section) => section.sectionCode === "400 + 301");
  if (!math || !cs) throw new Error("Recorded fixture must include MATH 1720 §501 and CSCE 1030 §400 + 301");
  expect(math.classNumbers).toEqual(["12733"]);
  expect(math.meetings.map((meeting) => [meeting.day, meeting.startMinutes, meeting.endMinutes])).toEqual([
    ["Mon", 780, 920], ["Wed", 780, 920],
  ]);
  expect(cs.components.map((component) => [component.classNumber, component.role])).toEqual([
    ["2557", "primary"], ["12139", "required-linked"],
  ]);
  expect(optionsConflict(math, cs)).toBe(true);
});

test("the offline HTTP responses preserve the recorded options through the real parser", () => {
  for (const [path, response] of Object.entries(responses.responses)) {
    const [subject, number] = path.split("/").slice(-2);
    expect(response.courseCode).toBe(`${subject} ${number}`);
    expect(response.sections).toEqual(options(response.courseCode));
  }
});
