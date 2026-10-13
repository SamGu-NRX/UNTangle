"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextField } from "@/components/ui/TextField";

export type SetPasswordResult = { ok: true } | { ok: false; code?: string; message?: string };

/** POST /api/account/set-password (lib/account-password.ts) with this browser's session. */
export async function requestSetPassword(newPassword: string): Promise<SetPasswordResult> {
  const response = await fetch("/api/account/set-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ newPassword }),
  });
  if (response.ok) return { ok: true };
  const body = (await response.json().catch(() => ({}))) as { code?: string; message?: string };
  return { ok: false, ...body };
}

/** What to tell the student for each refusal, in their terms. */
function refusalText(result: Extract<SetPasswordResult, { ok: false }>): string {
  switch (result.code) {
    case "PASSWORD_ALREADY_SET":
      return "This account already has a password. To change it, sign out and use Forgot password.";
    case "SESSION_NOT_FRESH":
      return "For your safety, sign in again with a link, then set the password.";
    case "PASSWORD_TOO_SHORT":
      return "Use at least 8 characters.";
    default:
      return result.message ?? "The password couldn't be set. Try again in a minute.";
  }
}

/**
 * "Set a password" from the account menu: an optional second way in for an
 * account made by a sign-in link. Afterwards "Use a password instead" on
 * the sign-in page works for it.
 */
export function SetPasswordDialog({
  open,
  onOpenChange,
  setPassword = requestSetPassword,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  setPassword?: (newPassword: string) => Promise<SetPasswordResult>;
}) {
  const [password, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function close(next: boolean) {
    if (!next) {
      setValue("");
      setError(null);
      setDone(false);
    }
    onOpenChange(next);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    const result = await setPassword(password);
    setBusy(false);
    if (result.ok) {
      setDone(true);
      return;
    }
    setError(refusalText(result));
    inputRef.current?.focus();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title="Set a password"
      width={400}
      initialFocus={inputRef}
      footer={
        done ? (
          <Button onClick={() => close(false)}>Done</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" form="set-password-form" loading={busy} loadingLabel="Saving…">
              Set password
            </Button>
          </>
        )
      }
    >
      {done ? (
        <p role="status">Password set. On the sign-in page, choose &ldquo;Use a password instead&rdquo; to use it.</p>
      ) : (
        <form id="set-password-form" onSubmit={submit} noValidate>
          <p className="shell-dialog-lede">Optional: sign-in links keep working either way.</p>
          <TextField
            ref={inputRef}
            label="New password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            help="At least 8 characters."
            error={error}
          />
        </form>
      )}
    </Dialog>
  );
}
