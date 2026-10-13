import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { POST as resolvePOST } from "@/app/api/map/resolve/route";
import { activeCampus, type CampusConfig } from "@/lib/campus/config";
import { createResolveHandler } from "@/lib/campus/resolve-handler";
import { geocodeQuery } from "@/lib/campus-locations";
import type { MapResolvedLocation } from "@/lib/types";

// Geocoding runs only with an ORS key. These tests set a fake key and a fake
// fetch for their own duration and put both back afterwards; nothing leaves
// the process.
const originalFetch = globalThis.fetch;
const originalKey = process.env.ORS_API_KEY;
let fetchImpl: (url: string) => Promise<Response> = () => Promise.reject(new Error("unset"));
const requested: string[] = [];

beforeAll(() => {
  process.env.ORS_API_KEY = "test-key-not-real";
  globalThis.fetch = Object.assign(
    (input: RequestInfo | URL) => {
      const url = String(input);
      requested.push(url);
      return fetchImpl(url);
    },
    { preconnect: () => {} },
  ) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.ORS_API_KEY;
  else process.env.ORS_API_KEY = originalKey;
});

async function resolve(location: string, ip: string): Promise<MapResolvedLocation> {
  const response = await resolvePOST(
    new Request("http://localhost/api/map/resolve", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ locations: [{ location }] }),
    }),
  );
  expect(response.status).toBe(200);
  const payload = (await response.json()) as { locations: MapResolvedLocation[] };
  return payload.locations[0];
}

describe("building lookup through the geocoder", () => {
  test("a geocoder that fails is a retryable miss, not a definitive unresolved", async () => {
    fetchImpl = () => Promise.reject(new Error("network down"));
    const answer = await resolve("Mystery Hall A", "198.51.100.40");
    expect(answer.resolutionStatus).toBe("unresolved");
    expect(answer.retryable).toBe(true);

    fetchImpl = () => Promise.resolve(new Response("busy", { status: 503 }));
    expect((await resolve("Mystery Hall B", "198.51.100.41")).retryable).toBe(true);
  });

  test("a geocoder that answers with no match is definitive, and the query uses the campus config", async () => {
    requested.length = 0;
    fetchImpl = () => Promise.resolve(Response.json({ features: [] }));
    const answer = await resolve("Mystery Hall C", "198.51.100.42");
    expect(answer.resolutionStatus).toBe("unresolved");
    expect(answer.retryable).toBeUndefined();

    const params = new URL(requested[0]).searchParams;
    const { bounds } = activeCampus;
    expect(params.get("text")).toBe(geocodeQuery("Mystery Hall C", activeCampus.geocode));
    expect(params.get("boundary.rect.min_lon")).toBe(String(bounds.west));
    expect(params.get("boundary.rect.min_lat")).toBe(String(bounds.south));
    expect(params.get("boundary.rect.max_lon")).toBe(String(bounds.east));
    expect(params.get("boundary.rect.max_lat")).toBe(String(bounds.north));
  });
});

describe("a replacement campus", () => {
  // A made-up campus away from Denton. Its registry and bounds must drive
  // local lookup: its own buildings resolve, UNT's don't, and a registry
  // building outside its bounds is reported as off campus.
  const riverside: CampusConfig = {
    ...activeCampus,
    id: "riverside-test",
    name: "Riverside Test Campus",
    shortName: "RTC",
    center: { lat: 30.285, lng: -97.735 },
    bounds: { north: 30.29, south: 30.28, east: -97.73, west: -97.74 },
    buildings: [
      { id: "rvh", name: "River Hall", shortName: "RVH", lat: 30.2851, lng: -97.7352 },
      { id: "far", name: "Far Annex", shortName: "FAR", lat: 30.31, lng: -97.7 },
    ],
    geocode: { suffix: "Riverside Test Campus", names: ["riverside"] },
  };
  const riversidePOST = createResolveHandler(riverside);

  test("looks up its own registry and bounds, not UNT's", async () => {
    requested.length = 0;
    fetchImpl = () => Promise.resolve(Response.json({ features: [] }));
    const response = await riversidePOST(
      new Request("http://localhost/api/map/resolve", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.50" },
        body: JSON.stringify({
          locations: [{ location: "RVH 101" }, { location: "Business Leadership Building", buildingId: "blb" }, { location: "Far Annex" }],
        }),
      }),
    );
    expect(response.status).toBe(200);
    const [rvh, blb, far] = ((await response.json()) as { locations: MapResolvedLocation[] }).locations;

    expect(rvh).toMatchObject({ resolutionStatus: "local", buildingId: "rvh", lat: 30.2851, lng: -97.7352 });
    expect(blb.resolutionStatus).toBe("unresolved");
    expect(blb.lat).toBeUndefined();
    expect(far).toMatchObject({ resolutionStatus: "unresolved", buildingId: "far", unsupportedReason: "Outside Riverside Test Campus routing bounds" });

    // BLB went to the geocoder, boxed to Riverside's bounds with its suffix.
    const params = new URL(requested[0]).searchParams;
    expect(params.get("text")).toBe("Business Leadership Building Riverside Test Campus");
    expect(params.get("boundary.rect.min_lat")).toBe("30.28");
    expect(params.get("boundary.rect.max_lon")).toBe("-97.73");
  });
});

describe("geocodeQuery", () => {
  const otherCampus = { suffix: "University of Texas at Austin, Austin TX", names: ["ut austin", "university of texas"] };

  test("appends the campus suffix unless the text already names the school", () => {
    expect(geocodeQuery(" Gates Dell Complex ", otherCampus)).toBe("Gates Dell Complex University of Texas at Austin, Austin TX");
    expect(geocodeQuery("UT Austin GDC", otherCampus)).toBe("UT Austin GDC");
    expect(geocodeQuery("Willis Library", activeCampus.geocode)).toBe("Willis Library University of North Texas Denton TX");
  });
});
