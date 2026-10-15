"use client";

import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";
import "./auth.css";

/**
 * Sign-in and password reset as pages (/auth, /forgot-password): the
 * wordmark, then the form, in one card. /auth is the deep link (the email's
 * failed-link redirect, "Back to sign in"); inside the app, Sign in opens
 * the same form over the current page instead (SignInHost in auth-client.tsx).
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="auth">
      <div className="auth__card">
        <Link href="/" className="auth__wordmark">
          UNTangle
        </Link>
        {children}
      </div>
    </main>
  );
}

/** Window event that opens the sign-in dialog; cancelable, so a Sign in link can tell whether a host took it. */
export const OPEN_SIGN_IN_EVENT = "untangle:open-sign-in";
export type OpenSignInDetail = { trigger: HTMLElement | null };

/**
 * onClick for a "Sign in" link to /auth: opens the form over this page when
 * a SignInHost is mounted, and otherwise lets the link go to /auth. A
 * modified click (new tab or window) always follows the link.
 */
export function openSignIn(event: MouseEvent<HTMLAnchorElement>) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
  const request = new CustomEvent<OpenSignInDetail>(OPEN_SIGN_IN_EVENT, {
    cancelable: true,
    detail: { trigger: event.currentTarget },
  });
  if (!window.dispatchEvent(request)) event.preventDefault();
}
