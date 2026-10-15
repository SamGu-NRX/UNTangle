/**
 * Fixtures for instructor-tiebreak.test.ts. Option ids follow the app's real
 * form (`vsb:<term>:<course>:<class numbers>`, lib/sections/INTEGRATION.md).
 * Evidence values are invented but plausible: mean grade points in
 * hundredths, the shape a caller derives from grade history after the
 * instructor matcher accepts a match.
 */
import type { CourseEvidence, InstructorEvidence, SchedulePicks } from "../../src/instructor-tiebreak";

const known = (meanGradePointsHundredths: number): InstructorEvidence => ({ kind: "known", meanGradePointsHundredths });
const unknown: InstructorEvidence = { kind: "unknown" };
const option = (course: string, classNumbers: string) => `vsb:spring-2027:${course}:${classNumbers}`;

export const ids = {
  math: { morning: option("MATH 1680", "6862+6863"), afternoon: option("MATH 1680", "6870+6871") },
  csce: { high: option("CSCE 1030", "7101+7102"), low: option("CSCE 1030", "7103+7104"), unmatched: option("CSCE 1030", "7105+7106") },
  engl: { high: option("ENGL 1310", "8201"), low: option("ENGL 1310", "8202"), unmatched: option("ENGL 1310", "8203") },
  hist: { high: option("HIST 2610", "8301"), low: option("HIST 2610", "8302"), unmatched: option("HIST 2610", "8303") },
  psci: { only: option("PSCI 1040", "8401") },
};

/**
 * A request where CSCE, ENGL and HIST each have one option without
 * evidence, so none of them counts; only MATH (every option known) and PSCI
 * (one known option) do.
 *
 * Judged pair by pair instead, these three schedules would form a cycle:
 * B beats A on ENGL, C beats B on HIST, and A beats C on CSCE, each the only
 * course both picks have evidence for.
 *   A = CSCE high, ENGL low, HIST unmatched
 *   B = CSCE unmatched, ENGL high, HIST low
 *   C = CSCE low, ENGL unmatched, HIST high
 */
export const mixedRequest: CourseEvidence[] = [
  { courseCode: "MATH 1680", options: { [ids.math.morning]: known(312), [ids.math.afternoon]: known(287) } },
  {
    courseCode: "CSCE 1030",
    options: { [ids.csce.high]: known(350), [ids.csce.low]: known(250), [ids.csce.unmatched]: unknown },
  },
  {
    courseCode: "ENGL 1310",
    options: { [ids.engl.high]: known(350), [ids.engl.low]: known(250), [ids.engl.unmatched]: unknown },
  },
  {
    courseCode: "HIST 2610",
    options: { [ids.hist.high]: known(350), [ids.hist.low]: known(250), [ids.hist.unmatched]: unknown },
  },
  { courseCode: "PSCI 1040", options: { [ids.psci.only]: known(300) } },
];

/** Every schedule `mixedRequest` allows: 2 x 3 x 3 x 3 x 1 = 54. */
export function everySchedule(request: readonly CourseEvidence[]): SchedulePicks[] {
  return request.reduce<SchedulePicks[]>(
    (partials, course) => partials.flatMap((partial) => Object.keys(course.options).map((id) => ({ ...partial, [course.courseCode]: id }))),
    [{}],
  );
}

/**
 * CSCE has two known options and one unknown; MATH has two known. Schedule
 * "strong" picks the best CSCE instructor and the weaker MATH one; "missing"
 * picks the CSCE option without evidence and the stronger MATH one. With
 * CSCE left out, MATH decides for "missing". Reading the unknown as 0, as
 * 3.00, or as the CSCE options' mean (2.90) would all rank "strong" first.
 */
export const imputationTrap = {
  request: [
    {
      courseCode: "CSCE 1030",
      options: { [ids.csce.high]: known(380), [ids.csce.low]: known(200), [ids.csce.unmatched]: unknown },
    },
    { courseCode: "MATH 1680", options: { [ids.math.morning]: known(290), [ids.math.afternoon]: known(300) } },
  ] satisfies CourseEvidence[],
  strong: { "CSCE 1030": ids.csce.high, "MATH 1680": ids.math.morning },
  missing: { "CSCE 1030": ids.csce.unmatched, "MATH 1680": ids.math.afternoon },
};

/** Two courses where every option is known, for exact sums. */
export const allKnown = (csce: [number, number], math: [number, number]): CourseEvidence[] => [
  { courseCode: "CSCE 1030", options: { [ids.csce.high]: known(csce[0]), [ids.csce.low]: known(csce[1]) } },
  { courseCode: "MATH 1680", options: { [ids.math.morning]: known(math[0]), [ids.math.afternoon]: known(math[1]) } },
];
