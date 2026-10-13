import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { POST as resolvePOST } from "@/app/api/map/resolve/route";
import { activeCampus } from "@/lib/campus/config";
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

describe("geocodeQuery", () => {
  const otherCampus = { suffix: "University of Texas at Austin, Austin TX", names: ["ut austin", "university of texas"] };

  test("appends the campus suffix unless the text already names the school", () => {
    expect(geocodeQuery(" Gates Dell Complex ", otherCampus)).toBe("Gates Dell Complex University of Texas at Austin, Austin TX");
    expect(geocodeQuery("UT Austin GDC", otherCampus)).toBe("UT Austin GDC");
    expect(geocodeQuery("Willis Library", activeCampus.geocode)).toBe("Willis Library University of North Texas Denton TX");
  });
});
