/**
 * Bounded in-memory cache for the map API routes.
 *
 * Everything here is stdlib-only, stores no user-identifying data, and keeps
 * its own memory bounded: the cache evicts least-recently-used entries past a
 * cap.
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
