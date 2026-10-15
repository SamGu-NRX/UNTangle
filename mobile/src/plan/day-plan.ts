import { campusBuildings } from "@/lib/campus-locations";
import { dayHero, leaveBy, type Hero } from "@/lib/leave-by";
import { transferFit } from "@/lib/map-itinerary";
import { clockText, toMinutes } from "@/lib/plan-library/week";
import { isShuttleLeg, plannerTravelTime } from "@/lib/planner-walking";
import type { ClassDay, ScheduleEvent } from "@/lib/types";

/**
 * One day's route for Day: the stops in time order, the walk before each,
 * and what the hero says. Times are minutes after midnight; walks round up so
 * a leave-by never promises time that isn't there (lib/plan-library/week.ts
 * does the same).
 */

export type Place = { id: string; name: string; code: string };

/** Where the guest's day starts. The web asks the student once; guest mode uses the University Union. */
export const sampleStart: Place = { id: "uu", name: "University Union", code: "UU" };

const buildingById = new Map(campusBuildings.map((building) => [building.id, building]));

export function placeOf(event: Pick<ScheduleEvent, "buildingId" | "buildingName">): Place {
  const building = event.buildingId ? buildingById.get(event.buildingId) : undefined;
  return {
    id: event.buildingId ?? "",
    name: building?.name ?? event.buildingName,
    code: building?.shortName ?? event.buildingName,
  };
}

/** Walk minutes between two buildings, rounded up; 0 inside one building; null when unknown. */
export function walkMinutes(fromId: string, toId: string): number | null {
  if (!fromId || !toId) return null;
  if (fromId === toId) return 0;
  const leg = plannerTravelTime(fromId, toId);
  return leg.seconds === null ? null : Math.ceil(leg.seconds / 60);
}

export type Leg = {
  from: Place;
  /** Minutes walking, null when the route is unknown. */
  minutes: number | null;
  /** A shuttle ride to Discovery Park, not a walk. */
  shuttle: boolean;
  /** When to leave; null when the walk time is unknown or there's no walk. */
  leaveBy: number | null;
  /** Minutes between the previous class ending and this one starting; null for the first walk. */
  breakMinutes: number | null;
  /** Leaving on time means walking out the moment class ends, or the walk is longer than the break. */
  fit: "ok" | "tight" | "late" | "unknown";
};

export type Stop = {
  event: ScheduleEvent;
  place: Place;
  start: number;
  end: number;
  /** The walk that reaches this stop. */
  leg: Leg;
};

export type DayPlan = { day: ClassDay; stops: Stop[]; hero: Hero };

/** The day's stops with their walks. `now` is the minute of today, or null when the day shown isn't today. */
export function dayPlan(events: readonly ScheduleEvent[], day: ClassDay, start: Place, now: number | null): DayPlan {
  const todays = events
    .filter((event) => event.day === day)
    .sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  const stops: Stop[] = [];
  todays.forEach((event, index) => {
    const place = placeOf(event);
    const classStart = toMinutes(event.start);
    const previous = stops[index - 1];
    const from = previous ? previous.place : start;
    const minutes = walkMinutes(from.id, place.id);
    const breakMinutes = previous ? classStart - previous.end : null;
    const leave = minutes === null || minutes === 0 ? null : leaveBy(classStart, minutes);
    stops.push({
      event,
      place,
      start: classStart,
      end: toMinutes(event.end),
      leg: {
        from,
        minutes,
        shuttle: isShuttleLeg(from.id, place.id),
        // Never before the previous class ends: that is the moment to go.
        leaveBy: leave === null ? null : previous ? Math.max(leave, previous.end) : leave,
        breakMinutes,
        fit: breakMinutes === null ? (minutes === null ? "unknown" : "ok") : transferFit(minutes, breakMinutes),
      },
    });
  });
  const hero = dayHero(
    stops.map((stop) => ({ start: stop.start, end: stop.end, walkMin: stop.leg.minutes })),
    now,
  );
  return { day, stops, hero };
}

/** "9:00 to 9:50", the way copy.md writes a range. */
export function rangeText(start: number, end: number): string {
  return `${clockText(start)} to ${clockText(end)}`;
}

/** "9:00 AM" for a time shown without a day around it. */
export function clockWithPeriod(minutes: number): string {
  return `${clockText(minutes)} ${minutes < 720 ? "AM" : "PM"}`;
}
