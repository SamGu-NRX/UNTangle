/**
 * Busy time from connected calendars, between the busy route's dated pieces
 * and what Auto and the week grid read.
 *
 * A calendar keeps its busy time compactly, one slot per distinct start and
 * end with the dates it falls on (CalendarSchema in packages/contracts), so a
 * weekly shift over a term is one slot, not sixteen pieces. Auto receives
 * each slot as dated blocked times, one per weekday, so a busy piece only
 * rules out sections that meet on its date (blockConflicts in
 * lib/optimizer/prepare.ts). docs/architecture/README.md, "Auto and
 * calendars": calendar events are dated occurrences over the term's real
 * dates, never weekly approximations.
 */
import type { OptBlockedTime, OptDay } from "@/lib/optimizer/types";
import type { BlockedTime, CalendarBusySlot, ConnectedCalendar, WeekDay } from "@/lib/types";

export { MAX_CALENDARS } from "../../../packages/contracts/src/documents";

/** One dated busy piece, as the busy route serializes it (calendar-feeds/busy-serialize.ts). */
export type BusyPiece = { date: string; startMinutes: number; endMinutes: number; allDay?: boolean };

const WEEKDAY: readonly OptDay[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The weekday an ISO date falls on. */
export function weekdayOf(date: string): OptDay {
  return WEEKDAY[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

/**
 * Pieces grouped into the stored slots: slots in start-then-end order, each
 * with its dates ascending and once. Pieces outside `term` (inclusive ISO
 * dates) are dropped.
 */
export function slotsFromPieces(pieces: readonly BusyPiece[], term?: { start: string; end: string }): CalendarBusySlot[] {
  const slots = new Map<string, { start: number; end: number; dates: Set<string> }>();
  for (const piece of pieces) {
    if (term && (piece.date < term.start || piece.date > term.end)) continue;
    if (piece.endMinutes <= piece.startMinutes) continue;
    const key = `${piece.startMinutes}-${piece.endMinutes}`;
    const slot = slots.get(key) ?? { start: piece.startMinutes, end: piece.endMinutes, dates: new Set<string>() };
    slot.dates.add(piece.date);
    slots.set(key, slot);
  }
  return [...slots.values()]
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .map((slot) => ({ start: slot.start, end: slot.end, dates: [...slot.dates].sort() }));
}

/** How many busy pieces a calendar holds: one per slot and date. */
export const busyCount = (calendar: Pick<ConnectedCalendar, "busy">) => calendar.busy.reduce((sum, slot) => sum + slot.dates.length, 0);

/** The calendar's busy time as Auto reads it: its timed slots, plus a whole-day slot for its all-day dates when they count. */
export function countedSlots(calendar: Pick<ConnectedCalendar, "busy" | "allDayDates" | "countAllDay">): CalendarBusySlot[] {
  if (!calendar.countAllDay || calendar.allDayDates.length === 0) return calendar.busy;
  // A timed piece already filling the whole day merges with the all-day dates rather than repeating a slot.
  const whole = calendar.busy.find((slot) => slot.start === 0 && slot.end === 24 * 60);
  const rest = calendar.busy.filter((slot) => slot !== whole);
  const dates = [...new Set([...(whole?.dates ?? []), ...calendar.allDayDates])].sort();
  return [...rest, { start: 0, end: 24 * 60, dates }];
}

/**
 * The timed pieces as slots, and the all-day pieces as the dates they fall
 * on, each inside `term`: what a connected calendar keeps.
 */
export function readingOf(pieces: readonly BusyPiece[], term: { start: string; end: string }): { busy: CalendarBusySlot[]; allDayDates: string[] } {
  return {
    busy: slotsFromPieces(
      pieces.filter((piece) => !piece.allDay),
      term,
    ),
    allDayDates: [...new Set(pieces.filter((piece) => piece.allDay && piece.date >= term.start && piece.date <= term.end).map((piece) => piece.date))].sort(),
  };
}

/** Calendars whose busy time was read for `termId`; the others wait for a refresh. */
export const calendarsFor = (calendars: readonly ConnectedCalendar[] | undefined, termId: string) =>
  (calendars ?? []).filter((calendar) => calendar.termId === termId);

/**
 * The calendars' busy time for one term as dated blocked times: one per
 * calendar, weekday and slot, named after the calendar and carrying only
 * dates inside `term`. Ids are `calendar-<id>-<day>-<start>-<end>`, so they
 * are stable across reads and never collide with a hand-made busy time's.
 */
export function calendarBlockedTimes(
  calendars: readonly ConnectedCalendar[] | undefined,
  termId: string,
  term: { start: string; end: string } | null,
): OptBlockedTime[] {
  return calendarsFor(calendars, termId).flatMap((calendar) =>
    countedSlots(calendar).flatMap((slot) => {
      const byDay = new Map<OptDay, string[]>();
      for (const date of slot.dates) {
        if (term && (date < term.start || date > term.end)) continue;
        const day = weekdayOf(date);
        byDay.set(day, [...(byDay.get(day) ?? []), date]);
      }
      return [...byDay].map(([day, dates]) => ({
        id: `calendar-${calendar.id}-${day}-${slot.start}-${slot.end}`,
        label: calendar.name,
        day,
        start: slot.start,
        end: slot.end,
        dates: dates.map((date) => ({ start: date, end: date })),
      }));
    }),
  );
}

/** One calendar's busy time on one weekday of the week grid: overlapping slots joined, with the dates they cover. */
export type CalendarBand = { calendarId: string; name: string; day: OptDay; start: number; end: number; dates: string[] };

/**
 * What the week grid draws for the calendars: per calendar and weekday, the
 * busy minutes joined where they overlap, each band with the distinct dates
 * it holds. The grid shows a typical week, so a band says how many of the
 * term's weeks it falls in rather than drawing each date.
 */
export function calendarBands(
  calendars: readonly ConnectedCalendar[] | undefined,
  termId: string,
  term: { start: string; end: string } | null,
): CalendarBand[] {
  const bands: CalendarBand[] = [];
  for (const calendar of calendarsFor(calendars, termId)) {
    // This calendar's spans per weekday, each with the dates it holds there.
    const byDay = new Map<OptDay, Array<{ start: number; end: number; dates: string[] }>>();
    for (const block of calendarBlockedTimes([calendar], termId, term)) {
      const day = block.day;
      byDay.set(day, [...(byDay.get(day) ?? []), { start: block.start, end: block.end, dates: (block.dates ?? []).map((range) => range.start) }]);
    }
    for (const day of WEEKDAY) {
      let open: CalendarBand | null = null;
      for (const span of (byDay.get(day) ?? []).sort((a, b) => a.start - b.start)) {
        if (open && span.start <= open.end) {
          open.end = Math.max(open.end, span.end);
          open.dates = [...new Set([...open.dates, ...span.dates])].sort();
        } else {
          open = { calendarId: calendar.id, name: calendar.name, day, start: span.start, end: span.end, dates: span.dates };
          bands.push(open);
        }
      }
    }
  }
  return bands;
}

/** How many times `day` falls in the term (inclusive ISO dates). */
export function weekdayCount(day: OptDay, term: { start: string; end: string }): number {
  const first = Date.parse(`${term.start}T00:00:00Z`) / 86_400_000;
  const last = Date.parse(`${term.end}T00:00:00Z`) / 86_400_000;
  const target = WEEKDAY.indexOf(day);
  // Epoch day 0 was a Thursday, index 4 counting from Sunday.
  const firstMatch = first + ((target - ((first + 4) % 7) + 7) % 7);
  return firstMatch > last ? 0 : Math.floor((last - firstMatch) / 7) + 1;
}

/* ───────── Connecting: the shapes lib/calendar-feeds/client.ts returns ───────── */

/** The planning term: its id, its name, and its first and last day (inclusive ISO dates). */
export type FeedTerm = { id: string; label: string; start: string; end: string };

/** Why a check, connect or refresh failed, in words the student can act on. */
export type FeedProblem = {
  kind: "address" | "unreachable" | "too-big" | "busy" | "unavailable" | "reconnect" | "sign-in" | "offline";
  message: string;
};

export type FeedEvent = {
  /** A stable key for this occurrence within the check. */
  key: string;
  summary: string;
  date: string;
  day: WeekDay;
  start: number;
  end: number;
};

export type CheckedFeed = {
  /** Busy pieces in the term, as connecting would store them. */
  busyCount: number;
  /**
   * How many busy all-day events fall in the term. They are left out of busy
   * time unless the student counts them: one busy all-day date rules out
   * every full-term class on its weekday.
   */
  allDayEvents: number;
  /** Timed weekday occurrences in the term, by date: what one event can become. */
  events: FeedEvent[];
};

export type Outcome<T> = { ok: true; value: T } | { ok: false; problem: FeedProblem };

/**
 * One event as a named busy time on its date only (research section 6).
 * Auto rules out a section that meets at that time on that date, which is
 * every section running all term on that weekday; a section whose weeks
 * miss the date stays open. The id comes
 * from the date and time, so blocking the same event twice is refused as a
 * duplicate.
 */
export function eventBusyTime(event: FeedEvent): BlockedTime {
  return {
    id: `event-${event.date}-${event.start}-${event.end}`,
    label: event.summary.slice(0, 40),
    day: event.day,
    start: event.start,
    end: event.end,
    dates: [{ start: event.date, end: event.date }],
  };
}

/* ───────── Reading connected calendars again ───────── */

/**
 * A calendar is read again when Week opens and its busy time is older than
 * this, or was read for another term. Six hours is a starting value with
 * nothing measured behind it: often enough that a new shift shows the same
 * day, rarely enough that Week doesn't refetch on every visit.
 */
export const CALENDAR_STALE_MS = 6 * 60 * 60 * 1000;

/** The calendars to read again now: stale or for another term, and not tried already during this visit. */
export function calendarsToRefresh(
  calendars: readonly ConnectedCalendar[] | undefined,
  termId: string,
  now: number,
  tried: ReadonlySet<string>,
): ConnectedCalendar[] {
  return (calendars ?? []).filter(
    (calendar) => !tried.has(calendar.id) && (calendar.termId !== termId || now - Date.parse(calendar.checkedAt) > CALENDAR_STALE_MS),
  );
}

/**
 * The preferences with one calendar's fresh reading: its busy time, term,
 * read time and (when the server upgraded it) sealed address, onto the
 * calendar as it is now, so a rename or an all-day choice made meanwhile
 * stays. A calendar
 * removed meanwhile, or connected again under another address, is left as it
 * is: the reading belonged to the one that was there.
 */
export function withReading<P extends { calendars?: ConnectedCalendar[] }>(preferences: P, read: ConnectedCalendar, reading: ConnectedCalendar): P {
  if (!preferences.calendars?.some((calendar) => calendar.id === read.id && calendar.sealedUrl === read.sealedUrl)) return preferences;
  return {
    ...preferences,
    calendars: preferences.calendars.map((calendar) =>
      calendar.id === read.id && calendar.sealedUrl === read.sealedUrl
        ? {
            ...calendar,
            busy: reading.busy,
            allDayDates: reading.allDayDates,
            termId: reading.termId,
            checkedAt: reading.checkedAt,
            sealedUrl: reading.sealedUrl,
          }
        : calendar,
    ),
  };
}
