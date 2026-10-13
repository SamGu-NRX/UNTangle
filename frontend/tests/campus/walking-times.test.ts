import { describe, expect, test } from "bun:test";
import { campusBuildings, resolveCampusBuilding } from "@/lib/campus-locations";
import {
  buildingAnchor,
  getWalkingSeconds,
  matrixBuildingIds,
  walkingDistanceBetween,
  walkingSecondsBetween,
  walkingTimeForResolvedPair,
} from "@/lib/campus/walking-times";
import { haversineMetersBetween } from "@/lib/campus/geo";
import { WALKING_SPEED_MPS } from "@/lib/campus/speeds";
import type { CampusBuilding } from "@/lib/types";
import walkingTimesJson from "@/lib/campus/data/walking-times.json";

// The matrix JSON is deeply typed by its literal contents; widen it so the
// tests can index it with variable ids. Same data-boundary cast the library
// itself uses.
type MatrixSeconds = Record<string, Record<string, number>>;
const matrixSeconds = walkingTimesJson.seconds as unknown as MatrixSeconds;

const offCampusBuildings = campusBuildings.filter((building) => building.isOffCampus);
const onCampusBuildings = campusBuildings.filter((building) => !building.isOffCampus);

describe("getWalkingSeconds — data preconditions", () => {
  test("bundled matrix covers exactly the on-campus registry buildings", () => {
    const onCampusIds = onCampusBuildings.map((building) => building.id).sort();
    expect(matrixBuildingIds()).toEqual(onCampusIds);
    expect(Object.keys(matrixSeconds).sort()).toEqual(onCampusIds);
    expect(offCampusBuildings.map((building) => building.id).sort()).toEqual([
      "ath1",
      "mgvp",
      "ntdp",
    ]);
  });
});

describe("getWalkingSeconds — same building", () => {
  test("same on-campus building -> 0 seconds / campus-network", () => {
    expect(getWalkingSeconds("life", "life")).toEqual({ seconds: 0, source: "campus-network" });
    expect(getWalkingSeconds("Sage Hall", "sage")).toEqual({
      seconds: 0,
      source: "campus-network",
    });
  });

  test("same building via uppercase code and alias -> 0 seconds / campus-network", () => {
    expect(getWalkingSeconds("LIFE", "life")).toEqual({ seconds: 0, source: "campus-network" });
    expect(getWalkingSeconds("eesat", "env")).toEqual({ seconds: 0, source: "campus-network" });
  });
});

describe("getWalkingSeconds — matrix pairs", () => {
  test("matrix pair returns the bundled matrix seconds / campus-network", () => {
    expect(matrixSeconds.life.blb).toBeGreaterThan(0);
    expect(getWalkingSeconds("life", "blb")).toEqual({
      seconds: matrixSeconds.life.blb,
      source: "campus-network",
    });
  });

  test("matrix pair works in both directions and case-insensitively", () => {
    expect(getWalkingSeconds("blb", "life")).toEqual({
      seconds: matrixSeconds.blb.life,
      source: "campus-network",
    });
    expect(getWalkingSeconds("LIFE", "BLB")).toEqual(getWalkingSeconds("life", "blb"));
    expect(getWalkingSeconds("chem", "gate")).toEqual({
      seconds: matrixSeconds.chem.gate,
      source: "campus-network",
    });
  });

  test("matrix path agrees with walkingSecondsBetween for every on-campus pair", () => {
    for (const from of onCampusBuildings) {
      for (const to of onCampusBuildings) {
        const expected = from.id === to.id ? 0 : walkingSecondsBetween(from.id, to.id);
        if (expected === null) throw new Error(`matrix missing pair ${from.id}->${to.id}`);
        expect(getWalkingSeconds(from.id, to.id)).toEqual({
          seconds: expected,
          source: "campus-network",
        });
      }
    }
  });
});

describe("getWalkingSeconds — straight-line branch", () => {
  // Through getWalkingSeconds the straight-line branch is unreachable with
  // the bundled data: the matrix build hard-fails on an unroutable pair, so
  // every on-campus registry building is in the matrix (pinned by the
  // precondition test above). Rather than process-wide module mocking — which
  // would poison sibling test files that import the real matrix — these tests
  // drive the branch through walkingTimeForResolvedPair, the internal
  // decision getWalkingSeconds delegates to, with an injected matrix view.

  // Synthetic on-campus registry entry standing in for "a registry entry
  // added without a matrix rebuild": shaped like a registry building
  // (on-campus, real pin inside untCampusBounds) but absent from the matrix.
  const unconnected: CampusBuilding = {
    id: "zz-unconnected",
    name: "Synthetic Unconnected Hall",
    shortName: "SYN",
    lat: 33.2117,
    lng: -97.1501,
    aliases: ["zz-unconnected"],
  };
  const life = resolveCampusBuilding("life")!;

  test("synthetic on-campus building absent from the matrix -> straight-line estimate", () => {
    const wt = walkingTimeForResolvedPair(unconnected, life, {});
    expect(wt.source).toBe("straight-line");
    expect(wt.seconds).toBeCloseTo(haversineMetersBetween(unconnected, life) / WALKING_SPEED_MPS, 1);

    const back = walkingTimeForResolvedPair(life, unconnected, {});
    expect(back.source).toBe("straight-line");
    expect(back.seconds).toBeCloseTo(
      haversineMetersBetween(life, unconnected) / WALKING_SPEED_MPS,
      1,
    );
  });

  test("injected matrix missing a real registry pair -> straight-line estimate from the registry pins", () => {
    const art = resolveCampusBuilding("art")!;
    const wt = walkingTimeForResolvedPair(art, life, {});
    expect(wt).toEqual({
      seconds: Number((haversineMetersBetween(art, life) / WALKING_SPEED_MPS).toFixed(1)),
      source: "straight-line",
    });
  });

  test("the same seam still prefers a matrix hit when the injected matrix has the pair", () => {
    // Injected views mirror the real matrix's shape: both directions present.
    const injected = { "zz-unconnected": { life: 123 }, life: { "zz-unconnected": 123 } };
    expect(walkingTimeForResolvedPair(unconnected, life, injected)).toEqual({
      seconds: 123,
      source: "campus-network",
    });
    expect(walkingTimeForResolvedPair(life, unconnected, injected)).toEqual({
      seconds: 123,
      source: "campus-network",
    });
  });
});

describe("getWalkingSeconds — off-campus registry buildings", () => {
  test("off-campus building paired with an on-campus building -> null / unknown, never 0", () => {
    expect(getWalkingSeconds("ntdp", "life")).toEqual({ seconds: null, source: "unknown" });
    expect(getWalkingSeconds("life", "ntdp")).toEqual({ seconds: null, source: "unknown" });
    expect(getWalkingSeconds("NTDP", "BLB")).toEqual({ seconds: null, source: "unknown" });
    for (const off of offCampusBuildings) {
      expect(getWalkingSeconds(off.id, "life")).toEqual({ seconds: null, source: "unknown" });
      expect(getWalkingSeconds("life", off.id)).toEqual({ seconds: null, source: "unknown" });
    }
  });

  test("off-campus building paired with itself -> null / unknown, never 0", () => {
    expect(getWalkingSeconds("ntdp", "ntdp")).toEqual({ seconds: null, source: "unknown" });
  });
});

describe("getWalkingSeconds — unknown ids", () => {
  test("unknown id -> null / unknown, never 0", () => {
    expect(getWalkingSeconds("nope", "life")).toEqual({ seconds: null, source: "unknown" });
    expect(getWalkingSeconds("life", "nope")).toEqual({ seconds: null, source: "unknown" });
    expect(getWalkingSeconds("nope", "ntdp")).toEqual({ seconds: null, source: "unknown" });
    expect(getWalkingSeconds("", "life")).toEqual({ seconds: null, source: "unknown" });
    expect(getWalkingSeconds("ZZZZ", "life")).toEqual({ seconds: null, source: "unknown" });
  });
});

describe("getWalkingSeconds — registry id mapping", () => {
  test("registrar codes, mnemonics, and aliases resolve to canonical ids before lookup", () => {
    // Classroom-system names for env (documented in the registry).
    expect(getWalkingSeconds("EESAT", "LIFE")).toEqual({
      seconds: matrixSeconds.env.life,
      source: "campus-network",
    });
    // Facilities mnemonic for hick.
    expect(getWalkingSeconds("HKRY", "blb")).toEqual({
      seconds: matrixSeconds.hick.blb,
      source: "campus-network",
    });
    // Documented classroom misspelling of Murchison PAC.
    expect(getWalkingSeconds("Murchinson Performing Arts Center", "sage")).toEqual({
      seconds: matrixSeconds.pac.sage,
      source: "campus-network",
    });
  });

  test("a registrar building number resolves too (190 -> ntdp, off-campus -> unknown)", () => {
    expect(resolveCampusBuilding("190")?.id).toBe("ntdp");
    expect(getWalkingSeconds("190", "sage")).toEqual({ seconds: null, source: "unknown" });
  });
});

describe("getWalkingSeconds — registry-wide invariants", () => {
  test("no pair ever yields 0 except identical on-campus buildings; off-campus never yields seconds", () => {
    for (const from of campusBuildings) {
      for (const to of campusBuildings) {
        const wt = getWalkingSeconds(from.id, to.id);
        if (wt.seconds === null) {
          expect(wt.source).toBe("unknown");
          expect(from.isOffCampus || to.isOffCampus).toBe(true);
        } else if (from.id === to.id) {
          expect(wt).toEqual({ seconds: 0, source: "campus-network" });
        } else {
          expect(wt.source).toBe("campus-network");
          expect(wt.seconds).toBeGreaterThan(0);
        }
      }
    }
  });

  test("result discriminates on source: unknown carries null seconds, network carries positive seconds", () => {
    const unknown = getWalkingSeconds("nope", "life");
    if (unknown.source === "unknown") {
      expect(unknown.seconds).toBeNull();
    } else {
      throw new Error("expected an unknown result");
    }

    const network = getWalkingSeconds("life", "blb");
    if (network.source === "unknown") throw new Error("expected a network result");
    expect(network.seconds).toBeGreaterThan(0);
  });
});

describe("ids that name inherited properties", () => {
  // Ids come from requests. "__proto__" used to reach Object.prototype and
  // throw inside buildingAnchor, which turned a route request into a 500.
  test("miss like any unknown id", () => {
    for (const id of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      expect(buildingAnchor(id)).toBeNull();
      expect(walkingSecondsBetween(id, "art")).toBeNull();
      expect(walkingSecondsBetween("art", id)).toBeNull();
      expect(walkingDistanceBetween(id, "art")).toBeNull();
      expect(walkingDistanceBetween("art", id)).toBeNull();
      expect(getWalkingSeconds(id, "art")).toEqual({ seconds: null, source: "unknown" });
    }
  });
});
