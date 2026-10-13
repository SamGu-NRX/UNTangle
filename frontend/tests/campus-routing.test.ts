import { describe, expect, test, afterAll } from "bun:test";
import {
  campusBuildings,
  resolveCampusBuilding,
  resolveCampusLocation,
} from "@/lib/campus-locations";
import {
  buildingAnchor,
  matrixBuildingIds,
  walkingDistanceBetween,
  walkingSecondsBetween,
  walkingTimeMeta,
} from "@/lib/campus/walking-times";
import walkingTimesJson from "@/lib/campus/data/walking-times.json";
import { POST as routePOST } from "@/app/api/map/route/route";

// Any ORS attempt in these tests must fail loudly: walkway routing is the
// primary tier, so a fetch here would mean an unexpected fallback tier ran.
const originalFetch = globalThis.fetch;
globalThis.fetch = Object.assign(
  () => Promise.reject(new Error("Network access is disabled in campus-routing tests")),
  { preconnect: () => {} },
);
afterAll(() => {
  globalThis.fetch = originalFetch;
});

function postJson(url: string, body: unknown, ip = "198.51.100.10") {
  // Unique IP per test: the route module's per-IP limiter is module-global
  // and map-hardening's burst test exhausts the default bucket in the same
  // bun test process.
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

/** All 15 distinct building codes in the synthetic backend/data/compD.csv. */
const COMPD_CODES: Array<[string, string]> = [
  ["LIFE", "life"],
  ["BLB", "blb"],
  ["MATT", "matt"],
  ["NTDP", "ntdp"],
  ["GAB", "gab"],
  ["ENV", "env"],
  ["GATE", "gate"],
  ["AUD", "aud"],
  ["WH", "wh"],
  ["ARTA", "arta"],
  ["LANG", "lang"],
  ["MUSI", "musi"],
  ["CHEM", "chem"],
  ["ART", "art"],
  ["HICK", "hick"],
];

describe("campus registry", () => {
  test("every compD building code resolves through the registry", () => {
    for (const [code, expectedId] of COMPD_CODES) {
      const building = resolveCampusBuilding(code);
      expect(building?.id).toBe(expectedId);
    }
  });

  test("documented code conflicts all map to the same building", () => {
    expect(resolveCampusBuilding("ESB 110")?.id).toBe("env");
    expect(resolveCampusBuilding("EESAT")?.id).toBe("env");
    expect(resolveCampusBuilding("Environmental Education Science and Technology Building")?.id).toBe("env");
    expect(resolveCampusBuilding("HKRY 252")?.id).toBe("hick");
    expect(resolveCampusBuilding("AUD 202")?.id).toBe("aud");
    expect(resolveCampusBuilding("AUDB")?.id).toBe("aud");
    expect(resolveCampusBuilding("ARTF 108")?.id).toBe("arta");
    expect(resolveCampusBuilding("Murchinson Performing Arts Center")?.id).toBe("pac");
    expect(resolveCampusBuilding("Murchison Performing Arts Center")?.id).toBe("pac");
    expect(resolveCampusBuilding("Terrill Hall 120")?.id).toBe("th");
    expect(resolveCampusBuilding("Business Administration Building")?.id).toBe("sage");
    expect(resolveCampusBuilding("Sycamore Hall")?.id).toBe("symr");
    expect(resolveCampusBuilding("University Union")?.id).toBe("uu");
    expect(resolveCampusBuilding("159")?.id).toBe("dath");
  });

  test("off-campus registry entries are excluded from route resolution but resolvable as buildings", () => {
    expect(resolveCampusBuilding("Discovery Park")?.id).toBe("ntdp");
    expect(resolveCampusBuilding("ATH1")?.id).toBe("ath1");
    expect(resolveCampusBuilding("MGVP")?.id).toBe("mgvp");
    expect(resolveCampusLocation("Discovery Park")).toBeNull();
    expect(resolveCampusLocation("Air Force ROTC Building")).toBeNull();
    expect(resolveCampusLocation("MGV Building P 124")).toBeNull();
  });

  test("all on-campus registry buildings are in bounds and off-campus ones are not", () => {
    const inBoundsCount = campusBuildings.filter((b) => !b.isOffCampus).length;
    expect(inBoundsCount).toBe(29);
    expect(campusBuildings.filter((b) => b.isOffCampus)).toHaveLength(3);
  });
});

describe("walking-time matrix", () => {
  test("covers exactly the 29 routable registry buildings", () => {
    const ids = matrixBuildingIds();
    expect(ids).toHaveLength(29);
    expect(ids).not.toContain("ntdp");
    expect(ids).not.toContain("ath1");
    expect(ids).not.toContain("mgvp");
  });

  test("lookups match the generated artifact, case-insensitively", () => {
    const artifact = walkingTimesJson as unknown as {
      seconds: Record<string, Record<string, number>>;
      meters: Record<string, Record<string, number>>;
    };

    expect(walkingSecondsBetween("sage", "blb")).toBe(artifact.seconds.sage.blb);
    expect(walkingSecondsBetween("SAGE", "BLB")).toBe(walkingSecondsBetween("sage", "blb"));
    expect(walkingDistanceBetween("musi", "musa")).toBe(artifact.meters.musi.musa);
    expect(walkingSecondsBetween("sage", "blb")).toBeGreaterThan(0);
    expect(walkingDistanceBetween("musi", "musa")).toBeGreaterThan(50);
  });

  test("same building is zero and unknown ids are null, never zero", () => {
    expect(walkingSecondsBetween("sage", "sage")).toBe(0);
    expect(walkingSecondsBetween("sage", "not-a-building")).toBeNull();
    expect(walkingSecondsBetween("not-a-building", "sage")).toBeNull();
    expect(walkingDistanceBetween("ntdp", "sage")).toBeNull();
  });

  test("anchors exist for every matrix building with sane connectors", () => {
    for (const id of matrixBuildingIds()) {
      const anchor = buildingAnchor(id);
      expect(anchor).not.toBeNull();
      expect(anchor!.connectorMeters).toBeLessThanOrEqual(250);
      expect(["osm-entrance", "outline-node", "pin-fallback"]).toContain(anchor!.method);
    }
    expect(buildingAnchor("sage")!.method).toBe("osm-entrance");
    expect(buildingAnchor("not-a-building")).toBeNull();
  });

  test("the recorded speed model matches the runtime constants", () => {
    expect(walkingTimeMeta.speeds.baseMps).toBe(1.4);
    expect(walkingTimeMeta.speeds.stepsMps).toBe(0.6);
    expect(walkingTimeMeta.receiptSha256).toBeTruthy();
  });
});

describe("map route API walkway tier", () => {
  test("routes two in-bounds stops on the offline walkway graph", async () => {
    const response = await routePOST(
      postJson("http://localhost/api/map/route", {
        stops: [
          { lat: 33.2121066, lng: -97.1467423 }, // Sage Hall
          { lat: 33.2088704, lng: -97.1476988 }, // Business Leadership Building
        ],
      }),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      source?: string;
      geometry?: Array<{ lat: number; lng: number }>;
      distanceMeters?: number;
      durationSeconds?: number;
    };
    expect(payload.source).toBe("campus-network");
    expect(payload.geometry!.length).toBeGreaterThanOrEqual(3);
    expect(payload.distanceMeters!).toBeGreaterThan(300);
    expect(payload.distanceMeters!).toBeLessThan(1200);
    expect(payload.durationSeconds!).toBeGreaterThan(0);
  });

  test("walkway durations agree with the precomputed matrix on fixture pairs", async () => {
    // The API routes stop-point to stop-point (connector legs included); the
    // matrix routes anchor to anchor. Allow the connector tolerance.
    const pairs: Array<[{ lat: number; lng: number }, { lat: number; lng: number }, string, string]> = [
      [{ lat: 33.2121066, lng: -97.1467423 }, { lat: 33.2088704, lng: -97.1476988 }, "sage", "blb"],
      [{ lat: 33.2106752, lng: -97.1500271 }, { lat: 33.2097157, lng: -97.1499891 }, "musi", "musa"],
      [{ lat: 33.2131868, lng: -97.1481479 }, { lat: 33.2098557, lng: -97.1456764 }, "gab", "wh"],
      [{ lat: 33.2140405, lng: -97.1499791 }, { lat: 33.2121465, lng: -97.1490327 }, "chem", "life"],
      [{ lat: 33.2098832, lng: -97.1467183 }, { lat: 33.2121066, lng: -97.1467423 }, "matt", "sage"],
    ];

    for (const [from, to, fromId, toId] of pairs) {
      const response = await routePOST(
        postJson("http://localhost/api/map/route", { stops: [from, to] }),
      );
      expect(response.status).toBe(200);
      const payload = (await response.json()) as { durationSeconds?: number; source?: string };
      expect(payload.source).toBe("campus-network");

      const matrixSeconds = walkingSecondsBetween(fromId, toId)!;
      const apiSeconds = payload.durationSeconds!;
      const tolerance = Math.max(20, matrixSeconds * 0.15);
      expect(Math.abs(apiSeconds - matrixSeconds)).toBeLessThanOrEqual(tolerance);
    }
  });

  test("stops that name their buildings route anchor to anchor and match the matrix exactly", async () => {
    const response = await routePOST(
      postJson(
        "http://localhost/api/map/route",
        {
          stops: [
            { lat: 33.2121066, lng: -97.1467423, buildingId: "sage" },
            { lat: 33.2088704, lng: -97.1476988, buildingId: "blb" },
            { lat: 33.2088704, lng: -97.1476988, buildingId: "blb" },
            { lat: 33.2131868, lng: -97.1481479, buildingId: "gab" },
          ],
        },
        "198.51.100.11",
      ),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      legs: Array<{ fromIndex: number; toIndex: number; source: string; durationSeconds: number; distanceMeters: number }>;
    };
    // The repeated BLB stop is one stop; leg ends are reported in request indexes.
    expect(payload.legs.map((leg) => [leg.fromIndex, leg.toIndex])).toEqual([
      [0, 1],
      [2, 3],
    ]);
    expect(payload.legs.map((leg) => leg.source)).toEqual(["campus-network", "campus-network"]);
    expect(payload.legs[0].durationSeconds).toBe(Math.round(walkingSecondsBetween("sage", "blb")!));
    expect(payload.legs[1].durationSeconds).toBe(Math.round(walkingSecondsBetween("blb", "gab")!));
    expect(payload.legs[0].distanceMeters).toBeCloseTo(walkingDistanceBetween("sage", "blb")!, 0);
  });

  test("out-of-bounds stops are still rejected", async () => {
    const response = await routePOST(
      postJson("http://localhost/api/map/route", {
        stops: [
          { lat: 33.2076379, lng: -97.1565785 }, // AFROTC building: outside bounds
          { lat: 33.2088704, lng: -97.1476988 },
        ],
      }),
    );
    expect(response.status).toBe(400);
  });
});
