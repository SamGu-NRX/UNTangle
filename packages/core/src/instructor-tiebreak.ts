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
 * Builds the comparator for one optimizer request from every option of every
 * course in it.
 *
 * A course counts only when every one of its options has known evidence.
 * The schedule with the larger sum of its picks' evidence over the counted
 * courses ranks first. With no counted course, every pair ties.
 *
 * The comparator is a strict weak order on the schedules of the request
 * (irreflexive, antisymmetric, transitive, with transitive ties), and its
 * answers don't depend on the order courses or options are listed.
 *
 * Throws on a course listed twice, a course with no options, or evidence
 * that isn't a whole number from 0 to 400. The comparator throws on a
 * schedule that misses a course, adds one, or picks an option the course
 * doesn't list. It never compares schedules it can't account for.
 */
export function instructorTiebreak(courses: readonly CourseEvidence[]): ScheduleComparator {
  void courses;
  throw new Error("Not built yet: docs/tasks/instructor-tiebreak.md");
}
