import { describe, expect, test } from "bun:test";
import { campusBuildings, resolveCampusBuilding } from "@/lib/campus-locations";
import {
  getWalkingSeconds,
  matrixBuildingIds,
  walkingSecondsBetween,
} from "@/lib/campus/walking-times";
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
  // NOT_RUN: unconnectable-but-registry building. The committed registry holds
  // 32 buildings; the 3 off-campus ones are excluded from the matrix, and
  // every on-campus registry building IS in the committed 29x29 matrix
  // (build-matrix.ts hard-fails on an unroutable routable pair, and the
  // precondition test above pins that). With the bundled data the
  // straight-line branch is therefore unreachable through the public exports,
  // the contract forbids adding exports beyond the three named ones, and
  // process-wide module mocking would poison sibling test files that import
  // the real matrix. The branch stays implemented (haversine registry-pin
  // distance / 1.4 m/s base speed, rounded to 0.1 s) and unexercised against
  // real data. Unskip when the registry gains an on-campus building that
  // lacks a matrix entry.
  test.skip(
    "unconnectable on-campus registry pair -> straight-line estimate (NOT_RUN: no such building in the bundled data)",
    () => {
      // Expected contract once such a building exists (registry pins, 1.4 m/s,
      // haversineMetersBetween from @/lib/campus/geo, WALKING_SPEED_MPS from
      // @/lib/campus/speeds):
      // const from = resolveCampusBuilding("<new-id>")!;
      // const to = resolveCampusBuilding("life")!;
      // expect(getWalkingSeconds("<new-id>", "life")).toEqual({
      //   seconds: Number((haversineMetersBetween(from, to) / WALKING_SPEED_MPS).toFixed(1)),
      //   source: "straight-line",
      // });
      throw new Error(
        "NOT_RUN: no on-campus registry building is missing from the bundled matrix",
      );
    },
  );
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
