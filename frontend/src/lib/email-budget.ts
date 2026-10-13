import { createHmac } from "node:crypto";
import { budgetWindowMs, budgets } from "@/lib/rate-limit/config";
import type { RateLimitStore } from "@/lib/rate-limit/store";

/**
 * A send budget per recipient inbox, so nobody can use UNTangle to flood a
 * student's mailbox. better-auth's own limiter is per IP and reads before it
 * increments (12 parallel requests sent 12 emails), and the auth route's IP
 * budget (lib/rate-limit, "auth") can't tell recipients apart.
 *
 * Counts live in lib/rate-limit's store, as the "authEmail" class: one
 * atomic hit per send, shared through Postgres across instances in
 * production, over the budget's own 10-minute window (budgets.authEmail).
 */
export interface SendBudget {
  /** Counts one send to `recipient`; false when its budget for this window is used up. */
  take(recipient: string): Promise<boolean>;
}

/**
 * One key per inbox: case and surrounding space ignored, and a "+tag" in
 * the local part dropped, since Exchange delivers student+x@ to student@.
 */
export function budgetKey(email: string): string {
  const [local, domain = ""] = email.trim().toLowerCase().split("@");
  return `${local.split("+")[0]}@${domain}`;
}

/**
 * The budget on a rate-limit store. Recipients are stored as HMACs, keyed
 * the same way as lib/rate-limit's callers, so the table never holds an
 * address.
 */
export function recipientBudget({
  store,
  secret,
  now = Date.now,
}: {
  store: RateLimitStore;
  secret: string;
  now?: () => number;
}): SendBudget {
  const key = createHmac("sha256", secret).update("untangle rate limit").digest();
  return {
    async take(recipient) {
      const caller = createHmac("sha256", key).update(`email:${budgetKey(recipient)}`).digest("base64url");
      const windowMs = budgetWindowMs(budgets.authEmail);
      const count = await store.hit("authEmail", caller, Math.floor(now() / windowMs), windowMs);
      return count <= budgets.authEmail.ip;
    },
  };
}

export class EmailBudgetExceeded extends Error {
  constructor(readonly recipient: string) {
    super("Too many sign-in emails to this address. Try again in 10 minutes.");
    this.name = "EmailBudgetExceeded";
  }
}
