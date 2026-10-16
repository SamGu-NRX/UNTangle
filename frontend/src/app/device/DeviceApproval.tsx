"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import styles from "./device.module.css";
import { isUntEmail, untEmailRequirementMessage } from "@/lib/unt-auth";
import { deviceGrantDetails, deviceScopes } from "../../../../packages/contracts/src/device-grant";

type Account = { id: string; email: string };
type Grant = {
  clientKind: "mobile" | "extension";
  scopes: string[];
  userCode: string;
  scheduleId: string | null;
};

class RequestError extends Error {
  constructor(public status: number, public retryAfterSeconds: number | null = null, public errorCode: string | null = null) {
    super("Device request failed");
  }
}

function retryAfterSeconds(value: string | null): number | null {
  if (value === null) return null;
  if (/^\d+$/.test(value)) {
    const seconds = Number(value);
    return Number.isSafeInteger(seconds) ? seconds : null;
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - Date.now()) / 1000)) : null;
}

async function post(path: string, body: object): Promise<unknown> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-UNTangle-Device": "1" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const errorCode = typeof body === "object" && body && "error" in body && typeof body.error === "string" ? body.error : null;
    throw new RequestError(response.status, retryAfterSeconds(response.headers.get("Retry-After")), errorCode);
  }
  return response.json();
}

async function getAccount(): Promise<Account | null> {
  const response = await fetch("/api/auth/get-session", { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new RequestError(response.status);
  const data: unknown = await response.json();
  if (data === null) return null;
  if (typeof data === "object" && data && "user" in data && typeof data.user === "object" && data.user
    && "id" in data.user && typeof data.user.id === "string" && "email" in data.user && typeof data.user.email === "string") {
    return { id: data.user.id, email: data.user.email };
  }
  throw new Error("Invalid session response");
}

function parseGrant(value: unknown): Grant {
  const grant = deviceGrantDetails.parse(value);
  const expected = deviceScopes[grant.clientKind];
  if (grant.scopes.length !== expected.length || !expected.every((scope) => grant.scopes.includes(scope))
    || (grant.clientKind === "extension" && !grant.scheduleId)) {
    throw new Error("Invalid device response");
  }
  return grant;
}

function requestMessage(error: unknown, fallback: string): string {
  if (error instanceof RequestError && error.status === 429) {
    return error.retryAfterSeconds === null ? "Too many attempts. Wait before trying again."
      : `Too many attempts. Wait ${error.retryAfterSeconds} seconds before trying again.`;
  }
  return fallback;
}

export function DeviceApproval({ initialUserCode = "" }: { initialUserCode?: string }) {
  const [userCode, setUserCode] = useState(initialUserCode);
  const [grant, setGrant] = useState<Grant | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [sessionState, setSessionState] = useState<"loading" | "ready" | "error">("loading");
  const [email, setEmail] = useState("");
  // The server refuses a non-UNT address with a 400 the page can't tell from a network failure, so check first.
  const [emailError, setEmailError] = useState("");
  const [otp, setOtp] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showBusy, setShowBusy] = useState(false);
  const [result, setResult] = useState<"approved" | "denied" | null>(null);
  const inFlight = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const otpField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    getAccount().then((user) => {
      if (!active) return;
      setAccount(user);
      setSessionState("ready");
    }).catch(() => {
      if (active) setSessionState("error");
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (grant || result) heading.current?.focus();
  }, [grant, result, account?.id]);

  useEffect(() => {
    if (codeSent) otpField.current?.focus();
  }, [codeSent]);

  useEffect(() => {
    if (!busy) return;
    const timer = setTimeout(() => setShowBusy(true), 400);
    return () => clearTimeout(timer);
  }, [busy]);

  async function run(action: () => Promise<void>, fallback: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try { await action(); }
    catch (caught) { setError(requestMessage(caught, fallback)); }
    finally { inFlight.current = false; setBusy(false); setShowBusy(false); }
  }

  function inspect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(async () => {
      setGrant(parseGrant(await post("/api/v1/device/inspect", { userCode: userCode.trim() })));
    }, "That device code is invalid, expired or already used. Start again in the app and enter its new code.");
  }

  function sendEmailCode(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!isUntEmail(email)) {
      setEmailError(untEmailRequirementMessage());
      return;
    }
    void run(async () => {
      await post("/api/auth/email-otp/send-verification-otp", { email: email.trim(), type: "sign-in" });
      setCodeSent(true);
      setOtp("");
      setMessage("Check your inbox for the sign-in code. Enter it here.");
    }, "Couldn't send a sign-in code. Check your email address and connection, then try again.");
  }

  function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(async () => {
      await post("/api/auth/sign-in/email-otp", { email: email.trim(), otp: otp.trim() });
      const user = await getAccount();
      if (!user) throw new Error("Missing session after sign-in");
      setAccount(user);
      setSessionState("ready");
      setOtp("");
      setCodeSent(false);
    }, "That sign-in code couldn't be verified. Try again or request a new code.");
  }

  function decide(decision: "approve" | "deny") {
    if (!grant || !account) return;
    void run(async () => {
      try {
        const value = await post("/api/v1/device/approve", { userCode: grant.userCode, decision, expectedUserId: account.id });
        if (typeof value !== "object" || !value || !("status" in value) || value.status !== (decision === "approve" ? "approved" : "denied")) {
          throw new Error("Invalid approval response");
        }
        setResult(decision === "approve" ? "approved" : "denied");
      } catch (caught) {
        if (caught instanceof RequestError && caught.status === 409 && caught.errorCode === "account_changed") {
          setAccount(null);
          setSessionState("error");
          const currentAccount = await getAccount();
          setAccount(currentAccount);
          setCodeSent(false);
          setSessionState("ready");
          setError("Your signed-in account changed. Review the account before approving.");
          return;
        }
        if (caught instanceof RequestError && caught.status === 401) {
          setAccount(null);
          setCodeSent(false);
          setSessionState("ready");
          setError("Your sign-in expired. Sign in again before deciding.");
          return;
        }
        throw caught;
      }
    }, "Couldn't save your decision. The code may have expired or already been used. Start again in the app if retrying doesn't work.");
  }

  return (
    <main className={styles.page} aria-labelledby="device-title">
      <h1 id="device-title" ref={heading} tabIndex={-1} className={styles.title}>
        {result === "approved" ? "Device approved" : result === "denied" ? "Device denied" : "Connect a device"}
      </h1>
      {result ? (
        <p role="status">{result === "approved"
          ? grant?.clientKind === "extension"
            ? "Go back to myUNT class search. The extension finishes signing in within 60 seconds. If it doesn't, select Sign in in the extension again."
            : "Return to the app. Your device has 60 seconds to finish connecting. If it doesn't connect, start again in the app."
          : "This device wasn't connected. You can close this page."}</p>
      ) : !grant ? (
        <form className={styles.stack} onSubmit={inspect}>
          <p>Enter the device code shown in the UNTangle app or extension.</p>
          <TextField label="Device code" name="userCode" value={userCode} onChange={(event) => setUserCode(event.target.value)} required maxLength={32} autoCapitalize="characters" autoComplete="off" spellCheck={false} disabled={busy} error={error || undefined} />
          <Button type="submit" size="lg" disabled={busy}>Check device code</Button>
        </form>
      ) : (
        <div className={styles.stack}>
          <p className={styles.client}>{grant.clientKind === "mobile" ? "UNTangle mobile app" : "UNTangle browser extension"}</p>
          <p>Compare this code with the one in your app or extension.</p>
          <p className={styles.code}>{grant.userCode}</p>
          <p>Only approve if you started this request and both codes match.</p>
          <div className={styles.permissions}>
            <h2 className={styles.subtitle}>What this device can do</h2>
            {grant.clientKind === "mobile" ? <p>Read and change your saved plans and preferences</p> : <>
              <p>View the selected schedule</p>
              <p>Add a section after you confirm</p>
              <p className={styles.identifier}>Schedule identifier: {grant.scheduleId ?? "No schedule selected"}</p>
            </>}
            <p>It cannot change your password or delete your account.</p>
          </div>
          {sessionState === "loading" ? <p role="status">Checking your sign-in.</p>
            : sessionState === "error" ? <div className={styles.stack}>
              <p>Couldn&apos;t check your sign-in. Check your connection and try again.</p>
              <Button disabled={busy} onClick={() => void run(async () => {
                const user = await getAccount();
                setAccount(user);
                setSessionState("ready");
              }, "Couldn't check your sign-in. Check your connection and try again.")}>Check sign-in</Button>
            </div>
            : account ? <div className={styles.stack}>
              <p className={styles.identifier}>Signed in as {account.email}</p>
              <div className={styles.actions}>
                <Button size="lg" disabled={busy} onClick={() => decide("approve")}>Approve device</Button>
                <Button size="lg" variant="ink" disabled={busy} onClick={() => decide("deny")}>Deny device</Button>
              </div>
            </div>
            : !codeSent ? <form className={styles.stack} onSubmit={sendEmailCode}>
              <p>Sign in to choose whether to connect this device.</p>
              <TextField label="UNT email" name="email" type="email" autoComplete="email" autoCapitalize="none" value={email} onChange={(event) => { setEmail(event.target.value); setEmailError(""); }} required disabled={busy} help="Your @unt.edu or @my.unt.edu address." error={emailError || undefined} />
              <Button type="submit" size="lg" disabled={busy}>Send sign-in code</Button>
            </form>
            : <form className={styles.stack} onSubmit={signIn}>
              <p className={styles.identifier}>Sign-in code sent to {email.trim()}</p>
              <TextField ref={otpField} label="Email sign-in code" name="otp" inputMode="numeric" autoComplete="one-time-code" value={otp} onChange={(event) => setOtp(event.target.value)} required maxLength={10} disabled={busy} error={error || undefined} />
              <Button type="submit" size="lg" disabled={busy}>Sign in</Button>
              <div className={styles.actions}>
                <Button variant="ink" size="lg" disabled={busy} onClick={() => sendEmailCode()}>Send a new code</Button>
                <Button variant="ink" size="lg" disabled={busy} onClick={() => { setCodeSent(false); setOtp(""); setError(""); setMessage(""); }}>Change email</Button>
              </div>
            </form>}
          <Button variant="ink" size="lg" disabled={busy} onClick={() => { setGrant(null); setError(""); setMessage(""); }}>Use a different device code</Button>
        </div>
      )}
      <p role="status" className={styles.feedback}>{showBusy ? "Waiting for a response." : message}</p>
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    </main>
  );
}
