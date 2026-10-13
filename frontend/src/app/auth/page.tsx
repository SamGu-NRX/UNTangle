import { AuthClient } from "@/components/auth-client";

/**
 * Sign-in. In development without RESEND_API_KEY, sign-in links go to the
 * server log (lib/auth-email.ts), and the page says so; a production server
 * without email configured refuses to start, so it never gets here.
 */
export default async function AuthPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { link } = await searchParams;
  return (
    <AuthClient
      emailInServerLog={process.env.NODE_ENV !== "production" && !process.env.RESEND_API_KEY}
      linkFailed={link === "failed"}
    />
  );
}
