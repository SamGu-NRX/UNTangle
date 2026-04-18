"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { authClient } from "@/lib/auth-client";

export function ForgotPasswordClient({
  token,
  error,
}: {
  token: string | null;
  error: string | null;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
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
    if (!token) return;

    setIsPending(true);
    setMessage(null);
    const response = await authClient.resetPassword({ newPassword: password, token });
    setIsPending(false);

    if (response.error) {
      setMessage(response.error.message ?? "Reset failed.");
      return;
    }

    setMessage("Password updated. Redirecting…");
    setTimeout(() => router.push("/courses"), 1200);
  }

  return (
    <AuthShell step={0}>
      <div style={{ marginBottom: 18 }}>
        <h1
          className="font-display"
          style={{
            fontSize: "1.55rem",
            fontWeight: 800,
            color: "var(--brand-900)",
            letterSpacing: "-0.03em",
            lineHeight: 1.05,
          }}
        >
          {mode === "reset" ? "Set a new password." : "Reset your password."}
        </h1>
        <p style={{ marginTop: 6, fontSize: "0.85rem", color: "var(--copy)" }}>
          {mode === "reset"
            ? "Choose a new password and continue back to the planner."
            : "We'll send a reset link to your inbox."}
        </p>
      </div>

      {error ? (
        <p
          style={{
            fontSize: "0.82rem",
            color: "var(--danger)",
            padding: "0.55rem 0.7rem",
            border: "1px solid var(--danger-border)",
            borderRadius: "var(--r-sm)",
            background: "var(--danger-bg)",
            marginBottom: 14,
          }}
        >
          The reset token is invalid or expired. Request a fresh link below.
        </p>
      ) : null}

      {mode === "request" ? (
        <form onSubmit={handleRequestReset} style={{ display: "grid", gap: 12 }}>
          <Field
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="eagleid@unt.edu"
            required
          />
          <Button type="submit" disabled={isPending}>
            {isPending ? (
              <>
                <span className="spinner" />
                <span>Sending…</span>
              </>
            ) : (
              "Send reset link"
            )}
          </Button>
        </form>
      ) : (
        <form onSubmit={handleResetPassword} style={{ display: "grid", gap: 12 }}>
          <Field
            label="New password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
          <Button type="submit" disabled={isPending}>
            {isPending ? (
              <>
                <span className="spinner" />
                <span>Updating…</span>
              </>
            ) : (
              "Update password"
            )}
          </Button>
        </form>
      )}

      {message ? (
        <p style={{ marginTop: 12, fontSize: "0.85rem", color: "var(--copy)" }}>{message}</p>
      ) : null}

      <div
        style={{
          marginTop: 16,
          paddingTop: 14,
          borderTop: "1px solid var(--line)",
          display: "flex",
          justifyContent: "space-between",
          fontSize: "0.78rem",
        }}
      >
        <Link href="/auth" style={{ color: "var(--brand-700)", fontWeight: 600 }}>
          Back to sign in
        </Link>
        <Link href="/" style={{ color: "var(--copy)" }}>
          Home
        </Link>
      </div>
    </AuthShell>
  );
}
