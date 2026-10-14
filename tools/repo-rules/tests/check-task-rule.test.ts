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

  test.each([
    ["an existing test, which would hide it", "packages/core/tests/weights.test.ts"],
    ["a test moved and edited from an old one, which git may not see as a rename", "frontend/tests/a-pending.test.ts"],
    ["a new test, which is the lead's job", "packages/core/tests/new.test.ts"],
    ["a changed name for a listed test, which unlists one test and lists another", `${accept}::filters some other test`],
  ])("refuses a new line for %s", (_case, line) => {
    expect(taskRuleViolations(pr({ headList: `${list}${line}\n` }))).toEqual([
      `tests/pending-acceptance.txt line 3 adds "${line}". Only the lead adds pending tests, since a new line can hide an existing test from CI.`,
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
  function check(approved = "false") {
    const head = git(dir, ["rev-parse", "HEAD"]);
    return run([process.execPath, "--no-env-file", script], dir, {
      BASE_SHA: "base",
      HEAD_SHA: head,
      APPROVED: approved,
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

  test("fails a PR that moves an existing test, rewrites it and lists the new path", () => {
    const original = "frontend/tests/a.test.ts";
    writeFiles(dir, { [original]: 'import { test } from "bun:test";\ntest("a", () => { throw new Error("broken"); });\n' });
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-qm", "an existing test"]);
    git(dir, ["tag", "-f", "base"]);
    // Rewritten enough that git reports a delete and an add, not a rename.
    git(dir, ["rm", "-q", original]);
    writeFiles(dir, {
      "frontend/tests/a-pending.test.ts": 'import { describe, test } from "bun:test";\ndescribe("renamed", () => {\n  test("a, rewritten", () => {});\n});\n',
      "tests/pending-acceptance.txt": `${list}frontend/tests/a-pending.test.ts\n`,
    });
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-qm", "hide it"]);
    const result = check();
    expect(result.output).toContain('adds "frontend/tests/a-pending.test.ts". Only the lead adds pending tests');
    expect(result.exitCode).toBe(1);
  });

  test("fails a PR that edits the acceptance test, and names who can lift it", () => {
    writeFiles(dir, { [accept]: "// rewritten\n" });
    git(dir, ["commit", "-qam", "rewrite the test"]);
    const result = check("false");
    expect(result.output).toContain("Only Sam can lift this check, by approving the commit with the sam-approved label.");
    expect(result.exitCode).toBe(1);
  });

  test("lets a commit Sam approved through", () => {
    writeFiles(dir, { [accept]: "// rewritten by the lead\n" });
    git(dir, ["commit", "-qam", "lead fixes the test"]);
    const result = check("true");
    expect(result.output).toContain("Skipped: Sam approved this commit.");
    expect(result.exitCode).toBe(0);
  });

  test.each([
    ["missing", undefined],
    ["a label list, as the old PR_LABELS was", '["sam-approved"]'],
    ["capitalized", "True"],
  ])("fails loudly when APPROVED is %s", (_case, value) => {
    const result = run([process.execPath, "--no-env-file", script], dir, {
      BASE_SHA: "base",
      HEAD_SHA: git(dir, ["rev-parse", "HEAD"]),
      ...(value === undefined ? {} : { APPROVED: value }),
    });
    expect(result.output).toContain('APPROVED must be "true" or "false", from the Approval job.');
    expect(result.exitCode).not.toBe(0);
  });
});
