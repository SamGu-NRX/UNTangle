import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { VERIFY_PATH, verifyParams } from "@/lib/magic-link-url";

export const metadata: Metadata = { title: "Sign in to UNTangle", robots: { index: false } };

/**
 * Where an emailed sign-in link lands. Mail scanners (Microsoft Safe Links
 * on UNT accounts) may open the link before the student does, so this page
 * never signs in or redirects on load: it shows one button, and only that
 * submit reaches better-auth's verify endpoint and uses the one-time token.
 */
export default async function SignInLinkPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = verifyParams(await searchParams);
  const complete = params.some(([name]) => name === "token");
  return (
    <AuthShell>
      <h1 className="auth__title">Sign in to UNTangle</h1>
      {complete ? (
        <>
          <p className="auth__lede">Continue to finish signing in. The link works once.</p>
          <form className="auth__form" method="get" action={VERIFY_PATH}>
            {params.map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
            <button type="submit" className="ui-btn ui-btn--primary auth__submit" data-ui="">
              Sign in
            </button>
          </form>
        </>
      ) : (
        <p className="auth__lede">
          This sign-in link is incomplete. <Link href="/auth">Email yourself a new one.</Link>
        </p>
      )}
    </AuthShell>
  );
}
