/**
 * What the planner needs from `@/lib/sections`: one course's enrollment
 * options at a time, turned into the optimizer's input, the week's events and
 * the class numbers a student registers with. Follows
 * `lib/sections/INTEGRATION.md`; the rules it states are not repeated here.
 */
import type { OptMeeting, OptSection } from "@/lib/optimizer/types";
import { courses as catalogCourses, sections as seedSections } from "@/lib/seed-data";
import type { CourseSections, Day, Meeting, SampleCourseSections, Section } from "@/lib/sections";
import { sampleResult } from "@/lib/sections/sample";
import type { DateRange } from "@/lib/sections/model";
import type { ScheduleEvent } from "@/lib/types";

/**
 * The term the planner schedules. Spring 2027 is the next registration term
 * as of October 2026, and the only term with a verified vsb file
 * (`supportedTerms` in lib/sections/config.ts).
 */
export const planningTerm = { id: "spring-2027", label: "Spring 2027" } as const;

/** One course's options as the planner knows them right now. */
export type CourseOptions = { status: "loading" } | { status: "ready"; result: CourseSections };

/** Answers synchronously from what has loaded; a course not loaded yet is `loading`. */
export type SectionCatalog = (courseCode: string) => CourseOptions;

const sampleResults = new Map<string, SampleCourseSections>();

function samplesFor(courseCode: string): SampleCourseSections {
  let result = sampleResults.get(courseCode);
  if (!result) {
    result = sampleResult(planningTerm.id, courseCode, null);
    sampleResults.set(courseCode, result);
  }
  return result;
}

/** The bundled synthetic sections, labeled as samples: the fallback, the server's view and the tests' default. */
export const sampleCatalog: SectionCatalog = (courseCode) => ({ status: "ready", result: samplesFor(courseCode) });

/** A synthetic sample by id, whatever the catalog holds now: old plans keep showing theirs, labeled. */
export function sampleOption(optionId: string): Section | undefined {
  const seed = seedSections.find((section) => section.id === optionId);
  return seed ? samplesFor(seed.courseCode).sections.find((section) => section.id === optionId) : undefined;
}

/** The option an id names: among the course's loaded options, or a bundled sample (old plans keep theirs). */
export function findOption(catalog: SectionCatalog, courseCode: string, optionId: string): Section | null {
  const loaded = catalog(courseCode);
  const option = loaded.status === "ready" ? loaded.result.sections.find((entry) => entry.id === optionId) : undefined;
  const sample = option ? undefined : sampleOption(optionId);
  return option ?? (sample?.courseCode === courseCode ? sample : null);
}

/**
 * What a saved option id names. Real ids are `vsb:<term>:<course>:<class
 * numbers joined with +>` (INTEGRATION.md), so a saved id carries its term,
 * provenance and class numbers; anything else is a synthetic sample id with
 * no enrollment identity.
 */
export type SectionRef =
  | { provenance: "real"; optionId: string; term: string; courseCode: string; classNumbers: string[] }
  | { provenance: "sample"; optionId: string };

const realOptionId = /^vsb:([a-z]+-\d{4}):([A-Z]{3,4} \d{3,4}[A-Z]?):(\d+(?:\+\d+)*)$/;

export function sectionRef(optionId: string): SectionRef {
  const match = realOptionId.exec(optionId);
  if (!match) return { provenance: "sample", optionId };
  return { provenance: "real", optionId, term: match[1], courseCode: match[2], classNumbers: match[3].split("+") };
}

/** How a student names an option: vsb's section code ("110 + 111") for a real one, "002" for a sample. */
export function optionLabel(section: Section): string {
  return section.term === null ? sampleNumber(section.id) : section.sectionCode;
}

/** The same name from an id alone, for a saved pick whose option is not loaded or no longer exists. */
export function optionIdLabel(optionId: string): string {
  const ref = sectionRef(optionId);
  return ref.provenance === "real" ? `class ${ref.classNumbers.join(" + ")}` : sampleNumber(optionId);
}

function sampleNumber(optionId: string): string {
  return optionId.split("-").pop() ?? optionId;
}

type TimedMeeting = Meeting & { day: Day; startMinutes: number; endMinutes: number };

/** A meeting with a known day and time: the only kind that goes on the grid or to the optimizer. */
export function isTimed(meeting: Meeting): meeting is TimedMeeting {
  return !meeting.tba && !meeting.async && meeting.day !== null && meeting.startMinutes !== null && meeting.endMinutes !== null;
}

function knownRange(dates: Pick<DateRange, "start" | "end">): { start: string; end: string } | null {
  return dates.start && dates.end ? { start: dates.start, end: dates.end } : null;
}

const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** "Jan 11 – Mar 5" for a date range, or null when the range is unknown. */
export function rangeLabel(dates: Pick<DateRange, "start" | "end"> | null | undefined): string | null {
  if (!dates?.start || !dates.end) return null;
  return `${shortDate.format(new Date(`${dates.start}T00:00:00Z`))} – ${shortDate.format(new Date(`${dates.end}T00:00:00Z`))}`;
}

/** True when two date ranges can meet in the same week; a meeting without dates runs all term. */
export function sharesWeeks(a: Pick<DateRange, "start" | "end">, b: Pick<DateRange, "start" | "end">): boolean {
  const x = knownRange(a);
  const y = knownRange(b);
  return !x || !y || (x.start <= y.end && y.start <= x.end);
}

/** Same day, overlapping times, overlapping dates. TBA and async meetings never conflict. */
export function meetingsConflict(a: Meeting, b: Meeting): boolean {
  return (
    isTimed(a) &&
    isTimed(b) &&
    a.day === b.day &&
    a.startMinutes < b.endMinutes &&
    b.startMinutes < a.endMinutes &&
    sharesWeeks(a.dates, b.dates)
  );
}

export function optionsConflict(a: Pick<Section, "meetings">, b: Pick<Section, "meetings">): boolean {
  return a.meetings.some((m) => b.meetings.some((n) => meetingsConflict(m, n)));
}

/** Which options the optimizer may suggest; the student can still pick any option by hand. */
export type CandidateFilter = { openSeatsOnly: boolean; otherSites: boolean };

/**
 * Sites of rooms the campus catalogue does not map. Frisco's codes are the
 * only unmapped codes in the planner's Spring 2027 courses (FRLD and FRISCO,
 * checked against vsb's file on 2026-10-13); anything else unmapped is an
 * unknown site.
 */
const unmappedSites: Record<string, string> = { FRLD: "Frisco", FRISCO: "Frisco" };

/**
 * Where an option meets when that is not Denton's main campus: "Frisco",
 * "Discovery Park", "another UNT site". Null for main-campus options;
 * online meetings and unassigned rooms do not move an option off campus.
 * Synthetic samples have no real site, so they are never off campus.
 */
export function otherSiteOf(section: Section): string | null {
  if (section.term === null) return null;
  for (const meeting of section.meetings) {
    if (meeting.kind === "building" && meeting.offCampus) return meeting.buildingName;
    if (meeting.kind === "unknown") return unmappedSites[meeting.buildingCode ?? ""] ?? "another UNT site";
  }
  return null;
}

/** Open per INTEGRATION.md: not closed or wait-listed, and every component with known seats has one open. */
export function hasOpenSeats(section: Section): boolean {
  if (section.status === "closed" || section.status === "waitlist" || section.status === "cancelled") return false;
  return section.components.every((component) => component.seats.open === null || component.seats.open > 0);
}

/** Whether the optimizer may suggest this option. */
export function isCandidate(section: Section, filter: CandidateFilter): boolean {
  return (filter.otherSites || otherSiteOf(section) === null) && (!filter.openSeatsOnly || hasOpenSeats(section));
}

// Only the synthetic samples carry instructor ratings; real options have none.
const sampleRatings = new Map(seedSections.map((section) => [section.id, section.rating] as const));

/**
 * The one adapter from an enrollment option to the optimizer's section: every
 * component's timed meetings, with their date ranges and building ids (null
 * stays null, an unknown walk). Returns null for an option with no timed
 * meeting, which has nothing to place on the week.
 */
export function toOptSection(section: Section): OptSection | null {
  const meetings = section.meetings.filter(isTimed).map(
    (meeting): OptMeeting => ({
      day: meeting.day,
      start: meeting.startMinutes,
      end: meeting.endMinutes,
      buildingId: meeting.buildingId,
      dates: knownRange(meeting.dates),
    }),
  );
  if (meetings.length === 0) return null;
  const rating = sampleRatings.get(section.id);
  return {
    id: section.id,
    courseCode: section.courseCode,
    label: optionLabel(section),
    rating: rating !== undefined && Number.isFinite(rating) && rating > 0 ? rating : null,
    meetings,
  };
}

/** Real class numbers of an option, every component, primary first. Samples have none. */
export function classNumbersOf(section: Section): string[] {
  return section.components.flatMap((component) => (component.classNumber ? [component.classNumber] : []));
}

function hhmm(minutes: number): string {
  // A class ending at midnight ends at 24:00, the end of its day.
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

const courseTitles = new Map(catalogCourses.map((course) => [course.code, course.title] as const));

/** The option's timed meetings as the older displays' events (map, print, calendar file, walking). */
export function scheduleEventsOf(section: Section): ScheduleEvent[] {
  return section.meetings.filter(isTimed).map((meeting) => ({
    courseCode: section.courseCode,
    title: courseTitles.get(section.courseCode) ?? section.courseCode,
    sectionId: section.id,
    sectionLabel: optionLabel(section),
    professor: meeting.instructor.display ?? section.instructor.display ?? "Instructor not listed",
    rating: sampleRatings.get(section.id) ?? null,
    location: meeting.room,
    buildingId: meeting.buildingId ?? undefined,
    buildingName: meeting.buildingName,
    day: meeting.day,
    start: hhmm(meeting.startMinutes),
    end: hhmm(meeting.endMinutes),
    dates: knownRange(meeting.dates),
    provenance: section.term === null ? "sample" : "real",
  }));
}

/** Meetings with no place on the grid: TBA, or online with no set time. */
export function untimedMeetings(section: Section): Meeting[] {
  return section.meetings.filter((meeting) => !isTimed(meeting));
}
