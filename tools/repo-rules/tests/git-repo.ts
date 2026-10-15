import { writeFiles } from "./helpers";

// Ignore the machine's git config, so signing or hooks there can't change a test.
const isolated = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
};

export function git(dir: string, args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd: dir, env: { ...process.env, ...isolated }, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed:\n${result.stderr.toString()}`);
  return result.stdout.toString().trim();
}

/**
 * A repository whose first commit holds `files`, tagged "base", with a
 * branch "pr" checked out at the same commit for the test to change.
 */
export function initRepo(dir: string, files: Record<string, string>): void {
  git(dir, ["init", "-q", "-b", "main"]);
  writeFiles(dir, files);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-qm", "base"]);
  git(dir, ["tag", "base"]);
  git(dir, ["checkout", "-qb", "pr"]);
}
