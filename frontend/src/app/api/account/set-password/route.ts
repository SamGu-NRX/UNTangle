import { auth, authEmail } from "@/lib/auth";
import { setPasswordHandler } from "@/lib/account-password";
import { withRateLimit } from "@/lib/rate-limit/server";

export const POST = withRateLimit("setPassword", setPasswordHandler(auth, { sendEmail: authEmail }));
