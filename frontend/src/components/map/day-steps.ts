import { allSessions, classDayStatus } from "@/lib/terms/terms";
import { classDays, weekDays, type ClassDay, type MapStop } from "@/lib/types";

export const dayNames: Record<ClassDay, string> = {
  Mon: "Monday",
  Tue: "Tuesday",
  Wed: "Wednesday",
  Thu: "Thursday",
  Fri: "Friday",
  Sat: "Saturday",
  Sun: "Sunday",
};

/** The time zone UNT schedules in (lib/terms/terms.ts). */
const CAMPUS_TIME_ZONE = "America/Chicago";

const campusFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: CAMPUS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * The campus's date, weekday and minute at an instant. Day reads the clock in
 * campus time, not the device's, so a student away from Texas sees the same
 * "today" as the class schedule.
 */
export function campusNow(instant: Date): { iso: string; day: ClassDay; minute: number } {
  const parts = campusFormat.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  const day = part("weekday") as ClassDay;
  if (!classDays.includes(day)) throw new Error(`Unexpected weekday "${day}" from Intl`);
  return { iso: `${part("year")}-${part("month")}-${part("day")}`, day, minute: Number(part("hour")) * 60 + Number(part("minute")) };
}

/** Date.getUTCDay() numbers Sunday 0. */
const byDayIndex: ClassDay[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function shiftIso(iso: string, days: number): { iso: string; day: ClassDay } {
  const [year, month, date] = iso.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, date + days));
  return { iso: shifted.toISOString().slice(0, 10), day: byDayIndex[shifted.getUTCDay()] };
}

/**
 * The calendar session a meeting belongs to, matched by its first and last
 * dates; undefined when none matches (samples, or a term the calendar
 * doesn't cover yet).
 */
export function sessionOf(dates: MapStop["dates"]): string | undefined {
  if (!dates) return undefined;
  return allSessions().find(
    (session) => session.classesBegin === dates.start && (session.sessionEnd === dates.end || session.classesEnd === dates.end),
  )?.id;
}

/**
 * Whether a meeting holds class on this date: inside its own dates, and a
 * regular class day for its session, so not a holiday, a break, a reading
 * day or finals. A date the calendar hasn't published counts, so the
 * meeting's own dates decide.
 */
export function meetsOn(stop: Pick<MapStop, "dates">, isoDate: string): boolean {
  if (stop.dates && (isoDate < stop.dates.start || isoDate > stop.dates.end)) return false;
  const status = classDayStatus(isoDate, sessionOf(stop.dates ?? null));
  return status === "class" || status === "unknown";
}

/**
 * The first class in the coming week, by campus date: tomorrow first, up to
 * a week ahead, counting only meetings that hold class that day. Null when
 * nothing meets in that week (between terms, or before one starts).
 */
export function nextClassFrom(
  stopsByDay: Readonly<Record<ClassDay, readonly MapStop[]>>,
  todayIso: string,
): { day: ClassDay; ahead: number; stop: MapStop } | null {
  for (let ahead = 1; ahead <= 7; ahead += 1) {
    const { iso, day } = shiftIso(todayIso, ahead);
    const stop = stopsByDay[day]?.find((candidate) => meetsOn(candidate, iso));
    if (stop) return { day, ahead, stop };
  }
  return null;
}

/**
 * The first date the plan holds class, when none of its dated meetings has
 * started by `todayIso`: a student planning Spring in October. Day shows
 * that first week, dated, because today has nothing of this plan to show.
 * Null once any dated meeting has started, and with no dated meeting at all
 * (samples have no dates).
 */
export function firstWeekAhead(stopsByDay: Readonly<Record<ClassDay, readonly MapStop[]>>, todayIso: string): { iso: string; day: ClassDay } | null {
  const starts = classDays.flatMap((day) => (stopsByDay[day] ?? []).flatMap((stop) => (stop.dates ? [stop.dates.start] : [])));
  if (starts.length === 0 || starts.some((start) => start <= todayIso)) return null;
  const first = starts.reduce((a, b) => (b < a ? b : a));
  // Two weeks covers a first week that loses its only class day to a holiday.
  for (let ahead = 0; ahead < 14; ahead += 1) {
    const { iso, day } = shiftIso(first, ahead);
    if ((stopsByDay[day] ?? []).some((stop) => meetsOn(stop, iso))) return { iso, day };
  }
  return null;
}

/**
 * The date Day shows `day` for: today's date when it is today. Before the
 * plan's classes begin, the day's date in the calendar week (Monday first)
 * of the first class (`ahead`), so with a first class on Tuesday, Monday is
 * that week's Monday, not the next one. Otherwise null: the weekday's plan,
 * undated.
 */
export function shownDate(day: ClassDay, { todayIso, ahead }: { todayIso: string | null; ahead: { iso: string; day: ClassDay } | null }): string | null {
  if (todayIso) return todayIso;
  if (!ahead) return null;
  return shiftIso(ahead.iso, classDays.indexOf(day) - classDays.indexOf(ahead.day)).iso;
}

/** "Jan 11" for an ISO date, read as a calendar date in any time zone. */
export function shortDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** The campus date `day` next falls on, today included: Day's Thursday is this week's Thursday, or next week's once it has passed. */
export function nextDateOf(day: ClassDay, todayIso: string): string {
  for (let ahead = 0; ahead < 7; ahead += 1) {
    const shifted = shiftIso(todayIso, ahead);
    if (shifted.day === day) return shifted.iso;
  }
  throw new Error(`No ${day} within a week of ${todayIso}`);
}

/**
 * The days the stepper walks through, Monday first: the weekdays, a weekend
 * day when the plan meets on it, and today, so "Today" is always reachable.
 */
export function stepperDays(counts: Readonly<Record<ClassDay, number>>, today: ClassDay): ClassDay[] {
  return classDays.filter((day) => (weekDays as readonly ClassDay[]).includes(day) || counts[day] > 0 || day === today);
}

/** The next day after `from` with classes, going round the week, and how many days ahead it is; null when none has any. */
export function nextClassDay(counts: Readonly<Record<ClassDay, number>>, from: ClassDay): { day: ClassDay; ahead: number } | null {
  const start = classDays.indexOf(from);
  for (let ahead = 1; ahead <= classDays.length; ahead += 1) {
    const day = classDays[(start + ahead) % classDays.length];
    if (counts[day] > 0) return { day, ahead };
  }
  return null;
}
