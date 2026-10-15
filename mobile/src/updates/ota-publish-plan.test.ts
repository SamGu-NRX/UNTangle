import {
  fingerprintOf,
  matchingFingerprint,
  parseBuildList,
  parseRolloutPercentage,
  selectProductionBuilds,
  type EasBuild,
} from "./ota-publish-plan";

const FP_MATCH = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const FP_OTHER = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const FP_THIRD = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

const productionMatch: EasBuild = {
  id: "build-1",
  status: "FINISHED",
  platform: "ios",
  channel: "production",
  appVersion: "1.0.0",
  runtimeVersion: FP_MATCH,
};
const productionStale: EasBuild = {
  id: "build-2",
  status: "FINISHED",
  platform: "ios",
  channel: "production",
  appVersion: "1.0.0",
  runtimeVersion: FP_OTHER,
};

describe("parseBuildList", () => {
  test("accepts a bare array", () => {
    expect(parseBuildList(JSON.stringify([productionMatch]))).toEqual([productionMatch]);
  });

  test("accepts the paged envelope the current EAS CLI prints", () => {
    const envelope = JSON.stringify({ currentBuilds: [], allBuilds: [productionMatch], allDataIsLoaded: true });
    expect(parseBuildList(envelope)).toEqual([productionMatch]);
  });

  test("rejects output with no build array", () => {
    expect(() => parseBuildList('{"hello": true}')).toThrow(/no build array/);
  });

  test("rejects non-JSON output", () => {
    expect(() => parseBuildList("Not logged in")).toThrow(/could not parse/);
  });
});

describe("fingerprintOf", () => {
  test("reads a string runtime version", () => {
    expect(fingerprintOf(productionMatch)).toBe(FP_MATCH);
  });

  test("reads an object runtime version", () => {
    expect(fingerprintOf({ runtimeVersion: { fingerprint: FP_THIRD } })).toBe(FP_THIRD);
  });

  test("returns null when a build carries none", () => {
    expect(fingerprintOf({})).toBeNull();
  });
});

describe("selectProductionBuilds", () => {
  test("keeps only finished builds on the production channel", () => {
    const builds: EasBuild[] = [
      productionMatch,
      productionStale,
      { ...productionMatch, status: "NEW" },
      { ...productionMatch, channel: "preview" },
      { ...productionMatch, platform: "android" },
      // A channel-less record can qualify through the production profile.
      { ...productionMatch, channel: null, profile: "production", id: "build-3" },
      { ...productionMatch, channel: null, profile: "preview", id: "build-4" },
    ];
    const { production, rejected } = selectProductionBuilds(builds, "ios");
    expect(production.map((build) => build.id)).toEqual(["build-1", "build-2", "build-3"]);
    expect(rejected).toBe(4);
  });
});

describe("matchingFingerprint", () => {
  test("matches the update's fingerprint and reports what it saw", () => {
    const { matches, fingerprintsSeen } = matchingFingerprint([productionMatch, productionStale], FP_MATCH);
    expect(matches).toEqual([productionMatch]);
    expect(fingerprintsSeen).toEqual(new Set([FP_MATCH, FP_OTHER]));
  });

  test("no match when the stores hold only other fingerprints", () => {
    const { matches } = matchingFingerprint([productionStale], FP_MATCH);
    expect(matches).toEqual([]);
  });
});

describe("parseRolloutPercentage", () => {
  test("accepts whole numbers 1 to 100", () => {
    expect(parseRolloutPercentage("10")).toBe(10);
    expect(parseRolloutPercentage("100")).toBe(100);
  });

  test("rejects zero, fractions and overflow", () => {
    expect(() => parseRolloutPercentage("0")).toThrow(/1 to 100/);
    expect(() => parseRolloutPercentage("12.5")).toThrow(/1 to 100/);
    expect(() => parseRolloutPercentage("101")).toThrow(/1 to 100/);
    expect(() => parseRolloutPercentage("soon")).toThrow(/1 to 100/);
  });
});
