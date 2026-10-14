/**
 * Stand-in for PR #48's `TERMS` (lib/terms/terms.ts), in the same shape and
 * holding only what the calendar file reads. The Spring 2027 values are
 * copied from #48, which transcribed them from
 * https://registrar.unt.edu/registration/spring-academic-calendar.html on
 * 2026-10-13. When #48 merges, term-dates.ts imports `TERMS` from
 * "@/lib/terms/terms" instead and this file is deleted.
 */

export type IsoDate = string;

export type TermCalendar = {
  term: string;
  sessions: Array<{
    kind: string;
    classesBegin: IsoDate;
    /** Last regular class meeting; null until the registrar publishes it. */
    classesEnd: IsoDate | null;
    sessionEnd: IsoDate;
  }>;
  /** Inclusive no-class ranges. */
  holidays: Array<{ name: string; begin: IsoDate; end: IsoDate }>;
};

export const TERMS: readonly TermCalendar[] = [
  {
    term: "Spring 2027",
    sessions: [{ kind: "full", classesBegin: "2027-01-11", classesEnd: "2027-04-29", sessionEnd: "2027-05-07" }],
    holidays: [
      { name: "Winter Break", begin: "2026-12-24", end: "2027-01-01" },
      { name: "Martin Luther King Jr. Holiday", begin: "2027-01-18", end: "2027-01-18" },
      { name: "Spring Break", begin: "2027-03-08", end: "2027-03-14" },
    ],
  },
];
