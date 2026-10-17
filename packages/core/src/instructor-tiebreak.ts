/**
 * The instructor tie-break: when two schedules tie on the optimizer's
 * primary score (hard limits, then preferences), the one whose instructors
 * have stronger grade-history evidence ranks first.
 *
 * The rule from docs/architecture/README.md: when some options in a course
 * lack accepted evidence, that course's grade term is left out for every
 * option. Missing evidence is never read as zero or as an average. The
 * course is left out for the whole comparison, judged over all of the
 * course's options, not just the two schedules at hand. A rule judged pair
 * by pair can rank A over B, B over C and C over A, and the search needs a
 * consistent order.
 *
 * Grade history never goes into the optimizer's generic `rating` weight.
 */

/**
 * One option's evidence about its instructor.
 *
 * "known" carries the mean grade points of the instructor's past students in
 * this course, in hundredths (3.27 is 327), from 0 to 400. Whole hundredths
 * keep sums exact, so two schedules whose evidence adds up to the same
 * number tie exactly. The caller rounds and decides what counts as accepted
 * evidence (a confident instructor match with enough graded sections).
 *
 * "unknown" is every other case: no match, too few graded sections, or
 * history that couldn't be read.
 */
export type InstructorEvidence = { kind: "known"; meanGradePointsHundredths: number } | { kind: "unknown" };

/** Every option of one course that the schedules may pick, by option id. */
export type CourseEvidence = {
  courseCode: string;
  options: Readonly<Record<string, InstructorEvidence>>;
};

/** One schedule: course code to the option id it picks, one pick per course. */
export type SchedulePicks = Readonly<Record<string, string>>;

/**
 * Negative when `a` ranks before `b` on instructor evidence, positive when
 * after, 0 when the evidence doesn't separate them (the caller then falls
 * back to its own tie-break, such as section ids).
 */
export type ScheduleComparator = (a: SchedulePicks, b: SchedulePicks) => number;

/**
 * Per course, after the omit rule: whether the course's evidence counts at
 * all, and each option's contribution to the tie-break.
 */
export type EvidenceContributions = Readonly<
  Record<
    string,
    {
      /** True when every option the course lists carries accepted evidence. */
      readonly counted: boolean;
      /** Option id -> contribution in whole hundredths: the option's own evidence when the course counts, else 0 for every option. */
      readonly options: Readonly<Record<string, number>>;
    }
  >
>;

/**
 * Every option's evidence contribution, applying the omit rule once: a
 * course whose options all carry accepted evidence contributes each option's
 * own hundredths; a course with any option without evidence contributes 0
 * for every option, so its sections can never decide a tie
 * (docs/architecture/README.md). The engine prepares its per-option values
 * here, and reasons quotes them, so the rule is implemented once.
 *
 * Throws on a course listed twice, a course with no options, or evidence
 * that isn't a whole number from 0 to 400.
 */
export function instructorEvidenceContributions(courses: readonly CourseEvidence[]): EvidenceContributions {
  const courseCodes = new Set<string>();
  const out: Record<string, { counted: boolean; options: Record<string, number> }> = {};
  for (const { courseCode, options } of courses) {
    if (courseCodes.has(courseCode)) throw new Error(`Duplicate course: ${courseCode}`);
    courseCodes.add(courseCode);
    const entries = Object.entries(options);
    if (entries.length === 0) throw new Error(`Course ${courseCode} has no options`);
    const counted = entries.every(([, evidence]) => evidence.kind === "known");
    const values: Record<string, number> = {};
    for (const [optionId, evidence] of entries) {
      if (evidence.kind === "unknown") {
        values[optionId] = 0;
        continue;
      }
      const value = evidence.meanGradePointsHundredths;
      if (!Number.isInteger(value) || value < 0 || value > 400) {
        throw new Error(`Course ${courseCode}, option ${optionId}: evidence must be whole hundredths from 0 to 400`);
      }
      values[optionId] = counted ? value : 0;
    }
    out[courseCode] = { counted, options: values };
  }
  return out;
}

/**
 * Builds the comparator for one optimizer request from every option of every
 * course in it: the schedule with the larger sum of its picks'
 * `instructorEvidenceContributions` ranks first. With no counted course,
 * every pair ties.
 *
 * The comparator is a strict weak order on the schedules of the request
 * (irreflexive, antisymmetric, transitive, with transitive ties), and its
 * answers don't depend on the order courses or options are listed.
 *
 * Throws like `instructorEvidenceContributions`. The comparator throws on a
 * schedule that misses a course, adds one, or picks an option the course
 * doesn't list. It never compares schedules it can't account for.
 */
export function instructorTiebreak(courses: readonly CourseEvidence[]): ScheduleComparator {
  const contributions = instructorEvidenceContributions(courses);
  const courseCodes = new Set(Object.keys(contributions));
  const byCourse = courses.map(({ courseCode }) => ({ courseCode, options: contributions[courseCode].options }));

  function score(picks: SchedulePicks): number {
    for (const courseCode of Object.keys(picks)) {
      if (!courseCodes.has(courseCode)) throw new Error(`Schedule adds course: ${courseCode}`);
    }
    let total = 0;
    for (const { courseCode, options } of byCourse) {
      if (!Object.hasOwn(picks, courseCode)) throw new Error(`Schedule misses course: ${courseCode}`);
      const optionId = picks[courseCode];
      const contribution = options[optionId];
      if (contribution === undefined) throw new Error(`Course ${courseCode}: unknown option ${optionId}`);
      total += contribution;
    }
    return total;
  }

  return (a, b) => {
    const aScore = score(a);
    const bScore = score(b);
    return bScore - aScore;
  };
}
