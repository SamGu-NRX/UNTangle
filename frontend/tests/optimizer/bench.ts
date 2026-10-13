/**
 * Latency of the full optimize call (k = 3) on 8 courses x 40 sections.
 * Run: bun tests/optimizer/bench.ts [instances] [budgetMs]
 * Prints one line per instance and the p50/p95/max of wall time.
 */
import { optimize } from "@/lib/optimizer/optimize";
import { GOAL_WEIGHTS } from "@/lib/optimizer/presets";
import { generateInstance } from "./generator";

export function latencyRun(instances: number, budgetMs: number, log = false) {
  const goals = Object.values(GOAL_WEIGHTS);
  const times: number[] = [];
  const statuses: Record<string, number> = {};
  for (let i = 0; i < instances; i += 1) {
    const request = generateInstance(1000 + i, {
      courses: 8,
      sectionsPerCourse: 40,
      style: "realistic",
      constraintDensity: i % 2 === 0 ? 0 : 0.15,
    });
    // Half the instances use the planner's goal presets, half the generator's random weights.
    const weights = i % 4 < 2 ? goals[i % goals.length] : request.weights;
    const started = performance.now();
    const result = optimize({ ...request, weights, timeBudgetMs: budgetMs });
    const elapsed = performance.now() - started;
    times.push(elapsed);
    statuses[result.status] = (statuses[result.status] ?? 0) + 1;
    if (log) console.log(`#${i} ${result.status} ${elapsed.toFixed(1)} ms ${result.stats.nodes} nodes`);
  }
  const sorted = [...times].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
  return { p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1], statuses };
}

if (import.meta.main) {
  const instances = Number(process.argv[2] ?? 40);
  const budget = Number(process.argv[3] ?? 10_000);
  const summary = latencyRun(instances, budget, true);
  console.log(JSON.stringify(summary));
}
