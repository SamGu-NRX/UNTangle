// Fixture-only server. No UNT calls, real credentials or session cookies.
import { isCommand, isRecord, type AddOptionCommand, type AddReply, type Preview } from "../src/shared/extension-api";
const json = (body: unknown, status = 200) => Response.json(body, { status });
let revision = 1;
let dropNext = false;
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
      return json({ scheduleId: "main", optionId: `section-${classNumber}`, revision, title: titles[classNumber], conflict: classNumber === "14523" || (classNumber === "15802" && revision >= 2) ? "conflict" : classNumber === "15802" ? "clear" : "unknown", details: classNumber === "14523" ? ["Work on Monday from 9 AM to 10 AM", "John Smith's course average is 3.40"] : ["Section 005"] } satisfies Preview);
    }
    if (path === "/api/v1/extension/commands" && request.method === "POST") {
      const body: unknown = await request.json();
      if (!isCommand(body))
        return json({ error: "invalid command" }, 422);
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
