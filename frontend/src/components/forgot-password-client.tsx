"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { authClient } from "@/lib/auth-client";

export function ForgotPasswordClient({
  token,
  error,
}: {
  token: string | null;
  error: string | null;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("eagleid@unt.edu");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const mode = useMemo(() => (token ? "reset" : "request"), [token]);

  async function handleRequestReset(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsPending(true);
    setMessage(null);

    const response = await fetch("/api/auth/request-password-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        redirectTo: `${window.location.origin}/forgot-password`,
      }),
    });

    setIsPending(false);
    setMessage(
      response.ok
        ? "If the account exists, a reset link has been sent."
        : "Unable to start the reset flow right now.",
    );
  }

  async function handleResetPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      return;
    }

    setIsPending(true);
    setMessage(null);
    const response = await authClient.resetPassword({
      newPassword: password,
      token,
    });
    setIsPending(false);

    if (response.error) {
      setMessage(response.error.message ?? "Reset failed.");
      return;
    }

    setMessage("Password updated. Redirecting you back into the planner.");
    setTimeout(() => router.push("/courses"), 1200);
  }

  return (
    <AuthShell
      eyebrow="Recovery"
      title={mode === "reset" ? "Set a new password." : "Reset access without losing momentum."}
      description={
        mode === "reset"
          ? "Finish the reset and continue back into your course and schedule flow."
          : "Request a fresh link here, then return to the planner without being dropped into a disconnected utility screen."
      }
      aside={
        <>
          {[
            "Request the reset from this page.",
            "Use the emailed secure link to return here.",
            "Finish and continue back into your planner state.",
          ].map((item, index) => (
            <div
              key={item}
              className="subtle-panel animate-rise-in px-5 py-4"
              style={{ animationDelay: `${index * 80}ms` }}
            >
              <p className="text-sm leading-7 text-[color:var(--copy)]">{item}</p>
            </div>
          ))}
        </>
      }
    >
      <div className="surface-panel mx-auto w-full max-w-[34rem] px-6 py-6 sm:px-7 sm:py-7">
        {error ? (
          <p className="mb-4 rounded-[1.25rem] border border-[#e5c1c1] bg-[#fff6f4] px-4 py-3 text-sm text-[#8a3b3b]">
            The reset token is invalid or expired. Request a fresh link below.
          </p>
        ) : null}

        {mode === "request" ? (
          <form className="space-y-4" onSubmit={handleRequestReset}>
            <label className="block">
              <span className="field-label">Email</span>
              <input
                className="field-input"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <button className="primary-button w-full" disabled={isPending} type="submit">
              {isPending ? "Sending..." : "Send reset link"}
            </button>
          </form>
        ) : (
          <form className="space-y-4" onSubmit={handleResetPassword}>
            <label className="block">
              <span className="field-label">New password</span>
              <input
                className="field-input"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <button className="primary-button w-full" disabled={isPending} type="submit">
              {isPending ? "Updating..." : "Update password"}
            </button>
          </form>
        )}

        {message ? <p className="mt-4 text-sm text-[color:var(--copy)]">{message}</p> : null}

        <div className="mt-6 flex items-center justify-between border-t border-[color:var(--line)] pt-5 text-sm">
          <Link href="/auth" className="font-semibold text-[color:var(--green-800)]">
            Back to sign in
          </Link>
          <Link href="/" className="text-[color:var(--muted)]">
            Back home
          </Link>
        </div>
      </div>
    </AuthShell>
  );
}
