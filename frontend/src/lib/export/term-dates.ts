/**
 * What the calendar file needs to know about a term, from the registrar's
 * calendars (lib/terms/terms.ts): when weekly classes start and stop, its
 * sessions (so an eight-week class is checked against its own), and the
 * named breaks the Export dialog mentions. Which days have class is asked of
 * `classDayStatus` itself, day by day.
 */
import { TERMS, type IsoDate } from "@/lib/terms/terms";

export type TermDates = {
  term: string;
  /** The full-semester session, which answers for meetings without dates of their own. */
  sessionId: string;
  /** First and last day of regular classes, inclusive. Finals week is not a weekly class. */
  first: IsoDate;
  last: IsoDate;
  sessions: ReadonlyArray<{ id: string; begin: IsoDate; end: IsoDate }>;
  /** Named no-class ranges inside the term, such as spring break. */
  breaks: Array<{ name: string; begin: IsoDate; end: IsoDate }>;
};

/** The term's dates ("Spring 2027"), or null for a term with no calendar or no full session. */
export function termDatesFor(term: string): TermDates | null {
  const calendar = TERMS.find((entry) => entry.term === term);
  const full = calendar?.sessions.find((session) => session.kind === "full");
  if (!calendar || !full) return null;
  const first = full.classesBegin;
  const last = full.classesEnd ?? full.sessionEnd;
  return {
    term,
    sessionId: full.id,
    first,
    last,
    sessions: calendar.sessions.map((session) => ({ id: session.id, begin: session.classesBegin, end: session.sessionEnd })),
    breaks: calendar.holidays
      .filter((holiday) => holiday.end >= first && holiday.begin <= last)
      .map(({ name, begin, end }) => ({ name, begin, end })),
  };
}
