"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { VERIFY_PATH, verifyParamsFromFragment } from "@/lib/magic-link-url";

const noSubscribe = () => () => {};

/**
 * The sign-in link page's form. The link's parameters are in the URL
 * fragment, which only the browser sees, so they are read here on the
 * client. Nothing happens on load: only pressing "Sign in" submits them to
 * better-auth's verify endpoint.
 */
export function SignInLinkForm() {
  // null on the server and during hydration: the fragment exists only in the browser.
  const hash = useSyncExternalStore(noSubscribe, () => window.location.hash, () => null);
  if (hash === null) return <p className="auth__lede">Checking your sign-in link…</p>;
  const params = verifyParamsFromFragment(hash);
  if (!params.some(([name]) => name === "token"))
    return (
      <p className="auth__lede">
        This sign-in link is incomplete. <Link href="/auth">Email yourself a new one.</Link>
      </p>
    );
  return (
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
      {/* The mobile app's handoff: the same unclaimed token, still only in the
      fragment, handed to the app's deep link. Nothing here verifies it - the
      token stays unused until the app posts it to the verify endpoint. */}
      <p className="auth__lede">
        On a phone?{" "}
        <a href={`untangle://auth/callback${hash}`}>Open this link in the UNTangle app</a> instead.
      </p>
    </>
  );
}
