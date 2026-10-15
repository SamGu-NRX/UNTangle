/**
 * Publishes an EAS Update to production, behind the fingerprint guard the
 * architecture requires (docs/architecture/README.md, "Mobile"):
 *
 *   bun --no-env-file scripts/mobile/ota-publish.ts --message "fix day hero"
 *
 * The script is a dry run by default. It computes the local runtime
 * fingerprint, asks `eas build:list --json` for the stores' builds, and
 * refuses to publish when no finished production build shares that
 * fingerprint: the update would be invisible to every install, which almost
 * always means the change needs a new `eas build`, not an update.
 *
 * Run it from the repo root with `eas login` done and
 * EXPO_PUBLIC_EAS_PROJECT_ID / EXPO_PUBLIC_EAS_UPDATE_URL set
 * (docs/mobile/ota.md). `--build-list-file` and `--fingerprint-file` swap the
 * two network calls for saved files, which is how the PR's offline dry run
 * and CI could exercise the guard without an EAS session.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  EasProjectConfigError,
  resolveEasProject,
  type Env,
} from "../../mobile/src/updates/eas-project";
import {
  fingerprintOf,
  matchingFingerprint,
  OtaPublishError,
  parseBuildList,
  parseRolloutPercentage,
  selectProductionBuilds,
  shellCommand,
  type EasBuild,
} from "../../mobile/src/updates/ota-publish-plan";

interface CliOptions {
  readonly message: string;
  readonly rolloutPercentage?: number;
  readonly apply: boolean;
  readonly platform: "ios";
  readonly channel: "production";
  readonly buildListFile?: string;
  readonly fingerprintFile?: string;
}

// Absolute, so the script and its tests run from any directory.
const MOBILE_DIR = join(import.meta.dir, "../../mobile");
// Pinned to the release whose build:list --json shape the guard reads
// (docs/mobile/ota.md). Bump it together with a fresh look at that shape.
const EAS_CLI = ["npx", "--yes", "eas-cli@24.14.0"] as const;
/** eas-cli rejects a larger build:list --limit (BUILDS_LIMIT in eas-cli src/build/queries.ts). */
const BUILD_LIST_LIMIT = 50;

/** An eas-cli call that failed: EAS, the network or the login, not this checkout. Exits 1, not 2. */
class EasCommandError extends Error {}

function usage(): string {
  return [
    "Usage: bun --no-env-file scripts/mobile/ota-publish.ts --message <text> [options]",
    "",
    "Required:",
    "  --message <text>          The update's commit message.",
    "",
    "Options:",
    "  --rollout-percentage <1-100>  Stage the update to this share of users.",
    "  --apply                       Publish. Without it the script only prints the plan.",
    "  --platform ios                Only ios is supported (the shipping target).",
    "  --build-list-file <path>      Use a saved `eas build:list --json` output instead of calling EAS.",
    "  --fingerprint-file <path>     Use a saved fingerprint generator output instead of computing one.",
    "",
    "Dry run is the default: every command prints what it would run and stops.",
  ].join("\n");
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: { message?: string; rolloutPercentage?: number; apply: boolean; buildListFile?: string; fingerprintFile?: string } = {
    apply: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    switch (arg) {
      case "--message":
        if (!value) throw new OtaPublishError("--message needs a value.");
        options.message = value;
        index += 1;
        break;
      case "--rollout-percentage":
        if (!value) throw new OtaPublishError("--rollout-percentage needs a value.");
        options.rolloutPercentage = parseRolloutPercentage(value);
        index += 1;
        break;
      case "--apply":
        options.apply = true;
        break;
      case "--platform":
        if (!value) throw new OtaPublishError("--platform needs a value.");
        if (value !== "ios") {
          throw new OtaPublishError(
            `--platform ${value} is not supported: ios is the shipping target and the only platform this script publishes (docs/mobile/ota.md).`,
          );
        }
        index += 1;
        break;
      case "--build-list-file":
        if (!value) throw new OtaPublishError("--build-list-file needs a path.");
        options.buildListFile = value;
        index += 1;
        break;
      case "--fingerprint-file":
        if (!value) throw new OtaPublishError("--fingerprint-file needs a path.");
        options.fingerprintFile = value;
        index += 1;
        break;
      default:
        throw new OtaPublishError(`Unknown argument "${arg}".\n\n${usage()}`);
    }
  }
  if (!options.message) throw new OtaPublishError(`--message is required.\n\n${usage()}`);
  return {
    message: options.message,
    rolloutPercentage: options.rolloutPercentage,
    apply: options.apply,
    platform: "ios",
    channel: "production",
    buildListFile: options.buildListFile,
    fingerprintFile: options.fingerprintFile,
  };
}

interface RunResult {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

function run(command: readonly string[], cwd: string): RunResult {
  // env: without it Bun finds the command on the PATH the process started
  // with, so the tests' stand-in npx would be skipped for the real one.
  const spawned = Bun.spawnSync([...command], { cwd, env: process.env, stdout: "pipe", stderr: "pipe" });
  return {
    ok: spawned.exitCode === 0,
    stdout: spawned.stdout.toString(),
    stderr: spawned.stderr.toString(),
  };
}

/** The fingerprint of what this checkout would ship, from the local expo-updates. */
function localFingerprint(platform: string, file?: string): string {
  if (file) {
    return fingerprintFromFile(readInputFile(file), file);
  }
  const result = run(["npx", "--yes", "expo-updates", "fingerprint:generate", "--platform", platform], MOBILE_DIR);
  if (!result.ok) {
    throw new OtaPublishError(`fingerprint:generate failed:\n${result.stderr || result.stdout}`);
  }
  return fingerprintFromFile(result.stdout, "fingerprint:generate");
}

function readInputFile(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new OtaPublishError(`could not read the saved file at ${path}.`);
  }
}

function fingerprintFromFile(raw: string, source: string): string {
  // A malformed saved file is a local setup problem: exit 2 with a useful
  // message, not an unhandled SyntaxError.
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new OtaPublishError(`${source} is not valid JSON; expected a saved fingerprint generator output.`);
  }
  const hash = parsed !== null && typeof parsed === "object" ? (parsed as { hash?: unknown }).hash : undefined;
  if (typeof hash !== "string" || hash === "") {
    throw new OtaPublishError(`${source} holds no fingerprint hash.`);
  }
  return hash;
}

/**
 * `eas build:list` for finished store builds on the production channel,
 * newest first. With a fingerprint, EAS returns only builds that carry it, so
 * a match is never past the one page.
 */
export function buildListArgv(platform: "ios", fingerprint?: string): string[] {
  return [
    ...EAS_CLI, "build:list", "--json", "--non-interactive",
    "--platform", platform,
    "--status", "finished",
    "--distribution", "store",
    "--channel", "production",
    ...(fingerprint === undefined ? [] : ["--fingerprint-hash", fingerprint]),
    "--limit", String(BUILD_LIST_LIMIT),
  ];
}

/** The saved file as is, or one page from `eas build:list`. */
function storeBuilds(platform: "ios", fingerprint: string | undefined, file?: string): EasBuild[] {
  if (file) return parseBuildList(readInputFile(file));
  const result = run(buildListArgv(platform, fingerprint), MOBILE_DIR);
  if (!result.ok) {
    throw new EasCommandError(`eas build:list failed (is \`eas login\` done?):\n${result.stderr || result.stdout}`);
  }
  return parseBuildList(result.stdout);
}

/** The `eas update` argv: printed by the dry run, run by --apply. */
export function updateArgv(options: Pick<CliOptions, "message" | "rolloutPercentage" | "platform" | "channel">): string[] {
  return [
    ...EAS_CLI, "update",
    "--channel", options.channel,
    "--environment", options.channel,
    "--platform", options.platform,
    "--message", options.message,
    ...(options.rolloutPercentage === undefined ? [] : ["--rollout-percentage", String(options.rolloutPercentage)]),
    "--non-interactive",
  ];
}

export function main(env: Env, argv: readonly string[]): number {
  const options = parseArgs(argv);

  // The publish path is where a missing environment must fail, and fail
  // clearly: app.config falls back to a placeholder only so CI's env-less
  // web export keeps building.
  try {
    const eas = resolveEasProject(env, { allowPlaceholder: false });
    console.log(`EAS project: ${eas.projectId}`);
  } catch (error) {
    if (error instanceof EasProjectConfigError) {
      console.error(`Refusing to publish: ${error.message}`);
      return 1;
    }
    throw error;
  }

  const fingerprint = localFingerprint(options.platform, options.fingerprintFile);
  console.log(`Runtime fingerprint (local, ${options.platform}): ${fingerprint}`);

  const { matches } = matchingFingerprint(
    selectProductionBuilds(storeBuilds(options.platform, fingerprint, options.buildListFile)),
    fingerprint,
  );
  if (matches.length === 0) {
    const production = selectProductionBuilds(storeBuilds(options.platform, undefined, options.buildListFile));
    if (production.length === 0) {
      console.error(
        `Refusing to publish: eas build:list shows no finished ${options.channel} ${options.platform} store build at all. ` +
          "Run the first production build (docs/mobile/ota.md) before publishing updates.",
      );
      return 1;
    }
    const seen = Array.from(matchingFingerprint(production, fingerprint).fingerprintsSeen, (value) => value ?? "(none)")
      .map((value) => `  - ${value}`)
      .join("\n");
    const scope = options.buildListFile ? "" : ` (at most the newest ${BUILD_LIST_LIMIT} finished store builds)`;
    console.error(
      `Refusing to publish: the update's fingerprint matches no production build in the stores.\n` +
        `The update would be invisible to every install, which usually means the change needs a new ` +
        `\`eas build --profile ${options.channel}\`, not an update.\n` +
        `Fingerprints on file${scope}:\n${seen}`,
    );
    return 1;
  }

  const matched = matches
    .map((build) => `  - build ${build.id ?? "(no id)"} v${build.appVersion ?? "?"} fingerprint ${fingerprintOf(build)}`)
    .join("\n");
  const command = updateArgv(options);

  console.log(`Fingerprint guard passed: ${matches.length} production build(s) match.\n${matched}`);
  console.log(`Rollout: ${options.rolloutPercentage ?? 100}% of users on the ${options.channel} channel.`);
  console.log(`Update message: ${options.message}`);

  if (!options.apply) {
    console.log(`Dry run only. To publish, rerun with --apply. It will run, from ${MOBILE_DIR}/:\n  ${shellCommand(command)}`);
    return 0;
  }
  const result = run(command, MOBILE_DIR);
  if (!result.ok) {
    console.error(`eas update failed:\n${result.stderr || result.stdout}`);
    return 1;
  }
  console.log(result.stdout);
  console.log("Published.");
  return 0;
}

/** main's exit code, with a failed eas call as 1 and a local setup problem as 2 (docs/mobile/ota.md, "Exit codes"). */
export function cli(env: Env, argv: readonly string[]): number {
  try {
    return main(env, argv);
  } catch (error) {
    if (error instanceof EasCommandError) {
      console.error(error.message);
      return 1;
    }
    if (error instanceof OtaPublishError) {
      console.error(error.message);
      return 2;
    }
    throw error;
  }
}

if (import.meta.main) process.exit(cli(Bun.env, Bun.argv.slice(2)));
