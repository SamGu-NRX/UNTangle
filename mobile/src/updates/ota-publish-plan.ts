/**
 * The pure core of scripts/mobile/ota-publish.ts: parse `eas build:list --json`
 * output, decide whether the local fingerprint matches a production build in
 * the stores, and validate a staged rollout percentage. Kept beside the
 * update modules so the mobile Jest suite tests the fingerprint guard the
 * same way it tests the runtime flow.
 */

/** The subset of an EAS build record the guard needs. */
export interface EasBuild {
  readonly id?: string | null;
  readonly status?: string | null;
  readonly platform?: string | null;
  readonly channel?: string | null;
  readonly profile?: string | null;
  readonly appVersion?: string | null;
  readonly runtimeVersion?: string | { readonly fingerprint?: string } | null;
}

export class OtaPublishError extends Error {}

/**
 * Accepts either a bare array (older EAS CLI) or the paged envelope the
 * current CLI prints (`{"allBuilds": [...], "currentBuilds": [...]}`).
 */
export function parseBuildList(raw: string): EasBuild[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new OtaPublishError("could not parse the eas build:list JSON output");
  }
  if (Array.isArray(parsed)) return parsed as EasBuild[];
  if (parsed !== null && typeof parsed === "object" && Array.isArray((parsed as { allBuilds?: unknown }).allBuilds)) {
    return (parsed as { allBuilds: EasBuild[] }).allBuilds;
  }
  throw new OtaPublishError("the eas build:list JSON output holds no build array");
}

export function fingerprintOf(build: EasBuild): string | null {
  const runtime = build.runtimeVersion;
  if (typeof runtime === "string") return runtime;
  if (runtime !== null && typeof runtime === "object" && typeof runtime.fingerprint === "string") {
    return runtime.fingerprint;
  }
  return null;
}

const PRODUCTION_CHANNEL = "production";
const FINISHED = "FINISHED";

/**
 * The production builds the update could land on: finished, on the given
 * platform, and on the production channel (or the production profile, for a
 * record that predates channels). Builds on other channels, like a preview
 * build for internal distribution, must never satisfy the guard.
 */
export function selectProductionBuilds(
  builds: readonly EasBuild[],
  platform: string,
): { production: EasBuild[]; rejected: number } {
  const production = builds.filter(
    (build) =>
      (build.status ?? "").toUpperCase() === FINISHED &&
      build.platform === platform &&
      (build.channel === PRODUCTION_CHANNEL || (build.channel == null && build.profile === PRODUCTION_CHANNEL)),
  );
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
