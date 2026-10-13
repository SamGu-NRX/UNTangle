import type { Budget } from "./config";

export type LimitResult = { allowed: boolean; remaining: number; retryAfter: number; resetAfter: number };
export interface RateLimitStore {
  consume(key: string, budget: Budget): Promise<LimitResult>;
}

export function windowResult(hits: number[], allowed: boolean, budget: Budget, now: number): LimitResult {
  const resetAfter = hits.length ? Math.max(0, Math.ceil((hits[0] + budget.windowMs - now) / 1000)) : 0;
  return { allowed, remaining: Math.max(0, budget.maxRequests - hits.length), retryAfter: allowed ? 0 : Math.max(1, resetAfter), resetAfter };
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly entries = new Map<string, { hits: number[]; expiresAt: number }>();
  constructor(private readonly now: () => number = Date.now, private readonly maxKeys = 10_000) {}

  async consume(key: string, budget: Budget): Promise<LimitResult> {
    const now = this.now();
    for (const [entryKey, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(entryKey);
    }
    if (!this.entries.has(key) && this.entries.size >= this.maxKeys) {
      throw new Error("In-memory rate-limit store is full; configure Postgres for higher traffic.");
    }
    const hits = (this.entries.get(key)?.hits ?? []).filter((hit) => hit > now - budget.windowMs);
    const allowed = hits.length < budget.maxRequests;
    if (allowed) hits.push(now);
    this.entries.set(key, { hits, expiresAt: hits[hits.length - 1] + budget.windowMs });
    return windowResult(hits, allowed, budget, now);
  }
}
