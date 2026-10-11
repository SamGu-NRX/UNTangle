"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import {
  linkErrorMessage,
  sendMagicLink,
} from "@/lib/magic-link-flow";

function LinkErrorInner() {
  const params = useSearchParams();
  const message = linkErrorMessage(params.get("error"));
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || sending) {
      return;
    }
    setSending(true);
    setErrorMessage(null);
    const result = await sendMagicLink(fetch, trimmed);
    setSending(false);
    if (result.ok) {
      setSentTo(trimmed);
    } else {
      setErrorMessage(result.message);
    }
  };

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: "4rem 1.5rem" }}>
      <h1 style={{ fontSize: "1.5rem", margin: 0 }}>Sign-in link problem</h1>
      <p role="alert" style={{ marginTop: "0.75rem" }}>
        {message}
      </p>
      {sentTo ? (
        <p role="status" style={{ marginTop: "1rem", fontWeight: 600 }}>
          A fresh link is on its way to {sentTo}. Check your UNT inbox.
        </p>
      ) : (
        <form onSubmit={submit} style={{ marginTop: "1.5rem" }}>
          <label
            htmlFor="link-error-email"
            style={{ display: "block", fontSize: "0.9rem", marginBottom: "0.35rem" }}
          >
            UNT email
          </label>
          <input
            id="link-error-email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            style={{
              width: "100%",
              padding: "0.5rem 0.65rem",
              borderRadius: "8px",
              border: "1px solid var(--brand-200, #c7d7f5)",
              fontSize: "0.95rem",
            }}
          />
          {errorMessage ? (
            <p role="alert" style={{ margin: "0.5rem 0 0", color: "var(--danger-700, #b4232a)" }}>
              {errorMessage}
            </p>
          ) : null}
          <div style={{ display: "flex", gap: "0.6rem", marginTop: "1.25rem", flexWrap: "wrap" }}>
            <Button type="submit" disabled={sending}>
              {sending ? "Sending a fresh link…" : "Email me a fresh link"}
            </Button>
            <Link href="/sign-in" className="btn-ghost">
              Back to sign-in
            </Link>
          </div>
        </form>
      )}
    </main>
  );
}

export default function LinkErrorPage() {
  return (
    <Suspense fallback={null}>
      <LinkErrorInner />
    </Suspense>
  );
}
