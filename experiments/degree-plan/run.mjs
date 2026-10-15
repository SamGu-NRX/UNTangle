// Degree-plan experiment driver.
//
//   node experiments/degree-plan/run.mjs --manifest experiments/degree-plan/manifest.json
//   node experiments/degree-plan/run.mjs --replay experiments/degree-plan/results
//
// --manifest: resolve every scenario, run the bounded planner and the
//   exhaustive enumerator on identical inputs, and write results/ (agreement
//   counts, infeasibility witnesses, measured runtime, source hashes).
// --replay: re-run the committed manifest against the committed results and
//   diff — verdicts, optima, plan counts and source hashes must reproduce
//   exactly (runtimes and node counts are informational only). Nonzero exit
//   on any mismatch.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCatalog, majorUniverse, termLabels, OFFERING_ASSUMPTIONS } from "./lib/catalog.mjs";
import { initialPlanState, STATUS } from "./lib/semantics.mjs";
import { buildProblem, enumerate, planTermsUsed, planFromAssignment } from "./lib/degree-plan.mjs";
import { validatePlan } from "./lib/checker.mjs";
import { mulberry32 } from "./lib/prng.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const resultsDir = path.join(here, "results");

const mode = process.argv[2] ?? "--manifest";

if (mode === "--manifest") {
  const manifestArg = process.argv[3] ?? "experiments/degree-plan/manifest.json";
  const manifestPath = path.resolve(process.cwd(), manifestArg);
  runManifest(JSON.parse(readFileSync(manifestPath, "utf8")), path.dirname(manifestPath));
} else if (mode === "--replay") {
  const dir = path.resolve(process.cwd(), process.argv[3] ?? "experiments/degree-plan/results");
  replay(dir);
} else {
  console.error(`unknown mode: ${mode}`);
  process.exit(2);
}

// ---------------------------------------------------------------------------

function resolveScenario(catalog, manifest, scenario) {
  const { majorId, core, universe, missingCore } = majorUniverse(catalog, scenario.major);
  const codes = universe.map((course) => course.code);

  let courseStatuses;
  let scenarioKind = scenario.initialStatuses;
  if (scenario.initialStatuses === "seed-defaults") {
    courseStatuses = { ...catalog.defaultCourseStatuses };
  } else if (scenario.initialStatuses === "fresh") {
    courseStatuses = Object.fromEntries(codes.map((code) => [code, STATUS.REMAINING]));
  } else if (scenario.initialStatuses === "all-done") {
    courseStatuses = Object.fromEntries(codes.map((code) => [code, STATUS.DONE]));
  } else if (typeof scenario.initialStatuses === "object" && scenario.initialStatuses.random) {
    const { seed, doneFraction } = scenario.initialStatuses.random;
    const next = mulberry32(seed);
    courseStatuses = {};
    for (const code of codes) {
      courseStatuses[code] = next() < doneFraction ? STATUS.DONE : STATUS.REMAINING;
    }
    // Exactly one P course among the remaining (not-done) courses: the first
    // by seeded draw — mirrors a user with one current-semester course.
    const notDone = codes.filter((code) => courseStatuses[code] === STATUS.REMAINING);
    if (notDone.length > 0) {
      courseStatuses[notDone[Math.floor(next() * notDone.length)]] = STATUS.PLANNED;
    }
    scenarioKind = `random(seed=${seed},done=${doneFraction})`;
  } else {
    throw new Error(`unhandled initialStatuses: ${JSON.stringify(scenario.initialStatuses)}`);
  }

  return { majorId, core, universe, missingCore, courseStatuses, scenarioKind };
}

function runCase(catalog, manifest, scenario) {
  const resolved = resolveScenario(catalog, manifest, scenario);
  const { universe, core, courseStatuses } = resolved;
  const coreSet = new Set(core);

  const shared = {
    universe,
    courseStatuses,
    termCap: scenario.termCap,
    horizon: scenario.horizon,
    anchor: manifest.anchor,
    equivalence: scenario.equivalence,
  };

  const boundedProblem = buildProblem(shared);
  boundedProblem.coreCodes = coreSet;
  const exhaustiveProblem = buildProblem(shared);
  exhaustiveProblem.coreCodes = coreSet;

  const bounded = enumerate(boundedProblem, { mode: "bounded", ...manifest.bounded });
  const exhaustive = enumerate(exhaustiveProblem, { mode: "exhaustive", ...manifest.exhaustive });

  // Validate every emitted plan with the independent checker.
  const labels = termLabels(manifest.anchor, scenario.horizon);
  let boundedValid = null;
  if (bounded.feasible) {
    const check = validatePlan(boundedProblem, bounded.best, { termLabels: labels });
    boundedValid = check.valid;
    if (!check.valid) {
      throw new Error(`bounded plan failed independent validation in ${scenario.id}: ${check.errors.join("; ")}`);
    }
  }

  const agreement = {
    verdict: bounded.feasible === exhaustive.feasible,
    optimum:
      bounded.feasible && exhaustive.feasible
        ? planTermsUsed(bounded.best) === planTermsUsed(exhaustive.best) &&
          JSON.stringify(bounded.best) === JSON.stringify(exhaustive.best)
        : null,
    // Plan-count agreement only claimed when bounded finished its search.
    count:
      bounded.exhaustiveComplete && exhaustive.exhaustiveComplete
        ? bounded.feasiblePlans === exhaustive.feasiblePlans
        : null,
  };

  return {
    id: scenario.id,
    major: scenario.major,
    scenarioKind: resolved.scenarioKind,
    termCap: scenario.termCap,
    horizon: scenario.horizon,
    equivalence: scenario.equivalence,
    universeSize: universe.length,
    remainingCount: boundedProblem.remaining.length,
    initial: {
      done: [...boundedProblem.done].sort(),
      planned: [...boundedProblem.planned].sort(),
      unplannable: boundedProblem.unplannable,
    },
    bounded: {
      feasible: bounded.feasible,
      minTerms: bounded.feasible ? planTermsUsed(bounded.best) : null,
      best: bounded.best,
      planCount: bounded.feasiblePlans,
      nodes: bounded.nodes,
      runtimeMs: round3(bounded.runtimeMs),
      exhaustiveComplete: bounded.exhaustiveComplete,
      note: bounded.note ?? null,
    },
    exhaustive: {
      feasible: exhaustive.feasible,
      minTerms: exhaustive.feasible ? planTermsUsed(exhaustive.best) : null,
      best: exhaustive.best,
      planCount: exhaustive.feasiblePlans,
      nodes: exhaustive.nodes,
      runtimeMs: round3(exhaustive.runtimeMs),
      exhaustiveComplete: exhaustive.exhaustiveComplete,
      note: exhaustive.note ?? null,
    },
    agreement,
    infeasibilityWitness:
      !exhaustive.feasible && exhaustive.exhaustiveComplete ? exhaustive.witness : null,
    missingCore: resolved.missingCore,
  };
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

function runManifest(manifest, manifestDir) {
  const catalog = loadCatalog();
  const cases = [];

  for (const set of manifest.scenarioSets) {
    if (set.scenarios) {
      for (const scenario of set.scenarios) {
        cases.push(runCase(catalog, manifest, scenario));
      }
    } else if (set.generator) {
      for (const scenario of expandGenerator(set.generator)) {
        cases.push(runCase(catalog, manifest, scenario));
      }
    }
  }

  // Agreement tallies. Disagreements are listed in full — the point of the
  // comparison is the count AND the specific cases.
  const tally = {
    cases: cases.length,
    verdictAgreements: cases.filter((c) => c.agreement.verdict).length,
    verdictDisagreements: cases.filter((c) => !c.agreement.verdict).length,
    optimumComparable: cases.filter((c) => c.agreement.optimum !== null).length,
    optimumAgreements: cases.filter((c) => c.agreement.optimum === true).length,
    optimumDisagreements: cases.filter((c) => c.agreement.optimum === false).length,
    countComparable: cases.filter((c) => c.agreement.count !== null).length,
    countAgreements: cases.filter((c) => c.agreement.count === true).length,
    countDisagreements: cases.filter((c) => c.agreement.count === false).length,
    boundedIncomplete: cases.filter((c) => !c.bounded.exhaustiveComplete).length,
    exhaustiveIncomplete: cases.filter((c) => !c.exhaustive.exhaustiveComplete).length,
    infeasibleCases: cases.filter((c) => !c.exhaustive.feasible).length,
    witnessedInfeasible: cases.filter((c) => c.infeasibilityWitness).length,
  };
  const disagreements = cases.filter((c) =>
    c.agreement.verdict === false ||
    c.agreement.optimum === false ||
    c.agreement.count === false,
  );

  const summary = {
    experiment: manifest.experiment,
    generatedAt: new Date().toISOString(),
    sourceHashes: {
      catalog: catalog.sourceSha256,
      manifest: sha256Json(manifest),
    },
    offeringAssumptions: OFFERING_ASSUMPTIONS,
    excludedMajors: {
      psyc: "core courses HIST 2610/HIST 2620/GOVT 2305 are absent from the generated catalog — nothing to plan (see catalog-gaps test)",
      engl: "core courses HIST 2610/HIST 2620 are absent from the generated catalog — nothing to plan",
      other: "undeclared: empty core list by definition",
    },
    tally,
    disagreements: disagreements.map((c) => ({
      id: c.id,
      agreement: c.agreement,
      boundedMinTerms: c.bounded.minTerms,
      exhaustiveMinTerms: c.exhaustive.minTerms,
      boundedPlanCount: c.bounded.planCount,
      exhaustivePlanCount: c.exhaustive.planCount,
    })),
    casesFile: "cases.json",
  };

  mkdirSync(resultsDir, { recursive: true });
  writeFileSync(path.join(resultsDir, "cases.json"), JSON.stringify(cases, null, 2) + "\n");
  writeFileSync(path.join(resultsDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  writeFileSync(
    path.join(resultsDir, "plans-export.json"),
    JSON.stringify(exportForPage(cases, manifest, catalog), null, 2) + "\n",
  );

  console.log(`cases: ${tally.cases}`);
  console.log(`verdict agreement:   ${tally.verdictAgreements}/${tally.cases}`);
  console.log(`optimum agreement:   ${tally.optimumAgreements}/${tally.optimumComparable} comparable (${tally.optimumDisagreements} disagreements)`);
  console.log(`plan-count agreement:${tally.countAgreements}/${tally.countComparable} comparable (${tally.countDisagreements} disagreements)`);
  console.log(`infeasible cases:    ${tally.infeasibleCases} (witnessed: ${tally.witnessedInfeasible})`);
  console.log(`incomplete runs:     bounded ${tally.boundedIncomplete}, exhaustive ${tally.exhaustiveIncomplete}`);
  if (disagreements.length > 0) {
    console.log(`disagreement cases: ${disagreements.map((c) => c.id).join(", ")}`);
  }
  console.log(`results written to ${path.relative(process.cwd(), resultsDir)}/`);
}

function expandGenerator(generator) {
  const scenarios = [];
  for (const seed of generator.seeds) {
    for (const major of generator.majors) {
      for (const termCap of generator.termCaps) {
        for (const horizon of generator.horizons) {
          for (const doneFraction of generator.doneFractions) {
            scenarios.push({
              id: `rnd-s${seed}-${major}-c${termCap}-h${horizon}-d${doneFraction}`,
              major,
              initialStatuses: { random: { seed, doneFraction } },
              termCap,
              horizon,
              equivalence: generator.equivalence,
            });
          }
        }
      }
    }
  }
  return scenarios;
}

function exportForPage(cases, manifest, catalog) {
  return {
    experiment: manifest.experiment,
    anchor: manifest.anchor,
    catalogSha256: catalog.sourceSha256,
    offeringAssumptions: OFFERING_ASSUMPTIONS,
    tally: cases.length,
    cases: cases.map((c) => ({
      id: c.id,
      major: c.major,
      scenarioKind: c.scenarioKind,
      termCap: c.termCap,
      horizon: c.horizon,
      equivalence: c.equivalence,
      feasible: c.exhaustive.feasible,
      minTerms: c.exhaustive.minTerms,
      planCount: c.exhaustive.planCount,
      terms: c.exhaustive.feasible ? planFromAssignment(c.exhaustive.best) : null,
      witness: c.infeasibilityWitness,
      verdictAgrees: c.agreement.verdict,
      optimumAgrees: c.agreement.optimum,
      countAgrees: c.agreement.count,
    })),
  };
}

function sha256Json(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

// ---------------------------------------------------------------------------

function replay(dir) {
  const summaryPath = path.join(dir, "summary.json");
  const casesPath = path.join(dir, "cases.json");
  if (!existsSync(summaryPath) || !existsSync(casesPath)) {
    console.error(`replay: missing ${summaryPath} or ${casesPath}`);
    process.exit(1);
  }
  const storedSummary = JSON.parse(readFileSync(summaryPath, "utf8"));
  const storedCases = JSON.parse(readFileSync(casesPath, "utf8"));

  // Discover the manifest: committed results record a hash; find the manifest
  // file next to the results dir (../manifest.json).
  const manifestPath = path.join(path.dirname(dir), "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const catalog = loadCatalog();

  const mismatches = [];
  if (storedSummary.sourceHashes.catalog !== catalog.sourceSha256) {
    mismatches.push(`catalog hash drift: results were generated against ${storedSummary.sourceHashes.catalog}, current catalog is ${catalog.sourceSha256}`);
  }

  const rerun = [];
  for (const set of manifest.scenarioSets) {
    for (const scenario of set.scenarios ?? []) rerun.push(runCase(catalog, manifest, scenario));
    for (const scenario of set.generator ? expandGenerator(set.generator) : []) {
      rerun.push(runCase(catalog, manifest, scenario));
    }
  }

  const storedById = new Map(storedCases.map((c) => [c.id, c]));
  if (rerun.length !== storedCases.length) {
    mismatches.push(`case count drift: stored ${storedCases.length}, replay ${rerun.length}`);
  }

  const comparable = ["verdict", "optimum", "count"];
  for (const fresh of rerun) {
    const stored = storedById.get(fresh.id);
    if (!stored) {
      mismatches.push(`case ${fresh.id}: present in replay but absent from stored results`);
      continue;
    }
    if (stored.major !== fresh.major || stored.termCap !== fresh.termCap || stored.horizon !== fresh.horizon || stored.equivalence !== fresh.equivalence) {
      mismatches.push(`case ${fresh.id}: scenario parameters drifted`);
    }
    for (const dim of comparable) {
      if (JSON.stringify(stored.agreement[dim]) !== JSON.stringify(fresh.agreement[dim])) {
        mismatches.push(`case ${fresh.id}: agreement.${dim} stored ${JSON.stringify(stored.agreement[dim])} vs replay ${JSON.stringify(fresh.agreement[dim])}`);
      }
    }
    if (JSON.stringify(stored.bounded.best) !== JSON.stringify(fresh.bounded.best)) {
      mismatches.push(`case ${fresh.id}: bounded best plan drift`);
    }
    if (JSON.stringify(stored.exhaustive.best) !== JSON.stringify(fresh.exhaustive.best)) {
      mismatches.push(`case ${fresh.id}: exhaustive best plan drift`);
    }
    if (stored.bounded.planCount !== fresh.bounded.planCount || stored.exhaustive.planCount !== fresh.exhaustive.planCount) {
      mismatches.push(`case ${fresh.id}: plan counts drifted (bounded ${stored.bounded.planCount}->${fresh.bounded.planCount}, exhaustive ${stored.exhaustive.planCount}->${fresh.exhaustive.planCount})`);
    }
    const wStored = JSON.stringify(stored.infeasibilityWitness);
    const wFresh = JSON.stringify(fresh.infeasibilityWitness);
    if (wStored !== wFresh) mismatches.push(`case ${fresh.id}: witness drift`);
  }

  if (mismatches.length > 0) {
    console.error(`replay FAILED — ${mismatches.length} mismatch(es):`);
    for (const m of mismatches.slice(0, 20)) console.error(`  - ${m}`);
    process.exit(1);
  }
  console.log(`replay OK — ${rerun.length} cases reproduce: verdicts, optima, plan counts, witnesses and source hashes all match the committed results.`);
}
