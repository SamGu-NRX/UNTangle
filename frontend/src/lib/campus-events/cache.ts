/**
 * The per-source TTL cache behind the events API. Each source refreshes on
 * its own interval (30 minutes for directory feeds), one failing source
 * never fails the response, and a failed refresh serves the last good data
 * as "stale" and backs off for the interval instead of retrying on every
 * request. The cache stores each source's raw feed text and parses it for
 * the requested range, so any range the API accepts is served from one
 * fetch. Fetches are concurrency-capped out of politeness to
 * calendar.unt.edu, whose robots.txt asks crawl bots for a 1-second delay.
 */

import { defaultAdapterDeps, normalizeIcsFeed, type AdapterDeps } from "./adapter";
import type { EventSourceDef } from "./sources";
import type { NormalizedEvent, SourceReport, SourceStatus } from "./types";

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
  /** The raw feed text from the last successful fetch; parsed per request. */
  icsText: string | null;
  /** When the served text was fetched; null when there is none. */
  fetchedAtMs: number | null;
  /** When the last refresh attempt ran, successful or not. */
  attemptedAtMs: number | null;
  /** The last error message; null after a successful fetch. */
  error: string | null;
};

/**
 * One cache per process. `getEvents` serves every source whose last attempt
 * is younger than its interval from the cached text and refetches the rest,
 * so a request's latency is one refresh pass at most and the upstream sees
 * each feed no more often than its interval — even when the feed is failing.
 */
export class EventSourceCache {
  private readonly entries = new Map<string, SourceEntry>();
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    private readonly sources: readonly EventSourceDef[],
    private readonly deps: CacheDeps = defaultCacheDeps,
  ) {}

  /** A source whose last attempt is younger than its interval waits, even after a failure. */
  private attemptedRecently(source: EventSourceDef, nowMs: number): boolean {
    const entry = this.entries.get(source.id);
    if (entry === undefined || entry.attemptedAtMs === null) return false;
    return nowMs - entry.attemptedAtMs < source.refreshIntervalMs;
  }

  private async refreshSource(source: EventSourceDef, nowMs: number): Promise<void> {
    try {
      const icsText = await this.deps.fetchIcs(source.url);
      this.entries.set(source.id, { icsText, fetchedAtMs: nowMs, attemptedAtMs: nowMs, error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const existing = this.entries.get(source.id);
      // Keep serving the last good text as stale; the failed attempt still
      // counts against the interval, so a dead feed is retried at most once
      // per interval instead of on every request.
      this.entries.set(source.id, {
        icsText: existing?.icsText ?? null,
        fetchedAtMs: existing?.fetchedAtMs ?? null,
        attemptedAtMs: nowMs,
        error: message,
      });
    }
  }

  /** Refetches every source past its backoff window, bounded concurrency. */
  private async refreshStale(nowMs: number): Promise<void> {
    const stale = this.sources.filter(source => !this.attemptedRecently(source, nowMs));
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < stale.length) {
        const source = stale[cursor];
        cursor += 1;
        if (source === undefined) break;
        // A concurrent worker may have refreshed this source while this one waited.
        if (this.attemptedRecently(source, nowMs)) continue;
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

  /**
   * The events of every source that has data, parsed from the cached text
   * for exactly the requested range, with one report per source. Any range
   * the API accepts is served from the last fetch; no fetch misses its
   * events because of a cached window.
   */
  async getEvents(range: { from: string; to: string }): Promise<{ events: NormalizedEvent[]; reports: SourceReport[] }> {
    const nowMs = this.deps.now();
    await this.refreshStale(nowMs);
    const parseRange = { start: range.from, end: range.to };
    const events: NormalizedEvent[] = [];
    const reports: SourceReport[] = [];
    for (const source of this.sources) {
      const entry = this.entries.get(source.id);
      const cached = entry?.icsText ?? null;
      let status: SourceStatus = "error";
      let eventCount = 0;
      let error = entry?.error ?? null;
      if (cached !== null) {
        // The text is parsed on every request, so a body the parser rejects
        // must fail only its own source, not every request until the next refresh.
        try {
          const normalized = normalizeIcsFeed(cached, parseRange, source);
          events.push(...normalized);
          eventCount = normalized.length;
          status = entry!.error === null ? "ok" : "stale";
        } catch (parseError) {
          error = `the cached feed does not parse: ${parseError instanceof Error ? parseError.message : String(parseError)}`;
        }
      }
      reports.push({
        id: source.id,
        name: source.name,
        status,
        fetchedAt: entry?.fetchedAtMs != null ? new Date(entry.fetchedAtMs).toISOString() : null,
        eventCount,
        error,
      });
    }
    events.sort((a, b) => (a.start === b.start ? a.title.localeCompare(b.title) : a.start.localeCompare(b.start)));
    return { events, reports };
  }
}
