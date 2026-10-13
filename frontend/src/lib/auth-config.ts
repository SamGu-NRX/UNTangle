import { betterAuth, type BetterAuthOptions } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { magicLink } from "better-auth/plugins";
import type { AuthEmailKind } from "@/lib/auth-email";
import { EmailBudgetExceeded } from "@/lib/email-budget";
import { hashMagicLinkToken, type MagicLinkClaims } from "@/lib/magic-link-claims";
import { untEmailGate } from "@/lib/unt-auth";

export type AuthDeps = {
  database: BetterAuthOptions["database"];
  baseURL: string;
  secret: string;
  claims: MagicLinkClaims;
  sendEmail: (kind: AuthEmailKind, to: string, url: string) => Promise<unknown>;
};

/**
 * The better-auth instance, built from its dependencies so tests can run
 * the real flows on an in-memory database. lib/auth.ts builds the app's.
 *
 * Who can hold an account is decided by the inbox:
 * - Only UNT addresses can sign up or ask for a sign-in link.
 * - A password account can't sign in, or get a session, until its address
 *   is verified (requireEmailVerification; no sign-in at sign-up).
 * - If a sign-in link is used on an account that was never verified, that
 *   account's password and sessions were made by someone who didn't own the
 *   inbox: they are deleted before the link's session is made, so only the
 *   inbox owner keeps access (account pre-hijacking).
 * - A link works once even when two requests use it at the same moment
 *   (an atomic claim, MagicLinkClaims).
 */
export function createAuth({ database, baseURL, secret, claims, sendEmail }: AuthDeps) {
  /** Sends an auth email. Over budget: a sign-in link request fails with 429; verification and reset sends are dropped (logged), since their endpoints answer the same whether or not an account exists. */
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
    appName: "UNTangle",
    baseURL,
    secret,
    trustedOrigins: [baseURL],
    database,
    emailAndPassword: {
      enabled: true,
      autoSignIn: false,
      requireEmailVerification: true,
      minPasswordLength: 8,
      sendResetPassword: async ({ user, url }) => {
        await send("password-reset", user.email, url);
      },
    },
    // Password sign-ups get a verification link, and the link signs them in;
    // magic-link users are verified by using their link.
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await send("verify-email", user.email, url);
      },
    },
    plugins: [
      // Defaults kept on purpose: the link expires in 5 minutes and allows
      // one attempt; the claim below makes that hold under concurrency.
      magicLink({
        storeToken: "hashed",
        sendMagicLink: async ({ email, url }) => {
          await send("magic-link", email, url);
        },
      }),
    ],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // Both ways an account can be created: password sign-up, and a magic
        // link for an address with no account yet.
        const refusal = untEmailGate(ctx.path, ctx.body);
        if (refusal) throw new APIError("BAD_REQUEST", { message: refusal });

        if (ctx.path !== "/magic-link/verify") return;
        const token = (ctx.query as { token?: unknown } | undefined)?.token;
        if (typeof token !== "string") return;
        const tokenHash = hashMagicLinkToken(token);
        const record = await ctx.context.internalAdapter.findVerificationValue(tokenHash);
        // Unknown or expired: better-auth's own verify redirects with the reason.
        if (!record || record.expiresAt < new Date()) return;

        if (!(await claims.claim(tokenHash, record.expiresAt))) {
          const query = ctx.query as { callbackURL?: string; errorCallbackURL?: string };
          const target = new URL(
            decodeURIComponent(query.errorCallbackURL ?? query.callbackURL ?? "/"),
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
