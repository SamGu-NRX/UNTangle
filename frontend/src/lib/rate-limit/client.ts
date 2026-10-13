import { thirdPartyBudget } from "./config";
import { IndexedDbResponseCache, MemoryResponseCache, type ResponseCache } from "./client-cache";

export type ClientBudget = { capacity: number; refillPerSecond: number; cacheTtlMs: number };
type Bucket = { tokens: number; updatedAt: number; blockedUntil: number };
export type ClientDependencies = {
  storage: Pick<Storage, "getItem" | "setItem">;
  lock: <T>(name: string, work: () => Promise<T>) => Promise<T>;
  cache: ResponseCache;
  fetch: (input: Request) => Promise<Response>;
  now: () => number;
  onStorage?: (invalidate: () => void) => void;
};
export class ClientRateLimitError extends Error {
  constructor(public readonly retryAfter: number) {
    super(`Third-party request budget exhausted. Retry in ${retryAfter} seconds.`);
    this.name = "ClientRateLimitError";
  }
}

export function retryAfterMilliseconds(value: string | null, now: number): number | null {
  if (!value) return null;
  if (/^\d+(\.\d+)?$/.test(value.trim())) {
    const delay = Math.ceil(Number(value) * 1000);
    return Number.isSafeInteger(delay) && Number.isSafeInteger(now + delay) ? delay : null;
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

function readBucket(raw: string | null, budget: ClientBudget, now: number): Bucket {
  if (!raw) return { tokens: budget.capacity, updatedAt: now, blockedUntil: 0 };
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("Stored third-party budget is invalid."); }
  if (!value || typeof value !== "object" || !("tokens" in value) || !("updatedAt" in value) || !("blockedUntil" in value) ||
      typeof value.tokens !== "number" || !Number.isFinite(value.tokens) || value.tokens < 0 ||
      typeof value.updatedAt !== "number" || !Number.isFinite(value.updatedAt) ||
      typeof value.blockedUntil !== "number" || !Number.isFinite(value.blockedUntil)) {
    throw new Error("Stored third-party budget is invalid.");
  }
  return { tokens: Math.min(budget.capacity, value.tokens + Math.max(0, now - value.updatedAt) * budget.refillPerSecond / 1000),
    updatedAt: Math.max(now, value.updatedAt), blockedUntil: value.blockedUntil };
}

export function createThirdPartyClient(deps: ClientDependencies, budget: ClientBudget = thirdPartyBudget) {
  if (budget.capacity < 1 || budget.refillPerSecond <= 0 || budget.cacheTtlMs < 0 ||
      !Object.values(budget).every(Number.isFinite)) throw new Error("Invalid third-party request budget.");
  const storageKey = "untangle:third-party-budget:v1";
  const memory = new MemoryResponseCache(deps.now);
  deps.onStorage?.(() => memory.clear());
  const bucketLock = "untangle:third-party-budget";
  function updateBucket(work: (bucket: Bucket, now: number) => void) {
    return deps.lock(bucketLock, async () => {
      const now = deps.now();
      // Read localStorage under Web Locks for every mutation; storage events alone cannot prevent concurrent overspending.
      const bucket = readBucket(deps.storage.getItem(storageKey), budget, now);
      work(bucket, now);
      deps.storage.setItem(storageKey, JSON.stringify(bucket));
    });
  }
  return async function budgetedFetch(input: string | URL | Request, init?: RequestInit, options?: { cacheTtlMs?: number }): Promise<Response> {
    const request = new Request(input, { ...init, credentials: "omit" });
    const url = new URL(request.url);
    if (url.protocol !== "https:" || !["untgrades.app", "vsb.untgrades.app"].includes(url.hostname) || url.port ||
        url.username || url.password || !["GET", "POST"].includes(request.method) ||
        request.headers.has("authorization") || request.headers.has("cookie")) {
      throw new Error("Third-party budget accepts only public GET/POST requests to the grades MCP and VSB origins.");
    }
    const ttl = options?.cacheTtlMs ?? budget.cacheTtlMs;
    if (!Number.isFinite(ttl) || ttl < 0) throw new Error("cacheTtlMs must be a non-negative finite number.");
    const body = await request.clone().arrayBuffer();
    const signature = JSON.stringify([request.method, request.url, [...request.headers].sort(), [...new Uint8Array(body)]]);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(signature));
    const key = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    // The request lock also coalesces simultaneous cache misses across tabs.
    return deps.lock(`untangle:third-party-cache:${key}`, async () => {
      const cached = ttl > 0 ? await memory.get(key) ?? await deps.cache.get(key) : undefined;
      if (cached && cached.expiresAt > deps.now()) {
        await memory.put(key, cached);
        return new Response(cached.body.slice(0), { status: cached.status, headers: cached.headers });
      }
      await updateBucket((bucket, now) => {
        const wait = Math.max(bucket.blockedUntil - now, (1 - bucket.tokens) * 1000 / budget.refillPerSecond);
        if (wait > 0) throw new ClientRateLimitError(Math.max(1, Math.ceil(wait / 1000)));
        bucket.tokens -= 1;
      });
      const response = await deps.fetch(request);
      const retry = retryAfterMilliseconds(response.headers.get("Retry-After"), deps.now());
      if (retry !== null || response.status === 429 || response.status === 503) {
        // Providers that hide Retry-After through CORS still get a conservative starting backoff of 60s, not measured.
        const delay = retry ?? 60_000;
        await updateBucket((bucket, now) => { bucket.blockedUntil = Math.max(bucket.blockedUntil, now + delay); });
      }
      if (response.ok && !response.headers.get("cache-control")?.match(/no-store|private/i) && ttl > 0 && response.status !== 204 && response.status !== 205) {
        const bytes = await response.clone().arrayBuffer();
        // Bound persistent storage per entry; larger responses still consume the ordinary request budget.
        if (bytes.byteLength <= 2 * 1024 * 1024) {
          const value = { body: bytes, status: response.status, headers: [...response.headers], expiresAt: deps.now() + ttl };
          await deps.cache.put(key, value);
          await memory.put(key, value);
        }
      }
      return response;
    });
  };
}

let browserClient: ReturnType<typeof createThirdPartyClient> | undefined;
export function thirdPartyFetch(input: string | URL | Request, init?: RequestInit, options?: { cacheTtlMs?: number }): Promise<Response> {
  if (!browserClient) {
    if (typeof window === "undefined" || !navigator.locks || !window.indexedDB) {
      throw new Error("Direct third-party calls require a browser with Web Locks and IndexedDB.");
    }
    browserClient = createThirdPartyClient({
      storage: window.localStorage,
      lock: async (name, work) => await navigator.locks.request(name, work),
      cache: new IndexedDbResponseCache(window.indexedDB),
      fetch: (input) => window.fetch(input), now: Date.now,
      onStorage: (invalidate) => window.addEventListener("storage", (event) => {
        if (event.key === "untangle:third-party-budget:v1") invalidate();
      }),
    });
  }
  return browserClient(input, init, options);
}
