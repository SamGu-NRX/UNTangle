/**
 * The week's finals as Week shows them: one entry per placed section, in
 * exam order with unknown finals last, each naming the courses whose final
 * overlaps its own. Pure, so the Finals line, the answer and the section
 * rows agree on what clashes.
 */
import type { Section } from "@/lib/sections";
import type { BuilderFinals, ExamSlot, FinalExam } from "./host";

/** Two sittings that share a minute on the same date. Touching ends (10:00 and 10:00) don't. */
export function examsOverlap(a: ExamSlot, b: ExamSlot): boolean {
  return a.date === b.date && a.start < b.end && b.start < a.end;
}

export type WeekFinal = { courseCode: string; section: Section; exam: FinalExam; clashesWith: string[] };

export function weekFinals(sections: readonly Section[], finals: BuilderFinals): WeekFinal[] {
  const exams = sections.map((section) => ({ section, exam: finals.examOf(section) }));
  const order = (exam: FinalExam) => (exam.kind === "known" ? `${exam.exam.date} ${String(exam.exam.start).padStart(4, "0")}` : "~");
  return exams
    .map(({ section, exam }) => ({
      courseCode: section.courseCode,
      section,
      exam,
      clashesWith: exams
        .filter((other) => other.section.courseCode !== section.courseCode && exam.kind === "known" && other.exam.kind === "known" && examsOverlap(exam.exam, other.exam.exam))
        .map((other) => other.section.courseCode),
    }))
    .sort((a, b) => (order(a.exam) < order(b.exam) ? -1 : order(a.exam) > order(b.exam) ? 1 : a.courseCode.localeCompare(b.courseCode)));
}

/** Courses in `week` (other than the section's own) whose final overlaps the section's. */
export function finalClashes(section: Section, week: readonly Section[], finals: BuilderFinals): string[] {
  const own = finals.examOf(section);
  if (own.kind !== "known") return [];
  return week
    .filter((other) => other.courseCode !== section.courseCode)
    .filter((other) => {
      const exam = finals.examOf(other);
      return exam.kind === "known" && examsOverlap(own.exam, exam.exam);
    })
    .map((other) => other.courseCode);
}

/** How many pairs of the week's finals overlap. */
export function finalsClashCount(list: readonly WeekFinal[]): number {
  return list.reduce((sum, entry) => sum + entry.clashesWith.length, 0) / 2;
}

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
const LONG_WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" });
const MONTH_DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const LONG_MONTH_DAY = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" });

const at = (iso: string) => new Date(`${iso}T00:00:00Z`);

function examClock(minutes: number, suffix: boolean): string {
  const hours = Math.floor(minutes / 60);
  const text = `${hours % 12 === 0 ? 12 : hours % 12}:${String(minutes % 60).padStart(2, "0")}`;
  return suffix ? `${text} ${hours >= 12 ? "PM" : "AM"}` : text;
}

/** "8:00 to 10:00 AM", or "10:30 AM to 12:30 PM" when the range crosses noon. */
export function examTimes(exam: ExamSlot): string {
  const sameHalf = exam.start < 12 * 60 === exam.end < 12 * 60;
  return sameHalf ? `${examClock(exam.start, false)} to ${examClock(exam.end, true)}` : `${examClock(exam.start, true)} to ${examClock(exam.end, true)}`;
}

/** "10:30 AM": when a final starts. */
export function examStartTime(exam: ExamSlot): string {
  return examClock(exam.start, true);
}

/** "Mon 10:30 AM": when a final starts, short enough for a pill. Finals week has one of each weekday. */
export function examStart(exam: ExamSlot): string {
  return `${WEEKDAY.format(at(exam.date))} ${examClock(exam.start, true)}`;
}

/** "Mon, May 3": the day of a final, short. */
export function examDay(exam: ExamSlot): string {
  return `${WEEKDAY.format(at(exam.date))}, ${MONTH_DAY.format(at(exam.date))}`;
}

/** "Monday, May 3": the day of a final, for sentences and accessible names. */
export function examLongDay(exam: ExamSlot): string {
  return `${LONG_WEEKDAY.format(at(exam.date))}, ${LONG_MONTH_DAY.format(at(exam.date))}`;
}
