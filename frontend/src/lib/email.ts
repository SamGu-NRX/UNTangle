import { Resend } from "resend";
import { deliverAuthEmail, type AuthEmailKind } from "@/lib/auth-email";
import type { SendBudget } from "@/lib/email-budget";

/**
 * The way the server sends auth email (sign-in links and password resets),
 * with this process's environment and the given per-recipient budget. The
 * rules live in auth-email.ts.
 */
export function createAuthEmailSender(budget: SendBudget) {
  return (kind: AuthEmailKind, to: string, url: string) =>
    deliverAuthEmail(kind, to, url, {
      env: process.env,
      createClient: (apiKey) => new Resend(apiKey),
      log: (message) => console.info(message),
      budget,
    });
}
