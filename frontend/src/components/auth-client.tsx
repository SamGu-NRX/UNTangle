"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { authClient } from "@/lib/auth-client";

export function AuthClient() {
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage(null);

    const response =
      mode === "signIn"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name: name || email });

    setIsSubmitting(false);

    if (response.error) {
      setMessage(response.error.message ?? "Authentication failed.");
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
          {mode === "signIn" ? "Welcome back." : "Create your planner account."}
        </h1>
        <p style={{ marginTop: 6, fontSize: "0.85rem", color: "var(--copy)" }}>
          {mode === "signIn"
            ? "Sign in to keep your plan synced across sessions."
            : "Save your plan, sync across devices."}
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 4,
          padding: 4,
          border: "1px solid var(--line)",
          borderRadius: "var(--r-md)",
          background: "var(--surface-muted)",
          marginBottom: 16,
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

        {message ? (
          <p
            style={{
              fontSize: "0.82rem",
              color: "var(--danger)",
              padding: "0.55rem 0.7rem",
              border: "1px solid var(--danger-border)",
              borderRadius: "var(--r-sm)",
              background: "var(--danger-bg)",
            }}
          >
            {message}
          </p>
        ) : null}

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
