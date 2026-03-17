"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
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
    <AppShell
      currentStep={0}
      eyebrow="Recovery"
      title={mode === "reset" ? "Set a new password." : "Reset access without losing momentum."}
      subtitle={
        mode === "reset"
          ? "Finish the reset and continue back into your course and schedule flow."
          : "This recovery path keeps the tone and pacing of the main experience instead of dropping you into a dead-end auth screen."
      }
      aside={
        <div className="glass-panel p-5">
          <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">What happens next</p>
          <ol className="mt-4 space-y-4 text-sm leading-6 text-[var(--copy)]">
            <li>1. Request a reset link for your UNTangle account.</li>
            <li>2. Open the Resend-delivered email and follow the secure token link.</li>
            <li>3. Return to the planner with your persisted preferences intact.</li>
          </ol>
        </div>
      }
    >
      <div className="max-w-xl rounded-[2rem] border border-[rgba(16,38,20,0.08)] bg-white/80 p-6 shadow-[0_18px_48px_rgba(30,38,22,0.08)]">
        {error ? (
          <p className="mb-4 rounded-2xl border border-[#e2b3b3] bg-[#fff5f5] px-4 py-3 text-sm text-[#8d2b2b]">
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

        {message ? <p className="mt-4 text-sm text-[var(--copy)]">{message}</p> : null}
      </div>
    </AppShell>
  );
}
