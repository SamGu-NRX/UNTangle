import { isTimed, meetTogether, rangeLabel } from "@/lib/planner-sections";
import { isShuttleLeg } from "@/lib/planner-walking";
import type { Section } from "@/lib/sections";
import type { DateRange } from "@/lib/sections/model";
import { classDays, weekDays, type ClassDay } from "@/lib/types";
import type { CSSProperties } from "react";

/** The loaded option a course's id names, if any. */
export type FindOption = (courseCode: string, optionId: string) => Section | undefined;

export function toMinutes(value: string): number {
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}

/** "9:00" or "1:30 PM" style, short enough for an event. */
export function clock(minutes: number, withSuffix = false): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hour = h % 12 === 0 ? 12 : h % 12;
  const text = `${hour}:${String(m).padStart(2, "0")}`;
  return withSuffix ? `${text} ${h >= 12 && h < 24 ? "PM" : "AM"}` : text;
}

export type WeekEvent = {
  courseCode: string;
  sectionId: string;
  day: ClassDay;
  start: number;
  end: number;
  room: string;
  /** Catalogue building, or null for an unmapped room. */
  buildingId: string | null;
  professor: string;
  dates: DateRange;
};

export function eventsFor(byCourse: Record<string, string>, find: FindOption): WeekEvent[] {
  return Object.entries(byCourse).flatMap(([courseCode, sectionId]) => {
    const section = find(courseCode, sectionId);
    if (!section) return [];
    return section.meetings.filter(isTimed).map((meeting) => ({
      courseCode,
      sectionId,
      day: meeting.day,
      start: meeting.startMinutes,
      end: meeting.endMinutes,
      room: meeting.room,
      buildingId: meeting.buildingId,
      professor: meeting.instructor.display ?? section.instructor.display ?? "Instructor not listed",
      dates: meeting.dates,
    }));
  });
}

/** Back-to-back trips between main campus and Discovery Park (shuttle rides), counting only classes that meet in the same weeks. */
export function shuttleTrips(events: readonly WeekEvent[]): number {
  let trips = 0;
  for (const day of classDays) {
    const list = events.filter((event) => event.day === day).sort((a, b) => a.start - b.start);
    for (let i = 1; i < list.length; i += 1) {
      if (meetTogether(day, list[i - 1].dates, list[i].dates) && isShuttleLeg(list[i - 1].buildingId, list[i].buildingId)) trips += 1;
    }
  }
  return trips;
}

/** Mon-Fri, plus a weekend day only when some class meets on it. */
export function daysShown(events: readonly WeekEvent[]): ClassDay[] {
  return classDays.filter((day) => (weekDays as readonly ClassDay[]).includes(day) || events.some((event) => event.day === day));
}

/** Two events at overlapping times that never meet in the same week (first and second eight-week sessions). */
function sideBySide(a: WeekEvent, b: WeekEvent): boolean {
  return a.day === b.day && a.start < b.end && b.start < a.end && !meetTogether(a.day, a.dates, b.dates);
}

/**
 * Columns within a day for classes that share a time slot in different weeks,
 * so both stay readable. Classes that overlap in the same weeks are a real
 * conflict and keep drawing on top of each other, flagged.
 */
export function laneLayout(events: readonly WeekEvent[]): Map<WeekEvent, { lane: number; lanes: number }> {
  const lanes = new Map<WeekEvent, number>();
  const ordered = [...events].sort((a, b) => a.start - b.start || a.end - b.end);
  for (const event of ordered) {
    let lane = 0;
    while ([...lanes].some(([other, otherLane]) => otherLane === lane && sideBySide(event, other))) lane += 1;
    lanes.set(event, lane);
  }
  // Every event in a chain of side-by-side events shares one column count, so no two overlap.
  const layout = new Map<WeekEvent, { lane: number; lanes: number }>();
  for (const event of ordered) {
    if (layout.has(event)) continue;
    const group = [event];
    for (let i = 0; i < group.length; i += 1) {
      for (const other of ordered) if (!group.includes(other) && sideBySide(group[i], other)) group.push(other);
    }
    const count = Math.max(...group.map((member) => lanes.get(member)!)) + 1;
    for (const member of group) layout.set(member, { lane: lanes.get(member)!, lanes: count });
  }
  return layout;
}

/**
 * The date range more of the week's classes share than any other (the
 * regular session). Events that run on other dates show theirs, so an
 * eight-week class reads as one; with no single most common range, every
 * event shows its dates.
 */
export function usualRange(events: readonly WeekEvent[]): string | null {
  const counts = new Map<string, number>();
  for (const event of events) {
    const label = rangeLabel(event.dates);
    if (label) counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const [first, second] = [...counts].sort((a, b) => b[1] - a[1]);
  return first && (!second || first[1] > second[1]) ? first[0] : null;
}

/** Hour range shown: one hour around the classes, never narrower than 8–5. */
export function hourRange(events: WeekEvent[]): { first: number; last: number } {
  let first = 8;
  let last = 17;
  for (const event of events) {
    first = Math.min(first, Math.floor(event.start / 60) - (event.start % 60 === 0 ? 1 : 0));
    last = Math.max(last, Math.ceil(event.end / 60));
  }
  return { first: Math.max(6, first), last: Math.min(24, last) };
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

export function dayLetter(day: ClassDay): string {
  return { Mon: "M", Tue: "T", Wed: "W", Thu: "Th", Fri: "F", Sat: "Sa", Sun: "Su" }[day];
}

/** "MWF 9:00 AM" for an option's timed meetings; "No set time" when it has none. */
export function patternOf(section: Section): string {
  const byStart = new Map<number, ClassDay[]>();
  section.meetings.filter(isTimed).forEach((m) => byStart.set(m.startMinutes, [...(byStart.get(m.startMinutes) ?? []), m.day]));
  if (byStart.size === 0) return "No set time";
  return [...byStart.entries()]
    .map(([start, days]) => `${classDays.filter((d) => days.includes(d)).map(dayLetter).join("")} ${clock(start, true)}`)
    .join(", ");
}

/** Courses whose meeting times differ between two schedules. */
export function movedCourses(from: Record<string, string>, to: Record<string, string>, find: FindOption): string[] {
  const times = (code: string, id: string | undefined) =>
    ((id && find(code, id)?.meetings.filter(isTimed)) || [])
      .map((m) => `${m.day}${m.startMinutes}${m.endMinutes}${m.dates.start}${m.dates.end}`)
      .sort()
      .join();
  return Object.keys(to).filter((code) => from[code] !== to[code] && times(code, from[code]) !== times(code, to[code]));
}
