import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";
import { db } from "@/lib/db";
import { sendMagicLinkEmail, sendPasswordResetEmail } from "@/lib/email";
import { isUntEmail, untEmailRequirementMessage } from "@/lib/unt-auth";

const baseURL = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const secret =
  process.env.BETTER_AUTH_SECRET ?? "untangle-development-secret-at-least-32-characters";
const untEmailRestrictedPaths = new Set([
  "/sign-in/email",
  "/sign-up/email",
  "/sign-in/magic-link",
  "/request-password-reset",
]);

export const auth = betterAuth({
  appName: "UNTangle",
  baseURL,
  secret,
  trustedOrigins: [baseURL],
  database: drizzleAdapter(db, {
    provider: "pg",
  }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    minPasswordLength: 8,
    sendResetPassword: async ({ user, url }) => {
      void sendPasswordResetEmail(user.email, url);
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      const email = typeof ctx.body?.email === "string" ? ctx.body.email : null;

      if (!untEmailRestrictedPaths.has(ctx.path) || !email || isUntEmail(email)) {
        return;
      }

      throw new APIError("BAD_REQUEST", {
        message: untEmailRequirementMessage(),
      });
    }),
  },
  plugins: [
    magicLink({
      expiresIn: 60 * 10,
      sendMagicLink: async ({ email, url }) => {
        await sendMagicLinkEmail(email, url);
      },
    }),
  ],
});
