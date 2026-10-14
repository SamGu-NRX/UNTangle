/**
 * Floor counts for UNT buildings that OpenStreetMap gives no height or
 * levels for. An entry here outranks Overture's ML estimate (heights.ts), so
 * every entry must cite where its floor count was checked: a UNT page, or a
 * dated photo or visit.
 *
 * TODO: add checked floor counts for the campus buildings the map-detail
 * build lists as "flat campus buildings" (tools/campus-geodata/build-map-detail.ts),
 * starting with the Dance and Theatre Building (DATH, way/518915918), a
 * registry building. Until then they are drawn flat.
 * Adding the floors to OpenStreetMap as building:levels is better still: it
 * fixes every map at once and needs no entry here.
 */
import type { FallbackHeight } from "@/lib/campus/map-detail/heights";

export const untFallbackHeights: readonly FallbackHeight[] = [];
