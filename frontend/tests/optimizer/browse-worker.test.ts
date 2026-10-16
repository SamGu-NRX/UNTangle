/**
 * Browse all through the worker: the browse job and its one reply, the
 * client posting browse jobs to its own worker, the committed bundle running
 * one, and the round trip from choosing a row to the next Auto request.
 */
import { describe, expect, test } from "bun:test";
import { pathToFileURL } from "node:url";
import { withSections } from "@/app/schedule/untangle-host";
import { enumerateSchedules, type EnumerateResult } from "@/lib/optimizer/enumerate";
import { OptimizerClient, type WorkerPort } from "@/lib/optimizer/worker/client";
import {
  BROWSE_BUDGET_MS,
  BROWSE_LIMIT,
  browseRequest,
  fromPlainRequest,
  runBrowseJob,
  toPlainRequest,
  type BrowseJob,
  type BrowseReply,
  type OptimizeJob,
  type OptimizeReply,
} from "@/lib/optimizer/worker/protocol";
import { buildOptimizeRequest, defaultSchedulePreferences, getInitialPlannerState, normalizePlannerState, resolveSectionPlan } from "@/lib/planner";
import { sampleCatalog } from "@/lib/planner-sections";
import type { PlannerState } from "@/lib/types";
import { WORKER_BUNDLE } from "./build-worker";

const FIVE = ["ANTH 1010", "BIOL 1710", "ENGL 1310", "MATH 1710", "PSYC 1630"];
const preferences = defaultSchedulePreferences("compact");

function planWith(courseCodes: string[]): PlannerState {
  const initial = getInitialPlannerState();
  return {
    ...initial,
    courseStatuses: { ...initial.courseStatuses, ...Object.fromEntries(courseCodes.map((code) => [code, "inProgress" as const])) },
    selectedSections: {},
  };
}

const plain = toPlainRequest(buildOptimizeRequest(planWith(FIVE), preferences));
const withoutTime = (result: EnumerateResult) => ({ ...result, stats: { ...result.stats, elapsedMs: 0 } });

describe("runBrowseJob", () => {
  test("one reply, settled, from the list limit and the wall-clock cap", () => {
    const seen: Array<{ limit?: number; timeBudgetMs?: number; k?: unknown }> = [];
    const replies: BrowseReply[] = [];
    runBrowseJob({ id: 4, kind: "browse", request: plain }, {
      enumerate: (request) => {
        seen.push({ limit: request.limit, timeBudgetMs: request.timeBudgetMs, k: (request as { k?: unknown }).k });
        return enumerateSchedules(request);
      },
      post: (reply) => replies.push(reply),
    });
    expect(seen).toEqual([{ limit: BROWSE_LIMIT, timeBudgetMs: BROWSE_BUDGET_MS, k: undefined }]);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({ id: 4, phase: "browse", settled: true });
  });

  test("a throw becomes an error reply", () => {
    const replies: BrowseReply[] = [];
    runBrowseJob({ id: 5, kind: "browse", request: plain }, {
      enumerate: () => {
        throw new Error("optimizer: limit must be an integer 1..2000, got 0");
      },
      post: (reply) => replies.push(reply),
    });
    expect(replies).toEqual([{ id: 5, phase: "error", message: "optimizer: limit must be an integer 1..2000, got 0" }]);
  });
});

function fakePort<Reply>() {
  const posted: Array<OptimizeJob | BrowseJob> = [];
  let deliver: (reply: Reply) => void = () => {};
  const port: WorkerPort<Reply> = {
    post: (job) => posted.push(job),
    terminate: () => {},
    listen: (onReply) => {
      deliver = onReply;
    },
  };
  return { port, posted, reply: (reply: Reply) => deliver(reply) };
}

describe("a browse client", () => {
  test("posts browse jobs and settles on its one reply", () => {
    const fake = fakePort<BrowseReply>();
    const seen: BrowseReply[] = [];
    const client = new OptimizerClient<BrowseReply>(() => fake.port, (reply) => seen.push(reply), "browse");
    const id = client.run(plain);
    expect(fake.posted).toEqual([{ id, kind: "browse", request: plain }]);
    const result = enumerateSchedules(browseRequest(plain));
    fake.reply({ id, phase: "browse", result, settled: true });
    expect(seen).toEqual([{ id, phase: "browse", result, settled: true }]);
  });

  test("the committed bundle answers a browse job with the same list", async () => {
    const worker = new Worker(pathToFileURL(WORKER_BUNDLE).href, { type: "module" });
    try {
      const reply = await new Promise<BrowseReply>((resolve, reject) => {
        worker.onmessage = (event: MessageEvent<BrowseReply>) => resolve(event.data);
        worker.onerror = (event) => reject(new Error(event.message));
        worker.postMessage({ id: 3, kind: "browse", request: plain } satisfies BrowseJob);
      });
      if (reply.phase === "error") throw new Error(reply.message);
      expect(reply.result.status).toBe("listed");
      expect(withoutTime(reply.result)).toEqual(withoutTime(enumerateSchedules(browseRequest(plain))));
    } finally {
      worker.terminate();
    }
  });
});

describe("choosing a row", () => {
  test("plans exactly its sections without keeping them, so the next Auto request offers them and may still move them", () => {
    const plan = planWith(FIVE);
    const list = enumerateSchedules(browseRequest(plain));
    if (list.status !== "listed") throw new Error(`expected a list, got ${list.status}`);
    expect(list.schedules.length).toBeGreaterThan(3);
    // Not the best row, so the choice is not what Auto would pick anyway.
    const row = list.schedules[3].byCourse;
    const codes = Object.keys(row);

    const after = withSections(plan, row, codes);
    expect(Object.fromEntries(codes.map((code) => [code, after.selectedSections[code]]))).toEqual(row);
    // The picks survive the plan's own resolution: the week shows exactly the row.
    const shown = resolveSectionPlan(normalizePlannerState(after), sampleCatalog).courses.flatMap((course) => (course.section ? [[course.code, course.section.id]] : []));
    expect(Object.fromEntries(shown.filter(([code]) => code in row))).toEqual(row);

    // The next Auto run, as the host starts it: build from the plan, post to the worker.
    const fake = fakePort<OptimizeReply>();
    const client = new OptimizerClient(() => fake.port, () => {});
    client.run(toPlainRequest(buildOptimizeRequest(after, preferences)));
    const [job] = fake.posted;
    expect("kind" in job).toBe(false);
    for (const [code, id] of Object.entries(row)) {
      const course = job.request.courses.find((c) => c.code === code);
      expect(course?.sections.map((s) => s.id)).toContain(id);
    }
    // Using a combination is not keeping it: the plan had no kept sections, and the request has no locks,
    // so Auto may still suggest other sections (choosing does what Use this does, not what Keep does).
    expect(job.request.locks).toEqual({});
    // The chosen week is one the next search may return: it fits that request.
    const next = enumerateSchedules({ ...fromPlainRequest(job.request, 10_000), limit: 2000 });
    expect(next.status).toBe("listed");
    expect(next.schedules.map((s) => JSON.stringify(s.byCourse))).toContain(JSON.stringify(row));
  });

  test("a kept section the row changes is no longer kept; one it keeps stays kept", () => {
    const plan = { ...planWith(["ANTH 1010", "ENGL 1310"]), selectedSections: { "ANTH 1010": "a-old", "ENGL 1310": "e-1" }, lockedSections: { "ANTH 1010": "a-old", "ENGL 1310": "e-1" } };
    const after = withSections(plan, { "ANTH 1010": "a-new", "ENGL 1310": "e-1" }, ["ANTH 1010", "ENGL 1310"]);
    expect(after.lockedSections).toEqual({ "ENGL 1310": "e-1" });
    expect(after.selectedSections).toMatchObject({ "ANTH 1010": "a-new", "ENGL 1310": "e-1" });
  });
});
