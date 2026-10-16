import { describe, expect, expectTypeOf, test } from "bun:test";
import type { z } from "zod";
import type {
  AutoTransaction,
  BlockedTime,
  ConnectedCalendar,
  CoursePlan,
  CourseStatus,
  MajorId,
  OptimizationKey,
  PlannerState,
  PreferenceWeights,
  ScheduleConstraints,
  SchedulePreferences,
  TranscriptCourseRecord,
  WeekDay,
} from "../../../frontend/src/lib/types";
import {
  AcademicRecordBodySchema,
  AutoTransactionSchema,
  BlockedTimeSchema,
  CalendarSchema,
  CourseStatusSchema,
  DocumentSchema,
  MajorIdSchema,
  OptimizationKeySchema,
  PreferenceWeightsSchema,
  MAX_CALENDARS,
  PreferencesBodySchema,
  ScheduleBodySchema,
  ScheduleConstraintsSchema,
  TranscriptCourseRecordSchema,
  VersionBodySchema,
  WeekDaySchema,
  documentBodySchemas,
  type AcademicRecordBody,
  type PreferencesBody,
  type ScheduleBody,
} from "../src/documents";
import { academicRecord, preferences, schedule, version } from "./fixtures";
import { decoded, rejections, without } from "./helpers";

const calendar = {
  id: "cal-work",
  name: "Work",
  sealedUrl: "cf1.AbCdEfGh.aXZpdml2aXZpdg.Y2lwaGVydGV4dA",
  termId: "spring-2027",
  checkedAt: "2026-10-15T12:00:00.000Z",
  busy: [{ start: 900, end: 1080, dates: ["2027-01-12", "2027-01-19"] }],
  allDayDates: ["2027-02-24"],
  countAllDay: false,
};

const bodies = [
  ["academic-record", AcademicRecordBodySchema, academicRecord],
  ["schedule", ScheduleBodySchema, schedule],
  ["preferences", PreferencesBodySchema, preferences],
  ["version", VersionBodySchema, version],
] as const;

describe("document bodies round-trip", () => {
  test.each(bodies)("%s decodes to the value that was sent", (_kind, schema, body) => {
    expect(decoded(schema, body)).toEqual(body);
  });

  test.each(bodies)("%s encodes to the same JSON every time", (_kind, schema, body) => {
    const once = JSON.stringify(decoded(schema, body));
    const twice = JSON.stringify(decoded(schema, JSON.parse(once)));
    expect(twice).toBe(once);
  });

  test("preferences with a connected calendar decode to the value that was sent", () => {
    const body = { ...preferences, calendars: [calendar] };
    expect(decoded(PreferencesBodySchema, body)).toEqual(body);
  });

  test.each(bodies)("%s is the schema documentBodySchemas gives for its kind", (kind, schema) => {
    expect(documentBodySchemas[kind]).toBe(schema);
  });

  test.each(bodies)("a stored %s document round-trips in its envelope", (kind, _schema, body) => {
    const stored = { documentId: `doc-${kind}`, kind, revision: 3, schemaVersion: 1, body };
    expect(decoded(DocumentSchema, stored)).toEqual(stored);
  });
});

describe("document bodies reject what the app could not have written", () => {
  test.each(bodies)("%s with an unknown field", (_kind, schema, body) => {
    expect(rejections(schema, { ...body, addedLater: true })).toEqual([': Unrecognized key: "addedLater"']);
  });

  test.each(bodies)("%s without its institution", (_kind, schema, body) => {
    expect(rejections(schema, without(body, "institutionId"))).toEqual(["institutionId: Invalid input: expected string, received undefined"]);
  });

  test("an institution id that isn't a slug", () => {
    expect(rejections(AcademicRecordBodySchema, { ...academicRecord, institutionId: "UNT" })).toEqual([
      'institutionId: An institution id is lowercase words joined by hyphens, like "unt".',
    ]);
  });

  test("two transcript rows with one id", () => {
    const transcriptRecords = [...academicRecord.transcriptRecords, { ...academicRecord.transcriptRecords[0], grade: "B" }];
    expect(rejections(AcademicRecordBodySchema, { ...academicRecord, transcriptRecords })).toEqual([
      'transcriptRecords: Transcript row id "row-1" appears twice.',
    ]);
  });

  test("a status the planner doesn't have", () => {
    const courseStatuses = { ...academicRecord.courseStatuses, "CSCE 1030": "passed" };
    expect(rejections(AcademicRecordBodySchema, { ...academicRecord, courseStatuses })).toHaveLength(1);
  });

  test("a course code with stray spaces", () => {
    const courseStatuses = { " CSCE 1030": "completed" };
    expect(rejections(AcademicRecordBodySchema, { ...academicRecord, courseStatuses })).toHaveLength(1);
  });

  test("a schedule that picks a section for a course it doesn't plan", () => {
    const selectedSections = { ...schedule.selectedSections, "HIST 2610": "hist-2610-001" };
    expect(rejections(ScheduleBodySchema, { ...schedule, selectedSections })).toEqual([
      "selectedSections.HIST 2610: HIST 2610 has a pick but isn't in courses.",
    ]);
  });

  test("a schedule whose Auto provenance names a course it doesn't plan", () => {
    const autoPlanned = [...schedule.autoPlanned, "HIST 2610"];
    expect(rejections(ScheduleBodySchema, { ...schedule, autoPlanned })).toEqual([
      "autoPlanned: HIST 2610 is marked as added by Auto but isn't in courses.",
    ]);
  });

  test("a schedule whose Auto run changed a completed course, which belongs to the academic record", () => {
    const lastAuto = { ...schedule.lastAuto!, changes: [{ code: "CSCE 1030", from: "completed", to: "notTaken" }] };
    expect(rejections(ScheduleBodySchema, { ...schedule, lastAuto })).toEqual([
      "lastAuto.changes.0: Auto's change to CSCE 1030 isn't between planned and not planned.",
    ]);
  });

  test("preferences whose latest end isn't after the earliest start", () => {
    const constraints = { ...preferences.constraints, earliestStart: 900, latestEnd: 900 };
    expect(rejections(PreferencesBodySchema, { ...preferences, constraints })).toEqual([
      "constraints.latestEnd: The latest end is after the earliest start.",
    ]);
  });

  test("an academic record whose catalog id isn't a slug", () => {
    expect(rejections(AcademicRecordBodySchema, { ...academicRecord, catalogId: "UNT 2026" })).toHaveLength(1);
  });

  test("a schedule that locks a course to an option it hasn't picked", () => {
    const lockedSections = { "MATH 1720": "math-1720-001" };
    expect(rejections(ScheduleBodySchema, { ...schedule, lockedSections })).toEqual([
      "lockedSections.MATH 1720: MATH 1720 is locked to an option it hasn't picked.",
    ]);
  });

  test("a schedule that lists a course twice", () => {
    expect(rejections(ScheduleBodySchema, { ...schedule, courses: [...schedule.courses, "CSCE 1040"] })).toEqual([
      'courses: Course "CSCE 1040" appears twice.',
    ]);
  });

  test("a schedule with an empty name", () => {
    expect(rejections(ScheduleBodySchema, { ...schedule, name: "" })).toHaveLength(1);
  });

  test("a blocked time that ends before it starts", () => {
    const blocked = [{ id: "block-1", label: "Work", day: "Mon", start: 840, end: 720 }];
    const constraints = { ...preferences.constraints, blocked };
    expect(rejections(PreferencesBodySchema, { ...preferences, constraints })).toEqual([
      "constraints.blocked.0.end: A blocked time ends after it starts.",
    ]);
  });

  test("a dated blocked time names real days in order", () => {
    const block = { id: "block-1", label: "Work", day: "Tue", start: 840, end: 1080 };
    const withDates = (dates: unknown) => ({ ...preferences, constraints: { ...preferences.constraints, blocked: [{ ...block, dates }] } });
    expect(rejections(PreferencesBodySchema, withDates([{ start: "2027-01-11", end: "2027-03-05" }]))).toEqual([]);
    expect(rejections(PreferencesBodySchema, withDates(null))).toEqual([]);
    expect(rejections(PreferencesBodySchema, withDates([]))).toEqual([]);
    expect(rejections(PreferencesBodySchema, withDates([{ start: "2027-02-30", end: "2027-03-05" }]))).toEqual([
      "constraints.blocked.0.dates.0.start: A date names a real calendar day.",
    ]);
    expect(rejections(PreferencesBodySchema, withDates([{ start: "2027-03-05", end: "2027-01-11" }]))).toEqual([
      "constraints.blocked.0.dates: A blocked-time date range ends on or after it starts.",
    ]);
  });

  test("two blocked times with one id", () => {
    const blocked = [
      { id: "block-1", label: "Work", day: "Mon", start: 720, end: 840 },
      { id: "block-1", label: "Gym", day: "Wed", start: 420, end: 480 },
    ];
    const constraints = { ...preferences.constraints, blocked };
    expect(rejections(PreferencesBodySchema, { ...preferences, constraints })).toEqual([
      'constraints.blocked: Blocked time id "block-1" appears twice.',
    ]);
  });

  test("a connected calendar holds its sealed address, never the address itself", () => {
    const withUrl = (sealedUrl: string) => ({ ...preferences, calendars: [{ ...calendar, sealedUrl }] });
    expect(rejections(PreferencesBodySchema, withUrl(calendar.sealedUrl))).toEqual([]);
    expect(rejections(PreferencesBodySchema, withUrl("https://calendar.google.com/calendar/ical/me/private-abc/basic.ics"))).toEqual([
      "calendars.0.sealedUrl: A calendar address is stored only sealed.",
    ]);
    expect(rejections(PreferencesBodySchema, { ...preferences, calendars: [{ ...calendar, url: "https://example.com/a.ics" }] })).toEqual([
      'calendars.0: Unrecognized key: "url"',
    ]);
  });

  test("calendar busy dates ascend once, slots differ, and the list is absent rather than empty", () => {
    const busy = (dates: string[]) => ({ ...preferences, calendars: [{ ...calendar, busy: [{ start: 900, end: 1080, dates }] }] });
    expect(rejections(PreferencesBodySchema, busy(["2027-01-19", "2027-01-12"]))).toEqual(["calendars.0.busy.0.dates: A busy time's dates ascend without repeats."]);
    expect(rejections(PreferencesBodySchema, busy(["2027-01-12", "2027-01-12"]))).toEqual(["calendars.0.busy.0.dates: A busy time's dates ascend without repeats."]);
    const twice = { ...preferences, calendars: [{ ...calendar, busy: [calendar.busy[0], calendar.busy[0]] }] };
    expect(rejections(PreferencesBodySchema, twice)).toEqual(['calendars.0.busy: Busy slot "900-1080" appears twice.']);
    expect(rejections(PreferencesBodySchema, { ...preferences, calendars: [] })).toHaveLength(1);
    expect(rejections(PreferencesBodySchema, { ...preferences, calendars: [calendar, calendar] })).toEqual(['calendars: Calendar id "cal-work" appears twice.']);
    const many = Array.from({ length: MAX_CALENDARS + 1 }, (_, i) => ({ ...calendar, id: `cal-${i}` }));
    expect(rejections(PreferencesBodySchema, { ...preferences, calendars: many })).toHaveLength(1);
  });

  test("a weight outside 0 to 4", () => {
    const weights = { ...preferences.weights, compact: 5 };
    expect(rejections(PreferencesBodySchema, { ...preferences, weights })).toEqual([
      "weights.compact: Too big: expected number to be <=4",
    ]);
  });

  test("preferences saved before openSeatsOnly existed", () => {
    const constraints = without(preferences.constraints, "openSeatsOnly");
    expect(rejections(PreferencesBodySchema, { ...preferences, constraints })).toHaveLength(1);
  });

  test("a version whose schedule belongs to another institution", () => {
    const other = { ...version, schedule: { ...schedule, institutionId: "ut-austin" } };
    expect(rejections(VersionBodySchema, other)).toEqual([
      "schedule.institutionId: A version and its schedule belong to the same institution.",
    ]);
  });

  test("an envelope whose body is another kind's", () => {
    const stored = { documentId: "doc-1", kind: "schedule", revision: 1, schemaVersion: 1, body: preferences };
    expect(rejections(DocumentSchema, stored).length).toBeGreaterThan(0);
  });

  test("an envelope at revision 0, which only a document that doesn't exist has", () => {
    const stored = { documentId: "doc-1", kind: "schedule", revision: 0, schemaVersion: 1, body: schedule };
    expect(rejections(DocumentSchema, stored)).toEqual(["revision: Too small: expected number to be >=1"]);
  });
});

// Compile-time checks: typecheck fails when a body and today's planner types drift apart.
describe("bodies keep the planner's types", () => {
  test("shared value types are identical", () => {
    expectTypeOf<z.output<typeof WeekDaySchema>>().toEqualTypeOf<WeekDay>();
    expectTypeOf<z.output<typeof CourseStatusSchema>>().toEqualTypeOf<CourseStatus>();
    expectTypeOf<z.output<typeof OptimizationKeySchema>>().toEqualTypeOf<OptimizationKey>();
    expectTypeOf<z.output<typeof MajorIdSchema>>().toEqualTypeOf<MajorId>();
    expectTypeOf<z.output<typeof TranscriptCourseRecordSchema>>().toEqualTypeOf<TranscriptCourseRecord>();
    expectTypeOf<z.output<typeof AutoTransactionSchema>>().toEqualTypeOf<AutoTransaction>();
    expectTypeOf<z.output<typeof BlockedTimeSchema>>().toEqualTypeOf<BlockedTime>();
    expectTypeOf<z.output<typeof ScheduleConstraintsSchema>>().toEqualTypeOf<ScheduleConstraints>();
    expectTypeOf<z.output<typeof PreferenceWeightsSchema>>().toEqualTypeOf<PreferenceWeights>();
    expectTypeOf<z.output<typeof CalendarSchema>>().toEqualTypeOf<ConnectedCalendar>();
  });

  test("each PlannerState field keeps its type in the document it moved to", () => {
    expectTypeOf<AcademicRecordBody["courseStatuses"]>().toEqualTypeOf<PlannerState["courseStatuses"]>();
    expectTypeOf<AcademicRecordBody["transcriptRecords"]>().toEqualTypeOf<PlannerState["transcriptRecords"]>();
    expectTypeOf<AcademicRecordBody["manualCredit"]>().toEqualTypeOf<CoursePlan["manualCredit"]>();
    expectTypeOf<AcademicRecordBody["major"]>().toEqualTypeOf<PlannerState["selectedMajor"]>();
    expectTypeOf<ScheduleBody["selectedSections"]>().toEqualTypeOf<PlannerState["selectedSections"]>();
    expectTypeOf<ScheduleBody["lockedSections"]>().toEqualTypeOf<NonNullable<PlannerState["lockedSections"]>>();
    expectTypeOf<ScheduleBody["autoPlanned"]>().toEqualTypeOf<CoursePlan["autoPlanned"]>();
    expectTypeOf<ScheduleBody["lastAuto"]>().toEqualTypeOf<CoursePlan["lastAuto"]>();
    expectTypeOf<PreferencesBody["goal"]>().toEqualTypeOf<PlannerState["optimization"]>();
    expectTypeOf<Pick<PreferencesBody, "constraints" | "weights" | "calendars">>().toEqualTypeOf<SchedulePreferences>();
  });
});

describe("Auto's saved run names each course once", () => {
  const run = schedule.lastAuto!;
  test.each([
    ["changes", { changes: [...run.changes, run.changes[0]] }],
    ["autoPlannedBefore", { autoPlannedBefore: [...run.autoPlannedBefore, "CSCE 1030", "CSCE 1030"] }],
    ["needsCheck", { needsCheck: ["CSCE 2110", "CSCE 2110"] }],
  ])("rejects a repeat in %s", (_field, patch) => {
    expect(rejections(AutoTransactionSchema, { ...run, ...patch }).length).toBeGreaterThan(0);
  });
});
