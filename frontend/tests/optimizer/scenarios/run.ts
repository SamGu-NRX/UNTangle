#!/usr/bin/env bun
/**
 * Runs every real-student scenario against the optimizer and the independent
 * reference, writes REPORT.md, and exits 1 when any scenario fails.
 *
 * Usage: bun --no-env-file tests/optimizer/scenarios/run.ts
 */

import { writeFileSync } from "node:fs";
import { evaluateScenario } from "./evaluate";
import { scenarios } from "./students";

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
};

const p95 = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
};

function main(): void {
  const results = scenarios.map(evaluateScenario);
  const failed = results.filter((r) => !r.ok);
  const engineTimes = results.filter((r) => r.refBestCost !== null).map((r) => r.engineMs);
  const report: string[] = [];

  report.push("# Optimizer auto-evaluation: real-student scenarios");
  report.push("");
  report.push("Every scenario is a typed student (major, completed courses, next-term picks) with real");
  report.push("Spring 2027 options from `scenarios/fixtures/spring-2027-trimmed.json`. Each runs through");
  report.push("`buildOptimizeRequest` + `optimize` and is checked against the independent reference solver");
  report.push("(`frontend/tests/optimizer/reference.ts`): exact optimal cost (gap 0), the top-k cost");
  report.push("sequence, the diversity rule, constraint validity, and — for infeasible students — a");
  report.push("minimal explanation whose suggestions resolve exactly as claimed.");
  report.push("");
  report.push("Re-run: `bun --no-env-file tests/optimizer/scenarios/run.ts`.");
  report.push("");

  report.push(
    `**Verdict: ${failed.length === 0 ? "all scenarios pass" : `${failed.length} of ${results.length} scenarios FAILED`}**`,
  );
  report.push("");
  report.push(
    `Engine time across feasible scenarios: median ${median(engineTimes)}ms, p95 ${p95(engineTimes)}ms` +
      ` (top-k = 3, ${5000}ms budget per scenario).`,
  );
  report.push("");

  report.push("| Scenario | Courses | Combos | Engine | Best cost | Ref best | Gap | Engine ms | Ref ms | Result |");
  report.push("|---|---|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    report.push(
      `| ${r.id} | ${scenarios.find((s) => s.id === r.id)?.nextTerm.length ?? 0} | ${r.combos.toLocaleString("en-US")} | ${r.engineStatus} | ${r.engineBestCost ?? "—"} | ${r.refBestCost ?? "—"} | ${r.gap ?? "—"} | ${r.engineMs} | ${r.refMs} | ${r.ok ? "✅" : "❌ FAIL"} |`,
    );
  }
  report.push("");

  if (failed.length > 0) {
    report.push("## Failures");
    report.push("");
    for (const r of failed) {
      report.push(`### ${r.id}`);
      report.push("");
      for (const failure of r.failures) report.push(`- ${failure}`);
      report.push("");
    }
  }

  const dir = new URL(".", import.meta.url).pathname;
  writeFileSync(`${dir}REPORT.md`, `${report.join("\n")}\n`);

  console.log(report.join("\n"));
  if (failed.length > 0) {
    console.error(`\n${failed.length} scenario(s) failed`);
    process.exit(1);
  }
}

main();
