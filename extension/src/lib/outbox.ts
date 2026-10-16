import { isCommand, isId, isRecord, isSectionRef, type AddReply, type AddOptionCommand, type SectionRef } from "../shared/extension-api";
import type { PlannerApi, SessionCache } from "./planner-client";
export interface LocalStore extends SessionCache {
  remove(key: string): Promise<void>;
  all(): Promise<Record<string, unknown>>;
}
export interface PendingAdd {
  command: AddOptionCommand;
  /** The grant that proposed the add; only that grant's sign-in replays it. */
  grantId: string;
  ref: SectionRef;
}
export class AddOutbox {
  constructor(private readonly store: LocalStore, private readonly client: PlannerApi) { }
  async enqueue(pending: PendingAdd): Promise<void> {
    await this.store.set(`add:${pending.command.operationId}`, pending);
  }
  /**
   * Sends one pending add with the given (already fresh) access token. A null
   * reply means the transport failed; the command stays stored for a retry.
   */
  async send(pending: PendingAdd, token: string): Promise<AddReply | null> {
    const reply = await this.client.add(pending.command, token);
    if (reply)
      await this.store.remove(`add:${pending.command.operationId}`);
    return reply;
  }
  /**
   * Replays only the adds the named grant made, under that grant's fresh
   * token. A record that isn't a valid add (an older format, or a damaged
   * write) is removed and skipped, so it can't block the rest.
   */
  async resend(grantId: string, token: string, settled: (pending: PendingAdd, reply: AddReply) => Promise<void> = async () => { }): Promise<void> {
    for (const [key, value] of Object.entries(await this.store.all())) {
      if (!key.startsWith("add:"))
        continue;
      if (!isRecord(value) || !isCommand(value.command) || !isId(value.grantId) || !isSectionRef(value.ref) || key !== `add:${value.command.operationId}`) {
        await this.store.remove(key);
        continue;
      }
      if (value.grantId !== grantId)
        continue;
      const pending = { command: value.command, grantId: value.grantId, ref: value.ref };
      const reply = await this.send(pending, token);
      if (reply)
        await settled(pending, reply);
    }
  }
}
