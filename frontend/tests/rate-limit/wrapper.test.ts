import { expect, test } from "bun:test";
import { createRateLimitWrapper } from "@/lib/rate-limit/server";
import { MemoryRateLimitStore } from "@/lib/rate-limit/store";
import { resolveIdentity, type ApiSession } from "@/lib/rate-limit/identity";

function setup(session: ApiSession = null) {
  let now = 1000;
  const store = new MemoryRateLimitStore(() => now);
  const wrap = createRateLimitWrapper({ store: async () => store, session: async () => session,
    identity: (request, user) => resolveIdentity(request, user, { secret: "unit-test-identity-secret-long-enough", now,
      env: { RATE_LIMIT_TRUSTED_PROXY: "reverse-proxy" } }),
  });
  return { wrap, advance: (ms: number) => { now += ms; } };
}
const budget = { identity: { maxRequests: 2, windowMs: 1500 }, ip: { maxRequests: 3, windowMs: 1500 } };
function request(cookie = "", ip = "203.0.113.1") {
  return new Request("http://localhost/api", { headers: { cookie, "x-real-ip": ip } });
}

test("signed-in user limits span devices and IPs and retain route context", async () => {
  const t = setup({ user: { id: "student" } });
  const handler = t.wrap("sections", async (_request, context: { id: string }) => Response.json(context), budget);
  expect(await (await handler(request(), { id: "A" })).json()).toEqual({ id: "A" });
  expect((await handler(request("", "203.0.113.2"), { id: "B" })).status).toBe(200);
  const denied = await handler(request("", "203.0.113.3"), { id: "C" });
  expect(denied.status).toBe(429);
  expect(denied.headers.get("Retry-After")).toBe("2");
  t.advance(1500);
  expect((await handler(request(), { id: "D" })).status).toBe(200);
});

test("per-IP enforcement survives guest-cookie cycling and denied calls do not extend the window", async () => {
  const t = setup();
  const handler = t.wrap("expensive", () => Response.json({ accepted: true }), budget);
  for (let i = 0; i < 3; i++) expect((await handler(request(`untangle_guest=forged-${i}`))).status).toBe(200);
  const denied = await handler(request());
  expect(denied.status).toBe(429);
  expect(denied.headers.get("RateLimit-Limit")).toBe("3");
  expect(denied.headers.get("RateLimit-Remaining")).toBe("0");
  expect(denied.headers.get("Retry-After")).toBe("2");
  t.advance(1500);
  expect((await handler(request())).status).toBe(200);
});

test("guest limit survives repeat requests; route classes have independent windows", async () => {
  const t = setup();
  const handler = t.wrap("sections", () => Response.json({ accepted: true }), budget);
  const response = await handler(request());
  const cookie = response.headers.get("set-cookie")!.split(";")[0];
  expect(response.status).toBe(200);
  expect((await handler(request(cookie))).status).toBe(200);
  expect((await handler(request(cookie))).status).toBe(429);
  const other = t.wrap("expensive", () => Response.json({ accepted: true }), budget);
  expect((await other(request(cookie))).status).toBe(200);
});

test("unknown IP fallback holds even when forwarded headers are spoofed", async () => {
  const t = setup();
  const handler = t.wrap("expensive", () => Response.json({ accepted: true }), budget);
  for (let i = 0; i < 3; i++) {
    const req = new Request("http://localhost/api", { headers: { "x-forwarded-for": `203.0.113.${i}` } });
    expect((await handler(req)).status).toBe(200);
  }
  expect((await handler(new Request("http://localhost/api"))).status).toBe(429);
});

test("storage/session failures stop the handler with 503 and a recovery header", async () => {
  const originalError = console.error;
  const messages: unknown[][] = [];
  console.error = (...args: unknown[]) => { messages.push(args); };
  try {
    const store = new MemoryRateLimitStore();
    for (const failure of ["store", "session"] as const) {
      const wrap = createRateLimitWrapper({
        store: async () => { if (failure === "store") throw new Error("missing table"); return store; },
        session: async () => { throw new Error("session database offline"); },
        identity: () => ({ key: "guest", ipKey: "ip" }),
      });
      let ran = false;
      const handler = wrap("grades", () => { ran = true; return Response.json({ accepted: true }); });
      const response = await handler(request());
      expect(response.status).toBe(503);
      expect(response.headers.get("Retry-After")).toBe("60");
      expect(await response.json()).toEqual({ error: "Abuse prevention unavailable. Try again later." });
      expect(ran).toBe(false);
    }
    expect(messages).toHaveLength(2);
  } finally { console.error = originalError; }
});
