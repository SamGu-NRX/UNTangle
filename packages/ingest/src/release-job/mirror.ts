/**
 * Step 1 of "Reference data: published releases"
 * (docs/architecture/README.md): fetch a term's files from the VSB mirror
 * within that source's policy.
 *
 * The same machinery fetches the term file and its subject files:
 * conditional requests (ETag and If-Modified-Since), the policy's minimum
 * interval per URL, its hourly cap across all URLs, its concurrency, a
 * timeout and a size cap. Fetch state (etags and request timestamps) is a
 * plain object the caller persists, so a one-shot CLI run still honors the
 * policy across runs.
 *
 * A fetch never throws for an upstream problem: it returns an outcome. A
 * partial or failed response is a state, and only the caller decides what
 * it becomes.
 */

import { sourcePolicy, type ReviewedSourcePolicy } from "../source-policies";

export type FetchOutcome =
  | { kind: "fetched"; body: string; etag: string | null; lastModified: string | null; fetchedAt: string }
  | { kind: "not-modified" }
  | { kind: "absent" }
  | { kind: "deferred"; reason: "min-interval" | "hourly-budget" }
  | { kind: "error"; message: string };

export type MirrorRequest = { term: string; subject?: string };

export type MirrorFileState = { etag: string | null; lastModified: string | null; fetchedAt: string };

/** What the caller persists between runs: per-URL validators and the request log the hourly cap reads. */
export type MirrorState = { files: Record<string, MirrorFileState>; requests: string[] };

export function emptyMirrorState(): MirrorState {
  return { files: {}, requests: [] };
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type MirrorOptions = {
  /** The reviewed policy that governs every fetch. Defaults to the VSB mirror's. */
  policy?: ReviewedSourcePolicy;
  /** Root the file URLs are built from. Defaults to the policy's first allowed prefix. */
  baseUrl?: string;
  fetcher?: FetchLike;
  now?: () => number;
  /** Per request; matches frontend/src/lib/sections/config.ts. */
  timeoutMs?: number;
  /** Matches frontend/src/lib/sections/config.ts, with headroom over the 16 MB term file. */
  maxBytes?: number;
  /** State carried over from earlier runs. Defaults to empty. */
  state?: MirrorState;
};

/** The default mirror root: the same files the app fetches today. */
export const VSB_BASE_URL = "https://vsb.untgrades.app/data/";

const userAgent = "UNTangle/1.0 (section release job; https://github.com/SamGu-NRX/UNTangle)";

export class MirrorUrlError extends Error {}

export class Mirror {
  private readonly policy: ReviewedSourcePolicy;
  private readonly baseUrl: string;
  private readonly fetcher: FetchLike;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  readonly state: MirrorState;

  constructor(options: MirrorOptions = {}) {
    this.policy = options.policy ?? sourcePolicy("vsb-untgrades");
    this.baseUrl = options.baseUrl ?? this.policy.allowedUrlPrefixes[0] ?? VSB_BASE_URL;
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
    this.state = options.state ?? emptyMirrorState();
  }

  /** The mirror file for a whole term, or for one subject in it. Throws when the URL leaves the policy. */
  urlFor(term: string, subject?: string): string {
    const url = subject === undefined ? `${this.baseUrl}${term}.json` : `${this.baseUrl}${term}/${subject}.json`;
    if (!this.policy.allowedUrlPrefixes.some(prefix => url.startsWith(prefix))) {
      throw new MirrorUrlError(`"${url}" is outside the policy for "${this.policy.sourceId}".`);
    }
    return url;
  }

  /** Fetches started in the last hour, what the policy's hourly cap reads. */
  requestsInLastHour(): number {
    const cutoff = this.now() - 60 * 60_000;
    return this.state.requests.filter(at => Date.parse(at) > cutoff).length;
  }

  /**
   * Fetches one file, conditionally. Counts toward the hourly cap even when
   * the server answers 304 or the request fails: the mirror served or
   * received the attempt either way.
   */
  async fetchFile(term: string, subject?: string): Promise<FetchOutcome> {
    const url = this.urlFor(term, subject);
    const file = this.state.files[url];
    const nowMs = this.now();
    const minInterval = this.policy.minIntervalMs;
    if (minInterval !== null && file !== undefined && file.fetchedAt !== undefined && nowMs - Date.parse(file.fetchedAt) < minInterval) {
      return { kind: "deferred", reason: "min-interval" };
    }
    const maxPerHour = this.policy.maxRequestsPerHour;
    if (maxPerHour !== null && this.requestsInLastHour() >= maxPerHour) {
      return { kind: "deferred", reason: "hourly-budget" };
    }
    this.state.requests.push(new Date(nowMs).toISOString());
    this.state.requests = this.state.requests.filter(at => Date.parse(at) > nowMs - 60 * 60_000);

    const headers = new Headers({ "User-Agent": userAgent, Accept: "application/json" });
    if (file?.etag) headers.set("If-None-Match", file.etag);
    if (file?.lastModified) headers.set("If-Modified-Since", file.lastModified);

    let response: Response;
    try {
      response = await this.fetcher(url, {
        headers,
        // Redirects are decided here, not by fetch: following one could leave
        // the policy's URL prefixes silently. Bun's "error" mode also misfires
        // on 304 (it treats every 3xx as a redirect), so the status is
        // inspected explicitly below.
        redirect: "manual",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      const message = name === "TimeoutError" || name === "AbortError"
        ? `the request timed out after ${this.timeoutMs}ms`
        : error instanceof Error ? error.message : String(error);
      return { kind: "error", message: `GET ${url}: ${message}` };
    }
    if (response.type === "opaqueredirect" || [301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      return { kind: "error", message: `GET ${url}: the mirror answered HTTP ${response.status} (a redirect); redirects are not followed because they would leave the source policy` };
    }

    if (response.status === 304) {
      await response.body?.cancel();
      return { kind: "not-modified" };
    }
    if (response.status === 404) {
      await response.body?.cancel();
      return { kind: "absent" };
    }
    if (!response.ok) {
      await response.body?.cancel();
      return { kind: "error", message: `GET ${url}: HTTP ${response.status}` };
    }

    let body: string;
    try {
      body = await readBody(response, this.maxBytes);
    } catch (error) {
      return { kind: "error", message: error instanceof Error ? error.message : String(error) };
    }
    const fetchedAt = new Date(this.now()).toISOString();
    this.state.files[url] = {
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
      fetchedAt,
    };
    return { kind: "fetched", body, etag: response.headers.get("etag"), lastModified: response.headers.get("last-modified"), fetchedAt };
  }

  /**
   * Fetches several files under the policy's concurrency. Every request runs
   * even when an earlier one errors or is deferred; the outcomes come back
   * per request, in no particular order.
   */
  async fetchFiles(requests: readonly MirrorRequest[]): Promise<Array<{ request: MirrorRequest; url: string; outcome: FetchOutcome }>> {
    const results: Array<{ request: MirrorRequest; url: string; outcome: FetchOutcome }> = [];
    let next = 0;
    const workers = Array.from({ length: Math.max(1, this.policy.maxConcurrency) }, async () => {
      for (;;) {
        const index = next++;
        if (index >= requests.length) return;
        const request = requests[index] as MirrorRequest;
        const url = this.urlFor(request.term, request.subject);
        const outcome = await this.fetchFile(request.term, request.subject);
        results.push({ request, url, outcome });
      }
    });
    await Promise.all(workers);
    return results;
  }
}

/** Reads the body whole, refusing one larger than the cap before and while reading it. */
async function readBody(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    throw new Error(`GET ${response.url}: body exceeds ${maxBytes} bytes`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error(`GET ${response.url}: response has no body`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (let next = await reader.read(); !next.done; next = await reader.read()) {
    size += next.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error(`GET ${response.url}: body exceeds ${maxBytes} bytes`);
    }
    chunks.push(next.value);
  }
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}
