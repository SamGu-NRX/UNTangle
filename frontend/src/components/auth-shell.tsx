import Link from "next/link";
import type { ReactNode } from "react";
import "./auth.css";

/**
 * Sign-in and password reset render outside the app shell: a single
 * centred card with the wordmark, then the form. No step indicator; signing
 * in is one step.
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
