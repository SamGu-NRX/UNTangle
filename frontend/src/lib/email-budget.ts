/**
 * A send budget per recipient inbox, so nobody can use UNTangle to flood a
 * student's mailbox. better-auth's own limiter is per IP, reads before it
 * increments (12 parallel requests sent 12 emails) and is off without
 * x-forwarded-for, so it can't be this guard.
 *
 * The check is one atomic "take a send if any are left" on a fixed window,
 * keyed by the normalized address. The store behind it is an interface:
 * the in-memory store here is atomic within one server process only. A
 * shared Postgres store (PR #39's lib/rate-limit) replaces it once that
 * lands, so the budget holds across instances.
 */

/** Starting values, not measured against real use: 3 auth emails per address per 10 minutes. */
export const EMAIL_BUDGET = { limit: 3, windowMs: 10 * 60 * 1000 } as const;

export interface SendBudgetStore {
  /** Atomically takes one send for `key` in the current window; false when none are left. */
  consume(key: string, limit: number, windowMs: number, now: number): Promise<boolean>;
}

/** Fixed windows in a Map. The check and the increment run with no await between, so concurrent calls can't both take the last send. */
export function memoryBudgetStore(): SendBudgetStore {
  const windows = new Map<string, { start: number; used: number }>();
  return {
    async consume(key, limit, windowMs, now) {
      const start = now - (now % windowMs);
      const current = windows.get(key);
      const window = current && current.start === start ? current : { start, used: 0 };
      if (window.used >= limit) return false;
      window.used += 1;
      windows.set(key, window);
      if (windows.size > 10_000) {
        for (const [k, w] of windows) if (w.start < start) windows.delete(k);
      }
      return true;
    },
  };
}

/**
 * One key per inbox: case and surrounding space ignored, and a "+tag" in
 * the local part dropped, since Exchange delivers student+x@ to student@.
 */
export function budgetKey(email: string): string {
  const [local, domain = ""] = email.trim().toLowerCase().split("@");
  return `${local.split("+")[0]}@${domain}`;
}

export class EmailBudgetExceeded extends Error {
  constructor(readonly recipient: string) {
    super("Too many sign-in emails to this address. Try again in 10 minutes.");
    this.name = "EmailBudgetExceeded";
  }
}
