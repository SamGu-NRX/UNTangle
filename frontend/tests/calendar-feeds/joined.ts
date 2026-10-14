import type { CalendarEvent, CalendarParseResult } from "@/lib/calendar-feeds/types";

function eventFor(result: CalendarParseResult, eventId: number): CalendarEvent {
  const event = result.events[eventId];
  if (event === undefined || event.id !== eventId) throw new Error(`no event entry with id ${eventId}`);
  return event;
}

/** Occurrences joined with their event entries, so assertions can read summaries. */
export function withEvents(result: CalendarParseResult) {
  return result.occurrences.map((occurrence) => ({ ...eventFor(result, occurrence.eventId), ...occurrence }));
}

/** Busy blocks joined with their event's uid and summary. */
export function blocksWithEvents(result: CalendarParseResult) {
  return result.weeklyBusyBlocks.map(({ eventId, weekday, startMinutes, endMinutes }) => {
    const { uid, summary } = eventFor(result, eventId);
    return { uid, summary, weekday, startMinutes, endMinutes };
  });
}
