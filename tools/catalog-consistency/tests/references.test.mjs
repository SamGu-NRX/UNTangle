import { test } from "node:test";
import assert from "node:assert/strict";
import { audit, baseFixture } from "./helpers.mjs";
import { buildSourceCorpusCodes } from "../audit.mjs";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("clean control fixture yields zero unresolved references", () => {
  const findings = audit(baseFixture());
  assert.equal(findings.references.sectionToCourse.unresolved, 0);
  assert.equal(findings.references.meetingToBuilding.unresolved, 0);
  assert.equal(findings.references.courseStatusToCourse.unresolved, 0);
  assert.equal(findings.references.majorCoreToCourse.unresolved, 0);
  assert.equal(findings.violations.unknownReferences, 0);
});

test("section courseCode pointing outside courses is an unknown reference", () => {
  const fixture = baseFixture();
  fixture.sections[0].courseCode = "GHOST 9999";
  const findings = audit(fixture);
  assert.equal(findings.references.sectionToCourse.unresolved, 1);
  assert.deepEqual(findings.references.sectionToCourse.examples[0], {
    sectionId: "anth-1010-001",
    courseCode: "GHOST 9999",
  });
  assert.equal(findings.violations.unknownReferences, 1);
});

test("meeting buildingId pointing outside buildings is an unknown reference", () => {
  const fixture = baseFixture();
  fixture.sections[0].meetings[0].buildingId = "bld-ghost";
  const findings = audit(fixture);
  assert.equal(findings.references.meetingToBuilding.unresolved, 1);
  assert.equal(findings.violations.unknownReferences, 1);
});

test("meetings without buildingId are not counted as unresolved building references", () => {
  const fixture = baseFixture();
  const findings = audit(fixture);
  // 3 meetings total; section 2's second has no buildingId: checked=2
  assert.equal(findings.references.meetingToBuilding.checked, 2);
  assert.equal(findings.references.meetingToBuilding.unresolved, 0);
});

test("courseStatuses key pointing outside courses is an unknown reference", () => {
  const fixture = baseFixture();
  fixture.courseStatuses["GHOST 9999"] = "notTaken";
  const findings = audit(fixture);
  assert.equal(findings.references.courseStatusToCourse.unresolved, 1);
  assert.equal(findings.violations.unknownReferences, 1);
});

test("major coreCourseCode pointing outside courses is an unknown reference with annotated equivalent evidence", () => {
  const fixture = baseFixture();
  fixture.majors[0].coreCourseCodes.push("GOVT 2305");
  fixture.courses.push({
    code: "PSCI 2305",
    title: "US Political Behavior and Policy  (GOVT 2305)",
    department: "PSCI",
    creditHours: 3,
    description: "",
    prerequisites: [],
    planned: false,
  });
  const findings = audit(fixture);
  assert.equal(findings.references.majorCoreToCourse.unresolved, 1);
  const example = findings.references.majorCoreToCourse.examples[0];
  assert.equal(example.majorId, "anth");
  assert.equal(example.code, "GOVT 2305");
  assert.deepEqual(example.titleAnnotatedEquivalent, {
    courseCode: "PSCI 2305",
    title: "US Political Behavior and Policy  (GOVT 2305)",
  });
  assert.equal(findings.violations.unknownReferences, 1);
});

test("external prerequisite is counted separately and is NOT an unknown reference", () => {
  const fixture = baseFixture();
  fixture.courses[1].prerequisites.push("MATH 9999"); // not in catalog
  const findings = audit(fixture);
  assert.equal(findings.references.prerequisites.edgesTotal, 2); // 1 internal + 1 external
  assert.equal(findings.references.prerequisites.internalEdges, 1);
  assert.equal(findings.references.prerequisites.external.edges, 1);
  assert.equal(findings.references.prerequisites.external.distinctCodes, 1);
  // corpus unavailable in this fixture: inSourceCorpus is null (unknown), not false
  assert.equal(findings.references.prerequisites.external.notInSourceCorpus.examples[0].inSourceCorpus, null);
  assert.equal(findings.violations.unknownReferences, 0);
});

test("external prerequisite classified against a provided source-corpus map", () => {
  const corpusCodes = new Map([
    ["MATH 9999", ["unt_math_courses.json"]],
  ]);
  const fixture = baseFixture();
  fixture.courses[1].prerequisites.push("MATH 9999");
  const findings = audit(fixture, corpusCodes);
  assert.equal(findings.references.prerequisites.external.inSourceCorpus.codes, 1);
  assert.deepEqual(findings.references.prerequisites.external.inSourceCorpus.examples[0].sourceFiles, ["unt_math_courses.json"]);
  assert.equal(findings.references.prerequisites.external.notInSourceCorpus.codes, 0);
});

test("prerequisite inside the catalog stays internal", () => {
  const findings = audit(baseFixture());
  assert.equal(findings.references.prerequisites.edgesTotal, 1);
  assert.equal(findings.references.prerequisites.internalEdges, 1);
  assert.equal(findings.references.prerequisites.external.edges, 0);
});

test("buildSourceCorpusCodes reads course_number and title annotations from courses/*.json", () => {
  const dir = mkdtempSync(join(tmpdir(), "corpus-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "unt_psci_courses.json"),
    JSON.stringify([
      { course_number: "PSCI2316", title: "US Political Behavior and Policy  (GOVT 2305)" },
      { course_number: "PSCI3310", title: "Plain title" },
    ]),
  );
  const codes = buildSourceCorpusCodes(dir);
  assert.deepEqual([...codes.keys()], ["GOVT 2305", "PSCI 2316", "PSCI 3310"]);
  assert.deepEqual(codes.get("GOVT 2305"), ["unt_psci_courses.json"]);
});

test("buildSourceCorpusCodes returns null when the corpus directory is absent", () => {
  assert.equal(buildSourceCorpusCodes(join(tmpdir(), "no-such-corpus-dir")), null);
});
