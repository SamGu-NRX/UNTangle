/**
 * The Task rule check ("The task rule" in docs/architecture/README.md).
 *
 * A test listed in tests/pending-acceptance.txt is an acceptance test the
 * lead wrote for a task. A PR may make it pass, but may not edit, move or
 * delete it. Its only allowed edit to the list is deleting lines. It may add
 * a line only for a test file the PR itself creates, so an existing test
 * can't be hidden from CI by listing it. The lead-approved label lifts the
 * rule, for the lead's own changes to an acceptance test.
 *
 * CI runs this from the base branch (pull_request_target), so a PR can't
 * edit the check that judges it.
 */
import { PENDING_LIST, PendingListError, parsePendingList, type PendingEntry } from "./pending-acceptance";
import {
  LEAD_APPROVED,
  changedFiles,
  existsAt,
  labelsFromEnv,
  mergeBase,
  readAt,
  requireEnv,
  resolveCommit,
  type FileChange,
} from "./git";

export type TaskRuleInput = {
  /** The list on the branch the PR merges into. */
  baseList: string | null;
  /** The list where the PR branched off. */
  forkList: string | null;
  /** The list in the PR. */
  headList: string | null;
  /** Files the PR changes, from where it branched off. */
  changes: FileChange[];
  existedAtFork: (path: string) => boolean;
  existsAtHead: (path: string) => boolean;
};

function entriesOf(list: string | null, where: string, problems: string[]): PendingEntry[] {
  if (list === null) return [];
  try {
    return parsePendingList(list);
  } catch (error) {
    if (!(error instanceof PendingListError)) throw error;
    problems.push(`${where}: ${error.message}`);
    return [];
  }
}

/** Every way the PR breaks the task rule; empty when it follows it. */
export function taskRuleViolations(input: TaskRuleInput): string[] {
  const problems: string[] = [];
  const baseEntries = entriesOf(input.baseList, "base branch", problems);
  const forkEntries = entriesOf(input.forkList, "fork point", problems);
  const listed = new Set([...baseEntries, ...forkEntries].map((entry) => entry.path));
  for (const change of input.changes) {
    for (const touched of [change.previousPath, change.path]) {
      if (touched !== undefined && listed.has(touched)) {
        problems.push(`${touched} is a pending acceptance test. A task makes it pass without changing it.`);
      }
    }
  }

  if (input.headList === null) {
    problems.push(`${PENDING_LIST} is deleted. Delete only your own line from it.`);
    return problems;
  }
  const before = new Set(forkEntries.map((entry) => entry.text));
  for (const entry of entriesOf(input.headList, "this PR", problems)) {
    if (before.has(entry.text)) continue;
    if (input.existedAtFork(entry.path)) {
      problems.push(
        `${PENDING_LIST} line ${entry.line} adds ${entry.path}, which already exists. Listing an existing test hides it from CI.`,
      );
    } else if (!input.existsAtHead(entry.path)) {
      problems.push(`${PENDING_LIST} line ${entry.line} lists ${entry.path}, which this PR doesn't add.`);
    }
  }
  return problems;
}

if (import.meta.main) {
  const repoDir = process.cwd();
  if (labelsFromEnv(process.env.PR_LABELS).includes(LEAD_APPROVED)) {
    console.log(`Skipped: the PR has the ${LEAD_APPROVED} label.`);
    process.exit(0);
  }
  const base = resolveCommit(repoDir, process.env.BASE_SHA ?? "HEAD");
  const head = resolveCommit(repoDir, requireEnv("HEAD_SHA"));
  const fork = mergeBase(repoDir, base, head);
  const problems = taskRuleViolations({
    baseList: readAt(repoDir, base, PENDING_LIST),
    forkList: readAt(repoDir, fork, PENDING_LIST),
    headList: readAt(repoDir, head, PENDING_LIST),
    changes: changedFiles(repoDir, fork, head),
    existedAtFork: (filePath) => existsAt(repoDir, fork, filePath),
    existsAtHead: (filePath) => existsAt(repoDir, head, filePath),
  });
  if (problems.length === 0) {
    console.log("The PR follows the task rule.");
    process.exit(0);
  }
  console.error("The PR breaks the task rule (docs/architecture/README.md):");
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(`The lead can lift this check with the ${LEAD_APPROVED} label.`);
  process.exit(1);
}
