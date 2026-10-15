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
import { fullSession } from "@/lib/terms";
import type { ScheduleEvent } from "@/lib/types";

/**
 * The term the planner schedules. Spring 2027 is the next registration term
 * as of October 2026, and the only term with a verified vsb file
 * (`supportedTerms` in lib/sections/config.ts).
 */
export const planningTerm = { id: "spring-2027", label: "Spring 2027" } as const;

const spring2027 = fullSession("Spring 2027");

/**
 * First and last day of each term's full session, from the registrar's
 * calendar (lib/terms/terms.ts): the dates of a meeting without its own, and
 * the optimizer's term boundary. It runs to the session's end, finals
 * included, because that is the range vsb gives every "Regular Academic
 * Session" option (8,047 options, all 01/11/2027 - 05/07/2027, checked
 * 2026-10-13).
 */
export const termDates: Record<string, { start: string; end: string }> = {
  "spring-2027": { start: spring2027.classesBegin, end: spring2027.sessionEnd },
};

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

const weekdayIndex: Record<Day, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const DAY_MS = 86_400_000;

type MaybeRange = Pick<DateRange, "start" | "end"> | null | undefined;

/**
 * True when two meetings on `day` meet on a common date: some date with that
 * weekday lies in both of their ranges. A meeting without dates runs the
 * whole planning term. Overlapping ranges are not enough: Jan 11-17 and
 * Jan 17-24 share only a Sunday, so two Monday classes in them never meet.
 */
export function meetTogether(day: Day, a: MaybeRange, b: MaybeRange): boolean {
  const term = termDates[planningTerm.id];
  const x = (a && knownRange(a)) ?? term;
  const y = (b && knownRange(b)) ?? term;
  const start = Date.parse(`${x.start > y.start ? x.start : y.start}T00:00:00Z`);
  const end = Date.parse(`${x.end < y.end ? x.end : y.end}T00:00:00Z`);
  const offset = (weekdayIndex[day] - new Date(start).getUTCDay() + 7) % 7;
  return start + offset * DAY_MS <= end;
}

/**
 * Back-to-back pairs of classes, counted the way the optimizer counts them:
 * on every date a class runs, the classes that day in time order, each
 * consecutive pair once however many dates it recurs on. With a full-term
 * class at 9:00 and first- and second-half classes at 10:00, both 10:00
 * classes follow the 9:00 one, in their own weeks. `start` is minutes.
 */
export function backToBackPairs<T extends { day: Day; start: number; dates?: MaybeRange }>(events: readonly T[]): Array<[T, T]> {
  const term = termDates[planningTerm.id];
  const rangeOf = (event: T) => (event.dates && knownRange(event.dates)) ?? term;
  const ordered = [...events].sort((a, b) => a.start - b.start);
  // Every class on the same dates (the usual case): consecutive classes per day, no calendar walk,
  // on the days that occur in that range (Mar 14, 2027 alone holds no Monday).
  if (new Set(events.map((event) => `${rangeOf(event).start}/${rangeOf(event).end}`)).size <= 1) {
    const shared = events.length > 0 ? rangeOf(events[0]) : term;
    return [...new Set(events.map((event) => event.day))].flatMap((day) => {
      if (!meetTogether(day, shared, shared)) return [];
      const that = ordered.filter((event) => event.day === day);
      return that.slice(1).map((event, i): [T, T] => [that[i], event]);
    });
  }
  const days = (event: T): Set<number> => {
    const range = rangeOf(event);
    const first = Date.parse(`${range.start}T00:00:00Z`);
    const last = Date.parse(`${range.end}T00:00:00Z`);
    const dates = new Set<number>();
    for (let date = first + ((weekdayIndex[event.day] - new Date(first).getUTCDay() + 7) % 7) * DAY_MS; date <= last; date += 7 * DAY_MS) {
      dates.add(date);
    }
    return dates;
  };
  const runs = new Map(events.map((event) => [event, days(event)] as const));
  const pairs = new Map<string, [T, T]>();
  for (const date of new Set(events.flatMap((event) => [...runs.get(event)!]))) {
    for (const day of new Set(events.map((event) => event.day))) {
      const that = ordered.filter((event) => event.day === day && runs.get(event)!.has(date));
      for (let i = 1; i < that.length; i += 1) pairs.set(`${events.indexOf(that[i - 1])}>${events.indexOf(that[i])}`, [that[i - 1], that[i]]);
    }
  }
  return [...pairs.values()];
}

/** Same day, overlapping times, overlapping dates. TBA and async meetings never conflict. */
export function meetingsConflict(a: Meeting, b: Meeting): boolean {
  return (
    isTimed(a) &&
    isTimed(b) &&
    a.day === b.day &&
    a.startMinutes < b.endMinutes &&
    b.startMinutes < a.endMinutes &&
    meetTogether(a.day, a.dates, b.dates)
  );
}

export function optionsConflict(a: Pick<Section, "meetings">, b: Pick<Section, "meetings">): boolean {
  return a.meetings.some((m) => b.meetings.some((n) => meetingsConflict(m, n)));
}

/** Which options the optimizer may suggest; the student can still pick any option by hand. */
export type CandidateFilter = { openSeatsOnly: boolean; otherSites: boolean };

/** UNT's Discovery Park (NTDP), where most CSCE and engineering classes meet. It counts as Denton. */
export const DISCOVERY_PARK_ID = "ntdp";

/**
 * Sites of rooms the campus catalogue does not map. Frisco's codes are the
 * only unmapped codes in the planner's Spring 2027 courses (FRLD and FRISCO,
 * checked against vsb's file on 2026-10-13); anything else unmapped is an
 * unknown site.
 */
const unmappedSites: Record<string, string> = { FRLD: "Frisco", FRISCO: "Frisco" };

/**
 * Unmapped room codes known to be in Denton, so their sections stay in the
 * default suggestions with an unknown walk. Neither has an outline in the
 * campus kit's OSM snapshot (the others found in vsb's file, MGYM, WSC2,
 * PACX and SPHS, were added to the campus registry instead). The evidence
 * is vsb's own records, checked 2026-10-13: MGV P124 holds Military Science
 * (MILS) labs at Denton class times, and MHA 176 and 179 hold Counseling
 * (COUN) classes, all in the Regular Academic Session with no Frisco or
 * other site prefix. MGV is Mean Green Village; the registry's MGVP is a
 * different code (lib/sections/INTEGRATION.md).
 */
const knownDentonCodes = new Set(["MGV", "MHA"]);

/**
 * Where an option meets when that is not UNT's Denton campus: "Frisco",
 * "another UNT site". Null for Denton options, Discovery Park included;
 * online meetings and unassigned rooms do not move an option elsewhere.
 * vsb's schema v2 records have no campus or location field (only `room`),
 * so the room is the only evidence: an unmapped room counts as another site
 * unless its code is a known Denton code. Synthetic samples have no real site, so they are never elsewhere.
 */
export function otherSiteOf(section: Section): string | null {
  if (section.term === null) return null;
  for (const meeting of section.meetings) {
    if (meeting.kind === "building" && meeting.offCampus && meeting.buildingId !== DISCOVERY_PARK_ID) return meeting.buildingName;
    if (meeting.kind === "unknown" && !knownDentonCodes.has(meeting.buildingCode ?? "")) {
      return unmappedSites[meeting.buildingCode ?? ""] ?? "another UNT site";
    }
  }
  return null;
}

/** Open per INTEGRATION.md: not closed or wait-listed, and every component with known seats has one open. */
export function hasOpenSeats(section: Pick<Section, "status" | "components">): boolean {
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
