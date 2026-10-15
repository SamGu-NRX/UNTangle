import { betterAuth, type BetterAuthOptions } from "better-auth";
import { timingSafeEqual } from "node:crypto";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { emailOTP, magicLink } from "better-auth/plugins";
import type { AuthEmailKind } from "@/lib/auth-email";
import { EmailBudgetExceeded } from "@/lib/email-budget";
import { hashMagicLinkToken, type MagicLinkClaims } from "@/lib/magic-link-claims";
import { landingUrlFor } from "@/lib/magic-link-url";
import { untEmailGate } from "@/lib/unt-auth";
import { deleteSessionCookie } from "better-auth/cookies";
import { DeviceGrantError, securityChangeInProgress, staleSession, type SecurityChange } from "@/server/auth/device-grants";

export type AuthDeps = {
  database: BetterAuthOptions["database"];
  baseURL: string;
  secret: string;
  claims: MagicLinkClaims;
  sendEmail: (kind: AuthEmailKind, to: string, url: string) => Promise<unknown>;
  bumpSecurityGeneration?: (userId: string) => Promise<void>;
  readSecurityGeneration?: (userId: string) => Promise<number>;
  /** See DeviceStore in server/auth/device-grants.ts. */
  beginSecurityChange?: (userId: string, expectedGeneration?: number) => Promise<SecurityChange>;
  writeCredential?: (userId: string, changeId: string, passwordHash: string, mode: "update" | "insert") => Promise<void>;
  endStaleSession?: (token: string) => Promise<boolean>;
  finishSecurityChange?: (userId: string, changeId: string, keepSession?: string) => Promise<number>;
  /** Deployment settings that don't change who may sign in (IP header, limiter storage). */
  options?: Pick<BetterAuthOptions, "advanced" | "rateLimit">;
};

/**
 * The better-auth instance, built from its dependencies so tests can run
 * the real flows on an in-memory database. lib/auth.ts builds the app's.
 *
 * Who can hold an account is decided by the inbox:
 * - Accounts are created only by an emailed link or code to a UNT address. Password
 *   sign-up is off on the server (disableSignUp), so nobody can create a
 *   password account for an address they don't read. A password is an
 *   optional extra: set from a recent signed-in session
 *   (lib/account-password.ts), or through /reset-password, which needs the
 *   inbox too.
 * - A password account whose address was never verified can't sign in
 *   (requireEmailVerification). Only accounts from before this rule can be
 *   in that state.
 * - Defense in depth: if an emailed link or code is used on an account that was
 *   never verified, that account's password and sessions were made by
 *   someone who didn't own the inbox. They are deleted before the owner's
 *   session is made, so only the inbox owner keeps access.
 * - An inbox code or link works once even when requests use it concurrently
 *   (an atomic claim, MagicLinkClaims).
 */
/** A callback parameter decoded, if it decodes and points at this app; otherwise null. */
function trustedCallback(raw: string, isTrusted: (url: string) => boolean): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return isTrusted(decoded) ? decoded : null;
}

/** Where a refused sign-in link may send the browser: the given URL if it decodes and is this app's, else the sign-in page. */
export function trustedTarget(raw: string | undefined, isTrusted: (url: string) => boolean): string {
  return (raw && trustedCallback(raw, isTrusted)) || "/auth?link=failed";
}

/** An error's name and database code, for logs: never its message, cause or parameters, which can hold tokens or hashes. */
function safeError(error: unknown) {
  const failure = error as { name?: unknown; code?: unknown; cause?: { code?: unknown } } | null;
  return { name: typeof failure?.name === "string" ? failure.name : typeof error, code: failure?.cause?.code ?? failure?.code };
}

/** A session's security generation. Every session row has one (migration 0013); a missing one is a bug, not generation 0. */
function stampOf(session: object): number {
  const stamp = (session as { securityGeneration?: unknown }).securityGeneration;
  if (typeof stamp !== "number") throw new Error("Session has no securityGeneration.");
  return stamp;
}

export function createAuth({ database, baseURL, secret, claims, sendEmail, bumpSecurityGeneration, readSecurityGeneration, beginSecurityChange, finishSecurityChange, writeCredential, endStaleSession, options }: AuthDeps) {
  /** Sends an auth email. Over budget: a sign-in link or code request fails with 429; a reset send is dropped (logged), since that endpoint answers the same whether or not an account exists. */
  async function send(kind: AuthEmailKind, to: string, url: string) {
    try {
      await sendEmail(kind, to, url);
    } catch (error) {
      if (error instanceof EmailBudgetExceeded) {
        console.warn(`Auth email (${kind}) not sent: the recipient's send budget is used up.`);
        if (kind === "magic-link" || kind === "email-code") throw new APIError("TOO_MANY_REQUESTS", { message: error.message });
        return;
      }
      console.error(`Auth email (${kind}) delivery failed.`, error);
      throw error;
    }
  }

  const changeStore = [readSecurityGeneration, beginSecurityChange, finishSecurityChange, writeCredential, endStaleSession].filter(Boolean).length;
  if (changeStore !== 0 && changeStore !== 1 + 4)
    throw new Error("readSecurityGeneration, beginSecurityChange, finishSecurityChange, writeCredential and endStaleSession must be configured together.");
  // The device store writes the account and session tables itself, with its
  // own ids and no secondary storage. Either option would make those writes wrong.
  if (changeStore === 5 && options?.advanced?.database?.generateId)
    throw new Error("advanced.database.generateId isn't supported: DeviceStore writes account rows with its own ids.");
  // Without the change store (some tests), a change is two plain bumps,
  // better-auth writes passwords itself, and sessions aren't moved between generations.
  const tracksChanges = changeStore === 5;
  const beginChange = beginSecurityChange ?? (async (userId: string) => { await bumpSecurityGeneration?.(userId); return { changeId: "", generation: 0 }; });
  const finishChange: NonNullable<AuthDeps["finishSecurityChange"]> = finishSecurityChange ?? (async (userId: string) => { await bumpSecurityGeneration?.(userId); return 0; });
  type Change = SecurityChange & { userId: string };
  const passwordSessionGenerations = new WeakMap<object, { userId: string; generation: number | null }>();
  const claimedOtpEmails = new WeakMap<object, string>();
  const sessionStamps = new WeakMap<object, number>();
  const resets = new WeakMap<object, Change>();
  const passwordChanges = new WeakMap<object, Change & { callerToken: string | null }>();
  type SignOut = Change & { callerToken: string; keepCaller: boolean; settled: boolean };
  const signOutChanges = new WeakMap<object, SignOut>();
  // The same sign-outs, by the incoming request, for the handler wrapper below.
  const signOutsByRequest = new WeakMap<Request, SignOut>();
  /**
   * Finishes a sign-out's change, keeping the caller's session for "other
   * sessions". Marked settled only once a finish succeeds, so the handler
   * wrapper tries again after a failure. If moving the caller's session is
   * what failed, the change still finishes without it: the caller is signed
   * out, but the account isn't blocked until the timeout.
   */
  async function settleSignOut(signOut: SignOut) {
    if (signOut.settled) return;
    try {
      await finishChange(signOut.userId, signOut.changeId, signOut.keepCaller ? signOut.callerToken : undefined);
    } catch (error) {
      if (!signOut.keepCaller) throw error;
      await finishChange(signOut.userId, signOut.changeId);
    }
    signOut.settled = true;
  }

  /** The one place a device-store refusal becomes an HTTP answer; anything else is rethrown. */
  function refusal(error: unknown): never {
    if (error instanceof DeviceGrantError && error.code === "credential_exists")
      throw new APIError("BAD_REQUEST", { code: "PASSWORD_ALREADY_SET", message: "User already has a password set" });
    if (error instanceof DeviceGrantError && error.code === "security_change_in_progress")
      throw new APIError("CONFLICT", { code: "security_change_in_progress", message: "A change to this account's security settings is in progress. Try again in a moment." });
    if (error instanceof DeviceGrantError && error.code === "stale_session")
      throw new APIError("UNAUTHORIZED", { code: "stale_session", message: "Your account's security settings changed. Sign in again." });
    throw error;
  }
  const generationOf = (userId: string) => readSecurityGeneration ? readSecurityGeneration(userId).catch(refusal) : Promise.resolve(0);
  /** The current generation, or null while a change is open. */
  const settledGeneration = (userId: string) => generationOf(userId).catch((error: unknown) => {
    if (error instanceof APIError && (error.body as { code?: string } | undefined)?.code === "security_change_in_progress") return null;
    throw error;
  });
  async function openChange(userId: string, expectedGeneration?: number): Promise<Change> {
    return { userId, ...await beginChange(userId, expectedGeneration).catch(refusal) };
  }
  /**
   * Writes a password under a change this request holds, through the device
   * store's locked write (DeviceStore.writeCredential). Returns false, which
   * tells better-auth to skip its own write: 1.5.5 discards the result at
   * every call site this reaches (tests/auth/better-auth-pin.test.ts).
   */
  async function writeUnderChange(change: Change, passwordHash: string, mode: "update" | "insert", callerToken?: string): Promise<false | undefined> {
    if (!tracksChanges) return undefined;
    try {
      await writeCredential!(change.userId, change.changeId, passwordHash, mode);
    } catch (error) {
      // A newer change replaced this one: it isn't ours to finish, and the
      // caller's session must not move onto a generation that change owns.
      if (error instanceof DeviceGrantError && error.code === "stale_session") refusal(error);
      // Otherwise the write rolled back, so the password is unchanged and the
      // change can close now rather than lock the account until it times out.
      // The caller did nothing wrong, so their session moves with it.
      await finishChange(change.userId, change.changeId, callerToken).catch(() => {});
      refusal(error);
    }
    return false;
  }
  /** A reset writes only under the change its own before hook opened; anything else is refused. */
  async function writeResetPassword(context: object, userId: string | undefined, passwordHash: string, mode: "update" | "insert") {
    const change = resets.get(context);
    if (!change || (userId !== undefined && userId !== change.userId))
      throw new APIError("BAD_REQUEST", { code: "INVALID_TOKEN", message: "This password-reset link is invalid or has expired." });
    return writeUnderChange(change, passwordHash, mode);
  }
  /** What every refused password sign-in answers, matching better-auth's wrong-password response, so a refusal can't reveal that an account exists. */
  const invalidCredentials = () => new APIError("UNAUTHORIZED", { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" });

  /**
   * Before an emailed code or link is claimed: an unverified account gets a
   * change opened for its cleanup (returned); a verified one is refused while
   * a change is open. Either refusal leaves the code unused.
   */
  async function refuseBeforeClaim(user: { id: string; emailVerified: boolean } | undefined): Promise<Change | null> {
    if (!user) return null;
    if (!user.emailVerified) return openChange(user.id);
    await generationOf(user.id);
    return null;
  }
  /**
   * A link or code to an unverified account: its password and sessions were
   * made by someone who didn't own the inbox, so they end, inside the change.
   * A verified account is an ordinary sign-in and its devices are left alone.
   */
  async function removeUnverifiedCredentials(adapter: { findAccounts: (userId: string) => Promise<{ id: string; providerId: string }[]>; deleteAccount: (id: string) => Promise<unknown>; deleteSessions: (userId: string) => Promise<unknown> }, change: Change) {
    for (const account of await adapter.findAccounts(change.userId)) {
      if (account.providerId === "credential") await adapter.deleteAccount(account.id);
    }
    await adapter.deleteSessions(change.userId);
    await finishChange(change.userId, change.changeId);
  }


  const instance = betterAuth({
    ...options,
    // Without this, better-call logs a plain error whole ("# SERVER_ERROR:"),
    // and a failed query's message lists its parameters: session tokens,
    // password hashes. The handler wrapper below logs it safely instead.
    // better-auth's own limiter then doesn't count these 500s; withRateLimit
    // wraps every route.
    onAPIError: { throw: true },
    // better-auth's endpoints log caught errors whole (revoke-session logs its
    // failed delete, whose parameters include a session token). Messages pass
    // through; anything else is reduced to its name and database code.
    logger: {
      log: (level, message, ...args) => {
        const line = [`[Better Auth]: ${message}`, ...args.map((arg) => (typeof arg === "string" ? arg : safeError(arg)))];
        if (level === "error") console.error(...line);
        else if (level === "warn") console.warn(...line);
        else console.log(...line);
      },
    },
    appName: "UNTangle",
    baseURL,
    secret,
    trustedOrigins: [baseURL],
    database,
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      autoSignIn: false,
      requireEmailVerification: true,
      // A reset is done from the inbox, so it ends every other session.
      revokeSessionsOnPasswordReset: true,
      minPasswordLength: 8,
      sendResetPassword: async ({ user, url }) => {
        await send("password-reset", user.email, url);
      },
    },
    session: {
      additionalFields: {
        securityGeneration: { type: "number", defaultValue: 0, input: false },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user, ctx) => {
            if (ctx?.path === "/sign-in/email-otp" && user.emailVerified === true && claimedOtpEmails.get(ctx.context) !== user.email.toLowerCase())
              throw new APIError("BAD_REQUEST", { message: "This sign-in code has not been claimed." });
          },
        },
        update: {
          before: async (user, ctx) => {
            // The plugin marks an existing account verified before creating its
            // session. Refuse that write too when no code won the atomic claim.
            if (ctx?.path === "/sign-in/email-otp" && user.emailVerified === true && !claimedOtpEmails.has(ctx.context))
              throw new APIError("BAD_REQUEST", { message: "This sign-in code has not been claimed." });
          },
        },
      },
      session: {
        create: {
          before: async (session, ctx) => {
            if (ctx?.path === "/sign-in/email-otp") {
              const email = claimedOtpEmails.get(ctx.context);
              const user = email ? await ctx.context.internalAdapter.findUserById(session.userId) : null;
              if (!email || user?.email.toLowerCase() !== email)
                throw new APIError("BAD_REQUEST", { message: "This sign-in code has not been claimed." });
            }
            // With revokeOtherSessions, change-password makes this session
            // after its password write. Finish first so it gets the new generation.
            if (ctx?.path === "/change-password") {
              const change = passwordChanges.get(ctx.context);
              passwordChanges.delete(ctx.context);
              if (change) await finishChange(change.userId, change.changeId);
            }
            let generation: number;
            if (ctx?.path === "/sign-in/email") {
              const captured = passwordSessionGenerations.get(ctx.context);
              if (!captured || captured.userId !== session.userId)
                throw new Error("Password sign-in did not capture its account security generation.");
              // The password was checked against what was stored when this
              // sign-in began. A security change open then, or since, ends the
              // sign-in, with the same answer as a wrong password.
              if (captured.generation === null || await settledGeneration(session.userId) !== captured.generation) throw invalidCredentials();
              generation = captured.generation;
            } else {
              generation = await generationOf(session.userId);
            }
            if (ctx) sessionStamps.set(ctx.context, generation);
            return { data: { ...session, securityGeneration: generation } };
          },
        },
      },
      account: {
        create: {
          // A reset for an account with no password creates one. setPassword is
          // server-only and has no path; it inserts after validating the password.
          before: async (account, ctx) => {
            if (account.providerId !== "credential" || !account.password) return;
            if (ctx?.path === "/reset-password") return writeResetPassword(ctx.context, account.userId, account.password, "insert");
            const caller = ctx?.context.session?.session;
            // A credential made outside a request has no caller to check (tests, operator scripts).
            if (!caller) { await bumpSecurityGeneration?.(account.userId); return; }
            if (caller.userId !== account.userId) throw new Error("set-password is writing another user's credential.");
            // better-auth 1.5.5 looks only for a credential row with a password.
            // Any credential row, even an empty legacy one, refuses here, before
            // a change opens and ends the account's devices.
            if ((await ctx.context.internalAdapter.findAccounts(caller.userId)).some((row) => row.providerId === "credential"))
              throw new APIError("BAD_REQUEST", { code: "PASSWORD_ALREADY_SET", message: "User already has a password set" });
            // The change finishes, moving the caller's session with it, only
            // after the locked write.
            const change = await openChange(caller.userId, stampOf(caller));
            const skip = await writeUnderChange(change, account.password, "insert", caller.token);
            await finishChange(change.userId, change.changeId, caller.token);
            return skip;
          },
        },
        update: {
          // change-password (better-auth 1.5.5) reads the stored hash, checks the
          // current password against it, then writes through updateAccount
          // without checking that nothing changed in between. Open a security
          // change here, refused unless the caller's session is still on the
          // current generation and no other change is open, so a reset that
          // finished during the check refuses the stale write. The write
          // itself happens under the change's row lock, so a request that
          // stalled past the timeout, and whose change a reset replaced,
          // can't land its write either.
          before: async (account, ctx) => {
            // Any value counts as a write, including null or "", which clears the password.
            if (account.password === undefined) return;
            if (ctx?.path !== "/reset-password" && ctx?.path !== "/change-password")
              throw new Error(`A password write on ${ctx?.path ?? "a server-side call"} has no device-revocation handling.`);
            if (typeof account.password !== "string" || account.password === "") throw new Error(`${ctx.path} is writing an empty password.`);
            if (ctx.path === "/reset-password") return writeResetPassword(ctx.context, undefined, account.password, "update");
            const caller = ctx.context.session;
            if (!caller) throw new Error("change-password reached its password write without a session.");
            const change = await openChange(caller.user.id, stampOf(caller.session));
            passwordChanges.set(ctx.context, { ...change, callerToken: caller.session.token });
            return writeUnderChange(change, account.password, "update", caller.session.token);
          },
        },
      },
    },
    plugins: [
      emailOTP({
        // A custom SHA-256 hash also lets the pre-session hook check a code
        // before claiming it across instances. The plugin still enforces attempts.
        storeOTP: { hash: async (otp) => hashMagicLinkToken(otp) },
        sendVerificationOTP: async ({ email, otp, type }) => {
          if (type !== "sign-in") throw new APIError("BAD_REQUEST", { message: "Use a sign-in code." });
          await send("email-code", email, otp);
        },
      }),
      // Defaults kept on purpose: the link expires in 5 minutes and allows
      // one attempt; the claim below makes that hold under concurrency.
      magicLink({
        storeToken: "hashed",
        sendMagicLink: async ({ email, url }) => {
          // The student gets the app's landing page, not the verify URL (magic-link-url.ts).
          await send("magic-link", email, landingUrlFor(url));
        },
      }),
    ],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // A magic link for an address with no account creates one; password
        // sign-up is disabled, and gated too in case it is ever turned on.
        const gateRefusal = untEmailGate(ctx.path, ctx.body);
        if (gateRefusal) throw new APIError("BAD_REQUEST", { message: gateRefusal });

        // A session left behind by a security change is deleted before any
        // route sees it, so get-session answers signed out (and clears the
        // cookie) and session routes answer 401, instead of a session the
        // document routes and device approval refuse. One conditional delete,
        // which leaves sessions alone while a change is open.
        if (tracksChanges) {
          const token = await ctx.getSignedCookie(ctx.context.authCookies.sessionToken.name, ctx.context.secret);
          if (token) await endStaleSession!(token);
        }

        if (ctx.path === "/sign-in/email" && typeof ctx.body?.email === "string") {
          const existing = await ctx.context.internalAdapter.findUserByEmail(ctx.body.email.toLowerCase());
          if (existing?.user) {
            // Capture before password verification. If a security change
            // lands while the old password is being checked, the session hook
            // sees the generation moved and refuses the sign-in.
            passwordSessionGenerations.set(ctx.context, { userId: existing.user.id, generation: await settledGeneration(existing.user.id) });
          }
        }

        // Only the sign-in part of emailOTP is public. Credential recovery
        // continues through the existing reset flow, with its revocation hook.
        if (ctx.path.includes("email-otp") && ctx.path !== "/sign-in/email-otp" && ctx.path !== "/email-otp/send-verification-otp")
          throw new APIError("NOT_FOUND", { message: "This email-code operation is unavailable." });
        if (ctx.path === "/email-otp/send-verification-otp") {
          if (ctx.body?.type !== "sign-in")
            throw new APIError("BAD_REQUEST", { message: "Use a sign-in code." });
          // 1.5.5 swallows background-task failures, including delivery and
          // send-budget errors. This context is copied per request, so await
          // delivery here and report its failure to the approval page.
          ctx.context.runInBackgroundOrAwait = async (promise) => { await promise; };
          return;
        }

        // A sign-out opens its change before better-auth deletes anything, so
        // device grants end before any session does. If the change can't
        // open, the request fails and nothing is deleted. This hook runs
        // before the endpoint's sensitiveSessionMiddleware, so it makes the
        // same check first (a live session, read past the cookie cache): a
        // request the middleware will refuse opens nothing.
        if (ctx.path === "/revoke-sessions" || ctx.path === "/revoke-other-sessions") {
          const caller = await getSessionFromCtx(ctx, { disableCookieCache: true });
          if (caller) {
            const signOut: SignOut = { ...await openChange(caller.user.id, stampOf(caller.session)), callerToken: caller.session.token,
              keepCaller: ctx.path === "/revoke-other-sessions", settled: false };
            signOutChanges.set(ctx.context, signOut);
            if (ctx.request) signOutsByRequest.set(ctx.request, signOut);
          }
          return;
        }
        if (ctx.path === "/reset-password") {
          const token = ctx.body?.token || ctx.query?.token;
          const password = ctx.body?.newPassword;
          if (typeof token !== "string" || typeof password !== "string" || password.length < ctx.context.password.config.minPasswordLength || password.length > ctx.context.password.config.maxPasswordLength) return;
          const record = await ctx.context.internalAdapter.findVerificationValue(`reset-password:${token}`);
          // The same expiry test as better-auth's reset. A request that opens
          // no change here can't write a password (writeResetPassword).
          if (!record || record.expiresAt < new Date()) return;
          // The change blocks sign-ins and grants until the password and
          // sessions are changed; a failure leaves it open until it times out.
          // It opens before the claim, so a refusal doesn't use up the link.
          const change = await openChange(record.value);
          if (!(await claims.claim(hashMagicLinkToken(`password-reset:${token}`), record.expiresAt))) {
            await finishChange(change.userId, change.changeId);
            throw new APIError("BAD_REQUEST", { message: "This password-reset code has already been used." });
          }
          resets.set(ctx.context, change);
          return;
        }
        if (ctx.path === "/sign-in/email-otp") {
          const email = ctx.body?.email;
          const otp = ctx.body?.otp;
          if (typeof email !== "string" || typeof otp !== "string")
            throw new APIError("BAD_REQUEST", { message: "Enter the email and sign-in code." });
          const record = await ctx.context.internalAdapter.findVerificationValue(`sign-in-otp-${email.toLowerCase()}`);
          if (!record || record.expiresAt <= new Date())
            throw new APIError("BAD_REQUEST", { message: "This sign-in code is invalid or has expired." });
          const [storedHash, attempts] = record.value.split(":");
          if (Number(attempts) >= 3)
            throw new APIError("FORBIDDEN", { message: "This sign-in code has no attempts left." });
          const providedHash = hashMagicLinkToken(otp);
          if (storedHash.length !== providedHash.length || !timingSafeEqual(Buffer.from(storedHash), Buffer.from(providedHash))) return;
          const existing = await ctx.context.internalAdapter.findUserByEmail(email.toLowerCase());
          // Refusals come before the claim, so they don't use up the code.
          const cleanup = await refuseBeforeClaim(existing?.user);
          // atomicVerifyOTP in 1.5.5 reads and deletes separately. Its two
          // concurrent readers can both proceed, so use our Postgres claim.
          if (!(await claims.claim(hashMagicLinkToken(`email-code:${record.identifier}:${storedHash}:${record.expiresAt.toISOString()}`), record.expiresAt))) {
            if (cleanup) await finishChange(cleanup.userId, cleanup.changeId);
            throw new APIError("BAD_REQUEST", { message: "This sign-in code has already been used." });
          }
          claimedOtpEmails.set(ctx.context, email.toLowerCase());
          if (cleanup) await removeUnverifiedCredentials(ctx.context.internalAdapter, cleanup);
          return;
        }
        if (ctx.path !== "/magic-link/verify") return;
        // The only way in is the landing page's own form (same-origin). A
        // cross-site request would be another site signing this browser in
        // to an account of its choosing. A missing header (older browsers,
        // non-browser clients) is allowed.
        if (ctx.headers?.get("sec-fetch-site") === "cross-site")
          throw new APIError("FORBIDDEN", { message: "Open the sign-in link from your email." });
        const token = (ctx.query as { token?: unknown } | undefined)?.token;
        if (typeof token !== "string") return;
        // Every callback is checked before the token is claimed, so a bad one
        // can't burn a fresh token or run the account cleanup below on a
        // request that fails anyway.
        const isTrusted = (url: string) => ctx.context.isTrustedOrigin(url, { allowRelativePaths: true });
        const callbacks = ctx.query as { callbackURL?: string; newUserCallbackURL?: string; errorCallbackURL?: string };
        for (const raw of [callbacks.callbackURL, callbacks.newUserCallbackURL, callbacks.errorCallbackURL]) {
          if (raw !== undefined && !trustedCallback(raw, isTrusted))
            throw new APIError("FORBIDDEN", { message: "This sign-in link has an invalid callback URL." });
        }
        const tokenHash = hashMagicLinkToken(token);
        const record = await ctx.context.internalAdapter.findVerificationValue(tokenHash);
        // Unknown or expired: better-auth's own verify redirects with the reason.
        if (!record || record.expiresAt < new Date()) return;

        const { email } = JSON.parse(record.value) as { email: string };
        const existing = await ctx.context.internalAdapter.findUserByEmail(email.toLowerCase());
        // Refusals come before the claim, so they don't use up the link.
        const cleanup = await refuseBeforeClaim(existing?.user);
        if (!(await claims.claim(tokenHash, record.expiresAt))) {
          if (cleanup) await finishChange(cleanup.userId, cleanup.changeId);
          // This hook runs before the endpoint's own check of errorCallbackURL,
          // so the target is validated here: a used link must not become an
          // open redirect to any site in errorCallbackURL.
          const target = new URL(
            trustedTarget(callbacks.errorCallbackURL ?? callbacks.callbackURL, isTrusted),
            ctx.context.baseURL,
          );
          target.searchParams.set("error", "ATTEMPTS_EXCEEDED");
          throw ctx.redirect(target.toString());
        }

        if (cleanup) await removeUnverifiedCredentials(ctx.context.internalAdapter, cleanup);
      }),
      after: createAuthMiddleware(async (ctx) => {
        const reset = resets.get(ctx.context);
        const result = ctx.context.returned;
        if (ctx.path === "/reset-password" && reset && result && typeof result === "object" && "status" in result && result.status === true) {
          // A failed completion leaves the change open until it times out,
          // including when the password changed but the generation store is unavailable.
          await finishChange(reset.userId, reset.changeId);
        }
        // A sign-out finishes its change whether or not the endpoint
        // succeeded: the opening bump has already ended the account's device
        // grants, and finishing keeps the account from being blocked until the
        // timeout. A plain error skips this hook; the handler wrapper at the
        // end settles those. "Sign out everywhere" ends this browser's session
        // too. "Other sessions" keeps the caller's, on the new generation.
        const signOut = signOutChanges.get(ctx.context);
        if (signOut) await settleSignOut(signOut);
        const change = passwordChanges.get(ctx.context);
        if (ctx.path === "/change-password" && change && result && typeof result === "object" && "user" in result) {
          passwordChanges.delete(ctx.context);
          // The caller keeps their session: it moves to the new generation in
          // the same step that finishes the change.
          await finishChange(change.userId, change.changeId, change.callerToken ?? undefined);
        }

        // A security change can begin between the session hook's check and
        // the insert, and its session delete can then miss this session.
        // Checking again after the insert closes that gap. Only sessions this
        // request created: a refresh also sets newSession, for an existing one.
        const created = ctx.context.newSession;
        const stamped = sessionStamps.get(ctx.context);
        if (created && stamped !== undefined) {
          const current = await settledGeneration(created.user.id);
          if (current !== stamped) {
            await ctx.context.internalAdapter.deleteSession(created.session.token);
            deleteSessionCookie(ctx);
            if (ctx.path === "/sign-in/email") throw invalidCredentials();
            refusal(current === null ? securityChangeInProgress() : staleSession());
          }
        }
      }),
    },
  });

  // better-auth 1.5.5 runs after hooks only when an endpoint returns or throws
  // an APIError. /revoke-other-sessions can throw a plain error, so a sign-out
  // whose change the before hook opened is also settled here, once. Plain
  // errors reach this wrapper (onAPIError.throw above) and get better-call's
  // usual bodiless 500. Server-side auth.api calls bypass this wrapper;
  // nothing in the app calls a sign-out that way.
  const handle = instance.handler;
  instance.handler = async (request: Request) => {
    try {
      return await handle(request);
    } catch (error) {
      console.error("Auth request failed", safeError(error));
      return new Response(null, { status: 500, statusText: "Internal Server Error" });
    } finally {
      const signOut = signOutsByRequest.get(request);
      if (signOut) await settleSignOut(signOut).catch((error: unknown) => {
        // Left open, the change times out. Its opening bump already ended the devices.
        console.error("Sign-out security change not finished", safeError(error));
      });
    }
  };
  return instance;
}
