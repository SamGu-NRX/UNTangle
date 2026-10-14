/**
 * Dated occurrences: classes and calendar events placed on real dates in
 * the campus time zone, so Auto can check them against each other over a
 * schedule's real date range (docs/architecture/README.md, "Auto and
 * calendars"). Weekly blocks are only an approximation of either.
 *
 * Both functions return pieces. A piece carries the local date and
 * wall-clock minutes, which the week grid draws, and its exact UTC instants.
 * Conflicts compare the instants: on the day a fall-back repeats an hour,
 * the same wall-clock minute happens twice, so minutes alone can't say
 * whether two things overlap.
 */

/** A calendar date, YYYY-MM-DD, read as a plain date in the campus time zone. */
export type IsoDate = string;

/** Every day a class can meet, as frontend/src/lib/sections/model.ts writes them. */
export type ClassDay = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";

/**
 * One weekly meeting: a structural subset of `Meeting` in
 * frontend/src/lib/sections/model.ts, so a parsed section's meetings pass in
 * as they are.
 */
export type WeeklyMeeting = {
  day: ClassDay | null;
  /** Minutes after local midnight; the end may be 1440. */
  startMinutes: number | null;
  endMinutes: number | null;
  /** The meeting's own first and last day, inclusive; nulls when the source gave none. */
  dates: { start: IsoDate | null; end: IsoDate | null };
  async: boolean;
};

/**
 * When one session holds regular weekly classes: the first and last class
 * day, inclusive, and the days it holds none. Finals aren't weekly classes,
 * so `last` is the last regular class day. Pass the calendar of the session
 * the meeting belongs to; frontend/src/lib/terms/terms.ts has them, with
 * each holiday's `appliesTo` already applied.
 */
export type ClassCalendar = {
  first: IsoDate;
  last: IsoDate;
  /** Inclusive no-class ranges: holidays, breaks, reading days. */
  noClass: ReadonlyArray<{ begin: IsoDate; end: IsoDate }>;
};

/** An inclusive range of local dates. */
export type DateRange = { first: IsoDate; last: IsoDate };

/**
 * One piece of an occurrence. A timed piece lies within one local day and
 * one UTC offset: it splits at each local midnight and at each DST change it
 * crosses. So its minutes and instants always agree, and endMinutes is
 * startMinutes plus the minutes that pass. An event from 01:30 CDT to
 * 01:15 CST is two pieces, 90 to 120 (until the clock falls back at 02:00
 * CDT) and 60 to 75.
 */
export type DatedPiece = {
  date: IsoDate;
  /**
   * Wall-clock minutes after local midnight, 0 <= startMinutes < endMinutes
   * <= 1440; a piece that runs to the next midnight ends at 1440.
   */
  startMinutes: number;
  endMinutes: number;
  /** The piece's exact start and end, as Date.prototype.toISOString writes them ("2027-03-04T15:35:00.000Z"). Compare these for conflicts. */
  start: string;
  end: string;
};

/** A class meeting on one date. `meetingIndex` points into the meetings passed in. */
export type MeetingOccurrence = DatedPiece & { meetingIndex: number };

/** A calendar event, or one day of it. */
export type FeedOccurrence = DatedPiece & {
  /** The event's id in the parsed feed. */
  eventId: number;
  allDay: boolean;
  /** False for a TRANSP:TRANSPARENT event, which occurs but never counts as busy time. Tentative events count as busy. */
  busy: boolean;
};

/**
 * What `parseCalendarFeed` in frontend/src/lib/calendar-feeds yields, as far
 * as dates go: its recurrences, EXDATEs and overrides are already expanded
 * into `occurrences`. Timed occurrences are UTC instants; an all-day one runs
 * from midnight UTC of its first date to midnight UTC of its exclusive end
 * date, which names calendar dates, not instants.
 */
export type ParsedFeed = {
  events: ReadonlyArray<{ id: number; isAllDay: boolean; transparent: boolean }>;
  occurrences: ReadonlyArray<{ eventId: number; start: string; end: string; status: "confirmed" | "tentative" }>;
};

/**
 * Every date a section's weekly meetings meet, in `timeZone` (the campus
 * zone, "America/Chicago" for UNT).
 *
 * A meeting meets on each date with its weekday from the later of its own
 * first day and the calendar's first day to the earlier of its own last day
 * and the calendar's last day, skipping no-class days. A meeting without its
 * own dates runs the whole calendar. Meetings without a day and a time
 * (async, TBA) have no dates and yield nothing; the caller reports them
 * separately. Wall-clock minutes stay what the section says across DST; the
 * instants move with the offset.
 *
 * Ordered by start instant, then by meetingIndex. Throws on an invalid time
 * zone or date, a calendar whose last day is before its first, or a timed
 * meeting whose end isn't after its start.
 */
export function meetingOccurrences(
  meetings: readonly WeeklyMeeting[],
  calendar: ClassCalendar,
  timeZone: string,
): MeetingOccurrence[] {
  void meetings;
  void calendar;
  void timeZone;
  throw new Error("Not built yet: docs/tasks/calendar-occurrences.md");
}

/**
 * A parsed calendar feed's occurrences as local pieces in `timeZone`, kept
 * when their date is inside `range`.
 *
 * A timed occurrence splits at each local midnight and each DST change it
 * crosses; one that ends exactly at midnight or at the change adds no empty
 * piece. An all-day occurrence gives one piece per calendar date it names,
 * each 0 to 1440 and never shifted by the zone's offset; it isn't split at a
 * DST change, so on those two days its instants span 23 or 25 hours. An
 * occurrence with no duration gives nothing.
 *
 * Ordered by start instant, then eventId. Throws on an invalid time zone or
 * date, a range whose last day is before its first, or an occurrence whose
 * event isn't in `events`.
 */
export function feedOccurrences(feed: ParsedFeed, range: DateRange, timeZone: string): FeedOccurrence[] {
  void feed;
  void range;
  void timeZone;
  throw new Error("Not built yet: docs/tasks/calendar-occurrences.md");
}
