import type { CampusBounds } from "@/lib/campus/config";
import type { StartPlace } from "@/lib/map-itinerary";

/** A place a student can start the day from, as the starting-point search lists it. */
export type StartPlaceOption = StartPlace & { id: string; code: string | null };

type FootprintFile = {
  buildings: ReadonlyArray<{ osmId: number; name: string | null; centroid: readonly number[]; areaM2: number }>;
};

/**
 * Every named building in the campus footprint file, for the starting-point
 * search. The routing registry lists only buildings that hold classes, so
 * residence halls such as Kerr Hall come from here. "Kerr Hall (KERR)"
 * becomes the name "Kerr Hall" and the code "KERR"; a name used twice keeps
 * its larger footprint. A building outside the routing bounds is left out:
 * routing refuses it, so it could never give a walking time. Server-side
 * only: the file is 390 KB, the list is a few KB.
 */
export function startPlaces(file: FootprintFile, bounds: CampusBounds): StartPlaceOption[] {
  const byName = new Map<string, { option: StartPlaceOption; area: number }>();
  for (const building of file.buildings) {
    const raw = building.name?.trim();
    if (!raw) continue;
    const match = /^(.*\S)\s*\(([A-Z0-9 ]+)\)$/.exec(raw);
    const name = match ? match[1] : raw;
    const existing = byName.get(name);
    if (existing && existing.area >= building.areaM2) continue;
    if (building.centroid.length !== 2) {
      throw new Error(`Building ${building.osmId} has a centroid of ${building.centroid.length} numbers, not [lat, lng]`);
    }
    const [lat, lng] = building.centroid;
    if (lat < bounds.south || lat > bounds.north || lng < bounds.west || lng > bounds.east) continue;
    byName.set(name, {
      option: { id: String(building.osmId), name, code: match ? match[2] : null, point: { lat, lng } },
      area: building.areaM2,
    });
  }
  return [...byName.values()].map(({ option }) => option).sort((a, b) => a.name.localeCompare(b.name));
}

/** Search by name or code; a name that starts with the query ranks first. */
export function searchStartPlaces(places: readonly StartPlaceOption[], query: string, limit = 12): StartPlaceOption[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const starts: StartPlaceOption[] = [];
  const contains: StartPlaceOption[] = [];
  for (const place of places) {
    const name = place.name.toLowerCase();
    if (name.startsWith(needle) || place.code?.toLowerCase() === needle) starts.push(place);
    else if (name.includes(needle) || place.code?.toLowerCase().startsWith(needle)) contains.push(place);
  }
  return [...starts, ...contains].slice(0, limit);
}
