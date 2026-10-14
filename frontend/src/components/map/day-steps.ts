import { classDayStatus } from "@/lib/terms/terms";
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

/** Date.getDay() numbers Sunday 0. */
const byDateIndex: ClassDay[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function classDayOf(date: Date): ClassDay {
  return byDateIndex[date.getDay()];
}

/** Minutes since local midnight. */
export function minuteOf(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/** The local calendar date, "2026-10-13", comparable with meeting dates. */
export function isoDateOf(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Whether a meeting runs on this date. A meeting with unknown dates (samples) runs every week. */
export function meetsOn(stop: Pick<MapStop, "dates">, isoDate: string): boolean {
  return !stop.dates || (stop.dates.start <= isoDate && isoDate <= stop.dates.end);
}

/**
 * Whether UNT holds classes on this date: false on a published holiday or
 * break, or outside every term. An unpublished date ("unknown") counts as a
 * class day, so the student's own meetings decide.
 */
export function classesRunOn(isoDate: string): boolean {
  return classDayStatus(isoDate) !== "no-class";
}

/**
 * The first class in the coming week, by real date: tomorrow first, up to a
 * week ahead, skipping meetings whose session isn't running then. Null when
 * nothing meets in that week (between terms, or before one starts).
 */
export function nextClassFrom(
  stopsByDay: Readonly<Record<ClassDay, readonly MapStop[]>>,
  from: Date,
): { day: ClassDay; ahead: number; stop: MapStop } | null {
  for (let ahead = 1; ahead <= 7; ahead += 1) {
    const date = new Date(from.getFullYear(), from.getMonth(), from.getDate() + ahead);
    const day = classDayOf(date);
    const iso = isoDateOf(date);
    const stop = classesRunOn(iso) ? stopsByDay[day]?.find((candidate) => meetsOn(candidate, iso)) : undefined;
    if (stop) return { day, ahead, stop };
  }
  return null;
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
