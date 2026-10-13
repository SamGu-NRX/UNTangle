/**
 * Latency of an Optimize click as the page sees it, on 8 courses x 40
 * sections (k = 3). Each instance goes through the worker protocol
 * (runJob): a first search with FIRST_BUDGET_MS whose answer is shown at
 * once, then, only when that answer is not proven, a fresh search capped
 * at FINAL_BUDGET_MS.
 *
 * - first: click to the first shown result (the first search's wall time).
 * - final: click to the last result (both searches when there is a second).
 *
 * Run: bun tests/optimizer/bench.ts [instances] [--terms]
 * Prints one line per instance and p50/p95/max of both, plus statuses.
 * Wall times on the machine that runs it; a busy machine reads slower.
 * `--terms` gives sections half-term dates and some weekend meetings
 * (`terms` in generator.ts). On mixed-activity days, the search uses the
 * maximum bound across segments rather than their sum (see search.ts).
 */
import { optimize } from "@/lib/optimizer/optimize";
import { GOAL_WEIGHTS } from "@/lib/optimizer/presets";
import { FINAL_BUDGET_MS, FIRST_BUDGET_MS, runJob, toPlainRequest, type OptimizeJob, type OptimizeReply } from "@/lib/optimizer/worker/protocol";
import { generateInstance } from "./generator";

function quantiles(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
  return { p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1] };
}

export function latencyRun(instances: number, log = false, terms = false) {
  const goals = Object.values(GOAL_WEIGHTS);
  const first: number[] = [];
  const final: number[] = [];
  const firstStatuses: Record<string, number> = {};
  const finalStatuses: Record<string, number> = {};
  for (let i = 0; i < instances; i += 1) {
    const generated = generateInstance(1000 + i, {
      courses: 8,
      sectionsPerCourse: 40,
      style: "realistic",
      constraintDensity: i % 2 === 0 ? 0 : 0.15,
      terms,
    });
    // Half the instances use the planner's goal presets, half the generator's random weights.
    const weights = i % 4 < 2 ? goals[i % goals.length] : generated.weights;
    const replies: Array<{ reply: OptimizeReply; at: number }> = [];
    const started = performance.now();
    // The clock includes turning the walking provider into a table, which the page does before posting.
    const job: OptimizeJob = { id: i, request: toPlainRequest({ ...generated, weights }) };
    runJob(job, { optimize, post: (reply) => replies.push({ reply, at: performance.now() - started }) });
    const shown = replies[0];
    const last = replies[replies.length - 1];
    if (shown.reply.phase === "error" || last.reply.phase === "error") throw new Error(`instance ${i}: optimizer error`);
    first.push(shown.at);
    final.push(last.at);
    firstStatuses[shown.reply.result.status] = (firstStatuses[shown.reply.result.status] ?? 0) + 1;
    finalStatuses[last.reply.result.status] = (finalStatuses[last.reply.result.status] ?? 0) + 1;
    if (log) {
      const tail = replies.length > 1 ? ` -> final ${last.reply.result.status} ${last.at.toFixed(1)} ms` : "";
      console.log(`#${i} first ${shown.reply.result.status} ${shown.at.toFixed(1)} ms${tail}`);
    }
  }
  return {
    instances,
    budgets: { firstMs: FIRST_BUDGET_MS, finalMs: FINAL_BUDGET_MS },
    first: quantiles(first),
    final: quantiles(final),
    firstStatuses,
    finalStatuses,
  };
}

if (import.meta.main) {
  const instances = Number(process.argv.slice(2).find((arg) => !arg.startsWith("--")) ?? 40);
  console.log(JSON.stringify(latencyRun(instances, true, process.argv.includes("--terms"))));
}
