import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { parseVsbTerm, SectionSchemaError, type VsbTerm } from "./vsb";
import type { Diagnostic, Freshness } from "./model";

export type CachedTerm = { data: VsbTerm | null; freshness: Freshness };
type Entry = {
  raw: unknown; data: VsbTerm; checkedAt: number;
  etag: string | null; lastModified: string | null;
};
type State = { entry: Entry | null; diagnostic: Diagnostic | null; retryAt: number };
type CacheOptions = {
  directory: string;
  terms: readonly string[];
  fetcher?: (url: string, init: RequestInit) => Promise<Response>;
  now?: () => number;
  ttlMs?: number;
  retryMs?: number;
  retainBackground?: (work: Promise<void>) => void;
};
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function optionalHeader(value: unknown): value is string | null { return value === null || typeof value === "string"; }
function decodeEntry(value: unknown, term: string): Entry {
  if (typeof value !== "object" || value === null || !("raw" in value) || !("checkedAt" in value) ||
    !("etag" in value) || !("lastModified" in value) || typeof value.checkedAt !== "number" ||
    !Number.isFinite(value.checkedAt) || !optionalHeader(value.etag) || !optionalHeader(value.lastModified)) {
    throw new Error("invalid sections cache envelope");
  }
  return { raw: value.raw, data: parseVsbTerm(value.raw, term), checkedAt: value.checkedAt, etag: value.etag, lastModified: value.lastModified };
}

export class VsbTermCache {
  private readonly states = new Map<string, Promise<State>>();
  private readonly flights = new Map<string, Promise<void>>();
  private readonly fetcher: (url: string, init: RequestInit) => Promise<Response>;
  private readonly now: () => number;
  private readonly ttl: number;
  private readonly retry: number;
  constructor(private readonly options: CacheOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? Date.now;
    // Policy defaults: each process rechecks a large term file at most every
    // 15 minutes; failures wait one minute. These are not benchmark-derived.
    this.ttl = options.ttlMs ?? 15 * 60_000;
    this.retry = options.retryMs ?? 60_000;
  }
  private async load(term: string): Promise<State> {
    try {
      const raw: unknown = JSON.parse(await readFile(join(this.options.directory, `${term}.json`), "utf8"));
      return { entry: decodeEntry(raw, term), diagnostic: null, retryAt: 0 };
    } catch (error) {
      const absent = typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
      return { entry: null, retryAt: 0, diagnostic: absent ? null : { code: "cache_error", message: message(error) } };
    }
  }
  private refresh(term: string, state: State): Promise<void> {
    const existing = this.flights.get(term);
    if (existing) return existing;
    const work = this.fetchTerm(term, state).finally(() => { this.flights.delete(term); });
    this.flights.set(term, work);
    return work;
  }
  private async fetchTerm(term: string, state: State): Promise<void> {
    try {
      const headers = new Headers({ "User-Agent": "UNTangle/1.0 (UNT section data; https://github.com/SamGu-NRX/UNTangle)", Accept: "application/json" });
      if (state.entry?.etag) headers.set("If-None-Match", state.entry.etag);
      if (state.entry?.lastModified) headers.set("If-Modified-Since", state.entry.lastModified);
      const response = await this.fetcher(`https://vsb.untgrades.app/data/${term}.json`, {
        headers, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
      });
      let entry: Entry;
      if (response.status === 304 && state.entry) {
        entry = { ...state.entry, checkedAt: this.now(), etag: response.headers.get("etag") ?? state.entry.etag,
          lastModified: response.headers.get("last-modified") ?? state.entry.lastModified };
      } else {
        if (!response.ok) throw new Error(`vsb term ${term}: HTTP ${response.status}`);
        const raw: unknown = await response.json();
        entry = { raw, data: parseVsbTerm(raw, term), checkedAt: this.now(),
          etag: response.headers.get("etag"), lastModified: response.headers.get("last-modified") };
      }
      state.entry = entry;
      state.diagnostic = null;
      state.retryAt = 0;
      try {
        await mkdir(this.options.directory, { recursive: true });
        const target = join(this.options.directory, `${term}.json`);
        const temporary = `${target}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify({ raw: entry.raw, checkedAt: entry.checkedAt, etag: entry.etag, lastModified: entry.lastModified }), { mode: 0o600 });
        await rename(temporary, target);
      } catch (error) {
        // A read-only deployment can still serve the validated in-memory term.
        state.diagnostic = { code: "cache_error", message: `sections disk cache write: ${message(error)}` };
      }
    } catch (error) {
      state.diagnostic = { code: error instanceof SectionSchemaError ? "schema_error" : "upstream_error", message: message(error) };
      state.retryAt = this.now() + this.retry;
    }
  }
  async get(term: string): Promise<CachedTerm> {
    if (!this.options.terms.includes(term)) return { data: null, freshness: { status: "unavailable", checkedAt: null, updatedAt: null,
      diagnostic: { code: "upstream_error", message: `No vsb source configured for term ${term}` } } };
    let statePromise = this.states.get(term);
    if (!statePromise) { statePromise = this.load(term); this.states.set(term, statePromise); }
    const state = await statePromise;
    const expired = !state.entry || this.now() - state.entry.checkedAt >= this.ttl;
    if (expired && this.now() >= state.retryAt) {
      const work = this.refresh(term, state);
      if (state.entry) this.options.retainBackground?.(work);
      else await work;
    }
    const entry = state.entry;
    return { data: entry?.data ?? null, freshness: {
      status: !entry ? "unavailable" : this.now() - entry.checkedAt >= this.ttl ? "stale" : "ok",
      checkedAt: entry ? new Date(entry.checkedAt).toISOString() : null,
      updatedAt: entry?.data.provenance.updated_at ?? null, diagnostic: state.diagnostic,
    } };
  }
}
