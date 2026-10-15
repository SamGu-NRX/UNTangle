import { betterAuth, type BetterAuthOptions } from "better-auth";
import { timingSafeEqual } from "node:crypto";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { emailOTP, magicLink } from "better-auth/plugins";
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
  bumpSecurityGeneration?: (userId: string) => Promise<void>;
  readSecurityGeneration?: (userId: string) => Promise<number>;
  beginSecurityChange?: (userId: string) => Promise<void>;
  finishSecurityChange?: (userId: string) => Promise<void>;
  /** Deployment settings that don't change who may sign in (IP header, limiter storage). */
  options?: Pick<BetterAuthOptions, "advanced" | "rateLimit">;
};

/**
 * The better-auth instance, built from its dependencies so tests can run
 * the real flows on an in-memory database. lib/auth.ts builds the app's.
 *
 * Who can hold an account is decided by the inbox:
 * - Accounts are created only by an emailed link or code to a UNT address. Password
 *   sign-up is off on the server (disableSignUp), so nobody can create a
 *   password account for an address they don't read. A password is an
 *   optional extra: set from a recent signed-in session
 *   (lib/account-password.ts), or through /reset-password, which needs the
 *   inbox too.
 * - A password account whose address was never verified can't sign in
 *   (requireEmailVerification). Only accounts from before this rule can be
 *   in that state.
 * - Defense in depth: if an emailed link or code is used on an account that was
 *   never verified, that account's password and sessions were made by
 *   someone who didn't own the inbox. They are deleted before the owner's
 *   session is made, so only the inbox owner keeps access.
 * - An inbox code or link works once even when requests use it concurrently
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

export function createAuth({ database, baseURL, secret, claims, sendEmail, bumpSecurityGeneration, readSecurityGeneration, beginSecurityChange, finishSecurityChange, options }: AuthDeps) {
  /** Sends an auth email. Over budget: a sign-in link or code request fails with 429; a reset send is dropped (logged), since that endpoint answers the same whether or not an account exists. */
  async function send(kind: AuthEmailKind, to: string, url: string) {
    try {
      await sendEmail(kind, to, url);
    } catch (error) {
      if (error instanceof EmailBudgetExceeded) {
        console.warn(`Auth email (${kind}) not sent: the recipient's send budget is used up.`);
        if (kind === "magic-link" || kind === "email-code") throw new APIError("TOO_MANY_REQUESTS", { message: error.message });
        return;
      }
      console.error(`Auth email (${kind}) delivery failed.`, error);
      throw error;
    }
  }

  if (Boolean(beginSecurityChange) !== Boolean(finishSecurityChange))
    throw new Error("beginSecurityChange and finishSecurityChange must be configured together.");
  const beginChange = beginSecurityChange ?? bumpSecurityGeneration;
  const finishChange = finishSecurityChange ?? bumpSecurityGeneration;
  const passwordSessionGenerations = new WeakMap<object, { userId: string; generation: number }>();
  const claimedOtpEmails = new WeakMap<object, string>();
  const resetUsers = new WeakMap<object, string>();

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
    session: {
      additionalFields: {
        securityGeneration: { type: "number", defaultValue: 0, input: false },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user, ctx) => {
            if (ctx?.path === "/sign-in/email-otp" && user.emailVerified === true && claimedOtpEmails.get(ctx.context) !== user.email.toLowerCase())
              throw new APIError("BAD_REQUEST", { message: "This sign-in code has not been claimed." });
          },
        },
        update: {
          before: async (user, ctx) => {
            // The plugin marks an existing account verified before creating its
            // session. Refuse that write too when no code won the atomic claim.
            if (ctx?.path === "/sign-in/email-otp" && user.emailVerified === true && !claimedOtpEmails.has(ctx.context))
              throw new APIError("BAD_REQUEST", { message: "This sign-in code has not been claimed." });
          },
        },
      },
      session: {
        create: {
          before: async (session, ctx) => {
            if (ctx?.path === "/sign-in/email-otp") {
              const email = claimedOtpEmails.get(ctx.context);
              const user = email ? await ctx.context.internalAdapter.findUserById(session.userId) : null;
              if (!email || user?.email.toLowerCase() !== email)
                throw new APIError("BAD_REQUEST", { message: "This sign-in code has not been claimed." });
            }
            let generation: number;
            if (ctx?.path === "/sign-in/email") {
              const captured = passwordSessionGenerations.get(ctx.context);
              if (!captured || captured.userId !== session.userId)
                throw new Error("Password sign-in did not capture its account security generation.");
              generation = captured.generation;
            } else {
              generation = await readSecurityGeneration?.(session.userId) ?? 0;
            }
            return { data: { ...session, securityGeneration: generation } };
          },
        },
      },
      account: {
        create: {
          // setPassword is server-only and has no path. Its credential insert
          // happens after password validation and before the new password exists.
          before: async (account, ctx) => {
            if (account.providerId === "credential" && account.password && ctx?.path !== "/reset-password")
              await bumpSecurityGeneration?.(account.userId);
          },
        },
      },
    },
    plugins: [
      emailOTP({
        // A custom SHA-256 hash also lets the pre-session hook check a code
        // before claiming it across instances. The plugin still enforces attempts.
        storeOTP: { hash: async (otp) => hashMagicLinkToken(otp) },
        sendVerificationOTP: async ({ email, otp, type }) => {
          if (type !== "sign-in") throw new APIError("BAD_REQUEST", { message: "Use a sign-in code." });
          await send("email-code", email, otp);
        },
      }),
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

        if (ctx.path === "/sign-in/email" && typeof ctx.body?.email === "string") {
          const existing = await ctx.context.internalAdapter.findUserByEmail(ctx.body.email.toLowerCase());
          if (existing?.user) {
            // Capture before password verification. If a reset wins while the
            // old password is being checked, that delayed session stays old.
            passwordSessionGenerations.set(ctx.context, {
              userId: existing.user.id,
              generation: await readSecurityGeneration?.(existing.user.id) ?? 0,
            });
          }
        }

        // Only the sign-in part of emailOTP is public. Credential recovery
        // continues through the existing reset flow, with its revocation hook.
        if (ctx.path.includes("email-otp") && ctx.path !== "/sign-in/email-otp" && ctx.path !== "/email-otp/send-verification-otp")
          throw new APIError("NOT_FOUND", { message: "This email-code operation is unavailable." });
        if (ctx.path === "/email-otp/send-verification-otp") {
          if (ctx.body?.type !== "sign-in")
            throw new APIError("BAD_REQUEST", { message: "Use a sign-in code." });
          // 1.5.5 swallows background-task failures, including delivery and
          // send-budget errors. This context is copied per request, so await
          // delivery here and report its failure to the approval page.
          ctx.context.runInBackgroundOrAwait = async (promise) => { await promise; };
          return;
        }

        if (ctx.path === "/revoke-sessions") {
          const session = await getSessionFromCtx(ctx, { disableCookieCache: true });
          if (session) await bumpSecurityGeneration?.(session.user.id);
          return;
        }
        if (ctx.path === "/reset-password") {
          const token = ctx.body?.token || ctx.query?.token;
          const password = ctx.body?.newPassword;
          if (typeof token !== "string" || typeof password !== "string" || password.length < ctx.context.password.config.minPasswordLength || password.length > ctx.context.password.config.maxPasswordLength) return;
          const record = await ctx.context.internalAdapter.findVerificationValue(`reset-password:${token}`);
          if (!record || record.expiresAt <= new Date()) return;
          if (!(await claims.claim(hashMagicLinkToken(`password-reset:${token}`), record.expiresAt)))
            throw new APIError("BAD_REQUEST", { message: "This password-reset code has already been used." });
          // The persisted transition blocks grant issuance until the password
          // and sessions are changed. Failures leave it blocked for recovery.
          await beginChange?.(record.value);
          resetUsers.set(ctx.context, record.value);
          return;
        }
        if (ctx.path === "/sign-in/email-otp") {
          const email = ctx.body?.email;
          const otp = ctx.body?.otp;
          if (typeof email !== "string" || typeof otp !== "string")
            throw new APIError("BAD_REQUEST", { message: "Enter the email and sign-in code." });
          const record = await ctx.context.internalAdapter.findVerificationValue(`sign-in-otp-${email.toLowerCase()}`);
          if (!record || record.expiresAt <= new Date())
            throw new APIError("BAD_REQUEST", { message: "This sign-in code is invalid or has expired." });
          const [storedHash, attempts] = record.value.split(":");
          if (Number(attempts) >= 3)
            throw new APIError("FORBIDDEN", { message: "This sign-in code has no attempts left." });
          const providedHash = hashMagicLinkToken(otp);
          if (storedHash.length !== providedHash.length || !timingSafeEqual(Buffer.from(storedHash), Buffer.from(providedHash))) return;
          // atomicVerifyOTP in 1.5.5 reads and deletes separately. Its two
          // concurrent readers can both proceed, so use our Postgres claim.
          if (!(await claims.claim(hashMagicLinkToken(`email-code:${record.identifier}:${storedHash}:${record.expiresAt.toISOString()}`), record.expiresAt)))
            throw new APIError("BAD_REQUEST", { message: "This sign-in code has already been used." });
          claimedOtpEmails.set(ctx.context, email.toLowerCase());
          const existing = await ctx.context.internalAdapter.findUserByEmail(email.toLowerCase());
          if (existing?.user && !existing.user.emailVerified) {
            await beginChange?.(existing.user.id);
            for (const account of await ctx.context.internalAdapter.findAccounts(existing.user.id)) {
              if (account.providerId === "credential") await ctx.context.internalAdapter.deleteAccount(account.id);
            }
            await ctx.context.internalAdapter.deleteSessions(existing.user.id);
            await finishChange?.(existing.user.id);
          }
          return;
        }
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
        if (existing?.user?.emailVerified) await bumpSecurityGeneration?.(existing.user.id);
        if (existing?.user && !existing.user.emailVerified) {
          await beginChange?.(existing.user.id);
          const accounts = await ctx.context.internalAdapter.findAccounts(existing.user.id);
          for (const account of accounts) {
            if (account.providerId === "credential") await ctx.context.internalAdapter.deleteAccount(account.id);
          }
          await ctx.context.internalAdapter.deleteSessions(existing.user.id);
          await finishChange?.(existing.user.id);
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        const userId = resetUsers.get(ctx.context);
        const result = ctx.context.returned;
        if (ctx.path === "/reset-password" && userId && result && typeof result === "object" && "status" in result && result.status === true) {
          // A failed completion leaves the persisted barrier closed, including
          // when the password changed but the generation store is unavailable.
          await finishChange?.(userId);
        }
      }),
    },
  });
}
