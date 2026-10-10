import { test } from "node:test";
import assert from "node:assert/strict";
import { audit, baseFixture } from "./helpers.mjs";

test("clean control fixture yields zero meeting-bound findings", () => {
  const findings = audit(baseFixture());
  assert.equal(findings.meetingBounds.meetingsChecked, 3);
  assert.equal(findings.meetingBounds.endTimeNotAfterStart.count, 0);
  assert.equal(findings.meetingBounds.malformedTime.count, 0);
  assert.equal(findings.meetingBounds.dayOutsideCommittedVocabulary.count, 0);
  assert.equal(findings.violations.meetingBounds, 0);
});

test("meeting with end before start is contradictory", () => {
  const fixture = baseFixture();
  fixture.sections[0].meetings[0] = { ...fixture.sections[0].meetings[0], start: "18:00", end: "17:00" };
  const findings = audit(fixture);
  assert.equal(findings.meetingBounds.endTimeNotAfterStart.count, 1);
  assert.equal(findings.meetingBounds.endTimeNotAfterStart.examples[0].sectionId, "anth-1010-001");
  assert.equal(findings.violations.meetingBounds, 1);
});

test("meeting with end equal to start is contradictory", () => {
  const fixture = baseFixture();
  fixture.sections[0].meetings[0] = { ...fixture.sections[0].meetings[0], start: "16:00", end: "16:00" };
  const findings = audit(fixture);
  assert.equal(findings.meetingBounds.endTimeNotAfterStart.count, 1);
  assert.equal(findings.violations.meetingBounds, 1);
});

test("malformed time is flagged and not also judged as contradictory bounds", () => {
  const fixture = baseFixture();
  fixture.sections[0].meetings[0] = { ...fixture.sections[0].meetings[0], start: "9:00", end: "16:50" };
  const findings = audit(fixture);
  assert.equal(findings.meetingBounds.malformedTime.count, 1);
  assert.equal(findings.meetingBounds.endTimeNotAfterStart.count, 0);
  assert.equal(findings.violations.meetingBounds, 1);
});

test("day outside the committed weekDays vocabulary is flagged", () => {
  const fixture = baseFixture();
  fixture.sections[0].meetings[0] = { ...fixture.sections[0].meetings[0], day: "Satur" };
  const findings = audit(fixture);
  assert.equal(findings.meetingBounds.dayOutsideCommittedVocabulary.count, 1);
  assert.equal(findings.meetingBounds.dayOutsideCommittedVocabulary.examples[0].day, "Satur");
  assert.equal(findings.violations.meetingBounds, 1);
});

test("every committed vocabulary day passes", () => {
  const fixture = baseFixture();
  fixture.sections[0].meetings = ["Mon", "Tue", "Wed", "Thu", "Fri"].map((day) => ({
    day,
    start: "08:00",
    end: "08:50",
    buildingId: "bld-art",
  }));
  const findings = audit(fixture);
  assert.equal(findings.meetingBounds.dayOutsideCommittedVocabulary.count, 0);
  assert.equal(findings.violations.meetingBounds, 0);
});
