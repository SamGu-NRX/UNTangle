import { DocumentIdSchema } from "../../../../packages/contracts/src/ids";
import { SyncError } from "./decision";
import type { DocumentRepository } from "./repository";

export type DocumentContext = { params: Promise<{ id: string }> };
type Dependencies = {
  repository: DocumentRepository;
  session: (request: Request) => Promise<{ user: { id: string } } | null>;
  origin: string;
  available: boolean;
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

export function documentHandlers({ repository, session, origin, available }: Dependencies) {
  async function handle(request: Request, action: (userId: string) => Promise<unknown>): Promise<Response> {
    try {
      const identity = await session(request);
      if (!identity?.user.id) throw new SyncError(401, "UNAUTHORIZED", "Sign in to sync documents.");
      if (!available) throw new SyncError(503, "STORAGE_UNAVAILABLE", "Document storage is unavailable.");
      return Response.json(await action(identity.user.id), { headers: { "Cache-Control": "no-store" } });
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
    put: (request: Request, context: DocumentContext) => handle(request, async (userId) => {
      // PUT already requires a browser preflight. Check Origin too, as these
      // routes use cookies and better-auth's checks cover only its own routes.
      if (request.headers.get("origin") !== origin) throw new SyncError(403, "INVALID_ORIGIN", "Write from the app's own origin.");
      if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
        throw new SyncError(415, "INVALID_CONTENT_TYPE", "Use application/json.");
      }
      const id = documentId((await context.params).id);
      return repository.write(userId, await readBytes(request), id);
    }),
    get: (request: Request, context: DocumentContext) => handle(request, async (userId) =>
      repository.get(userId, documentId((await context.params).id))),
    pull: (request: Request) => handle(request, (userId) => repository.pull(userId)),
    versions: (request: Request) => handle(request, async (userId) => {
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
