import assert from "node:assert/strict";
import { parseCourseImportText } from "../src/lib/course-import";

const pastedText = parseCourseImportText("Current classes: csce3444, MATH 1710, GOVT-2305.");
assert.deepEqual(
  pastedText.matched.map((course) => course.code),
  ["MATH 1710", "GOVT 2305"],
);
assert.deepEqual(pastedText.unknownCodes, ["CSCE 3444"]);

const csvText = parseCourseImportText("Course,Title\nPHYS 2220,General Physics\nPHYS 2220,General Physics");
assert.deepEqual(
  csvText.matched.map((course) => course.code),
  ["PHYS 2220"],
);
assert.deepEqual(csvText.duplicateCodes, ["PHYS 2220"]);

const htmlText = parseCourseImportText("<tr><td>hist&nbsp;2610</td><td>History</td></tr>");
assert.deepEqual(
  htmlText.matched.map((course) => course.code),
  ["HIST 2610"],
);

const emptyText = parseCourseImportText("No schedule rows here.");
assert.equal(emptyText.totalCodesFound, 0);
assert.deepEqual(emptyText.matched, []);

console.log("course import parser tests passed");
