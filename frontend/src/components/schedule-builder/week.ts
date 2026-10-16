/**
 * The week as the grid draws it: events, where they sit side by side, the
 * walks between consecutive classes, and the hours and days shown. Pure, so
 * the layout rules have one tested answer.
 */
import type { Day, Section } from "@/lib/sections";
import { isTimed, meetTogether } from "./conflicts";

export const DAY_ORDER: readonly Day[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const DAY_NAME: Record<Day, string> = {
  Mon: "Monday",
  Tue: "Tuesday",
  Wed: "Wednesday",
  Thu: "Thursday",
  Fri: "Friday",
  Sat: "Saturday",
  Sun: "Sunday",
};
const dayIndex = (day: Day) => DAY_ORDER.indexOf(day);

/** "9:00" for 540: times as people read them inside a day (DESIGN.md §9.7). */
export function clock(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(minutes % 60).padStart(2, "0")}`;
}

/** "9 AM", "12:30 PM": a time on its own, outside a day's run of times. */
export function clockWithSuffix(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${h % 12 === 0 ? 12 : h % 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`;
}

export const timeRange = (start: number, end: number) => `${clock(start)}–${clock(end)}`;

/** "Feb 3": an ISO date as Week says it. */
export function shortDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** How Week names Auto's alternative at a rank, inside a sentence ("option 2"); the strip shows "2 of 3". */
export const optionName = (index: number) => `option ${index + 1}`;
const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
/** The same name starting a label ("Option 2"). */
export const optionTitle = (index: number) => capitalized(optionName(index));

/** "MWF", "TR": the registrar's day letters, as myUNT and vsb print them. */
export function dayLetters(days: readonly Day[]): string {
  const letter: Record<Day, string> = { Mon: "M", Tue: "T", Wed: "W", Thu: "R", Fri: "F", Sat: "S", Sun: "U" };
  return DAY_ORDER.filter((day) => days.includes(day)).map((day) => letter[day]).join("");
}

/** "Mon", "Mon and Wed", "Mon, Wed and Fri". */
export function andList(items: readonly string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/**
 * How a student refers to a section: "001", or "110 + 111" for a lecture
 * with its linked lab. A made-up sample's code is its whole id
 * ("math-3680-001"); its number is the last part.
 */
export function sectionLabel(section: Pick<Section, "sectionCode">): string {
  return /^[a-z]+-\d+[a-z]?-(\w+)$/i.exec(section.sectionCode)?.[1] ?? section.sectionCode;
}

/** "MWF 9:00–9:50", "TR 9:30–10:50, M 2:00–2:50"; "Online, no set time" or "Time to be announced" without one. */
export function patternOf(section: Section): string {
  const groups = new Map<string, { days: Day[]; start: number; end: number }>();
  for (const meeting of section.meetings.filter(isTimed)) {
    const key = `${meeting.startMinutes}-${meeting.endMinutes}`;
    const group = groups.get(key) ?? { days: [], start: meeting.startMinutes, end: meeting.endMinutes };
    if (!group.days.includes(meeting.day)) group.days.push(meeting.day);
    groups.set(key, group);
  }
  if (groups.size === 0) return section.online || section.async ? "Online, no set time" : "Time to be announced";
  return [...groups.values()]
    .sort((a, b) => dayIndex(a.days[0]) - dayIndex(b.days[0]) || a.start - b.start)
    .map((group) => `${dayLetters(group.days)} ${timeRange(group.start, group.end)}`)
    .join(", ");
}

export type GridEvent = {
  /** Course plus meeting occurrence (MOTION.md §4): a section swap moves the same box. */
  key: string;
  courseCode: string;
  section: Section;
  day: Day;
  start: number;
  end: number;
  building: string | null;
  dates: { start: string | null; end: string | null };
};

/** Each section's timed meetings, in week order. MWF becomes occurrences 0, 1 and 2. */
export function eventsOf(sections: readonly Section[]): GridEvent[] {
  return sections.flatMap((section) =>
    section.meetings
      .filter(isTimed)
      .sort((a, b) => dayIndex(a.day) - dayIndex(b.day) || a.startMinutes - b.startMinutes)
      .map((meeting, i) => ({
        key: `${section.courseCode}#${i}`,
        courseCode: section.courseCode,
        section,
        day: meeting.day,
        start: meeting.startMinutes,
        end: meeting.endMinutes,
        building: meeting.buildingId,
        dates: meeting.dates,
      })),
  );
}

const overlapsInTime = (a: GridEvent, b: GridEvent) => a.day === b.day && a.start < b.end && b.start < a.end;
/** A real clash: overlapping times on a shared date, between two courses. */
export const clashes = (a: GridEvent, b: GridEvent) =>
  a.courseCode !== b.courseCode && overlapsInTime(a, b) && meetTogether(a.day, a.dates, b.dates);

export type Placement = { lane: number; lanes: number; conflict: boolean };

/**
 * Events that share time on a day sit side by side, each in its own lane,
 * whether they clash or run in different weeks (two eight-week halves), so
 * both stay readable. A chain of overlapping events shares one lane count.
 */
export function placeEvents(events: readonly GridEvent[]): Map<string, Placement> {
  const out = new Map<string, Placement>();
  for (const day of DAY_ORDER) {
    const list = events.filter((event) => event.day === day).sort((a, b) => a.start - b.start || b.end - a.end || a.key.localeCompare(b.key));
    let cluster: GridEvent[] = [];
    let clusterEnd = -1;
    const flush = () => {
      const lanes: GridEvent[][] = [];
      const laneOf = new Map<GridEvent, number>();
      for (const event of cluster) {
        let lane = lanes.findIndex((members) => members.every((member) => !overlapsInTime(member, event)));
        if (lane === -1) lane = lanes.push([]) - 1;
        lanes[lane].push(event);
        laneOf.set(event, lane);
      }
      for (const event of cluster) {
        out.set(event.key, { lane: laneOf.get(event)!, lanes: lanes.length, conflict: cluster.some((other) => clashes(event, other)) });
      }
    };
    for (const event of list) {
      if (cluster.length > 0 && event.start >= clusterEnd) {
        flush();
        cluster = [];
      }
      cluster.push(event);
      clusterEnd = Math.max(clusterEnd, event.end);
    }
    if (cluster.length > 0) flush();
  }
  return out;
}

/** Walking time between two buildings, or null when it isn't known. */
export type WalkFn = (fromBuilding: string, toBuilding: string) => { minutes: number; shuttle: boolean } | null;

/** Breaks longer than this get no walk chip: the walk can't be tight. */
export const WALK_GAP_MAX = 30;
/**
 * A walk is tight when it leaves fewer than this many minutes spare. A
 * starting value with no data behind it (the leave-by buffer, untangle-v3.md).
 */
export const TIGHT_BUFFER = 2;

export type WalkLeg = {
  day: Day;
  fromKey: string;
  toKey: string;
  toCourse: string;
  /** Where the line runs: the first class's end to the next class's start. */
  from: number;
  to: number;
  minutes: number;
  shuttle: boolean;
  kind: "ok" | "tight" | "late";
};

type Dates = GridEvent["dates"];
const later = (a: string | null, b: string | null) => (a === null ? b : b === null ? a : a > b ? a : b);
const earlier = (a: string | null, b: string | null) => (a === null ? b : b === null ? a : a < b ? a : b);
/** True when `outer` runs on every date of `inner`; a missing bound is open. */
const covers = (outer: Dates, inner: Dates) =>
  (outer.start === null || (inner.start !== null && outer.start <= inner.start)) && (outer.end === null || (inner.end !== null && outer.end >= inner.end));

/**
 * Walks between consecutive classes in different, known buildings with a
 * break of WALK_GAP_MAX minutes or less. A class's predecessor depends on
 * the week: with a first-half class between a full-term one and this one,
 * the full-term class still comes right before it in the second half. So a
 * class is a predecessor unless a class ending later runs on every date the
 * two share.
 */
export function walksOf(events: readonly GridEvent[], walk: WalkFn): WalkLeg[] {
  const legs: WalkLeg[] = [];
  const ordered = [...events].sort((a, b) => dayIndex(a.day) - dayIndex(b.day) || a.start - b.start);
  for (const next of ordered) {
    const earlierClasses = ordered.filter((event) => event.day === next.day && event.end <= next.start && meetTogether(next.day, event.dates, next.dates));
    for (const before of earlierClasses) {
      const shared: Dates = { start: later(before.dates.start, next.dates.start), end: earlier(before.dates.end, next.dates.end) };
      const hidden = earlierClasses.some(
        (other) => other !== before && (other.end > before.end || (other.end === before.end && other.key < before.key)) && covers(other.dates, shared),
      );
      if (hidden || next.start - before.end > WALK_GAP_MAX) continue;
      if (!before.building || !next.building || before.building === next.building) continue;
      const time = walk(before.building, next.building);
      if (!time) continue;
      const gap = next.start - before.end;
      legs.push({
        day: next.day,
        fromKey: before.key,
        toKey: next.key,
        toCourse: next.courseCode,
        from: before.end,
        to: next.start,
        minutes: time.minutes,
        shuttle: time.shuttle,
        kind: time.minutes > gap ? "late" : time.minutes + TIGHT_BUFFER >= gap ? "tight" : "ok",
      });
    }
  }
  return legs;
}

/** Hours shown: 8 a.m. to at least 5 p.m., widened to whole hours around every class and busy time. */
export function hourRange(spans: ReadonlyArray<{ start: number; end: number }>): { first: number; last: number } {
  let first = 8;
  let last = 17;
  for (const span of spans) {
    first = Math.min(first, Math.floor(span.start / 60));
    last = Math.max(last, Math.ceil(span.end / 60));
  }
  return { first: Math.max(0, first), last: Math.min(24, last) };
}

/** Monday to Friday, plus a weekend day only when something meets then. */
export function daysShown(events: readonly Pick<GridEvent, "day">[]): Day[] {
  return DAY_ORDER.filter((day, i) => i < 5 || events.some((event) => event.day === day));
}
