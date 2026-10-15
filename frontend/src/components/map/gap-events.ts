/**
 * What's happening between classes: for each gap of at least
 * GAP_MIN_MINUTES between two of the day's classes, the campus events that
 * fit it, with the trip there and whether the student still makes the next
 * class. Pure: Day passes the itinerary, the date and the events feed, and
 * gets plain rows back.
 *
 * The rules, all facts and no guesses:
 * - The fit comes from eventsInGaps (lib/campus-events/gaps.ts), which merges
 *   overlapping classes into busy blocks, so a class still running never
 *   leaves a false gap.
 * - A trip is a campus-walkway time, the shuttle's fixed time between main
 *   campus and Discovery Park, or zero within one building: the same three
 *   answers the itinerary gives. Anything else, a straight-line estimate
 *   included, has no time.
 * - Minutes round up, as the itinerary's do, and an event stays only when
 *   the rounded trips fit on both sides. An event the student can't reach and
 *   leave in time for the next class is never shown.
 * - An event with no catalogue building keeps the feed's raw place and has no
 *   trip, so its row says when it ends before the next class, never that the
 *   student makes it.
 * - Today, an event that starts before the student could get there is gone,
 *   and so is every event in a gap that has already ended.
 * - A feed that failed (null) shows nothing.
 */

import { eventsInGaps } from "@/lib/campus-events/gaps";
import type { DayClass, NormalizedEvent } from "@/lib/campus-events/types";
import { resolveZonedWallTime, zoneWallTime } from "@/lib/calendar-feeds/datetime";
import { getWalkingSeconds, type WalkingTimeFn } from "@/lib/campus/walking-times";
import { campusBuildings } from "@/lib/campus-locations";
import { isTight, leaveBy } from "@/lib/leave-by";
import { toMinutes, walkMinutesFromSeconds, type Itinerary, type ItineraryStop } from "@/lib/map-itinerary";
import { isShuttleLeg, SHUTTLE_SECONDS } from "@/lib/planner-walking";
import type { MapRoutePoint } from "@/lib/types";
import { meetsOn } from "@/components/map/day-steps";

/** The shortest break that gets an "In this gap" row. The lead set it for this feature; no usage data is behind it. */
export const GAP_MIN_MINUTES = 30;
/** Events a gap shows before it is opened. */
export const GAP_PREVIEW = 2;

const CAMPUS_TIME_ZONE = "America/Chicago";

/** A trip between two buildings: walking, or the Discovery Park shuttle. */
export type Trip = { seconds: number; mode: "walk" | "shuttle" };
/** The trip between two catalogue buildings, or null when its time is unknown. */
export type TripFn = (fromBuildingId: string, toBuildingId: string) => Trip | null;

const buildingsById = new Map(campusBuildings.map((building) => [building.id, building]));

/** The itinerary's three known answers: walkways, the shuttle, the same building. */
export const campusTrip: TripFn = (from, to) => {
  if (from.toLowerCase() === to.toLowerCase()) return { seconds: 0, mode: "walk" };
  if (isShuttleLeg(from, to)) return { seconds: SHUTTLE_SECONDS, mode: "shuttle" };
  const walk = getWalkingSeconds(from, to);
  return walk.source === "campus-network" ? { seconds: walk.seconds, mode: "walk" } : null;
};

export type GapEventPlace =
  | {
      kind: "building";
      buildingId: string;
      name: string;
      shortName: string;
      /** Where the map pins it; null for a building off the main campus map. */
      point: MapRoutePoint | null;
      /** The feed's raw text, room included. */
      location: string;
    }
  | { kind: "raw"; location: string };

/** A trip in whole minutes, rounded up; null when its time is unknown. */
export type GapTrip = { minutes: number; mode: "walk" | "shuttle" } | null;

export type GapEvent = {
  /** The selection and row key; distinct from every stop and leg key. */
  key: string;
  title: string;
  url: string | null;
  /** Minutes after midnight, campus time. */
  start: number;
  end: number;
  place: GapEventPlace;
  /** From the class before the gap. */
  to: GapTrip;
  /** To the class after the gap. */
  back: GapTrip;
  /** When to leave the event to reach the next class on time (lib/leave-by.ts); null when the trip back is unknown or none. */
  leaveBy: number | null;
  /**
   * - `ok`: the student stays to the end and makes the next class.
   * - `tight`: leaving on time means leaving as it ends, or before.
   * - `unknown`: the trip back has no time, so nothing is claimed.
   */
  fit: "ok" | "tight" | "unknown";
};

export type GapRow = {
  /** The itinerary leg into the class after the gap; the row sits on it. */
  legKey: string;
  /** The class the gap follows (the latest-ending one, when classes overlap) and the class it ends at. */
  from: ItineraryStop;
  to: ItineraryStop;
  /** Minutes after midnight. */
  start: number;
  end: number;
  /** Sorted by start. */
  events: GapEvent[];
};

/** A class's catalogue building, or null when it has none. */
function classBuilding(entry: ItineraryStop): string | null {
  if (entry.stop.unmappedRoom) return null;
  if (entry.stop.buildingId) return entry.stop.buildingId;
  return entry.placement.kind === "mapped" ? (entry.placement.buildingId ?? null) : null;
}

/** "2026-10-12" plus minutes after midnight, as the UTC instant campus time names. */
export function campusInstant(date: string, minutes: number): number {
  const [year, month, day] = date.split("-").map(Number);
  return resolveZonedWallTime(
    { year, month, day, hour: Math.floor(minutes / 60), minute: minutes % 60, second: 0 },
    CAMPUS_TIME_ZONE,
  );
}

/** The from and to of the events request that covers one campus date. */
export function campusDayRange(date: string): { from: string; to: string } {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
  return { from: new Date(campusInstant(date, 0)).toISOString(), to: new Date(campusInstant(next, 0)).toISOString() };
}

/** Minutes after midnight, campus time; `up` rounds a partial minute up. */
function campusMinute(epochMs: number, up: boolean): number {
  const wall = zoneWallTime(epochMs, CAMPUS_TIME_ZONE);
  return wall.hour * 60 + wall.minute + (up && (wall.second > 0 || epochMs % 1000 > 0) ? 1 : 0);
}

function tripOf(trips: TripFn, from: string | null, to: string | null): GapTrip {
  if (from === null || to === null) return null;
  const trip = trips(from, to);
  return trip === null ? null : { minutes: walkMinutesFromSeconds(trip.seconds), mode: trip.mode };
}

function placeOf(event: NormalizedEvent): GapEventPlace {
  const building = event.buildingId === null ? undefined : buildingsById.get(event.buildingId);
  if (!building) return { kind: "raw", location: event.location };
  return {
    kind: "building",
    buildingId: building.id,
    name: building.name,
    shortName: building.shortName,
    point: building.isOffCampus ? null : { lat: building.lat, lng: building.lng },
    location: event.location,
  };
}

export function gapRows({
  itinerary,
  date,
  events,
  now,
  keep = null,
  trips = campusTrip,
}: {
  itinerary: Itinerary;
  /** The campus date the itinerary is shown for, "2026-10-12". */
  date: string;
  /** The feed's events, or null when the feed is unavailable. */
  events: readonly NormalizedEvent[] | null;
  /** The minute of today when `date` is today; null otherwise. */
  now: number | null;
  /**
   * The selected event's key. It stays listed once the minute passes when
   * the student could still have reached it, so a choice never vanishes
   * from under them; it still goes when its gap ends.
   */
  keep?: string | null;
  trips?: TripFn;
}): GapRow[] {
  if (events === null || events.length === 0) return [];
  // On a day other than today the itinerary lists the weekday's classes; one
  // that doesn't meet on `date` still sits on screen, so no gap may cross it.
  const notMeeting = itinerary.stops.filter((entry) => !meetsOn(entry.stop, date));
  const classes = itinerary.stops
    .filter((entry) => meetsOn(entry.stop, date))
    .map((entry) => ({ entry, start: toMinutes(entry.stop.start), end: toMinutes(entry.stop.end), buildingId: classBuilding(entry) }))
    // eventsInGaps's own order, so the classes found below are the ones it measured from.
    .sort((a, b) => a.start - b.start);
  if (classes.length < 2) return [];

  // eventsInGaps takes seconds or nothing; the trip's mode is looked up again below.
  const walkingTime: WalkingTimeFn = (from, to) => {
    const trip = trips(from, to);
    return trip === null ? { seconds: null, source: "unknown" } : { seconds: trip.seconds, source: "campus-network" };
  };
  const schedule: DayClass[] = classes.map((meeting) => ({
    start: new Date(campusInstant(date, meeting.start)).toISOString(),
    end: new Date(campusInstant(date, meeting.end)).toISOString(),
    buildingId: meeting.buildingId,
  }));
  const placements = eventsInGaps(
    schedule,
    events.filter((event) => !event.isAllDay),
    walkingTime,
  );

  const rows = new Map<string, GapRow>();
  const keys = new Set<string>();
  for (const placement of placements) {
    const gapStart = campusMinute(Date.parse(placement.gapStart), false);
    const gapEnd = campusMinute(Date.parse(placement.gapEnd), false);
    if (gapEnd - gapStart < GAP_MIN_MINUTES) continue;
    if (now !== null && now >= gapEnd) continue;
    if (notMeeting.some((entry) => toMinutes(entry.stop.start) < gapEnd && toMinutes(entry.stop.end) > gapStart)) continue;
    // The gap runs from the end of its block's latest-ending class (the first
    // to reach that end, as eventsInGaps counts it) to the next block's earliest class.
    const from = classes.find((meeting) => meeting.end === gapStart);
    const to = classes.find((meeting) => meeting.start === gapEnd);
    const leg = to && itinerary.legs.find((candidate) => candidate.toKey === to.entry.key);
    if (!from || !to || !leg) continue;

    const { event } = placement;
    const start = campusMinute(Date.parse(event.start), false);
    const end = campusMinute(Date.parse(event.end), true);
    const place = placeOf(event);
    const eventBuilding = place.kind === "building" ? place.buildingId : null;
    const there = tripOf(trips, from.buildingId, eventBuilding);
    const back = tripOf(trips, eventBuilding, to.buildingId);
    // Rounded minutes are what the row shows, so they must fit too.
    if (there && start - gapStart < there.minutes) continue;
    if (back && gapEnd - end < back.minutes) continue;
    let key = `event:${event.sourceId}:${event.start}:${event.title}`;
    for (let copy = 2; keys.has(key); copy += 1) key = `event:${event.sourceId}:${event.start}:${event.title}:${copy}`;
    keys.add(key);
    if (now !== null && start < now + (there?.minutes ?? 0) && key !== keep) continue;

    const leave = back && back.minutes > 0 ? leaveBy(gapEnd, back.minutes) : null;

    const row = rows.get(leg.key) ?? { legKey: leg.key, from: from.entry, to: to.entry, start: gapStart, end: gapEnd, events: [] };
    row.events.push({
      key,
      title: event.title.trim(),
      url: event.url,
      start,
      end,
      place,
      to: there,
      back,
      leaveBy: leave,
      fit: back === null ? "unknown" : leave !== null && isTight(leave, end) ? "tight" : "ok",
    });
    rows.set(leg.key, row);
  }
  return [...rows.values()];
}

/** The gap event with this key, and the gap it is in; null when none has it. */
export function findGapEvent(rows: readonly GapRow[], key: string | null): { row: GapRow; event: GapEvent } | null {
  for (const row of rows) {
    const event = row.events.find((candidate) => candidate.key === key);
    if (event) return { row, event };
  }
  return null;
}

/* ---------- the feed ---------- */

const isString = (value: unknown): value is string => typeof value === "string";

/**
 * The events in a GET /api/v1/events answer, or null when the answer isn't
 * one. An event missing a field Day reads is dropped, not repaired.
 */
export function parseEventsAnswer(payload: unknown): NormalizedEvent[] | null {
  const events = (payload as { events?: unknown } | null)?.events;
  if (!Array.isArray(events)) return null;
  return events.flatMap((value): NormalizedEvent[] => {
    const event = value as Partial<Record<keyof NormalizedEvent, unknown>> | null;
    if (typeof event !== "object" || event === null) return [];
    const { sourceId, url, title, start, end, isAllDay, location, buildingId, tags } = event;
    if (!isString(sourceId) || !isString(title) || title.trim() === "" || !isString(start) || !isString(end)) return [];
    if (!Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end))) return [];
    if (typeof isAllDay !== "boolean" || !isString(location)) return [];
    if (url !== null && !isString(url)) return [];
    if (buildingId !== null && !isString(buildingId)) return [];
    // Only a web page opens from Day.
    const link = isString(url) && /^https?:\/\//i.test(url) ? url : null;
    return [
      {
        sourceId,
        url: link,
        title,
        start,
        end,
        isAllDay,
        location,
        buildingId,
        tags: Array.isArray(tags) ? tags.filter(isString) : [],
      },
    ];
  });
}
