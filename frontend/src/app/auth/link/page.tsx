import type { Metadata } from "next";
import { AuthShell } from "@/components/auth-shell";
import { SignInLinkForm } from "@/components/sign-in-link-form";

// no-referrer: nothing on this page should pass its URL on.
export const metadata: Metadata = { title: "Sign in to UNTangle", robots: { index: false }, referrer: "no-referrer" };

/**
 * Where an emailed sign-in link lands. Mail scanners (Microsoft Safe Links
 * on UNT accounts) may open the link before the student does, so this page
 * never signs in or redirects on load: it shows one button, and only that
 * submit reaches better-auth's verify endpoint and uses the one-time token.
 * The token is in the URL fragment, so it never reaches the server's logs.
 */
export default function SignInLinkPage() {
  return (
    <AuthShell>
      <h1 className="auth__title">Sign in to UNTangle</h1>
      <SignInLinkForm />
    </AuthShell>
  );
}
