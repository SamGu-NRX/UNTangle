import { buildings, courses, defaultPlannerState, sections } from "@/lib/seed-data";
import type {
  CampusBuilding,
  Course,
  CourseSection,
  MapStop,
  OptimizationKey,
  PlannerApiPayload,
  PlannerState,
  ScheduleEvent,
  SectionMeeting,
  WeekDay,
} from "@/lib/types";

const plannerStorageKey = "untangle-planner-state";

function toMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function durationMinutes(start: string, end: string) {
  return toMinutes(end) - toMinutes(start);
}

function getBuilding(buildingId: string) {
  return buildings.find((building) => building.id === buildingId);
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

export function getInProgressCourseCodes(state: PlannerState) {
  return courses
    .filter((course) => (state.courseStatuses[course.code] ?? "notTaken") === "inProgress")
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
      const previousBuilding = getBuilding(dayMeetings[index - 1].buildingId);
      const currentBuilding = getBuilding(dayMeetings[index].buildingId);
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

export function recommendSections(option: OptimizationKey, courseCodes: string[]) {
  const sectionOptions = courseCodes.map((courseCode) => getSectionsForCourse(courseCode));
  let bestSelection: CourseSection[] = [];
  let bestScore = Number.NEGATIVE_INFINITY;

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

  walk(0, []);

  return Object.fromEntries(bestSelection.map((section) => [section.courseCode, section.id]));
}

export function normalizePlannerState(state: PlannerState): PlannerState {
  const baseState = {
    ...defaultPlannerState,
    ...state,
    courseStatuses: {
      ...defaultPlannerState.courseStatuses,
      ...state.courseStatuses,
    },
  };
  const inProgressCourseCodes = getInProgressCourseCodes(baseState);
  const recommended = recommendSections(baseState.optimization, inProgressCourseCodes);
  const selectedSections = Object.fromEntries(
    inProgressCourseCodes.flatMap((courseCode) => {
      const selectedSectionId = baseState.selectedSections[courseCode];
      const selectedSection = sections.find(
        (section) => section.id === selectedSectionId && section.courseCode === courseCode,
      );

      return [[courseCode, selectedSection?.id ?? recommended[courseCode]]].filter(
        (entry): entry is [string, string] => Boolean(entry[1]),
      );
    }),
  );

  return {
    ...baseState,
    selectedSections,
  };
}

export function buildScheduleEvents(state: PlannerState): ScheduleEvent[] {
  const normalized = normalizePlannerState(state);

  return getInProgressCourseCodes(normalized).flatMap((courseCode) => {
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
      const building = getBuilding(event.buildingId);
      if (!building) {
        throw new Error(`Missing building data for ${event.buildingId}`);
      }

      return {
        courseCode: event.courseCode,
        title: event.title,
        buildingId: building.id,
        buildingName: building.name,
        shortName: building.shortName,
        lat: building.lat,
        lng: building.lng,
        day,
        start: event.start,
        end: event.end,
      };
    });
}

export function serializePlannerPayload(state: PlannerState): PlannerApiPayload {
  return {
    ...normalizePlannerState(state),
    routeStops: {
      Mon: buildStopsForDay(state, "Mon"),
      Tue: buildStopsForDay(state, "Tue"),
      Wed: buildStopsForDay(state, "Wed"),
      Thu: buildStopsForDay(state, "Thu"),
      Fri: buildStopsForDay(state, "Fri"),
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

export function getBuildingById(buildingId: string) {
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
  return getInProgressCourseCodes(state).reduce((total, courseCode) => {
    const course = getCourseByCode(courseCode);
    return total + (course?.creditHours ?? 0);
  }, 0);
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
