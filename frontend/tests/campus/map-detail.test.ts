import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { campusBuildings } from "@/lib/campus-locations";
import {
  METRES_PER_LEVEL,
  parseOsmLevels,
  parseOsmMetres,
  resolveHeight,
  type FallbackHeight,
} from "@/lib/campus/map-detail/heights";
import { buildingLabel, splitOsmName } from "@/lib/campus/map-detail/labels";
import { courseColorSlot, dayBuildingHighlights, mixHex } from "@/lib/campus/map-detail/highlight";
import { untFallbackHeights } from "@/lib/campus/map-detail/fallback-heights";
import type { ItineraryStop } from "@/lib/map-itinerary";

const noTable = new Map<string, FallbackHeight>();
const dath: FallbackHeight = { osm: "way/518915918", name: "Dance & Theatre Building (DATH)", floors: 3, source: "https://example.unt.edu/fixture.pdf", retrieved: "2026-10-13" };
const table = new Map([[dath.osm, dath]]);

describe("resolveHeight", () => {
  test("OSM height wins over everything, with min_height as the base", () => {
    expect(
      resolveHeight({ tags: { height: "16", min_height: "4", "building:levels": "9" }, osm: "way/1", fallback: table, overtureMetres: 30 }),
    ).toEqual({ source: "osm-height", height: 16, base: 4 });
  });

  test("levels use 3.66 m each, matching the basemap's render_height", () => {
    expect(resolveHeight({ tags: { "building:levels": "3" }, osm: "way/1", fallback: noTable, overtureMetres: 7 })).toEqual({
      source: "osm-levels",
      height: 11,
      base: 0,
    });
    expect(METRES_PER_LEVEL).toBe(3.66);
  });

  test("building:min_level lifts the base", () => {
    expect(resolveHeight({ tags: { "building:levels": "5", "building:min_level": "2" }, osm: "way/1", fallback: noTable })).toEqual({
      source: "osm-levels",
      height: 18.3,
      base: 7.3,
    });
  });

  test("a cited table entry beats Overture's ML estimate", () => {
    expect(resolveHeight({ tags: {}, osm: dath.osm, fallback: table, overtureMetres: 4.2 })).toEqual({
      source: "fallback-table",
      height: 11,
      base: 0,
    });
  });

  test("Overture fills in when OSM and the table have nothing", () => {
    expect(resolveHeight({ tags: {}, osm: "way/2", fallback: table, overtureMetres: 7.587 })).toEqual({
      source: "overture-ml",
      height: 7.6,
      base: 0,
    });
  });

  test("no source means flat, never a guess", () => {
    expect(resolveHeight({ tags: { building: "university" }, osm: "way/3", fallback: table })).toEqual({ source: "none" });
    expect(resolveHeight({ tags: { "building:levels": "0" }, osm: "way/3", fallback: table, overtureMetres: 5 })).toEqual({ source: "none" });
  });

  test("malformed tags fail loudly with the element", () => {
    expect(() => resolveHeight({ tags: { height: "tall" }, osm: "way/9", fallback: noTable })).toThrow('way/9: height="tall"');
    expect(() => resolveHeight({ tags: { "building:levels": "3;4" }, osm: "way/9", fallback: noTable })).toThrow("way/9: building:levels");
    expect(() => resolveHeight({ tags: { height: "10", min_height: "12" }, osm: "way/9", fallback: noTable })).toThrow("not below");
    expect(() => resolveHeight({ tags: {}, osm: "way/9", fallback: noTable, overtureMetres: 0 })).toThrow("positive");
    const bad = new Map([["way/9", { ...dath, osm: "way/9", floors: 2.5 }]]);
    expect(() => resolveHeight({ tags: {}, osm: "way/9", fallback: bad })).toThrow("whole number");
  });
});

describe("OSM length and level parsing", () => {
  test("metres, with or without a unit", () => {
    expect(parseOsmMetres("7.62", "way/1", "height")).toBe(7.62);
    expect(parseOsmMetres("16 m", "way/1", "height")).toBe(16);
  });

  test("feet and inches", () => {
    expect(parseOsmMetres("10'", "way/1", "height")).toBeCloseTo(3.048, 6);
    expect(parseOsmMetres(`10'6"`, "way/1", "height")).toBeCloseTo(3.2004, 6);
  });

  test("levels are whole numbers", () => {
    expect(parseOsmLevels(" 4 ", "way/1", "building:levels")).toBe(4);
    expect(() => parseOsmLevels("4.5", "way/1", "building:levels")).toThrow();
  });
});

describe("the fallback table", () => {
  test("every entry cites a unt.edu URL with an ISO retrieval date and names a whole number of floors", () => {
    expect(untFallbackHeights.length).toBe(19);
    for (const entry of untFallbackHeights) {
      expect(entry.osm).toMatch(/^(way|relation)\/\d+$/);
      const url = new URL(entry.source);
      expect(url.protocol).toBe("https:");
      expect(url.hostname === "unt.edu" || url.hostname.endsWith(".unt.edu")).toBe(true);
      expect(entry.retrieved).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(`${entry.retrieved}T00:00:00Z`).toISOString().slice(0, 10)).toBe(entry.retrieved);
      expect(Number.isInteger(entry.floors) && entry.floors >= 1).toBe(true);
    }
    expect(new Set(untFallbackHeights.map((entry) => entry.osm)).size).toBe(untFallbackHeights.length);
  });

  test("table heights reach the built file where OSM has no levels of its own", () => {
    // Terrill Hall: 3 floors in UNT's plan, no OSM levels, so 3 x 3.66 m.
    const terrill = untFallbackHeights.find((entry) => entry.osm === "way/260225245");
    expect(terrill?.floors).toBe(3);
    expect(resolveHeight({ tags: {}, osm: "way/260225245", fallback: new Map([["way/260225245", terrill!]]), overtureMetres: 10.7 })).toEqual({
      source: "fallback-table",
      height: 11,
      base: 0,
    });
  });
});

describe("building labels", () => {
  test("name, then the code students use", () => {
    expect(buildingLabel("General Academic Building", "GAB")).toBe("General Academic Building (GAB)");
  });

  test("an OSM name's own code is replaced, not doubled", () => {
    expect(buildingLabel("Auditorium Building (AUDB)", "AUD")).toBe("Auditorium Building (AUD)");
    expect(buildingLabel("Willis Library (LIBR)", "LIBR")).toBe("Willis Library (LIBR)");
  });

  test("no code, or a code that is the name, gives the name alone", () => {
    expect(buildingLabel("DATCU Stadium", null)).toBe("DATCU Stadium");
    expect(buildingLabel("Coliseum", "  ")).toBe("Coliseum");
    expect(buildingLabel("GAB", "gab")).toBe("GAB");
  });

  test("labels never carry a separator glyph", () => {
    expect(buildingLabel("Radio, TV, Film & Performing Arts Building", "RTFP")).not.toMatch(/[·•|]/);
  });

  test("a label needs a name", () => {
    expect(() => buildingLabel("  ", "GAB")).toThrow("needs a name");
  });

  test("splitOsmName reads trailing codes, including two-word ones", () => {
    expect(splitOsmName("Willis Library (LIBR)")).toEqual({ name: "Willis Library", code: "LIBR" });
    expect(splitOsmName("Environmental Education, Science & Technology (ENV SCI)")).toEqual({
      name: "Environmental Education, Science & Technology",
      code: "ENV SCI",
    });
    expect(splitOsmName("Mean Greens")).toEqual({ name: "Mean Greens", code: null });
    expect(splitOsmName("Building (lowercase)")).toEqual({ name: "Building (lowercase)", code: null });
  });
});

function stop(key: string, courseCode: string, placement: ItineraryStop["placement"]): ItineraryStop {
  return {
    key,
    number: 1,
    placement,
    ownDates: null,
    stop: {
      courseCode,
      title: "t",
      location: "x",
      buildingName: "x",
      shortName: "x",
      resolutionStatus: "local",
      geocodeQuery: "",
      day: "Mon",
      start: "09:00",
      end: "09:50",
    },
  };
}

const mapped = (buildingId?: string): ItineraryStop["placement"] => ({
  kind: "mapped",
  point: { lat: 33.21, lng: -97.15 },
  buildingId,
  buildingName: "x",
  shortName: "x",
  via: "registry",
});

describe("day building highlights", () => {
  test("course colors follow the Week grid: plan order, wrapping after six, unknown courses take the first", () => {
    const order = ["A 1", "B 1", "C 1", "D 1", "E 1", "F 1", "G 1"];
    expect(courseColorSlot(order, "A 1")).toBe(1);
    expect(courseColorSlot(order, "F 1")).toBe(6);
    expect(courseColorSlot(order, "G 1")).toBe(1);
    expect(courseColorSlot(order, "Z 9")).toBe(1);
  });

  test("one entry per building, colored by its first class", () => {
    const stops = [
      stop("1", "ANTH 3700", mapped("env")),
      stop("2", "ANTH 1010", mapped("gab")),
      stop("3", "BIOL 1720", mapped("gab")),
      stop("4", "BMEN 1400", { kind: "unresolved", reason: "off-campus", message: "off" }),
      stop("5", "CSCE 1030", { kind: "resolving" }),
      stop("6", "CSCE 2100", mapped(undefined)),
    ];
    expect(dayBuildingHighlights(stops, ["BIOL 1720", "ANTH 1010", "ANTH 3700"])).toEqual([
      { buildingId: "env", slot: 3, courseCode: "ANTH 3700" },
      { buildingId: "gab", slot: 2, courseCode: "ANTH 1010" },
    ]);
  });

  test("an empty day highlights nothing", () => {
    expect(dayBuildingHighlights([], ["A 1"])).toEqual([]);
  });
});

describe("the built detail file", () => {
  type Feature = { properties: Record<string, string | number>; geometry: { type: string } };
  const file = JSON.parse(readFileSync(join(import.meta.dir, "../../public/map/unt-denton/detail.geojson"), "utf8")) as {
    features: Feature[];
  };
  const of = (kind: string) => file.features.filter((feature) => feature.properties.k === kind);

  test("every registry building on campus has exactly one label, in name-and-code form", () => {
    const labels = of("lb");
    for (const building of campusBuildings.filter((entry) => !entry.isOffCampus)) {
      const mine = labels.filter((label) => label.properties.c === building.id);
      expect(mine.map((label) => label.properties.n)).toEqual([buildingLabel(building.name, building.shortName)]);
    }
  });

  test("labels carry no separator glyphs, and building ids are registry ids", () => {
    const registryIds = new Set(campusBuildings.map((building) => building.id));
    for (const feature of file.features) {
      if (typeof feature.properties.n === "string") expect(feature.properties.n).not.toMatch(/[·•|]/);
      if (feature.properties.c !== undefined) expect(registryIds.has(String(feature.properties.c))).toBe(true);
    }
  });

  test("buildings have a non-negative height and a base below it", () => {
    for (const feature of [...of("b"), ...of("p")]) {
      const height = Number(feature.properties.h);
      const base = Number(feature.properties.b ?? 0);
      expect(height).toBeGreaterThanOrEqual(0);
      if (height > 0) expect(base).toBeLessThan(height);
    }
  });
});

describe("mixHex", () => {
  test("endpoints and midpoint", () => {
    expect(mixHex("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mixHex("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  test("rejects anything but #rrggbb and amounts outside 0 to 1", () => {
    expect(() => mixHex("#fff", "#000000", 0.5)).toThrow("#rrggbb");
    expect(() => mixHex("#ffffff", "#000000", 1.2)).toThrow("between 0 and 1");
    expect(() => mixHex("#ffffff", "#000000", Number.NaN)).toThrow("between 0 and 1");
  });
});
