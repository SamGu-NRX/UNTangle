import { describe, expect, test } from "bun:test";
import path from "node:path";
import { repoRoot, run, scratchDir, writeFiles } from "./helpers";

type Step = {
  id?: string;
  if?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
};
type Job = {
  name: string;
  needs?: string | string[];
  if?: string;
  permissions?: unknown;
  concurrency?: { group: string; "cancel-in-progress": boolean; queue?: string };
  outputs?: Record<string, string>;
  steps: Step[];
};
type Workflow = { on: Record<string, unknown>; permissions: unknown; concurrency?: unknown; jobs: Record<string, Job> };

async function workflow(name: string): Promise<Workflow> {
  // SAFETY: only the fields named in Workflow are read, and each test asserts
  // their values, so a file of another shape fails the test that reads it.
  return Bun.YAML.parse(await Bun.file(path.join(repoRoot, ".github/workflows", name)).text()) as Workflow;
}

describe("ci.yml", () => {
  test("keeps the job names the main ruleset requires", async () => {
    const { jobs } = await workflow("ci.yml");
    expect(Object.values(jobs).map((job) => job.name)).toEqual(["Typecheck", "Lint", "Test", "Build", "Live Postgres tests"]);
  });

  test("runs on PRs and pushes for alpha, main and edge, with read-only access", async () => {
    const { on, permissions } = await workflow("ci.yml");
    expect(on.pull_request).toEqual({ branches: ["alpha", "main", "edge"] });
    expect(on.push).toEqual({ branches: ["alpha", "main", "edge"] });
    expect(permissions).toEqual({ contents: "read" });
  });

  test("typechecks, lints and tests through the root scripts that reach every package", async () => {
    const { jobs } = await workflow("ci.yml");
    const runs = (id: string) => jobs[id].steps.flatMap((step) => (step.run ? [step.run] : []));
    expect(runs("typecheck")).toContain("bun --no-env-file run typecheck");
    expect(runs("lint")).toContain("bun --no-env-file run lint");
    expect(runs("test")).toContain("bun --no-env-file run test");
  });
});

describe("pr-rules.yml", () => {
  const BASES = "contains(fromJSON('[\"alpha\", \"main\", \"edge\"]'), github.event.pull_request.base.ref)";

  test("runs from the default branch on PR changes, and again on each review", async () => {
    const { on, permissions } = await workflow("pr-rules.yml");
    expect(on).toEqual({
      pull_request_target: { types: ["opened", "synchronize", "reopened", "edited"], branches: ["alpha", "main", "edge"] },
      pull_request_review: { types: ["submitted", "dismissed"] },
    });
    expect(permissions).toEqual({ contents: "read" });
  });

  // Each run reads the reviews when it reports, so the newest run has the latest answer.
  test("lets the newest event's run replace older ones", async () => {
    const { concurrency } = await workflow("pr-rules.yml");
    expect(concurrency).toEqual({ group: "pr-rules-${{ github.event.pull_request.number }}", "cancel-in-progress": true });
  });

  test("runs both checks, then Report, for PRs into alpha, main and edge", async () => {
    const { jobs } = await workflow("pr-rules.yml");
    expect(Object.entries(jobs).map(([id, job]) => [id, job.name, job.needs, job.if])).toEqual([
      ["task-rule", "Check the task rule", undefined, BASES],
      ["path-ownership", "Check path ownership", undefined, BASES],
      ["report", "Report", ["task-rule", "path-ownership"], `\${{ !cancelled() && ${BASES} }}`],
    ]);
  });

  // A job's own check is named after the job, so no job may share a name with a status the rulesets require.
  test("names no job after a status it reports", async () => {
    const { jobs } = await workflow("pr-rules.yml");
    const names = Object.values(jobs).map((job) => job.name);
    expect(names).not.toContain("Task rule");
    expect(names).not.toContain("Path ownership");
  });

  test("gives write access to Report alone, and only to statuses", async () => {
    const { jobs } = await workflow("pr-rules.yml");
    expect(jobs.report.permissions).toEqual({ statuses: "write", "pull-requests": "read" });
    expect(jobs["task-rule"].permissions).toBeUndefined();
    expect(jobs["path-ownership"].permissions).toBeUndefined();
  });

  // The base's scripts get nothing that could lift them, old or new: before this change they lifted on PR_LABELS.
  test("runs the base's checks with no approval input", async () => {
    const { jobs } = await workflow("pr-rules.yml");
    const envOf = (id: string) => Object.keys(jobs[id].steps.find((step) => step.run?.startsWith("bun "))?.env ?? {});
    expect(envOf("task-rule")).toEqual(["BASE_SHA", "HEAD_SHA"]);
    expect(envOf("path-ownership")).toEqual(["BASE_SHA", "HEAD_SHA", "HEAD_REF"]);
  });

  test("hands each check's result and whether it ran to Report", async () => {
    const { jobs } = await workflow("pr-rules.yml");
    expect(jobs["task-rule"].outputs).toEqual({ checked: "${{ steps.tools.outputs.present }}" });
    expect(jobs["path-ownership"].outputs).toEqual({ checked: "${{ steps.tools.outputs.present }}" });
    expect(jobs.report.steps).toHaveLength(1);
    const [post] = jobs.report.steps;
    expect(post.uses).toMatch(/^actions\/github-script@[0-9a-f]{40}$/);
    expect(post.env).toEqual({
      APPROVERS: '["SamGu-NRX"]',
      TASK_RULE_RESULT: "${{ needs.task-rule.result }}",
      TASK_RULE_CHECKED: "${{ needs.task-rule.outputs.checked }}",
      PATH_OWNERSHIP_RESULT: "${{ needs.path-ownership.result }}",
      PATH_OWNERSHIP_CHECKED: "${{ needs.path-ownership.outputs.checked }}",
    });
  });

  test("leaves no approval label anywhere in the repository", () => {
    // Split so this file doesn't match its own search.
    for (const label of [["lead", "approved"].join("-"), ["sam", "approved"].join("-")]) {
      const found = Bun.spawnSync(["git", "grep", "--untracked", "-l", "-F", label], { cwd: repoRoot });
      expect(found.stdout.toString()).toBe("");
      // git grep exits 1 for no match, and 128 for an error that would also print nothing.
      expect(found.exitCode).toBe(1);
    }
  });

  test("reads the lists from the PR's base, not the default branch", async () => {
    const { jobs } = await workflow("pr-rules.yml");
    for (const id of ["task-rule", "path-ownership"]) {
      const check = jobs[id].steps.find((step) => step.run?.startsWith("bun "));
      expect(check?.env?.BASE_SHA).toBe("${{ github.event.pull_request.base.sha }}");
    }
  });

  // pull_request_target has the base branch's access, so running the PR's code here would hand it that access.
  test("never checks out or runs the PR's code", async () => {
    const { jobs } = await workflow("pr-rules.yml");
    expect(jobs.report.steps.every((step) => step.run === undefined && !step.uses?.startsWith("actions/checkout@"))).toBe(true);
    for (const id of ["task-rule", "path-ownership"]) {
      const [checkout, presence, ...rest] = jobs[id].steps;
      expect(checkout.uses).toStartWith("actions/checkout@");
      expect(checkout.with?.ref).toBe("${{ github.event.pull_request.base.sha }}");
      expect(presence.id).toBe("tools");
      expect(presence.run).not.toContain("bun");
      expect(presence.run).not.toContain("pr/head");
      for (const step of rest) {
        expect(step.if).toBe("steps.tools.outputs.present == 'true'");
        if (step.run !== undefined) {
          expect(step.run).toMatch(/^(git fetch --no-tags origin "\+refs\/pull\/\$\{PR_NUMBER\}\/head:refs\/remotes\/pr\/head"|bun --no-env-file tools\/repo-rules\/src\/check-[a-z-]+\.ts)$/);
        }
      }
    }
  });

  describe.each([
    ["task-rule", "tools/repo-rules/src/check-task-rule.ts", "Task rule not checked"],
    ["path-ownership", "tools/repo-rules/src/check-lead-paths.ts", "Path ownership not checked"],
  ])("%s on a base commit", (id, script, title) => {
    async function presenceCheck(files: Record<string, string>) {
      const { jobs } = await workflow("pr-rules.yml");
      const step = jobs[id].steps.find((candidate) => candidate.id === "tools");
      if (step?.run === undefined) throw new Error(`${id} has no step with id tools.`);
      const { dir, cleanup } = scratchDir();
      try {
        writeFiles(dir, files);
        const outputFile = path.join(dir, "github-output");
        const result = run(["bash", "-e", "-c", step.run], dir, { GITHUB_OUTPUT: outputFile });
        return { ...result, written: await Bun.file(outputFile).text() };
      } finally {
        cleanup();
      }
    }

    test("without the check passes with a notice saying so", async () => {
      const result = await presenceCheck({ "README.md": "old base\n" });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain(`::notice title=${title}::The base commit has no ${script}, so this PR passes without a check.`);
      expect(result.written).toBe("present=false\n");
    });

    test("with the check runs it", async () => {
      const result = await presenceCheck({ [script]: "" });
      expect(result.exitCode).toBe(0);
      expect(result.output).toBe("");
      expect(result.written).toBe("present=true\n");
    });
  });
});

type Ruleset = {
  name: string;
  conditions: { ref_name: { include: string[]; exclude: string[] } };
  bypass_actors: Array<{ actor_id: number; actor_type: string; bypass_mode: string }>;
  rules: Array<{ type: string; parameters?: Record<string, unknown> }>;
};

async function ruleset(branch: string): Promise<Ruleset> {
  // SAFETY: each test asserts the values of the fields it reads, so a file of another shape fails it.
  return (await Bun.file(path.join(repoRoot, ".github/rulesets", `${branch}.json`)).json()) as Ruleset;
}

const rule = (body: Ruleset, type: string) => body.rules.find((candidate) => candidate.type === type)?.parameters;

describe("the alpha and main rulesets", () => {
  const GITHUB_ACTIONS_APP = 15368;

  test("differ only in name and branch", async () => {
    const alpha = await ruleset("alpha");
    const main = await ruleset("main");
    expect(alpha.conditions.ref_name).toEqual({ include: ["refs/heads/alpha"], exclude: [] });
    expect(main.conditions.ref_name).toEqual({ include: ["refs/heads/main"], exclude: [] });
    expect({ ...main, name: alpha.name, conditions: alpha.conditions }).toEqual(alpha);
  });

  test("require a PR and forbid force-pushes and deletion", async () => {
    const { rules } = await ruleset("alpha");
    expect(rules.map((candidate) => candidate.type)).toEqual(["deletion", "non_fast_forward", "pull_request", "required_status_checks"]);
  });

  // .github/CODEOWNERS names Sam for every path, so the one approval must be his, and on the last push.
  test("require Sam's approving review of the PR's latest push", async () => {
    expect(rule(await ruleset("alpha"), "pull_request")).toEqual({
      allowed_merge_methods: ["merge", "squash", "rebase"],
      dismiss_stale_reviews_on_push: true,
      require_code_owner_review: true,
      require_extra_approval_for_unattributed_changes: true,
      require_last_push_approval: true,
      required_approving_review_count: 1,
      required_review_thread_resolution: false,
      required_reviewers: [],
    });
    expect(await Bun.file(path.join(repoRoot, ".github/CODEOWNERS")).text()).toEndWith("\n* @SamGu-NRX\n");
  });

  test("require every CI job and both PR rules, each from GitHub Actions, on a branch up to date with its base", async () => {
    const ci = await workflow("ci.yml");
    const expected = [
      // Live Postgres tests run only when asked for, so they can't be required.
      ...Object.values(ci.jobs).map((job) => job.name).filter((name) => name !== "Live Postgres tests"),
      // The statuses pr-rules.yml's Report job posts on the head commit (tests/report.test.ts).
      "Task rule",
      "Path ownership",
    ];
    expect(rule(await ruleset("alpha"), "required_status_checks")).toEqual({
      do_not_enforce_on_create: false,
      strict_required_status_checks_policy: true,
      required_status_checks: expected.map((context) => ({ context, integration_id: GITHUB_ACTIONS_APP })),
    });
  });

  test("let admins bypass only when merging a PR, never by pushing", async () => {
    const { bypass_actors } = await ruleset("alpha");
    expect(bypass_actors).toEqual([{ actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "pull_request" }]);
  });
});
