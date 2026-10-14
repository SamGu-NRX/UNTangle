/**
 * Every package's `test` script: runs `bun test` on the package's test
 * files, minus what tests/pending-acceptance.txt lists.
 *
 * Bun's runner can't exclude files, so this finds the test files the way
 * Bun does and passes the rest by path. A pending test name becomes a
 * --test-name-pattern that matches every name but that one. Arguments after
 * the script go to `bun test` unchanged.
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

export type TestPlan = {
  /** Files to run, relative to the package directory. */
  files: string[];
  /** Full test names to leave out of those files. */
  skippedNames: string[];
  /** Pending entries for this package, as written in the list. */
  skipped: string[];
};

/**
 * Which tests to run in `packageDir`. Throws when the list is malformed or
 * names a file that doesn't exist, so a typo can't skip nothing quietly.
 */
export function planTests(repoRoot: string, packageDir: string, listText: string): TestPlan {
  const entries = parsePendingList(listText);
  const missing = entries.filter((entry) => !isFile(path.join(repoRoot, entry.path)));
  if (missing.length > 0) {
    throw new Error(
      `${PENDING_LIST} lists files that don't exist:\n${missing.map((entry) => `  line ${entry.line}: ${entry.path}`).join("\n")}`,
    );
  }
  const packagePrefix = `${path.relative(repoRoot, packageDir).split(path.sep).join("/")}/`;
  const mine = entries.filter((entry) => entry.path.startsWith(packagePrefix));
  const skippedFiles = new Set(mine.filter((entry) => entry.kind === "file").map((entry) => entry.path.slice(packagePrefix.length)));
  const skippedNames = mine.flatMap((entry) => (entry.kind === "test" ? [entry.name] : []));
  return {
    files: findTestFiles(packageDir).filter((file) => !skippedFiles.has(file)),
    skippedNames,
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

/** The `bun` arguments that carry out `plan`, or null when there is nothing to run. */
export function bunTestArgs(plan: TestPlan, extraArgs: readonly string[]): string[] | null {
  if (plan.files.length === 0) return null;
  const nameFilter =
    plan.skippedNames.length === 0
      ? []
      : [
          `--test-name-pattern=^(?!(?:${plan.skippedNames.map(escapeRegExp).join("|")})$)`,
          // Bun fails a run whose name filter leaves no test; here that only
          // means every remaining test is pending.
          "--pass-with-no-tests",
        ];
  return ["--no-env-file", "test", ...extraArgs, ...nameFilter, ...plan.files.map((file) => `./${file}`)];
}

if (import.meta.main) {
  const repoRoot = path.resolve(import.meta.dir, "../../..");
  const packageDir = process.cwd();
  const plan = planTests(repoRoot, packageDir, readFileSync(path.join(repoRoot, PENDING_LIST), "utf8"));
  if (plan.skipped.length > 0) {
    console.log(`Skipping pending acceptance tests listed in ${PENDING_LIST}:`);
    for (const entry of plan.skipped) console.log(`  ${entry}`);
  }
  const args = bunTestArgs(plan, process.argv.slice(2));
  if (args === null) {
    console.log("No tests to run in this package.");
    process.exit(0);
  }
  const child = Bun.spawnSync([process.execPath, ...args], { cwd: packageDir, stdio: ["inherit", "inherit", "inherit"] });
  process.exit(child.exitCode ?? 1);
}
