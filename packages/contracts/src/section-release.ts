/**
 * A published section release: a manifest and one record per course, built
 * by `buildSectionRelease` in packages/ingest/src/section-release.ts, which
 * documents each field. The contract tests pin these schemas to its types.
 *
 * Every value read from the source is a fact: known, with the JSON path it
 * came from, or unknown, with the text the source gave instead. Strict
 * objects and required keys mean a missing value can only arrive as an
 * explicit unknown.
 */
import { z } from "zod";
import { ClassDaySchema } from "./filters";
import { CourseCodeSchema } from "./ids";
import { SourceIdSchema } from "./sources";

/** A JSON path into the raw response: `$`, then `.name`, `[0]` or `["key"]` steps. */
const jsonPath = z.string().max(300).regex(/^\$(?:\.[a-z_]+|\[\d+\]|\["[^"\\]+"\])+$/, 'A source path looks like $.courses["MATH 1680"].sections[0].status.');

export function factSchema<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("known"), value, from: jsonPath }),
    z.strictObject({ state: z.literal("unknown"), raw: z.string().max(200).nullable(), from: jsonPath }),
  ]);
}

const DateSpanSchema = z
  .strictObject({ start: z.iso.date(), end: z.iso.date() })
  .refine((span) => span.start <= span.end, { message: "A date span ends on or after it starts.", path: ["end"] });
const minute = z.int().min(0).max(24 * 60);
const classNumber = z.string().regex(/^\d+$/, "A class number is digits.");
const sha256 = z.string().regex(/^[0-9a-f]{64}$/, "A hash is 64 lowercase hex digits.");
/**
 * Institution and term ids in the same format as InstitutionIdSchema and
 * TermIdSchema, unbranded, because ingest builds releases without importing
 * this package.
 */
const slug = z.string().max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'An id is lowercase words joined by hyphens, like "spring-2027".');

export const MeetingRecordSchema = z
  .strictObject({
    day: factSchema(ClassDaySchema),
    startMinutes: factSchema(minute),
    endMinutes: factSchema(minute),
    room: factSchema(z.string().min(1).max(200)),
    dates: factSchema(DateSpanSchema),
  })
  // The parser makes a one-ended or inverted time range invalid-data, so a record never holds one.
  .superRefine(({ startMinutes, endMinutes }, ctx) => {
    if (startMinutes.state !== endMinutes.state) {
      ctx.addIssue({ code: "custom", path: ["endMinutes"], message: "A meeting's start and end are both known or both unknown." });
    } else if (startMinutes.state === "known" && endMinutes.state === "known" && endMinutes.value <= startMinutes.value) {
      ctx.addIssue({ code: "custom", path: ["endMinutes"], message: "A meeting ends after it starts." });
    }
  });

export const ComponentRecordSchema = z.strictObject({
  classNumber,
  sectionCode: z.string().max(100),
  role: z.enum(["primary", "required-linked"]),
  instructor: factSchema(z.string().min(1).max(500)),
  openSeats: factSchema(z.int().min(0)),
  totalSeats: factSchema(z.int().min(0)),
  meetings: z.array(MeetingRecordSchema),
});

export const SectionRecordSchema = z
  .strictObject({
    optionId: z.string().min(1).max(200),
    classNumbers: z.array(classNumber).min(1),
    sectionCode: z.string().max(100),
    status: factSchema(z.enum(["open", "closed", "waitlist", "cancelled"])),
    session: factSchema(z.string().min(1).max(200)),
    dates: factSchema(DateSpanSchema),
    components: z.array(ComponentRecordSchema).min(1),
  })
  .superRefine((section, ctx) => {
    const seen = new Set<string>();
    section.classNumbers.forEach((number, index) => {
      if (seen.has(number)) ctx.addIssue({ code: "custom", path: ["classNumbers", index], message: `Class ${number} is listed twice.` });
      seen.add(number);
    });
    // One component per class number, in the same order, primary first.
    const componentNumbers = section.components.map((component) => component.classNumber);
    if (componentNumbers.join("+") !== section.classNumbers.join("+")) {
      ctx.addIssue({ code: "custom", path: ["components"], message: "The components are the option's class numbers, in order." });
    }
    section.components.forEach((component, index) => {
      if (component.role !== (index === 0 ? "primary" : "required-linked")) {
        ctx.addIssue({ code: "custom", path: ["components", index, "role"], message: "The first component is the primary and only the first." });
      }
    });
  });

export const CourseRecordSchema = z.discriminatedUnion("availability", [
  z
    .strictObject({ courseCode: CourseCodeSchema, availability: z.literal("sections"), sections: z.array(SectionRecordSchema).min(1) })
    // One record per enrollment option, as vsb.ts requires: a repeat would overwrite or double-count it downstream.
    .superRefine((course, ctx) => {
      const seen = new Set<string>();
      course.sections.forEach((section, index) => {
        const key = [...section.classNumbers].sort().join("+");
        if (seen.has(key)) ctx.addIssue({ code: "custom", path: ["sections", index, "classNumbers"], message: `Two options share class numbers ${key}.` });
        seen.add(key);
      });
    }),
  z.strictObject({ courseCode: CourseCodeSchema, availability: z.literal("no-classes") }),
  z.strictObject({ courseCode: CourseCodeSchema, availability: z.literal("invalid-data"), problem: z.string().min(1).max(1000) }),
]);

export const ReleaseManifestSchema = z.strictObject({
  releaseId: z.string().min(1).max(200),
  sourceId: SourceIdSchema,
  institutionId: slug,
  termId: slug,
  fetchedAt: z.iso.datetime(),
  sourceObservedAt: z.iso.datetime({ offset: true }),
  sourceNote: z.string().max(2000),
  rawSha256: sha256,
  contentSha256: sha256,
  parserVersion: z.string().min(1).max(64),
  counts: z.strictObject({
    courses: z.int().min(1),
    coursesWithSections: z.int().min(0),
    coursesWithNoClasses: z.int().min(0),
    invalidCourses: z.int().min(0),
    sections: z.int().min(0),
    components: z.int().min(0),
    meetings: z.int().min(0),
  }),
});

export const SectionReleaseSchema = z
  .strictObject({ manifest: ReleaseManifestSchema, courses: z.array(CourseRecordSchema).min(1) })
  .superRefine(({ manifest, courses }, ctx) => {
    const { counts } = manifest;
    for (let index = 1; index < courses.length; index += 1) {
      if (!(courses[index - 1].courseCode < courses[index].courseCode)) {
        ctx.addIssue({ code: "custom", path: ["courses", index, "courseCode"], message: "Courses are sorted by code, each once." });
      }
    }
    const sections = courses.flatMap((course) => (course.availability === "sections" ? course.sections : []));
    const counted = {
      courses: courses.length,
      coursesWithSections: courses.filter((course) => course.availability === "sections").length,
      coursesWithNoClasses: courses.filter((course) => course.availability === "no-classes").length,
      invalidCourses: courses.filter((course) => course.availability === "invalid-data").length,
      sections: sections.length,
      components: sections.reduce((sum, section) => sum + section.components.length, 0),
      meetings: sections.reduce((sum, section) => sum + section.components.reduce((inner, component) => inner + component.meetings.length, 0), 0),
    };
    for (const key of Object.keys(counted) as Array<keyof typeof counted>) {
      if (counts[key] !== counted[key]) {
        ctx.addIssue({ code: "custom", path: ["manifest", "counts", key], message: `The manifest counts ${counts[key]}; the release holds ${counted[key]}.` });
      }
    }
    // An option id is the app's enrollment identity (lib/sections/INTEGRATION.md), so every part of it is checked.
    courses.forEach((course, courseIndex) => {
      if (course.availability !== "sections") return;
      course.sections.forEach((section, sectionIndex) => {
        const expected = `vsb:${manifest.termId}:${course.courseCode}:${[...section.classNumbers].sort().join("+")}`;
        if (section.optionId !== expected) {
          ctx.addIssue({
            code: "custom",
            path: ["courses", courseIndex, "sections", sectionIndex, "optionId"],
            message: `The option id is ${expected}: the release's term, the course and the sorted class numbers.`,
          });
        }
      });
    });
    if (manifest.releaseId !== `${manifest.sourceId}-${manifest.termId}-${manifest.contentSha256.slice(0, 12)}`) {
      ctx.addIssue({ code: "custom", path: ["manifest", "releaseId"], message: "A release id is <sourceId>-<termId>-<first 12 digits of contentSha256>." });
    }
  });

export type SectionRelease = z.output<typeof SectionReleaseSchema>;
