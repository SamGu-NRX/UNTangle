import { Resend } from "resend";
import { deliverAuthEmail, type AuthEmailKind } from "@/lib/auth-email";
import { memoryBudgetStore, type SendBudgetStore } from "@/lib/email-budget";

/** Per-process until PR #39's shared Postgres store lands (see email-budget.ts). */
const budget: SendBudgetStore = memoryBudgetStore();

/**
 * The one way the server sends auth email (sign-in links, verification,
 * password resets), with this process's environment and send budget. The
 * rules live in auth-email.ts.
 */
export async function sendAuthEmail(kind: AuthEmailKind, to: string, url: string) {
  return deliverAuthEmail(kind, to, url, {
    env: process.env,
    createClient: (apiKey) => new Resend(apiKey),
    log: (message) => console.info(message),
    budget,
  });
}
