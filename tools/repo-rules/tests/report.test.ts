/**
 * Runs the Report job's script, the exact text in .github/workflows/pr-rules.yml,
 * the way actions/github-script does: as the body of an async function given
 * `github`, `context` and `core`. GitHub is modeled by the fakes below: the PR's
 * reviews, as the reviews API lists them, and the statuses the script posts.
 */
import { describe, expect, test } from "bun:test";
import path from "node:path";
import { repoRoot } from "./helpers";

type ScriptStep = { env?: Record<string, string>; with?: { script?: string } };
type PrRules = { jobs: { report: { steps: ScriptStep[] } } };

// SAFETY: reportStep() checks the fields read here and throws if they're missing.
const prRules = Bun.YAML.parse(await Bun.file(path.join(repoRoot, ".github/workflows/pr-rules.yml")).text()) as PrRules;

function reportStep(): { script: string; env: Record<string, string> } {
  const [step] = prRules.jobs.report.steps;
  if (typeof step?.with?.script !== "string" || step.env === undefined) {
    throw new Error("pr-rules.yml's report job has no script step with an env.");
  }
  return { script: step.with.script, env: step.env };
}

const SAM = "SamGu-NRX";
const OWNER = "SamGu-NRX";
const REPO = "UNTangle";
const HEAD = "b2".repeat(20);

type ReviewState = "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING";
type Review = { id: number; user: { login: string }; state: ReviewState; commit_id: string; submitted_at: string };
type Posted = { sha: string; context: string; state: string; description: string; target_url: string };
type JobResult = { result: string; checked?: string };

/** One PR's reviews, in the order they were submitted. Two share each second, as quick reviews do. */
class Reviews {
  readonly list: Review[] = [];

  add(login: string, state: ReviewState, commit_id = HEAD): this {
    const id = this.list.length + 1;
    const submitted_at = new Date(Date.UTC(2026, 9, 14, 12, 0, Math.floor(id / 2))).toISOString().replace(".000", "");
    this.list.push({ id, user: { login }, state, commit_id, submitted_at });
    return this;
  }

  /** Dismissing a review changes its state; it keeps its time and place. */
  dismiss(index: number): this {
    this.list[index].state = "DISMISSED";
    return this;
  }
}

const passed: JobResult = { result: "success", checked: "true" };
const failed: JobResult = { result: "failure", checked: "true" };

/** Runs the Report script for one PR and returns the statuses it posted. */
async function report(
  reviews: Reviews,
  jobs: { taskRule?: JobResult; pathOwnership?: JobResult } = {},
  options: { number?: number; env?: Record<string, string>; currentHead?: string; currentBase?: string } = {},
): Promise<Posted[]> {
  const { script, env } = reportStep();
  const number = options.number ?? 7;
  const taskRule = jobs.taskRule ?? passed;
  const pathOwnership = jobs.pathOwnership ?? passed;
  const posted: Posted[] = [];
  const github = {
    paginate: async <T>(method: (params: never) => Promise<{ data: T[] }>, params: never) => (await method(params)).data,
    rest: {
      pulls: {
        get: async (params: { owner: string; repo: string; pull_number: number }) => {
          if (params.owner !== OWNER || params.repo !== REPO || params.pull_number !== number) {
            throw new Error(`Asked about the wrong PR: ${JSON.stringify(params)}`);
          }
          return { data: { head: { sha: options.currentHead ?? HEAD }, base: { ref: options.currentBase ?? "alpha" } } };
        },
        // Newest first, since the API promises no order and the script must sort.
        listReviews: async (params: { owner: string; repo: string; pull_number: number }) => {
          if (params.owner !== OWNER || params.repo !== REPO || params.pull_number !== number) {
            throw new Error(`Asked about the wrong PR: ${JSON.stringify(params)}`);
          }
          return { data: [...reviews.list].reverse() };
        },
      },
      repos: {
        createCommitStatus: async (params: Posted & { owner: string; repo: string }) => {
          if (params.owner !== OWNER || params.repo !== REPO) throw new Error("Posted to the wrong repository.");
          const { sha, context, state, description, target_url } = params;
          posted.push({ sha, context, state, description, target_url });
          return { data: {} };
        },
      },
    },
  };
  const context = {
    repo: { owner: OWNER, repo: REPO },
    serverUrl: "https://github.com",
    runId: 42,
    // The PR comes from the pr job's outputs, not the event, which may be a workflow_run.
    payload: {},
  };
  const core = { notice: () => {} };
  const stepEnv = {
    ...env,
    TASK_RULE_RESULT: taskRule.result,
    TASK_RULE_CHECKED: taskRule.checked ?? "",
    PATH_OWNERSHIP_RESULT: pathOwnership.result,
    PATH_OWNERSHIP_CHECKED: pathOwnership.checked ?? "",
    PR_NUMBER: String(number),
    HEAD_SHA: HEAD,
    BASE_REF: "alpha",
    ...options.env,
  };
  // github-script builds the same function: new AsyncFunction(...argument names, script).
  const AsyncFunction: new (...parameters: string[]) => (...args: unknown[]) => Promise<unknown> = Object.getPrototypeOf(
    async () => {},
  ).constructor;
  // `process` is passed in so the script reads the step's env, not the test runner's.
  await new AsyncFunction("github", "context", "core", "process", script)(github, context, core, { env: stepEnv });
  return posted;
}

/** The state and description posted for one rule. */
function status(posted: Posted[], context: string): Pick<Posted, "state" | "description"> | undefined {
  const match = posted.filter((item) => item.context === context);
  if (match.length > 1) throw new Error(`${context} was posted ${match.length} times.`);
  return match[0] && { state: match[0].state, description: match[0].description };
}

const fails = { state: "failure", description: "Fails. Only Sam's approving review of this commit lifts it." };
const lifted = { state: "success", description: "Sam approved this commit, which lifts this check." };
const passes = { state: "success", description: "Passed." };

describe("the Report job", () => {
  test("posts both rules on the head commit, linked to the run", async () => {
    expect(await report(new Reviews())).toEqual([
      { sha: HEAD, context: "Task rule", ...passes, target_url: "https://github.com/SamGu-NRX/UNTangle/actions/runs/42" },
      { sha: HEAD, context: "Path ownership", ...passes, target_url: "https://github.com/SamGu-NRX/UNTangle/actions/runs/42" },
    ]);
  });

  test("posts statuses the alpha and main rulesets both require", async () => {
    const posted = (await report(new Reviews())).map((item) => item.context);
    for (const branch of ["alpha", "main"]) {
      // SAFETY: the expectation below fails on any other shape.
      const body = (await Bun.file(path.join(repoRoot, ".github/rulesets", `${branch}.json`)).json()) as {
        rules: Array<{ parameters?: { required_status_checks?: Array<{ context: string }> } }>;
      };
      const required = body.rules.flatMap((rule) => rule.parameters?.required_status_checks?.map((check) => check.context) ?? []);
      for (const context of posted) expect(required).toContain(context);
    }
  });

  test("fails a broken rule when Sam hasn't approved, and leaves the other alone", async () => {
    const posted = await report(new Reviews(), { taskRule: failed });
    expect(status(posted, "Task rule")).toEqual(fails);
    expect(status(posted, "Path ownership")).toEqual(passes);
  });

  test("lifts a broken rule when Sam approved the head commit", async () => {
    const posted = await report(new Reviews().add(SAM, "APPROVED"), { taskRule: failed, pathOwnership: failed });
    expect(status(posted, "Task rule")).toEqual(lifted);
    expect(status(posted, "Path ownership")).toEqual(lifted);
  });

  test("doesn't lift for an approval of an older commit", async () => {
    const posted = await report(new Reviews().add(SAM, "APPROVED", "a1"), { taskRule: failed });
    expect(status(posted, "Task rule")).toEqual(fails);
  });

  test("doesn't lift when Sam requested changes after approving", async () => {
    const posted = await report(new Reviews().add(SAM, "APPROVED").add(SAM, "CHANGES_REQUESTED"), { taskRule: failed });
    expect(status(posted, "Task rule")).toEqual(fails);
  });

  test("doesn't lift for a dismissed approval", async () => {
    const posted = await report(new Reviews().add(SAM, "APPROVED").dismiss(0), { taskRule: failed });
    expect(status(posted, "Task rule")).toEqual(fails);
  });

  test.each(["obvious-autobuild[bot]", "lauren-tan", "samgu-nrx-agent"])("doesn't lift for an approval by %s", async (login) => {
    const posted = await report(new Reviews().add(login, "APPROVED"), { taskRule: failed });
    expect(status(posted, "Task rule")).toEqual(fails);
  });

  test("keeps the lift after a comment-only review, as GitHub keeps the approval", async () => {
    const posted = await report(new Reviews().add(SAM, "APPROVED").add(SAM, "COMMENTED"), { taskRule: failed });
    expect(status(posted, "Task rule")).toEqual(lifted);
  });

  test("lifts again when Sam approves after requesting changes", async () => {
    const reviews = new Reviews().add(SAM, "APPROVED").add(SAM, "CHANGES_REQUESTED").add(SAM, "APPROVED");
    expect(status(await report(reviews, { taskRule: failed }), "Task rule")).toEqual(lifted);
  });

  test("orders reviews in the same second by id", async () => {
    // Reviews 2 and 3 share a second: Sam approves, then requests changes.
    const reviews = new Reviews().add("someone", "COMMENTED").add(SAM, "APPROVED").add(SAM, "CHANGES_REQUESTED");
    expect(reviews.list[1].submitted_at).toBe(reviews.list[2].submitted_at);
    expect(status(await report(reviews, { taskRule: failed }), "Task rule")).toEqual(fails);
  });

  test("ignores Sam's pending review, which he hasn't submitted", async () => {
    const posted = await report(new Reviews().add(SAM, "APPROVED").add(SAM, "PENDING"), { taskRule: failed });
    expect(status(posted, "Task rule")).toEqual(lifted);
  });

  test.each(["COMMENTED", "PENDING"] as const)("doesn't lift for a %s review alone", async (state) => {
    const posted = await report(new Reviews().add(SAM, state), { taskRule: failed });
    expect(status(posted, "Task rule")).toEqual(fails);
  });

  // Dismissing a request for changes doesn't bring back the approval it replaced, as on GitHub.
  test("doesn't lift when Sam's request for changes after an approval was dismissed", async () => {
    const reviews = new Reviews().add(SAM, "APPROVED").add(SAM, "CHANGES_REQUESTED").dismiss(1);
    expect(status(await report(reviews, { taskRule: failed }), "Task rule")).toEqual(fails);
  });

  test("judges two PRs with one head by their own reviews", async () => {
    const approved = await report(new Reviews().add(SAM, "APPROVED"), { taskRule: failed }, { number: 8 });
    const unapproved = await report(new Reviews(), { taskRule: failed }, { number: 9 });
    expect(status(approved, "Task rule")).toEqual(lifted);
    expect(status(unapproved, "Task rule")).toEqual(fails);
  });

  test("passes a base commit that has no check, saying so", async () => {
    const posted = await report(new Reviews(), { taskRule: { result: "success", checked: "false" } });
    expect(status(posted, "Task rule")).toEqual({ state: "success", description: "The base commit has no check to run." });
  });

  test.each(["cancelled", "skipped"])("fails a %s check unless Sam approved", async (result) => {
    const unfinished = { result, checked: "" };
    expect(status(await report(new Reviews(), { taskRule: unfinished }), "Task rule")).toEqual({
      state: "failure",
      description: `The check didn't finish (${result}).`,
    });
    expect(status(await report(new Reviews().add(SAM, "APPROVED"), { taskRule: unfinished }), "Task rule")).toEqual(lifted);
  });

  test("fails loudly on a job result it doesn't know", async () => {
    await expect(report(new Reviews(), { taskRule: { result: "neutral" } })).rejects.toThrow('Task rule: unknown job result "neutral".');
  });

  test("fails loudly when a passing job doesn't say whether it ran the check", async () => {
    await expect(report(new Reviews(), { pathOwnership: { result: "success", checked: "" } })).rejects.toThrow(
      'Path ownership: the job passed without saying whether it ran the check ("").',
    );
  });

  test.each([
    ["an empty list", "[]"],
    ["a bare login", "SamGu-NRX"],
    ["an empty login", '[""]'],
  ])("fails loudly, posting nothing, when APPROVERS is %s", async (_case, approvers) => {
    await expect(report(new Reviews().add(SAM, "APPROVED"), {}, { env: { APPROVERS: approvers } })).rejects.toThrow(
      `APPROVERS must be a non-empty JSON array of GitHub logins, got ${approvers}`,
    );
  });

  test.each([
    ["no PR number", { PR_NUMBER: "" }],
    ["a head that isn't a commit", { HEAD_SHA: "main" }],
    ["no base branch", { BASE_REF: "" }],
  ])("fails loudly, posting nothing, given %s", async (_case, env) => {
    await expect(report(new Reviews().add(SAM, "APPROVED"), {}, { env })).rejects.toThrow("The pr job gave no pull request with a head commit and base branch");
  });

  // Reports for one PR queue, so an older one can run after a newer push; it must not post over it.
  test("posts nothing when the PR's head moved after its run found it", async () => {
    const posted = await report(new Reviews().add(SAM, "APPROVED"), {}, { currentHead: "c3".repeat(20) });
    expect(posted).toEqual([]);
  });

  test("posts nothing when the PR was retargeted after its run found it", async () => {
    const posted = await report(new Reviews().add(SAM, "APPROVED"), {}, { currentBase: "main" });
    expect(posted).toEqual([]);
  });

  test("takes its approver list from the workflow: SamGu-NRX alone", () => {
    expect(JSON.parse(reportStep().env.APPROVERS)).toEqual(["SamGu-NRX"]);
  });
});
