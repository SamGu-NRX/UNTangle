/**
 * Paints the day's class buildings in their course colors and moves their
 * labels to the top label layer. Instant, like every other paint change on
 * the map: day switches are frequent, and MOTION.md keeps paint unanimated.
 *
 * Only for a campus with map detail (campus-style.ts); a no-op otherwise.
 */
import type { FilterSpecification, Map as MapLibreMap } from "maplibre-gl";
import { BUILDING_TONE, DETAIL_SOURCE, LABEL_ANCHOR_LAYER, QUIET_LABEL_LAYER } from "@/components/map/campus-style";
import { mixHex, type BuildingHighlight } from "@/lib/campus/map-detail/highlight";

/**
 * How much of the course color a class building takes over the campus tone.
 * Enough to find it among quiet neighbours at a glance, light enough that
 * the green route and pins stay the strongest marks. Judged by eye in the
 * PR's captures; no user testing behind it.
 */
const COURSE_AMOUNT = 0.62;

/** The --course-N token, read from the page so the map and the Week grid share one source. */
function courseToken(slot: number): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(`--course-${slot}`).trim();
  if (!/^#[0-9a-f]{6}$/i.test(value)) {
    throw new Error(`The map's building highlight needs --course-${slot} as a #rrggbb color in globals.css, found "${value}"`);
  }
  return value;
}

/** Ids colored last time, per map, so a day switch can clear them. */
const painted = new WeakMap<MapLibreMap, string[]>();

export function setBuildingHighlights(map: MapLibreMap, highlights: readonly BuildingHighlight[]) {
  if (!map.getSource(DETAIL_SOURCE)) return;
  for (const id of painted.get(map) ?? []) map.removeFeatureState({ source: DETAIL_SOURCE, id }, "color");
  for (const { buildingId, slot } of highlights) {
    map.setFeatureState({ source: DETAIL_SOURCE, id: buildingId }, { color: mixHex(BUILDING_TONE.campus, courseToken(slot), COURSE_AMOUNT) });
  }
  const ids = highlights.map((highlight) => highlight.buildingId);
  painted.set(map, ids);
  const isClass: FilterSpecification = ["in", ["get", "c"], ["literal", ids]];
  map.setFilter(LABEL_ANCHOR_LAYER, ["all", ["==", ["get", "k"], "lb"], isClass]);
  map.setFilter(QUIET_LABEL_LAYER, ["all", ["==", ["get", "k"], "lb"], ["!", isClass]]);
}
