/**
 * The one place the calendar file learns a term's dates: when weekly classes
 * start and stop, and which days have none. It reads the registrar's
 * calendar through `TERMS`, so moving to PR #48's sourced calendars is this
 * import line alone.
 */
import { TERMS, type IsoDate } from "./term-calendar-placeholder";

export type TermDates = {
  term: string;
  /** First and last day of regular classes, inclusive. Finals week is not a weekly class. */
  first: IsoDate;
  last: IsoDate;
  /** No-class ranges inside the term, inclusive, such as spring break. */
  breaks: Array<{ name: string; begin: IsoDate; end: IsoDate }>;
};

/** The full-semester session of `term` ("Spring 2027"), or null for a term with no calendar. */
export function termDatesFor(term: string): TermDates | null {
  const calendar = TERMS.find((entry) => entry.term === term);
  const full = calendar?.sessions.find((session) => session.kind === "full");
  if (!calendar || !full) return null;
  const first = full.classesBegin;
  const last = full.classesEnd ?? full.sessionEnd;
  return {
    term,
    first,
    last,
    breaks: calendar.holidays.filter((holiday) => holiday.end >= first && holiday.begin <= last),
  };
}
