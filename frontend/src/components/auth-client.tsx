"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";
import { TextField } from "@/components/ui/TextField";
import { authClient } from "@/lib/auth-client";
import { isUntEmail, untEmailRequirementMessage } from "@/lib/unt-auth";
import { useFieldError } from "@/components/use-field-error";

type Result = { error: { message?: string } | null };

/** The three server calls the sign-in page makes; a seam for tests. */
export type AuthApi = {
  sendLink(email: string): Promise<Result>;
  signIn(email: string, password: string): Promise<Result>;
  signUp(email: string, password: string, name: string): Promise<Result>;
};

const AFTER_SIGN_IN = "/courses";

const liveApi: AuthApi = {
  sendLink: (email) =>
    authClient.signIn.magicLink({
      email,
      callbackURL: AFTER_SIGN_IN,
      newUserCallbackURL: AFTER_SIGN_IN,
      // better-auth appends &error=… (e.g. EXPIRED_TOKEN) when a link fails.
      errorCallbackURL: "/auth?link=failed",
    }),
  signIn: (email, password) => authClient.signIn.email({ email, password }),
  signUp: (email, password, name) =>
    authClient.signUp.email({ email, password, name: name || email, callbackURL: AFTER_SIGN_IN }),
};

/** How long "Resend link" waits after a send. The server allows 5 requests a minute. */
export const RESEND_COOLDOWN_S = 30;

type View = "link" | "sent" | "password" | "verify";
type PasswordMode = "signIn" | "signUp";
type FieldError = { field: "email" | "password"; text: string };

/**
 * Where a server error belongs: an email-specific message under Email,
 * everything else (wrong password, unknown account) under Password, the
 * field a person retries.
 */
function placeServerError(message: string, view: View): FieldError {
  if (view !== "password") return { field: "email", text: message };
  return { field: /email/i.test(message) && !/password/i.test(message) ? "email" : "password", text: message };
}

export function AuthClient({ emailInServerLog, linkFailed }: { emailInServerLog: boolean; linkFailed: boolean }) {
  const router = useRouter();
  return (
    <AuthPanel
      api={liveApi}
      onContinue={() => router.push(AFTER_SIGN_IN)}
      emailInServerLog={emailInServerLog}
      linkFailed={linkFailed}
    />
  );
}

/**
 * Sign-in leads with a link emailed to the student's UNT address; a
 * password is the secondary path. Errors appear as help text under the
 * field they concern, never as a red box.
 */
export function AuthPanel({
  api,
  onContinue,
  emailInServerLog,
  linkFailed,
}: {
  api: AuthApi;
  /** Leaves for the plan: after signing in, or as a guest. */
  onContinue: () => void;
  /** Development without an email provider: the link is in the server log, and the page says so. */
  emailInServerLog: boolean;
  /** Came back from a sign-in link that had expired or was already used. */
  linkFailed: boolean;
}) {
  const [view, setView] = useState<View>("link");
  const [mode, setMode] = useState<PasswordMode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<FieldError | null>(
    linkFailed ? { field: "email", text: "That sign-in link expired or was already used. Send a new one." } : null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(0);
  const emailRef = useRef<HTMLInputElement | null>(null);
  const passwordRef = useRef<HTMLInputElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const fieldError = useFieldError();

  // A new view moves focus to its heading (after the first render), so the change is announced.
  const firstView = useRef(true);
  useEffect(() => {
    if (firstView.current) {
      firstView.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [view]);

  // Ticks only while "Resend link" is cooling down.
  const cooling = view === "sent" && now < resendAt;
  useEffect(() => {
    if (!cooling) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [cooling]);
  const secondsLeft = Math.max(0, Math.ceil((resendAt - now) / 1000));

  function fail(next: FieldError) {
    setError(next);
    fieldError.report((next.field === "email" ? emailRef : passwordRef).current, next.text);
  }

  function checkEmail(): boolean {
    if (isUntEmail(email)) return true;
    fail({ field: "email", text: untEmailRequirementMessage() });
    return false;
  }

  async function sendLink() {
    setIsSubmitting(true);
    setError(null);
    const response = await api.sendLink(email.trim());
    setIsSubmitting(false);
    if (response.error) {
      if (view === "sent") setView("link");
      fail({ field: "email", text: response.error.message ?? "The sign-in link couldn't be sent. Try again in a minute." });
      return;
    }
    const sentAt = Date.now();
    setNow(sentAt);
    setResendAt(sentAt + RESEND_COOLDOWN_S * 1000);
    setView("sent");
  }

  async function handleLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (checkEmail()) await sendLink();
  }

  async function handlePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!checkEmail()) return;
    if (password.length < 8) {
      fail({ field: "password", text: "Use at least 8 characters." });
      return;
    }
    setIsSubmitting(true);
    setError(null);
    const response = mode === "signIn" ? await api.signIn(email, password) : await api.signUp(email, password, name);
    setIsSubmitting(false);
    if (response.error) {
      fail(
        placeServerError(
          response.error.message ?? (mode === "signIn" ? "Sign-in failed. Check your email and password." : "The account could not be created."),
          "password",
        ),
      );
      return;
    }
    if (mode === "signUp") setView("verify");
    else onContinue();
  }

  function goTo(next: View) {
    setError(null);
    setView(next);
  }

  const serverLogNote = emailInServerLog ? (
    <p className="auth__note">Email isn&apos;t set up here; the link is in the server log.</p>
  ) : null;
  const emailField = (
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
  );

  return (
    <AuthShell>
      {view === "link" && (
        <>
          <h1 className="auth__title" ref={headingRef} tabIndex={-1}>
            Sign in
          </h1>
          <p className="auth__lede">Use your @unt.edu or @my.unt.edu email. We&apos;ll email you a link that signs you in.</p>
          <form className="auth__form" onSubmit={handleLink} noValidate>
            {emailField}
            <Button type="submit" className="auth__submit" loading={isSubmitting} loadingLabel="Sending…">
              Email me a sign-in link
            </Button>
          </form>
          {serverLogNote}
          <Button variant="quiet" className="auth__guest" onClick={() => goTo("password")}>
            Use a password instead
          </Button>
        </>
      )}

      {view === "sent" && (
        <>
          <h1 className="auth__title" ref={headingRef} tabIndex={-1}>
            Check your UNT email
          </h1>
          <p className="auth__lede" role="status">
            We sent a sign-in link to <strong>{email.trim()}</strong>. It works once and expires in 5 minutes.
          </p>
          {serverLogNote}
          <Button
            variant="ghost"
            className="auth__submit"
            loading={isSubmitting}
            loadingLabel="Sending…"
            disabled={cooling}
            onClick={() => void sendLink()}
          >
            {cooling ? `Resend link in ${secondsLeft}s` : "Resend link"}
          </Button>
          <Button variant="quiet" className="auth__guest" onClick={() => goTo("link")}>
            Use a different email
          </Button>
          <Button variant="quiet" className="auth__guest" onClick={() => goTo("password")}>
            Use a password instead
          </Button>
        </>
      )}

      {view === "password" && (
        <>
          <h1 className="auth__title" ref={headingRef} tabIndex={-1}>
            {mode === "signIn" ? "Sign in with a password" : "Create your account"}
          </h1>
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
          <form className="auth__form" onSubmit={handlePassword} noValidate>
            {mode === "signUp" ? (
              <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            ) : null}
            {emailField}
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
          <Button variant="quiet" className="auth__guest" onClick={() => goTo("link")}>
            Email me a link instead
          </Button>
        </>
      )}

      {view === "verify" && (
        <>
          <h1 className="auth__title" ref={headingRef} tabIndex={-1}>
            Verify your email
          </h1>
          <p className="auth__lede" role="status">
            Your account is ready. We sent a verification link to <strong>{email.trim()}</strong>; open it when you can.
          </p>
          {serverLogNote}
          <Button className="auth__submit" onClick={onContinue}>
            Continue to your plan
          </Button>
        </>
      )}

      <p className="sr-only-v2" aria-live="assertive" aria-atomic="true">
        {fieldError.announcement}
      </p>

      {view !== "verify" && (
        <Button variant="quiet" className="auth__guest" onClick={onContinue}>
          Continue as guest
        </Button>
      )}

      <p className="auth__foot">
        <Link href="/forgot-password">Forgot password?</Link>
        <Link href="/" className="auth__foot-quiet">
          Back home
        </Link>
      </p>
    </AuthShell>
  );
}
