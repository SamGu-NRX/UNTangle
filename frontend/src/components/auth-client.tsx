"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";
import { TextField } from "@/components/ui/TextField";
import { authClient } from "@/lib/auth-client";
import { isUntEmail, untEmailRequirementMessage } from "@/lib/unt-auth";
import { useFieldError } from "@/components/use-field-error";

type Mode = "signIn" | "signUp";
type FieldError = { field: "email" | "password"; text: string };

/**
 * Where a server error belongs: an email-specific message under Email,
 * everything else (wrong password, unknown account) under Password, the
 * field a person retries.
 */
function placeServerError(message: string): FieldError {
  return { field: /email/i.test(message) && !/password/i.test(message) ? "email" : "password", text: message };
}

/**
 * Password sign-in and sign-up with a UNT email. One path, one primary
 * button. Errors appear as help text under the field they concern, and
 * focus moves there, never as a red box.
 */
export function AuthClient() {
  const [mode, setMode] = useState<Mode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<FieldError | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const emailRef = useRef<HTMLInputElement | null>(null);
  const passwordRef = useRef<HTMLInputElement | null>(null);
  const router = useRouter();
  const fieldError = useFieldError();

  function fail(next: FieldError) {
    setError(next);
    fieldError.report((next.field === "email" ? emailRef : passwordRef).current, next.text);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isUntEmail(email)) {
      fail({ field: "email", text: untEmailRequirementMessage() });
      return;
    }
    if (password.length < 8) {
      fail({ field: "password", text: "Use at least 8 characters." });
      return;
    }
    setIsSubmitting(true);
    setError(null);
    const response =
      mode === "signIn"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name: name || email });
    setIsSubmitting(false);
    if (response.error) {
      fail(placeServerError(response.error.message ?? (mode === "signIn" ? "Sign-in failed. Check your email and password." : "The account could not be created.")));
      return;
    }
    router.push("/courses");
  }

  return (
    <AuthShell>
      <h1 className="auth__title">{mode === "signIn" ? "Sign in" : "Create your account"}</h1>
      <p className="auth__lede">Use your @unt.edu or @my.unt.edu email. Your plan then saves to your account.</p>

      <Segmented
        label="Account"
        fullWidth
        value={mode}
        onValueChange={(next) => {
          setMode(next);
          setError(null);
        }}
        options={[
          { value: "signIn", label: "Sign in" },
          { value: "signUp", label: "Create account" },
        ]}
      />

      <form className="auth__form" onSubmit={handleSubmit} noValidate>
        {mode === "signUp" ? (
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        ) : null}
        <TextField
          ref={emailRef}
          label="UNT email"
          type="email"
          inputMode="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (error?.field === "email") setError(null);
          }}
          placeholder="eagleid@my.unt.edu"
          autoComplete="email"
          error={error?.field === "email" ? error.text : null}
        />
        <TextField
          ref={passwordRef}
          label="Password"
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (error?.field === "password") setError(null);
          }}
          autoComplete={mode === "signIn" ? "current-password" : "new-password"}
          help={mode === "signUp" ? "At least 8 characters." : undefined}
          error={error?.field === "password" ? error.text : null}
        />
        <Button
          type="submit"
          className="auth__submit"
          loading={isSubmitting}
          loadingLabel={mode === "signIn" ? "Signing in…" : "Creating account…"}
        >
          {mode === "signIn" ? "Sign in" : "Create account"}
        </Button>
      </form>

      <p className="sr-only-v2" aria-live="assertive" aria-atomic="true">
        {fieldError.announcement}
      </p>

      <Button variant="quiet" className="auth__guest" onClick={() => router.push("/courses")}>
        Continue as guest
      </Button>

      <p className="auth__foot">
        <Link href="/forgot-password">Forgot password?</Link>
        <Link href="/" className="auth__foot-quiet">
          Back home
        </Link>
      </p>
    </AuthShell>
  );
}
