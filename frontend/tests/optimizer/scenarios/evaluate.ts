/**
 * Runs one student scenario through the real optimizer path and checks it
 * against the independent reference solver in frontend/tests/optimizer/reference.ts.
 *
 * The engine and the reference share scoring and diversity rules by design
 * (the reference imports the engine's types), so agreement here checks the
 * engine's search and the planner adapter, not the cost model: exact optimal
 * cost, exact top-k cost sequence, the diversity rule, constraint validity,
 * and infeasibility handling with actionable relaxation suggestions.
 */

import { buildOptimizeRequest } from "@/lib/planner";
import { optimize } from "@/lib/optimizer/optimize";
import type { OptimizeRequest, OptimizeResult } from "@/lib/optimizer/types";
import type { PlannerState } from "@/lib/types";
import { defaultPlannerState } from "@/lib/seed-data";
import { normalizePlannerState } from "@/lib/planner";
import { combinationCount, referenceTopK, referenceFeasible, violations, referenceRelax } from "../reference";
import { scenarioCatalog, sectionIdByCode } from "./catalog";
import type { StudentScenario } from "./students";

const TIME_BUDGET_MS = 5000;
const TOP_K = 3;
/** Authoring guard: the reference enumerates every combination, so keep products bounded. */
const MAX_COMBINATIONS = 150_000;

export type ScenarioEvaluation = {
  id: string;
  ok: boolean;
  failures: string[];
  engineStatus: OptimizeResult["status"];
  refBestCost: number | null;
  engineBestCost: number | null;
  gap: number | null;
  combos: number;
  engineMs: number;
  refMs: number;
  schedules: number;
  minDifferentCourses: number;
};

/** The planner state a student with this scenario would hold. */
export function buildState(scenario: StudentScenario, catalog: ReturnType<typeof scenarioCatalog>): PlannerState {
  const statuses: Record<string, "completed" | "inProgress" | "notTaken"> = {};
  for (const { code } of scenario.completed) statuses[code] = "completed";
  for (const code of scenario.nextTerm) statuses[code] = "inProgress";

  const toId = (code: string, sectionCode: string): string =>
    // A pick is either a sectionCode from the fixture or, for the missing-lock
    // scenario, an already-formatted id that exists nowhere.
    sectionCode.includes(":") ? sectionCode : sectionIdByCode(catalog, code, sectionCode);

  const selectedSections: Record<string, string> = {};
  for (const [code, sectionCode] of Object.entries(scenario.picks ?? {})) selectedSections[code] = toId(code, sectionCode);
  const lockedSections: Record<string, string> = {};
  for (const [code, sectionCode] of Object.entries(scenario.locks ?? {})) lockedSections[code] = toId(code, sectionCode);

  return normalizePlannerState({
    ...defaultPlannerState,
    courseStatuses: statuses,
    selectedSections,
    lockedSections,
    selectedMajor: scenario.major,
    optimization: "compact",
    updatedAt: "2026-10-15T12:00:00.000Z",
  });
}

function timePattern(request: OptimizeRequest, byCourse: Record<string, string>): Map<string, string[]> {
  const pattern = new Map<string, string[]>();
  for (const course of request.courses) {
    const section = course.sections.find((s) => s.id === byCourse[course.code]);
    if (!section) continue;
    pattern.set(
      course.code,
      section.meetings
        .map((m) => `${m.day}-${m.start}-${m.end}-${m.dates ? `${m.dates.start}..${m.dates.end}` : ""}`)
        .sort(),
    );
  }
  return pattern;
}

function differingCourses(a: Map<string, string[]>, b: Map<string, string[]>): number {
  let different = 0;
  for (const [code, meetings] of a) {
    const other = b.get(code);
    if (!other || other.join("|") !== meetings.join("|")) different += 1;
  }
  for (const code of b.keys()) if (!a.has(code)) different += 1;
  return different;
}

export function evaluateScenario(scenario: StudentScenario): ScenarioEvaluation {
  const catalog = scenarioCatalog();
  const state = buildState(scenario, catalog);
  const request = buildOptimizeRequest(state, scenario.preferences, {
    catalog,
    k: TOP_K,
    timeBudgetMs: TIME_BUDGET_MS,
  });

  const combos = combinationCount(request);
  const failures: string[] = [];
  const notRun: ScenarioEvaluation = {
    id: scenario.id,
    ok: false,
    failures,
    engineStatus: "infeasible",
    refBestCost: null,
    engineBestCost: null,
    gap: null,
    combos,
    engineMs: 0,
    refMs: 0,
    schedules: 0,
    minDifferentCourses: 0,
  };

  if (combos > MAX_COMBINATIONS) {
    failures.push(`scenario authoring error: ${combos} combinations exceeds the reference cap of ${MAX_COMBINATIONS}`);
    return notRun;
  }

  const engineStart = performance.now();
  const result = optimize(request);
  const engineMs = Math.round(performance.now() - engineStart);

  const refStart = performance.now();
  const ref = referenceTopK(request);
  const refMs = Math.round(performance.now() - refStart);

  const refFeasible = referenceFeasible(request);
  const engineBestCost = result.schedules[0]?.cost ?? null;
  const refBestCost = ref.schedules[0]?.cost ?? null;
  const gap = engineBestCost !== null && refBestCost !== null ? engineBestCost - refBestCost : null;

  // The authored expectation is itself under test: the reference must agree
  // with what the scenario says the student should experience.
  if (refFeasible !== scenario.expect.feasible) {
    failures.push(
      `authored as ${scenario.expect.feasible ? "feasible" : "infeasible"} (${scenario.expect.note ?? "no note"})` +
        ` but the reference finds ${refFeasible ? "a schedule" : "none"}`,
    );
  }

  // Feasibility agreement, both directions.
  if (refFeasible && result.schedules.length === 0) {
    failures.push(
      `engine reports nothing fits but the reference found ${ref.schedules.length} schedule(s) (status ${result.status})`,
    );
  }
  if (!refFeasible && result.schedules.length > 0) {
    failures.push(`engine returned ${result.schedules.length} schedule(s) but the reference finds none feasible (status ${result.status})`);
  }

  if (refFeasible && result.schedules.length > 0) {
    // Exact optimum: a proof-backed status must match the reference's best cost.
    if (result.status !== "optimal") {
      failures.push(`status is ${result.status}, not optimal, within the ${TIME_BUDGET_MS}ms budget`);
    }
    if (gap !== null && gap !== 0) {
      failures.push(`best cost ${engineBestCost} is ${gap > 0 ? "worse" : "better"} than the reference optimum ${refBestCost} (gap ${gap})`);
    }

    // Top-k cost sequence and count.
    if (result.schedules.length !== ref.schedules.length) {
      failures.push(`returned ${result.schedules.length} schedules, reference top-k has ${ref.schedules.length}`);
    }
    for (let i = 0; i < Math.min(result.schedules.length, ref.schedules.length); i += 1) {
      if (result.schedules[i].cost !== ref.schedules[i].cost) {
        failures.push(`rank ${i + 1} cost ${result.schedules[i].cost} does not match reference ${ref.schedules[i].cost}`);
      }
    }

    // Diversity: each alternative must differ from every earlier one in at
    // least minDifferentCourses courses, per the contract.
    const minDiff = result.stats.minDifferentCourses;
    if (minDiff !== ref.minDifferent) {
      failures.push(`minDifferentCourses ${minDiff} does not match the contract value ${ref.minDifferent}`);
    }
    const patterns = result.schedules.map((schedule) => timePattern(request, schedule.byCourse));
    for (let i = 1; i < patterns.length; i += 1) {
      for (let j = 0; j < i; j += 1) {
        const different = differingCourses(patterns[i], patterns[j]);
        if (different < minDiff) {
          failures.push(`alternatives ${j + 1} and ${i + 1} differ in only ${different} course(s), fewer than the required ${minDiff}`);
        }
      }
    }

    // Validity: every returned schedule must satisfy the scenario's constraints.
    for (const schedule of result.schedules) {
      const chosen = request.courses.map((course) => {
        const id = schedule.byCourse[course.code];
        const section = course.sections.find((s) => s.id === id);
        if (!section) {
          failures.push(`schedule picks ${course.code} "${id}", which is not a candidate section`);
          return null;
        }
        return section;
      });
      if (chosen.some((section) => section === null)) break;
      const problems = violations(request, chosen as NonNullable<(typeof chosen)[number]>[]);
      if (problems.length > 0) {
        failures.push(`a returned schedule violates constraints: ${problems.join("; ")}`);
        break;
      }
    }
  } else {
    // Infeasible: the explanation must name the blocking courses and be
    // minimal, and every claimed-resolves suggestion must actually fix it.
    if (result.status !== "infeasible") {
      failures.push(`no schedule fits but status is ${result.status}; expected infeasible with an explanation`);
    } else if (!result.explanation) {
      failures.push("infeasible without an explanation");
    } else {
      const explanation = result.explanation;
      if (!explanation.minimal) failures.push("explanation is not minimal");
      const courses = explanation.members.filter((m) => m.kind === "course").map((m) => m.courseCode);
      if (courses.length === 0) failures.push("explanation names no courses");
      for (const suggestion of explanation.suggestions) {
        if (suggestion.resolves === null) continue;
        const actuallyResolves = referenceFeasible(referenceRelax(request, suggestion.relaxation));
        if (actuallyResolves !== suggestion.resolves) {
          failures.push(`suggestion "${suggestion.label}" claims resolves=${suggestion.resolves} but the reference finds ${actuallyResolves ? "a fix" : "no fix"}`);
        }
      }
    }
  }

  return {
    id: scenario.id,
    ok: failures.length === 0,
    failures,
    engineStatus: result.status,
    refBestCost,
    engineBestCost,
    gap,
    combos,
    engineMs,
    refMs,
    schedules: result.schedules.length,
    minDifferentCourses: result.stats.minDifferentCourses,
  };
}
