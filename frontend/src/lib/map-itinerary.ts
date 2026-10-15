/**
 * The day's itinerary as the map shows it: classes in time order, where each
 * one sits on the map, and the walk between each consecutive pair.
 *
 * Pure: it takes the stops, what building lookup said about them, and what
 * routing said about each pair, and returns plain data. All the honesty rules
 * live here so they are tested once:
 * - a stop that could not be placed stays in the list with its reason;
 * - only a walkway route (or ORS) has walking minutes and a "leave by" time;
 * - a straight-line estimate has no minutes, only an approximate distance;
 * - a transfer is "late" when the walk takes longer than the break, and
 *   "tight" when leaving on time means leaving as the earlier class ends
 *   (lib/leave-by.ts). Both are flagged;
 * - two classes that never meet in the same week (first and second
 *   eight-week sessions) have no walk between them;
 * - main campus to Discovery Park is a shuttle ride with a fixed estimate,
 *   never routed on foot; it can be tight or late like a walk;
 * - the walk from the student's starting point to the first class is the
 *   day's first leg, when a starting point is set.
 */
import { haversineMetersBetween } from "@/lib/campus/geo";
import { stopIdentity } from "@/lib/campus/route-legs";
import { walkingMinutes } from "@/lib/campus/speeds";
import { isTight, leaveBy } from "@/lib/leave-by";
import { DISCOVERY_PARK_ID, meetTogether, rangeLabel } from "@/lib/planner-sections";
import { isShuttleLeg, SHUTTLE_SECONDS } from "@/lib/planner-walking";
import type { MapResolvedLocation, MapRouteLeg, MapRoutePoint, MapStop } from "@/lib/types";

/** What building lookup said about a stop that arrived without coordinates. */
export type StopLookup =
  | { kind: "resolved"; location: MapResolvedLocation & { lat: number; lng: number } }
  | { kind: "unresolved"; location: MapResolvedLocation }
  | { kind: "failed" };

export type UnresolvedReason = "off-campus" | "unknown" | "lookup-failed";

export type StopPlacement =
  | {
      kind: "mapped";
      point: MapRoutePoint;
      buildingId?: string;
      buildingName: string;
      shortName: string;
      via: "registry" | "geocoded";
    }
  | { kind: "resolving" }
  | { kind: "unresolved"; reason: UnresolvedReason; message: string };

export type ItineraryStop = {
  key: string;
  /** Class order for the day, starting at 1. Unplaced stops keep their number. */
  number: number;
  stop: MapStop;
  placement: StopPlacement;
  /** "Mar 15 – May 7" when this class runs on other dates than most of the day's; otherwise null. */
  ownDates: string | null;
};

export type LegRoute =
  | { kind: "loading" }
  | { kind: "same-building" }
  | { kind: "walk"; source: "campus-network" | "ors"; meters: number; seconds: number; geometry: MapRoutePoint[] }
  | { kind: "straight-line"; meters: number; geometry: MapRoutePoint[] }
  | { kind: "no-route" }
  /** The two classes never meet in the same week, so nobody walks between them. */
  | { kind: "other-weeks" }
  /** Main campus to or from Discovery Park: a shuttle ride (SHUTTLE_SECONDS), not a walk. */
  | { kind: "shuttle"; seconds: number };

export type ItineraryLeg = {
  key: string;
  /** The earlier stop's key, or START_KEY for the walk from the starting point. */
  fromKey: string;
  toKey: string;
  /** Minutes between the end of one class and the start of the next (negative when they overlap); null from the starting point. */
  gapMinutes: number | null;
  route: LegRoute;
  /** Rounded up, so "leave by" never promises time you don't have. Null when the walk time is unknown. */
  walkMinutes: number | null;
  /**
   * When to leave, in minutes after midnight (lib/leave-by.ts), never before
   * the earlier class ends. Only when the walk time is known and nonzero.
   */
  leaveAt: number | null;
  transfer: TransferFit;
};

/** "unknown" when the walk time is unknown (lookup pending, straight-line, or no route). */
export type TransferFit = "ok" | "tight" | "late" | "unknown";

export function transferFit(walkMinutes: number | null, gapMinutes: number): TransferFit {
  if (walkMinutes === null) return "unknown";
  if (walkMinutes > gapMinutes) return "late";
  // Same building needs no walk, so it is never tight, however short the break.
  // Measured from the earlier class's end, which is minute 0 here.
  if (walkMinutes > 0 && isTight(leaveBy(gapMinutes, walkMinutes), 0)) return "tight";
  return "ok";
}

/** Where the student's day begins, such as their residence hall. */
export type StartPlace = { name: string; point: MapRoutePoint };

/** The fromKey of the walk from the starting point. */
export const START_KEY = "start";

/**
 * The day's walking, in minutes: the walk from the starting point and every
 * walk between classes with a known time. Shuttle rides aren't walking, and
 * a straight-line estimate has no time to add.
 */
export function dayWalkMinutes(itinerary: Itinerary): number {
  const legs = itinerary.start ? [itinerary.start.leg, ...itinerary.legs] : itinerary.legs;
  return legs.reduce((total, leg) => total + (leg.route.kind === "walk" ? (leg.walkMinutes ?? 0) : 0), 0);
}

export type Itinerary = {
  /** The starting point and the walk from it to the first class; null with no starting point or no classes. */
  start: { place: StartPlace; leg: ItineraryLeg } | null;
  stops: ItineraryStop[];
  /** Walks between consecutive classes; legs[i] runs from stops[i] to stops[i + 1]. */
  legs: ItineraryLeg[];
};

/** A routing answer for one ordered pair of map points. "failed" means the request did not return. */
export type PairAnswer = MapRouteLeg | "failed";

export function toMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function fromMinutes(total: number): string {
  const wrapped = ((total % 1440) + 1440) % 1440;
  const hours = Math.floor(wrapped / 60);
  const minutes = wrapped % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

const metersPerMile = 1609.344;
const feetPerMeter = 3.28084;

/** US units, like the campus signs: feet under a tenth of a mile, then miles. */
export function formatDistance(meters: number): string {
  const miles = meters / metersPerMile;
  if (miles < 0.1) {
    return `${Math.max(10, Math.round((meters * feetPerMeter) / 10) * 10)} ft`;
  }
  return `${miles.toFixed(miles < 10 ? 1 : 0)} mi`;
}

/**
 * Minutes after midnight on a 12-hour clock, and its half of the day:
 * { clock: "8:49", half: "AM" }. Day always shows the half, because an
 * evening class makes a bare "8:00" ambiguous.
 */
export function clockParts(total: number): { clock: string; half: "AM" | "PM" } {
  const wrapped = ((total % 1440) + 1440) % 1440;
  const hours = Math.floor(wrapped / 60);
  return { clock: `${hours % 12 === 0 ? 12 : hours % 12}:${String(wrapped % 60).padStart(2, "0")}`, half: hours < 12 ? "AM" : "PM" };
}

/** "8:49 AM", "1:05 PM". */
export function formatTime(total: number): string {
  const { clock, half } = clockParts(total);
  return `${clock} ${half}`;
}

/** Whole minutes, rounded up; the campus-wide rule in lib/campus/speeds.ts. */
export const walkMinutesFromSeconds = walkingMinutes;

export function formatWalkMinutes(minutes: number): string {
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}

/** A shared pin's label for the stop numbers it stands for: "1", "2–3", "1, 4". Numbers must be ascending. */
export function stopNumbersLabel(numbers: readonly number[]): string {
  if (numbers.length === 0) throw new Error("stopNumbersLabel needs at least one stop number");
  const parts: string[] = [];
  let start = numbers[0];
  let previous = numbers[0];
  for (const value of [...numbers.slice(1), Number.NaN]) {
    if (value === previous + 1) {
      previous = value;
      continue;
    }
    parts.push(start === previous ? String(start) : `${start}–${previous}`);
    start = value;
    previous = value;
  }
  return parts.join(", ");
}

export function stopKey(stop: MapStop, index: number): string {
  return `${stop.day}-${index}-${stop.courseCode}-${stop.start}`;
}

/** Identity of a map point: the route API's own stop identity rule, so client and server count the same legs. */
export function pointKey(point: MapRoutePoint, buildingId?: string): string {
  return stopIdentity(point, buildingId);
}

export function pairKey(from: string, to: string): string {
  return `${from}>${to}`;
}

/** Identity of a stop for building lookup. Must match what the lookup echoes back. */
export function lookupKey(location: string, buildingId?: string): string {
  return `${buildingId ?? ""}|${location.trim().toLowerCase()}`;
}

function unresolvedMessage(stop: MapStop, reason: UnresolvedReason, name: string): string {
  switch (reason) {
    case "off-campus":
      return `${name} is off the main campus, so there's no walking route to it.`;
    case "unknown":
      return `"${stop.location}" isn't in the campus building list.`;
    case "lookup-failed":
      return "The building lookup didn't respond. It will try again.";
  }
}

export function placeStop(stop: MapStop, lookup: StopLookup | undefined): StopPlacement {
  if (stop.unmappedRoom) {
    return { kind: "unresolved", reason: "unknown", message: unresolvedMessage(stop, "unknown", stop.buildingName) };
  }
  if (typeof stop.lat === "number" && typeof stop.lng === "number") {
    return {
      kind: "mapped",
      point: { lat: stop.lat, lng: stop.lng },
      buildingId: stop.buildingId,
      buildingName: stop.buildingName,
      shortName: stop.shortName,
      via: "registry",
    };
  }
  if (!lookup) {
    return { kind: "resolving" };
  }
  if (lookup.kind === "failed") {
    return { kind: "unresolved", reason: "lookup-failed", message: unresolvedMessage(stop, "lookup-failed", stop.buildingName) };
  }
  if (lookup.kind === "unresolved") {
    const reason: UnresolvedReason = lookup.location.unsupportedReason ? "off-campus" : "unknown";
    return { kind: "unresolved", reason, message: unresolvedMessage(stop, reason, lookup.location.buildingName) };
  }
  return {
    kind: "mapped",
    point: { lat: lookup.location.lat, lng: lookup.location.lng },
    buildingId: lookup.location.buildingId,
    buildingName: lookup.location.buildingName,
    shortName: lookup.location.shortName,
    via: lookup.location.resolutionStatus === "geocoded" ? "geocoded" : "registry",
  };
}

type MappedPlacement = Extract<StopPlacement, { kind: "mapped" }>;

export function placementKey(placement: MappedPlacement): string {
  return pointKey(placement.point, placement.buildingId);
}

export type RunPoint = { key: string; point: MapRoutePoint; buildingId?: string };

function startPoint(start: StartPlace): RunPoint {
  return { key: pointKey(start.point), point: start.point };
}

/**
 * Stretches of consecutive placed stops, with repeated buildings merged.
 * Each stretch with two or more points is one routing request; an unplaced
 * stop ends a stretch, because nobody can route through it. The walk from
 * the starting point to the first class is a request of its own.
 */
export function routeRuns(stops: ItineraryStop[], start: StartPlace | null = null): RunPoint[][] {
  const runs: RunPoint[][] = [];
  const first = stops[0]?.placement;
  if (start && first?.kind === "mapped" && placementKey(first) !== startPoint(start).key) {
    runs.push([startPoint(start), { key: placementKey(first), point: first.point, buildingId: first.buildingId }]);
  }
  let current: RunPoint[] = [];
  let previous: ItineraryStop | null = null;
  for (const entry of stops) {
    // Nothing is routed between classes in different weeks, or across the shuttle.
    const apart = previous !== null && (!sameWeeks(previous.stop, entry.stop) || isShuttleLeg(previous.stop.buildingId, entry.stop.buildingId));
    previous = entry;
    if (entry.placement.kind !== "mapped" || apart) {
      if (current.length > 1) runs.push(current);
      current = [];
      if (entry.placement.kind !== "mapped") continue;
    }
    const key = placementKey(entry.placement);
    if (current.length === 0 || current[current.length - 1].key !== key) {
      current.push({ key, point: entry.placement.point, buildingId: entry.placement.buildingId });
    }
  }
  if (current.length > 1) runs.push(current);
  return runs;
}

function sameWeeks(a: MapStop, b: MapStop): boolean {
  return meetTogether(a.day, a.dates, b.dates);
}

function legRoute(from: ItineraryStop, to: ItineraryStop, answers: ReadonlyMap<string, PairAnswer>): LegRoute {
  if (!sameWeeks(from.stop, to.stop)) {
    return { kind: "other-weeks" };
  }
  if (isShuttleLeg(from.stop.buildingId, to.stop.buildingId)) {
    return { kind: "shuttle", seconds: SHUTTLE_SECONDS };
  }
  if (from.placement.kind !== "mapped" || to.placement.kind !== "mapped") {
    return from.placement.kind === "resolving" || to.placement.kind === "resolving" ? { kind: "loading" } : { kind: "no-route" };
  }
  return routeBetween(
    { key: placementKey(from.placement), point: from.placement.point },
    { key: placementKey(to.placement), point: to.placement.point },
    answers,
  );
}

/** The route between two map points from the routing answers: loading, the same building, a walk, or a straight line when routing failed. */
export function routeBetween(from: RunPoint, to: RunPoint, answers: ReadonlyMap<string, PairAnswer>): LegRoute {
  if (from.key === to.key) {
    return { kind: "same-building" };
  }
  const answer = answers.get(pairKey(from.key, to.key));
  if (answer === undefined) {
    return { kind: "loading" };
  }
  if (answer === "failed" || answer.source === "fallback") {
    // A request that never came back still has an honest answer: the
    // straight line between the two places, with no walking time.
    const geometry = [from.point, to.point];
    const meters = answer === "failed" ? haversineMetersBetween(geometry[0], geometry[1]) : answer.distanceMeters;
    return { kind: "straight-line", meters, geometry: answer === "failed" ? geometry : answer.geometry };
  }
  return {
    kind: "walk",
    source: answer.source,
    meters: answer.distanceMeters,
    seconds: answer.durationSeconds,
    geometry: answer.geometry,
  };
}

function routeMinutes(route: LegRoute): number | null {
  if (route.kind === "walk" || route.kind === "shuttle") return walkMinutesFromSeconds(route.seconds);
  return route.kind === "same-building" ? 0 : null;
}

function startLeg(start: StartPlace, first: ItineraryStop, answers: ReadonlyMap<string, PairAnswer>): ItineraryLeg {
  const { placement } = first;
  // Starting points are on main campus (they're limited to the routing
  // bounds), so a first class at Discovery Park is the shuttle ride.
  const route: LegRoute =
    first.stop.buildingId === DISCOVERY_PARK_ID
      ? { kind: "shuttle", seconds: SHUTTLE_SECONDS }
      : placement.kind === "mapped"
        ? routeBetween(startPoint(start), { key: placementKey(placement), point: placement.point }, answers)
        : placement.kind === "resolving"
          ? { kind: "loading" }
          : { kind: "no-route" };
  const walkMinutes = routeMinutes(route);
  return {
    key: `${START_KEY}>${first.key}`,
    fromKey: START_KEY,
    toKey: first.key,
    gapMinutes: null,
    route,
    walkMinutes,
    leaveAt: walkMinutes ? leaveBy(toMinutes(first.stop.start), walkMinutes) : null,
    transfer: "ok",
  };
}

export function buildItinerary(
  stops: MapStop[],
  lookups: ReadonlyMap<string, StopLookup>,
  answers: ReadonlyMap<string, PairAnswer>,
  start: StartPlace | null = null,
): Itinerary {
  const labels = stops.map((stop) => rangeLabel(stop.dates));
  const counts = new Map<string, number>();
  labels.forEach((label) => label && counts.set(label, (counts.get(label) ?? 0) + 1));
  // The day's most common range, when one range is; otherwise every stop shows its dates.
  const [first, second] = [...counts].sort((a, b) => b[1] - a[1]);
  const usual = first && (!second || first[1] > second[1]) ? first[0] : null;
  const entries: ItineraryStop[] = stops.map((stop, index) => ({
    key: stopKey(stop, index),
    number: index + 1,
    stop,
    placement: placeStop(stop, lookups.get(lookupKey(stop.location, stop.buildingId))),
    ownDates: labels[index] !== usual ? labels[index] : null,
  }));

  const legs: ItineraryLeg[] = entries.slice(1).map((to, index) => {
    const from = entries[index];
    const gapMinutes = toMinutes(to.stop.start) - toMinutes(from.stop.end);
    const route = legRoute(from, to, answers);
    const walkMinutes = routeMinutes(route);
    const previousEnd = toMinutes(from.stop.end);
    return {
      key: `${from.key}>${to.key}`,
      fromKey: from.key,
      toKey: to.key,
      gapMinutes,
      route,
      walkMinutes,
      leaveAt: walkMinutes ? Math.max(leaveBy(toMinutes(to.stop.start), walkMinutes), previousEnd) : null,
      transfer: route.kind === "other-weeks" ? "ok" : transferFit(walkMinutes, gapMinutes),
    };
  });

  return {
    start: start && entries.length > 0 ? { place: start, leg: startLeg(start, entries[0], answers) } : null,
    stops: entries,
    legs,
  };
}
