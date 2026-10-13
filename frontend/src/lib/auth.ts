import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/lib/db";
import { accounts, authRateLimits, sessions, users, verifications } from "@/lib/db/schema";
import { assertEmailConfigured } from "@/lib/auth-email";
import { createAuth } from "@/lib/auth-config";
import { sendAuthEmail } from "@/lib/email";
import { postgresClaims } from "@/lib/magic-link-claims";
import { checkProductionEnv, trustedIpHeader } from "@/lib/rate-limit/config";

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
// Sign-in links are the main way in, so a production server without an
// email provider stops here instead of showing a button that sends nothing.
assertEmailConfigured(process.env);

const baseURL = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
/** Also keys the rate limiter's HMAC of callers. */
export const authSecret =
  configuredSecret ?? "untangle-development-secret-at-least-32-characters";

const ipHeader = trustedIpHeader();

export const auth = createAuth({
  baseURL,
  secret: authSecret,
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
  options: {
    // An empty list would stop better-auth finding any IP, and it skips its limiter without one.
    advanced: ipHeader ? { ipAddress: { ipAddressHeaders: [ipHeader] } } : undefined,
    // better-auth limits per IP in production by default; the database shares its counts across instances.
    rateLimit: { storage: process.env.NODE_ENV === "production" ? "database" : "memory" },
  },
  claims: postgresClaims((statement, params) => db.$client.query(statement, params)),
  sendEmail: sendAuthEmail,
});
