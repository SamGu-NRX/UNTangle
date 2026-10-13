/**
 * The day's itinerary as the map shows it: classes in time order, where each
 * one sits on the map, and the walk between each consecutive pair.
 *
 * Pure: it takes the stops, what building lookup said about them, and what
 * routing said about each pair, and returns plain data. All the honesty rules
 * live here so they are tested once:
 * - a stop that could not be placed stays in the list with its reason;
 * - only a walkway route (or ORS) has walking minutes and a "leave by" time;
 * - a straight-line estimate shows distance only, never minutes;
 * - a transfer is "late" when the walk takes longer than the break, and
 *   "tight" when it leaves two minutes or less to spare (the design's rule:
 *   walk >= gap - 2). Both are flagged.
 */
import { haversineMetersBetween } from "@/lib/campus/geo";
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
};

export type LegRoute =
  | { kind: "loading" }
  | { kind: "same-building" }
  | { kind: "walk"; source: "campus-network" | "ors"; meters: number; seconds: number; geometry: MapRoutePoint[] }
  | { kind: "straight-line"; meters: number; geometry: MapRoutePoint[] }
  | { kind: "no-route" };

export type ItineraryLeg = {
  key: string;
  fromKey: string;
  toKey: string;
  /** Minutes between the end of one class and the start of the next. Negative when they overlap. */
  gapMinutes: number;
  route: LegRoute;
  /** Rounded up, so "leave by" never promises time you don't have. Null when the walk time is unknown. */
  walkMinutes: number | null;
  /** "HH:MM" (24-hour) to leave the earlier class. Only when the walk time is known and nonzero. */
  leaveBy: string | null;
  transfer: TransferFit;
};

/** "unknown" when the walk time is unknown (lookup pending, straight-line, or no route). */
export type TransferFit = "ok" | "tight" | "late" | "unknown";

/** A transfer with this many minutes of slack or fewer counts as tight. */
export const TIGHT_SLACK_MINUTES = 2;

export function transferFit(walkMinutes: number | null, gapMinutes: number): TransferFit {
  if (walkMinutes === null) return "unknown";
  if (walkMinutes > gapMinutes) return "late";
  // Same building needs no walk, so it is never tight, however short the break.
  if (walkMinutes > 0 && walkMinutes >= gapMinutes - TIGHT_SLACK_MINUTES) return "tight";
  return "ok";
}

export type DaySummary = {
  classes: number;
  mapped: number;
  unresolved: number;
  /** Totals over legs with a walkway route only; straight-line estimates are counted in estimatedLegs. */
  walkMinutes: number;
  walkMeters: number;
  tightTransfers: number;
  /** Legs whose time is unknown: straight-line estimates. */
  estimatedLegs: number;
  loading: boolean;
};

export type Itinerary = { stops: ItineraryStop[]; legs: ItineraryLeg[]; summary: DaySummary };

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

/** "13:05" -> "1:05 PM". */
export function formatClock(value: string): string {
  const total = toMinutes(value);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  const suffix = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${suffix}`;
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

/** Whole minutes, rounded up; any nonzero walk is at least 1 minute. */
export function walkMinutesFromSeconds(seconds: number): number {
  return seconds <= 0 ? 0 : Math.max(1, Math.ceil(seconds / 60));
}

export function formatWalkMinutes(minutes: number): string {
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}

export function stopKey(stop: MapStop, index: number): string {
  return `${stop.day}-${index}-${stop.courseCode}-${stop.start}`;
}

/** Identity of a map point: the building when known, plus its coordinates. */
export function pointKey(point: MapRoutePoint, buildingId?: string): string {
  return `${buildingId ?? ""}@${point.lat.toFixed(6)},${point.lng.toFixed(6)}`;
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

/**
 * Stretches of consecutive placed stops, with repeated buildings merged.
 * Each stretch with two or more points is one routing request; an unplaced
 * stop ends a stretch, because nobody can route through it.
 */
export function routeRuns(stops: ItineraryStop[]): Array<Array<{ key: string; point: MapRoutePoint; buildingId?: string }>> {
  const runs: Array<Array<{ key: string; point: MapRoutePoint; buildingId?: string }>> = [];
  let current: Array<{ key: string; point: MapRoutePoint; buildingId?: string }> = [];
  for (const entry of stops) {
    if (entry.placement.kind !== "mapped") {
      if (current.length > 1) runs.push(current);
      current = [];
      continue;
    }
    const key = placementKey(entry.placement);
    if (current.length === 0 || current[current.length - 1].key !== key) {
      current.push({ key, point: entry.placement.point, buildingId: entry.placement.buildingId });
    }
  }
  if (current.length > 1) runs.push(current);
  return runs;
}

function legRoute(from: ItineraryStop, to: ItineraryStop, answers: ReadonlyMap<string, PairAnswer>): LegRoute {
  if (from.placement.kind !== "mapped" || to.placement.kind !== "mapped") {
    return from.placement.kind === "resolving" || to.placement.kind === "resolving" ? { kind: "loading" } : { kind: "no-route" };
  }
  const fromKey = placementKey(from.placement);
  const toKey = placementKey(to.placement);
  if (fromKey === toKey) {
    return { kind: "same-building" };
  }
  const answer = answers.get(pairKey(fromKey, toKey));
  if (answer === undefined) {
    return { kind: "loading" };
  }
  if (answer === "failed" || answer.source === "fallback") {
    // A request that never came back still has an honest answer: the
    // straight line between the two buildings, as distance only.
    const geometry = [from.placement.point, to.placement.point];
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

export function buildItinerary(
  stops: MapStop[],
  lookups: ReadonlyMap<string, StopLookup>,
  answers: ReadonlyMap<string, PairAnswer>,
): Itinerary {
  const entries: ItineraryStop[] = stops.map((stop, index) => ({
    key: stopKey(stop, index),
    number: index + 1,
    stop,
    placement: placeStop(stop, lookups.get(lookupKey(stop.location, stop.buildingId))),
  }));

  const legs: ItineraryLeg[] = entries.slice(1).map((to, index) => {
    const from = entries[index];
    const gapMinutes = toMinutes(to.stop.start) - toMinutes(from.stop.end);
    const route = legRoute(from, to, answers);
    const walkMinutes =
      route.kind === "walk" ? walkMinutesFromSeconds(route.seconds) : route.kind === "same-building" ? 0 : null;
    return {
      key: `${from.key}>${to.key}`,
      fromKey: from.key,
      toKey: to.key,
      gapMinutes,
      route,
      walkMinutes,
      leaveBy: walkMinutes ? fromMinutes(toMinutes(to.stop.start) - walkMinutes) : null,
      transfer: transferFit(walkMinutes, gapMinutes),
    };
  });

  const summary: DaySummary = {
    classes: entries.length,
    mapped: entries.filter((entry) => entry.placement.kind === "mapped").length,
    unresolved: entries.filter((entry) => entry.placement.kind === "unresolved").length,
    walkMinutes: legs.reduce((total, leg) => total + (leg.walkMinutes ?? 0), 0),
    walkMeters: legs.reduce((total, leg) => total + (leg.route.kind === "walk" ? leg.route.meters : 0), 0),
    tightTransfers: legs.filter((leg) => leg.transfer === "tight" || leg.transfer === "late").length,
    estimatedLegs: legs.filter((leg) => leg.route.kind === "straight-line").length,
    loading:
      entries.some((entry) => entry.placement.kind === "resolving") || legs.some((leg) => leg.route.kind === "loading"),
  };

  return { stops: entries, legs, summary };
}
