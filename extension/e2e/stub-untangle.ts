// Fixture-only server. No UNT calls, real credentials or session cookies.
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
const auth = new Map<string, {
  state: string;
  redirectUri: string;
  challenge: string;
  code: string;
  consumed: boolean;
}>();
const token = "fixture-access-token";
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
      if (body.nextCommand === "reject" || body.nextCommand === "unauthorized")
        nextCommand = body.nextCommand;
      return json({ failPreviewFor, previewDelayMs, commandDelayMs, nextCommand });
    }
    requests.push({ path, cookie: request.headers.has("cookie"), bearer: request.headers.get("authorization") === `Bearer ${token}` });
    if (request.headers.has("cookie"))
      return json({ error: "Cookies forbidden" }, 400);
    if (path === "/api/v1/devices/authorize" && request.method === "POST") {
      const body: unknown = await request.json();
      if (!isRecord(body) || body.kind !== "extension" || body.codeChallengeMethod !== "S256" || typeof body.codeChallenge !== "string" || typeof body.state !== "string" || typeof body.redirectUri !== "string")
        return json({ error: "invalid_request" }, 400);
      const id = crypto.randomUUID();
      auth.set(id, { state: body.state, redirectUri: body.redirectUri, challenge: body.codeChallenge, code: crypto.randomUUID(), consumed: false });
      return json({ authorizationUrl: `http://127.0.0.1:3217/device/approve?id=${id}` });
    }
    if (path === "/device/approve") {
      const grant = auth.get(url.searchParams.get("id") ?? "");
      if (!grant)
        return json({ error: "not found" }, 404);
      const callback = new URL(grant.redirectUri);
      callback.searchParams.set("state", grant.state);
      callback.searchParams.set("code", grant.code);
      return Response.redirect(callback.href);
    }
    if (path === "/api/v1/devices/token" && request.method === "POST") {
      const body: unknown = await request.json();
      if (!isRecord(body) || typeof body.codeVerifier !== "string")
        return json({ error: "invalid_grant" }, 400);
      const verifier = new Bun.CryptoHasher("sha256").update(body.codeVerifier).digest("base64url");
      const grant = [...auth.values()].find(g => !g.consumed && g.code === body.code && g.redirectUri === body.redirectUri && g.challenge === verifier);
      if (!grant)
        return json({ error: "invalid_grant" }, 400);
      grant.consumed = true;
      return json({ accessToken: token, grantId: "fixture-grant", accountId: "fixture-account", expiresAt: Date.now() + 3600000 });
    }
    if (request.headers.get("authorization") !== `Bearer ${token}`)
      return json({ error: "Unauthorized" }, 401);
    const match = path.match(/^\/api\/v1\/extension\/preview\/spring-2027\/(\d{4,5})$/);
    if (match) {
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
