/**
 * The term the plan schedules, read from UNT's registrar calendars in
 * lib/terms/terms.ts, the one source of term dates every slice reads. One
 * term until named schedules carry their own.
 */
import { getTermCalendar, type Session, type TermKey } from "./terms/terms";

export * from "./terms/terms";

export type Term = {
  name: string;
  /** Short form for tight spaces such as the phone header. */
  shortName: string;
  /** First and last day of regular classes, inclusive, as YYYY-MM-DD. */
  start: string;
  end: string;
};

/** A term's full-semester session; throws when the calendar doesn't have one. */
export function fullSession(term: TermKey): Session {
  const session = getTermCalendar(term)?.sessions.find((entry) => entry.kind === "full");
  if (!session) throw new Error(`lib/terms/terms.ts has no full session for ${term}`);
  return session;
}

const spring2027 = fullSession("Spring 2027");

/** Spring 2027, the term planned as of October 2026. Its last class day is before finals week. */
export const PLANNING_TERM: Term = {
  name: "Spring 2027",
  shortName: "Spring 27",
  start: spring2027.classesBegin,
  end: spring2027.classesEnd ?? spring2027.sessionEnd,
};
