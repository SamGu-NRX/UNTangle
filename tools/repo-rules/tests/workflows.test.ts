import { describe, expect, test } from "bun:test";
import path from "node:path";
import { repoRoot } from "./helpers";

type Step = { uses?: string; run?: string; with?: Record<string, unknown>; env?: Record<string, string> };
type Job = { name: string; steps: Step[] };
type Workflow = { on: Record<string, unknown>; permissions: unknown; jobs: Record<string, Job> };

async function workflow(name: string): Promise<Workflow> {
  // SAFETY: only the fields named in Workflow are read, and each test asserts
  // their values, so a file of another shape fails the test that reads it.
  return Bun.YAML.parse(await Bun.file(path.join(repoRoot, ".github/workflows", name)).text()) as Workflow;
}

describe("ci.yml", () => {
  test("keeps the job names the main ruleset requires", async () => {
    const { jobs } = await workflow("ci.yml");
    expect(Object.values(jobs).map((job) => job.name)).toEqual(["Typecheck", "Lint", "Test", "Build", "Extension journey", "Live Postgres tests"]);
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

  test("reads the lists from the PR's base, not the default branch", async () => {
    const { jobs } = await workflow("pr-rules.yml");
    for (const job of Object.values(jobs)) {
      const check = job.steps.find((step) => step.run?.startsWith("bun "));
      expect(check?.env?.BASE_SHA).toBe("${{ github.event.pull_request.base.sha }}");
    }
  });

  // pull_request_target has the base branch's access, so running the PR's code here would hand it that access.
  test("never checks out or runs the PR's code", async () => {
    const { jobs } = await workflow("pr-rules.yml");
    for (const job of Object.values(jobs)) {
      for (const step of job.steps) {
        if (step.uses?.startsWith("actions/checkout@")) {
          expect(step.with?.ref).toBe("${{ github.event.pull_request.base.sha }}");
        }
        if (step.run !== undefined) {
          expect(step.run).toMatch(/^(git fetch --no-tags origin "\+refs\/pull\/\$\{PR_NUMBER\}\/head:refs\/remotes\/pr\/head"|bun --no-env-file tools\/repo-rules\/src\/check-[a-z-]+\.ts)$/);
        }
      }
    }
  });
});
