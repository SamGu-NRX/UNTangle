import { isCommand, isId, isRecord, isSectionRef, type AddReply, type AddOptionCommand, type DeviceGrant, type SectionRef } from "../shared/extension-api";
import type { PlannerApi, SessionCache } from "./planner-client";
export interface LocalStore extends SessionCache {
  remove(key: string): Promise<void>;
  all(): Promise<Record<string, unknown>>;
}
export interface PendingAdd {
  command: AddOptionCommand;
  accountId: string;
  ref: SectionRef;
}
export class AddOutbox {
  constructor(private readonly store: LocalStore, private readonly client: PlannerApi) { }
  async enqueue(pending: PendingAdd): Promise<void> {
    await this.store.set(`add:${pending.command.operationId}`, pending);
  }
  async send(pending: PendingAdd, grant: DeviceGrant) {
    if (pending.accountId !== grant.accountId || grant.expiresAt <= Date.now())
      return null;
    const reply = await this.client.add(pending.command, grant.accessToken);
    if (reply)
      await this.store.remove(`add:${pending.command.operationId}`);
    return reply;
  }
  async resend(grant: DeviceGrant, settled: (pending: PendingAdd, reply: AddReply) => Promise<void> = async () => { }): Promise<void> {
    for (const [key, value] of Object.entries(await this.store.all())) {
      if (!key.startsWith("add:"))
        continue;
      if (!isRecord(value) || !isCommand(value.command) || !isId(value.accountId) || !isSectionRef(value.ref) || key !== `add:${value.command.operationId}`)
        throw new Error("Invalid persisted add command");
      const pending = { command: value.command, accountId: value.accountId, ref: value.ref };
      const reply = await this.send(pending, grant);
      if (reply)
        await settled(pending, reply);
    }
  }
}
