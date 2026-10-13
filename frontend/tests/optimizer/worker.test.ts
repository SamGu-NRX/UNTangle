/**
 * The optimizer worker: the two-phase protocol (runJob) with the search
 * replaced by a fake, the plain request that crosses postMessage, the
 * page-side client against a fake Worker, and the committed bundle run in a
 * real Worker.
 */
import { describe, expect, test } from "bun:test";
import { pathToFileURL } from "node:url";
import { optimize } from "@/lib/optimizer/optimize";
import { OptimizerClient, type WorkerPort } from "@/lib/optimizer/worker/client";
import {
  FINAL_BUDGET_MS,
  FIRST_BUDGET_MS,
  fromPlainRequest,
  runJob,
  toPlainRequest,
  walkingFromTable,
  type OptimizeJob,
  type OptimizeReply,
  type PlainRequest,
} from "@/lib/optimizer/worker/protocol";
import type { OptimizeRequest, OptimizeResult } from "@/lib/optimizer/types";
import { buildOptimizeRequest, defaultSchedulePreferences, getInitialPlannerState } from "@/lib/planner";
import type { PlannerState } from "@/lib/types";
import { buildWorkerBundle, committedWorkerBundle, WORKER_BUNDLE } from "./build-worker";
import { generateInstance } from "./generator";

const FIVE = ["ANTH 1010", "BIOL 1710", "ENGL 1310", "MATH 1710", "PSYC 1630"];

function planWith(courseCodes: string[]): PlannerState {
  const initial = getInitialPlannerState();
  return {
    ...initial,
    courseStatuses: { ...initial.courseStatuses, ...Object.fromEntries(courseCodes.map((code) => [code, "inProgress" as const])) },
    selectedSections: {},
  };
}

const stats = { nodes: 0, elapsedMs: 0, candidates: {}, minDifferentCourses: 2 };
const results: Record<string, OptimizeResult> = {
  optimal: { status: "optimal", schedules: [], stats },
  feasible: { status: "feasible", schedules: [], stats },
  timeout: { status: "timeout", schedules: [], stats },
  infeasible: { status: "infeasible", schedules: [], stats, explanation: { members: [], minimal: true, sentence: "x", suggestions: [] } },
};

const plain: PlainRequest = toPlainRequest(buildOptimizeRequest(planWith(FIVE), defaultSchedulePreferences("compact")));
const job: OptimizeJob = { id: 9, request: plain };

function drive(statusByBudget: Record<number, keyof typeof results | "throw">) {
  const budgets: number[] = [];
  const replies: OptimizeReply[] = [];
  runJob(job, {
    optimize: (request) => {
      budgets.push(request.timeBudgetMs!);
      const outcome = statusByBudget[request.timeBudgetMs!];
      if (outcome === "throw") throw new Error("optimizer: blocked time b1 is listed twice");
      return results[outcome];
    },
    post: (reply) => replies.push(reply),
  });
  return { budgets, replies };
}

describe("runJob", () => {
  test("a proof in the first phase is the only reply", () => {
    for (const status of ["optimal", "infeasible"] as const) {
      const { budgets, replies } = drive({ [FIRST_BUDGET_MS]: status });
      expect(budgets).toEqual([FIRST_BUDGET_MS]);
      expect(replies).toEqual([{ id: 9, phase: "first", result: results[status], settled: true }]);
    }
  });

  test("an unproven first answer is posted, then a 3 s search replaces it", () => {
    for (const status of ["feasible", "timeout"] as const) {
      const { budgets, replies } = drive({ [FIRST_BUDGET_MS]: status, [FINAL_BUDGET_MS]: "optimal" });
      expect(budgets).toEqual([300, 3000]);
      expect(replies).toEqual([
        { id: 9, phase: "first", result: results[status], settled: false },
        { id: 9, phase: "final", result: results.optimal, settled: true },
      ]);
    }
  });

  test("a throw becomes an error reply with the message", () => {
    const { replies } = drive({ [FIRST_BUDGET_MS]: "throw" });
    expect(replies).toEqual([{ id: 9, phase: "error", message: "optimizer: blocked time b1 is listed twice" }]);
    const late = drive({ [FIRST_BUDGET_MS]: "feasible", [FINAL_BUDGET_MS]: "throw" });
    expect(late.replies.map((r) => r.phase)).toEqual(["first", "error"]);
  });
});

describe("the plain request", () => {
  test("survives structured cloning and has no functions", () => {
    expect(structuredClone(plain)).toEqual(plain);
    expect(JSON.stringify(plain)).not.toContain("function");
  });

  test("gives the same results as the request it came from (planner plan and 60 generated instances)", () => {
    const requests: OptimizeRequest[] = [
      buildOptimizeRequest(planWith(FIVE), defaultSchedulePreferences("minimizeDistance"), { timeBudgetMs: 10_000 }),
      ...Array.from({ length: 60 }, (_, i) => generateInstance(5000 + i, { courses: 5, sectionsPerCourse: 8, style: "realistic", constraintDensity: 0.2 })),
    ];
    for (const request of requests) {
      const direct = optimize({ ...request, timeBudgetMs: 10_000 });
      const viaPlain = optimize(fromPlainRequest(structuredClone(toPlainRequest(request)), 10_000));
      const strip = (r: OptimizeResult) => ({ ...r, stats: { ...r.stats, elapsedMs: 0 } });
      expect(strip(viaPlain)).toEqual(strip(direct));
    }
  });

  test("a pair outside the table is unknown, never 0", () => {
    const walk = walkingFromTable({ ids: ["a"], legs: [{ seconds: 0, source: "campus-network" }] });
    expect(walk("a", "zzz")).toEqual({ seconds: null, source: "unknown" });
  });
});

describe("the committed worker bundle", () => {
  test("is up to date with its sources (regenerate: bun tests/optimizer/build-worker.ts --write)", async () => {
    expect(await buildWorkerBundle()).toBe(committedWorkerBundle());
  });

  test("imports nothing, so the browser can load it as one file", () => {
    expect(committedWorkerBundle()).not.toMatch(/^\s*import\s/m);
  });

  test("runs a job in a real Worker: first answer within its budget, proven", async () => {
    const worker = new Worker(pathToFileURL(WORKER_BUNDLE).href, { type: "module" });
    const replies: OptimizeReply[] = [];
    const done = new Promise<void>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<OptimizeReply>) => {
        replies.push(event.data);
        if (event.data.phase === "error" || event.data.settled) resolve();
      };
      worker.onerror = (event) => reject(new Error(event.message));
    });
    worker.postMessage({ id: 1, request: plain } satisfies OptimizeJob);
    await done;
    worker.terminate();
    expect(replies).toHaveLength(1);
    const [reply] = replies;
    if (reply.phase === "error") throw new Error(reply.message);
    expect(reply.result.status).toBe("optimal");
    expect(reply.result.schedules).toHaveLength(3);
    expect(reply.result.stats.elapsedMs).toBeLessThan(FIRST_BUDGET_MS);
    expect(reply.result).toEqual({ ...optimize(fromPlainRequest(plain, FIRST_BUDGET_MS)), stats: reply.result.stats });
  });
});

type FakePort = WorkerPort & {
  posted: OptimizeJob[];
  terminated: boolean;
  reply: (r: OptimizeReply) => void;
  crash: (message: string) => void;
};

function fakeFactory() {
  const ports: FakePort[] = [];
  const create = (): WorkerPort => {
    let onReply: (r: OptimizeReply) => void = () => {};
    let onFailure: (m: string) => void = () => {};
    const port: FakePort = {
      posted: [],
      terminated: false,
      post: (j) => port.posted.push(j),
      terminate: () => {
        port.terminated = true;
      },
      listen: (r, f) => {
        onReply = r;
        onFailure = f;
      },
      reply: (r) => onReply(r),
      crash: (m) => onFailure(m),
    };
    ports.push(port);
    return port;
  };
  return { ports, create };
}

const reply = (id: number, settled: boolean): OptimizeReply => ({ id, phase: settled ? "final" : "first", result: results.feasible, settled });

describe("OptimizerClient", () => {
  test("numbers jobs and delivers only the newest job's replies", () => {
    const { ports, create } = fakeFactory();
    const seen: OptimizeReply[] = [];
    const client = new OptimizerClient(create, (r) => seen.push(r));
    const first = client.run(plain);
    ports[0].reply(reply(first, true));
    const second = client.run(plain);
    expect(second).toBe(first + 1);
    // Job 1 had settled, so the worker is reused.
    expect(ports).toHaveLength(1);
    ports[0].reply(reply(first, true));
    ports[0].reply(reply(second, true));
    expect(seen.map((r) => r.id)).toEqual([first, second]);
  });

  test("a new job while one is searching replaces the worker, so it never waits behind a 3 s search", () => {
    const { ports, create } = fakeFactory();
    const seen: OptimizeReply[] = [];
    const client = new OptimizerClient(create, (r) => seen.push(r));
    const first = client.run(plain);
    ports[0].reply(reply(first, false));
    const second = client.run(plain);
    expect(ports[0].terminated).toBe(true);
    expect(ports).toHaveLength(2);
    expect(ports[1].posted.map((j) => j.id)).toEqual([second]);
    // A late message from the old worker is ignored.
    ports[0].reply(reply(first, true));
    ports[1].reply(reply(second, true));
    expect(seen.map((r) => [r.id, r.phase])).toEqual([
      [first, "first"],
      [second, "final"],
    ]);
  });

  test("a crashed worker reports an error for the newest job and is replaced next time", () => {
    const { ports, create } = fakeFactory();
    const seen: OptimizeReply[] = [];
    const client = new OptimizerClient(create, (r) => seen.push(r));
    const id = client.run(plain);
    ports[0].crash("Out of memory");
    expect(seen).toEqual([{ id, phase: "error", message: "Out of memory" }]);
    expect(ports[0].terminated).toBe(true);
    client.run(plain);
    expect(ports).toHaveLength(2);
  });

  test("a worker that cannot start fails after run returns, so the caller has recorded the id", async () => {
    const seen: OptimizeReply[] = [];
    const client = new OptimizerClient(
      () => {
        throw new Error("Worker is not defined");
      },
      (r) => seen.push(r),
    );
    const id = client.run(plain);
    expect(seen).toEqual([]);
    await Promise.resolve();
    expect(seen).toEqual([{ id, phase: "error", message: "The optimizer could not start: Worker is not defined" }]);
  });
});
