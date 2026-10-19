import { assignColors, type Hue } from "@/lib/course-colors";
import { eventsOf, weekBlocks, weekStats, type WeekBlock, type WeekStats } from "@/lib/plan-library/week";
import { DEFAULT_CANDIDATE_FILTER } from "@/lib/planner";
import { optionsConflict, planningTerm, sampleCatalog } from "@/lib/planner-sections";
import { courses, defaultPlannerState } from "@/lib/seed-data";
import type { Section } from "@/lib/sections/model";
import type { Course, PlannerState, ScheduleEvent } from "@/lib/types";

import { rangeWithPeriod } from "./day-plan";

/**
 * Guest mode's plan. Until device sign-in exists the app has no account to
 * read, so it shows one sample student: a Computer Science sophomore who
 * finished five courses, is taking four this fall, and has five planned for
 * Spring 2027. Every lens labels this once as sample data.
 *
 * Course status reads the seed catalog's prerequisite lists. Those lists
 * flatten the catalog rule into alternatives ("MATH 1650, MATH 1600 or
 * MATH 1610"), so a course counts as one you can take when any listed
 * prerequisite is done or in progress. The web's prerequisite engine
 * (lib/prereq) parses the full rule; it needs the student's transcript,
 * which a guest doesn't have.
 */

export const currentTermLabel = "Fall 2026";

export type GuestRecord = {
  /** Finished courses and their grades. */
  done: Readonly<Record<string, string>>;
  /** In progress this term. */
  taking: readonly string[];
};

export const sampleRecord: GuestRecord = {
  done: { "CSCE 1030": "A", "MATH 1710": "B", "ENGL 1310": "A", "ANTH 1010": "A", "COMM 1010": "A" },
  taking: ["CSCE 1040", "MATH 1720", "ENGL 1320", "PSCI 2305"],
};

/** Spring 2027's planned courses, in the order Courses lists them. */
export const samplePlannedCodes = ["CSCE 2100", "CSCE 2110", "MATH 2700", "PHYS 1710", "PSCI 2306"] as const;

/** The departments Courses suggests from: the sample student's major and its math. */
const MAJOR_DEPARTMENTS = new Set(["CSCE", "MATH"]);

const byCode = new Map(courses.map((course) => [course.code, course]));

export function courseByCode(code: string): Course | undefined {
  return byCode.get(code);
}

export type CourseState =
  | { kind: "done"; grade: string }
  | { kind: "taking" }
  | { kind: "planned" }
  | { kind: "available" }
  | { kind: "locked"; needs: string };

/** Where one course stands for this student, given the courses planned for next term. */
export function courseState(code: string, record: GuestRecord, planned: ReadonlySet<string>): CourseState {
  const grade = record.done[code];
  if (grade !== undefined) return { kind: "done", grade };
  if (record.taking.includes(code)) return { kind: "taking" };
  if (planned.has(code)) return { kind: "planned" };
  const prerequisites = courseByCode(code)?.prerequisites ?? [];
  if (prerequisites.length === 0) return { kind: "available" };
  const met = prerequisites.some((pre) => pre in record.done || record.taking.includes(pre));
  if (met) return { kind: "available" };
  // Name a prerequisite the student can look up: one in the catalog if any is.
  return { kind: "locked", needs: prerequisites.find((pre) => byCode.has(pre)) ?? prerequisites[0] };
}

export type CourseGroups = {
  canTake: Course[];
  taking: Course[];
  later: Array<{ course: Course; needs: string }>;
  done: Array<{ course: Course; grade: string }>;
};

function levelThenCode(a: Course, b: Course) {
  const level = (course: Course) => Number(course.code.split(" ")[1]?.[0] ?? 9);
  return level(a) - level(b) || a.code.localeCompare(b.code);
}

/**
 * The Courses groups, in the order the web shows them (copy.md glossary):
 * You can take, Taking now, Later, Done. Suggestions come from the major's
 * departments; planned courses sit in the term tray, not in a group.
 */
export function courseGroups(record: GuestRecord, planned: ReadonlySet<string>): CourseGroups {
  const groups: CourseGroups = { canTake: [], taking: [], later: [], done: [] };
  for (const course of [...courses].sort(levelThenCode)) {
    const state = courseState(course.code, record, planned);
    if (state.kind === "done") groups.done.push({ course, grade: state.grade });
    else if (state.kind === "taking") groups.taking.push(course);
    else if (!MAJOR_DEPARTMENTS.has(course.department) || state.kind === "planned") continue;
    else if (state.kind === "available") groups.canTake.push(course);
    else groups.later.push({ course, needs: state.needs });
  }
  return groups;
}

/** A course's sample sections for the planning term. */
export function sectionsOf(code: string): Section[] {
  const options = sampleCatalog(code);
  return options.status === "ready" ? options.result.sections : [];
}

/** "001" from a seed section id such as "csce-2100-001". */
export function sectionNumber(section: Pick<Section, "id">): string {
  return section.id.split("-").pop() ?? section.id;
}

/**
 * "Mon Wed Fri" and "12:00 to 12:50 PM" for a section whose meetings share
 * one time. A section's times stand alone, with no grid to place them in a
 * day, so they carry AM or PM the way the web writes a range off the grid
 * (schedule-builder/finals.ts examTimes).
 */
export function sectionTimes(section: Section): { days: string; time: string } | null {
  const timed = section.meetings.filter((meeting) => meeting.day && meeting.startMinutes !== null && meeting.endMinutes !== null);
  if (timed.length === 0) return null;
  const first = timed[0];
  return {
    days: timed.map((meeting) => meeting.day).join(" "),
    time: rangeWithPeriod(first.startMinutes as number, first.endMinutes as number),
  };
}

/** Course code to the picked section's id. */
export type Picks = Readonly<Record<string, string>>;

/** The planned courses a section would clash with, in pick order. */
export function conflictsWith(section: Section, picks: Picks, ignore?: string): string[] {
  const clashes: string[] = [];
  for (const [code, id] of Object.entries(picks)) {
    if (code === ignore || code === section.courseCode) continue;
    const other = sectionsOf(code).find((candidate) => candidate.id === id);
    if (other && optionsConflict(section, other)) clashes.push(code);
  }
  return clashes;
}

/** The first section of a course that fits around the current picks, or null when every one clashes. */
export function firstFittingSection(code: string, picks: Picks): Section | null {
  return sectionsOf(code).find((section) => conflictsWith(section, picks).length === 0) ?? null;
}

/** The sample student's starting picks: each planned course on its first section that fits. */
export function samplePicks(): Picks {
  const picks: Record<string, string> = {};
  for (const code of samplePlannedCodes) {
    const section = firstFittingSection(code, picks);
    if (section) picks[code] = section.id;
  }
  return picks;
}

export type GuestWeek = {
  events: ScheduleEvent[];
  blocks: WeekBlock[];
  colors: Map<string, Hue>;
  stats: WeekStats;
  credits: number;
};

/**
 * Each planned course's hue, by the web Week's rule (ScheduleBuilder keeps
 * its last assignment and passes it back to assignColors): a course already
 * colored keeps its hue while it stays planned, so adding or removing a
 * course never recolors the others. New courses are colored in pick order.
 */
export function colorsFor(picks: Picks, previous: ReadonlyMap<string, Hue>): Map<string, Hue> {
  return assignColors(
    Object.keys(picks).map((code) => ({ id: code, department: code.split(" ")[0] })),
    previous,
  );
}

/** The week the picks make, built with the web's own builders, colored on from `colors`. */
export function weekOf(picks: Picks, colors: ReadonlyMap<string, Hue>): GuestWeek {
  const codes = Object.keys(picks);
  const state: PlannerState = {
    ...defaultPlannerState,
    // The builders schedule courses marked in progress for the term being planned.
    courseStatuses: {
      ...defaultPlannerState.courseStatuses,
      ...Object.fromEntries(codes.map((code) => [code, "inProgress" as const])),
    },
    selectedSections: { ...picks },
  };
  // A guest has no section filter and no instructor evidence: the defaults eventsOf used before it took both.
  const events = eventsOf(state, sampleCatalog, DEFAULT_CANDIDATE_FILTER, {});
  const blocks = weekBlocks(events);
  return {
    events,
    blocks,
    colors: colorsFor(picks, colors),
    stats: weekStats(events),
    credits: codes.reduce((sum, code) => sum + (courseByCode(code)?.creditHours ?? 0), 0),
  };
}

export const planningTermLabel = planningTerm.label;

/** "1 credit", "15 credits" (copy.md: credit, never hours or units). */
export function creditsText(count: number): string {
  return `${count} ${count === 1 ? "credit" : "credits"}`;
}
