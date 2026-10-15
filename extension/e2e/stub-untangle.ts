// Fixture-only server. No UNT calls, real credentials or session cookies.
// Runs the device-code flow end to end against the contract's own schemas.
import { approveDeviceGrant, deviceTokenResponse, exchangeDeviceGrant, inspectDeviceGrant, refreshDeviceGrant, startDeviceGrant } from "../../packages/contracts/src/device-grant";
import { isCommand, isRecord, type AddOptionCommand, type AddReply, type Preview } from "../src/shared/extension-api";
const json = (body: unknown, status = 200) => Response.json(body, { status });
let revision = 1;
let dropNext = false;
// Journey knobs, one per panel state that a healthy server never shows.
// Preview failure and delays last until cleared; command outcomes apply once.
let failPreviewFor: string | null = null;
let previewDelayMs = 0;
let commandDelayMs = 0;
let nextCommand: "reject" | "unauthorized" | null = null;
// Seconds an issued access token lives; null restores the real 5 minutes.
let accessExpiresInSeconds: number | null = null;
const receipts = new Map<string, {
  body: string;
  reply: AddReply;
}>();
const writes: AddOptionCommand[] = [];
const requests: {
  path: string;
  cookie: boolean;
  bearer: boolean;
}[] = [];
// The active grant of the fixture account, keyed by device code. Its shape
// mirrors what the server's device-grant service keeps: hashes stand in for
// stored secrets, statuses move pending to approved to active (or denied).
const base = "http://127.0.0.1:3217";
type GrantState = {
  deviceCode: string;
  userCode: string;
  codeChallenge: string;
  verifier: null;
  scheduleId: string;
  status: "pending" | "approved" | "denied" | "active" | "revoked";
  codeExpiresAt: number;
  refresh: { token: string; used: boolean } | null;
  access: { token: string; expiresAt: number }[];
};
const grants = new Map<string, GrantState>();
const opaque = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-"[b % 64]).join("");
const base32 = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), b => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[b & 31]).join("");
async function issue(grant: GrantState): Promise<unknown> {
  const access = { token: opaque(), expiresAt: Date.now() + (accessExpiresInSeconds ?? 300) * 1000 };
  grant.access.push(access);
  grant.refresh = { token: opaque(), used: false };
  return deviceTokenResponse.parse({
    accessToken: access.token,
    refreshToken: grant.refresh.token,
    tokenType: "Bearer",
    expiresIn: accessExpiresInSeconds ?? 300,
    scopes: ["schedule:read", "schedule:add-option"],
    grantId: "fixture-grant",
  });
}
const findAccess = (token: string) => [...grants.values()].flatMap(grant => grant.access.map(entry => ({ grant, entry }))).find(({ entry, grant }) => entry.token === token && entry.expiresAt > Date.now() && grant.status === "active");
const sha256 = async (value: string) => {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const titles: Record<string, string> = { "14523": "CSCE 1030", "15802": "ENGL 1310", "16077": "CSCE 2100" };
const grades = { source: "UNT grade records" };
function preview(classNumber: string): Preview {
  const base = { scheduleId: "main", optionId: `section-${classNumber}`, revision, title: titles[classNumber], details: [] as string[], inSchedule: writes.some(w => w.optionId === `section-${classNumber}`) };
  if (classNumber === "14523") {
    return {
      ...base, conflict: "conflict", courseTitle: "Computer Science I", section: "001",
      meetings: [{ days: "Mon Wed Fri", time: "9:00 to 9:50 AM", room: "NTDP B185" }],
      clashes: [{ kind: "course", name: "CSCE 1040", when: "Mon Wed Fri 9:30 to 10:20 AM" }, { kind: "busy", name: "Work", when: "Mon 9:00 to 10:00 AM" }],
      grades: { ...grades, status: "history", instructor: "John Smith", averageGpa: 3.4, students: 146, terms: "2019 to 2025" },
    };
  }
  if (classNumber === "15802") {
    return {
      ...base, conflict: revision >= 2 ? "conflict" : "clear", courseTitle: "College Writing I", section: "005",
      meetings: [{ days: "Mon Wed Fri", time: "1:00 to 1:50 PM", room: "LANG 115" }],
      clashes: revision >= 2 ? [{ kind: "course", name: "HIST 2610", when: "Mon Wed Fri 1:00 to 1:50 PM" }] : [],
      grades: { ...grades, status: "none", instructor: "Jane Doe" },
    };
  }
  return {
    ...base, conflict: "unknown", unknownReason: "no-set-time", courseTitle: "Foundations of Computing", section: "004",
    meetings: [{ days: "Online", time: null, room: null }],
    grades: { ...grades, status: "unavailable", instructor: null },
  };
}
Bun.serve({
  hostname: "127.0.0.1", port: Number(process.env.STUB_PORT ?? 3217),
  async fetch(request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/health")
      return json({ ok: true });
    if (path === "/__observed")
      return json({ writes, requests, revision });
    if (path === "/__advance" && request.method === "POST") {
      revision++;
      return json({ revision });
    }
    if (path === "/__drop-next" && request.method === "POST") {
      dropNext = true;
      return json({ ok: true });
    }
    if (path === "/__knobs" && request.method === "POST") {
      const body: unknown = await request.json();
      if (!isRecord(body))
        return json({ error: "invalid knobs" }, 400);
      if (body.failPreviewFor === null || typeof body.failPreviewFor === "string")
        failPreviewFor = body.failPreviewFor;
      if (typeof body.previewDelayMs === "number")
        previewDelayMs = body.previewDelayMs;
      if (typeof body.commandDelayMs === "number")
        commandDelayMs = body.commandDelayMs;
      if (body.nextCommand === "reject" || body.nextCommand === "unauthorized" || body.nextCommand === null)
        nextCommand = body.nextCommand;
      if (typeof body.accessExpiresInSeconds === "number" && Number.isSafeInteger(body.accessExpiresInSeconds) && body.accessExpiresInSeconds > 0)
        accessExpiresInSeconds = body.accessExpiresInSeconds;
      if (body.accessExpiresInSeconds === null)
        accessExpiresInSeconds = null;
      return json({ failPreviewFor, previewDelayMs, commandDelayMs, nextCommand, accessExpiresInSeconds });
    }
    requests.push({ path, cookie: request.headers.has("cookie"), bearer: request.headers.get("authorization")?.startsWith("Bearer ") === true });
    if (request.headers.has("cookie"))
      return json({ error: "Cookies forbidden" }, 400);
    // The device-code flow, with the contract's schemas as the wire truth.
    if (path === "/api/v1/device/start" && request.method === "POST") {
      const parsed = startDeviceGrant.safeParse(await request.json().catch(() => null));
      if (!parsed.success)
        return json({ error: "invalid_request" }, 400);
      const grant: GrantState = {
        deviceCode: opaque(), userCode: base32(), codeChallenge: parsed.data.codeChallenge, verifier: null,
        scheduleId: parsed.data.clientKind === "extension" ? parsed.data.scheduleId : "",
        status: "pending", codeExpiresAt: Date.now() + 600_000, refresh: null, access: [],
      };
      grants.set(grant.deviceCode, grant);
      return json({ deviceCode: grant.deviceCode, userCode: grant.userCode, verificationUri: `${base}/device`, expiresIn: 600, interval: 1 });
    }
    if (path === "/api/v1/device/inspect" && request.method === "POST") {
      const parsed = inspectDeviceGrant.safeParse(await request.json().catch(() => null));
      if (!parsed.success)
        return json({ error: "invalid_request" }, 400);
      const grant = [...grants.values()].find(candidate => candidate.userCode === parsed.data.userCode && candidate.status === "pending" && candidate.codeExpiresAt > Date.now());
      if (!grant)
        return json({ error: "invalid_grant" }, 400);
      return json({ clientKind: "extension", scopes: ["schedule:read", "schedule:add-option"], userCode: grant.userCode, scheduleId: grant.scheduleId });
    }
    if (path === "/api/v1/device/approve" && request.method === "POST") {
      // Same-origin page call only, carrying the custom header, as the real
      // approval page does.
      if (request.headers.get("origin") !== base || request.headers.get("x-untangle-device") !== "1")
        return json({ error: "forbidden_origin" }, 403);
      const parsed = approveDeviceGrant.safeParse(await request.json().catch(() => null));
      if (!parsed.success)
        return json({ error: "invalid_request" }, 400);
      const grant = [...grants.values()].find(candidate => candidate.userCode === parsed.data.userCode && candidate.status === "pending" && candidate.codeExpiresAt > Date.now());
      if (!grant)
        return json({ error: "invalid_grant" }, 400);
      if (parsed.data.expectedUserId !== "fixture-account")
        return json({ error: "account_changed" }, 409);
      grant.status = parsed.data.decision === "approve" ? "approved" : "denied";
      return json({ status: grant.status });
    }
    if (path === "/api/v1/device/token" && request.method === "POST") {
      const parsed = exchangeDeviceGrant.safeParse(await request.json().catch(() => null));
      if (!parsed.success)
        return json({ error: "invalid_request" }, 400);
      const grant = grants.get(parsed.data.deviceCode);
      if (!grant || (await sha256(parsed.data.codeVerifier)) !== grant.codeChallenge)
        return json({ error: "invalid_grant" }, 400);
      if (grant.codeExpiresAt <= Date.now())
        return json({ error: "expired_token" }, 400);
      if (grant.status === "pending")
        return json({ error: "authorization_pending" }, 400);
      if (grant.status === "denied")
        return json({ error: "access_denied" }, 400);
      if (grant.status !== "approved")
        return json({ error: "invalid_grant" }, 400);
      grant.status = "active";
      return json(await issue(grant));
    }
    if (path === "/api/v1/device/refresh" && request.method === "POST") {
      const parsed = refreshDeviceGrant.safeParse(await request.json().catch(() => null));
      if (!parsed.success)
        return json({ error: "invalid_request" }, 400);
      const grant = [...grants.values()].find(candidate => candidate.refresh?.token === parsed.data.refreshToken);
      if (!grant || grant.status !== "active")
        return json({ error: "invalid_token" }, 401);
      if (grant.refresh.used) {
        // Presenting a used refresh token revokes the whole grant.
        grant.status = "revoked";
        return json({ error: "invalid_token" }, 401);
      }
      grant.refresh.used = true;
      return json(await issue(grant));
    }
    if (path === "/api/v1/device/revoke" && request.method === "POST") {
      const found = findAccess((request.headers.get("authorization") ?? "").replace(/^Bearer /, ""));
      if (!found)
        return json({ error: "invalid_token" }, 401);
      found.grant.status = "revoked";
      return json({ revoked: true });
    }
    // The stub's /device page: a signed-in student who approves at once. The
    // page reads the code from its own URL, like the real approval page does.
    if (path === "/device") {
      return new Response(`<!doctype html><meta charset="utf-8"><title>Connect a device</title><p id="result">Working</p><script>
        const userCode = new URLSearchParams(location.search).get("user_code");
        fetch("/api/v1/device/approve", { method: "POST", credentials: "same-origin",
          headers: { "Content-Type": "application/json", "X-UNTangle-Device": "1" },
          body: JSON.stringify({ userCode, expectedUserId: "fixture-account", decision: "approve" }) })
          .then(response => document.getElementById("result").textContent = response.ok ? "Approved. You can close this tab." : "Couldn't approve (HTTP " + response.status + ")")
          .catch(() => document.getElementById("result").textContent = "Couldn't reach the server");
      </script>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    }
    const match = path.match(/^\/api\/v1\/extension\/preview\/spring-2027\/(\d{4,5})$/);
    if (match) {
      const found = findAccess((request.headers.get("authorization") ?? "").replace(/^Bearer /, ""));
      if (!found)
        return json({ error: "Unauthorized" }, 401);
      const classNumber = match[1];
      if (!titles[classNumber])
        return json({ error: "not found" }, 404);
      if (previewDelayMs > 0)
        await Bun.sleep(previewDelayMs);
      if (failPreviewFor === classNumber)
        return json({ error: "fixture failure" }, 500);
      return json(preview(classNumber));
    }
    if (path === "/api/v1/extension/commands" && request.method === "POST") {
      const body: unknown = await request.json();
      if (!isCommand(body))
        return json({ error: "invalid command" }, 422);
      if (commandDelayMs > 0)
        await Bun.sleep(commandDelayMs);
      const forced = nextCommand;
      nextCommand = null;
      if (forced === "unauthorized")
        return json({ error: "Unauthorized" }, 401);
      if (forced === "reject")
        return json({ kind: "rejection", operationId: body.operationId, reason: "forbidden" }, 403);
      const encoded = JSON.stringify(body);
      const existing = receipts.get(body.operationId);
      if (existing)
        return existing.body === encoded ? json(existing.reply) : json({ kind: "rejection", operationId: body.operationId, reason: "forbidden" }, 403);
      if (body.expectedRevision !== revision)
        return json({ kind: "rejection", operationId: body.operationId, reason: "stale-revision" }, 409);
      revision++;
      writes.push(body);
      const reply: AddReply = { kind: "receipt", operationId: body.operationId, committedRevision: revision };
      receipts.set(body.operationId, { body: encoded, reply });
      if (dropNext) {
        dropNext = false;
        return json({ error: "response lost after commit" }, 503);
      }
      return json(reply);
    }
    return json({ error: "not found" }, 404);
  },
});
console.log("stub-untangle listening on http://127.0.0.1:3217");
