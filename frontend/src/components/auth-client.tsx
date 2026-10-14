"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AuthShell, OPEN_SIGN_IN_EVENT, type OpenSignInDetail } from "@/components/auth-shell";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button, IconButton } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Close } from "@/components/ui/icons";
import { TextField } from "@/components/ui/TextField";
import { toast } from "@/components/ui/Toast";
import { PHONE_QUERY, useMediaQuery } from "@/components/ui/use-media-query";
import { authClient } from "@/lib/auth-client";
import { isUntEmail, untEmailRequirementMessage } from "@/lib/unt-auth";
import { useFieldError } from "@/components/use-field-error";

type Result = { error: { message?: string; code?: string } | null };

/** The two server calls sign-in makes; a seam for tests. */
export type AuthApi = {
  sendLink(email: string): Promise<Result>;
  signIn(email: string, password: string): Promise<Result>;
};

export const AFTER_SIGN_IN = "/courses";

export const liveApi: AuthApi = {
  sendLink: (email) =>
    authClient.signIn.magicLink({
      email,
      callbackURL: AFTER_SIGN_IN,
      newUserCallbackURL: AFTER_SIGN_IN,
      // better-auth appends &error=… (e.g. EXPIRED_TOKEN) when a link fails.
      errorCallbackURL: "/auth?link=failed",
    }),
  signIn: (email, password) => authClient.signIn.email({ email, password }),
};

/** How long "Resend link" waits after a send. The server allows 5 requests a minute. */
export const RESEND_COOLDOWN_S = 30;

type View = "link" | "sent" | "password";
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

/** /auth, the deep link: the same form in a card on the page, leaving for Courses afterwards. */
export function AuthClient({ emailInServerLog, linkFailed }: { emailInServerLog: boolean; linkFailed: boolean }) {
  const router = useRouter();
  return (
    <AuthShell>
      <AuthPanel
        api={liveApi}
        onContinue={() => router.push(AFTER_SIGN_IN)}
        onGuest={() => router.push(AFTER_SIGN_IN)}
        emailInServerLog={emailInServerLog}
        linkFailed={linkFailed}
      />
    </AuthShell>
  );
}

/**
 * Sign-in leads with a link emailed to the student's UNT address; that is
 * also how an account is created. A password is the secondary path, for
 * accounts that set one while signed in (account menu, "Set a password"),
 * and it opens in place in the same form. Errors appear as help text under
 * the field they concern, never as a red box.
 *
 * The copy promises nothing about what happens to a guest's schedule on
 * sign-in: the planner loads the account's own schedule and does not merge
 * the guest's into it (planner-provider.tsx, the registered bootstrap).
 */
export function AuthPanel({
  api,
  onContinue,
  emailInServerLog,
  linkFailed,
  headingLevel = 1,
  headingId,
  emailInputRef,
  onGuest,
}: {
  api: AuthApi;
  /** After a password sign-in succeeds. */
  onContinue: () => void;
  /** On the /auth page, "Continue as guest" leaves for the plan; over a page, closing the form does that. */
  onGuest?: () => void;
  /** Development without an email provider: the link is in the server log, and the form says so. */
  emailInServerLog: boolean;
  /** Came back from a sign-in link that had expired or was already used. */
  linkFailed: boolean;
  /** 2 inside a dialog over a page that has its own h1. */
  headingLevel?: 1 | 2;
  /** Lets a dialog take its name from the heading, which changes with the step. */
  headingId?: string;
  /** The email field, for a dialog to focus when it opens. */
  emailInputRef?: RefObject<HTMLInputElement | null>;
}) {
  const [view, setView] = useState<View>("link");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
  const ownId = useId();
  const titleId = headingId ?? `${ownId}-title`;

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
    const response = await api.signIn(email, password);
    setIsSubmitting(false);
    if (response.error?.code === "EMAIL_NOT_VERIFIED") {
      fail({ field: "email", text: "This account isn't verified. Email yourself a sign-in link instead." });
      return;
    }
    if (response.error) {
      fail(placeServerError(response.error.message ?? "Sign-in failed. Check your email and password.", "password"));
      return;
    }
    onContinue();
  }

  function goTo(next: View) {
    setError(null);
    setView(next);
  }

  const Heading = headingLevel === 1 ? "h1" : "h2";
  const title = view === "sent" ? "Check your UNT email" : view === "password" ? "Sign in with a password" : "Sign in";
  const serverLogNote = emailInServerLog ? (
    <p className="auth__note">Email isn&apos;t set up here; the link is in the server log.</p>
  ) : null;
  const emailField = (
    <TextField
      ref={(node) => {
        emailRef.current = node;
        if (emailInputRef) emailInputRef.current = node;
      }}
      label="UNT email"
      type="email"
      inputMode="email"
      // DESIGN.md §4.6: "username" lets a password manager pair this address with the password below.
      autoComplete="username"
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      value={email}
      onChange={(e) => {
        setEmail(e.target.value);
        if (error?.field === "email") setError(null);
      }}
      placeholder="eagleid@my.unt.edu"
      error={error?.field === "email" ? error.text : null}
    />
  );

  return (
    <div className="auth__panel">
      <Heading id={titleId} className="auth__title" ref={headingRef} tabIndex={-1}>
        {title}
      </Heading>

      {view === "link" && (
        <>
          <p className="auth__lede">
            Use your @unt.edu or @my.unt.edu email. We&apos;ll email you a sign-in link. No password needed.
          </p>
          <form className="auth__form" onSubmit={handleLink} noValidate>
            {emailField}
            <Button type="submit" size="lg" className="auth__submit" loading={isSubmitting} loadingLabel="Sending…">
              Email me a sign-in link
            </Button>
          </form>
          {serverLogNote}
          <Button variant="quiet" className="auth__alt" onClick={() => goTo("password")}>
            Use a password instead
          </Button>
        </>
      )}

      {view === "sent" && (
        <>
          <p className="auth__lede" role="status">
            We sent a sign-in link to <strong>{email.trim()}</strong>. It works once and expires in 5 minutes.
          </p>
          {serverLogNote}
          <Button
            variant="secondary"
            size="lg"
            className="auth__submit"
            loading={isSubmitting}
            loadingLabel="Sending…"
            disabled={cooling}
            onClick={() => void sendLink()}
          >
            {cooling ? `Resend link in ${secondsLeft}s` : "Resend link"}
          </Button>
          <div className="auth__alts">
            <Button variant="quiet" className="auth__alt" onClick={() => goTo("link")}>
              Use a different email
            </Button>
            <Button variant="quiet" className="auth__alt" onClick={() => goTo("password")}>
              Use a password instead
            </Button>
          </div>
        </>
      )}

      {view === "password" && (
        <>
          <p className="auth__lede">
            For accounts that have set a password. New here, or never set one? Email yourself a sign-in link.
          </p>
          <form className="auth__form" onSubmit={handlePassword} noValidate>
            {emailField}
            <TextField
              ref={passwordRef}
              label="Password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error?.field === "password") setError(null);
              }}
              autoComplete="current-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              labelAside={
                <Link href="/forgot-password" className="auth__aside">
                  Forgot it?
                </Link>
              }
              trailing={
                <button type="button" className="auth__show" onClick={() => setShowPassword((on) => !on)}>
                  {showPassword ? "Hide" : "Show"}
                  <span className="sr-only-v2"> password</span>
                </button>
              }
              error={error?.field === "password" ? error.text : null}
            />
            <Button type="submit" size="lg" className="auth__submit" loading={isSubmitting} loadingLabel="Signing in…">
              Sign in
            </Button>
          </form>
          <Button variant="quiet" className="auth__alt" onClick={() => goTo("link")}>
            Email me a link instead
          </Button>
        </>
      )}

      <p className="sr-only-v2" aria-live="assertive" aria-atomic="true">
        {fieldError.announcement}
      </p>
      <div className="auth__foot">
        <p>You can use UNTangle without an account.</p>
        {onGuest ? (
          <Button variant="quiet" size="sm" onClick={onGuest}>
            Continue as guest
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The sign-in form over whatever page is showing (DESIGN.md §4.6): a
 * dialog on desktop, a sheet on a phone, held from opening until it closes,
 * so a rotation never remounts a half-typed form. The
 * shell mounts one; a Sign in link opens it with `openSignIn`.
 *
 * Escape, the scrim, the close button, a session arriving and a route
 * change (Forgot it?) all close it, and focus goes back to the Sign in
 * control that opened it. Closed, it renders nothing, so nothing in it can
 * take focus.
 *
 * Only /auth can say "the link is in the server log": that needs the
 * server's environment, which this client-side host doesn't have.
 */
export function SignInHost() {
  const pathname = usePathname();
  const signedIn = Boolean(authClient.useSession().data?.user);
  return <SignInLayer api={liveApi} pathname={pathname} signedIn={signedIn} />;
}

/** SignInHost without the router and session hooks, so tests can drive it. */
export function SignInLayer({ api, pathname, signedIn }: { api: AuthApi; pathname: string | null; signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  // The container follows the screen while closed and holds while open, so the one that
  // opens is already mounted closed: it sees the open change, and a keyboard open doesn't move.
  const live = useMediaQuery(PHONE_QUERY);
  const [phone, setPhone] = useState(live);
  if (!open && phone !== live) setPhone(live);
  const trigger = useRef<HTMLElement | null>(null);
  const emailRef = useRef<HTMLInputElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const onOpen = (event: Event) => {
      // Claimed: the link that sent it stays on this page.
      event.preventDefault();
      trigger.current = (event as CustomEvent<OpenSignInDetail>).detail?.trigger ?? null;
      setOpen(true);
    };
    window.addEventListener(OPEN_SIGN_IN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_SIGN_IN_EVENT, onOpen);
  }, []);

  const [seen, setSeen] = useState({ pathname, signedIn });
  if (seen.pathname !== pathname || seen.signedIn !== signedIn) {
    setSeen({ pathname, signedIn });
    if (open) setOpen(false);
  }

  // Once the session lands the Sign in link is gone (the bar shows the account), so main takes focus.
  const returnFocus = () => (trigger.current?.isConnected ? trigger.current : document.getElementById("main"));

  const panel = (
    <AuthPanel
      api={api}
      onContinue={() => {
        setOpen(false);
        toast("Signed in");
      }}
      emailInServerLog={false}
      linkFailed={false}
      headingLevel={2}
      headingId={titleId}
      emailInputRef={emailRef}
    />
  );

  if (phone) {
    return (
      <BottomSheet
        open={open}
        onOpenChange={setOpen}
        title="Sign in"
        detents={["92%"]}
        initialFocus={emailRef}
        returnFocus={returnFocus}
        className="auth-sheet"
        header={
          <div className="auth-sheet__head">
            <span className="auth__wordmark auth__wordmark--sm">UNTangle</span>
            <IconButton label="Close" size="sm" onClick={() => setOpen(false)}>
              <Close />
            </IconButton>
          </div>
        }
      >
        {panel}
      </BottomSheet>
    );
  }
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={<span className="auth__wordmark auth__wordmark--sm">UNTangle</span>}
      labelledBy={titleId}
      width={440}
      initialFocus={emailRef}
      returnFocus={returnFocus}
      className="auth-dialog"
    >
      {panel}
    </Dialog>
  );
}
