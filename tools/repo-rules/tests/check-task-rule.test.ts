import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { taskRuleViolations, type TaskRuleInput } from "../src/check-task-rule";
import { run, scratchDir, writeFiles } from "./helpers";
import { git, initRepo } from "./git-repo";

const accept = "packages/core/tests/filters.test.ts";
const list = `# pending\n${accept}\n`;

/** A PR that changes nothing, branched from a base whose list holds `accept`. */
function pr(overrides: Partial<TaskRuleInput>): TaskRuleInput {
  return {
    baseList: list,
    forkList: list,
    headList: list,
    changes: [],
    existedAtFork: (filePath) => filePath === accept,
    existsAtHead: (filePath) => filePath === accept,
    ...overrides,
  };
}

describe("taskRuleViolations", () => {
  test("allows a PR that makes the test pass and deletes its line", () => {
    const changes = [
      { status: "A", path: "packages/core/src/filters.ts" },
      { status: "M", path: "tests/pending-acceptance.txt" },
    ];
    expect(taskRuleViolations(pr({ headList: "# pending\n", changes }))).toEqual([]);
  });

  test.each([
    ["edits", { status: "M", path: accept }],
    ["deletes", { status: "D", path: accept }],
    ["renames", { status: "R", path: "packages/core/tests/moved.test.ts", previousPath: accept }],
  ])("refuses a PR that %s a listed test", (_verb, change) => {
    expect(taskRuleViolations(pr({ changes: [change] }))).toEqual([
      `${accept} is a pending acceptance test. A task makes it pass without changing it.`,
    ]);
  });

  test("refuses a change to a test the base listed after the PR branched off", () => {
    // The PR's own copy of the list predates the line.
    const changes = [{ status: "M", path: accept }];
    expect(taskRuleViolations(pr({ forkList: "", headList: "", changes }))).toEqual([
      `${accept} is a pending acceptance test. A task makes it pass without changing it.`,
    ]);
  });

  test("refuses listing a test that already exists, which would hide it", () => {
    const existing = "packages/core/tests/weights.test.ts";
    const input = pr({ headList: `${list}${existing}\n`, existedAtFork: (filePath) => [accept, existing].includes(filePath) });
    expect(taskRuleViolations(input)).toEqual([
      `tests/pending-acceptance.txt line 3 adds ${existing}, which already exists. Listing an existing test hides it from CI.`,
    ]);
  });

  test("refuses listing an existing test the PR renamed", () => {
    const renamed = "frontend/tests/a-pending.test.ts";
    const input = pr({
      headList: `${list}${renamed}\n`,
      changes: [{ status: "R", previousPath: "frontend/tests/a.test.ts", path: renamed }],
      existsAtHead: (filePath) => [accept, renamed].includes(filePath),
    });
    expect(taskRuleViolations(input)).toEqual([
      `tests/pending-acceptance.txt line 3 adds ${renamed}, which this PR made from frontend/tests/a.test.ts. Listing an existing test hides it from CI.`,
    ]);
  });

  test("refuses renaming a listed test's entry, since that unlists one test and lists another", () => {
    const input = pr({ headList: `# pending\n${accept}::filters some other test\n` });
    expect(taskRuleViolations(input)).toEqual([
      `tests/pending-acceptance.txt line 2 adds ${accept}, which already exists. Listing an existing test hides it from CI.`,
    ]);
  });

  test("allows the lead's flow: a new acceptance test listed in the same PR", () => {
    const added = "packages/core/tests/weights.test.ts";
    const input = pr({
      headList: `${list}${added}\n`,
      changes: [{ status: "A", path: added }],
      existsAtHead: (filePath) => [accept, added].includes(filePath),
    });
    expect(taskRuleViolations(input)).toEqual([]);
  });

  test("refuses listing a file the PR doesn't add", () => {
    const input = pr({ headList: `${list}packages/core/tests/ghost.test.ts\n` });
    expect(taskRuleViolations(input)).toEqual([
      "tests/pending-acceptance.txt line 3 lists packages/core/tests/ghost.test.ts, which this PR doesn't add.",
    ]);
  });

  test("refuses deleting the list", () => {
    expect(taskRuleViolations(pr({ headList: null }))).toEqual([
      "tests/pending-acceptance.txt is deleted. Delete only your own line from it.",
    ]);
  });

  test("refuses a malformed list", () => {
    const [problem] = taskRuleViolations(pr({ headList: `${list}not a test\n` }));
    expect(problem).toContain('this PR: tests/pending-acceptance.txt has problems:\n  line 3: "not a test"');
  });
});

describe("the check, run against real commits", () => {
  let dir: string;
  let cleanup: () => void;
  beforeEach(() => {
    ({ dir, cleanup } = scratchDir());
    initRepo(dir, {
      "tests/pending-acceptance.txt": list,
      [accept]: 'import { test } from "bun:test";\ntest("filters", () => {});\n',
    });
  });
  afterEach(() => cleanup());

  const script = path.resolve(import.meta.dir, "../src/check-task-rule.ts");
  function check(labels: string[] = []) {
    const head = git(dir, ["rev-parse", "HEAD"]);
    return run([process.execPath, "--no-env-file", script], dir, {
      BASE_SHA: "base",
      HEAD_SHA: head,
      PR_LABELS: JSON.stringify(labels),
    });
  }

  test("passes a PR that deletes its line and adds the implementation", () => {
    writeFiles(dir, { "tests/pending-acceptance.txt": "# pending\n", "packages/core/src/filters.ts": "export {};\n" });
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-qm", "task"]);
    const result = check();
    expect(result.output).toContain("The PR follows the task rule.");
    expect(result.exitCode).toBe(0);
  });

  test("fails a PR that edits the acceptance test, and names it", () => {
    writeFiles(dir, { [accept]: 'import { test } from "bun:test";\ntest.skip("filters", () => {});\n' });
    git(dir, ["commit", "-qam", "weaken the test"]);
    const result = check();
    expect(result.output).toContain(`${accept} is a pending acceptance test.`);
    expect(result.exitCode).toBe(1);
  });

  test("fails a PR that renames an existing test and lists the new name", () => {
    const original = "frontend/tests/a.test.ts";
    writeFiles(dir, { [original]: 'import { test } from "bun:test";\ntest("a", () => { throw new Error("broken"); });\n' });
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-qm", "an existing test"]);
    git(dir, ["tag", "-f", "base"]);
    git(dir, ["mv", original, "frontend/tests/a-pending.test.ts"]);
    writeFiles(dir, { "tests/pending-acceptance.txt": `${list}frontend/tests/a-pending.test.ts\n` });
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-qm", "hide it"]);
    const result = check();
    expect(result.output).toContain("which this PR made from frontend/tests/a.test.ts");
    expect(result.exitCode).toBe(1);
  });

  test("lets the lead-approved label through", () => {
    writeFiles(dir, { [accept]: "// rewritten by the lead\n" });
    git(dir, ["commit", "-qam", "lead fixes the test"]);
    const result = check(["documentation", "lead-approved"]);
    expect(result.output).toContain("Skipped: the PR has the lead-approved label.");
    expect(result.exitCode).toBe(0);
  });
});
