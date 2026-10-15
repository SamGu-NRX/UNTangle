import { AddOutbox, type LocalStore, type PendingAdd } from "./outbox";
import { SCHEDULE_ID } from "../config";
import { AuthenticationRequired, type PlannerApi } from "./planner-client";
import { GrantRevoked, isPendingSignIn, SignInCancelled, type PendingSignIn } from "./device-client";
import { isStoredGrant, isRecord, isSectionRef, type DeviceTokenResponse, type StoredGrant, type AddReply, type SectionRef } from "../shared/extension-api";
import type { PanelOutcome, PanelPreview, PanelState } from "../shared/panel";
import { StudentError } from "../shared/student-error";
import type { Request } from "../shared/validation";

// Shown in place of an internal error's message, which is never student copy.
const COULDNT_LOAD = "Couldn't load this from UNTangle. Retry in a moment.";
const SIGN_IN_UNFINISHED = "Sign-in didn't finish. Sign in again.";
const CHOOSE_SECTION = "Choose a section on class search, then open UNTangle to review it.";
const UNREACHABLE = "Couldn't reach UNTangle. Check your connection and retry.";
// The access token lives 5 minutes. A use within this margin of its end
// refreshes first, so the token the server sees is always well inside its
// life. An MV3 worker can stop at any time, so nothing refreshes on a timer:
// every authenticated call checks, and a restarted worker refreshes on its
// first use.
const REFRESH_MARGIN_MS = 30_000;
const GRANT_KEY = "device-grant";
const SIGN_IN_KEY = "device-sign-in";
/**
 * How many waiting adds the last sign-out or lapsed grant discarded, kept in
 * local storage so the panel can still say so after Chrome stops the worker.
 * The next sign-in clears it.
 */
const DISCARDED_KEY = "discarded-adds";

/** What the worker needs from the device-code flow; DeviceClient implements it. */
export interface DeviceAuth {
  start(scheduleId: string): Promise<PendingSignIn>;
  poll(pending: PendingSignIn, current: () => Promise<boolean>): Promise<DeviceTokenResponse>;
  refresh(refreshToken: string): Promise<DeviceTokenResponse>;
  revoke(accessToken: string): Promise<void>;
}

/** chrome.storage.session: memory only, and closed to content scripts unless an extension opens it. */
export type SessionStore = Pick<LocalStore, "get" | "set" | "remove">;

const sameSignIn = (stored: unknown, pending: PendingSignIn) => isPendingSignIn(stored) && stored.deviceCode === pending.deviceCode;

export class WorkerController {
  private grant: StoredGrant | null = null;
  private preview: PanelPreview | null = null;
  /** While a device sign-in is in flight, the code the student matches on the approval page. */
  private userCode: string | null = null;
  /** The poll of the sign-in in flight; one at a time. */
  private signingIn: Promise<void> | null = null;
  private notice = CHOOSE_SECTION;
  private outcome: PanelOutcome = "none";
  private busy = false;
  /** The in-flight token refresh, so concurrent calls share one rotation. */
  private inflight: Promise<string> | null = null;
  private readonly outbox: AddOutbox;
  constructor(private readonly store: LocalStore, private readonly signIns: SessionStore, private readonly client: PlannerApi, private readonly auth: DeviceAuth, private readonly changed: () => Promise<void> = async () => { }, private readonly now: () => number = Date.now) {
    this.outbox = new AddOutbox(store, client);
  }
  async start(): Promise<void> {
    const saved = await this.store.get(GRANT_KEY);
    this.grant = isStoredGrant(saved) ? saved : null;
    // A sign-in started before Chrome stopped this worker keeps polling.
    const pending = await this.signIns.get(SIGN_IN_KEY);
    if (isPendingSignIn(pending))
      this.follow(pending);
    try {
      await this.replay();
    }
    catch (error) {
      await this.failed(error);
    }
  }
  private async failed(error: unknown, grantId = this.grant?.grantId, fallback = COULDNT_LOAD): Promise<void> {
    if (error instanceof AuthenticationRequired && this.grant?.grantId === grantId)
      await this.signOut();
    this.notice = error instanceof StudentError ? error.message : fallback;
    // A lapsed sign-in is explained by the signed-out panel itself.
    this.outcome = error instanceof AuthenticationRequired ? "none" : "error";
  }
  /**
   * Ends the grant locally. Its waiting adds go with it: only the grant that
   * made an add may send it, and the next sign-in is a new grant. The count
   * is kept so the panel can say how many were discarded. The adds go first,
   * so a worker stopped halfway still holds the grant and the next sign-out
   * finishes the job.
   */
  private async signOut(): Promise<void> {
    const adds = Object.keys(await this.store.all()).filter(key => key.startsWith("add:"));
    for (const key of adds)
      await this.store.remove(key);
    if (adds.length > 0)
      await this.store.set(DISCARDED_KEY, adds.length);
    this.grant = null;
    this.preview = null;
    await this.store.remove(GRANT_KEY);
    await this.changed();
  }
  private follow(pending: PendingSignIn): void {
    this.userCode = pending.userCode;
    this.signingIn ??= this.finishSignIn(pending).finally(() => { this.signingIn = null; });
  }
  /**
   * Polls a started sign-in until the student approves, denies, or the code
   * expires, whether or not a panel stays open: opening the approval tab
   * closes the toolbar popup.
   */
  private async finishSignIn(pending: PendingSignIn): Promise<void> {
    try {
      // Each round reads the stored sign-in. That read is an extension API
      // call, which resets the 30-second idle timer after which Chrome stops a
      // worker; a fetch doesn't. If Chrome stops the worker anyway, start()
      // resumes from storage on the next event.
      const tokens = await this.auth.poll(pending, async () => sameSignIn(await this.signIns.get(SIGN_IN_KEY), pending));
      await this.saveGrant(tokens);
      await this.store.remove(DISCARDED_KEY);
      this.notice = CHOOSE_SECTION;
      this.outcome = "none";
    }
    catch (error) {
      if (!(error instanceof SignInCancelled))
        await this.failed(error, this.grant?.grantId, SIGN_IN_UNFINISHED);
    }
    finally {
      this.userCode = null;
      await this.signIns.remove(SIGN_IN_KEY);
      await this.changed();
    }
  }
  private async saveGrant(tokens: DeviceTokenResponse): Promise<void> {
    const grant: StoredGrant = {
      grantId: tokens.grantId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      scopes: [...tokens.scopes],
      scheduleId: SCHEDULE_ID,
      accessExpiresAt: this.now() + tokens.expiresIn * 1000,
    };
    this.grant = grant;
    await this.store.set(GRANT_KEY, grant);
  }
  /**
   * A usable access token: the stored one, or a refreshed pair when the
   * stored one is inside the margin. Refreshes are single-flight, so parallel
   * callers can never present the same refresh token twice (the server reads
   * that as reuse and revokes the whole grant).
   */
  private async session(): Promise<string> {
    const grant = this.grant;
    if (!grant)
      throw new AuthenticationRequired();
    if (grant.accessExpiresAt - this.now() > REFRESH_MARGIN_MS)
      return grant.accessToken;
    this.inflight ??= this.rotate(grant).finally(() => { this.inflight = null; });
    return this.inflight;
  }
  private async rotate(grant: StoredGrant): Promise<string> {
    try {
      const tokens = await this.auth.refresh(grant.refreshToken);
      await this.saveGrant(tokens);
      const current = this.grant;
      if (!current)
        throw new AuthenticationRequired();
      return current.accessToken;
    }
    catch (error) {
      // A reused refresh token, a revoked grant or a security-generation bump
      // all land here: the extension signs out and the panel asks for sign-in.
      if (error instanceof GrantRevoked) {
        await this.signOut();
        throw new AuthenticationRequired();
      }
      // The stored pair survives; the next use retries the refresh.
      throw new StudentError(UNREACHABLE);
    }
  }
  private async refresh(ref: SectionRef): Promise<void> {
    this.preview = null;
    const token = await this.session();
    const result = await this.client.preview(ref, token);
    this.preview = { previewId: crypto.randomUUID(), ref, preview: result };
    this.notice = "Review this section before adding.";
    this.outcome = "none";
  }
  private async settled(pending: PendingAdd, reply: AddReply): Promise<void> {
    if (reply.kind === "receipt") {
      this.notice = "Added to Main.";
      this.outcome = "added";
      this.preview = null;
      const proposed = await this.store.get("proposed-section");
      if (isSectionRef(proposed) && proposed.term === pending.ref.term && proposed.classNumber === pending.ref.classNumber)
        await this.store.remove("proposed-section");
    }
    else if (reply.reason === "stale-revision") {
      await this.refresh(pending.ref);
      this.notice = "Main changed since you reviewed this section. Review the fresh preview before adding.";
      this.outcome = "changed";
    }
    else {
      this.notice = "This section couldn't be added. Choose another section.";
      this.outcome = "rejected";
    }
    await this.changed();
  }
  private async replay(): Promise<void> {
    if (!this.grant)
      return;
    await this.outbox.resend(this.grant.grantId, await this.session(), (pending, reply) => this.settled(pending, reply));
  }
  private async state(): Promise<PanelState> {
    // Only this grant's adds count, so no other grant's can block it.
    const owner = this.grant?.grantId;
    const stored = await this.store.all();
    const pending = owner === undefined ? 0 : Object.entries(stored).filter(([key, value]) => key.startsWith("add:") && isRecord(value) && value.grantId === owner).length;
    const discarded = stored[DISCARDED_KEY];
    return {
      signedIn: this.grant !== null, userCode: this.userCode, preview: this.preview, notice: this.notice, outcome: this.outcome, pending,
      discarded: this.grant === null && typeof discarded === "number" && Number.isSafeInteger(discarded) ? discarded : 0, working: false,
    };
  }
  private async isPending(ref: SectionRef, grantId: string): Promise<boolean> {
    return Object.entries(await this.store.all()).some(([key, value]) => key.startsWith("add:") && isRecord(value) && value.grantId === grantId && isSectionRef(value.ref) && value.ref.term === ref.term && value.ref.classNumber === ref.classNumber);
  }
  async handle(request: Request): Promise<unknown> {
    if (request.type === "marker/request") {
      const active = this.grant;
      if (!active)
        return { marker: "unknown" };
      // The marker carries one state word and nothing from the preview's details.
      if (await this.isPending(request.ref, active.grantId))
        return { marker: "pending" };
      let token: string;
      try {
        token = await this.session();
      }
      catch {
        return { marker: "unknown" };
      }
      try {
        const preview = await this.client.preview(request.ref, token);
        return { marker: preview.inSchedule === true ? "added" : preview.conflict };
      }
      catch (error) {
        await this.failed(error, active.grantId);
        return { marker: "unknown" };
      }
    }
    if (request.type === "proposal/request") {
      await this.store.set("proposed-section", request.ref);
      return { proposed: true };
    }
    if (this.busy)
      return { ...await this.state(), working: true };
    this.busy = true;
    try {
      if (request.type === "panel/sign-in") {
        this.preview = null;
        this.notice = CHOOSE_SECTION;
        this.outcome = "none";
        if (!this.signingIn) {
          const pending = await this.auth.start(SCHEDULE_ID);
          await this.signIns.set(SIGN_IN_KEY, pending);
          this.follow(pending);
        }
      }
      if (request.type === "panel/sign-out") {
        // Tell UNTangle with the freshest token there is; if the server can't
        // be reached, the local tokens go anyway and the grant expires on its
        // own. A 401 answer (grant already gone) counts as signed out.
        if (this.grant) {
          try {
            await this.auth.revoke(await this.session());
          }
          catch { /* the grant ends on its own; the local tokens go either way */ }
        }
        await this.signOut();
        this.notice = "Signed out of UNTangle.";
        this.outcome = "none";
      }
      if (request.type === "panel/retry")
        await this.replay();
      if (request.type === "panel/confirm") {
        if ((await this.state()).pending > 0)
          throw new StudentError("An add is still waiting to sync. Sync it before adding another section.");
        if (!this.grant || !this.preview || request.previewId !== this.preview.previewId)
          throw new StudentError("This preview is out of date. Review the section again.");
        const confirmed = this.preview;
        this.preview = null;
        const pending: PendingAdd = {
          grantId: this.grant.grantId, ref: confirmed.ref,
          command: { command: "add-option", operationId: crypto.randomUUID(), scheduleId: confirmed.preview.scheduleId, optionId: confirmed.preview.optionId, expectedRevision: confirmed.preview.revision },
        };
        await this.outbox.enqueue(pending);
        this.notice = "Waiting to sync. You can close this panel.";
        const reply = await this.outbox.send(pending, await this.session());
        if (reply)
          await this.settled(pending, reply);
        else {
          this.outcome = "waiting";
          // The page's marker for this section now reads "Not synced".
          await this.changed();
        }
      }
      else if (request.type === "panel/status" || !this.preview) {
        const ref = await this.store.get("proposed-section");
        if (this.grant && isSectionRef(ref) && (!this.preview || this.preview.ref.term !== ref.term || this.preview.ref.classNumber !== ref.classNumber))
          await this.refresh(ref);
      }
      return await this.state();
    }
    catch (error) {
      await this.failed(error, this.grant?.grantId, request.type === "panel/sign-in" ? SIGN_IN_UNFINISHED : COULDNT_LOAD);
      return await this.state();
    }
    finally {
      this.busy = false;
    }
  }
}
