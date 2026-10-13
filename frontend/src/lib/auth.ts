import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";
import { db } from "@/lib/db";
import { accounts, sessions, users, verifications } from "@/lib/db/schema";
import { untEmailGate } from "@/lib/unt-auth";
import { assertEmailConfigured } from "@/lib/auth-email";
import { sendAuthEmail } from "@/lib/email";

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
// Sign-in links are the main way in, so a production server without an
// email provider stops here instead of showing a button that sends nothing.
assertEmailConfigured(process.env);

const baseURL = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const secret =
  configuredSecret ?? "untangle-development-secret-at-least-32-characters";

/** Sends an auth email; a failure is logged with its kind and rethrown, so the request fails visibly. */
async function sendLogged(kind: Parameters<typeof sendAuthEmail>[0], to: string, url: string) {
  try {
    await sendAuthEmail(kind, to, url);
  } catch (error) {
    console.error(`Auth email (${kind}) delivery failed.`, error);
    throw error;
  }
}

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
      await sendLogged("password-reset", user.email, url);
    },
  },
  // Password sign-ups get a verification link; magic-link users are
  // verified by using their link.
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendLogged("verify-email", user.email, url);
    },
  },
  plugins: [
    // Defaults kept on purpose: the link expires in 5 minutes, works once,
    // and the endpoint keeps better-auth's own limit (5 requests per 60 s).
    magicLink({
      storeToken: "hashed",
      sendMagicLink: async ({ email, url }) => {
        await sendLogged("magic-link", email, url);
      },
    }),
  ],
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      // Both ways an account can be created: password sign-up, and a magic
      // link for an address with no account yet.
      const refusal = untEmailGate(ctx.path, ctx.body);
      if (refusal) throw new APIError("BAD_REQUEST", { message: refusal });
    }),
  },
});
