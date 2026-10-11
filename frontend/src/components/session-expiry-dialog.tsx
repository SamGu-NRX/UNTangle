"use client";

import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { COPY, type SessionRecoveryState } from "@/lib/session-recovery";

type SessionExpiryDialogProps = {
  recovery: SessionRecoveryState;
  onRetry: () => void;
  onDismiss: () => void;
  onSignIn: () => void;
};

/** The expiry overlay only belongs on app pages, never on auth or /dev. */
function isExemptPath(pathname: string | null): boolean {
  return pathname === "/sign-in" || (pathname?.startsWith("/dev") ?? false);
}

export function SessionExpiryDialog({
  recovery,
  onRetry,
  onDismiss,
  onSignIn,
}: SessionExpiryDialogProps) {
  const pathname = usePathname();
  const showDialog = recovery.dialogOpen && !isExemptPath(pathname);

  if (showDialog) {
    return (
      <Modal open onClose={onDismiss} maxWidth={480} title={
        <div>
          <p className="editorial-label">Session ended</p>
          <p style={{ marginTop: "0.25rem", color: "var(--brand-700, #3b5aa0)", fontSize: "0.9rem" }}>
            Your plan is safe
          </p>
        </div>
      }>
        <p style={{ margin: 0 }}>{recovery.message}</p>
        <div style={{ display: "flex", gap: "0.6rem", marginTop: "1.25rem", flexWrap: "wrap" }}>
          <Button type="button" onClick={onRetry} disabled={recovery.retrying}>
            {recovery.retrying ? COPY.retryingMessage : COPY.retry}
          </Button>
          <Button type="button" variant="secondary" onClick={onSignIn}>
            {COPY.signIn}
          </Button>
          <Button type="button" variant="ghost" onClick={onDismiss}>
            {COPY.dismiss}
          </Button>
        </div>
      </Modal>
    );
  }

  if (recovery.banner) {
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
        <span>{recovery.banner}</span>
        <button type="button" className="btn-ghost" onClick={onSignIn}>
          {COPY.signIn}
        </button>
      </div>
    );
  }

  return null;
}
