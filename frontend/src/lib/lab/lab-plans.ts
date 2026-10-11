import { normalizeCampusLocationKey } from "@/lib/campus-locations";
import { buildScheduleEvents, isCourseLocked, normalizePlannerState } from "@/lib/planner";
import { courses, defaultPlannerState, sections } from "@/lib/seed-data";
import type {
  Course,
  CourseSection,
  CourseStatus,
  PlannerState,
  SectionMeeting,
  WeekDay,
} from "@/lib/types";

const LAB_TUESDAY: WeekDay = "Tue";
const LAB_FRIDAY: WeekDay = "Fri";
const ACTIVE_TARGET = 5;

function byId(a: CourseSection, b: CourseSection): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function byCode(a: Course, b: Course): number {
  return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
}

function meetsOnDay(section: CourseSection, day: WeekDay): boolean {
  return section.meetings.some((meeting) => meeting.day === day);
}

function overlaps(a: SectionMeeting, b: SectionMeeting): boolean {
  return a.day === b.day && a.start < b.end && b.start < a.end;
}

function hasAnyConflict(section: CourseSection, others: CourseSection[]): boolean {
  return others.some((other) =>
    section.meetings.some((meeting) => other.meetings.some((otherMeeting) => overlaps(meeting, otherMeeting))),
  );
}

function conflictsOnDay(section: CourseSection, others: CourseSection[], day: WeekDay): boolean {
  return others.some((other) =>
    section.meetings.some(
      (meeting) =>
        meeting.day === day &&
        other.meetings.some((otherMeeting) => overlaps(meeting, otherMeeting)),
    ),
  );
}

/** Building identity of a section's Tuesday meeting, if it has one. */
function tuesdayKey(section: CourseSection): string {
  const meeting = section.meetings.find((entry) => entry.day === LAB_TUESDAY);
  if (!meeting) return "";
  return normalizeCampusLocationKey(meeting.buildingId ?? meeting.location);
}

export type LabPlanFixture = {
  plannerState: PlannerState;
  activeCourseCodes: string[];
  conflictCourseCodes: [string, string];
  lockedCourseCode: string;
  fridayCourseCode: string;
  fridayAlternativeSectionId: string;
};

function buildFixture(): LabPlanFixture {
  const sortedCourses = [...courses].sort(byCode);
  const sectionsByCourse = new Map<string, CourseSection[]>();
  sections.forEach((section) => {
    const list = sectionsByCourse.get(section.courseCode) ?? [];
    list.push(section);
    sectionsByCourse.set(section.courseCode, list);
  });
  sectionsByCourse.forEach((list) => list.sort(byId));

  const pinned = new Map<string, CourseSection>();
  const pinnedList = () => [...pinned.values()];

  // 1. Locked-course candidate: first course (alphabetically) with prerequisites,
  //    pinned with a Friday-free conflict-free section.
  const lockedCourse = sortedCourses.find((course) => course.prerequisites.length > 0);
  if (!lockedCourse) {
    throw new Error("Lab fixture needs a course with prerequisites");
  }
  const lockedSection =
    (sectionsByCourse.get(lockedCourse.code) ?? []).find(
      (section) => !meetsOnDay(section, LAB_FRIDAY) && !hasAnyConflict(section, pinnedList()),
    ) ?? (sectionsByCourse.get(lockedCourse.code) ?? [])[0];
  if (!lockedSection) {
    throw new Error("Lab fixture needs a section for the locked course");
  }
  pinned.set(lockedCourse.code, lockedSection);

  // 2. Tuesday conflict pair from two other courses; neither section meets Friday.
  let conflictPair: [CourseSection, CourseSection] | null = null;
  outer: for (const courseA of sortedCourses) {
    if (courseA.code === lockedCourse.code) continue;
    for (const courseB of sortedCourses) {
      if (courseB.code <= courseA.code || courseB.code === lockedCourse.code) continue;
      for (const sectionA of sectionsByCourse.get(courseA.code) ?? []) {
        if (!meetsOnDay(sectionA, LAB_TUESDAY) || meetsOnDay(sectionA, LAB_FRIDAY)) continue;
        if (hasAnyConflict(sectionA, pinnedList())) continue;
        for (const sectionB of sectionsByCourse.get(courseB.code) ?? []) {
          if (!meetsOnDay(sectionB, LAB_TUESDAY) || meetsOnDay(sectionB, LAB_FRIDAY)) continue;
          if (conflictsOnDay(sectionA, [sectionB], LAB_TUESDAY)) {
            conflictPair = [sectionA, sectionB];
            break outer;
          }
        }
      }
    }
  }
  if (!conflictPair) {
    throw new Error("Lab fixture needs a conflicting section pair on Tuesday");
  }
  pinned.set(conflictPair[0].courseCode, conflictPair[0]);
  pinned.set(conflictPair[1].courseCode, conflictPair[1]);

  // 3. Friday course: a course whose Friday section plus a Friday-free alternative
  //    lets "keep Friday free" actually work.
  let fridayPick: { courseCode: string; friday: CourseSection; alternative: CourseSection } | null = null;
  for (const course of sortedCourses) {
    if (pinned.has(course.code)) continue;
    const courseSections = sectionsByCourse.get(course.code) ?? [];
    for (const fridaySection of courseSections) {
      if (!meetsOnDay(fridaySection, LAB_FRIDAY)) continue;
      if (hasAnyConflict(fridaySection, pinnedList())) continue;
      const alternative = courseSections.find(
        (section) => section.id !== fridaySection.id && !meetsOnDay(section, LAB_FRIDAY) && !hasAnyConflict(section, pinnedList()),
      );
      if (alternative) {
        fridayPick = { courseCode: course.code, friday: fridaySection, alternative };
        break;
      }
    }
    if (fridayPick) break;
  }
  if (!fridayPick) {
    throw new Error("Lab fixture needs a movable Friday class");
  }
  pinned.set(fridayPick.courseCode, fridayPick.friday);

  // 4. Fill to the active target with Tuesday-meeting conflict-free sections,
  //    preferring distinct buildings so the day route has real legs.
  const pinnedTuesdayKeys = new Set(
    [...pinned.values()]
      .filter((section) => section.meetings.some((meeting) => meeting.day === LAB_TUESDAY))
      .map((section) => normalizeCampusLocationKey(tuesdayKey(section))),
  );
  for (const course of sortedCourses) {
    if (pinned.size >= ACTIVE_TARGET) break;
    if (pinned.has(course.code)) continue;
    const candidates = (sectionsByCourse.get(course.code) ?? []).filter(
      (section) =>
        meetsOnDay(section, LAB_TUESDAY) &&
        !meetsOnDay(section, LAB_FRIDAY) &&
        !hasAnyConflict(section, pinnedList()),
    );
    const pick =
      candidates.find((section) => {
        const key = tuesdayKey(section);
        return key.length > 0 && !pinnedTuesdayKeys.has(key);
      }) ?? candidates[0];
    if (pick) {
      pinned.set(course.code, pick);
      const key = tuesdayKey(pick);
      if (key.length > 0) pinnedTuesdayKeys.add(key);
    }
  }

  const activeCourseCodes = [...pinned.keys()].sort();
  if (activeCourseCodes.length < ACTIVE_TARGET) {
    throw new Error("Lab fixture could not fill the active course target");
  }

  // 5. The locked course is the first active course (alphabetically) that still has
  //    prerequisites — its prereqs stay uncompleted so exactly one course locks.
  const lockedCourseCode =
    activeCourseCodes
      .map((code) => sortedCourses.find((course) => course.code === code))
      .find((course) => course && course.prerequisites.length > 0)?.code;
  if (!lockedCourseCode) {
    throw new Error("Lab fixture has no active course with prerequisites");
  }

  // 6. Statuses: everything notTaken except actives (inProgress) and the prereqs
  //    of every active except the locked one (completed).
  const courseStatuses: Record<string, CourseStatus> = {};
  courses.forEach((course) => {
    courseStatuses[course.code] = "notTaken";
  });
  const completed = new Set<string>();
  for (const code of activeCourseCodes) {
    if (code === lockedCourseCode) continue;
    const course = sortedCourses.find((entry) => entry.code === code);
    (course?.prerequisites ?? []).forEach((prerequisite) => completed.add(prerequisite));
  }
  completed.forEach((code) => {
    courseStatuses[code] = "completed";
  });
  activeCourseCodes.forEach((code) => {
    courseStatuses[code] = "inProgress";
  });

  const selectedSections: Record<string, string> = {};
  pinned.forEach((section, code) => {
    selectedSections[code] = section.id;
  });

  const plannerState: PlannerState = {
    ...defaultPlannerState,
    courseStatuses,
    selectedSections,
    optimization: "compact",
    activeDay: LAB_TUESDAY,
  };

  return {
    plannerState,
    activeCourseCodes,
    conflictCourseCodes: [conflictPair[0].courseCode, conflictPair[1].courseCode],
    lockedCourseCode,
    fridayCourseCode: fridayPick.courseCode,
    fridayAlternativeSectionId: fridayPick.alternative.id,
  };
}

export const labPlan: LabPlanFixture = buildFixture();

/** Normalized once here so every consumer sees the same pinned, partially conflicting plan. */
export const labPlannerState: PlannerState = normalizePlannerState(labPlan.plannerState);

export function labScheduleEvents() {
  return buildScheduleEvents(labPlannerState);
}
