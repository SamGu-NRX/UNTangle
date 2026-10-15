import { AddOutbox, type LocalStore, type PendingAdd } from "./outbox";
import { SCHEDULE_ID } from "../config";
import { AuthenticationRequired, type PlannerApi } from "./planner-client";
import { GrantRevoked, type SignInInput } from "./device-client";
import { isStoredGrant, isRecord, isSectionRef, type DeviceTokenResponse, type StoredGrant, type AddReply, type SectionRef } from "../shared/extension-api";
import type { PanelOutcome, PanelPreview, PanelState } from "../shared/panel";
import { StudentError } from "../shared/student-error";
import type { Request } from "../shared/validation";

// Shown in place of an internal error's message, which is never student copy.
const COULDNT_LOAD = "Couldn't load this from UNTangle. Retry in a moment.";
const SIGN_IN_UNFINISHED = "Sign-in didn't finish. Sign in again.";
const UNREACHABLE = "Couldn't reach UNTangle. Check your connection and retry.";
// The access token lives 5 minutes. A use within this margin of its end
// refreshes first, so the token the server sees is always well inside its
// life. An MV3 worker can stop at any time, so nothing refreshes on a timer:
// every authenticated call checks, and a restarted worker refreshes on its
// first use.
const REFRESH_MARGIN_MS = 30_000;
const GRANT_KEY = "device-grant";

/** What the worker needs from the device-code flow; DeviceClient implements it. */
export interface DeviceAuth {
  signIn(input: SignInInput): Promise<DeviceTokenResponse>;
  refresh(refreshToken: string): Promise<DeviceTokenResponse>;
  revoke(accessToken: string): Promise<void>;
}

export class WorkerController {
  private grant: StoredGrant | null = null;
  private preview: PanelPreview | null = null;
  /** While a device sign-in is in flight, the code the student matches on the approval page. */
  private userCode: string | null = null;
  private notice = "Choose a section on class search, then open UNTangle to review it.";
  private outcome: PanelOutcome = "none";
  private busy = false;
  /** The in-flight token refresh, so concurrent calls share one rotation. */
  private inflight: Promise<string> | null = null;
  private readonly outbox: AddOutbox;
  constructor(private readonly store: LocalStore, private readonly client: PlannerApi, private readonly auth: DeviceAuth, private readonly changed: () => Promise<void> = async () => { }, private readonly now: () => number = Date.now) {
    this.outbox = new AddOutbox(store, client);
  }
  async start(): Promise<void> {
    const saved = await this.store.get(GRANT_KEY);
    this.grant = isStoredGrant(saved) ? saved : null;
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
  private async signOut(): Promise<void> {
    this.grant = null;
    this.userCode = null;
    this.preview = null;
    await this.store.remove(GRANT_KEY);
    await this.changed();
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
    // Signed in, only this grant's adds count, so another grant's never
    // blocks it. Signed out, any stored add counts: the panel then asks the
    // student to sign in to finish it, and replay still sends only the adds
    // of whichever grant signs in.
    const owner = this.grant?.grantId;
    const pending = Object.entries(await this.store.all()).filter(([key, value]) => key.startsWith("add:") && isRecord(value) && (owner === undefined || value.grantId === owner)).length;
    return { signedIn: this.grant !== null, userCode: this.userCode, preview: this.preview, notice: this.notice, outcome: this.outcome, pending, working: false };
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
        this.notice = "Choose a section on class search, then open UNTangle to review it.";
        this.outcome = "none";
        try {
          const tokens = await this.auth.signIn({
            scheduleId: SCHEDULE_ID,
            onUserCode: code => { this.userCode = code; },
          });
          await this.saveGrant(tokens);
          await this.replay();
          await this.changed();
        }
        finally {
          this.userCode = null;
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
