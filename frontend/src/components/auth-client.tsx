"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { authClient } from "@/lib/auth-client";
import { isUntEmail, untEmailRequirementMessage } from "@/lib/unt-auth";

type AuthMessage = {
  tone: "error" | "success";
  text: string;
};

export function AuthClient() {
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [magicEmail, setMagicEmail] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState<AuthMessage | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isMagicSubmitting, setIsMagicSubmitting] = useState(false);
  const [localOpen, setLocalOpen] = useState(false);
  const router = useRouter();

  async function handleMagicLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isUntEmail(magicEmail)) {
      setMessage({ tone: "error", text: untEmailRequirementMessage() });
      return;
    }

    setIsMagicSubmitting(true);
    setMessage(null);

    try {
      const response = await fetch("/api/auth/sign-in/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: magicEmail,
          name: magicEmail.split("@")[0],
          callbackURL: "/courses",
          newUserCallbackURL: "/courses",
          errorCallbackURL: "/auth",
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        setMessage({ tone: "error", text: payload?.message ?? "Unable to send a sign-in link." });
        return;
      }

      setMessage({ tone: "success", text: "Check your UNT inbox for a sign-in link." });
    } catch {
      setMessage({ tone: "error", text: "Unable to send a sign-in link." });
    } finally {
      setIsMagicSubmitting(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isUntEmail(email)) {
      setMessage({ tone: "error", text: untEmailRequirementMessage() });
      return;
    }

    setIsSubmitting(true);
    setMessage(null);

    const response =
      mode === "signIn"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name: name || email });

    setIsSubmitting(false);

    if (response.error) {
      setMessage({ tone: "error", text: response.error.message ?? "Authentication failed." });
      return;
    }

    router.push("/courses");
  }

  return (
    <AuthShell step={0}>
      <div style={{ marginBottom: 18 }}>
        <h1
          className="font-display"
          style={{
            fontSize: "1.7rem",
            fontWeight: 800,
            color: "var(--brand-900)",
            letterSpacing: "-0.03em",
            lineHeight: 1.05,
          }}
        >
          Sign in with your UNT email.
        </h1>
        <p style={{ marginTop: 6, fontSize: "0.85rem", color: "var(--copy)" }}>
          Use a one-time link to create or open your planner account.
        </p>
      </div>

      <form onSubmit={handleMagicLink} style={{ display: "grid", gap: 12 }}>
        <Field
          label="UNT email"
          type="email"
          value={magicEmail}
          onChange={(e) => setMagicEmail(e.target.value)}
          placeholder="eagleid@unt.edu"
          autoComplete="email"
          required
          helper="@unt.edu and @my.unt.edu addresses are accepted."
        />

        {message ? (
          <p
            style={{
              fontSize: "0.82rem",
              color: message.tone === "error" ? "var(--danger)" : "var(--success-ink)",
              padding: "0.55rem 0.7rem",
              border: `1px solid ${
                message.tone === "error" ? "var(--danger-border)" : "var(--success-border)"
              }`,
              borderRadius: "var(--r-sm)",
              background: message.tone === "error" ? "var(--danger-bg)" : "var(--success-bg)",
            }}
          >
            {message.text}
          </p>
        ) : null}

        <Button type="submit" disabled={isMagicSubmitting} style={{ width: "100%", marginTop: 4 }}>
          {isMagicSubmitting ? (
            <>
              <span className="spinner" />
              <span>Sending…</span>
            </>
          ) : (
            "Send UNT sign-in link"
          )}
        </Button>
      </form>

      <div
        style={{
          margin: "16px 0 12px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          color: "var(--faint)",
          fontSize: "0.7rem",
          letterSpacing: "0.18em",
          textTransform: "uppercase",
        }}
      >
        <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
        <span>or</span>
        <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
      </div>

      <Button
        type="button"
        variant="ghost"
        onClick={() => router.push("/courses")}
        style={{ width: "100%" }}
      >
        Continue as guest
      </Button>

      <Button
        type="button"
        variant="ghost"
        onClick={() => setLocalOpen((current) => !current)}
        style={{ width: "100%", marginTop: 8 }}
      >
        {localOpen ? "Hide password sign-in" : "Use password instead"}
      </Button>

      {localOpen ? (
        <div
          className="animate-content-enter"
          style={{
            marginTop: 16,
            padding: "0.9rem",
            border: "1px solid var(--line)",
            borderRadius: "var(--r-md)",
            background: "var(--surface-muted)",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 4,
              padding: 4,
              border: "1px solid var(--line)",
              borderRadius: "var(--r-md)",
              background: "var(--surface)",
              marginBottom: 12,
            }}
          >
            {(["signIn", "signUp"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                style={{
                  padding: "0.5rem",
                  borderRadius: "var(--r-sm)",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "0.82rem",
                  fontWeight: 700,
                  color: mode === value ? "#fff" : "var(--copy)",
                  background: mode === value ? "var(--brand-900)" : "transparent",
                  transition: "background-color var(--d-hover) var(--ease), color var(--d-hover) var(--ease)",
                }}
              >
                {value === "signIn" ? "Log in" : "Sign up"}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12 }}>
            {mode === "signUp" ? (
              <Field
                label="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                autoComplete="name"
              />
            ) : null}
            <Field
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="eagleid@unt.edu"
              autoComplete="email"
              required
            />
            <Field
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              autoComplete={mode === "signIn" ? "current-password" : "new-password"}
              required
              minLength={8}
            />

            <Button type="submit" disabled={isSubmitting} style={{ width: "100%", marginTop: 4 }}>
              {isSubmitting ? (
                <>
                  <span className="spinner" />
                  <span>Working…</span>
                </>
              ) : mode === "signIn" ? (
                "Log in"
              ) : (
                "Create account"
              )}
            </Button>
          </form>
        </div>
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
        <Link href="/forgot-password" style={{ color: "var(--brand-700)", fontWeight: 600 }}>
          Forgot password?
        </Link>
        <Link href="/" style={{ color: "var(--copy)" }}>
          Back home
        </Link>
      </div>
    </AuthShell>
  );
}
