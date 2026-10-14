/**
 * The term the plan schedules, and when its classes meet. One term until
 * named schedules carry their own.
 */
export type Term = {
  name: string;
  /** Short form for tight spaces such as the phone header. */
  shortName: string;
  /** First and last day of classes, inclusive, as YYYY-MM-DD. */
  start: string;
  end: string;
};

/**
 * Spring 2027 dates as the v3 build order gives them (HANDOFF.md §6). They
 * have not been checked against UNT's published academic calendar.
 */
export const PLANNING_TERM: Term = {
  name: "Spring 2027",
  shortName: "Spring 27",
  start: "2027-01-19",
  end: "2027-05-07",
};
