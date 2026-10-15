import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { deviceScopes, type DeviceClientKind, type DeviceScope, type StartDeviceGrant, type DeviceTokenResponse } from "../../../../packages/contracts/src/device-grant";

// Starting lifetimes, not measured against production usage. The approved code
// gets 60 seconds to limit interception; access lasts 5 minutes to limit exposure.
export const deviceLifetimes = { pending: 600_000, approved: 60_000, access: 300_000, mobileIdle: 7 * 86400_000, absolute: 30 * 86400_000 } as const;
// How long an unfinished account security change (see DeviceStore) blocks its
// account. Unmeasured: chosen to be far longer than one reset or password
// change takes (one password hash and a few writes), and short enough that
// a crash mid-change doesn't lock the student out for long.
export const securityChangeTimeout = 15 * 60_000;
export const hashDeviceSecret = (value: string) => createHash("sha256").update(value).digest("hex");
export const pkceChallenge = (value: string) => createHash("sha256").update(value).digest("base64url");
const secret = () => randomBytes(32).toString("base64url");
const equal = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export class DeviceGrantError extends Error {
  constructor(public readonly code: string, public readonly status = 400) { super(code); }
}
export type Grant = {
  id: string; deviceCodeHash: string; userCodeHash: string; codeChallenge: string;
  clientKind: DeviceClientKind; scheduleId: string | null;
  status: "pending" | "approved" | "denied" | "active" | "revoked";
  userId: string | null; generation: number | null;
  codeExpiresAt: number; expiresAt: number; idleExpiresAt: number;
};
export type DeviceToken = { hash: string; grantId: string; kind: "access" | "refresh"; expiresAt: number; usedAt: number | null };
export interface DeviceTransaction {
  grantBy(field: "id" | "deviceCodeHash" | "userCodeHash", value: string): Promise<Grant | null>;
  saveGrant(grant: Grant): Promise<void>;
  token(hash: string): Promise<DeviceToken | null>;
  saveToken(token: DeviceToken): Promise<void>;
  generation(userId: string): Promise<number>;
}
/**
 * Each account has a security generation; grants and browser sessions record
 * the one they were issued under, and any later bump ends them.
 *
 * A security change (password reset or change, sign-outs, setting a password,
 * unverified-account cleanup) is a bump when it opens and another when it
 * finishes. While it's open, the generation can't be read, so nothing can be
 * issued under a generation the change is about to end. One change runs per
 * account at a time; a second is refused with `security_change_in_progress`,
 * so a slower change can never land its write after a faster one. A change
 * left open longer than securityChangeTimeout stops blocking, and the next
 * change replaces it. Its first bump has already ended the account's earlier
 * grants and sessions.
 */
export interface DeviceStore {
  transaction<T>(work: (tx: DeviceTransaction) => Promise<T>): Promise<T>;
  /** An unlocked read, for comparisons that issue nothing. A missing account reads as generation 0. */
  readGeneration(userId: string): Promise<{ generation: number; changing: boolean }>;
  bumpGeneration(userId: string): Promise<void>;
  /**
   * Opens a change. Refused with `security_change_in_progress` while another
   * is open, and with `stale_session` when `expectedGeneration` (the caller's
   * session) is no longer current. Returns the generation it opened at.
   */
  beginSecurityChange(userId: string, expectedGeneration?: number): Promise<SecurityChange>;
  /**
   * Writes the account's password, in one transaction that locks the
   * account's security row and refuses (`stale_session`) unless `changeId` is
   * still the open change. A request that stalled past the timeout, and whose
   * change another one replaced, can't land its write after the newer one.
   * "update" changes the existing credential; "insert" creates the first.
   */
  writeCredential(userId: string, changeId: string, passwordHash: string, mode: "update" | "insert"): Promise<void>;
  /**
   * Deletes the session if it was issued under an older generation and no
   * change is open, in one statement. A change moves its caller's own session
   * forward while the change is open, so that session is never caught between
   * the two writes. Returns whether a session was deleted.
   */
  endStaleSession(token: string): Promise<boolean>;
  /** Closes the change with a bump and returns the new generation. Throws, changing nothing, if it isn't the open change. */
  finishSecurityChange(userId: string, changeId: string): Promise<number>;
}
export type SecurityChange = { changeId: string; generation: number };
export const securityChangeInProgress = () => new DeviceGrantError("security_change_in_progress", 409);
export const staleSession = () => new DeviceGrantError("stale_session", 401);
export const changeNotCurrent = () => new Error("This account security change is no longer the open one.");
export type DeviceIdentity = { userId: string; grantId: string; clientKind: DeviceClientKind; scopes: readonly DeviceScope[]; scheduleId: string | null };

export function createDeviceGrants(store: DeviceStore, now = Date.now) {
  // A reuse verdict must commit the revocation before it reaches the caller.
  // Expected refusals are returned through the transaction, then thrown outside it.
  async function run<T>(work: (tx: DeviceTransaction) => Promise<T>): Promise<T> {
    const result = await store.transaction(async tx => {
      try { return { ok: true as const, value: await work(tx) }; }
      catch (error) { if (error instanceof DeviceGrantError) return { ok: false as const, error }; throw error; }
    });
    if (!result.ok) throw result.error;
    return result.value;
  }
  async function live(tx: DeviceTransaction, grant: Grant | null): Promise<Grant & { userId: string; generation: number }> {
    if (!grant || !grant.userId || grant.generation === null || grant.status !== "active" || grant.expiresAt <= now() || grant.idleExpiresAt <= now()) throw new DeviceGrantError("invalid_token", 401);
    if (await tx.generation(grant.userId) !== grant.generation) throw new DeviceGrantError("invalid_token", 401);
    return { ...grant, userId: grant.userId, generation: grant.generation };
  }
  async function issue(tx: DeviceTransaction, grant: Grant): Promise<DeviceTokenResponse> {
    const accessToken = secret(), refreshToken = secret();
    const accessExpiry = Math.min(now() + deviceLifetimes.access, grant.expiresAt, grant.idleExpiresAt);
    await tx.saveToken({ hash: hashDeviceSecret(accessToken), grantId: grant.id, kind: "access", expiresAt: accessExpiry, usedAt: null });
    await tx.saveToken({ hash: hashDeviceSecret(refreshToken), grantId: grant.id, kind: "refresh", expiresAt: grant.expiresAt, usedAt: null });
    return { accessToken, refreshToken, tokenType: "Bearer", expiresIn: Math.floor((accessExpiry - now()) / 1000), scopes: [...deviceScopes[grant.clientKind]], grantId: grant.id };
  }
  async function pending(tx: DeviceTransaction, code: string) {
    const grant = await tx.grantBy("userCodeHash", hashDeviceSecret(code));
    if (!grant || grant.status !== "pending") throw new DeviceGrantError("invalid_grant");
    if (grant.codeExpiresAt <= now()) throw new DeviceGrantError("expired_token");
    return grant;
  }
  return {
    async start(input: StartDeviceGrant) {
      const deviceCode = secret();
      const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
      const userCode = Array.from(randomBytes(8), byte => alphabet[byte & 31]).join("");
      await run(tx => tx.saveGrant({ id: randomUUID(), deviceCodeHash: hashDeviceSecret(deviceCode), userCodeHash: hashDeviceSecret(userCode), codeChallenge: input.codeChallenge, clientKind: input.clientKind, scheduleId: input.clientKind === "extension" ? input.scheduleId : null, status: "pending", userId: null, generation: null, codeExpiresAt: now() + deviceLifetimes.pending, expiresAt: now() + deviceLifetimes.absolute, idleExpiresAt: now() + deviceLifetimes.absolute }));
      return { deviceCode, userCode, expiresIn: deviceLifetimes.pending / 1000, interval: 5 };
    },
    inspect(code: string) { return run(async tx => { const grant = await pending(tx, code); return { clientKind: grant.clientKind, scopes: [...deviceScopes[grant.clientKind]], userCode: code, scheduleId: grant.scheduleId }; }); },
    approve(code: string, userId: string, decision: "approve" | "deny", sessionGeneration = 0) {
      return run(async tx => {
        const grant = await pending(tx, code);
        const generation = await tx.generation(userId);
        if (generation !== sessionGeneration) throw new DeviceGrantError("unauthorized", 401);
        await tx.saveGrant({ ...grant, userId, generation, status: decision === "approve" ? "approved" : "denied", codeExpiresAt: Math.min(grant.codeExpiresAt, now() + deviceLifetimes.approved) });
        return { status: decision === "approve" ? "approved" as const : "denied" as const };
      });
    },
    exchange(deviceCode: string, verifier: string) {
      return run(async tx => {
        const grant = await tx.grantBy("deviceCodeHash", hashDeviceSecret(deviceCode));
        if (!grant || !equal(pkceChallenge(verifier), grant.codeChallenge)) throw new DeviceGrantError("invalid_grant");
        if (grant.codeExpiresAt <= now()) throw new DeviceGrantError("expired_token");
        if (grant.status === "pending") throw new DeviceGrantError("authorization_pending");
        if (grant.status === "denied") throw new DeviceGrantError("access_denied");
        if (grant.status !== "approved" || !grant.userId || grant.generation !== await tx.generation(grant.userId)) throw new DeviceGrantError("invalid_grant");
        const active: Grant = { ...grant, status: "active", expiresAt: now() + deviceLifetimes.absolute, idleExpiresAt: now() + (grant.clientKind === "mobile" ? deviceLifetimes.mobileIdle : deviceLifetimes.absolute) };
        await tx.saveGrant(active);
        return issue(tx, active);
      });
    },
    refresh(refreshToken: string) {
      return run(async tx => {
        const hash = hashDeviceSecret(refreshToken);
        const initial = await tx.token(hash);
        if (!initial || initial.kind !== "refresh") throw new DeviceGrantError("invalid_token", 401);
        const grant = await live(tx, await tx.grantBy("id", initial.grantId));
        // Re-read after taking the grant lock: another instance may have rotated it.
        const token = await tx.token(hash);
        if (!token || token.expiresAt <= now()) throw new DeviceGrantError("invalid_token", 401);
        if (token.usedAt !== null) {
          await tx.saveGrant({ ...grant, status: "revoked" });
          throw new DeviceGrantError("invalid_token", 401);
        }
        await tx.saveToken({ ...token, usedAt: now() });
        const refreshed = { ...grant, idleExpiresAt: Math.min(grant.expiresAt, now() + (grant.clientKind === "mobile" ? deviceLifetimes.mobileIdle : deviceLifetimes.absolute)) };
        await tx.saveGrant(refreshed);
        return issue(tx, refreshed);
      });
    },
    authenticate(accessToken: string, scope?: DeviceScope, scheduleId?: string): Promise<DeviceIdentity> {
      return run(async tx => {
        const token = await tx.token(hashDeviceSecret(accessToken));
        if (!token || token.kind !== "access" || token.expiresAt <= now()) throw new DeviceGrantError("invalid_token", 401);
        const grant = await live(tx, await tx.grantBy("id", token.grantId));
        const scopes: readonly DeviceScope[] = deviceScopes[grant.clientKind];
        if ((scope && !scopes.includes(scope)) || (grant.clientKind === "extension" && scope && (!scheduleId || scheduleId !== grant.scheduleId))) throw new DeviceGrantError("insufficient_scope", 403);
        return { userId: grant.userId, grantId: grant.id, clientKind: grant.clientKind, scopes, scheduleId: grant.scheduleId };
      });
    },
    revoke(accessToken: string) {
      return run(async tx => {
        const token = await tx.token(hashDeviceSecret(accessToken));
        if (!token || token.kind !== "access" || token.expiresAt <= now()) throw new DeviceGrantError("invalid_token", 401);
        const grant = await live(tx, await tx.grantBy("id", token.grantId));
        await tx.saveGrant({ ...grant, status: "revoked" });
        return { revoked: true };
      });
    },
    beginSecurityChange: (userId: string, expectedGeneration?: number) => store.beginSecurityChange(userId, expectedGeneration),
    writeCredential: (userId: string, changeId: string, passwordHash: string, mode: "update" | "insert") => store.writeCredential(userId, changeId, passwordHash, mode),
    endStaleSession: (token: string) => store.endStaleSession(token),
    finishSecurityChange: (userId: string, changeId: string) => store.finishSecurityChange(userId, changeId),
    bumpSecurityGeneration: (userId: string) => store.bumpGeneration(userId),
    /** The current generation, refused with `security_change_in_progress` while a change is open. */
    async readSecurityGeneration(userId: string) {
      const { generation, changing } = await store.readGeneration(userId);
      if (changing) throw securityChangeInProgress();
      return generation;
    },
  };
}
export type DeviceGrants = ReturnType<typeof createDeviceGrants>;
