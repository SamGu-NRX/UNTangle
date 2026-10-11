import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { magicLink } from "better-auth/plugins/magic-link";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts, sessions, users, verifications } from "@/lib/db/schema";
import { isUntEmail, normalizeEmail, untEmailRequirementMessage } from "@/lib/unt-auth";
import { sendMagicLinkEmail, sendPasswordResetEmail } from "@/lib/email";

// `next build` evaluates route modules with NODE_ENV=production but no server
// secrets; only fail fast when actually serving production traffic.
const isProductionServer =
  process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build";
const configuredSecret = process.env.BETTER_AUTH_SECRET;

if (isProductionServer && !configuredSecret) {
  throw new Error(
    "BETTER_AUTH_SECRET must be set when running UNTangle in production. Set it in the environment before starting the server.",
  );
}

const baseURL = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const secret =
  configuredSecret ?? "untangle-development-secret-at-least-32-characters";

/**
 * UNTangle's Better Auth instance.
 *
 * The email domain gate lives in the `before` hook: it applies to every
 * endpoint that can CREATE an account (password sign-up and magic-link
 * sign-in/sign-up) while leaving existing accounts — some created before the
 * gate existed — free to sign in with whatever address they registered.
 *
 * Email delivery is centralized in lib/email.ts: the magic-link plugin and
 * forget-password both use it, so transport selection (Resend vs local dev
 * outbox vs loud failure in production) stays in exactly one place.
 */
export const auth = betterAuth({
  appName: "UNTangle",
  baseURL,
  secret,
  trustedOrigins: [baseURL],
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: users,
      session: sessions,
      account: accounts,
      verification: verifications,
    },
  }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    minPasswordLength: 8,
    sendResetPassword: async ({ user, url }) => {
      try {
        await sendPasswordResetEmail(user.email, url);
      } catch (error) {
        console.error("Password reset email delivery failed.", error);
        throw error;
      }
    },
  },
  plugins: [
    magicLink({
      // Five minutes: enough to cross between apps, short enough to limit
      // the value of a leaked or forwarded link.
      expiresIn: 300,
      sendMagicLink: async ({ email, url }) => {
        await sendMagicLinkEmail(email, url);
      },
    }),
  ],
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      const signUpPaths = ["/sign-up/email", "/sign-in/magic-link"];
      if (!signUpPaths.includes(ctx.path)) {
        return;
      }

      const rawEmail = (ctx.body as { email?: unknown } | undefined)?.email;
      const email = typeof rawEmail === "string" ? normalizeEmail(rawEmail) : "";
      if (!email) {
        return; // Let better-auth produce its own missing-email error.
      }

      if (isUntEmail(email)) {
        return;
      }

      // The gate is a SIGN-UP gate: an account that already exists (a legacy
      // address from before the requirement) may still authenticate. Only
      // new-account creation is restricted.
      const [existing] = await db
        .select({ id: users.id })
        .from(users)
        .where(sql`lower(${users.email}) = ${email}`)
        .limit(1);
      if (existing) {
        return;
      }

      throw new APIError("BAD_REQUEST", {
        message: untEmailRequirementMessage(),
      });
    }),
  },
});
