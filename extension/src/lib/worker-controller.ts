import { AddOutbox, type LocalStore, type PendingAdd } from "./outbox";
import { AuthenticationRequired, type PlannerApi } from "./planner-client";
import { isGrant, isRecord, isSectionRef, type AddReply, type DeviceGrant, type SectionRef } from "../shared/extension-api";
import type { PanelPreview, PanelState } from "../shared/panel";
import type { Request } from "../shared/validation";
export class WorkerController {
  private grant: DeviceGrant | null = null;
  private preview: PanelPreview | null = null;
  private notice = "Choose a section on class search, then open UNTangle to review it.";
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
  private async failed(error: unknown, grantId = this.grant?.grantId): Promise<void> {
    if (error instanceof AuthenticationRequired && this.grant?.grantId === grantId) {
      this.grant = null;
      this.preview = null;
      await this.store.remove("device-grant");
      await this.changed();
    }
    this.notice = error instanceof Error ? error.message : "Couldn't reach UNTangle. Retry.";
  }
  private async refresh(ref: SectionRef): Promise<void> {
    this.preview = null;
    if (!this.grant || this.grant.expiresAt <= Date.now())
      throw new AuthenticationRequired();
    const result = await this.client.preview(ref, this.grant.accessToken);
    this.preview = { previewId: crypto.randomUUID(), ref, preview: result };
    if (this.notice.startsWith("Choose a section"))
      this.notice = "Review this section before adding.";
  }
  private async settled(pending: PendingAdd, reply: AddReply): Promise<void> {
    if (reply.kind === "receipt") {
      this.notice = "Added to Main.";
      this.preview = null;
      const proposed = await this.store.get("proposed-section");
      if (isSectionRef(proposed) && proposed.term === pending.ref.term && proposed.classNumber === pending.ref.classNumber)
        await this.store.remove("proposed-section");
    }
    else if (reply.reason === "stale-revision") {
      this.notice = "Your schedule changed. Review the fresh preview before adding.";
      await this.refresh(pending.ref);
    }
    else
      this.notice = "This section couldn't be added. Choose another section.";
    await this.changed();
  }
  private async replay(): Promise<void> {
    if (this.grant)
      await this.outbox.resend(this.grant, (pending, reply) => this.settled(pending, reply));
  }
  private async state(): Promise<PanelState> {
    const pending = Object.entries(await this.store.all()).filter(([key, value]) => key.startsWith("add:") && isRecord(value) && value.accountId === this.grant?.accountId).length;
    return { signedIn: this.grant !== null && this.grant.expiresAt > Date.now(), preview: this.preview, notice: this.notice, pending };
  }
  async handle(request: Request): Promise<unknown> {
    if (request.type === "marker/request") {
      const active = this.grant;
      if (!active || active.expiresAt <= Date.now())
        return { marker: "unknown" };
      try {
        return { marker: (await this.client.preview(request.ref, active.accessToken)).conflict };
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
      return this.state();
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
          throw new Error("An add is waiting to sync. Retry it before adding another section.");
        if (!this.grant || !this.preview || request.previewId !== this.preview.previewId)
          throw new Error("This preview expired. Review the section again.");
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
      }
      else if (request.type === "panel/status" || !this.preview) {
        const ref = await this.store.get("proposed-section");
        if (this.grant && isSectionRef(ref) && (!this.preview || this.preview.ref.term !== ref.term || this.preview.ref.classNumber !== ref.classNumber))
          await this.refresh(ref);
      }
      return await this.state();
    }
    catch (error) {
      await this.failed(error);
      return await this.state();
    }
    finally {
      this.busy = false;
    }
  }
}
