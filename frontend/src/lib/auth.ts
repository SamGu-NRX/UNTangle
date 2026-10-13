import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/lib/db";
import { accounts, authRateLimits, sessions, users, verifications } from "@/lib/db/schema";
import { checkProductionEnv, trustedIpHeader } from "@/lib/rate-limit/config";
import { isUntEmail, untEmailRequirementMessage } from "@/lib/unt-auth";
import { sendPasswordResetEmail } from "@/lib/email";

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

if (isProductionServer) checkProductionEnv();

const baseURL = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
/** Also keys the rate limiter's HMAC of callers. */
export const authSecret =
  configuredSecret ?? "untangle-development-secret-at-least-32-characters";

const ipHeader = trustedIpHeader();

export const auth = betterAuth({
  appName: "UNTangle",
  baseURL,
  secret: authSecret,
  trustedOrigins: [baseURL],
  // An empty list would stop better-auth finding any IP, and it skips its limiter without one.
  advanced: ipHeader ? { ipAddress: { ipAddressHeaders: [ipHeader] } } : undefined,
  // better-auth limits per IP in production by default; the database shares its counts across instances.
  rateLimit: { storage: process.env.NODE_ENV === "production" ? "database" : "memory" },
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: users,
      session: sessions,
      account: accounts,
      verification: verifications,
      rateLimit: authRateLimits,
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
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-up/email") {
        return;
      }

      const email = (ctx.body as { email?: unknown } | undefined)?.email;
      if (typeof email !== "string" || !isUntEmail(email)) {
        throw new APIError("BAD_REQUEST", { message: untEmailRequirementMessage() });
      }
    }),
  },
});
