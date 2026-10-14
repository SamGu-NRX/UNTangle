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
  needs?: string;
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
  test("runs from the base branch, on every change that could change its answer", async () => {
    const { on, permissions } = await workflow("pr-rules.yml");
    expect(Object.keys(on)).toEqual(["pull_request_target"]);
    expect(on.pull_request_target).toEqual({
      types: ["opened", "synchronize", "reopened", "edited", "labeled", "unlabeled"],
      branches: ["alpha", "main", "edge"],
    });
    expect(permissions).toEqual({ contents: "read" });
  });

  test("runs Approval first and the two checks after it", async () => {
    const { jobs } = await workflow("pr-rules.yml");
    expect(Object.entries(jobs).map(([id, job]) => [id, job.name, job.needs])).toEqual([
      ["approval", "Approval", undefined],
      ["task-rule", "Task rule", "approval"],
      ["path-ownership", "Path ownership", "approval"],
    ]);
  });

  test("gives write access to Approval alone, and only to statuses and pull requests", async () => {
    const { jobs } = await workflow("pr-rules.yml");
    expect(jobs.approval.permissions).toEqual({ statuses: "write", "pull-requests": "write" });
    expect(jobs["task-rule"].permissions).toBeUndefined();
    expect(jobs["path-ownership"].permissions).toBeUndefined();
  });

  // A cancelled Approval run could be the one stripping sam-approved after a push.
  test("never cancels an Approval run in progress", async () => {
    const { concurrency, jobs } = await workflow("pr-rules.yml");
    expect(concurrency).toBeUndefined();
    expect(jobs.approval.concurrency).toEqual({
      group: "pr-rules-approval-${{ github.event.pull_request.number }}",
      "cancel-in-progress": false,
      queue: "max",
    });
  });

  test("decides with a pinned github-script, from an approver list written in the workflow", async () => {
    const { jobs } = await workflow("pr-rules.yml");
    expect(jobs.approval.steps).toHaveLength(1);
    const [decide] = jobs.approval.steps;
    expect(decide.id).toBe("decide");
    expect(decide.uses).toMatch(/^actions\/github-script@[0-9a-f]{40}$/);
    expect(JSON.parse(decide.env?.APPROVERS ?? "null")).toEqual(["SamGu-NRX"]);
    expect(decide.env?.APPROVAL_LABEL).toBe("sam-approved");
    expect(jobs.approval.outputs).toEqual({ approved: "${{ steps.decide.outputs.approved }}" });
  });

  test("passes Approval's answer to both checks, as unapproved when Approval didn't succeed", async () => {
    const { jobs } = await workflow("pr-rules.yml");
    for (const id of ["task-rule", "path-ownership"]) {
      // A skipped job counts as passing a required check, so the checks run even when Approval fails.
      expect(jobs[id].if).toBe("${{ !cancelled() }}");
      const check = jobs[id].steps.find((step) => step.run?.startsWith("bun "));
      expect(check?.env?.APPROVED).toBe(
        "${{ needs.approval.result == 'success' && needs.approval.outputs.approved || 'false' }}",
      );
    }
  });

  test("reads no labels outside Approval, and never names the old label", async () => {
    const text = await Bun.file(path.join(repoRoot, ".github/workflows/pr-rules.yml")).text();
    expect(text).not.toContain("PR_LABELS");
    expect(text).not.toContain("labels.*");
    // Split so this file doesn't match its own search.
    const oldLabel = ["lead", "approved"].join("-");
    const found = Bun.spawnSync(["git", "grep", "--untracked", "-l", "-F", oldLabel], { cwd: repoRoot });
    expect(found.stdout.toString()).toBe("");
    // git grep exits 1 for no match, and 128 for an error that would also print nothing.
    expect(found.exitCode).toBe(1);
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
    expect(jobs.approval.steps.every((step) => step.run === undefined && !step.uses?.startsWith("actions/checkout@"))).toBe(true);
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
  rules: Array<{ type: string; parameters?: { required_status_checks?: Array<{ context: string; integration_id?: number }> } }>;
};

async function ruleset(branch: string): Promise<Ruleset> {
  // SAFETY: each test asserts the values of the fields it reads, so a file of another shape fails it.
  return (await Bun.file(path.join(repoRoot, ".github/rulesets", `${branch}.json`)).json()) as Ruleset;
}

describe("the alpha and main rulesets", () => {
  const GITHUB_ACTIONS_APP = 15368;

  test("differ only in name, branch and the approval status each requires", async () => {
    const alpha = await ruleset("alpha");
    const main = await ruleset("main");
    expect(alpha.conditions.ref_name).toEqual({ include: ["refs/heads/alpha"], exclude: [] });
    expect(main.conditions.ref_name).toEqual({ include: ["refs/heads/main"], exclude: [] });
    const asAlpha = JSON.parse(JSON.stringify(main).replaceAll('"Sam approved (main)"', '"Sam approved (alpha)"'));
    expect({ ...asAlpha, name: alpha.name, conditions: alpha.conditions }).toEqual(alpha);
  });

  test.each(["alpha", "main"])(
    "%s requires every CI job, both PR checks and Sam's approval for that branch, each from GitHub Actions",
    async (branch) => {
      const ci = await workflow("ci.yml");
      const prRules = await workflow("pr-rules.yml");
      const expected = [
        // Live Postgres tests run only when asked for, so they can't be required.
        ...Object.values(ci.jobs).map((job) => job.name).filter((name) => name !== "Live Postgres tests"),
        ...Object.values(prRules.jobs).map((job) => job.name).filter((name) => name !== "Approval"),
        `Sam approved (${branch})`,
      ];
      const { rules } = await ruleset(branch);
      const checks = rules.find((rule) => rule.type === "required_status_checks")?.parameters?.required_status_checks;
      expect(checks).toEqual(expected.map((context) => ({ context, integration_id: GITHUB_ACTIONS_APP })));
    },
  );

  test("require a PR and forbid force-pushes and deletion", async () => {
    const { rules } = await ruleset("alpha");
    expect(rules.map((rule) => rule.type)).toEqual(["deletion", "non_fast_forward", "pull_request", "required_status_checks"]);
  });

  test("let admins bypass only when merging a PR, never by pushing", async () => {
    const { bypass_actors } = await ruleset("alpha");
    expect(bypass_actors).toEqual([{ actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "pull_request" }]);
  });
});
