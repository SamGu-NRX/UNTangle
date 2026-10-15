/** The few git reads the PR checks need. Each fails loudly rather than guessing. */

export type FileChange = {
  /** git's status letter: A, M, D, R, C or T. */
  status: string;
  path: string;
  /** The path before a rename or copy. */
  previousPath?: string;
};

function git(repoDir: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const result = Bun.spawnSync(["git", ...args], { cwd: repoDir, stdout: "pipe", stderr: "pipe" });
  return { ok: result.exitCode === 0, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

function gitOrThrow(repoDir: string, args: string[]): string {
  const result = git(repoDir, args);
  if (!result.ok) throw new Error(`git ${args.join(" ")} failed:\n${result.stderr}`);
  return result.stdout;
}

export function resolveCommit(repoDir: string, rev: string): string {
  return gitOrThrow(repoDir, ["rev-parse", "--verify", `${rev}^{commit}`]).trim();
}

export function mergeBase(repoDir: string, a: string, b: string): string {
  return gitOrThrow(repoDir, ["merge-base", a, b]).trim();
}

/** The file's text at `rev`, or null when the file doesn't exist there. */
export function readAt(repoDir: string, rev: string, filePath: string): string | null {
  if (!existsAt(repoDir, rev, filePath)) return null;
  return gitOrThrow(repoDir, ["show", `${rev}:${filePath}`]);
}

export function existsAt(repoDir: string, rev: string, filePath: string): boolean {
  return git(repoDir, ["cat-file", "-e", `${rev}:${filePath}`]).ok;
}

/** Files changed between two commits, with renames detected. */
export function changedFiles(repoDir: string, from: string, to: string): FileChange[] {
  const fields = gitOrThrow(repoDir, ["diff", "--name-status", "-M", "-z", "--no-color", from, to]).split("\0");
  const changes: FileChange[] = [];
  for (let index = 0; index < fields.length - 1; ) {
    const status = fields[index++];
    const letter = status.charAt(0);
    if (letter === "R" || letter === "C") {
      changes.push({ status: letter, previousPath: fields[index++], path: fields[index++] });
    } else {
      changes.push({ status: letter, path: fields[index++] });
    }
  }
  return changes;
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name}.`);
  return value;
}

/** What a failed PR check prints last: who can lift it, and how. */
export const LIFTED_BY = "Only Sam's approving review of the PR's current commit lifts this check.";
