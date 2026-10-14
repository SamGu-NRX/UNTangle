import { describe, expect, test } from "bun:test";
import { DETAIL_SOURCE, LABEL_ANCHOR_LAYER, QUIET_LABEL_LAYER, campusAttribution, campusMapStyle } from "@/components/map/campus-style";
import { untDenton, utAustin } from "@/lib/campus/config";

const ids = (style: ReturnType<typeof campusMapStyle>) => style.layers.map((layer) => layer.id);

describe("campus map style", () => {
  test("UNT draws its own buildings and drops the tiles' merged extrusions", () => {
    const style = campusMapStyle(untDenton);
    expect(style.sources[DETAIL_SOURCE]).toEqual({ type: "geojson", data: "/map/unt-denton/detail.geojson", promoteId: "c" });
    expect(ids(style)).not.toContain("building-3d");
    expect(ids(style)).toContain("detail-building-3d");
  });

  test("the class-label layer is the route anchor and sits on top, above the quiet labels", () => {
    const layers = ids(campusMapStyle(untDenton));
    expect(layers[layers.length - 1]).toBe(LABEL_ANCHOR_LAYER);
    expect(layers.indexOf(QUIET_LABEL_LAYER)).toBeLessThan(layers.indexOf(LABEL_ANCHOR_LAYER));
    expect(layers.indexOf("road-label")).toBeLessThan(layers.indexOf(QUIET_LABEL_LAYER));
  });

  test("a campus without map detail keeps the tile buildings and the registry labels", () => {
    const style = campusMapStyle(utAustin);
    expect(style.sources[DETAIL_SOURCE]).toBeUndefined();
    expect(ids(style)).toContain("building-3d");
    expect(ids(style)).toContain(LABEL_ANCHOR_LAYER);
  });

  test("campuses without detail keep basemap parking, while detail replaces it", () => {
    const fallback = campusMapStyle(utAustin);
    expect(fallback.layers.find((layer) => layer.id === "parking")).toMatchObject({
      type: "fill",
      source: "openmaptiles",
      "source-layer": "landuse",
      minzoom: 14,
      filter: ["==", ["get", "class"], "parking"],
      paint: { "fill-color": "#e2e1dd" },
    });
    expect(ids(fallback).indexOf("parking")).toBeLessThan(ids(fallback).indexOf("road-surface"));
    const detailed = campusMapStyle(untDenton);
    expect(ids(detailed)).toContain("detail-parking");
    expect(ids(detailed)).not.toContain("parking");
  });

  test("layer ids are unique", () => {
    for (const campus of [untDenton, utAustin]) {
      const layers = ids(campusMapStyle(campus));
      expect(new Set(layers).size).toBe(layers.length);
    }
  });

  test("one short credit line: OSM linked to its licence, OpenMapTiles, OpenFreeMap, and Overture only where its heights are used", () => {
    const text = (html: string) => html.replace(/<[^>]+>/g, "");
    expect(text(campusAttribution(untDenton))).toBe("© OpenStreetMap contributors, OpenMapTiles, OpenFreeMap, Overture Maps");
    expect(text(campusAttribution(utAustin))).toBe("© OpenStreetMap contributors, OpenMapTiles, OpenFreeMap");
    expect(campusAttribution(untDenton)).toContain('href="https://www.openstreetmap.org/copyright"');
  });

  test("the tile source carries no credit of its own, so the line never repeats", () => {
    expect(campusMapStyle(untDenton).sources.openmaptiles).toMatchObject({ attribution: "" });
  });
});
