import { createSectionsConfig, vsbFileUrl, type SectionsConfig } from "./config";
import { parseVsbSubject } from "./subject";
import { parseVsbTerm, SectionSchemaError, type VsbTerm } from "./vsb";
import type { Diagnostic, Freshness } from "./model";

export type CachedTerm = { data: VsbTerm | null; freshness: Freshness };
type Entry = { data: VsbTerm; checkedAt: number; etag: string | null; lastModified: string | null };
type State = { entry: Entry | null; diagnostic: Diagnostic | null; retryAt: number };
type CacheOptions = {
  terms: readonly string[];
  config?: SectionsConfig;
  fetcher?: (url: string, init: RequestInit) => Promise<Response>;
  now?: () => number;
  ttlMs?: number;
  retryMs?: number;
  retainBackground?: (work: Promise<void>) => void;
};
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Transient fallback proxy cache. vsb owns the files; UNTangle persists no copy. */
export class VsbTermCache {
  private readonly states = new Map<string, State>();
  private readonly flights = new Map<string, Promise<void>>();
  private readonly fetcher: (url: string, init: RequestInit) => Promise<Response>;
  private readonly now: () => number;
  private readonly config: SectionsConfig;
  private readonly ttl: number;
  private readonly retry: number;
  constructor(private readonly options: CacheOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? Date.now;
    this.config = createSectionsConfig(options.config);
    // Policy defaults: recheck large files every 15 minutes and failed requests
    // after one minute. These are not benchmark-derived.
    this.ttl = options.ttlMs ?? 15 * 60_000;
    this.retry = options.retryMs ?? 60_000;
  }
  private refresh(key: string, term: string, subject: string | undefined, state: State): Promise<void> {
    const existing = this.flights.get(key);
    if (existing) return existing;
    const work = this.fetchFile(term, subject, state).finally(() => { this.flights.delete(key); });
    this.flights.set(key, work);
    return work;
  }
  private async fetchFile(term: string, subject: string | undefined, state: State): Promise<void> {
    try {
      const headers = new Headers({ "User-Agent": "UNTangle/1.0 (fallback section proxy; https://github.com/SamGu-NRX/UNTangle)", Accept: "application/json" });
      if (state.entry?.etag) headers.set("If-None-Match", state.entry.etag);
      if (state.entry?.lastModified) headers.set("If-Modified-Since", state.entry.lastModified);
      const response = await this.fetcher(vsbFileUrl(this.config, term, subject), {
        headers, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
      });
      if (subject && response.status === 404) {
        await response.body?.cancel();
        // Dylan's subject endpoint is pending. Reprobe at the normal TTL while
        // requests use the published whole-term file through this proxy.
        state.retryAt = this.now() + this.ttl;
        state.diagnostic = state.entry ? { code: "upstream_error", message: `vsb subject ${subject} in ${term}: HTTP 404` } : null;
        return;
      }
      if (response.status === 304 && state.entry) {
        state.entry = { ...state.entry, checkedAt: this.now(), etag: response.headers.get("etag") ?? state.entry.etag,
          lastModified: response.headers.get("last-modified") ?? state.entry.lastModified };
      } else {
        if (!response.ok) throw new Error(`vsb ${subject ? `subject ${subject} in` : "term"} ${term}: HTTP ${response.status}`);
        const raw: unknown = await response.json();
        state.entry = { data: subject ? parseVsbSubject(raw, term, subject) : parseVsbTerm(raw, term), checkedAt: this.now(),
          etag: response.headers.get("etag"), lastModified: response.headers.get("last-modified") };
      }
      state.diagnostic = null;
      state.retryAt = 0;
    } catch (error) {
      state.diagnostic = { code: error instanceof SectionSchemaError ? "schema_error" : "upstream_error", message: message(error) };
      state.retryAt = this.now() + this.retry;
    }
  }
  async get(term: string, requestedSubject?: string): Promise<CachedTerm> {
    if (!this.options.terms.includes(term)) return { data: null, freshness: { status: "unavailable", checkedAt: null, updatedAt: null,
      diagnostic: { code: "upstream_error", message: `No vsb source configured for term ${term}` } } };
    const subject = this.config.fileLayout === "subject-first" ? requestedSubject : undefined;
    const key = subject ? `${term}/${subject}` : term;
    let state = this.states.get(key);
    if (!state) { state = { entry: null, diagnostic: null, retryAt: 0 }; this.states.set(key, state); }
    const expired = !state.entry || this.now() - state.entry.checkedAt >= this.ttl;
    if (expired && this.now() >= state.retryAt) {
      const work = this.refresh(key, term, subject, state);
      if (state.entry) this.options.retainBackground?.(work);
      else await work;
    }
    const entry = state.entry;
    if (subject && !entry) {
      const fallback = await this.get(term);
      return { ...fallback, freshness: { ...fallback.freshness, diagnostic: fallback.freshness.diagnostic ?? state.diagnostic } };
    }
    return { data: entry?.data ?? null, freshness: {
      status: !entry ? "unavailable" : this.now() - entry.checkedAt >= this.ttl ? "stale" : "ok",
      checkedAt: entry ? new Date(entry.checkedAt).toISOString() : null,
      updatedAt: entry?.data.provenance.updated_at ?? null, diagnostic: state.diagnostic,
    } };
  }
}
