"use client";

import { useEffect, useState } from "react";
import type { NormalizedEvent } from "@/lib/campus-events/types";
import { campusDayRange, parseEventsAnswer } from "@/components/map/gap-events";

/**
 * How long one date's answer is reused in this browser session. The server
 * refreshes each feed at most every 30 minutes (lib/campus-events/sources.ts),
 * so asking sooner returns the same events.
 */
const REUSE_MS = 30 * 60_000;

/** Answers by campus date, shared by every visit to Day. A failure is never kept, so the next visit asks again. */
const answers = new Map<string, { events: NormalizedEvent[]; at: number }>();

/**
 * The campus events on one campus date, from GET /api/v1/events. Null while
 * loading, when the feed fails or answers with something else, and when
 * `date` is null; Day shows nothing in each case.
 *
 * An answer that lands while `busy()` says the student is using the list
 * (a selection, or the list scrolled) would push rows in under them, so it
 * is kept for the next time Day shows that date instead (docs/design/do-not.md,
 * "Nothing moves under the student because of background work").
 */
export function useCampusEvents(date: string | null, busy: () => boolean): readonly NormalizedEvent[] | null {
  const [shown, setShown] = useState<{ date: string | null; events: NormalizedEvent[] | null }>({ date: null, events: null });
  if (shown.date !== date) {
    // A new date shows at once what this session already has for it.
    setShown({ date, events: date === null ? null : (answers.get(date)?.events ?? null) });
  }

  useEffect(() => {
    if (date === null) return;
    const cached = answers.get(date);
    if (cached && Date.now() - cached.at < REUSE_MS) return;
    const controller = new AbortController();
    const { from, to } = campusDayRange(date);
    fetch(`/api/v1/events?${new URLSearchParams({ from, to })}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        const events = parseEventsAnswer(payload);
        if (events === null || controller.signal.aborted) return;
        answers.set(date, { events, at: Date.now() });
        if (!busy()) setShown((current) => (current.date === date ? { date, events } : current));
      })
      // An unavailable feed shows nothing in Day; the itinerary stays as it is.
      .catch(() => undefined);
    return () => controller.abort();
    // `busy` is read when the answer lands, not a reason to ask again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  return shown.date === date ? shown.events : null;
}
