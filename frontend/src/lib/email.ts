import { Resend } from "resend";
import { deliverAuthEmail, type AuthEmailKind } from "@/lib/auth-email";

/**
 * The one way the server sends auth email (sign-in links, verification,
 * password resets), with this process's environment. The rules live in
 * auth-email.ts.
 */
export async function sendAuthEmail(kind: AuthEmailKind, to: string, url: string) {
  return deliverAuthEmail(kind, to, url, {
    env: process.env,
    createClient: (apiKey) => new Resend(apiKey),
    log: (message) => console.info(message),
  });
}
