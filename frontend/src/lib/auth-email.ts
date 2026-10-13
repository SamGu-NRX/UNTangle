/**
 * Sign-in and password-reset email: what each message says, and where
 * it goes. Pure apart from the injected client and logger, so the rules are
 * tested without a network.
 *
 * Delivery rules, so a sign-in button can never silently do nothing:
 * - With RESEND_API_KEY set, mail goes through Resend from RESEND_FROM_EMAIL
 *   (Resend's shared test sender outside production, which only delivers to
 *   the Resend account's own address).
 * - In development without a key, the link is written to the server log and
 *   the sign-in page says so.
 * - A production server refuses to start without both variables
 *   (assertEmailConfigured, called from lib/auth.ts).
 */

import { budgetKey, EMAIL_BUDGET, EmailBudgetExceeded, type SendBudgetStore } from "@/lib/email-budget";

export type AuthEmailKind = "magic-link" | "password-reset";

type Env = Record<string, string | undefined>;

/** Resend's shared sender, for development with a key but no verified domain. */
const DEV_FROM = "UNTangle <onboarding@resend.dev>";

const copy: Record<AuthEmailKind, { subject: string; heading: string; body: string; action: string }> = {
  "magic-link": {
    subject: "Your UNTangle sign-in link",
    heading: "Sign in to UNTangle",
    body: "This link signs you in. It works once and expires in 5 minutes.",
    action: "Sign in",
  },
  "password-reset": {
    subject: "Reset your UNTangle password",
    heading: "Reset your password",
    body: "Choose a new password for your UNTangle account. The link expires in 1 hour.",
    action: "Reset password",
  },
};

const IGNORE = "Didn't request this? You can ignore this email; nothing changes until the link is used.";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export type RenderedEmail = { subject: string; html: string; text: string };

/** One template for every auth email: the wordmark, one button, the link as text, and the ignore line. */
export function renderAuthEmail(kind: AuthEmailKind, url: string): RenderedEmail {
  const { subject, heading, body, action } = copy[kind];
  const href = escapeHtml(url);
  const html = `<!doctype html>
<html lang="en"><body style="margin:0;background:#f3f5f1;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;color:#1a2e1a;">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #dfe5dc;border-radius:14px;padding:28px 24px;">
    <p style="margin:0 0 20px;font-size:20px;font-weight:800;letter-spacing:-0.01em;color:#00512b;">UNTangle</p>
    <h1 style="margin:0 0 8px;font-size:18px;line-height:24px;font-weight:600;">${heading}</h1>
    <p style="margin:0 0 20px;font-size:14px;line-height:20px;color:#4a5e4a;">${body}</p>
    <a href="${href}" style="display:inline-block;background:#00512b;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:8px;">${action}</a>
    <p style="margin:20px 0 0;font-size:12.5px;line-height:18px;color:#4a5e4a;">Or paste this link into your browser:<br><a href="${href}" style="color:#00512b;word-break:break-all;">${href}</a></p>
    <p style="margin:20px 0 0;font-size:12.5px;line-height:18px;color:#6b7f6b;">${IGNORE}</p>
  </div>
</body></html>`;
  const text = `UNTangle\n\n${heading}\n\n${body}\n\n${action}: ${url}\n\n${IGNORE}\n`;
  return { subject, html, text };
}

/** True for a server answering production traffic; `next build` runs as production without secrets. */
export function isProductionServer(env: Env): boolean {
  return env.NODE_ENV === "production" && env.NEXT_PHASE !== "phase-production-build";
}

/** Throws, naming the missing variables, when a production server has no way to send email. */
export function assertEmailConfigured(env: Env): void {
  if (!isProductionServer(env)) return;
  const missing = ["RESEND_API_KEY", "RESEND_FROM_EMAIL"].filter((name) => !env[name]);
  if (missing.length)
    throw new Error(
      `${missing.join(" and ")} must be set when running UNTangle in production: sign-in links and password resets are sent with Resend. Set them in the environment before starting the server.`,
    );
}

/**
 * Where auth email goes in this environment. Unlike the startup check, any
 * production process refuses the log fallback, build phase included: a
 * sign-in link must never end up in a log in production.
 */
export function emailDelivery(env: Env): "resend" | "server-log" {
  if (env.RESEND_API_KEY) return "resend";
  if (env.NODE_ENV === "production") {
    throw new Error("RESEND_API_KEY is not set; refusing to write an auth email to the log in production.");
  }
  return "server-log";
}

export type ResendLike = {
  emails: {
    send(payload: {
      from: string;
      to: string[];
      subject: string;
      html: string;
      text: string;
    }): Promise<{ error: { message: string } | null }>;
  };
};

export type DeliveryDeps = {
  env: Env;
  createClient: (apiKey: string) => ResendLike;
  log: (message: string) => void;
  budget: SendBudgetStore;
  now?: () => number;
};

/**
 * Sends (or, in development without a key, logs) one auth email. Takes a
 * send from the recipient's budget first and throws EmailBudgetExceeded
 * when there is none; throws if Resend refuses the email.
 */
export async function deliverAuthEmail(
  kind: AuthEmailKind,
  to: string,
  url: string,
  { env, createClient, log, budget, now = Date.now }: DeliveryDeps,
): Promise<"resend" | "server-log"> {
  const email = renderAuthEmail(kind, url);
  const mode = emailDelivery(env);
  if (!(await budget.consume(budgetKey(to), EMAIL_BUDGET.limit, EMAIL_BUDGET.windowMs, now())))
    throw new EmailBudgetExceeded(to);
  if (mode === "server-log") {
    log(`[UNTangle email] Email isn't set up here (no RESEND_API_KEY). "${email.subject}" for ${to}: ${url}`);
    return mode;
  }
  const { error } = await createClient(env.RESEND_API_KEY!).emails.send({
    from: env.RESEND_FROM_EMAIL ?? DEV_FROM,
    to: [to],
    subject: email.subject,
    html: email.html,
    text: email.text,
  });
  if (error) throw new Error(`Resend refused the ${kind} email: ${error.message}`);
  return mode;
}
