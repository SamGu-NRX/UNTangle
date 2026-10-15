/**
 * Reads tests/pending-acceptance.txt, the list of acceptance tests CI skips
 * until the task that makes them pass lands ("The task rule" in
 * docs/architecture/README.md).
 *
 * A line is a test file's path from the repo root, which skips the file, or
 * that path, "::" and one test's full name as Bun prints it (describe titles
 * and the test title joined by spaces), which skips that test. Blank lines
 * and lines starting with # are ignored.
 */

export const PENDING_LIST = "tests/pending-acceptance.txt";

export type PendingEntry =
  | { kind: "file"; path: string; line: number; text: string }
  | { kind: "test"; path: string; name: string; line: number; text: string };

/** The file names Bun's test runner picks up, checked against `bun test` itself in tests. */
const testFileName = /(\.test|_test|\.spec|_spec)\.(ts|tsx|js|jsx|mjs|mts|cjs|cts)$/;

export function isTestFile(relativePath: string): boolean {
  return testFileName.test(relativePath);
}

export class PendingListError extends Error {
  constructor(problems: string[]) {
    super(`${PENDING_LIST} has problems:\n${problems.map((problem) => `  ${problem}`).join("\n")}`);
    this.name = "PendingListError";
  }
}

/** Every entry in the list, in order. Throws PendingListError naming each bad line. */
export function parsePendingList(text: string): PendingEntry[] {
  const entries: PendingEntry[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  text.split("\n").forEach((raw, index) => {
    const line = index + 1;
    const content = raw.trim();
    if (content === "" || content.startsWith("#")) return;
    const separator = content.indexOf("::");
    const path = (separator === -1 ? content : content.slice(0, separator)).trim();
    const name = separator === -1 ? null : content.slice(separator + 2).trim();
    const problem = pathProblem(path) ?? (name === "" ? "has '::' but no test name after it" : null);
    if (problem) {
      problems.push(`line ${line}: "${content}" ${problem}`);
      return;
    }
    if (seen.has(content)) {
      problems.push(`line ${line}: "${content}" is listed twice`);
      return;
    }
    seen.add(content);
    entries.push(name === null ? { kind: "file", path, line, text: content } : { kind: "test", path, name, line, text: content });
  });
  if (problems.length > 0) throw new PendingListError(problems);
  return entries;
}

function pathProblem(path: string): string | null {
  if (path.startsWith("/") || path.startsWith("./")) return "must be a path from the repo root, without a leading / or ./";
  if (path.includes("\\")) return "must use / between directories";
  if (path.split("/").includes("..")) return "must not contain ..";
  if (!isTestFile(path)) return "is not a test file name Bun runs (like name.test.ts)";
  return null;
}
