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
  sanitizeCoursePlan,
  sanitizeTranscriptRecords,
} from "@/lib/planner-validation";
import { compareAcademicTerms } from "@/lib/term-chronology";
import { defaultWalkingTime } from "@/lib/planner-walking";
import type { WalkingTimeFn } from "@/lib/planner-walking";
import type {
  Course,
  CourseSection,
  CourseStatus,
  MajorId,
  MapStop,
  OptimizationKey,
  PlannerApiPayload,
  PlannerState,
  ScheduleEvent,
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

/**
 * Courses in the plan for the planning term: `inProgress` with no current
 * transcript row. `inProgress` with an in-progress transcript row is a
 * course the student is taking this term; it is not scheduled, mapped or
 * counted in the plan's credits.
 */
export function getPlanningTermCourseCodes(state: PlannerState) {
  const courseStatuses = {
    ...defaultPlannerState.courseStatuses,
    ...(state.courseStatuses ?? {}),
  };
  const takingNow = new Set(
    (state.transcriptRecords ?? [])
      .filter((record) => !record.duplicateExcluded && record.appliedStatus === "inProgress")
      .map((record) => record.code),
  );

  return courses
    .filter((course) => courseStatuses[course.code] === "inProgress" && !takingNow.has(course.code))
    .map((course) => course.code);
}

/** @deprecated Same as getPlanningTermCourseCodes; kept so existing callers compile. */
export function getActiveCourseCodes(state: PlannerState) {
  return getPlanningTermCourseCodes(state);
}

/**
 * `unknownLegs` counts walks between back-to-back classes where a building has
 * no walking estimate. It is ranked before `score` (fewer unknown legs wins),
 * because an unknown walk could be any length and must not count as 0.
 */
type ScheduleScore = { unknownLegs: number; score: number };

function scoreSchedule(
  option: OptimizationKey,
  candidateSections: CourseSection[],
  walkingTime: WalkingTimeFn,
): ScheduleScore {
  if (candidateSections.length === 0) {
    return { unknownLegs: 0, score: 0 };
  }

  if (option === "maximizeProfessor") {
    return { unknownLegs: 0, score: candidateSections.reduce((total, section) => total + section.rating * 10, 0) };
  }

  const meetings = candidateSections.flatMap((section) => section.meetings);
  const starts = meetings.map((meeting) => toMinutes(meeting.start));
  const ends = meetings.map((meeting) => toMinutes(meeting.end));
  const byDay = new Map<WeekDay, SectionMeeting[]>();

  meetings.forEach((meeting) => {
    const current = byDay.get(meeting.day) ?? [];
    current.push(meeting);
    byDay.set(meeting.day, current);
  });

  let gapMinutes = 0;
  let walkingSeconds = 0;
  let unknownLegs = 0;
  byDay.forEach((dayMeetings) => {
    dayMeetings.sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
    for (let index = 1; index < dayMeetings.length; index += 1) {
      gapMinutes += Math.max(0, toMinutes(dayMeetings[index].start) - toMinutes(dayMeetings[index - 1].end));
      const leg = walkingTime(dayMeetings[index - 1].buildingId ?? "", dayMeetings[index].buildingId ?? "");
      if (leg.source === "unknown") {
        unknownLegs += 1;
      } else {
        walkingSeconds += leg.seconds;
      }
    }
  });

  switch (option) {
    case "clusterMorning":
      return { unknownLegs: 0, score: 10000 - starts.reduce((total, start) => total + start, 0) };
    case "clusterNight":
      return { unknownLegs: 0, score: starts.reduce((total, start) => total + start, 0) };
    case "compact":
      return { unknownLegs: 0, score: 10000 - gapMinutes - (Math.max(...ends) - Math.min(...starts)) };
    case "minimizeDistance":
      // Seconds keep roughly the old weighting against gap minutes: a mile
      // was 1000 points as miles x 1000 and is about 1150 seconds at 1.4 m/s.
      return { unknownLegs, score: 10000 - walkingSeconds - gapMinutes };
    default:
      return { unknownLegs: 0, score: 0 };
  }
}

export function recommendSections(
  option: OptimizationKey,
  courseCodes: string[] = courses.filter((course) => course.planned).map((course) => course.code),
  fixedSelections: Record<string, string> = {},
  walkingTime: WalkingTimeFn = defaultWalkingTime,
) {
  const activeCodes = [...new Set(courseCodes)];
  const fixedSections = activeCodes
    .map((courseCode) => sections.find((section) => section.id === fixedSelections[courseCode]))
    .filter((section): section is CourseSection => Boolean(section));
  const fixedCourseCodes = new Set(fixedSections.map((section) => section.courseCode));
  const sectionOptions = activeCodes
    .filter((courseCode) => !fixedCourseCodes.has(courseCode))
    .map((courseCode) => getSectionsForCourse(courseCode))
    .filter((courseSections) => courseSections.length > 0);
  let bestSelection: CourseSection[] = [...fixedSections];
  let best: ScheduleScore = { unknownLegs: Number.POSITIVE_INFINITY, score: Number.NEGATIVE_INFINITY };

  if (fixedSections.length === 0 && sectionOptions.length === 0) {
    return {};
  }

  function walk(index: number, current: CourseSection[]) {
    if (index === sectionOptions.length) {
      const candidate = scoreSchedule(option, current, walkingTime);
      if (
        candidate.unknownLegs < best.unknownLegs ||
        (candidate.unknownLegs === best.unknownLegs && candidate.score > best.score)
      ) {
        best = candidate;
        bestSelection = [...current];
      }
      return;
    }

    sectionOptions[index].forEach((section) => {
      if (sectionConflicts(section, current)) {
        return;
      }
      current.push(section);
      walk(index + 1, current);
      current.pop();
    });
  }

  walk(0, [...fixedSections]);

  return Object.fromEntries(bestSelection.map((section) => [section.courseCode, section.id]));
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
  const activeCourseCodes = getPlanningTermCourseCodes(merged);
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
    coursePlan:
      state.coursePlan === undefined || state.coursePlan === null
        ? { manualCredit: legacyManualCredit(merged), autoPlanned: [], lastAuto: null }
        : sanitizeCoursePlan(state.coursePlan, (code) => catalogCourseCodes.has(code)),
  };
}

/** The annotation v1's "Done" toggle wrote onto a course's transcript rows. */
const MANUALLY_DONE_NOTE = "Manually marked done in course review.";

/**
 * Plans saved before coursePlan existed: a course marked done by hand while
 * its transcript row still says in progress carries v1's explicit
 * annotation. Only that annotation counts as the student's credit claim;
 * a bare "completed" next to an in-progress row is not guessed at.
 */
function legacyManualCredit(state: PlannerState): string[] {
  return [
    ...new Set(
      (state.transcriptRecords ?? [])
        .filter(
          (record) =>
            !record.duplicateExcluded &&
            record.appliedStatus === "inProgress" &&
            record.rationale.includes(MANUALLY_DONE_NOTE) &&
            state.courseStatuses[record.code] === "completed",
        )
        .map((record) => record.code),
    ),
  ].sort();
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
  const activeCourseCodes = getPlanningTermCourseCodes(normalized);

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
  return getPlanningTermCourseCodes(state).reduce((total, courseCode) => {
    const course = getCourseByCode(courseCode);
    return total + (course?.creditHours ?? 0);
  }, 0);
}

export function getUnscheduledActiveCourses(state: PlannerState): Course[] {
  const normalized = normalizePlannerState(state);

  return getPlanningTermCourseCodes(normalized)
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
