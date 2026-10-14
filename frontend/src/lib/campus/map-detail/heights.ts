/**
 * How tall a campus building is drawn, from data only.
 *
 * The OpenFreeMap tiles merge every building of one height into a single
 * shape per tile, so the map draws its own buildings from OpenStreetMap
 * outlines. Each outline's height comes from the first source that has one:
 *
 * 1. OSM `height` (metres; `min_height` lifts the base);
 * 2. UNT's own floor count (fallback-heights.ts), at METRES_PER_LEVEL each;
 * 3. OSM `building:levels`, at METRES_PER_LEVEL each (`building:min_level`
 *    lifts the base);
 * 4. Overture Maps' height, which here comes from Microsoft's ML building
 *    heights: a model estimate from imagery.
 *
 * UNT's count comes before OSM levels because UNT's emergency-plan floor maps
 * count floors above ground, while OSM levels can include basements or
 * rooftop structures.
 *
 * A building none of these cover is drawn flat. Its height is unknown, and a
 * guessed box would look as certain as a measured one.
 */

export type HeightSource = "osm-height" | "osm-levels" | "fallback-table" | "overture-ml";

export type BuildingHeight =
  | { source: HeightSource; height: number; base: number }
  | { source: "none" };

/**
 * OpenMapTiles' building layer turns `building:levels` into a height at
 * 3.66 m per level; decoding the campus tiles shows three-level buildings
 * (Traditions Hall, Hurley Administration) at render_height 11. Using the same
 * factor keeps every levelled building at the height the basemap drew before.
 */
export const METRES_PER_LEVEL = 3.66;

export type FallbackHeight = {
  /** OSM element, "way/123" or "relation/123". */
  osm: string;
  name: string;
  /** Floors above ground. */
  floors: number;
  /** Where the floor count was checked: a unt.edu URL. */
  source: string;
  /** When the source was read, as an ISO date (YYYY-MM-DD). */
  retrieved: string;
};

export type HeightInputs = {
  /** The element's OSM tags. */
  tags: Readonly<Record<string, string>>;
  /** "way/123" or "relation/123", for error messages and the table. */
  osm: string;
  fallback: ReadonlyMap<string, FallbackHeight>;
  /** Overture's height in metres for this OSM element, when it has one. */
  overtureMetres?: number;
};

const FEET_TO_METRES = 0.3048;

/**
 * An OSM length tag in metres. OSM's documented forms are a bare number of
 * metres, a number with " m", or feet and inches ("52'" or "52'6\"").
 * Anything else is a tagging error the map shouldn't guess around.
 */
export function parseOsmMetres(value: string, osm: string, key: string): number {
  const text = value.trim();
  const metres = /^(\d+(?:\.\d+)?)\s*(?:m)?$/.exec(text);
  if (metres) return Number(metres[1]);
  const feet = /^(\d+(?:\.\d+)?)'(?:\s*(\d+(?:\.\d+)?)")?$/.exec(text);
  if (feet) return (Number(feet[1]) + Number(feet[2] ?? 0) / 12) * FEET_TO_METRES;
  throw new Error(`${osm}: ${key}="${value}" is not a length in metres or feet`);
}

/** An OSM level count: a whole, non-negative number. */
export function parseOsmLevels(value: string, osm: string, key: string): number {
  const text = value.trim();
  if (!/^\d+$/.test(text)) {
    throw new Error(`${osm}: ${key}="${value}" is not a whole number of levels`);
  }
  return Number(text);
}

function rounded(metres: number): number {
  return Math.round(metres * 10) / 10;
}

export function resolveHeight({ tags, osm, fallback, overtureMetres }: HeightInputs): BuildingHeight {
  if (tags.height !== undefined) {
    const height = parseOsmMetres(tags.height, osm, "height");
    const base = tags.min_height !== undefined ? parseOsmMetres(tags.min_height, osm, "min_height") : 0;
    if (base >= height) throw new Error(`${osm}: min_height ${base} m is not below height ${height} m`);
    return { source: "osm-height", height: rounded(height), base: rounded(base) };
  }
  // UNT's floors above ground beat OSM levels, which can count basements or rooftop structures.
  const entry = fallback.get(osm);
  if (entry) {
    if (!Number.isInteger(entry.floors) || entry.floors < 1) {
      throw new Error(`${osm}: the fallback table's floors must be a whole number of at least 1, not ${entry.floors}`);
    }
    return { source: "fallback-table", height: rounded(entry.floors * METRES_PER_LEVEL), base: 0 };
  }
  if (tags["building:levels"] !== undefined) {
    const levels = parseOsmLevels(tags["building:levels"], osm, "building:levels");
    const minLevel = tags["building:min_level"] !== undefined
      ? parseOsmLevels(tags["building:min_level"], osm, "building:min_level")
      : 0;
    if (levels === 0) return { source: "none" };
    if (minLevel >= levels) throw new Error(`${osm}: building:min_level ${minLevel} is not below building:levels ${levels}`);
    return { source: "osm-levels", height: rounded(levels * METRES_PER_LEVEL), base: rounded(minLevel * METRES_PER_LEVEL) };
  }
  if (overtureMetres !== undefined) {
    if (!(overtureMetres > 0)) throw new Error(`${osm}: Overture height ${overtureMetres} is not a positive number of metres`);
    return { source: "overture-ml", height: rounded(overtureMetres), base: 0 };
  }
  return { source: "none" };
}
