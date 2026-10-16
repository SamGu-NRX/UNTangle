/// <reference lib="webworker" />
/**
 * Source of the optimizer's browser thread. A search can take its whole
 * budget (up to FINAL_BUDGET_MS, or BROWSE_BUDGET_MS for Browse all); here
 * it never blocks the page.
 *
 * The browser loads the prebuilt optimize.worker.bundle.js, not this file:
 * Next 16.1's Turbopack copies a `new URL("./x.ts", import.meta.url)`
 * worker as a raw asset instead of compiling it. Regenerate the bundle with
 * `bun tests/optimizer/build-worker.ts --write`; tests/optimizer/worker.test.ts
 * fails while it is out of date.
 */
import { enumerateSchedules } from "../enumerate";
import { optimize } from "../optimize";
import { runBrowseJob, runJob, type BrowseJob, type BrowseReply, type OptimizeJob, type OptimizeReply } from "./protocol";

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<OptimizeJob | BrowseJob>) => {
  const job = event.data;
  if ("kind" in job && job.kind === "browse") {
    runBrowseJob(job, { enumerate: enumerateSchedules, post: (reply: BrowseReply) => scope.postMessage(reply) });
    return;
  }
  runJob(job, { optimize, post: (reply: OptimizeReply) => scope.postMessage(reply) });
};
