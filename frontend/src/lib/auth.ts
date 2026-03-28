import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/lib/db";
import { accounts, sessions, users, verifications } from "@/lib/db/schema";
import { sendPasswordResetEmail } from "@/lib/email";

const baseURL = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const secret =
  process.env.BETTER_AUTH_SECRET ?? "untangle-development-secret-at-least-32-characters";

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
});
