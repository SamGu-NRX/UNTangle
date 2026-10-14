/**
 * Every package's `test` script: runs `bun test` on the package's test
 * files, minus what tests/pending-acceptance.txt lists.
 *
 * Bun's runner can't exclude files, so this finds the test files the way
 * Bun does and passes the rest by path. A file with pending test names runs
 * on its own, with a --test-name-pattern that matches every name but those.
 * Arguments after the script go to each `bun test` unchanged.
 *
 * Usage, from a package directory:
 *   bun --no-env-file <path>/run-tests.ts [bun test options]
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { PENDING_LIST, isTestFile, parsePendingList } from "./pending-acceptance";

/** Test files under `dir`, relative to it, as `bun test` with no arguments would find them. */
export function findTestFiles(dir: string): string[] {
  const found: string[] = [];
  const walk = (relative: string) => {
    for (const entry of readdirSync(path.join(dir, relative), { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const child = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile() && isTestFile(child)) found.push(child);
    }
  };
  walk("");
  return found.sort();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** One `bun test` invocation: some files, minus some full test names. */
export type TestRun = {
  /** Files to run, relative to the package directory. */
  files: string[];
  /** Full test names to leave out of these files. */
  skippedNames: string[];
};

export type TestPlan = {
  runs: TestRun[];
  /** Pending entries for this package, as written in the list. */
  skipped: string[];
};

/**
 * Which tests to run in `packageDir`. `testedDirs` are the workspaces, from
 * the repo root, whose test script runs this file. Throws when the list is
 * malformed, names a file that doesn't exist, or names one no workspace
 * would ever run, so a pending test can't be skipped forever by mistake.
 *
 * Files with pending test names run one per invocation, so a name filter
 * never reaches a same-named test in another file.
 */
export function planTests(repoRoot: string, packageDir: string, listText: string, testedDirs: string[]): TestPlan {
  const entries = parsePendingList(listText);
  const problems = entries.flatMap((entry) => {
    if (!isFile(path.join(repoRoot, entry.path))) return [`line ${entry.line}: ${entry.path} doesn't exist`];
    if (!testedDirs.some((dir) => entry.path.startsWith(`${dir}/`))) {
      return [`line ${entry.line}: ${entry.path} is in no workspace whose test script CI runs`];
    }
    return [];
  });
  if (problems.length > 0) throw new Error(`${PENDING_LIST} has problems:\n  ${problems.join("\n  ")}`);

  const packagePrefix = `${path.relative(repoRoot, packageDir).split(path.sep).join("/")}/`;
  const mine = entries.filter((entry) => entry.path.startsWith(packagePrefix));
  const skippedFiles = new Set(mine.flatMap((entry) => (entry.kind === "file" ? [entry.path.slice(packagePrefix.length)] : [])));
  const namesByFile = new Map<string, string[]>();
  for (const entry of mine) {
    if (entry.kind !== "test") continue;
    const file = entry.path.slice(packagePrefix.length);
    namesByFile.set(file, [...(namesByFile.get(file) ?? []), entry.name]);
  }
  const files = findTestFiles(packageDir).filter((file) => !skippedFiles.has(file));
  const plain = files.filter((file) => !namesByFile.has(file));
  const filtered = files.flatMap((file) => {
    const skippedNames = namesByFile.get(file);
    return skippedNames ? [{ files: [file], skippedNames }] : [];
  });
  return {
    runs: [...(plain.length > 0 ? [{ files: plain, skippedNames: [] }] : []), ...filtered],
    skipped: mine.map((entry) => entry.text),
  };
}

function isFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

/** Workspace directories, from the repo root, whose `test` script runs this file. */
export function testedWorkspaces(repoRoot: string): string[] {
  const manifest = readJson(path.join(repoRoot, "package.json"));
  const patterns = isRecord(manifest) ? manifest.workspaces : undefined;
  if (!Array.isArray(patterns) || !patterns.every((pattern): pattern is string => typeof pattern === "string")) {
    throw new Error("The root package.json has no workspaces list.");
  }
  return patterns.flatMap((pattern) =>
    [...new Bun.Glob(`${pattern}/package.json`).scanSync({ cwd: repoRoot })].flatMap((manifestPath) => {
      const workspace = readJson(path.join(repoRoot, manifestPath));
      const test = isRecord(workspace) && isRecord(workspace.scripts) ? workspace.scripts.test : undefined;
      return typeof test === "string" && test.includes("run-tests.ts") ? [path.posix.dirname(manifestPath)] : [];
    }),
  );
}

/** The `bun` arguments that carry out one run. */
export function bunTestArgs(run: TestRun, extraArgs: readonly string[]): string[] {
  const nameFilter =
    run.skippedNames.length === 0
      ? []
      : [
          `--test-name-pattern=^(?!(?:${run.skippedNames.map(escapeRegExp).join("|")})$)`,
          // Bun fails a run whose name filter leaves no test; here that only
          // means every test in the file is pending.
          "--pass-with-no-tests",
        ];
  return ["--no-env-file", "test", ...extraArgs, ...nameFilter, ...run.files.map((file) => `./${file}`)];
}

if (import.meta.main) {
  const repoRoot = path.resolve(import.meta.dir, "../../..");
  const packageDir = process.cwd();
  const listText = readFileSync(path.join(repoRoot, PENDING_LIST), "utf8");
  const plan = planTests(repoRoot, packageDir, listText, testedWorkspaces(repoRoot));
  if (plan.skipped.length > 0) {
    console.log(`Skipping pending acceptance tests listed in ${PENDING_LIST}:`);
    for (const entry of plan.skipped) console.log(`  ${entry}`);
  }
  if (plan.runs.length === 0) {
    console.log("No tests to run in this package.");
    process.exit(0);
  }
  let failed = false;
  for (const testRun of plan.runs) {
    const args = bunTestArgs(testRun, process.argv.slice(2));
    const child = Bun.spawnSync([process.execPath, ...args], { cwd: packageDir, stdio: ["inherit", "inherit", "inherit"] });
    if (child.exitCode !== 0) failed = true;
  }
  process.exit(failed ? 1 : 0);
}
