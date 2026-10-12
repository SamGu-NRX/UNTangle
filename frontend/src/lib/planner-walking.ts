import { buildings } from "@/lib/seed-data";
import type { CampusBuilding, ScheduleEvent } from "@/lib/types";

/**
 * Walking time between two buildings, with where the number came from.
 *
 * The planner has no campus path network yet, so the default estimate is the
 * straight-line distance at a walking pace. An unknown building has no
 * estimate at all: it is reported as `unknown`, never as 0 seconds, so a
 * schedule cannot look short because a building could not be found.
 */
export type WalkingTime =
  | { seconds: number; source: "campus-network" | "straight-line" }
  | { seconds: null; source: "unknown" };

export type WalkingTimeFn = (fromBuildingId: string, toBuildingId: string) => WalkingTime;

/**
 * 1.4 m/s is the commonly cited average adult walking speed. It has not been
 * measured on UNT's campus; treat results as estimates.
 */
export const WALKING_SPEED_METERS_PER_SECOND = 1.4;

const EARTH_RADIUS_METERS = 6_371_000;

function haversineMeters(a: Pick<CampusBuilding, "lat" | "lng">, b: Pick<CampusBuilding, "lat" | "lng">) {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

export function createStraightLineWalkingTime(
  knownBuildings: ReadonlyArray<Pick<CampusBuilding, "id" | "lat" | "lng">>,
): WalkingTimeFn {
  const byId = new Map(knownBuildings.map((building) => [building.id, building] as const));
  return (fromBuildingId, toBuildingId) => {
    const from = byId.get(fromBuildingId);
    const to = byId.get(toBuildingId);
    if (!from || !to) {
      return { seconds: null, source: "unknown" };
    }
    if (fromBuildingId === toBuildingId) {
      // Staying in the same building needs no walk between buildings.
      return { seconds: 0, source: "campus-network" };
    }
    return {
      seconds: Math.round(haversineMeters(from, to) / WALKING_SPEED_METERS_PER_SECOND),
      source: "straight-line",
    };
  };
}

/** Default estimate over the bundled building list. */
export const defaultWalkingTime: WalkingTimeFn = createStraightLineWalkingTime(buildings);

export type WalkingSummary = {
  /** Sum of every leg with an estimate, in seconds. */
  knownSeconds: number;
  knownLegs: number;
  /** Legs between back-to-back classes where a building is unknown. */
  unknownLegs: number;
  /** True when any known leg is a straight-line estimate. */
  estimated: boolean;
};

function toMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

/** Walking between consecutive classes on each day of the week. */
export function summarizeWeeklyWalking(
  events: ReadonlyArray<Pick<ScheduleEvent, "day" | "start" | "buildingId">>,
  walkingTime: WalkingTimeFn = defaultWalkingTime,
): WalkingSummary {
  const summary: WalkingSummary = { knownSeconds: 0, knownLegs: 0, unknownLegs: 0, estimated: false };
  const byDay = new Map<string, Array<Pick<ScheduleEvent, "day" | "start" | "buildingId">>>();
  events.forEach((event) => {
    byDay.set(event.day, [...(byDay.get(event.day) ?? []), event]);
  });
  byDay.forEach((dayEvents) => {
    const ordered = [...dayEvents].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
    for (let index = 1; index < ordered.length; index += 1) {
      const leg = walkingTime(ordered[index - 1].buildingId ?? "", ordered[index].buildingId ?? "");
      if (leg.source === "unknown") {
        summary.unknownLegs += 1;
        continue;
      }
      summary.knownSeconds += leg.seconds;
      summary.knownLegs += 1;
      if (leg.source === "straight-line") {
        summary.estimated = true;
      }
    }
  });
  return summary;
}
