/**
 * Bounded in-memory caches and rate limiting for the map API routes.
 *
 * Everything here is stdlib-only, stores no user-identifying data, and keeps
 * its own memory bounded: the cache evicts least-recently-used entries past a
 * cap, and the limiter prunes stale keys plus a hard cap on tracked keys.
 */

type CacheEntry<V> = {
  value: V;
  expiresAt: number;
};

export type TtlLruCacheOptions = {
  /** Maximum live entries; the least recently used entry is evicted first. */
  maxEntries: number;
  /** Time to live for successful entries, in milliseconds. */
  ttlMs: number;
  /**
   * Time to live for failed entries (provider errors, unresolved results), in
   * milliseconds. Short so a later good result can replace them. Use 0 to keep
   * failures out of the cache entirely. Defaults to 5 minutes.
   */
  failureTtlMs?: number;
  /** Injectable clock for deterministic tests. Defaults to Date.now. */
  now?: () => number;
};

export class TtlLruCache<V> {
  private readonly entries = new Map<string, CacheEntry<V>>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly failureTtlMs: number;
  private readonly now: () => number;

  constructor(options: TtlLruCacheOptions) {
    if (options.maxEntries < 1) {
      throw new Error("maxEntries must be at least 1");
    }
    this.maxEntries = options.maxEntries;
    this.ttlMs = options.ttlMs;
    this.failureTtlMs = options.failureTtlMs ?? 5 * 60 * 1000;
    this.now = options.now ?? Date.now;
  }

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    // Re-insert to mark the entry as most recently used.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V, options?: { failure?: boolean }): void {
    const ttl = options?.failure ? this.failureTtlMs : this.ttlMs;
    if (ttl <= 0) {
      return;
    }
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + ttl });
    // Map iterates in insertion order, so the front of the map is the
    // least recently used entry.
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      this.entries.delete(oldestKey);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}

export type RateLimiterOptions = {
  /** Sliding window length, in milliseconds. */
  windowMs: number;
  /** Maximum allowed requests per key within the window. */
  maxRequests: number;
  /**
   * Hard cap on tracked keys so a flood of unique keys cannot grow the map
   * without bound; the stalest key is evicted first. Defaults to 10,000.
   */
  maxTrackedKeys?: number;
  /** Injectable clock for deterministic tests. Defaults to Date.now. */
  now?: () => number;
};

export type RateLimitCheck = {
  allowed: boolean;
  /** Seconds until the oldest in-window request ages out; 0 when allowed. */
  retryAfterSeconds: number;
};

export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly maxTrackedKeys: number;
  private readonly now: () => number;

  constructor(options: RateLimiterOptions) {
    if (options.maxRequests < 1) {
      throw new Error("maxRequests must be at least 1");
    }
    this.windowMs = options.windowMs;
    this.maxRequests = options.maxRequests;
    this.maxTrackedKeys = options.maxTrackedKeys ?? 10_000;
    this.now = options.now ?? Date.now;
  }

  /**
   * Records an allowed request for the key. Denied requests are not recorded,
   * so a steady stream of denied traffic cannot extend the block forever.
   */
  check(key: string): RateLimitCheck {
    const now = this.now();
    const windowStart = now - this.windowMs;
    const timestamps = (this.hits.get(key) ?? []).filter((time) => time > windowStart);

    if (timestamps.length >= this.maxRequests) {
      this.hits.set(key, timestamps);
      const oldest = timestamps[0];
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000)),
      };
    }

    timestamps.push(now);
    this.hits.set(key, timestamps);
    this.prune(now, key);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  get trackedKeys(): number {
    return this.hits.size;
  }

  private prune(now: number, currentKey: string) {
    const windowStart = now - this.windowMs;
    for (const [key, timestamps] of this.hits) {
      if (key === currentKey) {
        continue;
      }
      const last = timestamps[timestamps.length - 1];
      if (last === undefined || last <= windowStart) {
        this.hits.delete(key);
      }
    }

    if (this.hits.size <= this.maxTrackedKeys) {
      return;
    }
    // Hard cap: evict the stalest keys (oldest most-recent hit) first.
    const stalest = [...this.hits.entries()].sort(
      (a, b) => a[1][a[1].length - 1] - b[1][b[1].length - 1],
    );
    while (this.hits.size > this.maxTrackedKeys && stalest.length > 0) {
      const entry = stalest.shift();
      if (!entry) {
        break;
      }
      this.hits.delete(entry[0]);
    }
  }
}

/**
 * Best-effort client IP for rate limiting only. Reads proxy headers; when
 * neither is present all callers share the "unknown" bucket. The value is
 * never logged or stored beyond the limiter's in-memory window.
 */
export function clientIpFromRequest(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const firstHop = forwarded?.split(",")[0]?.trim();
  if (firstHop) {
    return firstHop;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}
