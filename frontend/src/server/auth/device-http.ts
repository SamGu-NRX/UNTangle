import { approveDeviceGrant, exchangeDeviceGrant, inspectDeviceGrant, refreshDeviceGrant, startDeviceGrant } from "../../../../packages/contracts/src/device-grant";
import { DeviceGrantError, type DeviceGrants } from "./device-grants";
import { deviceBearer } from "./v1-auth";

type Action = "start" | "inspect" | "approve" | "token" | "refresh" | "revoke";
type Session = { user: { id: string; emailVerified: boolean }; session: { securityGeneration?: number } } | null;
type Dependencies = { grants: DeviceGrants; origin: string; extensionOrigins: readonly string[]; session: (request: Request) => Promise<Session> };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });

async function body(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new DeviceGrantError("invalid_request", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new DeviceGrantError("invalid_request");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 4096) { await reader.cancel(); throw new DeviceGrantError("invalid_request", 413); }
      chunks.push(next.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error instanceof DeviceGrantError) throw error;
    throw new DeviceGrantError("invalid_request");
  } finally { reader.releaseLock(); }
}

export function createDeviceHttp({ grants, origin, extensionOrigins, session }: Dependencies) {
  const appOrigin = new URL(origin).origin;
  if (extensionOrigins.some(value => !/^chrome-extension:\/\/[a-p]{32}$/.test(value))) throw new Error("DEVICE_EXTENSION_ORIGINS must contain exact chrome-extension origins.");
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
  return {
    cors,
    options(request: Request) {
      const response = new Response(null, { status: allowed(request) ? 204 : 403 });
      if (allowed(request)) {
        response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
        response.headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
      }
      return cors(request, response);
    },
    handler(action: Action) {
      return async (request: Request) => {
        try {
          if (!allowed(request)) throw new DeviceGrantError("forbidden_origin", 403);
          if (action === "inspect" || action === "approve") {
            if (request.headers.has("authorization")) throw new DeviceGrantError("ambiguous_credentials");
            if (request.headers.get("origin") !== appOrigin || request.headers.get("x-untangle-device") !== "1") throw new DeviceGrantError("forbidden_origin", 403);
          } else if (request.headers.has("cookie")) throw new DeviceGrantError("ambiguous_credentials");
          let output: unknown;
          if (action === "revoke") {
            const token = deviceBearer(request);
            if (!token) throw new DeviceGrantError("unauthorized", 401);
            output = await grants.revoke(token);
          } else {
            if (action !== "inspect" && action !== "approve" && request.headers.has("authorization")) throw new DeviceGrantError("invalid_request");
            const input = await body(request);
            switch (action) {
              case "start": {
                const parsed = startDeviceGrant.safeParse(input);
                if (!parsed.success) throw new DeviceGrantError("invalid_request");
                output = { ...await grants.start(parsed.data), verificationUri: `${appOrigin}/device` }; break;
              }
              case "inspect": {
                const parsed = inspectDeviceGrant.safeParse(input);
                if (!parsed.success) throw new DeviceGrantError("invalid_request");
                output = await grants.inspect(parsed.data.userCode); break;
              }
              case "approve": {
                const parsed = approveDeviceGrant.safeParse(input);
                if (!parsed.success) throw new DeviceGrantError("invalid_request");
                const browser = await session(request);
                if (!browser?.user.emailVerified) throw new DeviceGrantError("unauthorized", 401);
                if (browser.user.id !== parsed.data.expectedUserId) throw new DeviceGrantError("account_changed", 409);
                output = await grants.approve(parsed.data.userCode, browser.user.id, parsed.data.decision, browser.session.securityGeneration ?? 0); break;
              }
              case "token": {
                const parsed = exchangeDeviceGrant.safeParse(input);
                if (!parsed.success) throw new DeviceGrantError("invalid_request");
                output = await grants.exchange(parsed.data.deviceCode, parsed.data.codeVerifier); break;
              }
              case "refresh": {
                const parsed = refreshDeviceGrant.safeParse(input);
                if (!parsed.success) throw new DeviceGrantError("invalid_request");
                output = await grants.refresh(parsed.data.refreshToken); break;
              }
            }
          }
          return cors(request, json(output));
        } catch (error) {
          if (error instanceof DeviceGrantError) return cors(request, json({ error: error.code }, error.status));
          // No request body or credentials in logs.
          console.error("Device authorization unavailable");
          return cors(request, json({ error: "unavailable" }, 503));
        }
      };
    },
  };
}
