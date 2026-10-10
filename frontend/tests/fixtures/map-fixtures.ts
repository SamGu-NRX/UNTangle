// Shared fixtures for /map client-state tests. Sections are selected
// dynamically from the generated course catalog so the fixtures stay honest
// when the seed data changes; each scenario pins a course + preferred
// building and resolves the concrete section id at runtime.
import seedJson from "../../src/lib/generated/seed-data.json";

export type PickedSection = {
  courseCode: string;
  buildingId?: string;
};

type SeedSection = {
  id: string;
  courseCode: string;
  meetings: Array<{ day: string; start: string; end: string; buildingId: string }>;
};

type SeedBuilding = {
  id: string;
  name: string;
  shortName: string;
  lat: number;
  lng: number;
};

const sections = seedJson.sections as unknown as SeedSection[];
const buildings = seedJson.buildings as unknown as SeedBuilding[];

function toMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function overlaps(a: { start: string; end: string }, b: { start: string; end: string }) {
  return toMinutes(a.start) < toMinutes(b.end) && toMinutes(b.start) < toMinutes(a.end);
}

/** First Monday section for a course in a given building (deterministic id order). */
export function monSectionId(courseCode: string, buildingId?: string) {
  const candidates = sections
    .filter((section) => section.courseCode === courseCode)
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const section of candidates) {
    const monday = section.meetings.find((meeting) => meeting.day === "Mon");
    if (monday && (!buildingId || monday.buildingId === buildingId)) {
      return section.id;
    }
  }
  return null;
}

export function buildingCoordsById(buildingId: string) {
  const building = buildings.find((entry) => entry.id === buildingId);
  if (!building) {
    throw new Error(`Unknown building id in fixtures: ${buildingId}`);
  }
  return { lat: building.lat, lng: building.lng, name: building.name, shortName: building.shortName };
}

/** Scenario: three stops across three different buildings, MATH 1710 first. */
export function multiStopMondayPicks(): PickedSection[] {
  return [
    { courseCode: "MATH 1710" },
    { courseCode: "ANTH 1010", buildingId: "gab" },
    { courseCode: "ANTH 1150", buildingId: "chem" },
  ];
}

/** Scenario: a genuinely one-stop Monday. */
export function singleStopMondayPicks(): PickedSection[] {
  return [{ courseCode: "ANTH 1010", buildingId: "gab" }];
}

/** Scenario: two stops land in the same building on the same day. */
export function duplicateStopMondayPicks(): PickedSection[] {
  return [
    { courseCode: "ANTH 1010", buildingId: "life" },
    { courseCode: "ANTH 1150", buildingId: "life" },
    { courseCode: "ANTH 2400", buildingId: "gab" },
  ];
}

/** Scenario: Discovery Park sits outside the mapped campus bounds. */
export function unresolvedStopMondayPicks(): PickedSection[] {
  return [
    { courseCode: "ANTH 1010", buildingId: "gab" },
    { courseCode: "BMEN 1400", buildingId: "ntdp" },
  ];
}

/**
 * Builds a guest planner seed that hydrates exactly the picked sections:
 * every default "inProgress" status is demoted to "notTaken" so nothing
 * outside the scenario is active, then each picked course is marked
 * "inProgress" with its resolved section id.
 */
export function plannerStateFromPicks(activeDay: string, picks: PickedSection[]) {
  const seedStatuses = (seedJson as unknown as { courseStatuses: Record<string, string> }).courseStatuses;
  const courseStatuses: Record<string, string> = {};
  for (const [courseCode, status] of Object.entries(seedStatuses)) {
    courseStatuses[courseCode] = status === "inProgress" ? "notTaken" : status;
  }
  const selectedSections: Record<string, string> = {};
  for (const pick of picks) {
    const sectionId = monSectionId(pick.courseCode, pick.buildingId);
    if (!sectionId) {
      throw new Error(`No Monday section found for ${pick.courseCode} in ${pick.buildingId ?? "any building"}`);
    }
    courseStatuses[pick.courseCode] = "inProgress";
    selectedSections[pick.courseCode] = sectionId;
  }
  return {
    courseStatuses,
    selectedSections,
    optimization: "clusterMorning",
    activeDay,
    selectedMajor: null,
    transcriptRecords: [],
    updatedAt: new Date().toISOString(),
  };
}

/** Identity-aligned fake for POST /api/map/resolve: echoes the request order. */
export function fakeResolveLocations(
  locations: ReadonlyArray<{ location: string; buildingId?: string }>,
  resolvedByKey: Map<string, { lat: number; lng: number; name?: string; shortName?: string }>,
) {
  return {
    locations: locations.map((entry) => {
      const key = `${entry.buildingId ?? ""}|${entry.location.trim().toLowerCase()}`;
      const resolved = resolvedByKey.get(key);
      return {
        location: entry.location,
        buildingId: entry.buildingId,
        buildingName: resolved?.name ?? `Building ${entry.buildingId ?? "unknown"}`,
        shortName: resolved?.shortName ?? (entry.buildingId ?? "?").toUpperCase(),
        lat: resolved?.lat,
        lng: resolved?.lng,
        resolutionStatus: resolved ? ("geocoded" as const) : ("unresolved" as const),
        geocodeQuery: entry.location,
        ...(resolved ? {} : { unsupportedReason: "outside mapped campus bounds" }),
      };
    }),
  };
}

/** Fake for POST /api/map/route returning the app's MapRouteResponse shape. */
export function fakeOrsRouteResponse(stops: Array<{ lat: number; lng: number }>) {
  const coordinates = stops.length > 0 ? [...stops, stops[stops.length - 1]] : [];
  return {
    geometry: coordinates,
    distanceMeters: 1200 * Math.max(stops.length - 1, 1),
    durationSeconds: 900 * Math.max(stops.length - 1, 1),
    source: "ors" as const,
  };
}

/** 1x1 transparent PNG served in place of OSM tiles. */
export const fixtureTilePngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
