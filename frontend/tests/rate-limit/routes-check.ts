// Run in a separate Bun process so route module mocks cannot affect planner/auth tests.
import assert from "node:assert/strict";
import { mock } from "bun:test";
import { routeBudgets } from "@/lib/rate-limit/config";
process.env.RATE_LIMIT_TRUSTED_PROXY = "reverse-proxy";
mock.module("server-only", () => ({}));
mock.module("@/lib/auth-server", () => ({ getServerSession: async () => null }));
const routes = [
  { path: "/api/planner", module: await import("@/app/api/planner/route"), method: "GET", category: "general" },
  { path: "/api/planner", module: await import("@/app/api/planner/route"), method: "POST", category: "plannerSave" },
  { path: "/api/grades/search", module: await import("@/app/api/grades/search/route"), method: "GET", category: "grades" },
  { path: "/api/grades/instructors", module: await import("@/app/api/grades/instructors/route"), method: "GET", category: "grades" },
  { path: "/api/grades/instructors/invalid", module: await import("@/app/api/grades/instructors/[id]/route"), method: "GET", category: "grades", context: { params: Promise.resolve({ id: "" }) } },
  { path: "/api/grades/courses/invalid/invalid", module: await import("@/app/api/grades/courses/[subject]/[number]/route"), method: "GET", category: "grades", context: { params: Promise.resolve({ subject: "", number: "" }) } },
  { path: "/api/map/route", module: await import("@/app/api/map/route/route"), method: "POST", category: "mapRoute" },
  { path: "/api/map/resolve", module: await import("@/app/api/map/resolve/route"), method: "POST", category: "mapResolve" },
  { path: "/api/map/worker", module: await import("@/app/api/map/worker/route"), method: "GET", category: "general" },
] as const;
let index = 1;
for (const route of routes) {
  const handler = route.method === "POST" ? "POST" in route.module ? route.module.POST : undefined : "GET" in route.module ? route.module.GET : undefined;
  assert(handler);
  // SAFETY: each module entry supplies its own params when required; routes without params ignore the second argument.
  const invoke = handler as (request: Request, context?: object) => Promise<Response>;
  let cookie = "";
  const ip = `203.0.113.${index++}`;
  const max = routeBudgets[route.category].identity.maxRequests;
  for (let i = 0; i <= max; i++) {
    const request = new Request(`http://localhost:3000${route.path}`, {
      method: route.method, headers: { cookie, "x-real-ip": ip },
      ...(route.method === "POST" ? { body: "{}" } : {}),
    });
    const response = await invoke(request, "context" in route ? route.context : undefined);
    cookie = response.headers.get("set-cookie")?.split(";")[0] ?? cookie;
    if (i < max) assert.notEqual(response.status, 429, route.path);
    else {
      assert.equal(response.status, 429, route.path);
      assert.equal(response.headers.get("RateLimit-Remaining"), "0");
      assert.equal(response.headers.get("RateLimit-Limit"), String(max));
      assert(Number(response.headers.get("Retry-After")) > 0);
      assert(Number(response.headers.get("RateLimit-Reset")) > 0);
      assert.equal((await response.json()).error, "Too many requests");
      assert.equal(response.headers.get("cache-control"), "private, no-store");
    }
  }
}
console.log(`Verified 429 responses and headers for ${routes.length} route methods.`);
