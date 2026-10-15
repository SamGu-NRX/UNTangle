/**
 * The Path ownership check: a PR from an agent branch (obv/*) may not touch
 * a path the lead owns, as listed in .github/lead-owned-paths.txt, unless
 * Sam approved the PR's current commit in a review. The workflow applies that
 * lift (.github/workflows/pr-rules.yml); this script always checks.
 *
 * CI runs this from the base branch (pull_request_target) and reads the list
 * from the base commit, so a PR can't shorten the list that judges it.
 */
import {
  LIFTED_BY,
  changedFiles,
  mergeBase,
  readAt,
  requireEnv,
  resolveCommit,
  type FileChange,
} from "./git";

export const LEAD_OWNED_PATHS = ".github/lead-owned-paths.txt";

export function isAgentBranch(ref: string): boolean {
  return ref.startsWith("obv/");
}

/** The globs in the list. Throws on a line that can't match a repo path. */
export function parseLeadOwnedPaths(text: string): string[] {
  const patterns: string[] = [];
  const problems: string[] = [];
  text.split("\n").forEach((raw, index) => {
    const pattern = raw.trim();
    if (pattern === "" || pattern.startsWith("#")) return;
    if (pattern.startsWith("/") || pattern.startsWith("./") || pattern.includes("\\")) {
      problems.push(`line ${index + 1}: "${pattern}" must be a glob from the repo root, with / between directories`);
      return;
    }
    patterns.push(pattern);
  });
  if (problems.length > 0) throw new Error(`${LEAD_OWNED_PATHS} has problems:\n  ${problems.join("\n  ")}`);
  if (patterns.length === 0) throw new Error(`${LEAD_OWNED_PATHS} lists no paths.`);
  return patterns;
}

/** Each lead-owned path the changes touch, with the glob that claims it. */
export function leadOwnedPathsTouched(patterns: string[], changes: FileChange[]): Array<{ path: string; pattern: string }> {
  const globs = patterns.map((pattern) => ({ pattern, glob: new Bun.Glob(pattern) }));
  const touched = changes.flatMap((change) => (change.previousPath ? [change.previousPath, change.path] : [change.path]));
  return [...new Set(touched)].flatMap((filePath) => {
    const owner = globs.find(({ glob }) => glob.match(filePath));
    return owner ? [{ path: filePath, pattern: owner.pattern }] : [];
  });
}

if (import.meta.main) {
  const repoDir = process.cwd();
  const headRef = requireEnv("HEAD_REF");
  if (!isAgentBranch(headRef)) {
    console.log(`Skipped: ${headRef} is not an agent branch (obv/*).`);
    process.exit(0);
  }
  const base = resolveCommit(repoDir, process.env.BASE_SHA ?? "HEAD");
  const head = resolveCommit(repoDir, requireEnv("HEAD_SHA"));
  const list = readAt(repoDir, base, LEAD_OWNED_PATHS);
  if (list === null) throw new Error(`${LEAD_OWNED_PATHS} is missing on the base branch.`);
  const touched = leadOwnedPathsTouched(parseLeadOwnedPaths(list), changedFiles(repoDir, mergeBase(repoDir, base, head), head));
  if (touched.length === 0) {
    console.log("The PR touches no lead-owned path.");
    process.exit(0);
  }
  console.error(`This agent PR touches paths the lead owns (${LEAD_OWNED_PATHS}):`);
  for (const { path, pattern } of touched) console.error(`  ${path} (${pattern})`);
  console.error(
    `Propose the change in the PR description instead. ${LIFTED_BY}`,
  );
  process.exit(1);
}
