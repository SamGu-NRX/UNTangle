/**
 * The per-source TTL cache behind the events API. Each source refreshes on
 * its own interval (30 minutes for directory feeds), one failing source
 * never fails the response, and a failed refresh serves the last good data
 * as "stale". Fetches are concurrency-capped out of politeness to
 * calendar.unt.edu, whose robots.txt asks crawl bots for a 1-second delay.
 */

import { defaultAdapterDeps, normalizeIcsFeed, type AdapterDeps } from "./adapter";
import type { EventSourceDef } from "./sources";
import type { NormalizedEvent, SourceReport, SourceStatus } from "./types";

/** How far before the fetch time the parse window starts: one hour of slack. */
const PARSE_WINDOW_BEFORE_MS = 60 * 60 * 1000;
/** How far after the fetch time the parse window reaches: one day past the API's 14-day cap. */
const PARSE_WINDOW_AFTER_MS = 15 * 24 * 60 * 60 * 1000;

export type CacheDeps = AdapterDeps & {
  /** Clock, injectable for tests. */
  now: () => number;
  /** How many sources may refresh at once; bounded out of politeness. */
  concurrency: number;
};

export const defaultCacheDeps: CacheDeps = {
  fetchIcs: url => defaultAdapterDeps.fetchIcs(url),
  now: () => Date.now(),
  concurrency: 4,
};

type SourceEntry = {
  events: NormalizedEvent[] | null;
  fetchedAtMs: number | null;
  error: string | null;
};

/**
 * One cache per process. `getEvents` serves every source whose cached fetch
 * is younger than its interval and refetches the rest, so a request's
 * latency is one refresh pass at most and the upstream sees each feed no
 * more often than its interval.
 */
export class EventSourceCache {
  private readonly entries = new Map<string, SourceEntry>();
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    private readonly sources: readonly EventSourceDef[],
    private readonly deps: CacheDeps = defaultCacheDeps,
  ) {}

  private isFresh(source: EventSourceDef, nowMs: number): boolean {
    const entry = this.entries.get(source.id);
    if (entry === undefined || entry.fetchedAtMs === null || entry.events === null) return false;
    return nowMs - entry.fetchedAtMs < source.refreshIntervalMs;
  }

  private async refreshSource(source: EventSourceDef, nowMs: number): Promise<void> {
    const existing = this.entries.get(source.id);
    const fetchedAtMs = nowMs;
    const range = {
      start: new Date(fetchedAtMs - PARSE_WINDOW_BEFORE_MS).toISOString(),
      end: new Date(fetchedAtMs + PARSE_WINDOW_AFTER_MS).toISOString(),
    };
    try {
      const events = await normalizeIcsFeed(await this.deps.fetchIcs(source.url), range, source);
      this.entries.set(source.id, { events, fetchedAtMs, error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (existing?.events !== undefined && existing?.events !== null) {
        this.entries.set(source.id, { events: existing.events, fetchedAtMs: existing.fetchedAtMs, error: message });
      } else {
        this.entries.set(source.id, { events: null, fetchedAtMs: null, error: message });
      }
    }
  }

  /** Refetches every stale source, bounded concurrency, then serves from cache. */
  private async refreshStale(nowMs: number): Promise<void> {
    const stale = this.sources.filter(source => !this.isFresh(source, nowMs));
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < stale.length) {
        const source = stale[cursor];
        cursor += 1;
        if (source === undefined) break;
        // A concurrent worker may have refreshed this source while this one waited.
        if (this.isFresh(source, nowMs)) continue;
        let pending = this.inFlight.get(source.id);
        if (pending === undefined) {
          pending = this.refreshSource(source, nowMs).finally(() => {
            this.inFlight.delete(source.id);
          });
          this.inFlight.set(source.id, pending);
        }
        await pending;
      }
    };
    const workers = Array.from({ length: Math.max(1, this.deps.concurrency) }, worker);
    await Promise.all(workers);
  }

  /** The events of every source that has data, with one report per source. */
  async getEvents(): Promise<{ events: NormalizedEvent[]; reports: SourceReport[] }> {
    const nowMs = this.deps.now();
    await this.refreshStale(nowMs);
    const events: NormalizedEvent[] = [];
    const reports: SourceReport[] = [];
    for (const source of this.sources) {
      const entry = this.entries.get(source.id);
      const cached = entry?.events ?? null;
      let status: SourceStatus = "error";
      if (cached !== null) {
        status = entry!.error === null ? "ok" : "stale";
        events.push(...cached);
      }
      reports.push({
        id: source.id,
        name: source.name,
        status,
        fetchedAt: entry?.fetchedAtMs != null ? new Date(entry.fetchedAtMs).toISOString() : null,
        eventCount: cached?.length ?? 0,
        error: entry?.error ?? null,
      });
    }
    events.sort((a, b) => (a.start === b.start ? a.title.localeCompare(b.title) : a.start.localeCompare(b.start)));
    return { events, reports };
  }
}
