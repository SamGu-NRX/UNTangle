import { createHmac } from "node:crypto";
import { budgetWindowMs, recipientBudgets } from "@/lib/rate-limit/config";
import type { RateLimitStore } from "@/lib/rate-limit/store";

/**
 * A send budget per recipient inbox, so nobody can use UNTangle to flood a
 * student's mailbox. better-auth's own limiter is per IP and reads before it
 * increments (12 parallel requests sent 12 emails), and the auth route's IP
 * budget (lib/rate-limit, "auth") can't tell recipients apart.
 *
 * Counts live in lib/rate-limit's store under "authEmail": one atomic hit
 * per send, shared through Postgres across instances in production, over
 * the budget's own 10-minute window (recipientBudgets.authEmail). Each email
 * kind has its own count, so password resets can't use up the sign-in links.
 */
export interface SendBudget {
  /** Counts one `kind` email to `recipient`; false when that budget for this window is used up. */
  take(recipient: string, kind: string): Promise<boolean>;
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
    async take(recipient, kind) {
      const caller = createHmac("sha256", key).update(`email:${kind}:${budgetKey(recipient)}`).digest("base64url");
      const { perRecipient } = recipientBudgets.authEmail;
      const windowMs = budgetWindowMs(recipientBudgets.authEmail);
      const count = await store.hit("authEmail", caller, Math.floor(now() / windowMs), windowMs);
      return count <= perRecipient;
    },
  };
}

export class EmailBudgetExceeded extends Error {
  constructor(readonly recipient: string) {
    super("Too many emails of this kind to this address. Try again in 10 minutes.");
    this.name = "EmailBudgetExceeded";
  }
}
