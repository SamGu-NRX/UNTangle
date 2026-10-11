/**
 * Today time engine — pure functions, no React and no network.
 *
 * All wall-clock arithmetic treats the schedule's HH:MM strings as
 * minutes on the SAME calendar day as `now` (dateAtMinutes), so countdowns
 * stay honest across DST changes: a 10:00 class is one hour after 09:00
 * regardless of the zone's offset that day. Weekend is derived from the
 * planner's Mon–Fri week (weekDays), so Sat/Sun have no classes by
 * construction. Building resolution failures are carried explicitly —
 * the UI never silently pretends a walk is known.
 */
import { weekDays, type ScheduleEvent, type WeekDay } from "@/lib/types";
import type { TodayRoute } from "@/components/map/route-types";

/** Places with all fields resolved; place: null means unresolvable. */
export type ResolvedPlace = {
  buildingId: string;
  buildingName: string;
  shortName: string;
  lat: number;
  lng: number;
};

export type TodayStop = {
  sectionId: string;
  courseCode: string;
  title: string;
  location: string;
  place: ResolvedPlace | null;
  start: string;
  end: string;
  startMinutes: number;
  endMinutes: number;
};

export type Phase = "before-first" | "current" | "between" | "after-last" | "no-classes";

export type TodayState = {
  phase: Phase;
  isWeekend: boolean;
  dayLabel: string | null;
  currentStop: TodayStop | null;
  previousStop: TodayStop | null;
  nextStop: TodayStop | null;
  stops: TodayStop[];
  /** Seconds until the relevant event; null when nothing is pending. */
  countdownSeconds: number | null;
  countdownKind: "until-start" | "until-end" | null;
};

export type WalkDecision =
  | { kind: "none" }
  | { kind: "same-building"; buildingName: string }
  | { kind: "unresolvable"; from: TodayStop; to: TodayStop }
  | { kind: "needs-route"; from: TodayStop; to: TodayStop };

/** Client-side fetch state for the walk card. */
export type WalkState =
  | { kind: "loading" }
  | { kind: "loaded"; route: TodayRoute }
  | { kind: "unavailable" };

/** Turns a raw schedule location (plus optional planner buildingId) into a place. */
export type BuildResolver = (location: string, buildingId?: string | null) => ResolvedPlace | undefined;

/** "Mon".."Fri" for a Date; null on the weekend. */
export function weekdayOf(date: Date): WeekDay | null {
  const idx = (date.getDay() + 6) % 7;
  return idx < 5 ? weekDays[idx] : null;
}

/** Minutes of day for an "HH:MM" 24-hour string; malformed input clamps safely. */
export function parseTimeToMinutes(time: string): number {
  const parts = time.split(":");
  const h = Number(parts[0]);
  const m = Number(parts[1] ?? "0");
  const hh = Number.isFinite(h) ? Math.min(Math.max(Math.trunc(h), 0), 23) : 0;
  const mm = Number.isFinite(m) ? Math.min(Math.max(Math.trunc(m), 0), 59) : 0;
  return hh * 60 + mm;
}

/** A wall-clock time (minutes of day) on the same calendar day as `now`. */
export function dateAtMinutes(now: Date, minutes: number): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.floor(minutes / 60), minutes % 60, 0, 0);
}

export function toTodayStops(events: ScheduleEvent[], resolve: BuildResolver): TodayStop[] {
  const toStop = (event: ScheduleEvent): TodayStop => ({
    sectionId: event.sectionId,
    courseCode: event.courseCode,
    title: event.title,
    location: event.location,
    place: resolve(event.location, event.buildingId) ?? null,
    start: event.start,
    end: event.end,
    startMinutes: parseTimeToMinutes(event.start),
    endMinutes: parseTimeToMinutes(event.end),
  });
  return [...events].sort((a, b) => parseTimeToMinutes(a.start) - parseTimeToMinutes(b.start)).map(toStop);
}

export function computeTodayState(input: {
  now: Date;
  eventsForToday: ScheduleEvent[];
  resolve: BuildResolver;
}): TodayState {
  const { now, eventsForToday, resolve } = input;
  const day = weekdayOf(now);
  const isWeekend = day === null;
  const stops = isWeekend ? [] : toTodayStops(eventsForToday, resolve);
  const emptyState: TodayState = {
    phase: "no-classes",
    isWeekend,
    dayLabel: day,
    currentStop: null,
    previousStop: null,
    nextStop: null,
    stops,
    countdownSeconds: null,
    countdownKind: null,
  };
  if (stops.length === 0) {
    return emptyState;
  }

  const first = stops[0];
  const last = stops[stops.length - 1];
  const nowMinutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const firstStart = dateAtMinutes(now, first.startMinutes);
  const lastEnd = dateAtMinutes(now, last.endMinutes);

  if (now.getTime() < firstStart.getTime()) {
    return {
      ...emptyState,
      phase: "before-first",
      currentStop: null,
      previousStop: null,
      nextStop: first,
      countdownSeconds: Math.round((firstStart.getTime() - now.getTime()) / 1000),
      countdownKind: "until-start",
    };
  }

  if (now.getTime() >= lastEnd.getTime()) {
    return {
      ...emptyState,
      phase: "after-last",
      currentStop: null,
      previousStop: last,
      nextStop: null,
      countdownSeconds: null,
      countdownKind: null,
    };
  }

  for (let i = 0; i < stops.length; i += 1) {
    const stop = stops[i];
    const startAt = dateAtMinutes(now, stop.startMinutes);
    const endAt = dateAtMinutes(now, stop.endMinutes);
    if (startAt.getTime() <= now.getTime() && now.getTime() < endAt.getTime()) {
      const next = stops[i + 1] ?? null;
      return {
        ...emptyState,
        phase: "current",
        currentStop: stop,
        previousStop: null,
        nextStop: next,
        countdownSeconds: Math.round((endAt.getTime() - now.getTime()) / 1000),
        countdownKind: "until-end",
      };
    }
    const nextStop = stops[i + 1];
    if (nextStop) {
      const nextStart = dateAtMinutes(now, nextStop.startMinutes);
      if (now.getTime() < nextStart.getTime()) {
        return {
          ...emptyState,
          phase: "between",
          currentStop: null,
          previousStop: stop,
          nextStop,
          countdownSeconds: Math.round((nextStart.getTime() - now.getTime()) / 1000),
          countdownKind: "until-start",
        };
      }
    }
  }

  return emptyState;
}

/** What the walk card should do for the current (or just-ended) → next pair. */
export function decideWalk(from: TodayStop | null, to: TodayStop | null): WalkDecision {
  if (!from || !to) {
    return { kind: "none" };
  }
  if (from.place && to.place && from.place.buildingId === to.place.buildingId) {
    return { kind: "same-building", buildingName: from.place.buildingName };
  }
  if (!from.place || !to.place) {
    return { kind: "unresolvable", from, to };
  }
  return { kind: "needs-route", from, to };
}

export type NextSchoolDay = { day: WeekDay; stop: TodayStop; daysAhead: number };

/** Where and when the next class happens, searching forward through the week.
 *  Wraps Friday → Monday and counts weekend days by calendar distance. */
export function findNextSchoolDay(input: {
  now: Date;
  stopsByDay: Partial<Record<WeekDay, TodayStop[]>>;
}): NextSchoolDay | null {
  const today = weekdayOf(input.now);
  const nowMinutes = input.now.getHours() * 60 + input.now.getMinutes() + input.now.getSeconds() / 60;
  const todayIdx = today === null ? -1 : weekDays.indexOf(today);
  // Monday=0..Sunday=6, matching the calendar even across the weekend.
  const todayIso = (input.now.getDay() + 6) % 7;
  for (let k = 0; k < weekDays.length; k += 1) {
    const i = todayIdx === -1 ? k : (todayIdx + k) % weekDays.length;
    const day = weekDays[i];
    const stops = input.stopsByDay[day] ?? [];
    const upcoming = i === todayIdx ? stops.filter((stop) => stop.startMinutes > nowMinutes) : stops;
    if (upcoming.length > 0) {
      return { day, stop: upcoming[0], daysAhead: (i - todayIso + 7) % 7 };
    }
  }
  return null;
}

/** "45 min" / "1 hr 30 min"; 0–59s shows "1 min" so the clock never reads zero. */
export function formatCountdown(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const h = Math.floor(safe / 3600);
  const rem = safe % 3600;
  if (h === 0) {
    return `${Math.max(1, Math.round(rem / 60))} min`;
  }
  const m = Math.round(rem / 60);
  if (m === 0) {
    return `${h} hr`;
  }
  if (m === 60) {
    return `${h + 1} hr`;
  }
  return `${h} hr ${m} min`;
}

/** "450 m" under a kilometre, "1.2 km" beyond; never "0 m". */
export function formatDistance(meters: number): string {
  const safe = Math.max(0, Math.round(meters));
  if (safe < 1000) {
    return `${Math.max(1, safe)} m`;
  }
  return `${(safe / 1000).toFixed(1)} km`;
}

const EARTH_RADIUS_M = 6371008.8;

export function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLng = (b.lng - a.lng) * toRad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Route normalization — the single gate between the API's response and the UI.
 * Anything unknown, malformed, or missing becomes either an honest fallback
 * route (straight-line, no time claim) or null when there is not even a
 * distance to show. Unknown sources normalize to "fallback": the fallback
 * path is exactly what the route registry maps unknown ids to.
 */
export function normalizeRouteResponse(body: unknown): TodayRoute | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const record = body as { distanceMeters?: unknown; durationSeconds?: unknown; source?: unknown; geometry?: unknown };
  const distanceMeters = typeof record.distanceMeters === "number" && Number.isFinite(record.distanceMeters) ? record.distanceMeters : null;
  if (distanceMeters === null || distanceMeters < 0) {
    return null;
  }
  const durationSeconds = typeof record.durationSeconds === "number" && Number.isFinite(record.durationSeconds) && record.durationSeconds >= 0 ? record.durationSeconds : 0;
  const rawGeometry = Array.isArray(record.geometry) ? record.geometry : [];
  const geometry: { lat: number; lng: number }[] = [];
  for (const point of rawGeometry) {
    if (typeof point === "object" && point !== null) {
      const pt = point as { lat?: unknown; lng?: unknown };
      if (typeof pt.lat === "number" && Number.isFinite(pt.lat) && typeof pt.lng === "number" && Number.isFinite(pt.lng)) {
        geometry.push({ lat: pt.lat, lng: pt.lng });
      }
    }
  }
  const rawSource = record.source;
  let source: TodayRoute["source"] = "fallback";
  if (rawSource === "ors" || rawSource === "campus-network") {
    source = rawSource;
  }
  return { geometry, distanceMeters, durationSeconds, source };
}
