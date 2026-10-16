// Runs under Bun from mobile's `test` script: the publish script uses Bun's
// process APIs, which mobile's Jest suite can't load.
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { shellCommand } from "../../mobile/src/updates/ota-publish-plan";
import { buildListArgv, cli, updateArgv } from "./ota-publish";

const env = {
  EXPO_PUBLIC_EAS_PROJECT_ID: "12345678-1234-1234-1234-123456789abc",
  EXPO_PUBLIC_EAS_UPDATE_URL: "https://u.expo.dev/12345678-1234-1234-1234-123456789abc",
};
const FINGERPRINT = "677b489a545ef723b22b76b0830877e24022f4e9";
const fixtures = join(import.meta.dir, "fixtures");

let dir: string;
let logs: string[];
let errors: string[];
const savedPath = process.env.PATH;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ota-publish-"));
  writeFileSync(join(dir, "fingerprint.json"), JSON.stringify({ hash: FINGERPRINT }));
  logs = [];
  errors = [];
  spyOn(console, "log").mockImplementation((line: string) => { logs.push(line); });
  spyOn(console, "error").mockImplementation((line: string) => { errors.push(line); });
});
afterEach(() => {
  process.env.PATH = savedPath;
  rmSync(dir, { recursive: true, force: true });
});

test("build:list asks for at most 50 builds, eas-cli's cap, filtered to finished production store builds", () => {
  const argv = buildListArgv("ios", FINGERPRINT);
  const limit = Number(argv[argv.indexOf("--limit") + 1]);
  expect(limit).toBeGreaterThan(0);
  expect(limit).toBeLessThanOrEqual(50);
  expect(shellCommand(argv)).toContain(
    `--status finished --distribution store --channel production --fingerprint-hash ${FINGERPRINT}`,
  );
  expect(buildListArgv("ios")).not.toContain("--fingerprint-hash");
});

test("a failed eas build:list exits 1, not the local-setup 2", () => {
  // An npx that fails like eas-cli does without a login.
  writeFileSync(join(dir, "npx"), "#!/bin/sh\necho 'An Expo user account is required' >&2\nexit 1\n");
  chmodSync(join(dir, "npx"), 0o755);
  process.env.PATH = `${dir}:${savedPath}`;
  expect(cli(env, ["--message", "x", "--fingerprint-file", join(dir, "fingerprint.json")])).toBe(1);
  expect(errors.join("\n")).toContain("eas build:list failed");
});

test("a saved build list with a null entry exits 2", () => {
  writeFileSync(join(dir, "builds.json"), '[{"id": "a"}, null]');
  expect(cli(env, ["--message", "x", "--build-list-file", join(dir, "builds.json"), "--fingerprint-file", join(dir, "fingerprint.json")])).toBe(2);
});

test("the dry run prints exactly the command --apply would run", () => {
  const message = `fix "login" it's $HOME`;
  const code = cli(env, [
    "--message", message, "--rollout-percentage", "25",
    "--build-list-file", join(fixtures, "production-builds.json"),
    "--fingerprint-file", join(dir, "fingerprint.json"),
  ]);
  expect(code).toBe(0);
  const printed = logs.find((line) => line.startsWith("Dry run only."))?.split("\n  ")[1];
  expect(printed).toBe(shellCommand(updateArgv({ message, rolloutPercentage: 25, platform: "ios", channel: "production" })));
});

test("a stale build list refuses with exit 1", () => {
  const code = cli(env, [
    "--message", "x",
    "--build-list-file", join(fixtures, "production-builds-stale.json"),
    "--fingerprint-file", join(dir, "fingerprint.json"),
  ]);
  expect(code).toBe(1);
  expect(errors.join("\n")).toContain("matches no production build");
});
