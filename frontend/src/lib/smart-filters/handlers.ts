/**
 * The term smart-filters handler: it applies section-fact filters to a term's
 * sections and joins grade facts through the instructor matcher. Sections
 * come from the app's own sections proxy and grade history only from the
 * shared grades-history service, whose limiter and cache bound the per-course
 * reads. Both sources arrive injected, so this module stays network-free and
 * testable without mocks; the route file does the wiring.
 */
import { coursePattern, supportedTerms, termPattern } from "@/lib/sections/config";
import type { CourseHistory, HistoryResult } from "@/lib/grades-history/types";
import type { Day, Section, SectionStatus, Seats } from "@/lib/sections/model";
import type { TermSections } from "@/lib/sections/proxy";
import { sectionFacts } from "./facts";
import { sectionMatchesFilters } from "./filters";
import { joinSectionToHistory } from "./join";
import type { GradeFactsResult, HistoryUnavailableReason, SectionFacts, SmartFilter } from "./model";

/**
 * Distinct courses one request may read grade history for. The shared
 * untgrades limiter paces about twenty upstream calls a minute, so the cap
 * keeps a cold request bounded and leaves limiter budget for other callers;
 * courses beyond it are reported with reason "not-attempted".
 */
export const MAX_COURSE_HISTORY_PER_REQUEST = 6;

const validDays: readonly Day[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const noStore = { "Cache-Control": "no-store" };

/** Parses the filter query parameters; invalid values are a 400, never a guess. */
export function parseFilters(params: URLSearchParams): { filters: SmartFilter[] } | { error: string } {
  const filters: SmartFilter[] = [];
  const minSeats = params.get("minSeats");
  if (minSeats !== null) {
    if (!/^\d+$/.test(minSeats)) return { error: "minSeats must be a nonnegative integer" };
    filters.push({ kind: "open-seats", minimum: Number(minSeats) });
  }
  const days = params.get("days");
  if (days !== null && days.trim() !== "") {
    const parsedDays: Day[] = [];
    for (const token of days.split(",")) {
      const day = validDays.find((valid) => valid === token.trim());
      if (!day) return { error: "days must be a comma-separated list drawn from Mon, Tue, Wed, Thu, Fri, Sat, Sun" };
      parsedDays.push(day);
    }
    filters.push({ kind: "meeting-days", days: parsedDays });
  }
  const windowStart = params.get("windowStart");
  const windowEnd = params.get("windowEnd");
  if (windowStart !== null || windowEnd !== null) {
    const startMinutes = parseMinutes(windowStart);
    const endMinutes = parseMinutes(windowEnd);
    if (startMinutes === null || endMinutes === null) {
      return { error: "windowStart and windowEnd are required together, as minutes after midnight from 0 to 1440" };
    }
    if (startMinutes >= endMinutes) return { error: "windowStart must be earlier than windowEnd" };
    filters.push({ kind: "time-window", startMinutes, endMinutes });
  }
  const modality = params.get("modality");
  if (modality !== null) {
    if (modality !== "online" && modality !== "in-person") return { error: "modality must be online or in-person" };
    filters.push({ kind: "modality", modality });
  }
  const campus = params.get("campus");
  if (campus !== null) {
    if (campus !== "denton" && campus !== "off-campus" && campus !== "online") {
      return { error: "campus must be denton, off-campus or online" };
    }
    filters.push({ kind: "campus", campus });
  }
  return { filters };
}

function parseMinutes(value: string | null): number | null {
  if (value === null || !/^\d{1,4}$/.test(value)) return null;
  const parsed = Number(value);
  return parsed <= 1440 ? parsed : null;
}

export type FilteredSection = {
  courseCode: string;
  sectionId: string;
  sectionCode: string;
  status: SectionStatus;
  seats: Seats;
  instructor: string | null;
  sectionFacts: SectionFacts;
  gradeFacts: GradeFactsResult;
};

export type SmartFiltersResponse = {
  term: string;
  sectionsSource: Extract<TermSections, { status: "ok" | "stale" }>;
  filters: SmartFilter[];
  courseHistory: { total: number; attempted: number };
  results: FilteredSection[];
};

type CourseHistorySource = (subject: string, number: string) => Promise<HistoryResult<CourseHistory>>;
type TermSectionsSource = (term: string) => Promise<TermSections>;

/** Grade history for one course, as the handler resolved it. */
type CourseFacts =
  | { kind: "history"; history: CourseHistory | null }
  | { kind: "unavailable"; reason: HistoryUnavailableReason; message: string; retryAfterSeconds?: number };

async function readCourseFacts(courseCode: string, source: CourseHistorySource): Promise<CourseFacts> {
  // The shared pattern validates the shape; the number is not a capture group, so split it out here.
  if (!coursePattern.test(courseCode)) {
    return { kind: "unavailable", reason: "invalid-request", message: `course code ${JSON.stringify(courseCode)} did not parse` };
  }
  const [subject, number] = courseCode.split(" ");
  const result = await source(subject ?? "", number ?? "");
  if (result.status === "ok") return { kind: "history", history: result.data };
  if (result.status === "no-history") return { kind: "history", history: null };
  return {
    kind: "unavailable",
    reason: result.error.reason,
    message: result.error.message,
    ...(result.error.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: result.error.retryAfterSeconds }),
  };
}

function gradeFactsFor(section: Section, facts: CourseFacts | undefined): GradeFactsResult {
  if (!facts) return { kind: "unavailable", reason: "not-attempted", message: "grade history was not read for this course in this request" };
  if (facts.kind === "unavailable") {
    return {
      kind: "unavailable",
      reason: facts.reason,
      message: facts.message,
      ...(facts.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: facts.retryAfterSeconds }),
    };
  }
  return joinSectionToHistory(section, facts.history);
}

export function createTermFilterHandler(deps: {
  termSections: TermSectionsSource;
  courseHistory: CourseHistorySource;
  /** Overrides the per-request course cap; tests use this. */
  maxCourseHistory?: number;
}) {
  const maxCourses = deps.maxCourseHistory ?? MAX_COURSE_HISTORY_PER_REQUEST;
  return async (request: Request, term: string): Promise<Response> => {
    if (!termPattern.test(term)) {
      return Response.json({ error: "Expected a term like spring-2027" }, { status: 400, headers: noStore });
    }
    if (!supportedTerms.some((supported) => supported.id === term)) {
      return Response.json({ error: `No section source for ${term}` }, { status: 404, headers: noStore });
    }
    const parsed = parseFilters(new URL(request.url).searchParams);
    if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400, headers: noStore });
    const source = await deps.termSections(term);
    if (source.status === "unavailable") {
      return Response.json(
        { error: `${term} sections are unavailable right now`, diagnostic: source.diagnostic },
        { status: 503, headers: noStore },
      );
    }
    const matched: { courseCode: string; section: Section }[] = [];
    for (const course of source.courses) {
      for (const section of course.sections) {
        if (sectionMatchesFilters(section, parsed.filters)) matched.push({ courseCode: course.courseCode, section });
      }
    }
    // First appearance in the filtered results decides which courses get the
    // request's grade-history budget, so the same request always reads the
    // same courses.
    const courseCodes = [...new Set(matched.map((entry) => entry.courseCode))];
    const notRead: CourseFacts = {
      kind: "unavailable",
      reason: "not-attempted",
      message: `grade history is read for at most ${maxCourses} courses per request; narrow the request with filters`,
    };
    const byCourse = new Map<string, CourseFacts>();
    let attempted = 0;
    for (const courseCode of courseCodes) {
      if (attempted >= maxCourses) {
        byCourse.set(courseCode, notRead);
        continue;
      }
      attempted += 1;
      byCourse.set(courseCode, await readCourseFacts(courseCode, deps.courseHistory));
    }
    const results: FilteredSection[] = matched.map(({ courseCode, section }) => ({
      courseCode,
      sectionId: section.id,
      sectionCode: section.sectionCode,
      status: section.status,
      seats: section.seats,
      instructor: section.instructor.display,
      sectionFacts: sectionFacts(section),
      gradeFacts: gradeFactsFor(section, byCourse.get(courseCode)),
    }));
    const response: SmartFiltersResponse = {
      term,
      sectionsSource: source,
      filters: parsed.filters,
      courseHistory: { total: courseCodes.length, attempted },
      results,
    };
    return Response.json(response, { headers: noStore });
  };
}
