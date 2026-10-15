import { AddOutbox, type LocalStore, type PendingAdd } from "./outbox";
import { AuthenticationRequired, type PlannerApi } from "./planner-client";
import { isGrant, isRecord, isSectionRef, type AddReply, type DeviceGrant, type SectionRef } from "../shared/extension-api";
import type { PanelOutcome, PanelPreview, PanelState } from "../shared/panel";
import { StudentError } from "../shared/student-error";
import type { Request } from "../shared/validation";
// Shown in place of an internal error's message, which is never student copy.
const COULDNT_LOAD = "Couldn't load this from UNTangle. Retry in a moment.";
const SIGN_IN_UNFINISHED = "Sign-in didn't finish. Sign in again.";
export class WorkerController {
  private grant: DeviceGrant | null = null;
  private preview: PanelPreview | null = null;
  private notice = "Choose a section on class search, then open UNTangle to review it.";
  private outcome: PanelOutcome = "none";
  private busy = false;
  private readonly outbox: AddOutbox;
  constructor(private readonly store: LocalStore, private readonly client: PlannerApi, private readonly auth: {
    signIn(): Promise<DeviceGrant>;
  }, private readonly changed: () => Promise<void> = async () => { }) {
    this.outbox = new AddOutbox(store, client);
  }
  async start(): Promise<void> {
    const saved = await this.store.get("device-grant");
    this.grant = isGrant(saved) ? saved : null;
    try {
      await this.replay();
    }
    catch (error) {
      await this.failed(error);
    }
  }
  private async failed(error: unknown, grantId = this.grant?.grantId, fallback = COULDNT_LOAD): Promise<void> {
    if (error instanceof AuthenticationRequired && this.grant?.grantId === grantId) {
      this.grant = null;
      this.preview = null;
      await this.store.remove("device-grant");
      await this.changed();
    }
    this.notice = error instanceof StudentError ? error.message : fallback;
    // A lapsed sign-in is explained by the signed-out panel itself.
    this.outcome = error instanceof AuthenticationRequired ? "none" : "error";
  }
  private async refresh(ref: SectionRef): Promise<void> {
    this.preview = null;
    if (!this.grant || this.grant.expiresAt <= Date.now())
      throw new AuthenticationRequired();
    const result = await this.client.preview(ref, this.grant.accessToken);
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
    if (this.grant)
      await this.outbox.resend(this.grant, (pending, reply) => this.settled(pending, reply));
  }
  private async state(): Promise<PanelState> {
    // Signed in, only this account's adds count, so another account's never
    // blocks it. Signed out, any stored add counts: the panel then asks the
    // student to sign in to finish it, and replay still sends only the adds
    // of whichever account signs in.
    const owner = this.grant?.accountId;
    const pending = Object.entries(await this.store.all()).filter(([key, value]) => key.startsWith("add:") && isRecord(value) && (owner === undefined || value.accountId === owner)).length;
    return { signedIn: this.grant !== null && this.grant.expiresAt > Date.now(), preview: this.preview, notice: this.notice, outcome: this.outcome, pending, working: false };
  }
  private async isPending(ref: SectionRef, accountId: string): Promise<boolean> {
    return Object.entries(await this.store.all()).some(([key, value]) => key.startsWith("add:") && isRecord(value) && value.accountId === accountId && isSectionRef(value.ref) && value.ref.term === ref.term && value.ref.classNumber === ref.classNumber);
  }
  async handle(request: Request): Promise<unknown> {
    if (request.type === "marker/request") {
      const active = this.grant;
      if (!active || active.expiresAt <= Date.now())
        return { marker: "unknown" };
      // The marker carries one state word and nothing from the preview's details.
      if (await this.isPending(request.ref, active.accountId))
        return { marker: "pending" };
      try {
        const preview = await this.client.preview(request.ref, active.accessToken);
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
        this.grant = await this.auth.signIn();
        await this.store.set("device-grant", this.grant);
        this.preview = null;
        await this.replay();
        await this.changed();
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
          accountId: this.grant.accountId, ref: confirmed.ref,
          command: { command: "add-option", operationId: crypto.randomUUID(), scheduleId: confirmed.preview.scheduleId, optionId: confirmed.preview.optionId, expectedRevision: confirmed.preview.revision },
        };
        await this.outbox.enqueue(pending);
        this.notice = "Waiting to sync. You can close this panel.";
        const reply = await this.outbox.send(pending, this.grant);
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
