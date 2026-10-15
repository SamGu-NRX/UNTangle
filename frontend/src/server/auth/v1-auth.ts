import type { DeviceScope } from "../../../../packages/contracts/src/device-grant";
import { DeviceGrantError, type DeviceGrants } from "./device-grants";

type BrowserSession = { user: { id: string; emailVerified: boolean }; session: { securityGeneration: number } } | null;
export function deviceBearer(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (authorization === null) return null;
  // Even an unrelated cookie is refused: credential selection is never implicit.
  if (request.headers.has("cookie")) throw new DeviceGrantError("ambiguous_credentials", 400);
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(authorization);
  if (!match) throw new DeviceGrantError("invalid_token", 401);
  return match[1];
}

/** Handlers use this returned userId for every repository read and write.
 * Client-supplied user IDs must never replace it. Extension reads require the
 * schedule ID too, even when the route only returns a schedule projection. */
export function createV1Auth(grants: DeviceGrants, session: (request: Request) => Promise<BrowserSession>) {
  return async (request: Request, scope: DeviceScope, scheduleId?: string) => {
    const token = deviceBearer(request);
    if (token) return { ...await grants.authenticate(token, scope, scheduleId), source: "device" as const };
    const browser = await session(request);
    if (!browser?.user.emailVerified) throw new DeviceGrantError("unauthorized", 401);
    // A cookie from before the account's last security change (a reset, say)
    // is refused here, as device grants are. Through better-auth's
    // getSession such a session is already deleted (auth-config.ts); this
    // check doesn't depend on that. While a change is open, the generation
    // can't be read: the readSecurityGeneration refusal (409
    // security_change_in_progress) passes through, so the client retries
    // instead of treating a session that may survive the change as signed out.
    if (typeof browser.session.securityGeneration !== "number") throw new Error("Session has no securityGeneration.");
    const current = await grants.readSecurityGeneration(browser.user.id);
    if (current !== browser.session.securityGeneration) throw new DeviceGrantError("unauthorized", 401);
    return { userId: browser.user.id, source: "browser" as const };
  };
}
