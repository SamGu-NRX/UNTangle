import type { DeviceGrantErrorCode, DeviceScope } from "../../../../packages/contracts/src/device-grant";
import { DocumentIdSchema } from "../../../../packages/contracts/src/ids";
import { DeviceGrantError } from "@/server/auth/device-grants";
import { SyncError } from "./decision";
import type { DocumentRepository } from "./repository";

export type DocumentContext = { params: Promise<{ id: string }> };
type Identity = { userId: string; source: "device" | "browser" };
type Dependencies = {
  repository: DocumentRepository;
  /** authorizeV1: a device bearer token if one is sent, otherwise the browser session. */
  authorize: (request: Request, scope: DeviceScope) => Promise<Identity>;
  /** createUserLimit: seconds to wait when the user's budget is spent, else null. */
  limit: (route: "plannerRead" | "plannerSave", userId: string) => Promise<number | null>;
  origin: string;
  available: boolean;
};

// Device refusals return the contract's code with a fixed sentence, so a
// response never carries an exception message or the token itself.
const deviceRefusals: Partial<Record<DeviceGrantErrorCode, string>> = {
  invalid_token: "The device token is invalid or has expired.",
  insufficient_scope: "This device can't use documents.",
  ambiguous_credentials: "Send a device token or a session cookie, not both.",
};

// Bound buffering before JSON parsing. 1 MiB is a protective starting limit,
// not a measured maximum student record size.
export const MAX_WRITE_BYTES = 1024 * 1024;

async function readBytes(request: Request): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) throw new SyncError(400, "INVALID_JSON", "A JSON write is required.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_WRITE_BYTES) {
        await reader.cancel();
        throw new SyncError(413, "WRITE_TOO_LARGE", "A write must be at most 1 MiB.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

function documentId(value: unknown): string {
  const parsed = DocumentIdSchema.safeParse(value);
  if (!parsed.success) throw new SyncError(400, "INVALID_ID", "The document id is invalid.");
  return parsed.data;
}

export function documentHandlers({ repository, authorize, limit, origin, available }: Dependencies) {
  async function identify(request: Request, scope: DeviceScope): Promise<Identity> {
    try {
      return await authorize(request, scope);
    } catch (error) {
      if (!(error instanceof DeviceGrantError)) throw error;
      if (error.code === "unauthorized") throw new SyncError(401, "UNAUTHORIZED", "Sign in to sync documents.");
      const message = deviceRefusals[error.code as keyof typeof deviceRefusals];
      if (!message) throw error;
      throw new SyncError(error.status, error.code, message);
    }
  }
  async function handle(request: Request, scope: DeviceScope, action: (identity: Identity) => Promise<unknown>): Promise<Response> {
    try {
      const identity = await identify(request, scope);
      // Counted per student once identified, so phones sharing a carrier NAT
      // address don't share a budget. The route's withRateLimit guards by address.
      const retryAfter = await limit(scope === "documents:write" ? "plannerSave" : "plannerRead", identity.userId);
      if (retryAfter !== null) {
        return Response.json({ error: "Too many requests.", code: "RATE_LIMITED" },
          { status: 429, headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" } });
      }
      if (!available) throw new SyncError(503, "STORAGE_UNAVAILABLE", "Document storage is unavailable.");
      return Response.json(await action(identity), { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (error instanceof SyncError) {
        return Response.json({ error: error.message, code: error.code,
          ...(error.revision === undefined ? {} : { revision: error.revision }) },
        { status: error.status, headers: { "Cache-Control": "no-store" } });
      }
      // Database failures must never return a receipt or expose a student's body.
      return Response.json({ error: "Document storage is unavailable.", code: "STORAGE_UNAVAILABLE" },
        { status: 503, headers: { "Cache-Control": "no-store" } });
    }
  }
  return {
    put: (request: Request, context: DocumentContext) => handle(request, "documents:write", async ({ userId, source }) => {
      // PUT already requires a browser preflight. Check Origin too, as cookies
      // are ambient and better-auth's checks cover only its own routes. A
      // bearer token is sent deliberately, so device writes skip this check.
      if (source === "browser" && request.headers.get("origin") !== origin) throw new SyncError(403, "INVALID_ORIGIN", "Write from the app's own origin.");
      if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
        throw new SyncError(415, "INVALID_CONTENT_TYPE", "Use application/json.");
      }
      const id = documentId((await context.params).id);
      return repository.write(userId, await readBytes(request), id);
    }),
    get: (request: Request, context: DocumentContext) => handle(request, "documents:read", async ({ userId }) =>
      repository.get(userId, documentId((await context.params).id))),
    pull: (request: Request) => handle(request, "documents:read", ({ userId }) => repository.pull(userId)),
    versions: (request: Request) => handle(request, "documents:read", async ({ userId }) => {
      const params = new URL(request.url).searchParams;
      for (const key of params.keys()) {
        if (!["scheduleId", "page"].includes(key) || params.getAll(key).length !== 1) {
          throw new SyncError(400, "INVALID_QUERY", "Use one scheduleId and one page at most.");
        }
      }
      const scheduleId = params.get("scheduleId");
      return repository.listVersions(userId, scheduleId === null ? null : documentId(scheduleId), params.get("page"));
    }),
  };
}
