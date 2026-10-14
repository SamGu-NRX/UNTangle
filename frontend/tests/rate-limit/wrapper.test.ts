import { expect, test } from "bun:test";
import { budgets } from "@/lib/rate-limit/config";
import { createRateLimitWrapper } from "@/lib/rate-limit/server";
import { memoryStore, type RateLimitStore } from "@/lib/rate-limit/store";
import { trustRealIp } from "./route-fixtures";

trustRealIp();

let sessionLookups = 0;
function limiter(store: RateLimitStore = memoryStore()) {
  sessionLookups = 0;
  return createRateLimitWrapper({ store, secret: "test", now: () => 30_000, session: async (request) => {
    sessionLookups++;
    const id = request.headers.get("x-test-user");
    return id ? { user: { id } } : null;
  } });
}
const request = (ip: string, user?: string) =>
  new Request("http://localhost/", { headers: { "x-real-ip": ip, ...(user && { "x-test-user": user }) } });
const ok = () => new Response("ok");

test("a handler's own headers pass through untouched, including immutable ones", async () => {
  const worker = limiter()("grades", () => new Response("", { headers: { "Cache-Control": "public, max-age=31536000, immutable" } }));
  expect((await worker(request("203.0.113.1"))).headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
  const redirect = limiter()("grades", () => Response.redirect("http://localhost/elsewhere", 302));
  expect((await redirect(request("203.0.113.1"))).headers.get("Location")).toBe("http://localhost/elsewhere");
});

test("anonymous callers are limited by IP alone", async () => {
  const route = limiter()("mapRoute", ok);
  for (let i = 0; i < budgets.mapRoute.ip; i++) expect((await route(request("203.0.113.1"))).status).toBe(200);
  const denied = await route(request("203.0.113.1"));
  expect([denied.status, denied.headers.get("Cache-Control")]).toEqual([429, "no-store"]);
  expect((await route(request("203.0.113.2"))).status).toBe(200);
});

test("signed-in callers are limited by user alone, so classmates behind one NAT keep their own budgets", async () => {
  const route = limiter()("mapRoute", ok);
  for (let i = 0; i < budgets.mapRoute.user; i++) {
    expect((await route(request(`203.0.113.${i % 2}`, "alice"))).status).toBe(200);
  }
  expect((await route(request("198.51.100.9", "alice"))).status).toBe(429);
  expect((await route(request("203.0.113.0", "bob"))).status).toBe(200);
  expect((await route(request("203.0.113.0"))).status).toBe(200);
});

test("the auth class counts by IP without looking up a session", async () => {
  const signIn = limiter()("auth", ok);
  for (let i = 0; i < budgets.auth.ip; i++) await signIn(request("203.0.113.1", `user-${i}`));
  expect((await signIn(request("203.0.113.1", "fresh"))).status).toBe(429);
  expect(sessionLookups).toBe(0);
});

test("a failing store answers 503 and never runs the handler", async () => {
  const error = console.error;
  console.error = () => {};
  let ran = false;
  try {
    const route = limiter({ ...memoryStore(), hit: () => Promise.reject(new Error("table missing")) })("grades", () => ((ran = true), ok()));
    const response = await route(request("203.0.113.1"));
    expect([response.status, response.headers.get("Retry-After"), ran]).toEqual([503, "60", false]);
  } finally {
    console.error = error;
  }
});


test.each([
  ["/sign-in/email", 3, "10"], ["/sign-up/email", 3, "10"],
  ["/request-password-reset", 3, "60"], ["/send-verification-email", 3, "60"],
  ["/sign-in/magic-link", 5, "60"],
])("concurrent %s requests stop before excess handlers run", async (path, limit, retry) => {
  let ran = 0;
  const route = limiter()("auth", async () => { ran++; await Bun.sleep(1); return ok(); });
  const req = () => new Request(`http://localhost/api/auth${path}`, { headers: { "x-real-ip": "203.0.113.1" } });
  const responses = await Promise.all(Array.from({ length: 12 }, () => route(req())));
  expect(responses.filter(r => r.status === 200)).toHaveLength(limit);
  expect([ran, responses.find(r => r.status === 429)?.headers.get("Retry-After")]).toEqual([limit, retry]);
});

test("sensitive bursts stay limited across epoch boundaries while handlers are in flight", async () => {
  let time = 9_999;
  let entered = 0;
  const release = Promise.withResolvers<void>();
  const firstEntered = Promise.withResolvers<void>();
  const route = createRateLimitWrapper({ store: memoryStore(), secret: "test", now: () => time, session: async () => null })("auth", async () => {
    if (++entered === 3) firstEntered.resolve();
    await release.promise;
    return ok();
  });
  const req = () => new Request("http://localhost/api/auth/sign-in/email", { headers: { "x-real-ip": "203.0.113.1" } });
  const first = Array.from({ length: 3 }, () => route(req()));
  try {
    await firstEntered.promise;
    time = 10_000;
    const denied = await Promise.all(Array.from({ length: 3 }, () => route(req())));
    expect(denied.map(response => response.status)).toEqual([429, 429, 429]);
    expect(denied[0].headers.get("Retry-After")).toBe("10");
    expect(entered).toBe(3);
    time = 19_999;
    expect((await route(req())).status).toBe(429);
  } finally {
    release.resolve();
  }
  expect((await Promise.all(first)).map(response => response.status)).toEqual([200, 200, 200]);
  time = 29_999;
  expect((await route(req())).status).toBe(200);
});
