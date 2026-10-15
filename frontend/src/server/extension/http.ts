/**
 * HTTP boundary for the extension routes: device-grant authentication of the
 * extension kind, origin and CORS rules matching the device routes, bounded
 * body reads, and typed error codes with no raw messages. Mirrors
 * frontend/src/server/auth/device-http.ts.
 *
 * Status contract: every authentication or scope failure — missing, revoked,
 * expired, wrong-kind, or insufficient-scope token — is 401, so the extension
 * asks the student to sign in again; a request carrying both a token and a
 * cookie is 400; 403, 409 and 422 are command rejections only, and their body
 * is always an add reply carrying the command's operation id.
 */
import { DeviceGrantError, type DeviceGrants } from "@/server/auth/device-grants";
import { deviceBearer } from "@/server/auth/v1-auth";
import type { DeviceScope } from "../../../../packages/contracts/src/device-grant";
import { SyncError } from "@/lib/document-sync/decision";
import { applyAddOption, type ExtensionStore } from "./commands";
import { extensionAddOptionCommandSchema, extensionAddReplySchema, extensionPreviewSchema } from "./extension-api";
import { buildPreview, type SectionsSource } from "./preview";
import { DocumentIdSchema } from "../../../../packages/contracts/src/ids";

export type ExtensionDependencies = {
  grants: DeviceGrants;
  store: ExtensionStore;
  sections: SectionsSource;
  origin: string;
  extensionOrigins: readonly string[];
};

/** The extension identity the routes act as: the grant's user and its bound schedule. */
export type ExtensionIdentity = { userId: string; grantId: string; scheduleId: string };

const classNumberPattern = /^\d{4,5}$/;

export function createExtensionHttp({ grants, store, sections, origin, extensionOrigins }: ExtensionDependencies) {
  const appOrigin = new URL(origin).origin;
  if (extensionOrigins.some((value) => !/^chrome-extension:\/\/[a-p]{32}$/.test(value))) {
    throw new Error("DEVICE_EXTENSION_ORIGINS must contain exact chrome-extension origins.");
  }

  function allowed(request: Request) {
    const incoming = request.headers.get("origin");
    return !incoming || incoming === appOrigin || extensionOrigins.includes(incoming);
  }

  function cors(request: Request, response: Response) {
    response.headers.set("Vary", "Origin");
    const incoming = request.headers.get("origin");
    if (incoming && extensionOrigins.includes(incoming)) response.headers.set("Access-Control-Allow-Origin", incoming);
    return response;
  }

  const json = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });

  /** Device credentials only, never a cookie. `deviceBearer` refuses a request
   * that carries both: credential selection is never implicit. */
  function requireBearer(request: Request): string {
    const token = deviceBearer(request);
    if (!token) throw new DeviceGrantError("unauthorized", 401);
    return token;
  }

  /** Authenticates an extension-kind grant. A mobile token, or an extension
   * grant with no bound schedule, has no extension scopes here. Scope and kind
   * failures are 401 like every other authentication failure — the extension
   * answers 401 by asking the student to sign in again, and 403 is reserved
   * for command rejections. */
  async function authenticate(token: string, scope?: DeviceScope, scheduleId?: string): Promise<ExtensionIdentity> {
    let identity: Awaited<ReturnType<DeviceGrants["authenticate"]>>;
    try {
      identity = await grants.authenticate(token, scope, scheduleId);
    } catch (error) {
      if (error instanceof DeviceGrantError && error.code === "insufficient_scope") {
        throw new DeviceGrantError("insufficient_scope", 401);
      }
      throw error;
    }
    if (identity.clientKind !== "extension") throw new DeviceGrantError("insufficient_scope", 401);
    // The grant's schedule id names the only schedule this grant can see.
    if (!identity.scheduleId || !DocumentIdSchema.safeParse(identity.scheduleId).success) {
      throw new DeviceGrantError("insufficient_scope", 401);
    }
    return { userId: identity.userId, grantId: identity.grantId, scheduleId: identity.scheduleId };
  }

  async function readJsonBody(request: Request): Promise<unknown> {
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      throw new DeviceGrantError("invalid_request", 415);
    }
    const reader = request.body?.getReader();
    if (!reader) throw new DeviceGrantError("invalid_request");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > 4096) {
          await reader.cancel();
          throw new DeviceGrantError("invalid_request", 413);
        }
        chunks.push(next.value);
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch (error) {
      if (error instanceof DeviceGrantError) throw error;
      throw new DeviceGrantError("invalid_request");
    } finally {
      reader.releaseLock();
    }
  }

  /** The student's Main schedule for the grant's bound schedule id, or null
   * when it does not exist yet. Storage failures surface as 503, never as a
   * verdict the check did not make. */
  async function loadSchedule(identity: ExtensionIdentity) {
    try {
      // documentRepository.get throws NOT_FOUND for a missing or deleted
      // document; either way the student has no schedule to check against.
      const document = await store.getDocument(identity.userId, identity.scheduleId);
      if (document.kind !== "schedule") return null;
      return { body: document.body, revision: document.revision };
    } catch (error) {
      if (error instanceof SyncError && error.code === "NOT_FOUND") return null;
      throw error;
    }
  }

  async function handle(request: Request, action: () => Promise<Response>): Promise<Response> {
    try {
      // A disallowed origin is 400 with a typed code: 403 is a command
      // rejection only, and the browser blocks the disallowed-origin response
      // from client code anyway.
      if (!allowed(request)) throw new DeviceGrantError("forbidden_origin", 400);
      return cors(request, await action());
    } catch (error) {
      if (error instanceof DeviceGrantError) return cors(request, json({ error: error.code }, error.status));
      // No request body, token or credentials in logs.
      console.error("Extension API unavailable");
      return cors(request, json({ error: "unavailable" }, 503));
    }
  }

  return {
    cors,
    options(request: Request) {
      const response = new Response(null, { status: allowed(request) ? 204 : 403 });
      if (allowed(request)) {
        response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        response.headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
      }
      return cors(request, response);
    },

    preview(request: Request, params: { term: string; classNumber: string }) {
      return handle(request, async () => {
        if (!termPattern(params.term) || !classNumberPattern.test(params.classNumber)) {
          throw new DeviceGrantError("invalid_request", 400);
        }
        const identity = await authenticate(await requireBearer(request));
        // The bound schedule is the only one this grant reads or writes.
        const [termSections, schedule, preferences] = await Promise.all([
          sections.termSections(params.term),
          loadSchedule(identity),
          store.preferences(identity.userId),
        ]);
        const preview = buildPreview({
          scheduleId: identity.scheduleId,
          term: params.term,
          classNumber: params.classNumber,
          sections: termSections,
          schedule,
          blocked: preferences?.constraints.blocked ?? [],
        });
        // Self-check before the response leaves: the extension's guard rejects
        // anything this schema accepted by mistake.
        return json(extensionPreviewSchema.parse(preview));
      });
    },

    commands(request: Request) {
      return handle(request, async () => {
        const token = requireBearer(request);
        const input = await readJsonBody(request);
        const parsed = extensionAddOptionCommandSchema.safeParse(input);
        if (!parsed.success) throw new DeviceGrantError("invalid_request", 400);
        // The command may only target the grant's own bound schedule.
        const identity = await authenticate(token, "schedule:add-option", parsed.data.scheduleId);
        const outcome = await applyAddOption({ store, sections }, identity, parsed.data);
        return json(extensionAddReplySchema.parse(outcome.body), outcome.status);
      });
    },
  };
}

const termPattern = (term: string) => /^(spring|summer|fall)-\d{4}$/.test(term);
