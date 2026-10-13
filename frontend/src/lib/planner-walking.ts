import { getWalkingSeconds } from "@/lib/campus/walking-times";
import { resolveCampusBuilding } from "@/lib/campus-locations";
import { DISCOVERY_PARK_ID, meetTogether } from "@/lib/planner-sections";
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

/**
 * A trip between main campus and Discovery Park, in seconds. It is a
 * shuttle ride, not a walk. This is a starting value with no measured data
 * behind it (UNT shuttle timing); replace it when there is some.
 */
export const SHUTTLE_SECONDS = 20 * 60;

/** True for a trip between Discovery Park and a main-campus building: a shuttle ride, never routed on foot. */
export function isShuttleLeg(from: string | null | undefined, to: string | null | undefined): boolean {
  const a = from ? resolveCampusBuilding(from) : null;
  const b = to ? resolveCampusBuilding(to) : null;
  if (!a || !b || (a.id === DISCOVERY_PARK_ID) === (b.id === DISCOVERY_PARK_ID)) return false;
  return !(a.id === DISCOVERY_PARK_ID ? b : a).isOffCampus;
}

/**
 * The travel time the planner gives the optimizer: campus walkways, and the
 * shuttle's fixed time between main campus and Discovery Park, so classes
 * back to back across them read as tight or late like a long walk. The
 * optimizer's type has no shuttle source and reads only the seconds, so a
 * shuttle leg goes in as an estimate ("straight-line").
 */
export const plannerTravelTime: WalkingTimeFn = (from, to) =>
  isShuttleLeg(from, to) ? { seconds: SHUTTLE_SECONDS, source: "straight-line" } : getWalkingSeconds(from, to);

export type WalkingSummary = {
  /** Sum of every leg with an estimate, in seconds. */
  knownSeconds: number;
  knownLegs: number;
  /** Legs between back-to-back classes where a building is unknown. */
  unknownLegs: number;
  /** Trips between main campus and Discovery Park: shuttle rides, not counted as walking. */
  shuttleLegs: number;
  /** True when any known leg is a straight-line estimate. */
  estimated: boolean;
};

function toMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

type WalkEvent = Pick<ScheduleEvent, "day" | "start" | "buildingId"> & Partial<Pick<ScheduleEvent, "dates">>;

/**
 * Walking between consecutive classes on each day of the week. Two classes
 * that never meet in the same week (first and second eight-week sessions)
 * are not a walk.
 */
export function summarizeWeeklyWalking(
  events: ReadonlyArray<WalkEvent>,
  walkingTime: WalkingTimeFn = defaultWalkingTime,
): WalkingSummary {
  const summary: WalkingSummary = { knownSeconds: 0, knownLegs: 0, unknownLegs: 0, shuttleLegs: 0, estimated: false };
  const byDay = new Map<string, WalkEvent[]>();
  events.forEach((event) => {
    byDay.set(event.day, [...(byDay.get(event.day) ?? []), event]);
  });
  byDay.forEach((dayEvents) => {
    const ordered = [...dayEvents].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
    for (let index = 1; index < ordered.length; index += 1) {
      if (!meetTogether(ordered[index].day, ordered[index - 1].dates, ordered[index].dates)) continue;
      if (isShuttleLeg(ordered[index - 1].buildingId, ordered[index].buildingId)) {
        summary.shuttleLegs += 1;
        continue;
      }
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
