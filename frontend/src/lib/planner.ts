import {
  buildings,
  courses,
  defaultPlannerState,
  majors,
  prerequisiteEdges,
  sections,
} from "@/lib/seed-data";
import {
  buildCampusGeocodeQuery,
  resolveCampusBuilding,
  resolveCampusLocation,
} from "@/lib/campus-locations";
import {
  isValidCourseStatus,
  isValidOptimization,
  isValidWeekDay,
  sanitizeTranscriptRecords,
} from "@/lib/planner-validation";
import { compareAcademicTerms } from "@/lib/term-chronology";
import { defaultWalkingTime } from "@/lib/planner-walking";
import type { WalkingTimeFn } from "@/lib/planner-walking";
import { optimize } from "@/lib/optimizer/optimize";
import { GOAL_WEIGHTS, NO_CONSTRAINTS } from "@/lib/optimizer/presets";
import type { OptCourse, OptimizeRequest, OptSection } from "@/lib/optimizer/types";
import type {
  Course,
  CourseSection,
  CourseStatus,
  MajorId,
  MapStop,
  OptimizationKey,
  PlannerApiPayload,
  PlannerState,
  ScheduleConstraints,
  ScheduleEvent,
  SchedulePreferences,
  SectionMeeting,
  WeekDay,
} from "@/lib/types";

const validMajorIds = new Set<MajorId>(majors.map((m) => m.id));
const catalogCourseCodes = new Set(courses.map((course) => course.code));

const plannerStorageKey = "untangle-planner-state";

function toMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function durationMinutes(start: string, end: string) {
  return toMinutes(end) - toMinutes(start);
}

function getBuilding(buildingId: string | null | undefined) {
  if (!buildingId) {
    return undefined;
  }

  return buildings.find((building) => building.id === buildingId);
}

function meetingsOverlap(a: SectionMeeting, b: SectionMeeting) {
  if (a.day !== b.day) {
    return false;
  }

  return toMinutes(a.start) < toMinutes(b.end) && toMinutes(b.start) < toMinutes(a.end);
}

export function sectionConflicts(section: CourseSection, selectedSections: CourseSection[]) {
  return selectedSections.some((selectedSection) =>
    selectedSection.meetings.some((meeting) =>
      section.meetings.some((candidateMeeting) => meetingsOverlap(meeting, candidateMeeting)),
    ),
  );
}

export function getSectionsForCourse(courseCode: string) {
  return sections.filter((section) => section.courseCode === courseCode);
}

export function getActiveCourseCodes(state: PlannerState) {
  const courseStatuses = {
    ...defaultPlannerState.courseStatuses,
    ...(state.courseStatuses ?? {}),
  };

  return courses
    .filter((course) => courseStatuses[course.code] === "inProgress")
    .map((course) => course.code);
}

/** Catalog sections of the given courses in the optimizer's shape (minutes, credits, labels). */
export function toOptimizerCourses(courseCodes: readonly string[]): OptCourse[] {
  return [...new Set(courseCodes)]
    .map((code) => {
      const course = getCourseByCode(code);
      const courseSections = getSectionsForCourse(code);
      if (!course || courseSections.length === 0) return null;
      return {
        code,
        credits: Number.isFinite(course.creditHours) && course.creditHours >= 0 ? course.creditHours : 0,
        sections: courseSections.map(
          (section): OptSection => ({
            id: section.id,
            courseCode: code,
            label: sectionNumber(section.id),
            rating: Number.isFinite(section.rating) && section.rating > 0 ? section.rating : null,
            meetings: section.meetings.map((meeting) => ({
              day: meeting.day,
              start: toMinutes(meeting.start),
              end: toMinutes(meeting.end),
              buildingId: meeting.buildingId ?? null,
            })),
          }),
        ),
      };
    })
    .filter((course): course is OptCourse => course !== null);
}

/**
 * Node budget for `recommendSections`. It runs inside state normalization,
 * which must give the same answer on every render and every machine, so it
 * is bounded by work done, not by the clock. Most calls fix every course but
 * one and finish in a handful of nodes; this bound only matters when a goal
 * re-plans every course at once (then the best schedule found so far is used).
 */
const RECOMMEND_MAX_NODES = 20_000;

/**
 * One schedule for a goal, keeping `fixedSelections` (locks and existing
 * picks) as they are. Courses without section data are skipped. When the
 * fixed sections clash so that nothing fits, the fixed sections are returned
 * as they are and the clash is left for the page to show.
 */
export function recommendSections(
  option: OptimizationKey,
  courseCodes: string[] = courses.filter((course) => course.planned).map((course) => course.code),
  fixedSelections: Record<string, string> = {},
  walkingTime: WalkingTimeFn = defaultWalkingTime,
) {
  const optimizerCourses = toOptimizerCourses(courseCodes);
  const locks = Object.fromEntries(
    optimizerCourses
      .filter((course) => course.sections.some((section) => section.id === fixedSelections[course.code]))
      .map((course) => [course.code, fixedSelections[course.code]]),
  );
  if (optimizerCourses.length === 0) {
    return {};
  }
  const result = optimize({
    courses: optimizerCourses,
    locks,
    excluded: [],
    constraints: NO_CONSTRAINTS,
    weights: GOAL_WEIGHTS[option],
    walkingTime,
    k: 1,
    maxNodes: RECOMMEND_MAX_NODES,
    timeBudgetMs: Number.POSITIVE_INFINITY,
    explainBudgetMs: 0,
  });
  if (result.schedules.length > 0) {
    return { ...result.schedules[0].byCourse };
  }
  return locks;
}

/** Course codes the optimizer was asked about that have no section data. */
export function coursesWithoutSections(courseCodes: readonly string[]): string[] {
  return courseCodes.filter((code) => getSectionsForCourse(code).length === 0);
}

export const DEFAULT_SCHEDULE_CONSTRAINTS: ScheduleConstraints = {
  earliestStart: null,
  latestEnd: null,
  daysOff: [],
  blocked: [],
  maxCredits: null,
  // On by default: a schedule whose walk does not fit the break is not a schedule.
  walkingBufferMinutes: 0,
  excludedSections: [],
};

export function defaultSchedulePreferences(goal: OptimizationKey): SchedulePreferences {
  return { constraints: DEFAULT_SCHEDULE_CONSTRAINTS, weights: { ...GOAL_WEIGHTS[goal] } };
}

const WEEK_DAYS: readonly WeekDay[] = ["Mon", "Tue", "Wed", "Thu", "Fri"];

function isMinute(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 24 * 60;
}

function isWeight(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 4;
}

/**
 * Stored preferences, or null when the stored value is not a valid
 * preferences object (it is then replaced by defaults, never half-read).
 */
export function parseSchedulePreferences(raw: unknown): SchedulePreferences | null {
  if (!isPlainRecord(raw) || !isPlainRecord(raw.constraints) || !isPlainRecord(raw.weights)) return null;
  const c = raw.constraints;
  const w = raw.weights;
  const weightKeys = ["fewerDays", "compact", "mornings", "evenings", "walking", "rating"] as const;
  if (!weightKeys.every((key) => isWeight(w[key]))) return null;
  if (!(c.earliestStart === null || isMinute(c.earliestStart))) return null;
  if (!(c.latestEnd === null || isMinute(c.latestEnd))) return null;
  if (!Array.isArray(c.daysOff) || !c.daysOff.every((day) => WEEK_DAYS.includes(day as WeekDay))) return null;
  if (!(c.maxCredits === null || (typeof c.maxCredits === "number" && c.maxCredits >= 0 && c.maxCredits <= 40))) return null;
  if (!(c.walkingBufferMinutes === null || (isMinute(c.walkingBufferMinutes) && c.walkingBufferMinutes <= 120))) return null;
  if (!Array.isArray(c.excludedSections) || !c.excludedSections.every((id) => typeof id === "string")) return null;
  if (
    !Array.isArray(c.blocked) ||
    !c.blocked.every(
      (block) =>
        isPlainRecord(block) &&
        typeof block.id === "string" &&
        typeof block.label === "string" &&
        WEEK_DAYS.includes(block.day as WeekDay) &&
        isMinute(block.start) &&
        isMinute(block.end) &&
        (block.end as number) > (block.start as number),
    )
  ) {
    return null;
  }
  return {
    constraints: {
      earliestStart: c.earliestStart as number | null,
      latestEnd: c.latestEnd as number | null,
      daysOff: [...new Set(c.daysOff as WeekDay[])],
      blocked: c.blocked as ScheduleConstraints["blocked"],
      maxCredits: c.maxCredits as number | null,
      walkingBufferMinutes: c.walkingBufferMinutes as number | null,
      excludedSections: [...new Set(c.excludedSections as string[])],
    },
    weights: Object.fromEntries(weightKeys.map((key) => [key, w[key]])) as SchedulePreferences["weights"],
  };
}

/**
 * The optimizer request for a plan. `courseCodes` defaults to the courses
 * marked Taking; a course-suggestion step can pass its own list instead.
 * Locks come from the plan; excluded sections that no longer exist in the
 * catalog are dropped rather than rejected.
 */
export function buildOptimizeRequest(
  state: PlannerState,
  preferences: SchedulePreferences,
  options: { courseCodes?: string[]; walkingTime?: WalkingTimeFn; timeBudgetMs?: number; k?: number } = {},
): OptimizeRequest {
  const optimizerCourses = toOptimizerCourses(options.courseCodes ?? getActiveCourseCodes(state));
  const offered = new Set(optimizerCourses.flatMap((course) => course.sections.map((section) => section.id)));
  const locked = getLockedSelections(state);
  const c = preferences.constraints;
  return {
    courses: optimizerCourses,
    locks: Object.fromEntries(
      optimizerCourses.filter((course) => offered.has(locked[course.code] ?? "")).map((course) => [course.code, locked[course.code]]),
    ),
    excluded: c.excludedSections.filter((id) => offered.has(id)),
    constraints: {
      earliestStart: c.earliestStart,
      latestEnd: c.latestEnd,
      daysOff: c.daysOff,
      blocked: c.blocked,
      maxCredits: c.maxCredits,
      walking: c.walkingBufferMinutes === null ? null : { bufferMinutes: c.walkingBufferMinutes },
    },
    weights: preferences.weights,
    walkingTime: options.walkingTime ?? defaultWalkingTime,
    k: options.k ?? 3,
    timeBudgetMs: options.timeBudgetMs ?? 300,
  };
}

export function normalizePlannerState(state: PlannerState): PlannerState {
  const optimization = isValidOptimization(state.optimization)
    ? state.optimization
    : defaultPlannerState.optimization;
  const activeDay = isValidWeekDay(state.activeDay) ? state.activeDay : defaultPlannerState.activeDay;
  const userCourseStatuses: Record<string, CourseStatus> = {};
  Object.entries(state.courseStatuses ?? {}).forEach(([courseCode, status]) => {
    if (isValidCourseStatus(status) && catalogCourseCodes.has(courseCode)) {
      userCourseStatuses[courseCode] = status;
    }
  });
  // Pick only the known planner fields: a request body may carry arbitrary
  // extra keys (e.g. a spoofed userId or id), and none of them may reach
  // persistence.
  const merged: PlannerState = {
    ...defaultPlannerState,
    lockedSections: {},
    courseStatuses: {
      ...defaultPlannerState.courseStatuses,
      ...userCourseStatuses,
    },
    selectedSections: {
      ...defaultPlannerState.selectedSections,
      ...(state.selectedSections ?? {}),
    },
    transcriptRecords: sanitizeTranscriptRecords(state.transcriptRecords),
    optimization,
    activeDay,
    selectedMajor: state.selectedMajor ?? null,
    updatedAt:
      typeof state.updatedAt === "string" ? state.updatedAt : defaultPlannerState.updatedAt,
  };
  const activeCourseCodes = getActiveCourseCodes(merged);
  const activeCourseCodeSet = new Set(activeCourseCodes);
  const preservedSelections = Object.fromEntries(
    Object.entries(merged.selectedSections).filter(([courseCode, sectionId]) =>
      activeCourseCodeSet.has(courseCode) &&
      sections.some((section) => section.courseCode === courseCode && section.id === sectionId),
    ),
  );
  const recommended = recommendSections(merged.optimization, activeCourseCodes, preservedSelections);
  const selectedMajor =
    merged.selectedMajor && validMajorIds.has(merged.selectedMajor) ? merged.selectedMajor : null;
  // A lock survives only while it names the section actually selected for an
  // active course; anything else (stale ids, dropped courses) is released.
  const rawLocks = isPlainRecord(state.lockedSections) ? state.lockedSections : {};
  const lockedSections = Object.fromEntries(
    Object.entries(rawLocks).filter(
      ([courseCode, sectionId]) => typeof sectionId === "string" && recommended[courseCode] === sectionId,
    ),
  );
  return {
    ...merged,
    selectedMajor,
    selectedSections: recommended,
    lockedSections,
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Locked sections that still match the selection: the fixed input to every optimize. */
export function getLockedSelections(state: PlannerState): Record<string, string> {
  const locks = state.lockedSections ?? {};
  return Object.fromEntries(
    Object.entries(locks).filter(([courseCode, sectionId]) => state.selectedSections[courseCode] === sectionId),
  );
}

/** `{NNN}` in the UI contract: the last dash-separated token of a section id. */
export function sectionNumber(sectionId: string): string {
  return sectionId.split("-").pop() ?? sectionId;
}

export function buildScheduleEvents(state: PlannerState): ScheduleEvent[] {
  const normalized = normalizePlannerState(state);
  const activeCourseCodes = getActiveCourseCodes(normalized);

  return activeCourseCodes.flatMap((courseCode) => {
    const selectedSectionId = normalized.selectedSections[courseCode];
    const selectedSection = sections.find((section) => section.id === selectedSectionId);
    const course = courses.find((courseEntry) => courseEntry.code === courseCode);

    if (!selectedSection || !course) {
      return [];
    }

    return selectedSection.meetings.map((meeting) => ({
      courseCode,
      title: course.title,
      sectionId: selectedSection.id,
      professor: selectedSection.professor,
      rating: selectedSection.rating,
      location: meeting.location,
      buildingId: meeting.buildingId,
      day: meeting.day,
      start: meeting.start,
      end: meeting.end,
    }));
  });
}

export function buildStopsForDay(state: PlannerState, day: WeekDay): MapStop[] {
  return buildScheduleEvents(state)
    .filter((event) => event.day === day)
    .sort((a, b) => toMinutes(a.start) - toMinutes(b.start))
    .map((event) => {
      const auditedBuilding = resolveCampusLocation(event.location, event.buildingId);
      const buildingMetadata = resolveCampusBuilding(event.location, event.buildingId) ?? getBuilding(event.buildingId);

      return {
        courseCode: event.courseCode,
        title: event.title,
        location: event.location,
        buildingId: buildingMetadata?.id ?? event.buildingId,
        buildingName: buildingMetadata?.name ?? event.location,
        shortName: buildingMetadata?.shortName ?? event.location,
        lat: auditedBuilding?.lat,
        lng: auditedBuilding?.lng,
        resolutionStatus: auditedBuilding ? "local" : "unresolved",
        geocodeQuery: buildCampusGeocodeQuery(event.location),
        day,
        start: event.start,
        end: event.end,
      };
    });
}

export function serializePlannerPayload(state: PlannerState): PlannerApiPayload {
  const normalized = normalizePlannerState(state);
  return {
    ...normalized,
    routeStops: {
      Mon: buildStopsForDay(normalized, "Mon"),
      Tue: buildStopsForDay(normalized, "Tue"),
      Wed: buildStopsForDay(normalized, "Wed"),
      Thu: buildStopsForDay(normalized, "Thu"),
      Fri: buildStopsForDay(normalized, "Fri"),
    },
  };
}

export function courseMap() {
  return new Map(courses.map((course) => [course.code, course]));
}

export function readPlannerStateFromSessionStorage() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(plannerStorageKey);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as PlannerState;
    return normalizePlannerState(parsed);
  } catch {
    return null;
  }
}

export function writePlannerStateToSessionStorage(state: PlannerState) {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.setItem(plannerStorageKey, JSON.stringify(normalizePlannerState(state)));
}

export function getInitialPlannerState() {
  return normalizePlannerState(defaultPlannerState);
}

export function getCourseByCode(courseCode: string): Course | undefined {
  return courses.find((course) => course.code === courseCode);
}

export function getBuildingById(buildingId: string | null | undefined) {
  return buildings.find((building) => building.id === buildingId);
}

export function formatTime(value: string) {
  const minutes = toMinutes(value);
  const hours = Math.floor(minutes / 60);
  const suffix = hours >= 12 ? "PM" : "AM";
  const normalizedHour = hours % 12 === 0 ? 12 : hours % 12;
  const normalizedMinutes = minutes % 60;
  return `${normalizedHour}:${`${normalizedMinutes}`.padStart(2, "0")} ${suffix}`;
}

export function summarizeCredits(state: PlannerState) {
  return getActiveCourseCodes(state).reduce((total, courseCode) => {
    const course = getCourseByCode(courseCode);
    return total + (course?.creditHours ?? 0);
  }, 0);
}

export function getUnscheduledActiveCourses(state: PlannerState): Course[] {
  const normalized = normalizePlannerState(state);

  return getActiveCourseCodes(normalized)
    .filter((courseCode) => {
      const selectedSectionId = normalized.selectedSections[courseCode];
      return !sections.some((section) => section.courseCode === courseCode && section.id === selectedSectionId);
    })
    .map((courseCode) => getCourseByCode(courseCode))
    .filter((course): course is Course => Boolean(course));
}

export function summarizeCompletedCourses(state: PlannerState) {
  return Object.values(state.courseStatuses).filter((value) => value === "completed").length;
}

export function summarizeInProgressCourses(state: PlannerState) {
  return Object.values(state.courseStatuses).filter((value) => value === "inProgress").length;
}

export function summarizeNotTakenCourses(state: PlannerState) {
  return Object.values(state.courseStatuses).filter((value) => value === "notTaken").length;
}

export function getDailySpan(events: ScheduleEvent[]) {
  if (events.length === 0) {
    return 0;
  }

  const starts = events.map((event) => toMinutes(event.start));
  const ends = events.map((event) => toMinutes(event.end));
  return Math.max(...ends) - Math.min(...starts);
}

export function getSectionDuration(section: CourseSection) {
  return section.meetings.reduce(
    (total, meeting) => total + durationMinutes(meeting.start, meeting.end),
    0,
  );
}

export function getMajorById(id: MajorId | null | undefined) {
  if (!id) return undefined;
  return majors.find((major) => major.id === id);
}

export function getCoreCoursesForMajor(id: MajorId | null | undefined): Course[] {
  const major = getMajorById(id);
  if (!major) return [];
  return major.coreCourseCodes
    .map((code) => courses.find((course) => course.code === code))
    .filter((course): course is Course => Boolean(course));
}

export function getMissingPrerequisites(
  courseCode: string,
  courseStatuses: Record<string, CourseStatus>,
  transcriptRecords: PlannerState["transcriptRecords"] = [],
): string[] {
  return prerequisiteEdges
    .filter((edge) => edge.courseCode === courseCode)
    .map((edge) => edge.prerequisiteCode)
    .filter((prereqCode) => !doesCourseSatisfyPrerequisite(prereqCode, courseStatuses, transcriptRecords));
}

export function isCourseLocked(state: PlannerState, courseCode: string) {
  return getMissingPrerequisites(courseCode, state.courseStatuses, state.transcriptRecords).length > 0;
}

export function summarizeMajorProgress(state: PlannerState) {
  const coreCourses = getCoreCoursesForMajor(state.selectedMajor);
  const total = coreCourses.length;
  if (total === 0) {
    return { completed: 0, total: 0, pct: 0 };
  }
  const completed = coreCourses.filter(
    (course) => state.courseStatuses[course.code] === "completed",
  ).length;
  return { completed, total, pct: Math.round((completed / total) * 100) };
}

export function doesCourseSatisfyPrerequisite(
  courseCode: string,
  courseStatuses: Record<string, CourseStatus>,
  transcriptRecords: PlannerState["transcriptRecords"] = [],
) {
  if (courseStatuses[courseCode] !== "completed") {
    return false;
  }

  const transcriptEvidence = transcriptRecords.filter(
    (record) => record.code === courseCode && record.appliedStatus === "completed",
  );

  if (transcriptEvidence.length === 0) {
    return true;
  }

  return transcriptEvidence.some((record) => record.prerequisiteSatisfied);
}

export function mergeTranscriptRecords(
  current: PlannerState["transcriptRecords"],
  incoming: PlannerState["transcriptRecords"],
) {
  const byId = new Map<string, PlannerState["transcriptRecords"][number]>();

  [...current, ...incoming].forEach((record) => {
    byId.set(record.id, record);
  });

  return [...byId.values()].sort((a, b) => {
    const codeOrder = a.code.localeCompare(b.code);
    if (codeOrder !== 0) return codeOrder;
    return compareAcademicTerms(a.term, b.term);
  });
}
