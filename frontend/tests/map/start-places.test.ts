import { describe, expect, test } from "bun:test";
import { searchStartPlaces, startPlaces } from "@/components/map/start-places";

describe("startPlaces", () => {
  const file = {
    buildings: [
      { osmId: 1, name: "Kerr Hall (KERR)", centroid: [33.2077, -97.1468], areaM2: 9000 },
      { osmId: 2, name: "Union Circle Garage", centroid: [33.21, -97.15], areaM2: 5000 },
      { osmId: 3, name: null, centroid: [33.2, -97.1], areaM2: 100 },
      { osmId: 4, name: "Park Place Apartments", centroid: [33.21, -97.142], areaM2: 200 },
      { osmId: 5, name: "Park Place Apartments", centroid: [33.209, -97.141], areaM2: 800 },
      { osmId: 6, name: "Santa Fe Square", centroid: [33.2079, -97.1568125], areaM2: 900 },
    ],
  };
  const bounds = { north: 33.216, south: 33.204, east: -97.139, west: -97.156 };

  test("named buildings inside the routing bounds, the code split off, the larger of two with one name, by name", () => {
    expect(startPlaces(file, bounds)).toEqual([
      { id: "1", name: "Kerr Hall", code: "KERR", point: { lat: 33.2077, lng: -97.1468 } },
      { id: "5", name: "Park Place Apartments", code: null, point: { lat: 33.209, lng: -97.141 } },
      { id: "2", name: "Union Circle Garage", code: null, point: { lat: 33.21, lng: -97.15 } },
    ]);
  });

  test("search ranks a name that starts with the query, then a contained match; empty finds nothing", () => {
    const places = startPlaces(file, bounds);
    expect(searchStartPlaces(places, "kerr").map((place) => place.name)).toEqual(["Kerr Hall"]);
    expect(searchStartPlaces(places, "pla").map((place) => place.name)).toEqual(["Park Place Apartments"]);
    expect(searchStartPlaces(places, "ar").map((place) => place.name)).toEqual(["Park Place Apartments", "Union Circle Garage"]);
    expect(searchStartPlaces(places, "  ")).toEqual([]);
  });
});
