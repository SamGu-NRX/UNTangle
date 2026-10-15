import { UNTANGLE_ORIGIN } from "../config";
import { StudentError } from "../shared/student-error";
import { isAddReply, isPreview, isSectionRef, isCommand, type AddOptionCommand, type AddReply, type Preview, type SectionRef } from "../shared/extension-api";
export type PlannerApi = Pick<PlannerClient, "preview" | "add">;
export interface SessionCache {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export class AuthenticationRequired extends StudentError {
  constructor() { super("Sign in to UNTangle to continue."); }
}
export class PlannerClient {
  constructor(private readonly fetchImpl: FetchLike, private readonly base = UNTANGLE_ORIGIN) { }
  async preview(ref: SectionRef, token: string): Promise<Preview> {
    if (!isSectionRef(ref))
      throw new Error("Invalid section reference");
    const response = await this.fetchImpl(`${this.base}/api/v1/extension/preview/${ref.term}/${ref.classNumber}`, {
      credentials: "omit", headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
    });
    if (response.status === 401)
      throw new AuthenticationRequired();
    if (!response.ok)
      throw new StudentError("Couldn't load Main from UNTangle. Check your connection and retry.");
    const body: unknown = await response.json();
    if (!isPreview(body))
      throw new Error("Invalid extension preview response");
    return body;
  }
  async add(command: AddOptionCommand, token: string): Promise<AddReply | null> {
    if (!isCommand(command))
      throw new Error("Invalid add-option command");
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.base}/api/v1/extension/commands`, {
        method: "POST",
        credentials: "omit",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        // Chrome storage can reorder keys. Fix wire order so receipt hashes
        // compare the same bytes before and after a worker restart.
        body: JSON.stringify({
          command: command.command,
          operationId: command.operationId,
          scheduleId: command.scheduleId,
          optionId: command.optionId,
          expectedRevision: command.expectedRevision,
        }),
      });
    }
    catch {
      return null;
    }
    if (response.status === 401)
      throw new AuthenticationRequired();
    // Transport failures and expired authentication are not command rejections.
    // Keep the exact operation for receipt lookup after reconnection/sign-in.
    if (!response.ok && response.status !== 409 && response.status !== 422 && response.status !== 403)
      return null;
    const reply: unknown = await response.json().catch(() => null);
    if (!isAddReply(reply) || reply.operationId !== command.operationId)
      return null;
    return reply;
  }
}
