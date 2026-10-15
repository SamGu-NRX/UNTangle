/**
 * Which buildings the Day map colors, and in which course color.
 *
 * Every building with a class that day takes the color of its first class,
 * so a building shared by two classes keeps one stable color. Course colors
 * follow the Week grid's rule (components/schedule/week-model.ts
 * courseColor): position in the plan's course order, wrapping after six,
 * with a course missing from the order taking the first color.
 */
import type { ItineraryStop } from "@/lib/map-itinerary";

/** The --course-1 to --course-6 tokens in globals.css. */
export const COURSE_COLOR_SLOTS = 6;

export type BuildingHighlight = {
  buildingId: string;
  /** 1 to COURSE_COLOR_SLOTS: the N in --course-N. */
  slot: number;
  courseCode: string;
};

export function courseColorSlot(courseOrder: readonly string[], courseCode: string): number {
  return (Math.max(0, courseOrder.indexOf(courseCode)) % COURSE_COLOR_SLOTS) + 1;
}

/** Stops must be in class order, as the itinerary keeps them. */
export function dayBuildingHighlights(
  stops: readonly ItineraryStop[],
  courseOrder: readonly string[],
): BuildingHighlight[] {
  const byBuilding = new Map<string, BuildingHighlight>();
  for (const entry of stops) {
    if (entry.placement.kind !== "mapped" || !entry.placement.buildingId) continue;
    const buildingId = entry.placement.buildingId;
    if (byBuilding.has(buildingId)) continue;
    const courseCode = entry.stop.courseCode;
    byBuilding.set(buildingId, { buildingId, slot: courseColorSlot(courseOrder, courseCode), courseCode });
  }
  return [...byBuilding.values()];
}

/** Blend two "#rrggbb" colors: amount 0 gives `from`, 1 gives `to`. */
export function mixHex(from: string, to: string, amount: number): string {
  if (!(amount >= 0 && amount <= 1)) throw new Error(`mixHex amount must be between 0 and 1, not ${amount}`);
  const parse = (hex: string) => {
    const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
    if (!match) throw new Error(`"${hex}" is not a #rrggbb color`);
    const value = Number.parseInt(match[1], 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  };
  const a = parse(from);
  const b = parse(to);
  return `#${a
    .map((channel, index) => Math.round(channel + (b[index] - channel) * amount).toString(16).padStart(2, "0"))
    .join("")}`;
}
