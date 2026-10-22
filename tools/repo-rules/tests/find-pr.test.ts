/**
 * Runs pr-rules.yml's pr job script, the exact text in the workflow, the way
 * actions/github-script does. GitHub is modeled by one PR the API returns.
 */
import { describe, expect, test } from "bun:test";
import path from "node:path";
import { repoRoot } from "./helpers";

type ScriptStep = { id?: string; with?: { script?: string } };
// SAFETY: findStep() checks the fields read here and throws if they're missing.
const prRules = Bun.YAML.parse(await Bun.file(path.join(repoRoot, ".github/workflows/pr-rules.yml")).text()) as {
  jobs: { pr: { steps: ScriptStep[] } };
};

function findStep(): string {
  const step = prRules.jobs.pr.steps.find((candidate) => candidate.id === "find");
  if (typeof step?.with?.script !== "string") throw new Error("pr-rules.yml's pr job has no script step with id find.");
  return step.with.script;
}

const OWNER = "SamGu-NRX";
const REPO = "UNTangle";
type Pr = { number: number; state: string; base: { ref: string; sha: string }; head: { ref: string; sha: string } };
const open7: Pr = { number: 7, state: "open", base: { ref: "alpha", sha: "a".repeat(40) }, head: { ref: "lead/x", sha: "c".repeat(40) } };

type ForkPr = { number: number; owner: string; head: { ref: string; sha: string } };

async function find(payload: Record<string, unknown>, pr: Pr = open7, forks: ForkPr[] = []) {
  const listed: string[] = [];
  const outputs: Record<string, string> = {};
  const notices: string[] = [];
  const asked: number[] = [];
  const github = {
    rest: {
      pulls: {
        list: async (params: { owner: string; repo: string; state: string; head: string }) => {
          if (params.owner !== OWNER || params.repo !== REPO || params.state !== "open") throw new Error("Listed the wrong PRs.");
          listed.push(params.head);
          return { data: forks.filter((candidate) => `${candidate.owner}:${candidate.head.ref}` === params.head) };
        },
        get: async (params: { owner: string; repo: string; pull_number: number }) => {
          if (params.owner !== OWNER || params.repo !== REPO) throw new Error("Asked the wrong repository.");
          asked.push(params.pull_number);
          return { data: { ...pr, number: params.pull_number } };
        },
      },
    },
  };
  const context = { repo: { owner: OWNER, repo: REPO }, payload };
  const core = { setOutput: (name: string, value: string) => (outputs[name] = value), notice: (text: string) => notices.push(text) };
  const AsyncFunction: new (...parameters: string[]) => (...args: unknown[]) => Promise<unknown> = Object.getPrototypeOf(
    async () => {},
  ).constructor;
  await new AsyncFunction("github", "context", "core", findStep())(github, context, core);
  return { outputs, notices, asked, listed };
}

describe("pr-rules.yml's pr job", () => {
  test("reads a pull_request_target PR as the API has it now", async () => {
    const { outputs, asked } = await find({ pull_request: { number: 7, head: { sha: "stale" } } });
    expect(asked).toEqual([7]);
    expect(outputs).toEqual({ number: "7", "base-ref": "alpha", "base-sha": "a".repeat(40), "head-sha": "c".repeat(40), "head-ref": "lead/x" });
  });

  test("reads a review's PR from the workflow_run GitHub filled in", async () => {
    const { outputs, asked } = await find({ workflow_run: { pull_requests: [{ number: 12 }] } });
    expect(asked).toEqual([12]);
    expect(outputs.number).toBe("12");
  });

  // A fork's PR leaves pull_requests empty, so the job finds it by the run's head.
  test("finds a fork's PR by the review run's head repository, branch and commit", async () => {
    const forks: ForkPr[] = [
      { number: 30, owner: "someone", head: { ref: "fix", sha: "e".repeat(40) } },
      { number: 31, owner: "someone", head: { ref: "fix", sha: "f".repeat(40) } },
    ];
    const run = { pull_requests: [], head_repository: { owner: { login: "someone" } }, head_branch: "fix", head_sha: "f".repeat(40) };
    const { outputs, asked, listed } = await find({ workflow_run: run }, open7, forks);
    expect(listed).toEqual(["someone:fix"]);
    expect(asked).toEqual([31]);
    expect(outputs.number).toBe("31");
  });

  test("reports nothing when two open PRs share the review run's head", async () => {
    const forks: ForkPr[] = [
      { number: 30, owner: "someone", head: { ref: "fix", sha: "f".repeat(40) } },
      { number: 32, owner: "someone", head: { ref: "fix", sha: "f".repeat(40) } },
    ];
    const run = { pull_requests: [], head_repository: { owner: { login: "someone" } }, head_branch: "fix", head_sha: "f".repeat(40) };
    const { outputs, asked } = await find({ workflow_run: run }, open7, forks);
    expect(asked).toEqual([]);
    expect(outputs).toEqual({});
  });

  test("reports nothing when no open PR has the review run's head", async () => {
    const run = { pull_requests: [], head_repository: { owner: { login: "someone" } }, head_branch: "gone", head_sha: "f".repeat(40) };
    const { outputs, notices, asked } = await find({ workflow_run: run });
    expect(asked).toEqual([]);
    expect(outputs).toEqual({});
    expect(notices).toEqual(["The review's run names no open pull request, so there is nothing to report."]);
  });

  test("reports nothing for a closed PR", async () => {
    const { outputs, notices } = await find({ workflow_run: { pull_requests: [{ number: 7 }] } }, { ...open7, state: "closed" });
    expect(outputs).toEqual({});
    expect(notices).toEqual(["#7 is closed, so there is nothing to report."]);
  });
});
