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
import type {
  CampusBuilding,
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

function getMeetingBuilding(meeting: SectionMeeting) {
  return resolveCampusLocation(meeting.location, meeting.buildingId);
}

function distanceMiles(a: CampusBuilding, b: CampusBuilding) {
  const latDelta = (a.lat - b.lat) * 69;
  const lngDelta = (a.lng - b.lng) * 57.3;
  return Math.sqrt(latDelta * latDelta + lngDelta * lngDelta);
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

function scoreSchedule(option: OptimizationKey, candidateSections: CourseSection[]) {
  if (candidateSections.length === 0) {
    return 0;
  }

  if (option === "maximizeProfessor") {
    return candidateSections.reduce((total, section) => total + section.rating * 10, 0);
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
  let travelMiles = 0;
  byDay.forEach((dayMeetings) => {
    dayMeetings.sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
    for (let index = 1; index < dayMeetings.length; index += 1) {
      gapMinutes += Math.max(0, toMinutes(dayMeetings[index].start) - toMinutes(dayMeetings[index - 1].end));
      const previousBuilding = getMeetingBuilding(dayMeetings[index - 1]);
      const currentBuilding = getMeetingBuilding(dayMeetings[index]);
      if (previousBuilding && currentBuilding) {
        travelMiles += distanceMiles(previousBuilding, currentBuilding);
      }
    }
  });

  switch (option) {
    case "clusterMorning":
      return 10000 - starts.reduce((total, start) => total + start, 0);
    case "clusterNight":
      return starts.reduce((total, start) => total + start, 0);
    case "compact":
      return 10000 - gapMinutes - (Math.max(...ends) - Math.min(...starts));
    case "minimizeDistance":
      return 10000 - Math.round(travelMiles * 1000) - gapMinutes;
    default:
      return 0;
  }
}

export function recommendSections(
  option: OptimizationKey,
  courseCodes: string[] = courses.filter((course) => course.planned).map((course) => course.code),
  fixedSelections: Record<string, string> = {},
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
  let bestScore = Number.NEGATIVE_INFINITY;

  if (fixedSections.length === 0 && sectionOptions.length === 0) {
    return {};
  }

  function walk(index: number, current: CourseSection[]) {
    if (index === sectionOptions.length) {
      const score = scoreSchedule(option, current);
      if (score > bestScore) {
        bestScore = score;
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
  const merged: PlannerState = {
    ...defaultPlannerState,
    ...state,
    courseStatuses: {
      ...defaultPlannerState.courseStatuses,
      ...state.courseStatuses,
    },
    selectedSections: {
      ...defaultPlannerState.selectedSections,
      ...(state.selectedSections ?? {}),
    },
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
  return {
    ...merged,
    selectedMajor,
    selectedSections: recommended,
  };
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
): string[] {
  return prerequisiteEdges
    .filter((edge) => edge.courseCode === courseCode)
    .map((edge) => edge.prerequisiteCode)
    .filter((prereqCode) => courseStatuses[prereqCode] !== "completed");
}

export function isCourseLocked(state: PlannerState, courseCode: string) {
  return getMissingPrerequisites(courseCode, state.courseStatuses).length > 0;
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
