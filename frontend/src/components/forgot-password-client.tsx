"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { authClient } from "@/lib/auth-client";
import { useFieldError } from "@/components/use-field-error";

/**
 * Request a reset link, or (with a token from that link) set a new
 * password. Failures show as help text under the field; the outcome of a
 * request is announced as a status line.
 */
export function ForgotPasswordClient({ token, error }: { token: string | null; error: string | null }) {
  const router = useRouter();
  const mode = token ? "reset" : "request";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // An invalid or expired link lands here with ?error=...: say so under the field.
  const [fieldError, setFieldError] = useState<string | null>(
    error ? "That reset link is invalid or has expired. Enter your email for a fresh one." : null,
  );
  const [status, setStatus] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const announcer = useFieldError();

  function fail(text: string) {
    setFieldError(text);
    announcer.report(inputRef.current, text);
  }

  async function handleRequestReset(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim()) {
      fail("Enter the email you signed up with.");
      return;
    }
    setIsPending(true);
    setFieldError(null);
    setStatus(null);
    const response = await fetch("/api/auth/request-password-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, redirectTo: `${window.location.origin}/forgot-password` }),
    });
    setIsPending(false);
    if (response.ok) {
      setStatus("If an account uses that email, a reset link is on its way.");
    } else {
      fail("The reset link couldn't be sent right now. Try again in a minute.");
    }
  }

  async function handleResetPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    if (password.length < 8) {
      fail("Use at least 8 characters.");
      return;
    }
    setIsPending(true);
    setFieldError(null);
    const response = await authClient.resetPassword({ newPassword: password, token });
    setIsPending(false);
    if (response.error) {
      fail(response.error.message ?? "The password couldn't be updated.");
      return;
    }
    setStatus("Password updated. Taking you to your plan…");
    setTimeout(() => router.push("/courses"), 1200);
  }

  return (
    <AuthShell>
      <h1 className="auth__title">{mode === "reset" ? "Set a new password" : "Reset your password"}</h1>
      <p className="auth__lede">
        {mode === "reset" ? "Choose a new password, then carry on planning." : "We'll email you a link to set a new one."}
      </p>

      {mode === "request" ? (
        <form className="auth__form" onSubmit={handleRequestReset} noValidate>
          <TextField
            ref={inputRef}
            label="Email"
            type="email"
            inputMode="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setFieldError(null);
            }}
            placeholder="eagleid@my.unt.edu"
            // DESIGN.md §4.6: the account's username, as on the sign-in form.
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            error={fieldError}
          />
          <Button type="submit" size="lg" className="auth__submit" loading={isPending} loadingLabel="Sending…">
            Send reset link
          </Button>
        </form>
      ) : (
        <form className="auth__form" onSubmit={handleResetPassword} noValidate>
          <TextField
            ref={inputRef}
            label="New password"
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setFieldError(null);
            }}
            autoComplete="new-password"
            help="At least 8 characters."
            error={fieldError}
          />
          <Button type="submit" size="lg" className="auth__submit" loading={isPending} loadingLabel="Updating…">
            Update password
          </Button>
        </form>
      )}

      <p className="sr-only-v2" aria-live="assertive" aria-atomic="true">
        {announcer.announcement}
      </p>
      <p className="auth__status" role="status">
        {status}
      </p>

      <p className="auth__links">
        <Link href="/auth">Back to sign in</Link>
        <Link href="/" className="auth__links-quiet">
          Home
        </Link>
      </p>
    </AuthShell>
  );
}
