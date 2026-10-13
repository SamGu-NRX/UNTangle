/// <reference lib="webworker" />
/**
 * Source of the optimizer's browser thread. A search can take its whole
 * budget (up to FINAL_BUDGET_MS); here it never blocks the page.
 *
 * The browser loads the prebuilt optimize.worker.bundle.js, not this file:
 * Next 16.1's Turbopack copies a `new URL("./x.ts", import.meta.url)`
 * worker as a raw asset instead of compiling it. Regenerate the bundle with
 * `bun tests/optimizer/build-worker.ts --write`; tests/optimizer/worker.test.ts
 * fails while it is out of date.
 */
import { optimize } from "../optimize";
import { runJob, type OptimizeJob, type OptimizeReply } from "./protocol";

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<OptimizeJob>) => {
  runJob(event.data, { optimize, post: (reply: OptimizeReply) => scope.postMessage(reply) });
};
