/**
 * Time and node use of Browse all's enumeration (enumerate.ts) with its
 * default budgets, on the shapes the Auto bench uses plus two smaller ones
 * closer to a real plan. Not a test; the defaults in enumerate.ts cite it.
 *
 * Run: bun tests/optimizer/browse-bench.ts [instances per shape, default 12]
 */
import { enumerateSchedules } from "@/lib/optimizer/enumerate";
import { BROWSE_LIMIT } from "@/lib/optimizer/worker/protocol";
import { generateInstance, type InstanceShape } from "./generator";

const instances = Number(process.argv[2] ?? 12);
const shapes: Array<[string, InstanceShape]> = [
  ["8 courses x 40 sections", { courses: 8, sectionsPerCourse: 40, style: "realistic", constraintDensity: 0.2 }],
  ["6 x 12", { courses: 6, sectionsPerCourse: 12, style: "realistic", constraintDensity: 0.2 }],
  ["5 x 8", { courses: 5, sectionsPerCourse: 8, style: "realistic", constraintDensity: 0.2 }],
];

for (const [name, shape] of shapes) {
  const times: number[] = [];
  let unproven = 0;
  let inexact = 0;
  for (let i = 0; i < instances; i += 1) {
    const request = generateInstance(1000 + i, shape);
    const started = performance.now();
    const result = enumerateSchedules({ ...request, limit: BROWSE_LIMIT, timeBudgetMs: undefined });
    times.push(performance.now() - started);
    if (result.status === "listed" && !result.schedules[0].proven) unproven += 1;
    if (!result.totalExact) inexact += 1;
  }
  times.sort((a, b) => a - b);
  const at = (q: number) => times[Math.min(times.length - 1, Math.floor(q * times.length))].toFixed(0);
  console.log(`${name}: p50 ${at(0.5)} ms, max ${at(1)} ms; ${unproven}/${instances} lists unproven, ${inexact}/${instances} totals a lower bound`);
}
