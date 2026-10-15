import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/lib/db";
import { accounts, authRateLimits, sessions, users, verifications } from "@/lib/db/schema";
import { assertEmailConfigured, isProductionServer } from "@/lib/auth-email";
import { beginSecurityChange, bumpSecurityGeneration, finishSecurityChange, holdsSecurityChange, readSecurityGeneration } from "@/server/auth/device-runtime";
import { createAuth } from "@/lib/auth-config";
import { createAuthEmailSender } from "@/lib/email";
import { recipientBudget } from "@/lib/email-budget";
import { postgresClaims } from "@/lib/magic-link-claims";
import { checkProductionEnv, trustedIpHeader } from "@/lib/rate-limit/config";
import { memoryStore, postgresStore } from "@/lib/rate-limit/store";

// `next build` evaluates route modules with NODE_ENV=production but no server
// secrets; only fail fast when actually serving production traffic.
const productionServer = isProductionServer(process.env);
const configuredSecret = process.env.BETTER_AUTH_SECRET;

if (productionServer && !configuredSecret) {
  throw new Error(
    "BETTER_AUTH_SECRET must be set when running UNTangle in production. Set it in the environment before starting the server.",
  );
}
if (productionServer) checkProductionEnv();
// Sign-in links are the main way in, so a production server without an
// email provider stops here instead of showing a button that sends nothing.
assertEmailConfigured(process.env);

const baseURL = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
/** Also keys the rate limiter's HMAC of callers and of email recipients. */
export const authSecret =
  configuredSecret ?? "untangle-development-secret-at-least-32-characters";

const ipHeader = trustedIpHeader();

/** Sends auth email within each recipient's budget; shared through Postgres in production, like the API limits (lib/rate-limit). */
export const authEmail = createAuthEmailSender(
  recipientBudget({
    store: process.env.NODE_ENV === "production" ? postgresStore(db) : memoryStore(),
    secret: authSecret,
  }),
);

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
  sendEmail: authEmail,
  bumpSecurityGeneration,
  readSecurityGeneration,
  beginSecurityChange,
  holdsSecurityChange,
  finishSecurityChange,
});
