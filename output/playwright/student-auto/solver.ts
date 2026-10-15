/**
 * The solver half of the student-auto journey, run by the journey with Bun
 * (the journey entry itself stays plain Node; only this file imports the
 * app's TypeScript). It never talks to the network and never touches a
 * browser: it rebuilds the exact OptimizeRequest the Week page sent, from
 * the planner state and preferences the journey captured out of the
 * student's own storage, and answers three questions about it:
 *
 *   1. what did Auto (the app's own engine, run here on that request) return;
 *   2. what is the true optimum and top-k, from the independent reference
 *      solver in frontend/tests/optimizer/reference.ts (imported, never
 *      copied);
 *   3. is every returned option feasible, and do the options differ by at
 *      least the contract's minDifferentCourses.
 *
 * The request is rebuilt through the app's own buildOptimizeRequest and the
 * worker protocol's own toPlainRequest/runJob, the exact pipeline
 * untangle-host.ts and the optimizer worker use in the browser, walking
 * time included. Section data comes from the same recorded Spring 2027
 * fixture the journeys serve the app (see README.md).
 *
 * Modes:
 *   sections  print the per-course /api/sections responses for the whole
 *             recorded fixture, as JSON (the journey routes them to the app)
 *   solve <state.json> <prefs.json>
 *             run the engine and the reference on the captured request and
 *             print the comparison as JSON
 *
 * Usage: bun output/playwright/student-auto/solver.ts <mode> [args]
 */
import { readFileSync } from "node:fs";
import { buildOptimizeRequest, normalizePlannerState, parseSchedulePreferences } from "../../../frontend/src/lib/planner";
import { optimize } from "../../../frontend/src/lib/optimizer/optimize";
import { fromPlainRequest, runJob, toPlainRequest } from "../../../frontend/src/lib/optimizer/worker/protocol";
import { combinationCount, referenceFeasible, referenceTopK, violations } from "../../../frontend/tests/optimizer/reference";
import { courseResult, parseTerm } from "../../../frontend/src/lib/sections/vsb";
import fixture from "../../../frontend/tests/optimizer/scenarios/fixtures/spring-2027-trimmed.json";

const CHECKED_AT = "2026-10-15T11:09:00.000Z";

/** The recorded Spring 2027 capture, through the app's own parser: the same data path as the live proxy. */
function fixtureCatalog(): SectionCatalog {
  const term = parseTerm(structuredClone(fixture), "spring-2027");
  const file = { data: term, status: "ok" as const, checkedAt: CHECKED_AT, diagnostic: null };
  return (courseCode) => {
    const result = courseResult(file, courseCode);
    const answer = result && "sections" in result ? result : null;
    if (!answer) throw new Error(`recorded fixture has no Spring 2027 options for ${courseCode}`);
    return { status: "ready", result: answer };
  };
}

type SectionCatalog = (courseCode: string) => { status: "ready"; result: Record<string, unknown> & { sections: Array<Record<string, unknown>> } };

function courseSectionsOf(code: string): Record<string, unknown> | null {
  const term = parseTerm(structuredClone(fixture), "spring-2027");
  const file = { data: term, status: "ok" as const, checkedAt: CHECKED_AT, diagnostic: null };
  const result = courseResult(file, code);
  return result && "sections" in result ? (result as Record<string, unknown>) : null;
}

function modeSections() {
  const codes = Object.keys(fixture.courses).sort();
  const responses: Record<string, unknown> = {};
  for (const code of codes) {
    const sections = courseSectionsOf(code);
    if (sections) responses[`/api/sections/spring-2027/${code.replace(" ", "/")}`] = sections;
  }
  process.stdout.write(JSON.stringify({ source: "frontend/tests/optimizer/scenarios/fixtures/spring-2027-trimmed.json", responses }));
}

/** A returned schedule in readable terms, plus its constraint check against the reference. */
function describe(request: ReturnType<typeof buildOptimizeRequest>, schedule: { byCourse: Record<string, string>; cost: number; breakdown: object }) {
  const chosen = request.courses.map((course) => {
    const section = course.sections.find((s) => s.id === schedule.byCourse[course.code]);
    if (!section) throw new Error(`schedule picks ${course.code} ${schedule.byCourse[course.code]}, which is not a candidate section`);
    return section;
  });
  const problems = violations(request, chosen);
  return {
    cost: schedule.cost,
    breakdown: schedule.breakdown,
    byCourse: schedule.byCourse,
    sections: chosen.map((section) => ({
      courseCode: section.courseCode,
      label: section.label ?? section.id,
      rating: section.rating,
      meetings: section.meetings.map((m) => `${m.day} ${Math.floor(m.start / 60)}:${String(m.start % 60).padStart(2, "0")}-${Math.floor(m.end / 60)}:${String(m.end % 60).padStart(2, "0")}`),
    })),
    violations: problems,
  };
}

/** How many courses two schedules put at different meeting times (the diversity rule's own count). */
function differingCourses(a: Record<string, string[]>, b: Record<string, string[]>): number {
  let different = 0;
  for (const [code, meetings] of Object.entries(a)) {
    const other = b[code];
    if (!other || other.join("|") !== meetings.join("|")) different += 1;
  }
  for (const code of Object.keys(b)) if (!a[code]) different += 1;
  return different;
}

function timePatterns(request: ReturnType<typeof buildOptimizeRequest>, byCourse: Record<string, string>): Record<string, string[]> {
  const patterns: Record<string, string[]> = {};
  for (const course of request.courses) {
    const section = course.sections.find((s) => s.id === byCourse[course.code]);
    if (section) {
      patterns[course.code] = section.meetings.map((m) => `${m.day}-${m.start}-${m.end}-${m.dates ? `${m.dates.start}..${m.dates.end}` : ""}`).sort();
    }
  }
  return patterns;
}

function modeSolve(statePath: string, prefsPath: string) {
  const state = normalizePlannerState(JSON.parse(readFileSync(statePath, "utf8")));
  const stored = JSON.parse(readFileSync(prefsPath, "utf8"));
  const preferences = parseSchedulePreferences(stored.preferences ?? stored);
  if (!preferences) throw new Error("the captured preferences did not parse (parseSchedulePreferences returned null)");

  const catalog = fixtureCatalog();
  const request = buildOptimizeRequest(state, preferences, { catalog });
  const plain = toPlainRequest(request);

  // The exact run the Week page's worker performs, budget for budget.
  const replies: Array<{ phase: string; result: ReturnType<typeof optimize> }> = [];
  runJob({ id: 1, request: plain }, { optimize: (r) => optimize(r), post: (reply) => replies.push(reply as { phase: string; result: ReturnType<typeof optimize> }) });
  const final = replies.at(-1);
  if (!final) throw new Error("the optimizer job posted no reply");
  const result = final.result;

  const engineInput = fromPlainRequest(plain, 3000);
  const ref = referenceTopK(engineInput);

  const engineOptions = result.schedules.map((schedule) => describe(engineInput, schedule));
  const referenceOptions = ref.schedules.map((schedule) => describe(engineInput, schedule));

  const enginePatterns = engineOptions.map((_, index) => timePatterns(engineInput, result.schedules[index].byCourse));
  const pairDifferences: Array<{ a: number; b: number; differentCourses: number }> = [];
  for (let i = 1; i < enginePatterns.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      pairDifferences.push({ a: j, b: i, differentCourses: differingCourses(enginePatterns[j], enginePatterns[i]) });
    }
  }

  process.stdout.write(
    JSON.stringify(
      {
        planCourses: engineInput.courses.map((c) => c.code),
        fixedCredits: engineInput.fixedCredits,
        locks: engineInput.locks,
        combinations: combinationCount(engineInput),
        phases: replies.map((reply) => ({ phase: reply.phase, status: reply.result.status, schedules: reply.result.schedules.length })),
        engine: {
          status: result.status,
          minDifferentCourses: result.stats.minDifferentCourses,
          costs: result.schedules.map((s) => s.cost),
          options: engineOptions,
        },
        reference: {
          feasible: referenceFeasible(engineInput),
          minDifferent: ref.minDifferent,
          costs: ref.schedules.map((s) => s.cost),
          options: referenceOptions,
        },
        optionPairDifferences: pairDifferences,
      },
      null,
      2,
    ),
  );
}

const [mode, ...args] = process.argv.slice(2);
if (mode === "sections") modeSections();
else if (mode === "solve") modeSolve(args[0], args[1]);
else {
  console.error("usage: bun solver.ts sections | solve <state.json> <prefs.json>");
  process.exit(2);
}
