import { sections as bundledSections } from "./seed-data";
import { gradeStats } from "./generated/course-grade-stats";
import { weekDays } from "./types";
import type { Course, CourseStatus } from "./types";

/**
 * Deep catalog filtering for /courses. Filter state is plain data so it can
 * live in the URL: parseCourseFilters/courseFiltersToParams are inverse (up
 * to invalid values being dropped). Historical GPA comes from the generated
 * grade index (real 2017–2019 UNT data); schedule days/time windows and
 * section ratings come from the bundled sample sections, which UI labels
 * must keep calling out as sample data.
 */

export type CourseSort = "code" | "gpa-desc" | "gpa-asc" | "rating-desc" | "credits-desc";
export type PlannerStatusFilter = "completed" | "inProgress" | "notTaken";
export type GpaBand = "3.5" | "3.0" | "2.5" | "low";
export type SampleRatingBand = "4.5" | "4.0" | "3.5" | "low";

export type FacetKey =
  | "departments"
  | "levels"
  | "credits"
  | "days"
  | "timeWindows"
  | "gpaBand"
  | "sampleRatingBand"
  | "plannerStatus";

export type CourseFilterState = {
  query: string;
  departments: string[];
  levels: string[];
  credits: string[];
  days: string[];
  timeWindows: string[];
  gpaBand: GpaBand | null;
  sampleRatingBand: SampleRatingBand | null;
  plannerStatus: PlannerStatusFilter | null;
  sort: CourseSort;
};

export const COURSE_FILTER_DEFAULTS: CourseFilterState = {
  query: "",
  departments: [],
  levels: [],
  credits: [],
  days: [],
  timeWindows: [],
  gpaBand: null,
  sampleRatingBand: null,
  plannerStatus: null,
  sort: "code",
};

export const SORT_LABELS: Record<CourseSort, string> = {
  code: "Course code (A–Z)",
  "gpa-desc": "Historical GPA (high → low)",
  "gpa-asc": "Historical GPA (low → high)",
  "rating-desc": "Sample rating (high → low)",
  "credits-desc": "Credit hours (high → low)",
};

export const LEVEL_LABELS: Record<string, string> = {
  "1000": "1000-level",
  "2000": "2000-level",
  "3000": "3000-level",
  "4000": "4000-level",
  "5000": "5000-level",
};

export const CREDIT_OPTIONS: Record<string, string> = {
  "1": "1 credit",
  "2": "2 credits",
  "3": "3 credits",
  "4": "4 credits",
};

export const DAY_LABELS: Record<string, string> = Object.fromEntries(
  weekDays.map((day) => [day, day]),
);

export const TIME_WINDOW_LABELS: Record<string, string> = {
  morning: "Morning (before noon)",
  afternoon: "Afternoon (noon–5pm)",
  evening: "Evening (after 5pm)",
};

export const GPA_BANDS: Record<string, string> = {
  "3.5": "3.5 & up",
  "3.0": "3.0 to 3.49",
  "2.5": "2.5 to 2.99",
  low: "below 2.5",
};

export const SAMPLE_RATING_BANDS: Record<string, string> = {
  "4.5": "4.5 & up",
  "4.0": "4.0 to 4.49",
  "3.5": "3.5 to 3.99",
  low: "below 3.5",
};

export const PLANNER_STATUS_LABELS: Record<PlannerStatusFilter, string> = {
  completed: "Completed",
  inProgress: "In progress",
  notTaken: "Not taken",
};

export interface PlannerFilterContext {
  courseStatuses: Record<string, CourseStatus>;
  isLocked: (courseCode: string) => boolean;
}

export type FacetCounts = Record<FacetKey, Record<string, number>>;

const sectionsByCourse = new Map<string, typeof bundledSections>();
for (const section of bundledSections) {
  const list = sectionsByCourse.get(section.courseCode) ?? [];
  list.push(section);
  sectionsByCourse.set(section.courseCode, list);
}

function parseHour(start: string): number | null {
  const m = /^\s*(\d{1,2})\s*:\s*(\d{2})\s*([AaPp][Mm])?\s*$/.exec(start ?? "");
  if (!m) return null;
  let hour = Number(m[1]);
  const suffix = m[3]?.toLowerCase();
  if (suffix === "pm" && hour < 12) hour += 12;
  if (suffix === "am" && hour === 12) hour = 0;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  return hour;
}

function parseRating(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function courseMeetingDays(code: string): string[] {
  const days = new Set<string>();
  for (const section of sectionsByCourse.get(code) ?? []) {
    for (const meeting of section.meetings) days.add(meeting.day);
  }
  return [...days].sort();
}

export function courseTimeWindows(code: string): string[] {
  const windows = new Set<string>();
  for (const section of sectionsByCourse.get(code) ?? []) {
    for (const meeting of section.meetings) {
      const hour = parseHour(meeting.start);
      if (hour === null) continue;
      if (hour < 12) windows.add("morning");
      else if (hour < 17) windows.add("afternoon");
      else windows.add("evening");
    }
  }
  return [...windows];
}

function courseLevelKey(code: string): string | null {
  const num = Number.parseInt(code.split(/\s+/)[1] ?? "", 10);
  if (!Number.isFinite(num)) return null;
  return String(Math.floor(num / 1000) * 1000);
}

/** Historical GPA for a course code, or null when unknown/not graded. */
export function gpaFor(code: string): number | null {
  return gradeStats[code]?.gpa ?? null;
}

/** Average bundled sample-section rating for a course, or null when unrated. */
export function sampleRatingFor(code: string): number | null {
  const ratings: number[] = [];
  for (const section of sectionsByCourse.get(code) ?? []) {
    const value = parseRating(section.rating);
    if (value !== null) ratings.push(value);
  }
  if (ratings.length === 0) return null;
  return Math.round((ratings.reduce((sum, n) => sum + n, 0) / ratings.length) * 10) / 10;
}

function matchesGpaBand(gpa: number, band: GpaBand): boolean {
  if (band === "3.5") return gpa >= 3.5;
  if (band === "3.0") return gpa >= 3 && gpa < 3.5;
  if (band === "2.5") return gpa >= 2.5 && gpa < 3;
  return gpa < 2.5;
}

function matchesRatingBand(rating: number, band: SampleRatingBand): boolean {
  if (band === "4.5") return rating >= 4.5;
  if (band === "4.0") return rating >= 4 && rating < 4.5;
  if (band === "3.5") return rating >= 3.5 && rating < 4;
  return rating < 3.5;
}

function passesExcept(
  course: Course,
  filters: CourseFilterState,
  plannerContext: PlannerFilterContext,
  skip: FacetKey | null,
): boolean {
  const q = filters.query.toLowerCase().trim();
  if (q && !`${course.code} ${course.title} ${course.department}`.toLowerCase().includes(q)) {
    return false;
  }
  if (skip !== "departments" && filters.departments.length > 0) {
    if (!filters.departments.includes(course.department)) return false;
  }
  if (skip !== "levels" && filters.levels.length > 0) {
    const level = courseLevelKey(course.code);
    if (!level || !filters.levels.includes(level)) return false;
  }
  if (skip !== "credits" && filters.credits.length > 0) {
    if (!filters.credits.includes(String(course.creditHours))) return false;
  }
  if (skip !== "days" && filters.days.length > 0) {
    const days = courseMeetingDays(course.code);
    if (!filters.days.some((day) => days.includes(day))) return false;
  }
  if (skip !== "timeWindows" && filters.timeWindows.length > 0) {
    const windows = courseTimeWindows(course.code);
    if (!filters.timeWindows.some((window) => windows.includes(window))) return false;
  }
  if (skip !== "gpaBand" && filters.gpaBand) {
    const gpa = gpaFor(course.code);
    if (gpa === null || !matchesGpaBand(gpa, filters.gpaBand)) return false;
  }
  if (skip !== "sampleRatingBand" && filters.sampleRatingBand) {
    const rating = sampleRatingFor(course.code);
    if (rating === null || !matchesRatingBand(rating, filters.sampleRatingBand)) return false;
  }
  if (skip !== "plannerStatus" && filters.plannerStatus) {
    const status = plannerContext.courseStatuses[course.code] ?? "notTaken";
    if (status !== filters.plannerStatus) return false;
  }
  return true;
}

function sortCourses(courses: Course[], sort: CourseSort): Course[] {
  const sorted = [...courses];
  const byCode = (a: Course, b: Course) => a.code.localeCompare(b.code);
  switch (sort) {
    case "gpa-desc":
      sorted.sort((a, b) => (gpaFor(b.code) ?? -1) - (gpaFor(a.code) ?? -1) || byCode(a, b));
      break;
    case "gpa-asc":
      sorted.sort(
        (a, b) =>
          (gpaFor(a.code) ?? Number.POSITIVE_INFINITY) -
            (gpaFor(b.code) ?? Number.POSITIVE_INFINITY) || byCode(a, b),
      );
      break;
    case "rating-desc":
      sorted.sort(
        (a, b) => (sampleRatingFor(b.code) ?? -1) - (sampleRatingFor(a.code) ?? -1) || byCode(a, b),
      );
      break;
    case "credits-desc":
      sorted.sort((a, b) => b.creditHours - a.creditHours || byCode(a, b));
      break;
    default:
      sorted.sort(byCode);
      break;
  }
  return sorted;
}

export function applyCourseFilters(
  courses: Course[],
  filters: CourseFilterState,
  plannerContext: PlannerFilterContext,
): Course[] {
  return sortCourses(
    courses.filter((course) => passesExcept(course, filters, plannerContext, null)),
    filters.sort,
  );
}

/** Facet counts stay live: each dimension counts courses that pass every
 * other active filter, so numbers reflect the narrowing around them —
 * including the facet you are about to toggle, whose counts show what each
 * option would add. */
export function computeFacetCounts(
  courses: Course[],
  filters: CourseFilterState,
  plannerContext: PlannerFilterContext,
): FacetCounts {
  const counts: FacetCounts = {
    departments: {},
    levels: {},
    credits: {},
    days: {},
    timeWindows: {},
    gpaBand: {},
    sampleRatingBand: {},
    plannerStatus: {},
  };
  const bump = (record: Record<string, number>, key: string) => {
    record[key] = (record[key] ?? 0) + 1;
  };
  for (const facet of Object.keys(counts) as FacetKey[]) {
    for (const course of courses) {
      if (!passesExcept(course, filters, plannerContext, facet)) continue;
      switch (facet) {
        case "departments":
          bump(counts.departments, course.department);
          break;
        case "levels": {
          const level = courseLevelKey(course.code);
          if (level) bump(counts.levels, level);
          break;
        }
        case "credits":
          bump(counts.credits, String(course.creditHours));
          break;
        case "days":
          for (const day of courseMeetingDays(course.code)) bump(counts.days, day);
          break;
        case "timeWindows":
          for (const window of courseTimeWindows(course.code)) bump(counts.timeWindows, window);
          break;
        case "gpaBand": {
          const gpa = gpaFor(course.code);
          if (gpa !== null) {
            for (const band of Object.keys(GPA_BANDS) as GpaBand[]) {
              if (matchesGpaBand(gpa, band)) bump(counts.gpaBand, band);
            }
          }
          break;
        }
        case "sampleRatingBand": {
          const rating = sampleRatingFor(course.code);
          if (rating !== null) {
            for (const band of Object.keys(SAMPLE_RATING_BANDS) as SampleRatingBand[]) {
              if (matchesRatingBand(rating, band)) bump(counts.sampleRatingBand, band);
            }
          }
          break;
        }
        case "plannerStatus": {
          const status = plannerContext.courseStatuses[course.code] ?? "notTaken";
          bump(counts.plannerStatus, status);
          break;
        }
      }
    }
  }
  return counts;
}

export function activeFilterCount(filters: CourseFilterState): number {
  let count = 0;
  if (filters.query.trim()) count += 1;
  count += filters.departments.length;
  count += filters.levels.length;
  count += filters.credits.length;
  count += filters.days.length;
  count += filters.timeWindows.length;
  if (filters.gpaBand) count += 1;
  if (filters.sampleRatingBand) count += 1;
  if (filters.plannerStatus) count += 1;
  if (filters.sort !== "code") count += 1;
  return count;
}

function parseList(value: string | null, valid?: readonly string[]): string[] {
  if (!value) return [];
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!valid) return items;
  return items.filter((item) => valid.includes(item));
}

const CREDIT_VALUES = ["1", "2", "3", "4"] as const;
const WINDOW_KEYS = Object.keys(TIME_WINDOW_LABELS);
const GPA_KEYS = Object.keys(GPA_BANDS);
const RATING_KEYS = Object.keys(SAMPLE_RATING_BANDS);
const STATUS_KEYS: PlannerStatusFilter[] = ["completed", "inProgress", "notTaken"];
const SORT_KEYS = Object.keys(SORT_LABELS);

/** Inverse of courseFiltersToParams; unknown values are dropped so shareable
 * URLs never crash the page. */
export function parseCourseFilters(params: URLSearchParams): CourseFilterState {
  const sort = params.get("sort") as CourseSort | null;
  const gpaBand = params.get("gpa") as GpaBand | null;
  const sampleRatingBand = params.get("rating") as SampleRatingBand | null;
  const plannerStatus = params.get("status") as PlannerStatusFilter | null;
  return {
    query: params.get("q") ?? "",
    departments: parseList(params.get("dept")),
    levels: parseList(params.get("level"), Object.keys(LEVEL_LABELS)),
    credits: parseList(params.get("cr"), CREDIT_VALUES),
    days: parseList(params.get("day"), weekDays),
    timeWindows: parseList(params.get("win"), WINDOW_KEYS),
    gpaBand: gpaBand && GPA_KEYS.includes(gpaBand) ? gpaBand : null,
    sampleRatingBand:
      sampleRatingBand && RATING_KEYS.includes(sampleRatingBand) ? sampleRatingBand : null,
    plannerStatus:
      plannerStatus && STATUS_KEYS.includes(plannerStatus) ? plannerStatus : null,
    sort: sort && SORT_KEYS.includes(sort) ? sort : "code",
  };
}

export function courseFiltersToParams(filters: CourseFilterState): URLSearchParams {
  const params = new URLSearchParams();
  const query = filters.query.trim();
  if (query) params.set("q", query);
  if (filters.departments.length > 0) params.set("dept", filters.departments.join(","));
  if (filters.levels.length > 0) params.set("level", filters.levels.join(","));
  if (filters.credits.length > 0) params.set("cr", filters.credits.join(","));
  if (filters.days.length > 0) params.set("day", filters.days.join(","));
  if (filters.timeWindows.length > 0) params.set("win", filters.timeWindows.join(","));
  if (filters.gpaBand) params.set("gpa", filters.gpaBand);
  if (filters.sampleRatingBand) params.set("rating", filters.sampleRatingBand);
  if (filters.plannerStatus) params.set("status", filters.plannerStatus);
  if (filters.sort !== "code") params.set("sort", filters.sort);
  return params;
}
