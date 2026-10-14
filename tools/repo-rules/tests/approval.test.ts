/**
 * Runs the Approval job's script, the exact text in .github/workflows/pr-rules.yml,
 * the way actions/github-script does: as the body of an async function given
 * `github`, `context` and `core`. GitHub is modeled by FakePR below, which keeps
 * labels, label events and commit statuses the way the REST API reports them.
 */
import { describe, expect, test } from "bun:test";
import path from "node:path";
import { repoRoot } from "./helpers";

type ScriptStep = { id?: string; uses?: string; env?: Record<string, string>; with?: { script?: string } };
type PrRules = { jobs: { approval: { steps: ScriptStep[] } } };

// SAFETY: approvalStep() checks the one field read here and throws if it isn't a string.
const prRules = Bun.YAML.parse(await Bun.file(path.join(repoRoot, ".github/workflows/pr-rules.yml")).text()) as PrRules;

function approvalStep(): { script: string; env: Record<string, string> } {
  const step = prRules.jobs.approval.steps.find((candidate) => candidate.id === "decide");
  if (typeof step?.with?.script !== "string" || step.env === undefined) {
    throw new Error("pr-rules.yml has no Approval step with id decide, a script and an env.");
  }
  return { script: step.with.script, env: step.env };
}

const LABEL = "sam-approved";
const SAM = "SamGu-NRX";
const OBVIOUS = "obvious-autobuild[bot]";
const ACTIONS_BOT = "github-actions[bot]";
const OWNER = "SamGu-NRX";
const REPO = "UNTangle";
const NUMBER = 7;

type LabelEvent = {
  id: number;
  created_at: string;
  event: string;
  label?: { name: string };
  actor: { login: string };
  performed_via_github_app: { slug: string } | null;
};
type Status = { id: number; created_at: string; sha: string; context: string; state: string; description: string; creator: { login: string } };
type RunResult = { approved: string | undefined; notice: string | undefined };

/** Each 4xx the REST client throws carries the HTTP status, as Octokit's RequestError does. */
class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

class FakePR {
  head = "a1";
  labels: string[] = [];
  events: LabelEvent[] = [];
  statuses: Status[] = [];
  /** Set to make the next label removal fail with this HTTP status. */
  removeLabelFailure: number | undefined;
  private nextId = 1;

  /** A new id and timestamp. Three records share each second (ids 3-5, 6-8, ...), as fast actions do on GitHub. */
  private stamp(): { id: number; created_at: string } {
    const id = this.nextId++;
    return { id, created_at: new Date(Date.UTC(2026, 9, 14, 12, 0, Math.floor(id / 3))).toISOString().replace(".000", "") };
  }

  /** Someone adds the label on GitHub. The workflow run it triggers is a separate step: run(). */
  addLabel(login: string, app: string | null = null): void {
    this.labels.push(LABEL);
    this.events.push({ ...this.stamp(), event: "labeled", label: { name: LABEL }, actor: { login }, performed_via_github_app: app ? { slug: app } : null });
  }

  removeLabel(login: string): void {
    this.labels = this.labels.filter((name) => name !== LABEL);
    this.events.push({ ...this.stamp(), event: "unlabeled", label: { name: LABEL }, actor: { login }, performed_via_github_app: null });
  }

  push(sha: string): void {
    this.head = sha;
  }

  /** Posts a commit status as `login` would, outside the workflow. */
  postStatus(sha: string, state: string, login: string): void {
    this.statuses.push({ ...this.stamp(), sha, context: "Sam approved", state, description: "", creator: { login } });
  }

  /** The newest "Sam approved" status on a commit, as the merge box reads it. */
  statusOn(sha: string): Pick<Status, "state" | "description"> | undefined {
    const latest = this.statuses.filter((status) => status.sha === sha && status.context === "Sam approved").at(-1);
    return latest && { state: latest.state, description: latest.description };
  }

  /** Runs the Approval script for one pull_request_target event, as GitHub would. */
  async run(
    action: string,
    sender: string,
    options: { label?: string; env?: Record<string, string>; head?: string } = {},
  ): Promise<RunResult> {
    const { script, env } = approvalStep();
    const outputs: Record<string, string> = {};
    let notice: string | undefined;
    const issue = (params: { owner: string; repo: string; issue_number: number }) => {
      if (params.owner !== OWNER || params.repo !== REPO || params.issue_number !== NUMBER) {
        throw new Error(`Asked about the wrong PR: ${JSON.stringify(params)}`);
      }
    };
    const github = {
      paginate: async <T>(method: (params: never) => Promise<{ data: T[] }>, params: never) => (await method(params)).data,
      rest: {
        issues: {
          removeLabel: async (params: { owner: string; repo: string; issue_number: number; name: string }) => {
            issue(params);
            if (this.removeLabelFailure !== undefined) throw new RequestError("Forbidden", this.removeLabelFailure);
            if (!this.labels.includes(params.name)) throw new RequestError("Label does not exist", 404);
            this.removeLabel(ACTIONS_BOT);
            return { data: [] };
          },
          listLabelsOnIssue: async (params: { owner: string; repo: string; issue_number: number }) => {
            issue(params);
            return { data: this.labels.map((name) => ({ name })) };
          },
          listEvents: async (params: { owner: string; repo: string; issue_number: number }) => {
            issue(params);
            // Newest first, since the API promises no order and the script must sort.
            const renamed = { id: 0, created_at: "2026-10-14T11:00:00Z", event: "renamed", actor: { login: OBVIOUS }, performed_via_github_app: null };
            return { data: [...this.events].reverse().concat(renamed) };
          },
        },
        repos: {
          // GitHub lists a commit's statuses newest first.
          listCommitStatusesForRef: async (params: { owner: string; repo: string; ref: string }) => ({
            data: this.statuses.filter((status) => params.owner === OWNER && params.repo === REPO && status.sha === params.ref).reverse(),
          }),
          createCommitStatus: async (params: { owner: string; repo: string; sha: string; context: string; state: string; description: string }) => {
            if (params.owner !== OWNER || params.repo !== REPO) throw new Error("Posted to the wrong repository.");
            this.statuses.push({ ...params, ...this.stamp(), creator: { login: ACTIONS_BOT } });
            return { data: {} };
          },
        },
      },
    };
    const context = {
      repo: { owner: OWNER, repo: REPO },
      payload: {
        action,
        sender: { login: sender },
        ...(options.label === undefined ? {} : { label: { name: options.label } }),
        // A payload records the head when the event happened, which a queued run sees later.
        pull_request: { number: NUMBER, head: { sha: options.head ?? this.head } },
      },
    };
    const core = {
      info: () => {},
      notice: (message: string) => {
        notice = message;
      },
      setOutput: (name: string, value: string) => {
        outputs[name] = value;
      },
    };
    // github-script builds the same function: new AsyncFunction(...argument names, script).
    const AsyncFunction: new (...parameters: string[]) => (...args: unknown[]) => Promise<unknown> = Object.getPrototypeOf(
      async () => {},
    ).constructor;
    // `process` is passed in so the script reads the step's env, not the test runner's.
    await new AsyncFunction("github", "context", "core", "process", script)(github, context, core, { env: options.env ?? env });
    return { approved: outputs.approved, notice };
  }
}

/** Someone adds the label, and its run follows. */
async function label(pr: FakePR, login: string, app: string | null = null): Promise<RunResult> {
  pr.addLabel(login, app);
  return pr.run("labeled", login, { label: LABEL });
}

const approvedStatus = { state: "success", description: "Sam approved this commit" };
const waitingStatus = { state: "pending", description: "Waiting for Sam's approval" };

describe("the Approval job", () => {
  test("approves the commit Sam labels", async () => {
    const pr = new FakePR();
    expect(await label(pr, SAM)).toEqual({
      approved: "true",
      notice: "SamGu-NRX added sam-approved while this commit was the PR's head.",
    });
    expect(pr.statusOn("a1")).toEqual(approvedStatus);
  });

  test("keeps that approval on later events for the same commit", async () => {
    const pr = new FakePR();
    await label(pr, SAM);
    expect(await pr.run("edited", OBVIOUS)).toEqual({ approved: "true", notice: "SamGu-NRX approved this commit earlier." });
    expect(pr.statusOn("a1")).toEqual(approvedStatus);
  });

  test("refuses the label when Obvious Autobuild added it", async () => {
    const pr = new FakePR();
    expect(await label(pr, OBVIOUS)).toEqual({
      approved: "false",
      notice: "obvious-autobuild[bot] added sam-approved last. Only SamGu-NRX can approve, directly.",
    });
    expect(pr.statusOn("a1")).toEqual(waitingStatus);
  });

  test("refuses Sam's account acting through an app", async () => {
    const pr = new FakePR();
    expect((await label(pr, SAM, "obvious-autobuild")).approved).toBe("false");
    expect(pr.statusOn("a1")).toEqual(waitingStatus);
  });

  test("withdraws the approval when the label is removed", async () => {
    const pr = new FakePR();
    await label(pr, SAM);
    pr.removeLabel(SAM);
    expect(await pr.run("unlabeled", SAM, { label: LABEL })).toEqual({
      approved: "false",
      notice: "The PR doesn't have the sam-approved label.",
    });
    expect(pr.statusOn("a1")).toEqual(waitingStatus);
  });

  test("refuses the label when someone else re-added it after Sam removed it", async () => {
    const pr = new FakePR();
    await label(pr, SAM);
    pr.removeLabel(SAM);
    await pr.run("unlabeled", SAM, { label: LABEL });
    expect((await label(pr, OBVIOUS)).approved).toBe("false");
    expect(pr.statusOn("a1")).toEqual(waitingStatus);
  });

  test("refuses Sam's label run when someone else re-added the label before it ran", async () => {
    const pr = new FakePR();
    pr.addLabel(SAM);
    pr.removeLabel(OBVIOUS);
    pr.addLabel(OBVIOUS);
    expect((await pr.run("labeled", SAM, { label: LABEL })).approved).toBe("false");
    expect(pr.statusOn("a1")).toEqual(waitingStatus);
  });

  test("doesn't let someone else's late label run approve the commit it saw", async () => {
    // Obvious labels a1; before its run starts, a push lands and Sam re-adds the label on b2.
    const pr = new FakePR();
    pr.addLabel(OBVIOUS);
    pr.push("b2");
    pr.removeLabel(SAM);
    pr.addLabel(SAM);
    expect((await pr.run("labeled", OBVIOUS, { label: LABEL, head: "a1" })).approved).toBe("false");
    expect(pr.statusOn("a1")).toEqual(waitingStatus);
    expect((await pr.run("labeled", SAM, { label: LABEL })).approved).toBe("true");
    expect(pr.statusOn("b2")).toEqual(approvedStatus);
  });

  test("doesn't count Sam adding another label as approving the commit", async () => {
    const pr = new FakePR();
    await label(pr, SAM);
    pr.push("b2");
    expect((await pr.run("labeled", SAM, { label: "documentation" })).approved).toBe("false");
    expect(pr.statusOn("b2")).toEqual(waitingStatus);
  });

  test("doesn't count Sam removing the label as approving the commit it saw", async () => {
    // Sam removes the label on a1; before that run starts, a push lands and Sam approves b2.
    const pr = new FakePR();
    pr.addLabel(SAM);
    pr.removeLabel(SAM);
    pr.push("b2");
    pr.addLabel(SAM);
    expect((await pr.run("unlabeled", SAM, { label: LABEL, head: "a1" })).approved).toBe("false");
    expect(pr.statusOn("a1")).toEqual(waitingStatus);
  });

  test("tells apart label events in the same second by their order", async () => {
    const pr = new FakePR();
    pr.addLabel(OBVIOUS);
    pr.removeLabel(OBVIOUS);
    // These three share one second: Obvious adds, Sam removes, Sam adds.
    pr.addLabel(OBVIOUS);
    pr.removeLabel(SAM);
    pr.addLabel(SAM);
    expect(new Set(pr.events.slice(2).map((event) => event.created_at)).size).toBe(1);
    expect((await pr.run("labeled", SAM, { label: LABEL })).approved).toBe("true");
  });

  test("strips the label on a push and leaves the new commit waiting", async () => {
    const pr = new FakePR();
    await label(pr, SAM);
    pr.push("b2");
    expect(await pr.run("synchronize", OBVIOUS)).toEqual({
      approved: "false",
      notice: "The PR doesn't have the sam-approved label.",
    });
    expect(pr.labels).toEqual([]);
    expect(pr.events.at(-1)).toMatchObject({ event: "unlabeled", actor: { login: ACTIONS_BOT } });
    expect(pr.statusOn("b2")).toEqual(waitingStatus);
    // A status belongs to one commit, so the approved one keeps its own.
    expect(pr.statusOn("a1")).toEqual(approvedStatus);
  });

  test("doesn't carry an approval to a pushed commit when the push's own run never happened", async () => {
    // GitHub replaces a queued run with a newer one, so the synchronize run can be dropped.
    const pr = new FakePR();
    await label(pr, SAM);
    pr.push("b2");
    expect(await pr.run("edited", OBVIOUS)).toEqual({
      approved: "false",
      notice: "sam-approved was added before this commit was pushed. Remove it and add it again to approve this commit.",
    });
    expect(pr.statusOn("b2")).toEqual(waitingStatus);
  });

  test("approves a pushed commit once Sam adds the label again", async () => {
    const pr = new FakePR();
    await label(pr, SAM);
    pr.push("b2");
    await pr.run("synchronize", OBVIOUS);
    expect((await label(pr, SAM)).approved).toBe("true");
    expect(pr.statusOn("b2")).toEqual(approvedStatus);
  });

  test("ignores a success status that GitHub Actions didn't post", async () => {
    // An agent with a person's token can post statuses, but not as GitHub Actions.
    const pr = new FakePR();
    await label(pr, SAM);
    pr.push("b2");
    pr.postStatus("b2", "success", SAM);
    expect((await pr.run("edited", OBVIOUS)).approved).toBe("false");
  });

  test("refuses a label GitHub reports no event for", async () => {
    const pr = new FakePR();
    pr.labels.push(LABEL);
    expect(await pr.run("edited", SAM)).toEqual({
      approved: "false",
      notice: "The PR has sam-approved, but GitHub reports no event adding it.",
    });
  });

  test("handles a push to a PR that has no label to strip", async () => {
    const pr = new FakePR();
    pr.push("b2");
    expect((await pr.run("synchronize", OBVIOUS)).approved).toBe("false");
    expect(pr.statusOn("b2")).toEqual(waitingStatus);
  });

  test("fails, posting nothing, when it can't strip the label after a push", async () => {
    const pr = new FakePR();
    await label(pr, SAM);
    pr.push("b2");
    pr.removeLabelFailure = 403;
    await expect(pr.run("synchronize", OBVIOUS)).rejects.toThrow("Forbidden");
    expect(pr.statusOn("b2")).toBeUndefined();
  });

  test.each([
    ["an empty list", "[]"],
    ["a bare login", "SamGu-NRX"],
    ["an empty login", '[""]'],
  ])("fails loudly when APPROVERS is %s", async (_case, approvers) => {
    const pr = new FakePR();
    pr.addLabel(SAM);
    const env = { ...approvalStep().env, APPROVERS: approvers };
    await expect(pr.run("labeled", SAM, { label: LABEL, env })).rejects.toThrow(
      `APPROVERS must be a non-empty JSON array of GitHub logins, got ${approvers}`,
    );
    expect(pr.statusOn("a1")).toBeUndefined();
  });
});
