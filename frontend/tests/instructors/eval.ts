#!/usr/bin/env bun
/**
 * Scores `matchInstructor` against the labeled scenarios in ./data/scenarios.ts.
 *
 * Every scenario carries a family from the spec's hard-case table, so the
 * scenario count is the hard-case count. Pairs are counted per scenario times
 * candidate: each candidate in scope is one labeled section-person versus
 * candidate comparison, projected from the matcher's single decision for the
 * field. A returned match is correct when it equals the expected candidate;
 * an abstain where a candidate was expected counts against recall, and a
 * returned candidate where an abstain was expected counts against precision.
 *
 * Usage, from frontend/:
 *   bun --no-env-file tests/instructors/eval.ts
 *
 * Exits 1 when pairs fall below 150, hard-case scenarios fall below 40,
 * precision falls below 0.98, or any scenario names a family outside the
 * spec's table. Recall is printed honestly and is not gated: the matcher is
 * allowed to lose recall to stay precise.
 */

import { CONFIDENCE_THRESHOLD, matchInstructor } from "../../src/lib/instructors/match";
import { SCENARIOS, type Scenario } from "./data/scenarios";

/** The hard-case families from the spec's behavior table. */
const HARD_FAMILIES = [
  "unusable-instructor",
  "surnames",
  "first-names-initials",
  "middle-names",
  "suffixes",
  "accents-and-case",
  "shared-surnames",
  "multi-person",
  "display-form",
] as const;

type Family = (typeof HARD_FAMILIES)[number];
type Counts = { pairs: number; tp: number; fp: number; fn: number; tn: number };

const emptyCounts = (): Counts => ({ pairs: 0, tp: 0, fp: 0, fn: 0, tn: 0 });

function addPair(counts: Counts, scenario: Scenario, returned: string | null, candidateId: string): void {
  counts.pairs += 1;
  if (returned === candidateId) {
    if (scenario.expected === candidateId) counts.tp += 1;
    else counts.fp += 1;
  } else if (scenario.expected === candidateId) counts.fn += 1;
  else counts.tn += 1;
}

const ratio = (numerator: number, denominator: number): string =>
  denominator === 0 ? "n/a" : `${Math.round((1000 * numerator) / denominator) / 10}%`;

export function scoreScenario(scenario: Scenario, counts: Counts = emptyCounts()): Counts {
  const result = matchInstructor(scenario.sectionName, scenario.candidates);
  for (const candidate of scenario.candidates) addPair(counts, scenario, result.candidateId, candidate.id);
  return counts;
}

export function scoreAll(scenarios: readonly Scenario[]): { counts: Counts; perFamily: Map<Family, Counts> } {
  const counts = emptyCounts();
  const perFamily = new Map<Family, Counts>();
  for (const scenario of scenarios) {
    scoreScenario(scenario, counts);
    const family = scenario.family as Family;
    const familyCounts = perFamily.get(family) ?? emptyCounts();
    scoreScenario(scenario, familyCounts);
    perFamily.set(family, familyCounts);
  }
  return { counts, perFamily };
}

function main(): number {
  const unknownFamilies = SCENARIOS.filter(scenario => !HARD_FAMILIES.includes(scenario.family as Family));
  const { counts, perFamily } = scoreAll(SCENARIOS);
  const realPairs = SCENARIOS
    .filter(scenario => scenario.provenance !== "derived")
    .reduce((sum, scenario) => sum + scenario.candidates.length, 0);

  console.log(`threshold: ${CONFIDENCE_THRESHOLD}`);
  console.log(
    `scenarios: ${SCENARIOS.length} hard-case, ` +
    `${SCENARIOS.filter(s => s.provenance === "fixture").length} fixture / ` +
    `${SCENARIOS.filter(s => s.provenance === "vsb-fetch").length} vsb-fetch / ` +
    `${SCENARIOS.filter(s => s.provenance === "derived").length} derived`,
  );
  console.log(
    `pairs: ${counts.pairs} total, ${realPairs} real (non-derived) ` +
    `-- tp ${counts.tp}, fp ${counts.fp}, fn ${counts.fn}, tn ${counts.tn}`,
  );
  console.log("");
  console.log("  family                  scenarios  pairs   precision  recall    (tp/fp, tp/fn)");
  for (const family of HARD_FAMILIES) {
    const familyCounts = perFamily.get(family);
    if (!familyCounts) {
      console.log(`  ${family.padEnd(23)} 0          0       n/a        n/a       (0/0, 0/0)`);
      continue;
    }
    const scenarios = SCENARIOS.filter(s => s.family === family).length;
    console.log(
      `  ${family.padEnd(23)} ${String(scenarios).padEnd(10)} ${String(familyCounts.pairs).padEnd(7)} ` +
      `${ratio(familyCounts.tp, familyCounts.tp + familyCounts.fp).padEnd(10)} ` +
      `${ratio(familyCounts.tp, familyCounts.tp + familyCounts.fn).padEnd(9)} ` +
      `(${familyCounts.tp}/${familyCounts.fp}, ${familyCounts.tp}/${familyCounts.fn})`,
    );
  }
  console.log("");
  console.log(`precision: ${ratio(counts.tp, counts.tp + counts.fp)}`);
  console.log(`recall:    ${ratio(counts.tp, counts.tp + counts.fn)}`);

  if (unknownFamilies.length > 0) {
    console.error(`fail: ${unknownFamilies.length} scenarios name families outside the spec table`);
    return 1;
  }
  if (counts.pairs < 150) {
    console.error(`fail: ${counts.pairs} pairs is below the 150-pair floor`);
    return 1;
  }
  if (SCENARIOS.length < 40) {
    console.error(`fail: ${SCENARIOS.length} hard-case scenarios is below the 40 floor`);
    return 1;
  }
  const precision = counts.tp / (counts.tp + counts.fp);
  if (precision < 0.98) {
    console.error(`fail: precision ${precision} is below 0.98`);
    return 1;
  }
  console.log("gates: pairs >= 150, hard cases >= 40, precision >= 0.98 -- all pass");
  return 0;
}

process.exitCode = main();
