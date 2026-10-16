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
export type BusyPiece = { date: string; startMinutes: number; endMinutes: number };

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
    calendar.busy.flatMap((slot) => {
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
  kind: "address" | "unreachable" | "too-big" | "busy" | "unavailable" | "reconnect" | "offline";
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
  /** Timed weekday occurrences in the term, by date: what one event can become. */
  events: FeedEvent[];
};

export type Outcome<T> = { ok: true; value: T } | { ok: false; problem: FeedProblem };

/**
 * One event as a named busy time on its date only (research section 6):
 * Auto keeps that date free and every other week stays open. The id comes
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
