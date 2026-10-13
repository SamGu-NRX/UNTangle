import { getBuildingById } from "@/lib/planner";
import { sections } from "@/lib/seed-data";
import { weekDays, type CourseSection, type WeekDay } from "@/lib/types";
import type { CSSProperties } from "react";

const sectionById = new Map(sections.map((section) => [section.id, section] as const));

export function findSection(id: string | undefined): CourseSection | undefined {
  return id ? sectionById.get(id) : undefined;
}

export function toMinutes(value: string): number {
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}

/** "9:00" or "1:30 PM" style, short enough for an event. */
export function clock(minutes: number, withSuffix = false): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hour = h % 12 === 0 ? 12 : h % 12;
  const text = `${hour}:${String(m).padStart(2, "0")}`;
  return withSuffix ? `${text} ${h >= 12 ? "PM" : "AM"}` : text;
}

export type WeekEvent = {
  courseCode: string;
  sectionId: string;
  day: WeekDay;
  start: number;
  end: number;
  building: string;
  professor: string;
};

export function eventsFor(byCourse: Record<string, string>): WeekEvent[] {
  return Object.entries(byCourse).flatMap(([courseCode, sectionId]) => {
    const section = findSection(sectionId);
    if (!section) return [];
    return section.meetings.map((meeting) => ({
      courseCode,
      sectionId,
      day: meeting.day,
      start: toMinutes(meeting.start),
      end: toMinutes(meeting.end),
      building: getBuildingById(meeting.buildingId)?.shortName ?? meeting.location,
      professor: section.professor,
    }));
  });
}

/** Hour range shown: one hour around the classes, never narrower than 8–5. */
export function hourRange(events: WeekEvent[]): { first: number; last: number } {
  let first = 8;
  let last = 17;
  for (const event of events) {
    first = Math.min(first, Math.floor(event.start / 60) - (event.start % 60 === 0 ? 1 : 0));
    last = Math.max(last, Math.ceil(event.end / 60));
  }
  return { first: Math.max(6, first), last: Math.min(23, last) };
}

const COURSE_COLORS: Array<[string, string]> = [
  ["#3f7a4f", "#e6f0e8"],
  ["#a3613f", "#f6ebe4"],
  ["#4b6a8a", "#e6ecf2"],
  ["#8d7325", "#f5f0e0"],
  ["#7a5272", "#f1e8f0"],
  ["#3d7a7a", "#e3f0f0"],
];

/** Course colors in plan order (DESIGN.md: one per course, assigned in plan order). */
export function courseColor(courseCodes: readonly string[], courseCode: string): CSSProperties {
  const index = Math.max(0, courseCodes.indexOf(courseCode)) % COURSE_COLORS.length;
  const [solid, tint] = COURSE_COLORS[index];
  return {
    ["--ev" as string]: `var(--course-${index + 1}, ${solid})`,
    ["--ev-tint" as string]: `var(--course-${index + 1}-tint, ${tint})`,
  } as CSSProperties;
}

export function dayLetter(day: WeekDay): string {
  return { Mon: "M", Tue: "T", Wed: "W", Thu: "Th", Fri: "F" }[day];
}

/** "MWF 9:00" for a section's pattern. */
export function patternOf(section: CourseSection): string {
  const byStart = new Map<string, WeekDay[]>();
  section.meetings.forEach((m) => byStart.set(m.start, [...(byStart.get(m.start) ?? []), m.day]));
  return [...byStart.entries()]
    .map(([start, days]) => `${weekDays.filter((d) => days.includes(d)).map(dayLetter).join("")} ${clock(toMinutes(start), true)}`)
    .join(", ");
}

/** Courses whose meeting times differ between two schedules. */
export function movedCourses(from: Record<string, string>, to: Record<string, string>): string[] {
  const times = (id: string | undefined) =>
    (findSection(id)?.meetings ?? []).map((m) => `${m.day}${m.start}${m.end}`).sort().join();
  return Object.keys(to).filter((code) => from[code] !== to[code] && times(from[code]) !== times(to[code]));
}
