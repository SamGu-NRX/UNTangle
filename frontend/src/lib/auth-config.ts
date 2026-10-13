import { betterAuth, type BetterAuthOptions } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { magicLink } from "better-auth/plugins";
import type { AuthEmailKind } from "@/lib/auth-email";
import { EmailBudgetExceeded } from "@/lib/email-budget";
import { hashMagicLinkToken, type MagicLinkClaims } from "@/lib/magic-link-claims";
import { landingUrlFor } from "@/lib/magic-link-url";
import { untEmailGate } from "@/lib/unt-auth";

export type AuthDeps = {
  database: BetterAuthOptions["database"];
  baseURL: string;
  secret: string;
  claims: MagicLinkClaims;
  sendEmail: (kind: AuthEmailKind, to: string, url: string) => Promise<unknown>;
  /** Deployment settings that don't change who may sign in (IP header, limiter storage). */
  options?: Pick<BetterAuthOptions, "advanced" | "rateLimit">;
};

/**
 * The better-auth instance, built from its dependencies so tests can run
 * the real flows on an in-memory database. lib/auth.ts builds the app's.
 *
 * Who can hold an account is decided by the inbox:
 * - Accounts are created only by a sign-in link to a UNT address. Password
 *   sign-up is off on the server (disableSignUp), so nobody can create a
 *   password account for an address they don't read. A password is an
 *   optional extra: set from a recent signed-in session
 *   (lib/account-password.ts), or through /reset-password, which needs the
 *   inbox too.
 * - A password account whose address was never verified can't sign in
 *   (requireEmailVerification). Only accounts from before this rule can be
 *   in that state.
 * - Defense in depth: if a sign-in link is used on an account that was
 *   never verified, that account's password and sessions were made by
 *   someone who didn't own the inbox. They are deleted before the link's
 *   session is made, so only the inbox owner keeps access.
 * - A link works once even when two requests use it at the same moment
 *   (an atomic claim, MagicLinkClaims).
 */
/** A callback parameter decoded, if it decodes and points at this app; otherwise null. */
function trustedCallback(raw: string, isTrusted: (url: string) => boolean): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return isTrusted(decoded) ? decoded : null;
}

/** Where a refused sign-in link may send the browser: the given URL if it decodes and is this app's, else the sign-in page. */
export function trustedTarget(raw: string | undefined, isTrusted: (url: string) => boolean): string {
  return (raw && trustedCallback(raw, isTrusted)) || "/auth?link=failed";
}

export function createAuth({ database, baseURL, secret, claims, sendEmail, options }: AuthDeps) {
  /** Sends an auth email. Over budget: a sign-in link request fails with 429; a reset send is dropped (logged), since that endpoint answers the same whether or not an account exists. */
  async function send(kind: AuthEmailKind, to: string, url: string) {
    try {
      await sendEmail(kind, to, url);
    } catch (error) {
      if (error instanceof EmailBudgetExceeded) {
        console.warn(`Auth email (${kind}) not sent: the recipient's send budget is used up.`);
        if (kind === "magic-link") throw new APIError("TOO_MANY_REQUESTS", { message: error.message });
        return;
      }
      console.error(`Auth email (${kind}) delivery failed.`, error);
      throw error;
    }
  }

  return betterAuth({
    ...options,
    appName: "UNTangle",
    baseURL,
    secret,
    trustedOrigins: [baseURL],
    database,
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      autoSignIn: false,
      requireEmailVerification: true,
      // A reset is done from the inbox, so it ends every other session.
      revokeSessionsOnPasswordReset: true,
      minPasswordLength: 8,
      sendResetPassword: async ({ user, url }) => {
        await send("password-reset", user.email, url);
      },
    },
    plugins: [
      // Defaults kept on purpose: the link expires in 5 minutes and allows
      // one attempt; the claim below makes that hold under concurrency.
      magicLink({
        storeToken: "hashed",
        sendMagicLink: async ({ email, url }) => {
          // The student gets the app's landing page, not the verify URL (magic-link-url.ts).
          await send("magic-link", email, landingUrlFor(url));
        },
      }),
    ],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // A magic link for an address with no account creates one; password
        // sign-up is disabled, and gated too in case it is ever turned on.
        const refusal = untEmailGate(ctx.path, ctx.body);
        if (refusal) throw new APIError("BAD_REQUEST", { message: refusal });

        if (ctx.path !== "/magic-link/verify") return;
        // The only way in is the landing page's own form (same-origin). A
        // cross-site request would be another site signing this browser in
        // to an account of its choosing. A missing header (older browsers,
        // non-browser clients) is allowed.
        if (ctx.headers?.get("sec-fetch-site") === "cross-site")
          throw new APIError("FORBIDDEN", { message: "Open the sign-in link from your email." });
        const token = (ctx.query as { token?: unknown } | undefined)?.token;
        if (typeof token !== "string") return;
        // Every callback is checked before the token is claimed, so a bad one
        // can't burn a fresh token or run the account cleanup below on a
        // request that fails anyway.
        const isTrusted = (url: string) => ctx.context.isTrustedOrigin(url, { allowRelativePaths: true });
        const callbacks = ctx.query as { callbackURL?: string; newUserCallbackURL?: string; errorCallbackURL?: string };
        for (const raw of [callbacks.callbackURL, callbacks.newUserCallbackURL, callbacks.errorCallbackURL]) {
          if (raw !== undefined && !trustedCallback(raw, isTrusted))
            throw new APIError("FORBIDDEN", { message: "This sign-in link has an invalid callback URL." });
        }
        const tokenHash = hashMagicLinkToken(token);
        const record = await ctx.context.internalAdapter.findVerificationValue(tokenHash);
        // Unknown or expired: better-auth's own verify redirects with the reason.
        if (!record || record.expiresAt < new Date()) return;

        if (!(await claims.claim(tokenHash, record.expiresAt))) {
          // This hook runs before the endpoint's own check of errorCallbackURL,
          // so the target is validated here: a used link must not become an
          // open redirect to any site in errorCallbackURL.
          const target = new URL(
            trustedTarget(callbacks.errorCallbackURL ?? callbacks.callbackURL, isTrusted),
            ctx.context.baseURL,
          );
          target.searchParams.set("error", "ATTEMPTS_EXCEEDED");
          throw ctx.redirect(target.toString());
        }

        const { email } = JSON.parse(record.value) as { email: string };
        const existing = await ctx.context.internalAdapter.findUserByEmail(email.toLowerCase());
        if (existing?.user && !existing.user.emailVerified) {
          const accounts = await ctx.context.internalAdapter.findAccounts(existing.user.id);
          for (const account of accounts) {
            if (account.providerId === "credential") await ctx.context.internalAdapter.deleteAccount(account.id);
          }
          await ctx.context.internalAdapter.deleteSessions(existing.user.id);
        }
      }),
    },
  });
}
