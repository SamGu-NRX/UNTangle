import matchingList from "../../../scripts/mobile/fixtures/production-builds.json";
import staleList from "../../../scripts/mobile/fixtures/production-builds-stale.json";
import {
  fingerprintOf,
  matchingFingerprint,
  parseBuildList,
  parseRolloutPercentage,
  selectProductionBuilds,
  shellCommand,
  type EasBuild,
} from "./ota-publish-plan";

const FP_MATCH = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const FP_OTHER = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

// Field names and enum values as `eas build:list --json` prints them (eas-cli src/graphql/types/Build.ts).
const productionMatch: EasBuild = {
  id: "build-1",
  status: "FINISHED",
  platform: "IOS",
  distribution: "STORE",
  updateChannel: { name: "production" },
  appVersion: "1.0.0",
  fingerprint: { hash: FP_MATCH },
};
const productionStale: EasBuild = { ...productionMatch, id: "build-2", fingerprint: { hash: FP_OTHER } };

const FIXTURE_FP = "677b489a545ef723b22b76b0830877e24022f4e9";

describe("parseBuildList", () => {
  test("accepts the bare array eas build:list --json prints", () => {
    expect(parseBuildList(JSON.stringify([productionMatch]))).toEqual([productionMatch]);
  });

  test("rejects output that is not an array", () => {
    expect(() => parseBuildList('{"allBuilds": []}')).toThrow(/not an array/);
  });

  test("rejects null and primitive entries instead of failing later on them", () => {
    expect(() => parseBuildList(JSON.stringify([productionMatch, null]))).toThrow(/non-object at index 1/);
    expect(() => parseBuildList("[3]")).toThrow(/non-object at index 0/);
  });

  test("rejects non-JSON output", () => {
    expect(() => parseBuildList("Not logged in")).toThrow(/could not parse/);
  });
});

describe("fingerprintOf", () => {
  test("reads fingerprint.hash", () => {
    expect(fingerprintOf(productionMatch)).toBe(FP_MATCH);
  });

  test("returns null when a build carries none", () => {
    expect(fingerprintOf({})).toBeNull();
  });
});

describe("selectProductionBuilds", () => {
  test("keeps only finished store builds on the production channel", () => {
    const builds: EasBuild[] = [
      productionMatch,
      productionStale,
      { ...productionMatch, status: "NEW" },
      { ...productionMatch, updateChannel: { name: "preview" } },
      { ...productionMatch, platform: "ANDROID" },
      // An internal build made with the production profile reaches no store install.
      { ...productionMatch, distribution: "INTERNAL" },
      // A build with no channel (the CLI drops the null key) can't receive a production-channel update.
      { ...productionMatch, updateChannel: undefined, id: "build-3" },
    ];
    expect(selectProductionBuilds(builds).map((build) => build.id)).toEqual(["build-1", "build-2"]);
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

describe("the checked-in build-list fixtures", () => {
  test("the matching list passes the guard on its one finished production store build", () => {
    const production = selectProductionBuilds(parseBuildList(JSON.stringify(matchingList)));
    expect(matchingFingerprint(production, FIXTURE_FP).matches.map((build) => build.id)).toEqual([
      "11111111-1111-1111-1111-111111111111",
    ]);
  });

  test("the stale list holds a production build with another fingerprint", () => {
    const production = selectProductionBuilds(parseBuildList(JSON.stringify(staleList)));
    expect(production).toHaveLength(1);
    expect(matchingFingerprint(production, FIXTURE_FP).matches).toEqual([]);
  });
});

describe("shellCommand", () => {
  test("leaves plain arguments bare", () => {
    expect(shellCommand(["npx", "--yes", "eas-cli@latest", "update", "--rollout-percentage", "25"])).toBe(
      "npx --yes eas-cli@latest update --rollout-percentage 25",
    );
  });

  test("single-quotes a message with quotes, backslashes, dollars and newlines", () => {
    const message = 'fix "login" it\'s $HOME C:\\path\nbody';
    expect(shellCommand(["--message", message])).toBe(`--message 'fix "login" it'\\''s $HOME C:\\path\nbody'`);
  });

  test("quotes an empty argument", () => {
    expect(shellCommand(["--message", ""])).toBe("--message ''");
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
