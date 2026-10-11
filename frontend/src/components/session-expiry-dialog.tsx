"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { sendMagicLink } from "@/lib/magic-link-flow";
import {
  isExemptPath,
  onSessionExpired,
  pollForSessionRestored,
} from "@/lib/session-events";

const COPY = {
  title: "Session ended",
  subtitle: "Your plan is safe",
  explanation:
    "You were signed out, so the last save was refused. Your changes are still in this tab — nothing was lost.",
  emailLabel: "UNT email",
  sendButton: "Email me a sign-in link",
  sendingButton: "Sending the link…",
  sentMessage:
    "Check your UNT inbox and open the newest sign-in link. This page stays open — when you are signed back in, saving resumes automatically.",
  waitingButton: "Waiting for the sign-in…",
  failedMessage:
    "We have not seen the sign-in yet. You can request another link, or dismiss this and try again later.",
  retryButton: "Request another link",
  dismissButton: "Dismiss",
  restoredNote: "Signed back in. Your changes were saved automatically.",
  banner: "Not saved: you were signed out. Your changes are kept in this tab.",
  bannerReconnect: "Reconnect",
};

type Phase = "closed" | "form" | "sent" | "failed";
type Notice = "restored" | "dismissed" | null;

/**
 * Session-expiry recovery, mounted app-wide by Providers — never by the
 * planner provider, which PR #8 owns. Reacts to notifySessionExpired(),
 * signs the user back in in place through the existing magic-link endpoint,
 * and emits restore by polling the existing get-session route, so the
 * planner's in-memory edits survive without any navigation.
 */
export function SessionExpiryDialog() {
  const pathname = usePathname();
  const [phase, setPhase] = useState<Phase>("closed");
  const [notice, setNotice] = useState<Notice>(null);
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const pollGeneration = useRef(0);

  useEffect(() => {
    const unsubscribe = onSessionExpired(() => {
      setNotice(null);
      setErrorMessage(null);
      setPhase("form");
    });
    return unsubscribe;
  }, []);

  if (isExemptPath(pathname)) {
    return null;
  }

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
      setPhase("sent");
      const generation = pollGeneration.current + 1;
      pollGeneration.current = generation;
      const restored = await pollForSessionRestored();
      if (pollGeneration.current !== generation) {
        return;
      }
      if (restored) {
        setPhase("closed");
        setNotice("restored");
        setTimeout(() => {
          setNotice((current) => (current === "restored" ? null : current));
        }, 6000);
      } else {
        setPhase("failed");
      }
    } else {
      setErrorMessage(result.message);
    }
  };

  const dismiss = () => {
    pollGeneration.current += 1;
    setPhase("closed");
    setNotice("dismissed");
  };

  if (phase !== "closed") {
    return (
      <Modal
        open
        onClose={dismiss}
        maxWidth={480}
        title={
          <div>
            <p className="editorial-label">{COPY.title}</p>
            <p
              style={{
                marginTop: "0.25rem",
                color: "var(--brand-700, #3b5aa0)",
                fontSize: "0.9rem",
              }}
            >
              {COPY.subtitle}
            </p>
          </div>
        }
      >
        <p style={{ margin: 0 }}>{COPY.explanation}</p>
        {phase === "form" ? (
          <form onSubmit={submit} style={{ marginTop: "1rem" }}>
            <label
              htmlFor="session-expiry-email"
              style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.35rem" }}
            >
              {COPY.emailLabel}
            </label>
            <input
              id="session-expiry-email"
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
            <div
              style={{
                display: "flex",
                gap: "0.6rem",
                marginTop: "1.25rem",
                flexWrap: "wrap",
              }}
            >
              <Button type="submit" disabled={sending}>
                {sending ? COPY.sendingButton : COPY.sendButton}
              </Button>
              <Button type="button" variant="ghost" onClick={dismiss}>
                {COPY.dismissButton}
              </Button>
            </div>
          </form>
        ) : null}
        {phase === "sent" ? (
          <div style={{ marginTop: "1rem" }}>
            <p style={{ margin: 0 }}>{COPY.sentMessage}</p>
            <p style={{ margin: "0.75rem 0 0", fontWeight: 600 }} role="status">
              {COPY.waitingButton}
            </p>
          </div>
        ) : null}
        {phase === "failed" ? (
          <div style={{ marginTop: "1rem" }}>
            <p style={{ margin: 0 }}>{COPY.failedMessage}</p>
            <div
              style={{
                display: "flex",
                gap: "0.6rem",
                marginTop: "1.25rem",
                flexWrap: "wrap",
              }}
            >
              <Button type="button" onClick={() => setPhase("form")}>
                {COPY.retryButton}
              </Button>
              <Button type="button" variant="ghost" onClick={dismiss}>
                {COPY.dismissButton}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    );
  }

  if (notice) {
    return (
      <div
        role="status"
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 60,
          display: "flex",
          gap: "0.75rem",
          alignItems: "center",
          justifyContent: "center",
          flexWrap: "wrap",
          padding: "0.6rem 1rem",
          background: "var(--brand-50, #eef4ff)",
          borderTop: "1px solid var(--brand-200, #c7d7f5)",
          fontSize: "0.85rem",
          color: "var(--brand-900, #14264d)",
        }}
      >
        <span>{notice === "restored" ? COPY.restoredNote : COPY.banner}</span>
        {notice === "dismissed" ? (
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              setNotice(null);
              setPhase("form");
            }}
          >
            {COPY.bannerReconnect}
          </button>
        ) : null}
      </div>
    );
  }

  return null;
}
