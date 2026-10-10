import { test } from "node:test";
import assert from "node:assert/strict";
import { audit, baseFixture } from "./helpers.mjs";

test("clean control fixture yields zero duplicate findings", () => {
  const findings = audit(baseFixture());
  assert.equal(findings.duplicateIds.courseCodes.count, 0);
  assert.equal(findings.duplicateIds.sectionIds.count, 0);
  assert.equal(findings.duplicateIds.buildingIds.count, 0);
  assert.equal(findings.violations.duplicateIds, 0);
});

test("duplicate course code is detected", () => {
  const fixture = baseFixture();
  fixture.courses.push({ ...fixture.courses[0] });
  const findings = audit(fixture);
  assert.equal(findings.duplicateIds.courseCodes.count, 1);
  assert.equal(findings.duplicateIds.courseCodes.examples[0].key, "ANTH 1010");
  assert.equal(findings.duplicateIds.courseCodes.examples[0].extraOccurrences, 1);
  assert.equal(findings.violations.duplicateIds, 1);
});

test("duplicate section id is detected", () => {
  const fixture = baseFixture();
  fixture.sections.push({ ...fixture.sections[0], meetings: [] });
  const findings = audit(fixture);
  assert.equal(findings.duplicateIds.sectionIds.count, 1);
  assert.equal(findings.duplicateIds.sectionIds.examples[0].key, "anth-1010-001");
  assert.equal(findings.violations.duplicateIds, 1);
});

test("duplicate building id is detected", () => {
  const fixture = baseFixture();
  fixture.buildings.push({ ...fixture.buildings[0], name: "Copy" });
  const findings = audit(fixture);
  assert.equal(findings.duplicateIds.buildingIds.count, 1);
  assert.equal(findings.duplicateIds.buildingIds.examples[0].key, "bld-art");
  assert.equal(findings.violations.duplicateIds, 1);
});

test("triplicated identity reports two extra occurrences", () => {
  const fixture = baseFixture();
  fixture.sections.push({ ...fixture.sections[0], meetings: [] });
  fixture.sections.push({ ...fixture.sections[0], meetings: [] });
  const findings = audit(fixture);
  assert.equal(findings.duplicateIds.sectionIds.count, 1);
  assert.equal(findings.duplicateIds.sectionIds.examples[0].extraOccurrences, 2);
  assert.equal(findings.violations.duplicateIds, 1);
});

test("identity is exact-match: case variants are distinct identities, not duplicates", () => {
  // Documents the rule: no case normalization. A case-variant code is a
  // different identity (if it is a defect, it surfaces as unknown references
  // elsewhere, never silently merged here).
  const fixture = baseFixture();
  fixture.courses.push({ ...fixture.courses[0], code: "anth 1010" });
  const findings = audit(fixture);
  assert.equal(findings.duplicateIds.courseCodes.count, 0);
});
