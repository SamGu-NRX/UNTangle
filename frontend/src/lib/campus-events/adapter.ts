/**
 * The ICS adapter: fetches one directory feed through the SSRF-safe
 * calendar-feeds fetcher and normalizes every occurrence in range into the
 * one event shape. Nothing else here touches the network.
 */

import { fetchCalendarIcs } from "@/lib/calendar-feeds/fetch";
import { parseCalendarFeed } from "@/lib/calendar-feeds/parse";
import type { ParseRange } from "@/lib/calendar-feeds/types";
import { resolveEventBuilding } from "./buildings";
import type { EventSourceDef } from "./sources";
import type { NormalizedEvent } from "./types";

/** Deps a test can replace so the adapter never touches the network. */
export type AdapterDeps = {
  fetchIcs: (url: string) => Promise<string>;
};

export const defaultAdapterDeps: AdapterDeps = {
  fetchIcs: url => fetchCalendarIcs(url),
};

/** Deduplicates tags, keeping first-seen order. */
function mergeTags(tagLists: readonly string[][]): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const list of tagLists) {
    for (const tag of list ?? []) {
      if (tag === "") continue;
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      tags.push(tag);
    }
  }
  return tags;
}

/**
 * Normalizes a parsed feed into events. One normalized event per occurrence:
 * a recurring series appears once per time it occurs, which is what a
 * "what's happening" list shows. Occurrences are sorted by start, then title.
 */
export function normalizeIcsFeed(icsText: string, range: ParseRange, source: EventSourceDef): NormalizedEvent[] {
  const parsed = parseCalendarFeed(icsText, range);
  const events: NormalizedEvent[] = [];
  for (const occurrence of parsed.occurrences) {
    const event = parsed.events[occurrence.eventId];
    if (event === undefined) continue;
    events.push({
      sourceId: source.id,
      url: event.url,
      title: event.summary,
      start: occurrence.start,
      end: occurrence.end,
      isAllDay: event.isAllDay,
      location: event.location,
      buildingId: resolveEventBuilding(event.location),
      tags: mergeTags([event.categories, [source.category]]),
    });
  }
  events.sort((a, b) => (a.start === b.start ? a.title.localeCompare(b.title) : a.start.localeCompare(b.start)));
  return events;
}

/** Fetches one source and normalizes it. Throws when the fetch or parse fails. */
export async function fetchSourceEvents(
  source: EventSourceDef,
  range: ParseRange,
  deps: AdapterDeps = defaultAdapterDeps,
): Promise<NormalizedEvent[]> {
  const icsText = await deps.fetchIcs(source.url);
  return normalizeIcsFeed(icsText, range, source);
}
