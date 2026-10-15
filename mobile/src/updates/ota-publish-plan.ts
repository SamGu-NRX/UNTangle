/**
 * The pure core of scripts/mobile/ota-publish.ts: parse `eas build:list --json`
 * output, decide whether the local fingerprint matches a production build in
 * the stores, and validate a staged rollout percentage. Kept beside the
 * update modules so the mobile Jest suite tests the fingerprint guard the
 * same way it tests the runtime flow.
 */

/**
 * The fields the guard reads from one `eas build:list --json` record. The
 * CLI prints the GraphQL BuildFragment (eas-cli src/graphql/types/Build.ts)
 * with every null field and `__typename` removed (src/utils/json.ts,
 * sanitizeValue), so a build with no channel has no `updateChannel` key.
 */
export interface EasBuild {
  readonly id?: string;
  /** BuildStatus: "FINISHED", "ERRORED", "NEW", ... */
  readonly status?: string;
  /** AppPlatform: "IOS" or "ANDROID". */
  readonly platform?: string;
  /** DistributionType: "STORE", "INTERNAL" or "SIMULATOR". */
  readonly distribution?: string;
  readonly buildProfile?: string;
  readonly appVersion?: string;
  readonly updateChannel?: { readonly name?: string };
  readonly fingerprint?: { readonly hash?: string };
}

export class OtaPublishError extends Error {}

/** `eas build:list --json` prints a bare array of build records (eas-cli src/build/queries.ts, renderPageOfBuilds). */
export function parseBuildList(raw: string): EasBuild[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new OtaPublishError("could not parse the eas build:list JSON output");
  }
  if (!Array.isArray(parsed)) throw new OtaPublishError("the eas build:list JSON output is not an array of builds");
  parsed.forEach((entry: unknown, index) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new OtaPublishError(`the eas build:list JSON output holds a non-object at index ${index}`);
    }
  });
  return parsed as EasBuild[];
}

export function fingerprintOf(build: EasBuild): string | null {
  return build.fingerprint?.hash ?? null;
}

const PRODUCTION_CHANNEL = "production";
const FINISHED = "FINISHED";
const STORE = "STORE";

/**
 * The production builds the update could land on: finished, store-distributed,
 * on the given platform, and on the production channel (or the production
 * profile, for a record that predates channels). Builds on other channels,
 * like a preview build for internal distribution, and an internal build made
 * with the production profile must never satisfy the guard.
 */
export function selectProductionBuilds(
  builds: readonly EasBuild[],
  platform: "ios",
): { production: EasBuild[]; rejected: number } {
  const production = builds.filter((build) => {
    const channel = build.updateChannel?.name;
    return (
      build.status === FINISHED &&
      build.platform === platform.toUpperCase() &&
      build.distribution === STORE &&
      (channel === PRODUCTION_CHANNEL || (channel === undefined && build.buildProfile === PRODUCTION_CHANNEL))
    );
  });
  return { production, rejected: builds.length - production.length };
}

/** The production builds whose runtime fingerprint matches the update's. */
export function matchingFingerprint(
  builds: readonly EasBuild[],
  fingerprint: string,
): { matches: EasBuild[]; fingerprintsSeen: Set<string | null> } {
  const matches = builds.filter((build) => fingerprintOf(build) === fingerprint);
  return { matches, fingerprintsSeen: new Set(builds.map(fingerprintOf)) };
}

/** A staged rollout percentage: whole numbers from 1 to 100. */
export function parseRolloutPercentage(raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new OtaPublishError(`--rollout-percentage must be a whole number from 1 to 100, got "${raw}".`);
  }
  return value;
}

/** argv as one POSIX shell line: each argument that needs it is single-quoted, with ' written as '\''. */
export function shellCommand(argv: readonly string[]): string {
  return argv.map((arg) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`)).join(" ");
}
